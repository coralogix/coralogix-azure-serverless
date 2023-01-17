# Configurable exports

export AZURE_REGION ?= eastus
export CORALOGIX_APP_NAME ?= Azure
export CORALOGIX_SUB_SYSTEM ?= StorageQueue
export CORALOGIX_PRIVATE_KEY ?= ""

#  Cluster	                API Endpoint
#  .com	                    https://api.coralogix.com:443/api/v1/logs
#  .us	                    https://api.coralogix.us:443/api/v1/logs
#  .in	                    https://api.app.coralogix.in:443/api/v1/logs
#  .app.eu2.coralogix.com	https://api.eu2.coralogix.com:443/api/v1/logs
#  .app.coralogixsg.com	    https://api.coralogixsg.com:443/api/v1/logs

export CORALOGIX_URL ?= "https://api.coralogix.com:443/api/v1/logs"

# Fixed exports

export AZURE_RESOURCE_GROUP ?= CrlgxRG$(UUID)
export AZURE_FUNCTION_NAME ?= queuefunc$(UUID)
export AZURE_FUNCTION_STORAGE_ACCOUNT ?= storage$(UUID)


functools:
	@npm install -g azure-functions-core-tools@4 --unsafe-perm true

dependencies:
	@npm install

build: dependencies
	@npm run build:production

clean:
	@rm -rf dist

install:
	@echo "Creating Resource Group $(AZURE_RESOURCE_GROUP) in Region: $(AZURE_REGION)"
	az group create \
		--name $(AZURE_RESOURCE_GROUP) \
		--location $(AZURE_REGION)
	@echo "Creating Storage Account $(AZURE_FUNCTION_STORAGE_ACCOUNT)"
	az storage account create \
		--name $(AZURE_FUNCTION_STORAGE_ACCOUNT) \
		--location $(AZURE_REGION) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--sku Standard_LRS
	az functionapp create \
		--name $(AZURE_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--consumption-plan-location $(AZURE_REGION) \
		--runtime node \
		--runtime-version 18 \
		--functions-version 4 \
		--storage-account $(AZURE_FUNCTION_STORAGE_ACCOUNT)

configure:
	echo "Configuring $(AZURE_FUNCTION_NAME)"
	az functionapp config appsettings set \
		--name $(AZURE_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--settings "CORALOGIX_PRIVATE_KEY=$(CORALOGIX_PRIVATE_KEY)" \
		"CORALOGIX_APP_NAME=$(CORALOGIX_APP_NAME)" \
		"CORALOGIX_SUB_SYSTEM=$(CORALOGIX_SUB_SYSTEM)" \
		"AzureWebJobsStorage=$(AZURE_STORAGE_CONNECTION_STRING)" \
		"CORALOGIX_URL=$(CORALOGIX_URL)"

publish: build
	func azure functionapp publish $(AZURE_FUNCTION_NAME) --typescript

all: functools clean install configure publish