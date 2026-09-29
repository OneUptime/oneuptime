variable "oneuptime_url" {
  type        = string
  description = "OneUptime API URL"
}

variable "api_key" {
  type        = string
  description = "OneUptime API Key"
  sensitive   = true
}


variable "status_name" {
  type        = string
  description = "Monitor status name"
  default     = "terraform-crud-test-status"
}

variable "status_description" {
  type        = string
  description = "Monitor status description"
  default     = "Initial description for CRUD test"
}

variable "status_color" {
  type        = string
  description = "Monitor status color"
  default     = "#00FF00"
}

variable "status_priority" {
  type        = number
  description = "Monitor status priority"
  default     = 100
}
