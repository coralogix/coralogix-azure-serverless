#!/usr/bin/env bash
#
# E2E test for BlobViaEventGrid Azure Function.
#
# Order of execution:
#   1. Provision Azure resources with Terraform (resource group, StorageV2 account, container).
#   2. Deploy the ARM template at ARM_TEMPLATE_REF (default master) via Azure CLI,
#      with explicit parameters from step 1.
#      The ARM template creates the Event Grid system topic and subscription to the function.
#   2c. Sync function triggers (az resource invoke-action), then wait 15s.
#   3. Send a test payload (upload a blob to trigger Event Grid → function).
#   4. Wait 30s, then poll Coralogix Get Logs Count API until count > 0 (retry every 30s, up to 30 times).
#   5. Clean up all resources.
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login).
#   - Terraform >= 1.7.4.
#   - jq (for parsing Coralogix API response).
#   - Environment variables (or export before running):
#     - OTEL_ENDPOINT (required) – OTLP endpoint URL, e.g. https://ingress.coralogix.com
#     - CORALOGIX_QUERY_API_KEY or CORALOGIX_API_KEY – for Step 4 verification (Data Usage read permission).
#     - CORALOGIX_API_KEY or CORALOGIX_PRIVATE_KEY – used as Coralogix Private Key for the function.
#     - Optional: CORALOGIX_APPLICATION, CORALOGIX_SUBSYSTEM
#     - Optional: ARM_TEMPLATE_REF – branch/tag/SHA to fetch the ARM template from
#       (default: master). CI sets this to the commit under test.
#     - Optional: ARM_TEMPLATE_URI – full template URL, overrides ARM_TEMPLATE_REF.
#     - Optional: RG_NAME – override the e2e resource group name.
#
# Usage:
#   export OTEL_ENDPOINT="https://ingress.eu1.coralogix.com"
#   export CORALOGIX_API_KEY="your-send-your-data-key"
#   export CORALOGIX_QUERY_API_KEY="your-query-key"
#   ./e2e.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="${SCRIPT_DIR}/terraform"
# Defaults to master so a local run needs no setup; CI overrides ARM_TEMPLATE_REF
# with the commit under test so the template being validated is the one changed.
ARM_TEMPLATE_REF="${ARM_TEMPLATE_REF:-master}"
ARM_TEMPLATE_URI="${ARM_TEMPLATE_URI:-https://raw.githubusercontent.com/coralogix/coralogix-azure-serverless/${ARM_TEMPLATE_REF}/BlobViaEventGrid/ARM/BlobViaEventGrid.json}"

# Required
: "${OTEL_ENDPOINT:?Set OTEL_ENDPOINT (e.g. https://ingress.coralogix.com)}"
: "${CORALOGIX_API_KEY:?Set CORALOGIX_API_KEY (Send your data / Private key for the function)}"

# For Step 4 verification
CORALOGIX_QUERY_API_KEY="${CORALOGIX_QUERY_API_KEY:-${CORALOGIX_API_KEY}}"

CX_APP="${CORALOGIX_APPLICATION:-azure}"
CX_SUBSYS="${CORALOGIX_SUBSYSTEM:-blob-storage-eventgrid-e2e}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
err() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: $*" >&2; }

# Known up front (not read from terraform output) so the cleanup trap below can
# still tear down the resource group when `terraform apply` fails part-way.
# Must match the default of var.resource_group_name in tests/terraform.
# GITHUB_RUN_ID (Actions only) makes the name unique per workflow run so
# overlapping e2e jobs cannot delete each other's groups. Local runs keep
# the stable name and rely on the pre-flight sweep.
RG_NAME="${RG_NAME:-blobviaeg-e2e-rg${GITHUB_RUN_ID:+-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}}}"

# Terraform state here is disposable: every run provisions from scratch into a
# resource group whose name is fixed. Carrying it between runs is not merely
# useless but harmful -- it pins random_string.suffix, so the "random" storage
# account name is reused, the recreated account lands on the identical resource
# ID, and diagnostic settings Azure orphaned when the previous group was deleted
# resurface as "already exists". Discard it whenever the group goes away.
discard_terraform_state() {
  rm -f "${TERRAFORM_DIR}/terraform.tfstate" "${TERRAFORM_DIR}/terraform.tfstate.backup"
}

cleanup_after_failure() {
  log "Cleaning up after failure..."
  if [[ -n "${RG_NAME:-}" ]]; then
    az group delete --name "$RG_NAME" --yes --no-wait 2>/dev/null || true
  fi
  discard_terraform_state
}
trap cleanup_after_failure EXIT

# --- Step 1: Provision with Terraform ---
# An aborted earlier run can leave the resource group behind, and because the
# name is deterministic that makes every later `terraform apply` fail with
# "already exists". The failure path deletes with --no-wait, so the group may
# also still be mid-delete from that run: request deletion (ignoring an error if
# one is already in flight) and then wait until it has actually gone, rather than
# assuming a blocking delete can start.
PREFLIGHT_TIMEOUT_SECS="${PREFLIGHT_TIMEOUT_SECS:-600}"
if [[ "$(az group exists --name "$RG_NAME")" == "true" ]]; then
  log "Pre-flight: resource group $RG_NAME is left over from an earlier run; removing it..."
  az group delete --name "$RG_NAME" --yes --no-wait 2>/dev/null || true
  waited=0
  while [[ "$(az group exists --name "$RG_NAME")" == "true" ]]; do
    if [[ "$waited" -ge "$PREFLIGHT_TIMEOUT_SECS" ]]; then
      err "Pre-flight: $RG_NAME still present after ${PREFLIGHT_TIMEOUT_SECS}s. Delete it manually and re-run."
      exit 1
    fi
    sleep 10
    waited=$((waited + 10))
  done
  log "Pre-flight: $RG_NAME removed after ${waited}s."
fi

# Nothing this harness provisions survives the sweep above, so any state still on
# disk describes resources that no longer exist -- left behind by a run that died
# before its own cleanup. Start from an empty state unconditionally.
discard_terraform_state

log "Step 1: Provisioning Azure resources with Terraform (RG, StorageV2, container)..."
cd "$TERRAFORM_DIR"
terraform init -input=false
terraform apply -input=false -auto-approve -var="resource_group_name=${RG_NAME}"

STORAGE_ACCOUNT=$(terraform output -raw storage_account_name)
STORAGE_RG=$(terraform output -raw storage_account_resource_group)
CONTAINER_NAME=$(terraform output -raw blob_container_name)
STORAGE_CONNECTION_STRING=$(terraform output -raw storage_account_connection_string)

log "Terraform outputs: RG=$RG_NAME, Storage=$STORAGE_ACCOUNT, Container=$CONTAINER_NAME"

# --- Step 2: Deploy the ARM template at ARM_TEMPLATE_REF with explicit parameters ---
log "Step 2: Deploying ARM template (ref: ${ARM_TEMPLATE_REF}) (function + Event Grid system topic and subscription)..."
PARAMS_FILE="${SCRIPT_DIR}/arm-params.json"
# Build parameters JSON; escape quotes in values.
build_param() { echo "\"$1\": { \"value\": \"$(echo "$2" | sed 's/\\/\\\\/g; s/"/\\"/g')\" }"; }
{
  echo '{ "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#", "contentVersion": "1.0.0.0", "parameters": {'
  echo '  "CoralogixRegion": { "value": "Custom" },'
  echo "  $(build_param 'CustomURL' "$OTEL_ENDPOINT"),"
  echo "  $(build_param 'CoralogixPrivateKey' "$CORALOGIX_API_KEY"),"
  echo "  $(build_param 'CoralogixApplication' "$CX_APP"),"
  echo "  $(build_param 'CoralogixSubsystem' "$CX_SUBSYS"),"
  echo "  $(build_param 'StorageAccountName' "$STORAGE_ACCOUNT"),"
  echo "  $(build_param 'StorageAccountResourceGroup' "$STORAGE_RG"),"
  echo "  $(build_param 'BlobContainerName' "$CONTAINER_NAME"),"
  echo '  "EventGridSystemTopicName": { "value": "cxEventGridTopic" },'
  echo '  "NewlinePattern": { "value": "(?:\\\\r\\\\n|\\\\r|\\\\n)" },'
  echo '  "PrefixFilter": { "value": "NoFilter" },'
  echo '  "SuffixFilter": { "value": "NoFilter" },'
  echo "  $(build_param 'FunctionAppServicePlanType' "${FUNCTION_APP_SERVICE_PLAN_TYPE:-Consumption}"),"
  echo '  "DebugMode": { "value": "false" },'
  echo '  "EnableBlobMetadata": { "value": "false" }'
  echo '} }'
} > "$PARAMS_FILE"

# The template creates the Event Grid subscription in the same deployment as the
# function app. Event Grid validates the webhook endpoint immediately, and if the
# app has not finished pulling its package yet that probe 404s and the whole
# deployment fails with "Webhook endpoint validation failed". The app is warm by
# the next attempt and the deployment is idempotent, so retry — but only for that
# specific error. Anything else is a real template or parameter fault and must
# surface immediately instead of being hidden behind two minutes of retries.
ARM_DEPLOY_ATTEMPTS="${ARM_DEPLOY_ATTEMPTS:-3}"
DEPLOY_LOG="${SCRIPT_DIR}/.arm-deploy.log"
for attempt in $(seq 1 "$ARM_DEPLOY_ATTEMPTS"); do
  if az deployment group create \
      --resource-group "$RG_NAME" \
      --template-uri "$ARM_TEMPLATE_URI" \
      --parameters "@${PARAMS_FILE}" 2>&1 | tee "$DEPLOY_LOG"; then
    break
  fi

  if ! grep -qE 'Webhook endpoint validation failed|StatusCode: NotFound' "$DEPLOY_LOG"; then
    err "ARM deployment failed for a reason other than the Event Grid webhook race; not retrying (full output above)."
    rm -f "$PARAMS_FILE" "$DEPLOY_LOG"
    exit 1
  fi

  if [[ "$attempt" -eq "$ARM_DEPLOY_ATTEMPTS" ]]; then
    err "Event Grid webhook validation still failing after ${ARM_DEPLOY_ATTEMPTS} attempts."
    rm -f "$PARAMS_FILE" "$DEPLOY_LOG"
    exit 1
  fi

  log "Attempt ${attempt}: Event Grid webhook validation failed (function app not serving yet); retrying in 60s..."
  sleep 60
done

rm -f "$PARAMS_FILE" "$DEPLOY_LOG"
log "ARM deployment completed."

# --- Step 2c: Sync function triggers, then wait before sending data ---
FUNCTION_APP_NAME=$(az functionapp list --resource-group "$RG_NAME" --query "[0].name" -o tsv)
if [[ -z "${FUNCTION_APP_NAME:-}" ]]; then
  err "Step 2c: No function app found in resource group $RG_NAME."
  exit 1
fi
log "Step 2c: Syncing function triggers..."
az resource invoke-action -g "$RG_NAME" -n "$FUNCTION_APP_NAME" --action syncfunctiontriggers --resource-type Microsoft.Web/sites
log "Step 2c: Waiting 15s for triggers to register..."
sleep 15

# --- Step 3: Send test payload (upload blob to trigger Event Grid → function) ---
log "Step 3: Uploading test blob to trigger Event Grid and the function..."
TEST_BLOB_NAME="e2e-test-$(date +%s).log"
TEST_BLOB_FILE="${SCRIPT_DIR}/.e2e-test-payload.tmp"
printf 'e2e test line 1\ne2e test line 2\ne2e test line 3\n' > "$TEST_BLOB_FILE"
az storage blob upload \
  --connection-string "$STORAGE_CONNECTION_STRING" \
  --container-name "$CONTAINER_NAME" \
  --name "$TEST_BLOB_NAME" \
  --file "$TEST_BLOB_FILE" \
  --type block \
  --content-type "text/plain" \
  --no-progress
rm -f "$TEST_BLOB_FILE"

log "Uploaded test blob: $CONTAINER_NAME/$TEST_BLOB_NAME"

# --- Step 4: Verify logs landed in Coralogix (poll Get Logs Count API) ---
CX_API_HOST="${OTEL_ENDPOINT#*://}"
CX_API_HOST="${CX_API_HOST%%:*}"
CX_API_HOST="${CX_API_HOST/#ingress./api.}"
CX_LOGS_COUNT_URL="https://${CX_API_HOST}/mgmt/openapi/latest/dataplans/data-usage/v2/logs:count"

now_minus_10m() {
  if date -u -d '10 min ago' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null; then
    return
  fi
  date -u -v-10M +%Y-%m-%dT%H:%M:%S.000Z
}

fetch_logs_count() {
  local from to
  from=$(now_minus_10m)
  to=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  curl -s -G "$CX_LOGS_COUNT_URL" \
    --data-urlencode "date_range.fromDate=$from" \
    --data-urlencode "date_range.toDate=$to" \
    --data-urlencode "resolution=10m" \
    --data-urlencode "filters.application=$CX_APP" \
    --data-urlencode "filters.subsystem=$CX_SUBSYS" \
    --data-urlencode "subsystem_aggregation=true" \
    -H "Authorization: Bearer $CORALOGIX_QUERY_API_KEY" | head -1 | jq -r '(.result.logsCount // []) | map(.logsCount | tonumber) | add // 0'
}

log "Step 4: Waiting 30s, then verifying logs in Coralogix (app=$CX_APP, subsystem=$CX_SUBSYS)..."
sleep 30

MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"
attempt=0
while true; do
  attempt=$((attempt + 1))
  count=$(fetch_logs_count)
  if [[ -n "$count" && "$count" -gt 0 ]]; then
    log "Step 4: Logs verified in Coralogix (count=$count)."
    break
  fi
  if [[ $attempt -ge "$MAX_ATTEMPTS" ]]; then
    err "Step 4: No logs received in Coralogix after $MAX_ATTEMPTS attempts (last count=${count:-unknown})."
    exit 1
  fi
  log "Step 4: No logs yet (attempt $attempt/$MAX_ATTEMPTS), retrying in 30s..."
  sleep 30
done

# --- Step 5: Clean up ---
log "Step 5: Cleaning up resources..."
trap - EXIT
az group delete --name "$RG_NAME" --yes
log "Waiting for resource group deletion..."
while az group show -n "$RG_NAME" &>/dev/null; do sleep 10; done
# Clean Terraform state so next run can provision from scratch.
discard_terraform_state
log "E2E test finished."
