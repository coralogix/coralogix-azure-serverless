# Azure BlobStorage via EventGrid Trigger Function for Coralogix

Coralogix provides a seamless integration with ``Azure`` cloud so you can send your logs from anywhere and parse them according to your needs.

The Azure BlobStorage via EventGrid integration allows parsing of Azure Blobs, triggered by an EventGrid subscription notification.

## Prerequisites

* An Azure account with an active subscription.

* [Configured EventGrid Subscription](https://learn.microsoft.com/en-us/azure/event-grid/resize-images-on-storage-blob-upload-event?tabs=nodejsv10%2Cazure-cli#create-an-event-subscription) (Done after deploying, but is required)

## Azure Resource Manager Template Deployment

The BlobStorage Via Eventgrid trigger integration can be deployed by clicking the link below and signing into your Azure account:
[Deploy to Azure](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Fcoralogix%2Fcoralogix-azure-serverless%2FFEAT%2FARM-Deploy%2FBlobViaEventGrid%2FARM%2FBlobViaEventGrid.json)

After deployment is complete, you need to configure and align an EventGrid subscription as detailed in the Microsoft document linked above in the Prerequisites section.

## Guide

**Subscription** - The Azure Subscription into which you wish to deploy the integration.

**Resource Group** - The Resource Group into which you wish to deploy the integration.

**Coralogix URL** - The logs API URL for your Coralogix region.

**Coralogix Private Key** – Can be found in your Coralogix account under Settings -> Send your logs. It is located in the upper left corner.

**Coralogix Application** – A mandatory metadata field that is sent with each log and helps to classify it. (Default: Azure)

**Coralogix Subsystem** – A mandatory metadata field that is sent with each log and helps to classify it. (Default: BlobStorage)

**Blob Storage Connect String** - The Primary Connect String of the Storage Account containing the Blob container to be monitored.

**Blob Container Name** - The name of the Blob Container to be monitored.

**Newline Pattern** - The newline pattern expected within the blob storage documents
