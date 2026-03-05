#!/usr/bin/env bash
#
# E2E test for EventHub Azure Function.
#
# Order of execution:
#   1. Provision Azure resources with Terraform (Event Hub namespace, hub, consumer group, auth rules).
#   2. Deploy ARM template (latest master) via Azure CLI with explicit parameters from step 1.
#   2c. Sync function triggers (az resource invoke-action), then wait 15s.
#   3. Send test events to the Event Hub to trigger the function.
#   4. Wait 30s, then poll Coralogix Get Logs Count API until count > 0 (retry every 30s, up to 30 times).
#   5. Clean up all resources.
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login).
#   - Terraform >= 1.7.4.
#   - jq (for parsing Coralogix API response).
#   - Python 3 with azure-eventhub (pip install azure-eventhub) for sending events.
#   - Environment variables (or export before running):
#     - OTEL_ENDPOINT (required) – OTLP endpoint URL, e.g. https://ingress.eu1.coralogix.com
#     - CORALOGIX_API_KEY or CORALOGIX_PRIVATE_KEY – for the function and for Step 4 verification (Data Usage read).
#
# Usage:
#   export OTEL_ENDPOINT="https://ingress.eu1.coralogix.com"
#   export CORALOGIX_API_KEY="your-send-your-data-key"
#   ./e2e.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="${SCRIPT_DIR}/terraform"
ARM_TEMPLATE_URI="https://raw.githubusercontent.com/coralogix/coralogix-azure-serverless/master/EventHub/ARM/EventHubV2.json"

# Required
: "${OTEL_ENDPOINT:?Set OTEL_ENDPOINT (e.g. https://ingress.eu1.coralogix.com)}"
: "${CORALOGIX_API_KEY:?Set CORALOGIX_API_KEY (Send your data / Private key for the function)}"

# For Step 4 verification
CORALOGIX_QUERY_API_KEY="${CORALOGIX_QUERY_API_KEY:-${CORALOGIX_API_KEY}}"
CX_APP="${CORALOGIX_APPLICATION:-azure}"
CX_SUBSYS="${CORALOGIX_SUBSYSTEM:-eventhub-e2e}"

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
log "Step 1: Provisioning Azure resources with Terraform (Event Hub namespace, hub, consumer group, auth rules)..."
cd "$TERRAFORM_DIR"
terraform init -input=false
terraform apply -input=false -auto-approve

RG_NAME=$(terraform output -raw resource_group_name)
EVENTHUB_NAMESPACE=$(terraform output -raw eventhub_namespace)
EVENTHUB_NAME=$(terraform output -raw eventhub_name)
EVENTHUB_RG=$(terraform output -raw eventhub_resource_group)
EVENTHUB_CONSUMER_GROUP=$(terraform output -raw eventhub_consumer_group_name)
EVENTHUB_SAS_KEY_NAME=$(terraform output -raw eventhub_shared_access_key_name)
EVENTHUB_SEND_CONNECTION_STRING=$(terraform output -raw eventhub_send_connection_string)

log "Terraform outputs: RG=$RG_NAME, EventHub=$EVENTHUB_NAMESPACE/$EVENTHUB_NAME, ConsumerGroup=$EVENTHUB_CONSUMER_GROUP"

# --- Step 2: Deploy ARM template (latest master) with explicit parameters ---
# EventHubV2 expects CustomURL as host:port (e.g. ingress.eu1.coralogix.com:443)
CUSTOM_URL="${OTEL_ENDPOINT#*://}"
CUSTOM_URL="${CUSTOM_URL%%/*}"
if [[ "$CUSTOM_URL" != *:* ]]; then
  CUSTOM_URL="${CUSTOM_URL}:443"
fi

log "Step 2: Deploying ARM template from master (EventHub function)..."
PARAMS_FILE="${SCRIPT_DIR}/arm-params.json"
build_param() { echo "\"$1\": { \"value\": \"$(echo "$2" | sed 's/\\/\\\\/g; s/"/\\"/g')\" }"; }
{
  echo '{ "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#", "contentVersion": "1.0.0.0", "parameters": {'
  echo '  "CoralogixRegion": { "value": "Custom" },'
  echo "  $(build_param 'CustomURL' "$CUSTOM_URL"),"
  echo "  $(build_param 'CoralogixPrivateKey' "$CORALOGIX_API_KEY"),"
  echo "  $(build_param 'CoralogixApplication' "$CX_APP"),"
  echo "  $(build_param 'CoralogixSubsystem' "$CX_SUBSYS"),"
  echo "  $(build_param 'EventhubResourceGroup' "$EVENTHUB_RG"),"
  echo "  $(build_param 'EventhubNamespace' "$EVENTHUB_NAMESPACE"),"
  echo "  $(build_param 'EventhubInstanceName' "$EVENTHUB_NAME"),"
  echo "  $(build_param 'EventhubSharedAccessKeyName' "$EVENTHUB_SAS_KEY_NAME"),"
  echo "  $(build_param 'EventhubConsumerGroup' "$EVENTHUB_CONSUMER_GROUP"),"
  echo "  $(build_param 'FunctionAppServicePlanType' "${FUNCTION_APP_SERVICE_PLAN_TYPE:-Consumption}"),"
  echo '  "CoralogixApplicationSelector": { "value": "" },'
  echo '  "CoralogixSubsystemSelector": { "value": "" },'
  echo '  "NewlinePattern": { "value": "(?:\\\\r\\\\n|\\\\r|\\\\n)" },'
  echo '  "BlockingPattern": { "value": "" }'
  echo '} }'
} > "$PARAMS_FILE"

az deployment group create \
  --resource-group "$RG_NAME" \
  --template-uri "$ARM_TEMPLATE_URI" \
  --parameters "@${PARAMS_FILE}"

rm -f "$PARAMS_FILE"
log "ARM deployment completed."

# --- Step 2c: Sync function triggers, then wait before sending data ---
FUNCTION_APP_NAME=$(az webapp list --resource-group "$RG_NAME" --query "[0].name" -o tsv)
log "Step 2c: Syncing function triggers..."
az resource invoke-action -g "$RG_NAME" -n "$FUNCTION_APP_NAME" --action syncfunctiontriggers --resource-type Microsoft.Web/sites
log "Step 2c: Waiting 15s for triggers to register..."
sleep 15

# --- Step 3: Send test events to Event Hub to trigger the function ---
log "Step 3: Sending test event (JSON payload) to Event Hub..."
# Short NYC taxi-style JSON payload (same structure that works with the function)
TEST_MESSAGE='{"vendorID":"5","tpepPickupDateTime":1528119858000,"tpepDropoffDateTime":1528121148000,"passengerCount":2,"tripDistance":4.62,"puLocationId":"186","doLocationId":"230","rateCodeId":1,"storeAndFwdFlag":"N","paymentType":2,"fareAmount":13.5,"extra":0,"mtaTax":0.5,"improvementSurcharge":"0.3","tipAmount":2.86,"tollsAmount":0,"totalAmount":17.16}'
if ! python3 "${SCRIPT_DIR}/send_event.py" "$EVENTHUB_SEND_CONNECTION_STRING" "$TEST_MESSAGE"; then
  err "Failed to send event to Event Hub. Install: pip install azure-eventhub"
  exit 1
fi
log "Sent test event to Event Hub: $EVENTHUB_NAMESPACE/$EVENTHUB_NAME"

# --- Step 4: Verify logs landed in Coralogix (poll Get Logs Count API) ---
CX_API_HOST="${OTEL_ENDPOINT#*://}"
CX_API_HOST="${CX_API_HOST%%:*}"
CX_API_HOST="${CX_API_HOST%%/*}"
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
cd "$TERRAFORM_DIR"
while read -r state_key; do
  [[ -z "$state_key" ]] && continue
  terraform state rm "$state_key" 2>/dev/null || true
done < <(terraform state list 2>/dev/null || true)
log "E2E test finished."
