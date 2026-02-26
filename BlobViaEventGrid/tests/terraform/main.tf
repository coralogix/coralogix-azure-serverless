# Prerequisites for BlobViaEventGrid E2E: resource group, StorageV2 account, and blob container.
# Event Grid system topic and subscription are created by the ARM template (deployed in e2e.sh).

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
  name_prefix = "blobviaeg-e2e"
  location    = "canadacentral"
}

# Single resource group for the e2e test (prereqs; function is deployed via ARM)
resource "azurerm_resource_group" "e2e" {
  name     = "${local.name_prefix}-rg"
  location = local.location
}

resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

# Storage account must be StorageV2 (general purpose v2) for Event Grid system topic
resource "azurerm_storage_account" "blob" {
  name                     = lower(replace("${local.name_prefix}st${random_string.suffix.result}", "-", ""))
  resource_group_name      = azurerm_resource_group.e2e.name
  location                 = azurerm_resource_group.e2e.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
  account_kind             = "StorageV2"
}

resource "azurerm_storage_container" "logs" {
  name                  = "logs"
  storage_account_name  = azurerm_storage_account.blob.name
  container_access_type = "private"
}
