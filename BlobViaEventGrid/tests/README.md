# BlobViaEventGrid E2E tests

End-to-end test for the BlobViaEventGrid Azure Function: provision prereqs with Terraform (resource group, StorageV2 account, container), deploy the function via ARM (latest master), trigger with a test blob via Event Grid, then clean up.

## Flow

1. **Provision** – Terraform creates resource group, StorageV2 storage account, and blob container. No Event Hub; Event Grid system topic and subscription are created by the ARM template.
2. **ARM deploy** – The [BlobViaEventGrid ARM template](https://raw.githubusercontent.com/coralogix/coralogix-azure-serverless/master/BlobViaEventGrid/ARM/BlobViaEventGrid.json) is deployed with Azure CLI. It creates the function app and, in the storage resource group, an Event Grid system topic plus an event subscription that sends `Microsoft.Storage.BlobCreated` to the function.
3. **Test payload** – A small blob is uploaded to the container; Event Grid delivers the event to the function, which processes the blob and sends logs to Coralogix (OTLP).
4. **Verify** – After 30s the script polls the Coralogix Get Logs Count API (last 10 min, 10m resolution) for `app=azure`, `subsystem=blob-storage-logs`. If count is 0, it retries every 30s up to 10 times; if count > 0, it proceeds. Requires an API key with Data Usage read permission.
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
export CORALOGIX_API_KEY="..."       # Send your data / Private key (for the function)
export CORALOGIX_QUERY_API_KEY="..." # For Step 4 (Data Usage read); can equal CORALOGIX_API_KEY

# Optional (defaults shown):
# export CORALOGIX_APPLICATION=azure
# export CORALOGIX_SUBSYSTEM=blob-storage-logs

./e2e.sh
```

## Terraform

The `terraform/` directory contains a root module that:

- Creates a resource group, a **StorageV2** (general purpose v2) storage account, and a blob container.
- Does **not** create Event Hub or Event Grid resources; the ARM template creates the Event Grid system topic and event subscription that invoke the function when blobs are created.

All names and the region are hardcoded in `main.tf` for the e2e test.

## Verifying logs in Coralogix (Get Logs Count API)

To check that logs arrived for the e2e app/subsystem, use the [Get Logs Count](https://docs.coralogix.com/api-reference/latest/data-usage-service/get-logs-count) API. Pass the date range as **flat query parameters** (`date_range.fromDate`, `date_range.toDate`) in ISO 8601 format:

```bash
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

Use the same region as your OTEL endpoint (e.g. `api.eu2.coralogix.com` for EU2). The API key needs Data Usage read permission.

## Difference from BlobToOtel E2E

- **BlobViaEventGrid** is triggered by **Event Grid** (blob created → Event Grid system topic → function). Terraform only provisions storage + container; the ARM template creates the Event Grid system topic and subscription.
- **BlobToOtel** is triggered via **Event Hub** (blob created → Event Grid subscription → Event Hub → function). Terraform provisions storage, Event Hub, Event Grid subscription to Event Hub, and a consumer group; the ARM template deploys the function with an Event Hub trigger.
