variable "oneuptime_url" {
  type        = string
  default     = "https://oneuptime.com"
  description = "OneUptime instance URL. Leave the default for OneUptime Cloud; set your own host when self-hosting."
}

variable "website_url" {
  type        = string
  default     = "https://example.com"
  description = "URL the monitor checks."
}
