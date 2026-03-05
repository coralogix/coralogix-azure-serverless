# DiagnosticData E2E tests

End-to-end test for the **Diagnostic Data** Azure Function using real diagnostic settings: a storage account streams its **Transaction** metric to an Event Hub, the function reads from the Event Hub and forwards to Coralogix.

**Note:** These tests are **unstable** by nature. Azure Diagnostic Settings for storage (metrics streamed to Event Hub) can take a long time to populate—sometimes **up to 1 hour**—so runs may succeed or fail intermittently depending on timing.

## Flow

1. **Provision** – Terraform creates:
   - Resource group, Event Hub namespace, Event Hub instance
   - Two namespace auth rules (listen for the function, send for Azure diagnostic streaming)
   - **Storage account** and blob container
   - **Diagnostic setting** on the storage account: stream **Transaction** metric to the Event Hub
2. **ARM deploy** – The [DiagnosticData ARM template](https://raw.githubusercontent.com/coralogix/coralogix-azure-serverless/master/DiagnosticData/ARM/DiagnosticData.json) deploys the function (same resource group).
3. **Trigger data** – The script uploads **5–10 blobs** to the storage account. This generates storage transactions; Azure streams the Transaction metric to the Event Hub via the diagnostic setting; the function is triggered and forwards to Coralogix.
4. **Verify** – After 2 minutes the script polls the Coralogix Get Data Usage API for `app=azure`, `subsystem=diagnosticdata-e2e` (retries every 30s, up to 15 times). Diagnostic data can take 1–2 minutes to appear.
5. **Cleanup** – Resource group is deleted and Terraform state is cleared.

## Prerequisites

- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed.
- [Terraform](https://www.terraform.io/downloads) >= 1.7.4.
- [jq](https://jqlang.github.io/jq/) for Step 4 verification.

No Python or Event Hub SDK is required; the test uses `az storage blob upload` only.

## Usage

```bash
export OTEL_ENDPOINT="https://ingress.eu2.coralogix.com"   # or your Coralogix ingress
export CORALOGIX_API_KEY="..."       # Send your data / Private key (for the function)
export CORALOGIX_QUERY_API_KEY="..." # For Step 4 (Data Usage read); can equal CORALOGIX_API_KEY

# Optional (defaults shown):
# export CORALOGIX_APPLICATION=azure
# export CORALOGIX_SUBSYSTEM=diagnosticdata-e2e
# export NUM_BLOBS=8
# export WAIT_INITIAL=120
# export MAX_ATTEMPTS=15

./e2e.sh
```

## Terraform

The `terraform/` module creates:

- **Resource group** and **Event Hub** namespace + hub (`insights-operational-logs`)
- **Namespace authorization rules**: listen (for the function), send (for diagnostic streaming to Event Hub)
- **Storage account** (StorageV2) and container `uploads`
- **Diagnostic setting** on the storage account: **Transaction** metric → Event Hub (same as in the Azure portal: Metrics → Transaction, Destination → Stream to an event hub)

Dependent resources are deployed via Terraform; the function is deployed via the ARM template.

## Troubleshooting

- **No logs in Coralogix** – Data is sent to `/azure/events/v1`; it may appear as logs (app/subsystem) or in another product area. Check the function’s Application Insights for `Sent messages. Response: 200` vs `4xx` to see if Coralogix accepted the request.
- **Diagnostic data delay** – Diagnostic Settings for blob storage can take a long time to populate (from a few minutes **up to 1 hour**). The tests are inherently unstable for this reason. Increase `WAIT_INITIAL` and `MAX_ATTEMPTS` if needed; occasional failures are expected.
- **Region** – Ensure `OTEL_ENDPOINT` matches your Coralogix region (e.g. `https://ingress.eu2.coralogix.com`).

## References

- [Diagnostic Data: Microsoft Azure Resource Manager (ARM)](https://coralogix.com/docs/integrations/azure/diagnostic-data-microsoft-azure-resource-manager/)
- [terraform-coralogix-azure diagnosticdata module](https://github.com/coralogix/terraform-coralogix-azure/tree/master/modules/diagnosticdata)
