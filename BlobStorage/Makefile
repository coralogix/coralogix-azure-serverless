export AZURE_REGION ?= westeurope
export AZURE_RESOURCE_GROUP ?= coralogixfunctionRG
export AZURE_FUNCTION_NAME ?= coralogixlogshipper
export AZURE_STORAGE_CONNECTION ?= ""

export CORALOGIX_PRIVATE_KEY ?= ""
export CORALOGIX_APP_NAME ?= azure-function-log-collector
export CORALOGIX_SUB_SYSTEM ?= "$(AZURE_REGION)-function-log-collector"
export NEWLINE_PATTERN ?= (?:\r\n|\r|\n)

# Change to "https://api.coralogix.us:443/api/v1/logs" for US cluster
# Change to "https://api.app.coralogix.in:443/api/v1/logs" for IN cluster
export CORALOGIX_URL ?= "https://api.coralogix.com:443/api/v1/logs" 

functools:
	@echo "Will now install: azure-functions-core-tools v3 "
	@npm install -g azure-functions-core-tools@3 --unsafe-perm true

dependencies:
	@echo "Will now build the dependencies"
	@npm install

build: dependencies
	@echo "Will now build the application with npm"
	@npm run build:production

clean:
	@echo "Will now cleanup dist folder"
	@rm -rf dist

install:
	@echo "Creating Azure RG: $(AZURE_RESOURCE_GROUP) in Region: $(AZURE_REGION)"
	@az group create \
		--name $(AZURE_RESOURCE_GROUP) \
		--location $(AZURE_REGION)
	@echo "Creating Azure Storage account: $(AZURE_FUNCTION_NAME)storage in Region: $(AZURE_REGION)"
	@echo "Will be included in RG: $(AZURE_RESOURCE_GROUP) and have Standard LRS redundency"
	@az storage account create \
		--name "$(AZURE_FUNCTION_NAME)" \
		--location $(AZURE_REGION) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--sku Standard_LRS 
	@echo "Will now create the function with the following parametrs"
	@echo "Function Name: $(AZURE_FUNCTION_NAME)"
	@echo "Resource Group: $(AZURE_RESOURCE_GROUP)"
	@echo "Consumption Plan Location: $(AZURE_REGION)"
	@echo "Runtime: node Version: 12"
	@echo "Functions Version: 3"
	@echo "Storage-account $(AZURE_FUNCTION_NAME)"
	@az functionapp create \
		--name $(AZURE_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--consumption-plan-location $(AZURE_REGION) \
		--runtime node \
		--runtime-version 12 \
		--functions-version 3 \
		--storage-account $(AZURE_FUNCTION_NAME)

configure:
	@echo "Will now Configure the Function Environment"
	@echo "CORALOGIX_PRIVATE_KEY=$(CORALOGIX_PRIVATE_KEY)"
	@echo "CORALOGIX_APP_NAME=$(CORALOGIX_APP_NAME)"
	@echo "CORALOGIX_SUB_SYSTEM=$(CORALOGIX_SUB_SYSTEM)"
	@echo "NEWLINE_PATTERN=\'$(NEWLINE_PATTERN)\'"
	@echo "AzureWebJobsInputStorage=$(AZURE_STORAGE_CONNECTION)"
	@echo "CORALOGIX_URL=$(CORALOGIX_URL)"
	@az functionapp config appsettings set \
		--name $(AZURE_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--settings "CORALOGIX_PRIVATE_KEY=$(CORALOGIX_PRIVATE_KEY)" "CORALOGIX_APP_NAME=$(CORALOGIX_APP_NAME)" "CORALOGIX_SUB_SYSTEM=$(CORALOGIX_SUB_SYSTEM)" "NEWLINE_PATTERN=$(NEWLINE_PATTERN)" "AzureWebJobsInputStorage=$(AZURE_STORAGE_CONNECTION)" "CORALOGIX_URL=$(CORALOGIX_URL)"

publish: build
	@echo "Will now publish the function we created"
	@func azure functionapp publish $(AZURE_FUNCTION_NAME) --typescript

deploy: install configure publish

all: functools clean install configure publish
