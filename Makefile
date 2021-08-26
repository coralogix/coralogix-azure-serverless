export AZURE_REGION ?= centralus
export AZURE_RESOURCE_GROUP ?= rg1

export AZURE_FUNCTION_STORAGE_NAME ?= coralogixfuncstorage

export AZURE_BLOB_FUNCTION_NAME ?= coralogixblobfunc
export AZURE_STORAGE_CONNECTION ?= ""

export AZURE_EVENTHUB_FUNCTION_NAME ?= coralogixeventhubfunc
export AZURE_EVENTHUB_CONNECTION ?= ""

export CORALOGIX_PRIVATE_KEY ?= ""
export CORALOGIX_APP_NAME ?= Azure
export CORALOGIX_SUB_SYSTEM ?= FunctionApp
export NEWLINE_PATTERN ?= (?:\r\n|\r|\n)

export CORALOGIX_URL ?= "https://api.coralogix.com:443/api/v1/logs" # Change to .us / .in for other clusters

functools:
	@npm install -g azure-functions-core-tools@3 --unsafe-perm true

dependencies:
	@npm install

build: dependencies
	@npm run build:production

clean:
	@rm -rf dist

pre-install:
	@az group create \
		--name $(AZURE_RESOURCE_GROUP) \
		--location $(AZURE_REGION)
	@az storage account create \
		--name ${AZURE_FUNCTION_STORAGE_NAME} \
		--location $(AZURE_REGION) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--sku Standard_LRS

create-blob:
	@az functionapp create \
		--name $(AZURE_BLOB_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--consumption-plan-location $(AZURE_REGION) \
		--runtime node \
		--runtime-version 12 \
		--functions-version 3 \
		--storage-account ${AZURE_FUNCTION_STORAGE_NAME}

create-eventhub:
	@az functionapp create \
		--name $(AZURE_EVENTHUB_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--consumption-plan-location $(AZURE_REGION) \
		--runtime node \
		--runtime-version 12 \
		--functions-version 3 \
		--storage-account ${AZURE_FUNCTION_STORAGE_NAME}

install: pre-install create-blob create-eventhub

configure: configure-blob configure-eventhub

configure-blob:
	@az functionapp config appsettings set \
		--name $(AZURE_BLOB_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--settings "CORALOGIX_PRIVATE_KEY=$(CORALOGIX_PRIVATE_KEY)" "CORALOGIX_APP_NAME=$(CORALOGIX_APP_NAME)" "CORALOGIX_SUB_SYSTEM=$(CORALOGIX_SUB_SYSTEM)" "AzureWebJobsStorage=$(AZURE_STORAGE_CONNECTION)" "EventHubConnection=$(AZURE_EVENTHUB_CONNECTION)" "CORALOGIX_URL=${CORALOGIX_URL}"

configure-eventhub:
	@az functionapp config appsettings set \
		--name $(AZURE_EVENTHUB_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--settings "CORALOGIX_PRIVATE_KEY=$(CORALOGIX_PRIVATE_KEY)" "CORALOGIX_APP_NAME=$(CORALOGIX_APP_NAME)" "CORALOGIX_SUB_SYSTEM=$(CORALOGIX_SUB_SYSTEM)" "AzureWebJobsStorage=$(AZURE_STORAGE_CONNECTION)" "EventHubConnection=$(AZURE_EVENTHUB_CONNECTION)" "CORALOGIX_URL=${CORALOGIX_URL}"

publish-blob: build
	@func azure functionapp publish $(AZURE_BLOB_FUNCTION_NAME)

publish-eventhub: build
	@func azure functionapp publish $(AZURE_EVENTHUB_FUNCTION_NAME)

publish: publish-blob publish-eventhub

all: functools clean install configure publish