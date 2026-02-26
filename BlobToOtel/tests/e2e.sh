#!/usr/bin/env bash
#
# E2E test for BlobToOtel Azure Function.
#
# Order of execution:
#   1. Provision Azure resources with Terraform (prereqs + Event Hub consumer group).
#   2. Deploy ARM template (latest master) via Azure CLI with explicit parameters from step 1.
#   3. Send a test payload (upload a blob to trigger the function).
#   4. Wait 30s, then poll Coralogix Get Logs Count API until count > 0 (retry every 30s, up to 10 times).
#   5. Clean up all resources.
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login).
#   - Terraform >= 1.7.4.
#   - jq (for parsing Coralogix API response).
#   - Environment variables (or export before running):
#     - OTEL_ENDPOINT (required) – OTLP endpoint URL, e.g. https://ingress.coralogix.com
#     - CORALOGIX_QUERY_API_KEY or CORALOGIX_API_KEY – for Step 4 verification (Data Usage read permission).
#     - Optional: CORALOGIX_DIRECT_MODE, CORALOGIX_APPLICATION, CORALOGIX_SUBSYSTEM
#
# Usage:
#   export OTEL_ENDPOINT="https://ingress.eu1.coralogix.com"
#   ./e2e.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="${SCRIPT_DIR}/terraform"
ARM_TEMPLATE_URI="https://raw.githubusercontent.com/coralogix/coralogix-azure-serverless/master/BlobToOtel/ARM/BlobToOtel.json"

# Required
: "${OTEL_ENDPOINT:?Set OTEL_ENDPOINT (e.g. https://ingress.coralogix.com)}"

CX_SUBSYS="${CORALOGIX_SUBSYSTEM:-blob-storage-eventhub-e2e}"
CORALOGIX_QUERY_API_KEY="${CORALOGIX_QUERY_API_KEY:-${CORALOGIX_API_KEY}}"
CX_APP="${CORALOGIX_APPLICATION:-azure}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
err() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: $*" >&2; }

cleanup_after_failure() {
  log "Cleaning up after failure..."
  if [[ -n "${RG_NAME:-}" ]]; then
    az group delete --name "$RG_NAME" --yes --no-wait 2>/dev/null || true
  fi
}
trap cleanup_after_failure EXIT

# --- Step 1: Provision with Terraform ---
log "Step 1: Provisioning Azure resources with Terraform (prereqs + Event Hub consumer group)..."
cd "$TERRAFORM_DIR"
terraform init -input=false
terraform apply -input=false -auto-approve

RG_NAME=$(terraform output -raw resource_group_name)
STORAGE_ACCOUNT=$(terraform output -raw storage_account_name)
STORAGE_RG=$(terraform output -raw storage_account_resource_group)
CONTAINER_NAME=$(terraform output -raw blob_container_name)
EVENTHUB_NAMESPACE=$(terraform output -raw eventhub_namespace)
EVENTHUB_NAME=$(terraform output -raw eventhub_name)
EVENTHUB_RG=$(terraform output -raw eventhub_resource_group)
EVENTHUB_CONSUMER_GROUP=$(terraform output -raw eventhub_consumer_group_name)
STORAGE_CONNECTION_STRING=$(terraform output -raw storage_account_connection_string)

log "Terraform outputs: RG=$RG_NAME, Storage=$STORAGE_ACCOUNT, Container=$CONTAINER_NAME, EventHub=$EVENTHUB_NAMESPACE/$EVENTHUB_NAME, ConsumerGroup=$EVENTHUB_CONSUMER_GROUP"

# --- Step 2: Deploy ARM template (latest master) with explicit parameters ---
log "Step 2: Deploying ARM template from master with explicit parameters..."
PARAMS_FILE="${SCRIPT_DIR}/arm-params.json"
# Build parameters JSON with explicit values (no defaults); escape quotes in values.
build_param() { echo "\"$1\": { \"value\": \"$(echo "$2" | sed 's/\\/\\\\/g; s/"/\\"/g')\" }"; }
{
  echo '{ "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#", "contentVersion": "1.0.0.0", "parameters": {'
  echo "  $(build_param 'OtelEndpoint' "$OTEL_ENDPOINT"),"
  echo "  $(build_param 'CoralogixDirectMode' "${CORALOGIX_DIRECT_MODE:-false}"),"
  echo "  $(build_param 'CoralogixApiKey' "${CORALOGIX_API_KEY:-}"),"
  echo "  $(build_param 'CoralogixApplication' "$CX_APP"),"
  echo "  $(build_param 'CoralogixSubsystem' "$CX_SUBSYS"),"
  echo '  "NewlinePattern": { "value": "(?:\\r\\n|\\r|\\n)" },'
  echo "  $(build_param 'EventHubNamespace' "$EVENTHUB_NAMESPACE"),"
  echo "  $(build_param 'EventHubName' "$EVENTHUB_NAME"),"
  echo "  $(build_param 'EventHubResourceGroup' "$EVENTHUB_RG"),"
  echo "  $(build_param 'StorageAccountName' "$STORAGE_ACCOUNT"),"
  echo "  $(build_param 'StorageAccountResourceGroup' "$STORAGE_RG"),"
  echo "  $(build_param 'PrefixFilter' "${PREFIX_FILTER:-NoFilter}"),"
  echo "  $(build_param 'SuffixFilter' "${SUFFIX_FILTER:-NoFilter}"),"
  echo "  $(build_param 'FunctionAppServicePlanType' "${FUNCTION_APP_SERVICE_PLAN_TYPE:-Consumption}"),"
  echo '  "VirtualNetworkName": { "value": "" },'
  echo '  "SubnetName": { "value": "" },'
  echo '  "VirtualNetworkResourceGroup": { "value": "" },'
  echo '  "NodeHeapSize": { "value": 2048 },'
  echo "  $(build_param 'EventHubConsumerGroup' "$EVENTHUB_CONSUMER_GROUP"),"
  echo '  "MaxElasticWorkerCount": { "value": 5 },'
  echo '  "PremiumPlanSku": { "value": "EP1" }'
  echo '} }'
} > "$PARAMS_FILE"

az deployment group create \
  --resource-group "$RG_NAME" \
  --template-uri "$ARM_TEMPLATE_URI" \
  --parameters "@${PARAMS_FILE}"

rm -f "$PARAMS_FILE"
log "ARM deployment completed."

# --- Step 3: Send test payload (upload blob to trigger function) ---
log "Step 3: Uploading test blob to trigger the function..."
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

attempt=0
while true; do
  attempt=$((attempt + 1))
  count=$(fetch_logs_count)
  if [[ -n "$count" && "$count" -gt 0 ]]; then
    log "Step 4: Logs verified in Coralogix (count=$count)."
    break
  fi
  if [[ $attempt -ge 10 ]]; then
    err "Step 4: No logs received in Coralogix after 10 attempts (last count=${count:-unknown})."
    exit 1
  fi
  log "Step 4: No logs yet (attempt $attempt/10), retrying in 30s..."
  sleep 30
done

# --- Step 5: Clean up ---
log "Step 5: Cleaning up resources..."
trap - EXIT
# Delete the entire resource group (removes Terraform and ARM-created resources).
az group delete --name "$RG_NAME" --yes
log "Waiting for resource group deletion..."
while az group show -n "$RG_NAME" &>/dev/null; do sleep 10; done
# Clean Terraform state so next run can provision from scratch.
cd "$TERRAFORM_DIR"
while read -r state_key; do
  [[ -z "$state_key" ]] && continue
  terraform state rm "$state_key" 2>/dev/null || true
done < <(terraform state list 2>/dev/null || true)
log "E2E test finished."
