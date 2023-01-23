# Azure EventHub Trigger Function for Coralogix

Coralogix provides a seamless integration with ``Azure`` cloud so you can send your logs from anywhere and parse them according to your needs.

## Prerequisites

* An Azure account with an active subscription.

* An active Eventhub Namespace with an Hub Named ``coralogix``

* [Azure Functions Core Tools](https://docs.microsoft.com/en-us/azure/azure-functions/functions-run-local#v2) version 4.x.

* [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) version 2.44.0 or later.

* [Node.js](https://nodejs.org/) version 16.

## General

**Private Key** – A unique ID which represents your company, this Id will be sent to your mail once you register to *Coralogix*.

**Application Name** – The name of your main application, for example, a company named *“SuperData”* would probably insert the *“SuperData”* string parameter or if they want to debug their test environment they might insert the *“SuperData– Test”*.

**SubSystem Name** – Your application probably has multiple subsystems, for example: Backend servers, Middleware, Frontend servers etc. in order to help you examine the data you need, inserting the subsystem parameter is vital.

## Installation

Clone this repo:

```bash
$ git clone https://github.com/coralogix/coralogix-azure-serverless.git
$ cd coralogix-azure-serverless/EventHub
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
# SAS Policy "Connection String" of EventHub Instance or Namespace
export EVENTHUB_SAS_POLICY_CONNECTION_STRING='<YOUR_AZURE_SAS_POLICY_CONNECTION_STRING>'
# Private key for Coralogix
export CORALOGIX_PRIVATE_KEY='<YOUR_PRIVATE_KEY>'
# Name of Azure EventHub to monitor
export AZURE_EVENTHUB_NAME='<YOUR_AZURE_EVENTHUB_NAME>'
# Replace the placeholder YOUR_EVENTHUB value in the function.json file
sed -i "s/YOUR_EVENTHUB/$AZURE_EVENTHUB_NAME/g" EventHub/function.json
# Desired Application name and Subsystem name for ingested EventHub messages
export CORALOGIX_APP_NAME=YOUR_APP_NAME
export CORALOGIX_SUB_SYSTEM=YOUR_SUB_SYSTEM_NAME

make install
make configure
make publish
```

The ``<YOUR_AZURE_SAS_POLICY_CONNECTION_STRING>`` should be replaced with ``Event Hub`` connection string which you can find in ``Event Hub`` -> ``Shared access policies`` -> ``Select a SAS policy`` -> ``Connection string-primary key``.
It should looks like:

```
Endpoint=sb://eventhub1.servicebus.windows.net/;SharedAccessKeyName=sas1;SharedAccessKey=TBAfq6...QLwrdeFFE=
```

Check sections below to find more information about configuration.

## EventHub

There are no additional configuration options available nor required at this time.
