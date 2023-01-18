# Azure BlobStorage Trigger Function for Coralogix

Coralogix provides a seamless integration with ``Azure`` cloud so you can send your logs from anywhere and parse them according to your needs.

## Prerequisites

* An Azure account with an active subscription.

* [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) version 2.4 or later.

* [Node.js](https://nodejs.org/).

## General
**AZURE_STORAGE_CONNECTION** - Storage Account Connection String of the location of the logs to send to coralogix. Go to you ``Storage Account`` -> ``<your logs storage account`` -> ``Access Keys`` -> ``key1`` -> ``Connection String``.

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
$ cd coralogix-azure-serverless/BlogStorage
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
$ export AZURE_FUNCTION_NAME=crxblob$(echo $RANDOM|head -c 5;echo;) # default is 'crxhub'
$ export AZURE_RESOURCE_GROUP=crxrg$(echo $RANDOM|head -c 5;echo;) # default is 'crxrg'
$ export AZURE_STORAGE_CONNECTION="<your_storage_account_primary_connection_string>" # not optional, be sure to use quotation marks for the export to work
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

## BlobStorage

By default ``BlobStorage`` function will be triggered when you'll upload files to ``logs`` container in your ``Storage Account``. You can change this to your custom container name in file ``BlobStorage/function.json`` (``bindings.path`` parameter):

```json
{
  "scriptFile": "../dist/BlobStorage/index.js",
  "disabled": false,
  "bindings": [
    {
      "name": "blob",
      "type": "blobTrigger",
      "direction": "in",
      "path": "<YOUR_CONTAINER_NAME>/{name}",
      "connection":"InputStorage"
    }
  ]
}
```

If you store multiline data, just export ``NEWLINE_PATTERN`` environment variable with regex for line splitting and execute:

```bash
make configure
```

After that your separate lines will be joined correctly.
