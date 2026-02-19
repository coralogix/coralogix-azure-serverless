# StorageQueue E2E tests

End-to-end test for the StorageQueue Azure Function: provision prereqs with Terraform (resource group, StorageV2 account, queue), deploy the function via ARM (latest master), trigger with a JSON message in the queue, then clean up.

## Flow

1. **Provision** – Terraform creates resource group, StorageV2 storage account, and a storage queue. The [terraform-coralogix-azure StorageQueue module](https://github.com/coralogix/terraform-coralogix-azure/tree/master/modules/storagequeue) expects these resources to exist; the ARM template deploys the function and uses the queue’s storage account and queue name.
2. **ARM deploy** – The [StorageQueue ARM template](https://raw.githubusercontent.com/coralogix/coralogix-azure-serverless/master/StorageQueue/ARM/StorageQueue.json) is deployed with Azure CLI. It creates the function app (and its own function storage account), configured with the queue connection string and queue name. The function is triggered by messages in the storage queue.
3. **Test payload** – A JSON message is put into the queue (base64-encoded, as required by Azure Storage Queue). The function processes it and sends the log to Coralogix. Only JSON-formatted queue messages are processed (see [Queue Storage ARM docs](https://coralogix.com/docs/integrations/azure/queue-storage-microsoft-azure-resource-manager/)).
4. **Verify** – After 30s the script polls the Coralogix Get Logs Count API (last 10 min, 10m resolution) for `app=azure`, `subsystem=storage-queue-e2e`. If count is 0, it retries every 30s up to 10 times; if count > 0, it proceeds. Requires an API key with Data Usage read permission.
5. **Cleanup** – Resource group is deleted and Terraform state is cleared.

## Prerequisites

- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed.
- [Terraform](https://www.terraform.io/downloads) >= 1.7.4.
- [jq](https://jqlang.github.io/jq/) (for Step 4 verification).

**Azure login** – The script uses Azure CLI; set service principal env vars for CI or run `az login` before `./e2e.sh`.

## Usage

```bash
export OTEL_ENDPOINT="https://ingress.eu2.coralogix.com"   # Coralogix ingress base URL
export CORALOGIX_API_KEY="..."       # Send your data / Private key (for the function)
export CORALOGIX_QUERY_API_KEY="..." # For Step 4 (Data Usage read); can equal CORALOGIX_API_KEY

# Optional (defaults shown):
# export CORALOGIX_APPLICATION=azure
# export CORALOGIX_SUBSYSTEM=storage-queue-e2e

./e2e.sh
```

## Terraform

The `terraform/` directory creates:

- A resource group for the e2e test (ARM deploys the function into this RG).
- A **StorageV2** (general purpose v2) storage account (required by Coralogix Queue Storage integration).
- A storage queue. The ARM template configures the function with this queue’s storage account and queue name; the function is triggered when messages are added to the queue.

The ARM template creates its own function app storage account and does not use a separate “function” storage account from Terraform.

## Verifying logs in Coralogix (Get Logs Count API)

To check that logs arrived for the e2e app/subsystem, use the [Get Logs Count](https://docs.coralogix.com/api-reference/latest/data-usage-service/get-logs-count) API with `filters.application=azure` and `filters.subsystem=storage-queue-e2e` (or your `CORALOGIX_SUBSYSTEM`). Example:

```bash
FROM_DATE=$(date -u -v-1H +%Y-%m-%dT%H:%M:%S.000Z)
TO_DATE=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

curl -s -G "https://api.eu2.coralogix.com/mgmt/openapi/latest/dataplans/data-usage/v2/logs:count" \
  --data-urlencode "date_range.fromDate=$FROM_DATE" \
  --data-urlencode "date_range.toDate=$TO_DATE" \
  --data-urlencode "resolution=1h" \
  --data-urlencode "filters.application=azure" \
  --data-urlencode "filters.subsystem=storage-queue-e2e" \
  --data-urlencode "subsystem_aggregation=true" \
  -H "Authorization: Bearer $CX_API_KEY"
```

Use the same region as your Coralogix endpoint (e.g. `api.eu2.coralogix.com` for EU2). The API key needs Data Usage read permission.

## Difference from BlobViaEventGrid / BlobToOtel E2E

- **StorageQueue** is triggered by **Storage Queue** messages. Terraform provisions the resource group, the queue’s storage account, and the queue; the ARM template deploys the function with a queue trigger. The test sends a JSON message (base64-encoded) into the queue.
- **BlobViaEventGrid** is triggered by Event Grid (blob created → Event Grid → function). Terraform provisions storage + container; ARM creates the Event Grid subscription.
- **BlobToOtel** is triggered via Event Hub (blob → Event Grid → Event Hub → function). Terraform provisions storage, Event Hub, and consumer group; ARM deploys the function with an Event Hub trigger.
