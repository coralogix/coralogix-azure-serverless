# Prerequisites for DiagnosticData E2E: resource group, Event Hub namespace, Event Hub instance,
# namespace-level authorization rules (listen for function, send for diagnostic streaming),
# a storage account with a diagnostic setting that streams Transaction metric to the Event Hub,
# and a blob container for triggering storage transactions.
# The function app is deployed via ARM in e2e.sh.
#
# Flow: Upload blobs → storage transactions → Diagnostic Setting streams to Event Hub →
# DiagnosticData function reads from Event Hub → Coralogix.
# See: https://github.com/coralogix/terraform-coralogix-azure/tree/master/modules/diagnosticdata

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
  name_prefix = "cx-diagdata-e2e"
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

# Event Hub namespace (Standard for multiple hubs if needed)
resource "azurerm_eventhub_namespace" "ns" {
  name                = "${local.name_prefix}-ehns-${random_string.suffix.result}"
  location            = azurerm_resource_group.e2e.location
  resource_group_name = azurerm_resource_group.e2e.name
  sku                 = "Standard"
  capacity            = 1
}

# Event Hub instance (Diagnostic Settings stream to a hub like this)
resource "azurerm_eventhub" "hub" {
  name                = "insights-operational-logs"
  namespace_name      = azurerm_eventhub_namespace.ns.name
  resource_group_name = azurerm_resource_group.e2e.name
  partition_count     = 2
  message_retention   = 1
}

# Namespace-level authorization rule: listen (used by the function via ARM EventhubSharedAccessPolicyName)
resource "azurerm_eventhub_namespace_authorization_rule" "listen" {
  name                = "diagnosticdata-e2e-listen"
  namespace_name      = azurerm_eventhub_namespace.ns.name
  resource_group_name = azurerm_resource_group.e2e.name
  listen              = true
  send                = false
  manage              = false
}

# Namespace-level authorization rule: send (used by Azure to stream diagnostic data to Event Hub)
resource "azurerm_eventhub_namespace_authorization_rule" "send" {
  name                = "diagnosticdata-e2e-send"
  namespace_name      = azurerm_eventhub_namespace.ns.name
  resource_group_name = azurerm_resource_group.e2e.name
  listen              = false
  send                = true
  manage              = false
}

# Storage account used to generate diagnostic data (transactions) that stream to Event Hub
resource "azurerm_storage_account" "diag_source" {
  name                     = lower(replace("${local.name_prefix}st${random_string.suffix.result}", "-", ""))
  resource_group_name      = azurerm_resource_group.e2e.name
  location                 = azurerm_resource_group.e2e.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
  account_kind             = "StorageV2"
}

resource "azurerm_storage_container" "uploads" {
  name                  = "uploads"
  storage_account_name  = azurerm_storage_account.diag_source.name
  container_access_type = "private"
}

# Diagnostic setting on the storage account: stream Transaction metric to the Event Hub.
# Uploading blobs generates transactions that Azure will stream to the hub.
resource "azurerm_monitor_diagnostic_setting" "storage_to_eventhub" {
  name                           = "diagdata-e2e-stream-to-eventhub"
  target_resource_id             = azurerm_storage_account.diag_source.id
  eventhub_authorization_rule_id = azurerm_eventhub_namespace_authorization_rule.send.id
  eventhub_name                  = azurerm_eventhub.hub.name

  metric {
    category = "Transaction"
    enabled  = true
  }
}
