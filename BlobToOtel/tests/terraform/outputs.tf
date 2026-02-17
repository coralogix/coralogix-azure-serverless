output "resource_group_name" {
  value       = azurerm_resource_group.e2e.name
  description = "Resource group name for ARM deployment and cleanup."
}

output "resource_group_location" {
  value       = azurerm_resource_group.e2e.location
  description = "Resource group location."
}

output "storage_account_name" {
  value       = azurerm_storage_account.blob.name
  description = "Storage account name (for ARM parameter StorageAccountName)."
}

output "storage_account_resource_group" {
  value       = azurerm_resource_group.e2e.name
  description = "Resource group of the storage account (for ARM parameter StorageAccountResourceGroup)."
}

output "blob_container_name" {
  value       = azurerm_storage_container.logs.name
  description = "Blob container name for uploading test payload."
}

output "eventhub_namespace" {
  value       = azurerm_eventhub_namespace.ns.name
  description = "Event Hub namespace (for ARM parameter EventHubNamespace)."
}

output "eventhub_name" {
  value       = azurerm_eventhub.hub.name
  description = "Event Hub name (for ARM parameter EventHubName)."
}

output "eventhub_resource_group" {
  value       = azurerm_resource_group.e2e.name
  description = "Resource group of the Event Hub (for ARM parameter EventHubResourceGroup)."
}

output "eventhub_consumer_group_name" {
  value       = azurerm_eventhub_consumer_group.blobtootel.name
  description = "Event Hub consumer group name (for ARM parameter EventHubConsumerGroup)."
}

output "storage_account_connection_string" {
  value       = azurerm_storage_account.blob.primary_connection_string
  description = "Storage account connection string for uploading test blob."
  sensitive   = true
}
