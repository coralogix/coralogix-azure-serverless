# Configurable exports

export AZURE_REGION ?= westeurope
export CORALOGIX_APP_NAME ?= Azure
export CORALOGIX_SUB_SYSTEM ?= StorageQueue

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
	az group create \
		--name $(AZURE_RESOURCE_GROUP) \
		--location $(AZURE_REGION)
	@echo "Creating Storage Account $(AZURE_FUNCTION_STORAGE_ACCOUNT) in Region: $(AZURE_REGION)"
	az storage account create \
		--name $(AZURE_FUNCTION_STORAGE_ACCOUNT) \
		--location $(AZURE_REGION) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--sku Standard_LRS
	@echo "Will now create the function with the following parameters"
	@echo "Function Name: $(AZURE_FUNCTION_NAME)"
	@echo "Resource Group: $(AZURE_RESOURCE_GROUP)"
	@echo "Consumption Plan Location: $(AZURE_REGION)"
	@echo "Runtime: node Version: 16"
	@echo "Functions Version: 4"
	@echo "Storage-account $(AZURE_FUNCTION_STORAGE_ACCOUNT)"
	az functionapp create \
		--name $(AZURE_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--consumption-plan-location $(AZURE_REGION) \
		--runtime node \
		--runtime-version 16 \
		--functions-version 4 \
		--storage-account $(AZURE_FUNCTION_STORAGE_ACCOUNT)

configure:
	@echo "Configuring the Function Environment"
	@echo "CORALOGIX_PRIVATE_KEY=$(CORALOGIX_PRIVATE_KEY)"
	@echo "CORALOGIX_APP_NAME=$(CORALOGIX_APP_NAME)"
	@echo "CORALOGIX_SUB_SYSTEM=$(CORALOGIX_SUB_SYSTEM)"
	@echo "STORAGE_QUEUE_CONNECT_STRING=$(QUEUE_STORAGE_ACCOUNT_CONNECTION_STRING)"
	@echo "CORALOGIX_URL=$(CORALOGIX_URL)"
	az functionapp config appsettings set \
		--name $(AZURE_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--settings "CORALOGIX_PRIVATE_KEY=$(CORALOGIX_PRIVATE_KEY)" \
		"CORALOGIX_APP_NAME=$(CORALOGIX_APP_NAME)" \
		"CORALOGIX_SUB_SYSTEM=$(CORALOGIX_SUB_SYSTEM)" \
		"STORAGE_QUEUE_CONNECT_STRING=$(QUEUE_STORAGE_ACCOUNT_CONNECTION_STRING)" \
		"CORALOGIX_URL=$(CORALOGIX_URL)"

publish: build
	@echo "Will now publish the function we created"
	func azure functionapp publish $(AZURE_FUNCTION_NAME) --typescript

deploy: install configure publish

all: functools clean install configure publish
