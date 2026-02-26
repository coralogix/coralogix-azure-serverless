# Prerequisites for EventHub E2E: resource group, Event Hub namespace, Event Hub instance,
# consumer group, and authorization rules (listen for the function, send for the test script).
# The function app is deployed via ARM in e2e.sh.

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
  name_prefix = "cx-eventhub-e2e"
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

# Event Hub namespace
resource "azurerm_eventhub_namespace" "ns" {
  name                = "${local.name_prefix}-ehns-${random_string.suffix.result}"
  location            = azurerm_resource_group.e2e.location
  resource_group_name = azurerm_resource_group.e2e.name
  sku                 = "Standard"
  capacity            = 1
}

# Event Hub instance (the hub that receives events; function is triggered from here)
resource "azurerm_eventhub" "hub" {
  name                = "logs"
  namespace_name      = azurerm_eventhub_namespace.ns.name
  resource_group_name = azurerm_resource_group.e2e.name
  partition_count     = 2
  message_retention   = 1
}

# Consumer group for the ARM-deployed EventHub function
resource "azurerm_eventhub_consumer_group" "coralogix" {
  name                = "coralogix-e2e"
  namespace_name      = azurerm_eventhub_namespace.ns.name
  eventhub_name       = azurerm_eventhub.hub.name
  resource_group_name = azurerm_resource_group.e2e.name
}

# Namespace-level authorization rule: listen only (used by the function via ARM)
resource "azurerm_eventhub_namespace_authorization_rule" "listen" {
  name                = "coralogix-e2e-listen"
  namespace_name      = azurerm_eventhub_namespace.ns.name
  resource_group_name = azurerm_resource_group.e2e.name
  listen              = true
  send                = false
  manage              = false
}

# Namespace-level authorization rule: send only (used by e2e script to send test events)
resource "azurerm_eventhub_namespace_authorization_rule" "send" {
  name                = "e2e-send"
  namespace_name      = azurerm_eventhub_namespace.ns.name
  resource_group_name = azurerm_resource_group.e2e.name
  listen              = false
  send                = true
  manage              = false
}
