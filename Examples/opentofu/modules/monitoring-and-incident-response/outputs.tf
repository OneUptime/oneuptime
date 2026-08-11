output "label_id" {
  value       = oneuptime_label.service.id
  description = "ID of the label attached to everything this module manages."
}

output "monitor_ids" {
  value       = { for key, monitor in oneuptime_monitor.service : key => monitor.id }
  description = "Monitor IDs, keyed the same way as var.monitors."
}

output "monitor_slugs" {
  value       = { for key, monitor in oneuptime_monitor.service : key => monitor.slug }
  description = "Server-generated monitor slugs, keyed the same way as var.monitors."
}

output "on_call_policy_id" {
  value       = var.create_on_call_policy ? oneuptime_on_call_policy.service[0].id : null
  description = "ID of the created on-call policy, or null when create_on_call_policy is false."
}

output "escalation_rule_id" {
  value       = var.create_on_call_policy ? oneuptime_escalation_rule.primary[0].id : null
  description = "ID of the created escalation rule, or null when create_on_call_policy is false."
}

output "status_page_id" {
  value       = var.create_status_page ? oneuptime_status_page.service[0].id : null
  description = "ID of the created status page, or null when create_status_page is false."
}

output "status_page_group_id" {
  value       = var.create_status_page ? oneuptime_status_page_group.service[0].id : null
  description = "ID of the created status page group, or null when create_status_page is false."
}
