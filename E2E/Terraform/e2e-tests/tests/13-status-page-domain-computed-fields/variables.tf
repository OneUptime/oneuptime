variable "oneuptime_url" {
  type        = string
  description = "OneUptime API URL"
}

variable "api_key" {
  type        = string
  description = "OneUptime API Key"
  sensitive   = true
}

variable "project_id" {
  type        = string
  description = "OneUptime Project ID"
}

variable "domain_name" {
  type        = string
  description = "Domain name for testing"
  default     = "computed-fields-test.example.com"
}

variable "status_page_name" {
  type        = string
  description = "Status page name for testing"
  default     = "Computed Fields Test Status Page"
}

variable "subdomain" {
  type        = string
  description = "Subdomain for the status page domain"
  default     = "status"
}
