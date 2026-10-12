terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.api_key
}

# Test: a status page's uptime bar color rules - the resource of issue #4719.
#
# A rule's uptime percent is a decimal column. The API answered it as text
# ("uptimePercentGreaterThanOrEqualTo": "100"), the provider read the text as
# null, and every apply failed with "Provider produced inconsistent result
# after apply", leaving the rule tainted.
#
# The update phase: main.tf with two uptime percents and a color changed in
# place - 99.999 -> 99.99 and 99.65 -> 99.5, the bottom rule's color darker.
# verify-update.sh checks the API holds the new numbers, as numbers, and that
# the lookup by uptime percent follows the rule to its new one; the runner
# requires the plan after it to be empty.
#
# The rules are checked from the top down; the first one a day's uptime
# reaches colors its bar.

resource "oneuptime_status_page" "page" {
  name                     = "TF E2E Uptime Bar Colors"
  description              = "Status page whose uptime bars the rules below color"
  page_title               = "Uptime Bar Colors"
  page_description         = "Bar color rules managed by Terraform"
  is_public_status_page    = false
  enable_email_subscribers = false
  enable_sms_subscribers   = false
}

# The reporter's rule, as the issue wrote it.
resource "oneuptime_status_page_history_chart_bar_color" "operational" {
  status_page_id                          = oneuptime_status_page.page.id
  order                                   = 1
  uptime_percent_greater_than_or_equal_to = 100
  bar_color                               = "#86EFAC"
}

# Three decimal places, now two.
resource "oneuptime_status_page_history_chart_bar_color" "nearly" {
  status_page_id                          = oneuptime_status_page.page.id
  order                                   = 2
  uptime_percent_greater_than_or_equal_to = 99.99
  bar_color                               = "#BEF264"
}

# A day with one minute of downtime: more digits than the API keeps, which
# stores the nearest number it can, 99.93055555555556.
resource "oneuptime_status_page_history_chart_bar_color" "one_minute" {
  status_page_id                          = oneuptime_status_page.page.id
  order                                   = 3
  uptime_percent_greater_than_or_equal_to = 100 * (1 - 1 / 1440)
  bar_color                               = "#FDE047"
}

# A decimal: the issue's second failing value, changed.
resource "oneuptime_status_page_history_chart_bar_color" "degraded" {
  status_page_id                          = oneuptime_status_page.page.id
  order                                   = 4
  uptime_percent_greater_than_or_equal_to = 99.5
  bar_color                               = "#F97316"
}

# The bottom rule every day reaches.
resource "oneuptime_status_page_history_chart_bar_color" "offline" {
  status_page_id                          = oneuptime_status_page.page.id
  order                                   = 5
  uptime_percent_greater_than_or_equal_to = 0
  bar_color                               = "#450A0A"
}

# The data source, by id.
data "oneuptime_status_page_history_chart_bar_color" "by_id" {
  id = oneuptime_status_page_history_chart_bar_color.degraded.id
}

# And by the uptime percent itself, a decimal.
data "oneuptime_status_page_history_chart_bar_color" "by_uptime" {
  status_page_id                          = oneuptime_status_page.page.id
  uptime_percent_greater_than_or_equal_to = oneuptime_status_page_history_chart_bar_color.degraded.uptime_percent_greater_than_or_equal_to
}

output "status_page_id" {
  value = oneuptime_status_page.page.id
}

# Named for its endpoint, so the runner confirms it is deleted at the end.
output "status_page_history_chart_bar_color_rule_id" {
  value = oneuptime_status_page_history_chart_bar_color.degraded.id
}

output "operational_rule" {
  value = oneuptime_status_page_history_chart_bar_color.operational.id
}

output "nearly_rule" {
  value = oneuptime_status_page_history_chart_bar_color.nearly.id
}

output "one_minute_rule" {
  value = oneuptime_status_page_history_chart_bar_color.one_minute.id
}

output "offline_rule" {
  value = oneuptime_status_page_history_chart_bar_color.offline.id
}

output "operational_uptime" {
  value = oneuptime_status_page_history_chart_bar_color.operational.uptime_percent_greater_than_or_equal_to
}

output "nearly_uptime" {
  value = oneuptime_status_page_history_chart_bar_color.nearly.uptime_percent_greater_than_or_equal_to
}

output "degraded_uptime" {
  value = oneuptime_status_page_history_chart_bar_color.degraded.uptime_percent_greater_than_or_equal_to
}

output "offline_uptime" {
  value = oneuptime_status_page_history_chart_bar_color.offline.uptime_percent_greater_than_or_equal_to
}

output "found_by_id" {
  value = data.oneuptime_status_page_history_chart_bar_color.by_id.id
}

output "found_by_id_uptime" {
  value = data.oneuptime_status_page_history_chart_bar_color.by_id.uptime_percent_greater_than_or_equal_to
}

output "found_by_uptime" {
  value = data.oneuptime_status_page_history_chart_bar_color.by_uptime.id
}

output "found_by_uptime_color" {
  value = data.oneuptime_status_page_history_chart_bar_color.by_uptime.bar_color
}
