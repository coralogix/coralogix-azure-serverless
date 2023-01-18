# Example - sending azure active directory logs

In this example we will be sending our azure active directory audit logs to coralogix using eventhub function.  

### Step 0 - create an eventhub namespace and a hub

for this example we assume we already created:

* resource group named `resource-group-1`
* eventhub namespace named `monitoring-test`
* eventhub named `audit-logs`

To obtain the connection primary key go inside the eventhub namespace `monitoring-test`:
Under `settings` -> `Shared access policies` -> `RootManageSharedAccessKey` -> `Connection string–primary key`.

### Step 1 - clone the repo and login

```bash
$ git clone https://github.com/coralogix/coralogix-azure-serverless.git
$ cd coralogix-azure-serverless/EventHub
```

Login with Azure cli:

```bash
$ az login
```

### Step 2 - modify function.json

Because our eventhub name is `audit-logs` we need to modify EventHub/function.json .

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
      "eventHubName": "audit-logs",
      "connection": "EventHubConnection",
      "consumerGroup": "$Default"
    }
  ]
}
```

### Step 3 - configuring the environment variables

We can use the provided script `$(echo $RANDOM|head -c 5;echo;)` to generate a 5 digit number.

```bash
$ export AZURE_REGION=centralus
$ export AZURE_FUNCTION_NAME=crxhub$(echo $RANDOM|head -c 5;echo;)
$ export AZURE_RESOURCE_GROUP=crxrg$(echo $RANDOM|head -c 5;echo;)
$ export AZURE_EVENTHUB_CONNECTION_STRING="Endpoint=sb://monitoring-test.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=6cks3GfMNsRciRJsi3OyIETn11OgUDrsuL0zQK1w6QI="
$ export CORALOGIX_PRIVATE_KEY="efd93f02-7563-11ed-a1eb-0242ac120002"
$ export CORALOGIX_APP_NAME=Azure
$ export CORALOGIX_SUB_SYSTEM=audit-logs
$ export CORALOGIX_URL="https://api.coralogix.us:443/api/v1/logs"
```

### Step 4 - install function

```bash
$ make install
$ make configure
$ make publish
```

### Step 5 - send active directory audit to the eventhub

In `Azure Active Directory` create a new diagnostic setting :
`Monitoring` -> `Diagnostic settings` -> `Add diagnostic setting`  

Under 'Logs' we pick `AuditLogs`.
Under 'Destination details' we pick `Stream to an event hub`.  

We select the correct data:
* under 'Event hub namespace' - `monitoring`
* under 'Event hub name' - `audit-logs`
* under 'Event hub policy name' - `RootManageSharedAccessKey`

and 'Save' after we are done.

Thats it, all audit logs from the azure active directory will be sent to our account in coralogix.

### Step 6 - remove eventhub function resources created 

When finished you can remove all the resources that were created

```bash
$ make delete
```