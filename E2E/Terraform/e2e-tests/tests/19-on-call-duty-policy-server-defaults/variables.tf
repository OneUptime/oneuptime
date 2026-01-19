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
