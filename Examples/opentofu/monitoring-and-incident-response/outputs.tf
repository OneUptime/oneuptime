output "storefront_status_page_id" {
  value       = module.storefront.status_page_id
  description = "ID of the storefront status page."
}

output "storefront_monitor_ids" {
  value       = module.storefront.monitor_ids
  description = "Storefront monitor IDs, keyed as they were declared."
}

output "storefront_on_call_policy_id" {
  value       = module.storefront.on_call_policy_id
  description = "ID of the storefront on-call policy."
}

output "internal_tools_monitor_ids" {
  value       = module.internal_tools.monitor_ids
  description = "Internal tooling monitor IDs, keyed as they were declared."
}
