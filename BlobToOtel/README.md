# Blob To Otel

Coralogix provides a seamless integration with ``Azure`` cloud so you can send your logs from anywhere and parse them according to your needs.

`Blob-to-Otel` function sends logs from Azure Blob Storage to Otel Endpoint, using the EventHub trigger.

As an OTLP endpoint, you can configure either otel-collector endpoint or [Coralogix Opentelemetry endpoint](https://coralogix.com/docs/integrations/coralogix-endpoints/#opentelemetry) to send logs directly to the platform.

## Prerequisites

* An Azure account with an active subscription.

* A storage account with event notifications configured with EventHub as a destination.

* An Otel collector endpoint (available for the function app to reach) or Coralogix Opentelemetry endpoint.

## Azure Resource Manager Template Deployment

The BlobStorage Via Eventgrid trigger integration can be deployed by clicking the link below and signing into your Azure account:

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fcoralogix%2Fcoralogix-azure-serverless%2Fmaster%2FBlobToOtel%2FARM%2FBlobToOtel.json)

[![Deploy to Azure – Test Link](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fcoralogix%2Fcoralogix-azure-serverless%2Ffeat-cds-1933-otel-shipper%2FBlobToOtel%2FARM%2FBlobToOtel.json)

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

**Function App Service Plan Type** - The type of the Function App Service Plan. Choose Premium if you need vNet Support.

**Virtual Network Name** - The name of the Virtual Network to integrate with (leave empty if VNet integration is not needed).

**Subnet Name** - The name of the subnet to integrate with (leave empty if VNet integration is not needed).

**Virtual Network Resource Group** - The resource group name of the Virtual Network (leave empty if VNet integration is not needed).

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
