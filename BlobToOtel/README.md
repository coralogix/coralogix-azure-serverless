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

**Storage Account Name** - The name of the storage account containing the logs to be monitored.

### Optional

**Storage Account Resource Group** - The resource group name of the storage account containing the Blob container to be monitored. Default: function app's resource group. Must be set if the storage account is not in the same resource group as the function app.

**Function App Service Plan Type** - The type of the Function App Service Plan. Choose Premium if you need vNet Support.

**Coralogix Direct Mode** - Whether to use Coralogix as an OTLP endpoint (default: false).

**Coralogix API Key** - Your Coralogix Send Your Data - API Key. Used in case of using Coralogix as an OTLP endpoint.

**Coralogix Application** - The name of the Application in Coralogix.

**Coralogix Subsystem** - The name of the Subsystem in Coralogix.

**Newline Pattern** - The newline pattern expected within the blob storage documents

**Prefix Filter** - The prefix filter to apply to the blob container. Use 'NoFilter' to not filter by prefix. Wildcards are not allowed. Use the following format `/subfolder1/subfolder2/`.

**Suffix Filter** - The suffix filter to apply to the blob container. Use 'NoFilter' to not filter by suffix. Wildcards are not allowed. Use the following format `.log`.
