# Prerequisites for BlobToOtel: resource group, storage account, container,
# Event Hub, Event Grid subscription (storage blob created -> Event Hub),
# and an Event Hub consumer group for the ARM-deployed function.

terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.93"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.4"
    }
  }
}

provider "azurerm" {
  features {}
}

locals {
  name_prefix = "blobtootel-e2e"
  location    = "westeurope"
}

# Single resource group for the e2e test (prereqs; function is deployed via ARM)
resource "azurerm_resource_group" "e2e" {
  name     = "${local.name_prefix}-rg"
  location = local.location
}

# Storage account for blob container (source of log blobs)
resource "azurerm_storage_account" "blob" {
  name                     = lower(replace("${local.name_prefix}st${random_string.suffix.result}", "-", ""))
  resource_group_name      = azurerm_resource_group.e2e.name
  location                 = azurerm_resource_group.e2e.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
}

resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

resource "azurerm_storage_container" "logs" {
  name                  = "logs"
  storage_account_name  = azurerm_storage_account.blob.name
  container_access_type = "private"
}

# Event Hub namespace and hub (destination for blob-created events)
resource "azurerm_eventhub_namespace" "ns" {
  name                = "${local.name_prefix}-ehns-${random_string.suffix.result}"
  location            = azurerm_resource_group.e2e.location
  resource_group_name = azurerm_resource_group.e2e.name
  sku                 = "Standard"
  capacity            = 1
}

resource "azurerm_eventhub" "hub" {
  name                = "blob-events"
  namespace_name      = azurerm_eventhub_namespace.ns.name
  resource_group_name = azurerm_resource_group.e2e.name
  partition_count     = 2
  message_retention   = 1
}

# Route blob-created events from storage to Event Hub
resource "azurerm_eventgrid_event_subscription" "storage_to_eventhub" {
  name                 = "${local.name_prefix}-storage-to-eh"
  scope                = azurerm_storage_account.blob.id
  eventhub_endpoint_id = azurerm_eventhub.hub.id
  included_event_types = ["Microsoft.Storage.BlobCreated"]
}

# Consumer group for the ARM-deployed BlobToOtel function
resource "azurerm_eventhub_consumer_group" "blobtootel" {
  name                = "blobtootel-e2e"
  namespace_name      = azurerm_eventhub_namespace.ns.name
  eventhub_name       = azurerm_eventhub.hub.name
  resource_group_name = azurerm_resource_group.e2e.name
}
