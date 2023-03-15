# Azure BlobStorage via EventGrid Trigger Function for Coralogix

Coralogix provides a seamless integration with ``Azure`` cloud so you can send your logs from anywhere and parse them according to your needs.

## Prerequisites

* An Azure account with an active subscription.

* [Azure Functions Core Tools](https://docs.microsoft.com/en-us/azure/azure-functions/functions-run-local#v2) version 4.x.

* [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) version 2.44.0 or later.

* [Node.js](https://nodejs.org/) version 16.

* [Configured EventGrid Subscription](https://learn.microsoft.com/en-us/azure/event-grid/resize-images-on-storage-blob-upload-event?tabs=nodejsv10%2Cazure-cli#create-an-event-subscription) (Done after deploying, but is required)

## General

**Private Key** – A unique ID which represents your company, this Id will be sent to your mail once you register to *Coralogix*.

**Application Name** – The name of your main application, for example, a company named *“SuperData”* would probably insert the *“SuperData”* string parameter or if they want to debug their test environment they might insert the *“SuperData– Test”*.

**SubSystem Name** – Your application probably has multiple subsystems, for example: Backend servers, Middleware, Frontend servers etc. in order to help you examine the data you need, inserting the subsystem parameter is vital.

## Installation

Clone this repo:

```bash
$ git clone https://github.com/coralogix/coralogix-azure-serverless.git
$ cd coralogix-azure-serverless/BlogStorage
```

Login with Azure cli:

```bash
$ az login
```

Set Azure subscription id:
```bash
# If you have more than one Azure subscription assigned to your account, make sure to set where you want to deploy the integration.
# You can get the subscription ID by using the CLI command 'az account list' or via the Azure web UI. 
$ az account set -s SUBSCRIPTION_ID
```

Install ``Azure Functions Core Tools``:

```bash
$ make functools
```

Configure (Replace environment variables with appropriate values) and install ``Coralogix`` function for ``Azure Functions``:

```bash
# A Unique Identifier to ensure successful deployment of resources with universally unique requirements
export UUID=$(od -vN "7" -An -tx1 /dev/urandom|tr -d " \n"; echo)
# Storage Account "Connection String" containing the Blob
export BLOB_STORAGE_ACCOUNT_CONNECTION_STRING='<YOUR_STORAGE_ACCOUNT_CONNECTION_STRING>'
# Private key for Coralogix
export CORALOGIX_PRIVATE_KEY='<YOUR_PRIVATE_KEY>'
# Name of Azure Blob storage container to monitor (MUST be all lowercase)
export AZURE_BLOB_CONTAINER_NAME='<AZURE_BLOB_CONTAINER>'
# Desired Application name and Subsystem name for ingested Storage Queue messages
export CORALOGIX_APP_NAME=YOUR_APP_NAME
export CORALOGIX_SUB_SYSTEM=YOUR_SUB_SYSTEM_NAME

make install
make configure
make publish
```

The ``<YOUR_STORAGE_ACCOUNT_CONNECTION_STRING>`` should be replaced with ``Storage Account`` connection string which you can find in ``Storage Account`` -> ``Access keys`` -> ``Connection string``. It should looks like:

```
DefaultEndpointsProtocol=https;AccountName=YOUR_ACCOUNT;AccountKey=YOUR_ACCOUNT_KEY;EndpointSuffix=core.windows.net
```

After publishing your function, you will need to create and apply an eventgrid subscription to the function per the Azure example below.


Check sections below to find more information about configuration.

## BlobViaEventGrid

By default ``BlobViaEventGrid`` function will be triggered on all files files uploaded to the ``AZURE_BLOB_CONTAINER_NAME`` container in your ``Storage Account``. Filters can be defined within your EventGrid Subscription.

[Azure EventGrid Subscription Example](https://learn.microsoft.com/en-us/azure/event-grid/resize-images-on-storage-blob-upload-event?tabs=nodejsv10%2Cazure-cli#create-an-event-subscription)

If you store multiline data, just export ``NEWLINE_PATTERN`` environment variable with regex for line splitting and execute:

```bash
make configure
```

After that your separate lines will be joined correctly.
