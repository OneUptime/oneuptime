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

variable "severity_name" {
  type        = string
  description = "Incident severity name"
  default     = "terraform-crud-test-severity"
}

variable "severity_description" {
  type        = string
  description = "Incident severity description"
  default     = "Initial description for CRUD test"
}

variable "severity_color" {
  type        = string
  description = "Incident severity color"
  default     = "#FFA500"
}

variable "severity_order" {
  type        = number
  description = "Incident severity order"
  default     = 100
}
