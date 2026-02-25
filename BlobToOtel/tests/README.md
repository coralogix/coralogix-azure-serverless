# BlobToOtel E2E tests

End-to-end test for the BlobToOtel Azure Function: provision prereqs + Event Hub consumer group with Terraform, deploy the function via ARM (latest master), trigger with a test blob, then clean up.

## Flow

1. **Provision** – Terraform creates resource group, storage account, container, Event Hub, Event Grid subscription (blob created → Event Hub), and an Event Hub consumer group for the function.
2. **ARM deploy** – The [BlobToOtel ARM template](https://raw.githubusercontent.com/coralogix/coralogix-azure-serverless/master/BlobToOtel/ARM/BlobToOtel.json) is deployed with Azure CLI; all parameters are set explicitly from the resources created in step 1 (including the consumer group name).
3. **Test payload** – A small blob is uploaded to the container; Event Grid sends the event to Event Hub and the function runs.
4. **Verify** – After 30s the script polls the Coralogix Get Logs Count API (last 10 min, 10m resolution) for app=azure, subsystem=blob-storage-logs. If count is 0, it retries every 30s up to 10 times; if count &gt; 0, it proceeds. Requires an API key with Data Usage read permission.
5. **Cleanup** – Resource group is deleted and Terraform state is cleared.

## Prerequisites

- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed.
- [Terraform](https://www.terraform.io/downloads) >= 1.7.4.
- [jq](https://jqlang.github.io/jq/) (for Step 4 verification).

**Azure login** – The script logs in automatically if you set:

- **Service principal** (CI/non-interactive): `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`
- **Managed identity** (e.g. running inside Azure): `AZURE_USE_MANAGED_IDENTITY=1`

Otherwise run `az login` once before `./e2e.sh`.

## Usage

```bash
export OTEL_ENDPOINT="https://ingress.eu1.coralogix.com"   # or your OTLP endpoint
export CORALOGIX_QUERY_API_KEY="..." # – for Step 4 (Data Usage read)
export CORALOGIX_API_KEY="..." 

# Optional (defaults shown):
# export CORALOGIX_DIRECT_MODE=false
# export CORALOGIX_APPLICATION=azure
# export CORALOGIX_SUBSYSTEM=blob-storage-logs

./e2e.sh
```

For Coralogix direct mode (OTLP to Coralogix):

```bash
export OTEL_ENDPOINT="https://ingress.coralogix.com"
export CORALOGIX_DIRECT_MODE=true
export CORALOGIX_API_KEY="your-send-your-data-api-key"
export CORALOGIX_QUERY_API_KEY="your-query-api-key" # – for Step 4 (Data Usage read)
./e2e.sh
```

## Terraform

The `terraform/` directory contains a root module that:

- Creates a resource group, storage account, and blob container.
- Creates an Event Hub namespace and Event Hub.
- Creates an Event Grid event subscription so `Microsoft.Storage.BlobCreated` events are sent to the Event Hub.
- Creates an Event Hub consumer group (used by the ARM-deployed function).

All names and the region are hardcoded in `main.tf` for the e2e test.

## Verifying logs in Coralogix (Get Logs Count API)

To check that logs arrived for the e2e app/subsystem, use the [Get Logs Count](https://docs.coralogix.com/api-reference/latest/data-usage-service/get-logs-count) API. Pass the date range as **flat query parameters** (`date_range.fromDate`, `date_range.toDate`) in ISO 8601 format, not as a single JSON object:

```bash
# Last 1 hour; use application/subsystem from e2e (azure / blob-storage-logs)
FROM_DATE=$(date -u -v-1H +%Y-%m-%dT%H:%M:%S.000Z)
TO_DATE=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

curl -s -G "https://api.eu2.coralogix.com/mgmt/openapi/latest/dataplans/data-usage/v2/logs:count" \
  --data-urlencode "date_range.fromDate=$FROM_DATE" \
  --data-urlencode "date_range.toDate=$TO_DATE" \
  --data-urlencode "resolution=1h" \
  --data-urlencode "filters.application=azure" \
  --data-urlencode "filters.subsystem=blob-storage-logs" \
  --data-urlencode "subsystem_aggregation=true" \
  -H "Authorization: Bearer $CX_API_KEY"
```

Use the same region as your OTEL endpoint (e.g. `api.eu2.coralogix.com` for EU2). The API key needs Data Usage read permission (e.g. DataUsage preset).
