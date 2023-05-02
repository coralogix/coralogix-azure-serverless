# Azure Diagnostic Data Function for Coralogix

Coralogix provides a seamless integration with ``Azure`` cloud so you can send your Logs and Metrics from Azure Resources and parse them according to your needs.

The Azure Diagnostic Data integration allows processing of Logs and Metrics submitted to an EventHub using Resources' "Diagnostic Settings" configuration.

## Prerequisites

* An Azure account with an active subscription.

* A configured EventHub Instance to monitor.

## Azure Resource Manager Template Deployment

The Diagnostic Data integration can be deployed by clicking the link below and signing into your Azure account:
[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fcoralogix%2Fcoralogix-azure-serverless%2Fmaster%2FDiagnosticData%2FARM%2FDiagnosticData.json)

## Terraform Deployment

The Diagnostic Data integration can also be deployed using our Terraform module found here:
[Terraform Module](https://registry.terraform.io/modules/coralogix/azure/coralogix/latest)

## Fields

**Subscription** - The Azure Subscription into which you wish to deploy the integration (Must be the same as the monitored Event Hub Namespace).

**Resource Group** - The Resource Group into which you wish to deploy the integration.

**Coralogix Region** - The region of the Coralogix account.

**Coralogix Private Key** – Can be found in your Coralogix account under Settings -> Send your logs. It is located in the upper left corner.

**Coralogix Application** – A mandatory metadata field that is sent with each log and helps to classify it.

**Coralogix Subsystem** – A mandatory metadata field that is sent with each log and helps to classify it.

**Eventhub Resource Group** - The name of the Resource Group that contains the EventHub.

**EventHub Namespace** - The name of the EventHub Namespace.

**EventHub Instance Name** - The name of the EventHub Instance to be monitored.

**Eventhub Shared Access Policy Name** - The name of a Shared Access Policy of the Eventhub Namespace with Listen claims.

**Function App Service Plan Type** - The type of the Function App Service Plan. Choose Premium if you need vNet Support.
