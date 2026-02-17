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
  description = "Storage account name (for ARM parameters StorageAccountName / StorageAccountResourceGroup)."
}

output "storage_account_resource_group" {
  value       = azurerm_resource_group.e2e.name
  description = "Resource group of the storage account (for ARM parameter StorageAccountResourceGroup)."
}

output "blob_container_name" {
  value       = azurerm_storage_container.logs.name
  description = "Blob container name for ARM parameter BlobContainerName and uploading test payload."
}

output "storage_account_connection_string" {
  value       = azurerm_storage_account.blob.primary_connection_string
  description = "Storage account connection string for uploading test blob."
  sensitive   = true
}
