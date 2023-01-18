export AZURE_REGION ?= westeurope
export AZURE_RESOURCE_GROUP ?= crxRG
export AZURE_FUNCTION_NAME ?= crxblob
export CORALOGIX_APP_NAME ?= azure
export CORALOGIX_SUB_SYSTEM ?= blobstorage
export CORALOGIX_URL ?= "https://api.coralogix.com:443/api/v1/logs" 

functools:
	@npm install -g azure-functions-core-tools@4 --unsafe-perm true

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
		--name "$(AZURE_FUNCTION_NAME)" \
		--location $(AZURE_REGION) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--sku Standard_LRS 
	@az functionapp create \
		--name $(AZURE_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--consumption-plan-location $(AZURE_REGION) \
		--runtime node \
		--runtime-version 16 \
		--functions-version 4 \
		--storage-account $(AZURE_FUNCTION_NAME)

configure:
	@az functionapp config appsettings set \
		--name $(AZURE_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--settings "CORALOGIX_PRIVATE_KEY=$(CORALOGIX_PRIVATE_KEY)" "CORALOGIX_APP_NAME=$(CORALOGIX_APP_NAME)" "CORALOGIX_SUB_SYSTEM=$(CORALOGIX_SUB_SYSTEM)" "NEWLINE_PATTERN=$(NEWLINE_PATTERN)" "InputStorage=$(AZURE_STORAGE_CONNECTION)" "CORALOGIX_URL=$(CORALOGIX_URL)"

publish: build
	@func azure functionapp publish $(AZURE_FUNCTION_NAME) --typescript

deploy: install configure publish

all: functools clean install configure publish
