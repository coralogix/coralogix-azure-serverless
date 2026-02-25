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

output "eventhub_shared_access_policy_name" {
  value       = azurerm_eventhub_namespace_authorization_rule.listen.name
  description = "Namespace authorization rule name for listen (for ARM parameter EventhubSharedAccessPolicyName)."
}

output "storage_account_name" {
  value       = azurerm_storage_account.diag_source.name
  description = "Storage account name (used to generate diagnostic data via blob uploads)."
}

output "storage_account_connection_string" {
  value       = azurerm_storage_account.diag_source.primary_connection_string
  description = "Storage account connection string for uploading test blobs (triggers transactions → Event Hub)."
  sensitive   = true
}

output "blob_container_name" {
  value       = azurerm_storage_container.uploads.name
  description = "Blob container name for uploads (e2e uploads files here to trigger diagnostic data)."
}
