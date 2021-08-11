export AZURE_REGION ?= westeurope
export AZURE_RESOURCE_GROUP ?= AzureFunctionsCoralogix
export AZURE_FUNCTION_NAME ?= coralogixblob
export AZURE_STORAGE_CONNECTION ?= ""

export CORALOGIX_PRIVATE_KEY ?= ""
export CORALOGIX_APP_NAME ?= Azure
export CORALOGIX_SUB_SYSTEM ?= blob
export NEWLINE_PATTERN ?= (?:\r\n|\r|\n)

functools:
	@npm install -g azure-functions-core-tools@3 --unsafe-perm true

dependencies:
	@npm install

build: dependencies
	@npm run build:production

clean:
	@rm -rf dist

install:
	@az group create \
		--name $(AZURE_RESOURCE_GROUP) \
		--location $(AZURE_REGION)
	@az storage account create \
		--name $(AZURE_FUNCTION_NAME)storage \
		--location $(AZURE_REGION) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--sku Standard_LRS
	@az functionapp create \
		--name $(AZURE_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--consumption-plan-location $(AZURE_REGION) \
		--runtime node \
		--runtime-version 12 \
		--functions-version 3 \
		--storage-account $(AZURE_FUNCTION_NAME)storage

configure:
	@az functionapp config appsettings set \
		--name $(AZURE_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--settings "CORALOGIX_PRIVATE_KEY=$(CORALOGIX_PRIVATE_KEY)" "CORALOGIX_APP_NAME=$(CORALOGIX_APP_NAME)" "CORALOGIX_SUB_SYSTEM=$(CORALOGIX_SUB_SYSTEM)" "NEWLINE_PATTERN=$(NEWLINE_PATTERN)" "AzureWebJobsInputStorage=$(AZURE_STORAGE_CONNECTION)"

publish: build
	@func azure functionapp publish $(AZURE_FUNCTION_NAME)

all: functools clean install configure publish