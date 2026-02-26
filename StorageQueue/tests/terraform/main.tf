# Prerequisites for StorageQueue E2E: resource group, StorageV2 account, and storage queue.
# The function app is deployed via ARM (e2e.sh). ARM creates its own function storage account
# and uses the queue storage account + queue name from these outputs.

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
  name_prefix = "storagequeue-e2e"
  location    = "canadacentral"
}

# Single resource group for the e2e test (prereqs; function is deployed via ARM into this RG)
resource "azurerm_resource_group" "e2e" {
  name     = "${local.name_prefix}-rg"
  location = local.location
}

resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

# Storage account containing the queue. Must be StorageV2 (general purpose v2) per Coralogix docs.
resource "azurerm_storage_account" "queue" {
  name                     = lower(replace("${local.name_prefix}st${random_string.suffix.result}", "-", ""))
  resource_group_name      = azurerm_resource_group.e2e.name
  location                 = azurerm_resource_group.e2e.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
  account_kind             = "StorageV2"
}

resource "azurerm_storage_queue" "logs" {
  name                 = "coralogix-logs"
  storage_account_name = azurerm_storage_account.queue.name
}
