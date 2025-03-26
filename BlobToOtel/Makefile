# Configurable exports

export AZURE_REGION ?= westeurope
export CORALOGIX_APPLICATION ?= Azure
export CORALOGIX_SUBSYSTEM ?= "BlobToOtel"
export NEWLINE_PATTERN ?= (?:\r\n|\r|\n)
export CORALOGIX_DIRECT_MODE ?= false
export PREFIX_FILTER ?= NoFilter
export SUFFIX_FILTER ?= NoFilter
export FUNCTION_APP_SERVICE_PLAN_TYPE ?= Consumption

# Fixed exports

export AZURE_RESOURCE_GROUP ?= CrlgxRG$(UUID)
export AZURE_FUNCTION_NAME ?= blobfunc$(UUID)
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
	@echo "Plan Type: $(FUNCTION_APP_SERVICE_PLAN_TYPE)"
	@echo "Location: $(AZURE_REGION)"
	@echo "Runtime: node Version: 20"
	@echo "Functions Version: 4"
	@echo "Storage-account $(AZURE_FUNCTION_STORAGE_ACCOUNT)"
	az functionapp create \
		--name $(AZURE_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--plan-type $(FUNCTION_APP_SERVICE_PLAN_TYPE) \
		--runtime node \
		--runtime-version 20 \
		--functions-version 4 \
		--storage-account $(AZURE_FUNCTION_STORAGE_ACCOUNT)

configure:
	@echo "Configuring the Function Environment"
	@echo "OTEL_ENDPOINT=$(OTEL_ENDPOINT)"
	@echo "CORALOGIX_DIRECT_MODE=$(CORALOGIX_DIRECT_MODE)"
	@echo "CORALOGIX_API_KEY=$(CORALOGIX_API_KEY)"
	@echo "CORALOGIX_APPLICATION=$(CORALOGIX_APPLICATION)"
	@echo "CORALOGIX_SUBSYSTEM=$(CORALOGIX_SUBSYSTEM)"
	@echo "NEWLINE_PATTERN=$(NEWLINE_PATTERN)"
	@echo "PREFIX_FILTER=$(PREFIX_FILTER)"
	@echo "SUFFIX_FILTER=$(SUFFIX_FILTER)"
	az functionapp config appsettings set \
		--name $(AZURE_FUNCTION_NAME) \
		--resource-group $(AZURE_RESOURCE_GROUP) \
		--settings "OTEL_ENDPOINT=$(OTEL_ENDPOINT)" \
		"CORALOGIX_DIRECT_MODE=$(CORALOGIX_DIRECT_MODE)" \
		"CORALOGIX_API_KEY=$(CORALOGIX_API_KEY)" \
		"CORALOGIX_APPLICATION=$(CORALOGIX_APPLICATION)" \
		"CORALOGIX_SUBSYSTEM=$(CORALOGIX_SUBSYSTEM)" \
		"NEWLINE_PATTERN=$(NEWLINE_PATTERN)" \
		"PREFIX_FILTER=$(PREFIX_FILTER)" \
		"SUFFIX_FILTER=$(SUFFIX_FILTER)"

publish: build
	@echo "Will now publish the function we created"
	func azure functionapp publish $(AZURE_FUNCTION_NAME) --typescript

deploy: install configure publish

all: functools clean install configure publish
