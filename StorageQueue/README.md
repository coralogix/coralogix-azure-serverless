# Azure Storage Queue Trigger Function for Coralogix

Coralogix provides a seamless integration with ``Azure`` cloud so you can send your logs from anywhere and parse them according to your needs.

The Azure Storage Queue integration allows parsing of queue messages in JSON format. Other format messages will not be processed and submitted to the Coralogix platform.

## Prerequisites

* An Azure account with an active subscription.

* [Azure Functions Core Tools](https://docs.microsoft.com/en-us/azure/azure-functions/functions-run-local#v2) version 4

* [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) version 2.44.0

* [Node.js](https://nodejs.org/) version 18

## General

**Private Key** – Can be found in your Coralogix account under Settings -> Send your logs. It is located in the upper left corner.

**Application Name** – A mandatory metadata field that is sent with each log and helps to classify it.

**SubSystem Name** – A mandatory metadata field that is sent with each log and helps to classify it.

## Installation

Clone this repo:

```bash
$ git clone https://github.com/coralogix/coralogix-azure-serverless.git
$ cd coralogix-azure-serverless/StorageQueue
```

Login with Azure cli:

```bash
$ az login
```

Install ``Azure Functions Core Tools``:

```bash
$ make functools
```

Configure (Replace environment variables with appropriate values) and install ``Coralogix`` function for ``Azure Functions``:

```bash
# A Unique Identifier to ensure successful deployment of resources with universally unique requirements
export UUID=$(od -vN "7" -An -tx1 /dev/urandom|tr -d " \n"; echo)
# Storage Account "Connection String"
export AZURE_STORAGE_CONNECTION_STRING=<YOUR_STORAGE_ACCOUNT_CONNECTION_STRING>
# Private key for Coralogix
export CORALOGIX_PRIVATE_KEY=YOUR_PRIVATE_KEY
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

Check sections below to find more information about configuration.

## Storage Queue customization

By default the ``StorageQueue`` function will be triggered when you'll add messages to ``logs`` Storage Queue in your ``Storage Account``. You can change this to your custom container name in file ``StorageQueue/function.json`` (``bindings.queueName`` parameter):

```json
{
  "bindings": [
    {
      "name": "queueItem",
      "type": "queueTrigger",
      "direction": "in",
      "queueName": "logs",
      "connection": "AzureWebJobsStorage"
    }
  ],
  "scriptFile": "../dist/StorageQueue/index.js"
}
```

Review the top of the Makefile for additional environmental variables that you can adjust as needed. Make sure that if you modify the Function name or Azure Storage Account name, that they are globally unique.
