variable "oneuptime_url" {
  type        = string
  description = "OneUptime API URL"
}

variable "api_key" {
  type        = string
  description = "OneUptime API Key"
  sensitive   = true
}

# The test account's own address (setup-test-account.sh): someone in the
# project already.
variable "test_user_email" {
  type        = string
  description = "Email address of the test account"
}
