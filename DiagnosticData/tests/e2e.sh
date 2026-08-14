#!/usr/bin/env bash
#
# E2E test for DiagnosticData Azure Function.
#
# Order of execution:
#   1. Provision Azure resources with Terraform (RG, Event Hub, storage account with
#      diagnostic setting that streams Transaction metric to Event Hub).
#   2. Deploy the ARM template at ARM_TEMPLATE_REF (default master) via Azure CLI,
#      with explicit parameters from step 1.
#   2c. Sync function triggers (az resource invoke-action), then wait 15s.
#   3. Upload 5–10 blobs to the storage account to generate transactions; diagnostic setting
#      streams data to Event Hub; function reads and forwards to Coralogix.
#   4. Wait 2 min, then poll Coralogix Data Usage API until subsystem units > 0 (retry every 30s, up to 30 times).
#   5. Clean up all resources.
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login).
#   - Terraform >= 1.7.4.
#   - jq (for parsing Coralogix API response).
#   - Environment variables (or export before running):
#     - OTEL_ENDPOINT (required) – OTLP/ingress endpoint URL, e.g. https://ingress.coralogix.com
#     - CORALOGIX_QUERY_API_KEY or CORALOGIX_API_KEY – for Step 4 (Data Usage API read permission).
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
ARM_TEMPLATE_URI="${ARM_TEMPLATE_URI:-https://raw.githubusercontent.com/coralogix/coralogix-azure-serverless/${ARM_TEMPLATE_REF}/DiagnosticData/ARM/DiagnosticData.json}"

# Number of blobs to upload to trigger storage transactions (diagnostic data streamed to Event Hub)
NUM_BLOBS="${NUM_BLOBS:-8}"

# Required
: "${OTEL_ENDPOINT:?Set OTEL_ENDPOINT (e.g. https://ingress.coralogix.com)}"
: "${CORALOGIX_API_KEY:?Set CORALOGIX_API_KEY (Send your data / Private key for the function)}"

# For Step 4 verification
CORALOGIX_QUERY_API_KEY="${CORALOGIX_QUERY_API_KEY:-${CORALOGIX_API_KEY}}"

CX_APP="${CORALOGIX_APPLICATION:-azure}"
CX_SUBSYS="${CORALOGIX_SUBSYSTEM:-diagnosticdata-e2e}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
err() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: $*" >&2; }

# Known up front (not read from terraform output) so the cleanup trap below can
# still tear down the resource group when `terraform apply` fails part-way.
# Must match the default of var.resource_group_name in tests/terraform.
RG_NAME="${RG_NAME:-cx-diagdata-e2e-rg}"

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

log "Step 1: Provisioning Azure resources with Terraform (RG, Event Hub, storage account + diagnostic setting)..."
cd "$TERRAFORM_DIR"
terraform init -input=false
terraform apply -input=false -auto-approve -var="resource_group_name=${RG_NAME}"

EVENTHUB_NAMESPACE=$(terraform output -raw eventhub_namespace)
EVENTHUB_NAME=$(terraform output -raw eventhub_name)
EVENTHUB_RG=$(terraform output -raw eventhub_resource_group)
EVENTHUB_SAS_POLICY_NAME=$(terraform output -raw eventhub_shared_access_policy_name)
STORAGE_CONNECTION_STRING=$(terraform output -raw storage_account_connection_string)
CONTAINER_NAME=$(terraform output -raw blob_container_name)

log "Terraform outputs: RG=$RG_NAME, EventHub=$EVENTHUB_NAMESPACE/$EVENTHUB_NAME, Storage container=$CONTAINER_NAME"

# --- Step 2: Deploy the ARM template at ARM_TEMPLATE_REF with explicit parameters ---
# DiagnosticData ARM expects CustomURL as the full Coralogix events URL (e.g. https://ingress.xxx/azure/events/v1)
CORALOGIX_EVENTS_URL="${OTEL_ENDPOINT%/}/azure/events/v1"

log "Step 2: Deploying ARM template (ref: ${ARM_TEMPLATE_REF}) (DiagnosticData function)..."
PARAMS_FILE="${SCRIPT_DIR}/arm-params.json"
build_param() { echo "\"$1\": { \"value\": \"$(echo "$2" | sed 's/\\/\\\\/g; s/"/\\"/g')\" }"; }
{
  echo '{ "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#", "contentVersion": "1.0.0.0", "parameters": {'
  echo '  "CoralogixRegion": { "value": "Custom" },'
  echo "  $(build_param 'CustomURL' "$CORALOGIX_EVENTS_URL"),"
  echo "  $(build_param 'CoralogixPrivateKey' "$CORALOGIX_API_KEY"),"
  echo "  $(build_param 'CoralogixApplication' "$CX_APP"),"
  echo "  $(build_param 'CoralogixSubsystem' "$CX_SUBSYS"),"
  echo "  $(build_param 'EventhubResourceGroup' "$EVENTHUB_RG"),"
  echo "  $(build_param 'EventhubNamespace' "$EVENTHUB_NAMESPACE"),"
  echo "  $(build_param 'EventhubInstanceName' "$EVENTHUB_NAME"),"
  echo "  $(build_param 'EventhubSharedAccessPolicyName' "$EVENTHUB_SAS_POLICY_NAME"),"
  echo "  $(build_param 'FunctionAppServicePlanType' "${FUNCTION_APP_SERVICE_PLAN_TYPE:-Consumption}")"
  echo '} }'
} > "$PARAMS_FILE"

az deployment group create \
  --resource-group "$RG_NAME" \
  --template-uri "$ARM_TEMPLATE_URI" \
  --parameters "@${PARAMS_FILE}"

rm -f "$PARAMS_FILE"
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

# --- Step 3: Upload blobs to generate storage transactions (diagnostic setting streams to Event Hub) ---
log "Step 3: Uploading $NUM_BLOBS blobs to container $CONTAINER_NAME to trigger diagnostic data..."
PAYLOAD_FILE="${SCRIPT_DIR}/.e2e-diagdata-payload.tmp"
printf 'e2e diagnostic data test payload - %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PAYLOAD_FILE"

uploaded=0
for i in $(seq 1 "$NUM_BLOBS"); do
  blob_name="e2e-diagdata-$(date +%s)-$i.txt"
  if az storage blob upload \
    --connection-string "$STORAGE_CONNECTION_STRING" \
    --container-name "$CONTAINER_NAME" \
    --name "$blob_name" \
    --file "$PAYLOAD_FILE" \
    --type block \
    --content-type "text/plain" \
    --no-progress 2>/dev/null; then
    uploaded=$((uploaded + 1))
  fi
done
rm -f "$PAYLOAD_FILE"

if [[ $uploaded -eq 0 ]]; then
  err "Step 3: No blobs uploaded. Check storage connection string and container."
  exit 1
fi
log "Uploaded $uploaded blobs. Diagnostic setting will stream Transaction metric to Event Hub (may take 1–2 min)."

# --- Step 4: Verify data in Coralogix (poll Data Usage API for subsystem units) ---
# Same approach as check_metrics.sh: sum .units for entries where dimensions contain
# genericDimension key=subsystem_name, value=$CX_SUBSYS.
CX_API_HOST="${OTEL_ENDPOINT#*://}"
CX_API_HOST="${CX_API_HOST%%:*}"
CX_API_HOST="${CX_API_HOST%%/*}"
CX_API_HOST="${CX_API_HOST/#ingress./api.}"
CX_DATA_USAGE_URL="https://${CX_API_HOST}/mgmt/openapi/latest/dataplans/data-usage/v2"

now_minus_60m() {
  if date -u -d '60 min ago' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null; then
    return
  fi
  date -u -v-60M +%Y-%m-%dT%H:%M:%S.000Z
}

fetch_data_usage_units() {
  local from to
  from=$(now_minus_60m)
  to=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  curl -s -G "$CX_DATA_USAGE_URL" \
    --data-urlencode "date_range.fromDate=$from" \
    --data-urlencode "date_range.toDate=$to" \
    --data-urlencode "resolution=1h" \
    --data-urlencode "aggregate=AGGREGATE_BY_SUBSYSTEM" \
    -H "Authorization: Bearer $CORALOGIX_QUERY_API_KEY" 2>/dev/null | head -1 | \
    jq -r --arg sub "$CX_SUBSYS" '(.result.entries // []) | map(select(any(.dimensions[]?; .genericDimension? | select(.key == "subsystem_name" and .value == $sub)))) | map(.units) | add // 0'
}

# Diagnostic data can take 1–2 minutes (or more) to flow: storage → Event Hub → function → Coralogix
WAIT_INITIAL="${WAIT_INITIAL:-120}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"

log "Step 4: Waiting ${WAIT_INITIAL}s for diagnostic data to flow, then verifying data in Coralogix (subsystem=$CX_SUBSYS, data usage units)..."
sleep "$WAIT_INITIAL"

attempt=0
while true; do
  attempt=$((attempt + 1))
  units=$(fetch_data_usage_units)
  echo "Data units: $units"
  if [[ -n "$units" ]] && awk -v n="$units" 'BEGIN{exit (n+0>0)?0:1}'; then
    log "Step 4: Data verified in Coralogix (units=$units)."
    break
  fi
  if [[ $attempt -ge "$MAX_ATTEMPTS" ]]; then
    err "Step 4: No data received in Coralogix after $MAX_ATTEMPTS attempts (last units=${units:-unknown})."
    exit 1
  fi
  log "Step 4: No data yet (attempt $attempt/$MAX_ATTEMPTS), retrying in 30s..."
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
