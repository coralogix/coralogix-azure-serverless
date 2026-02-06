# Blob To Otel

Coralogix provides a seamless integration with ``Azure`` cloud so you can send your logs from anywhere and parse them according to your needs.

`Blob-to-Otel` function sends logs from Azure Blob Storage to Otel Endpoint, using the EventHub trigger.

As an OTLP endpoint, you can configure either otel-collector endpoint or [Coralogix Opentelemetry endpoint](https://coralogix.com/docs/integrations/coralogix-endpoints/#opentelemetry) to send logs directly to the platform.

## Prerequisites

* An Azure account with an active subscription.

* A storage account with event notifications configured with EventHub as a destination.

* An Otel collector endpoint (available for the function app to reach) or Coralogix Opentelemetry endpoint.

## Azure Resource Manager Template Deployment

The BlobToOtel function can be deployed by clicking the link below and signing into your Azure account:

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fcoralogix%2Fcoralogix-azure-serverless%2Fmaster%2FBlobToOtel%2FARM%2FBlobToOtel.json)

## Fields

### Required

**Otel Endpoint** - The OTLP endpoint URL (example: https://my-api-endpoint:443).

**Event Hub Namespace** - The name of the Event Hub namespace.

**Event Hub Name** - The name of the Event Hub to be used as a trigger for the function app.

**Event Hub Resource Group** - The resource group name of the Event Hub namespace.

**Storage Account Name** - The name of the storage account containing the logs to be monitored.

**Storage Account Resource Group** - The resource group name of the storage account containing the Blob container to be monitored.

### Optional

**Coralogix Direct Mode** - Whether to use Coralogix as an OTLP endpoint (default: false).

**Coralogix API Key** - Your Coralogix Send Your Data - API Key. Used in case of using Coralogix as an OTLP endpoint.

**Coralogix Application** - The name of the Application in Coralogix.

**Coralogix Subsystem** - The name of the Subsystem in Coralogix.

**Newline Pattern** - The newline pattern expected within the blob storage documents

**Prefix Filter** - The prefix filter to apply to the blob container. Use 'NoFilter' to not filter by prefix. Wildcards are not allowed. Use the following format `/subfolder1/subfolder2/`.

**Suffix Filter** - The suffix filter to apply to the blob container. Use 'NoFilter' to not filter by suffix. Wildcards are not allowed. Use the following format `.log`.

**Function App Service Plan Type** - The type of the Function App Service Plan. Choose Premium if you need vNet Support or high-volume workloads requiring multiple workers.

**Virtual Network Name** - The name of the Virtual Network to integrate with (leave empty if VNet integration is not needed).

**Subnet Name** - The name of the subnet to integrate with (leave empty if VNet integration is not needed).

**Virtual Network Resource Group** - The resource group name of the Virtual Network (leave empty if VNet integration is not needed).

**Node Heap Size** - Node.js memory limit in MB (default: 2048 MB for Consumption plan). Increase it when processing large files in parallel. Premium EP1 (3.5 GB) or higher required for values above 2048 MB. See [Azure Functions service limits](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale#service-limits) for plan details.

**Event Hub Consumer Group** - The Event Hub consumer group name (default: `$Default`). For production workloads, create a dedicated consumer group to avoid checkpoint conflicts with other services.

**Function App SKU** - The SKU tier for Premium plans (default: `EP1`). Higher tiers (EP2, EP3) provide more memory and CPU for large file processing.

**Max Elastic Worker Count** - Maximum number of workers the function can scale to (default: 5). Increase for high-volume workloads.

## Default Configuration

The ARM template deploys with the following defaults optimized for typical workloads:

- **SKU:** EP1 (3.5 GB RAM, 1 vCore) for Premium plans
- **Max Workers:** 1 (can scale up to 1 instance)
- **Always Ready Instances:** 1 (minimumElasticInstanceCount - one warm instance, no cold starts)
- **Consumer Group:** `$Default` (shared)
- **Event Hub Settings:**
  - `maxEventBatchSize`: 25 events per batch
  - `prefetchCount`: 100 events buffer
  - `maxDegreeOfParallelism`: 4 concurrent blob downloads

### High-Volume Workloads

For scenarios with large files (100MB+) or high throughput (500+ files, multiple GB):
- Recommended: EP2+ SKU, increased workers, dedicated consumer group
- Includes memory tuning, OOM prevention, and cost analysis

## vNet Integration

* The function app will be deployed to a Premium plan and will be integrated with the specified vNet.
* The subnet must be delegated to `Microsoft.Web/serverFarms`. Here is an example of how to delegate a subnet:

```bash
az network vnet subnet update --name <subnet-name> --vnet-name <vnet-name> --resource-group <resource-group-name> --delegations Microsoft.Web/serverFarms
```

UI workflow:

```
Virtual Network > Subnets > [Your Subnet] > Subnet delegation > Microsoft.Web/serverFarms > Save
```

## Performance and Limitations

### File Size Limits

- **Maximum file size:** Limited by Node.js `Buffer.toString()` to ~500MB per file
- Files exceeding this limit will be logged as errors and skipped
- For very large files, consider splitting them before upload

### Scaling
- **Default:** Single worker handles most workloads efficiently
- **High-volume:** Increase `MaxElasticWorkerCount` via ARM parameter for concurrent processing
- **Consumer groups:** Use dedicated consumer groups in production to prevent event loss