# EventHub E2E tests

End-to-end test for the EventHub Azure Function: provision Event Hub resources with Terraform, deploy the function via ARM (latest master), send test events to the Event Hub to trigger the function, verify logs in Coralogix, then clean up.

## Flow

1. **Provision** – Terraform creates resource group, Event Hub namespace, Event Hub instance, consumer group, and two namespace-level authorization rules (listen for the function, send for the test script).
2. **ARM deploy** – The [EventHub ARM template](https://raw.githubusercontent.com/coralogix/coralogix-azure-serverless/master/EventHub/ARM/EventHubV2.json) is deployed with Azure CLI. It creates the function app (and its storage, plan, App Insights) in the same resource group; parameters are set from the resources created in step 1.
3. **Test payload** – A small script sends one or more test events to the Event Hub; the function is triggered and forwards logs to Coralogix (OTLP).
4. **Verify** – After 30s the script polls the Coralogix Get Logs Count API (last 10 min, 10m resolution) for `app=azure`, `subsystem=eventhub-e2e`. If count is 0, it retries every 30s up to 10 times; if count > 0, it proceeds. Requires an API key with Data Usage read permission.
5. **Cleanup** – Resource group is deleted and Terraform state is cleared.

## Prerequisites

- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed.
- [Terraform](https://www.terraform.io/downloads) >= 1.7.4.
- [jq](https://jqlang.github.io/jq/) (for Step 4 verification).
- Python 3 with [azure-eventhub](https://pypi.org/project/azure-eventhub/) for sending events. On macOS (Homebrew Python) use a virtual environment to avoid "externally-managed-environment":
  ```bash
  cd EventHub/tests
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt
  ```
  Then run `./e2e.sh` with the venv still activated.

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
# export CORALOGIX_SUBSYSTEM=eventhub-e2e

./e2e.sh
```

## Terraform

The `terraform/` directory contains a root module that:

- Creates a resource group and an **Event Hub namespace** (Standard SKU).
- Creates an **Event Hub** instance and a **consumer group** for the Coralogix function.
- Creates two **namespace-level authorization rules**:
  - `coralogix-e2e-listen` – listen only (used by the ARM-deployed function).
  - `e2e-send` – send only (used by the e2e script to send test events).

Dependent resources are deployed via Terraform; the function app itself is deployed via the ARM template (same pattern as [terraform-coralogix-azure EventHub module](https://github.com/coralogix/terraform-coralogix-azure/tree/master/modules/eventhub)).

## Verifying logs in Coralogix (Get Logs Count API)

To check that logs arrived for the e2e app/subsystem, use the [Get Logs Count](https://docs.coralogix.com/api-reference/latest/data-usage-service/get-logs-count) API:

```bash
FROM_DATE=$(date -u -v-1H +%Y-%m-%dT%H:%M:%S.000Z)
TO_DATE=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

curl -s -G "https://api.eu2.coralogix.com/mgmt/openapi/latest/dataplans/data-usage/v2/logs:count" \
  --data-urlencode "date_range.fromDate=$FROM_DATE" \
  --data-urlencode "date_range.toDate=$TO_DATE" \
  --data-urlencode "resolution=1h" \
  --data-urlencode "filters.application=azure" \
  --data-urlencode "filters.subsystem=eventhub-e2e" \
  --data-urlencode "subsystem_aggregation=true" \
  -H "Authorization: Bearer $CX_API_KEY"
```

Use the same region as your OTEL endpoint (e.g. `api.eu2.coralogix.com` for EU2). The API key needs Data Usage read permission.
