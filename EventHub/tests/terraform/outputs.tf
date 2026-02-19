output "resource_group_name" {
  value       = azurerm_resource_group.e2e.name
  description = "Resource group name for ARM deployment and cleanup."
}

output "resource_group_location" {
  value       = azurerm_resource_group.e2e.location
  description = "Resource group location."
}

output "eventhub_namespace" {
  value       = azurerm_eventhub_namespace.ns.name
  description = "Event Hub namespace (for ARM parameter EventhubNamespace)."
}

output "eventhub_name" {
  value       = azurerm_eventhub.hub.name
  description = "Event Hub instance name (for ARM parameter EventhubInstanceName)."
}

output "eventhub_resource_group" {
  value       = azurerm_resource_group.e2e.name
  description = "Resource group of the Event Hub (for ARM parameter EventhubResourceGroup)."
}

output "eventhub_consumer_group_name" {
  value       = azurerm_eventhub_consumer_group.coralogix.name
  description = "Event Hub consumer group name (for ARM parameter EventhubConsumerGroup)."
}

output "eventhub_shared_access_key_name" {
  value       = azurerm_eventhub_namespace_authorization_rule.listen.name
  description = "Event Hub namespace authorization rule name for listen (for ARM parameter EventhubSharedAccessKeyName)."
}

# Connection string for sending test events (namespace send rule + EntityPath for the hub)
output "eventhub_send_connection_string" {
  value       = "${azurerm_eventhub_namespace_authorization_rule.send.primary_connection_string};EntityPath=${azurerm_eventhub.hub.name}"
  description = "Connection string for sending events to the Event Hub (used by e2e script)."
  sensitive   = true
}
