# Azure EventHub Trigger Function for Coralogix

Coralogix provides a seamless integration with ``Azure`` cloud so you can send your logs from anywhere and parse them according to your needs.

## Prerequisites

* An Azure account with an active subscription.

* The [Azure Functions Core Tools](https://docs.microsoft.com/en-us/azure/azure-functions/functions-run-local#v2) version 3.x.

* [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) version 2.4 or later.

* [Node.js](https://nodejs.org/).

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
$ export AZURE_REGION=centralus
$ export AZURE_FUNCTION_NAME=coralogixhub
$ export AZURE_EVENTHUB_CONNECTION=<YOUR_EVENTHUB_CONNECTION_STRING>

$ export CORALOGIX_PRIVATE_KEY=YOUR_PRIVATE_KEY
$ export CORALOGIX_APP_NAME=APP_NAME
$ export CORALOGIX_SUB_SYSTEM=SUB_NAME

$ make install
$ make configure
$ make publish
```

The ``<YOUR_EVENTHUB_CONNECTION_STRING>`` should be replaced with ``Event Hub`` connection string which you can find in ``Event Hub`` -> ``Shared access policies`` -> ``Selected SAS policy`` -> ``Connection string-primary key``.
It should looks like:

```
Endpoint=sb://eventhub1.servicebus.windows.net/;SharedAccessKeyName=sas1;SharedAccessKey=TBAfq6...QLwrdeFFE=
```

Or if it's a specific Hub access policy:

```
Endpoint=sb://eventhub1.servicebus.windows.net/;SharedAccessKeyName=p1;SharedAccessKey=4yzo4Mcl...A24=;EntityPath=hub
```

Check sections below to find more information about configuration.

## EventHub

By default ``EventHub`` function will be triggered when new events are shipped to the Hub named ``eventHubName`` that is accessed via ``EventHubConnection``. 
Note: if the access policy contains the event hub name, it will override the value in ``eventHubName``.

```json
{
  "scriptFile": "../dist/EventHub/index.js",
  "disabled": false,
  "bindings": [
    {
      "name": "eventHub",
      "type": "eventHubTrigger",
      "direction": "in",
      "cardinality": "many",
      "eventHubName": "hub",
      "connection": "EventHubConnection",
      "consumerGroup": "$Default"
    }
  ]
}
```
