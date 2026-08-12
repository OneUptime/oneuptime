output "monitor_id" {
  value       = oneuptime_monitor.homepage.id
  description = "ID of the created monitor."
}

output "monitor_slug" {
  value       = oneuptime_monitor.homepage.slug
  description = "Server-generated slug for the monitor."
}

output "status_page_id" {
  value       = oneuptime_status_page.quickstart.id
  description = "ID of the created status page."
}

output "label_id" {
  value       = oneuptime_label.quickstart.id
  description = "ID of the created label."
}
