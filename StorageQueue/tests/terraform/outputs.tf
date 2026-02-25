output "resource_group_name" {
  value       = azurerm_resource_group.e2e.name
  description = "Resource group name for ARM deployment and cleanup."
}

output "resource_group_location" {
  value       = azurerm_resource_group.e2e.location
  description = "Resource group location."
}

output "storage_account_name" {
  value       = azurerm_storage_account.queue.name
  description = "Storage account name containing the queue (for ARM parameters StorageAccountName / StorageAccountResourceGroup)."
}

output "storage_account_resource_group" {
  value       = azurerm_resource_group.e2e.name
  description = "Resource group of the storage account (for ARM parameter StorageAccountResourceGroup)."
}

output "storage_queue_name" {
  value       = azurerm_storage_queue.logs.name
  description = "Storage queue name (for ARM parameter StorageQueueName and sending test messages)."
}

output "storage_account_connection_string" {
  value       = azurerm_storage_account.queue.primary_connection_string
  description = "Storage account connection string for putting test messages into the queue."
  sensitive   = true
}
