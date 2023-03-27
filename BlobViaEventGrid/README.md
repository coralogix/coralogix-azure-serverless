# Azure BlobStorage via EventGrid Trigger Function for Coralogix

Coralogix provides a seamless integration with ``Azure`` cloud so you can send your logs from anywhere and parse them according to your needs.

The Azure BlobStorage via EventGrid integration allows parsing of Azure Blobs, triggered by an EventGrid subscription notification.

## Prerequisites

* An Azure account with an active subscription.

* [Optional] - Pre-existing Event Grid System Topic aligned with Storagev2/General Purpose V2 storage topic type

## Azure Resource Manager Template Deployment

The BlobStorage Via Eventgrid trigger integration can be deployed by clicking the link below and signing into your Azure account:

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fcoralogix%2Fcoralogix-azure-serverless%2Fmaster%2FBlobViaEventGrid%2FARM%2FBlobViaEventGrid.json)

## Fields

**Subscription** - The Azure Subscription into which you wish to deploy the integration (Must be the same as the monitored storage account).

**Resource Group** - The Resource Group into which you wish to deploy the integration.

**Coralogix Region** - The region of the Coralogix account.

**Coralogix Private Key** – Can be found in your Coralogix account under Settings -> Send your logs. It is located in the upper left corner.

**Coralogix Application** – A mandatory metadata field that is sent with each log and helps to classify it.

**Coralogix Subsystem** – A mandatory metadata field that is sent with each log and helps to classify it.

**Storage Account Name** - The name of the storage account containing the Blob container. Must be of type StorageV2 (general purpose v2).

**Storage Account Resource Group** - The resource group name of the storage account containing the Blob container to be monitored.

**Blob Container Name** - The name of the Blob Container to be monitored.

**Event Grid System Topic Name** - The name of a pre-existing Event Grid System Topic for the storage account containing the blob container, or leave as 'new' to create one.

**Newline Pattern** - The newline pattern expected within the blob storage documents
