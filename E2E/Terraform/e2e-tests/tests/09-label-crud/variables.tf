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

variable "label_name" {
  type        = string
  description = "Label name"
  default     = "terraform-crud-test-label"
}

variable "label_description" {
  type        = string
  description = "Label description"
  default     = "Initial description for CRUD test"
}

variable "label_color" {
  type        = string
  description = "Label color"
  default     = "#FF0000"
}
