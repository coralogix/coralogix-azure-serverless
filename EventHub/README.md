# Azure EventHub Trigger Function for Coralogix

Coralogix provides a seamless integration with ``Azure`` cloud so you can send your logs from anywhere and parse them according to your needs.

## Prerequisites

* An Azure account with an active subscription.

* An active Eventhub Namespace with an Hub Named ``coralogix``.

* [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) version 2.4 or later.

* [Node.js](https://nodejs.org/).


## General

**AZURE_EVENTHUB_CONNECTION_STRING** - The eventhub namespace primary connection string, which you can find in  ``Event Hub`` -> ``Shared access policies`` -> ``<your_policy>`` -> ``Connection string-primary key``.

**CORALOGIX_PRIVATE_KEY** – A unique ID which represents your company, this Id will be sent to your mail once you register to *Coralogix*. more information can be found [here](https://coralogix.com/docs/private-key/).

**CORALOGIX_APP_NAME** – The name of your main application, for example, a company named *“SuperData”* would probably insert the *“SuperData”* string parameter or if they want to debug their test environment they might insert the *“SuperData– Test”*.

**CORALOGIX_SUB_SYSTEM** – Your application probably has multiple subsystems, for example: Backend servers, Middleware, Frontend servers etc. in order to help you examine the data you need, inserting the subsystem parameter is vital.

**CORALOGIX_URL** – Your coralgix account domain specific endpoint. more information can be found below.


### Coralogix's Endpoints 

Depending on your region, you need to configure correct Coralogix url variable. Here are the available Endpoints:

| Region  | Coralogix Endpoint                          |
|---------|------------------------------------------|
| USA1 (Ohio)   | `https://api.coralogix.us:443/api/v1/logs`      |
| APAC1 (Mumbai)  | `https://api.app.coralogix.in:443/api/v1/logs`  | 
| APAC2 (Singapore)  | `https://api.coralogixsg.com:443/api/v1/logs`   | 
| EUROPE1 (Ireland)| `https://api.coralogix.com:443/api/v1/logs`     | 
| EUROPE2 (Stockholm)| `https://api.eu2.coralogix.com:443/api/v1/logs` | 

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

Install ``Azure Functions Core Tools 4``:

```bash
$ make functools
```
Note: only install the Azure function tools if you dont already have it.  

Configure environment variables with appropriate values and install ``Coralogix`` function for ``Azure Functions``:

```bash
$ export AZURE_REGION=centralus # default is 'westeurope'
$ export AZURE_FUNCTION_NAME=crxhub$(echo $RANDOM|head -c 5;echo;) # default is 'crxhub'
$ export AZURE_RESOURCE_GROUP=crxrg$(echo $RANDOM|head -c 5;echo;) # default is 'crxrg'
$ export AZURE_EVENTHUB_CONNECTION_STRING="<your_eventhub_namespace_primary_connection_string>" # not optional, be sure to use quotation marks for the export to work
$ export CORALOGIX_PRIVATE_KEY=<your_coralogix_secret> # not optional
$ export CORALOGIX_APP_NAME=<your_coralogix_app_name> # default is 'Azure'
$ export CORALOGIX_SUB_SYSTEM=<your_coralogix_subsystem_name> # default is 'eventhub'
$ export CORALOGIX_URL="https://api.coralogix.us:443/api/v1/logs" # default is 'https://api.coralogix.com:443/api/v1/logs'


$ make install
$ make configure
$ make publish
```

Thats it! new events will now trigger the function and be sent to coralogix.  

Check sections below to find more information about configuration.

## Removal


```bash
$ make delete
```

## EventHub

By default ``EventHub`` function will be triggered when new events are shipped to a Hub named 
``coralogix``.

To change the triggering eventhub name change the value of `bindings.eventHubName`.

For example to have the function get trigger by an eventhub called `trigger-eventhub` modify 'function.json' :

```json
{
  "scriptFile": "../dist/EventHub/index.js",
  "disabled": false,
  "bindings": [
    {
      "name": "events",
      "type": "eventHubTrigger",
      "direction": "in",
      "cardinality": "many",
      "eventHubName": "trigger-eventhub",
      "connection": "EventHubConnection",
      "consumerGroup": "$Default"
    }
  ]
}

```
