# Configurable exports

export AZURE_REGION ?= southeastasia
export CORALOGIX_APP_NAME ?= Azure
export CORALOGIX_SUB_SYSTEM ?= "BlobViaEventGrid"
export NEWLINE_PATTERN ?= (?:\r\n|\r|\n)

#  Cluster	                API Endpoint
#  .com	                    https://ingress.coralogix.com:443/api/v1/logs
#  .us	                    https://ingress.coralogix.us:443/api/v1/logs
#  .in	                    https://ingress.app.coralogix.in:443/api/v1/logs
#  .app.eu2.coralogix.com	https://ingress.eu2.coralogix.com:443/api/v1/logs
#  .app.coralogixsg.com	    https://ingress.coralogixsg.com:443/api/v1/logs

export CORALOGIX_URL ?= "https://ingress.coralogixsg.com/api/v1/logs"

# Fixed exports
export AZURE_RESOURCE_GROUP ?= CrlgxRG$(UUID)
export AZURE_FUNCTION_NAME ?= blobfunc$(UUID)
export AZURE_FUNCTION_STORAGE_ACCOUNT ?= storage$(UUID)

# Storage account settings (following ARM template pattern)
export STORAGE_ACCOUNT_NAME ?= storage$(UUID)
export STORAGE_ACCOUNT_RESOURCE_GROUP ?= $(AZURE_RESOURCE_GROUP)
export CORALOGIX_PRIVATE_KEY ?= "<CORALOGIX_PRIVATE_KEY>"
export DEBUG_MODE ?= "false"


functools:
	@echo "Will now install: azure-functions-core-tools v4 "
	@npm install -g azure-functions-core-tools@4 --unsafe-perm true

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
	@echo "Creating Resource Group $(AZURE_RESOURCE_GROUP) in Region: $(AZURE_REGION)"
	@az group create \
		--name $(AZURE_RESOURCE_GROUP) \
		--location $(AZURE_REGION)
	@echo "Creating Storage Account $(AZURE_FUNCTION_STORAGE_ACCOUNT) in Region: $(AZURE_REGION)"
	@echo "Will be included in RG: $(AZURE_RESOURCE_GROUP) and have Standard LRS redundency"
	az storage account create \
		--name "$(AZURE_FUNCTION_STORAGE_ACCOUNT)" \
		--location $(AZURE_REGION) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--sku Standard_LRS
	@echo "Will now create the function with the following parameters"
	@echo "Function Name: $(AZURE_FUNCTION_NAME)"
	@echo "Resource Group: $(AZURE_RESOURCE_GROUP)"
	@echo "Consumption Plan Location: $(AZURE_REGION)"
	@echo "Runtime: node Version: 20"
	@echo "Functions Version: 4"
	@echo "Storage-account $(AZURE_FUNCTION_STORAGE_ACCOUNT)"
	az functionapp create \
		--name $(AZURE_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--consumption-plan-location $(AZURE_REGION) \
		--runtime node \
		--runtime-version 20 \
		--functions-version 4 \
		--storage-account $(AZURE_FUNCTION_STORAGE_ACCOUNT)

configure:
	@echo "Configuring the Function Environment"
	@echo "Getting storage account key for $(STORAGE_ACCOUNT_NAME) in resource group $(STORAGE_ACCOUNT_RESOURCE_GROUP)"
	$(eval STORAGE_ACCOUNT_KEY := $(shell az storage account keys list --account-name $(STORAGE_ACCOUNT_NAME) --resource-group $(STORAGE_ACCOUNT_RESOURCE_GROUP) --query '[0].value' --output tsv))
	$(eval BLOB_STORAGE_ACCOUNT_CONNECTION_STRING := DefaultEndpointsProtocol=https;AccountName=$(STORAGE_ACCOUNT_NAME);AccountKey=$(STORAGE_ACCOUNT_KEY);EndpointSuffix=core.windows.net)
	@echo "CORALOGIX_PRIVATE_KEY=$(CORALOGIX_PRIVATE_KEY)"
	@echo "CORALOGIX_APP_NAME=$(CORALOGIX_APP_NAME)"
	@echo "CORALOGIX_SUB_SYSTEM=$(CORALOGIX_SUB_SYSTEM)"
	@echo "NEWLINE_PATTERN=$(NEWLINE_PATTERN)"
	@echo "BLOB_STORAGE_ACCOUNT_CONNECTION_STRING=$(BLOB_STORAGE_ACCOUNT_CONNECTION_STRING)"
	@echo "CORALOGIX_URL=$(CORALOGIX_URL)"
	@echo "DEBUG_MODE=$(DEBUG_MODE)"
	az functionapp config appsettings set \
		--name $(AZURE_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--settings "CORALOGIX_PRIVATE_KEY=$(CORALOGIX_PRIVATE_KEY)" \
		"CORALOGIX_APP_NAME=$(CORALOGIX_APP_NAME)" \
		"CORALOGIX_SUB_SYSTEM=$(CORALOGIX_SUB_SYSTEM)" \
		"NEWLINE_PATTERN=$(NEWLINE_PATTERN)" \
		"BLOB_STORAGE_ACCOUNT_CONNECTION_STRING=$(BLOB_STORAGE_ACCOUNT_CONNECTION_STRING)" \
		"CORALOGIX_URL=$(CORALOGIX_URL)" \
		"DEBUG_MODE=$(DEBUG_MODE)"

publish: build
	@echo "Will now publish the function we created"
	func azure functionapp publish $(AZURE_FUNCTION_NAME) --typescript

deploy: install configure publish

all: functools clean install configure publish
