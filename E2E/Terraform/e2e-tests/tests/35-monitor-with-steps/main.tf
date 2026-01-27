terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "1.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.api_key
}

resource "random_id" "suffix" {
  byte_length = 4
}

# Test: Monitor Types with Monitor Steps
#
# This test validates creating different monitor types with proper monitor_steps:
# - Website Monitor with HTTP checks
# - API Monitor with request headers and body
# - Ping Monitor with hostname destination
# - Port Monitor with specific port
# - SSL Certificate Monitor
# - IP Monitor

# Create monitor statuses for criteria
resource "oneuptime_monitor_status" "operational" {
  name                 = "TF Operational ${random_id.suffix.hex}"
  description          = "Monitor is operational"
  color                = "#2ecc71"
  priority             = 1
  is_operational_state = true
}

resource "oneuptime_monitor_status" "degraded" {
  name                 = "TF Degraded ${random_id.suffix.hex}"
  description          = "Monitor is degraded"
  color                = "#f39c12"
  priority             = 2
  is_operational_state = false
}

resource "oneuptime_monitor_status" "offline" {
  name                 = "TF Offline ${random_id.suffix.hex}"
  description          = "Monitor is offline"
  color                = "#e74c3c"
  priority             = 3
  is_operational_state = false
}

# =============================================================================
# Test Case 1: Website Monitor with Monitor Steps
# =============================================================================
resource "oneuptime_monitor" "website" {
  name         = "TF Website Monitor ${random_id.suffix.hex}"
  description  = "Website monitor with URL destination and response criteria"
  monitor_type = "Website"

  monitor_steps = jsonencode({
    _type = "MonitorSteps"
    value = {
      monitorStepsInstanceArray = [
        {
          _type = "MonitorStep"
          value = {
            id = "step-website-1"
            monitorDestination = {
              _type = "URL"
              value = "https://example.com"
            }
            requestType = "GET"
            monitorCriteria = {
              _type = "MonitorCriteria"
              value = {
                monitorCriteriaInstanceArray = [
                  {
                    _type = "MonitorCriteriaInstance"
                    value = {
                      id               = "criteria-online"
                      name             = "Online"
                      description      = "Check if website is online"
                      filterCondition  = "All"
                      changeMonitorStatus = true
                      createIncidents  = false
                      createAlerts     = false
                      monitorStatusId  = oneuptime_monitor_status.operational.id
                      filters = [
                        {
                          _type = "CriteriaFilter"
                          value = {
                            checkOn    = "Is Online"
                            filterType = "True"
                          }
                        },
                        {
                          _type = "CriteriaFilter"
                          value = {
                            checkOn    = "Response Status Code"
                            filterType = "Equal To"
                            value      = "200"
                          }
                        }
                      ]
                      incidents = []
                      alerts    = []
                    }
                  },
                  {
                    _type = "MonitorCriteriaInstance"
                    value = {
                      id               = "criteria-offline"
                      name             = "Offline"
                      description      = "Check if website is offline"
                      filterCondition  = "Any"
                      changeMonitorStatus = true
                      createIncidents  = false
                      createAlerts     = false
                      monitorStatusId  = oneuptime_monitor_status.offline.id
                      filters = [
                        {
                          _type = "CriteriaFilter"
                          value = {
                            checkOn    = "Is Online"
                            filterType = "False"
                          }
                        }
                      ]
                      incidents = []
                      alerts    = []
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    }
  })

  depends_on = [oneuptime_monitor_status.operational, oneuptime_monitor_status.offline]
}

# =============================================================================
# Test Case 2: API Monitor with Headers and Body
# =============================================================================
resource "oneuptime_monitor" "api" {
  name         = "TF API Monitor ${random_id.suffix.hex}"
  description  = "API monitor with POST request, headers, and body"
  monitor_type = "API"

  monitor_steps = jsonencode({
    _type = "MonitorSteps"
    value = {
      monitorStepsInstanceArray = [
        {
          _type = "MonitorStep"
          value = {
            id = "step-api-1"
            monitorDestination = {
              _type = "URL"
              value = "https://httpbin.org/post"
            }
            requestType = "POST"
            requestHeaders = {
              "Content-Type"    = "application/json"
              "Accept"          = "application/json"
              "X-Custom-Header" = "test-value"
            }
            requestBody = "{\"test\": \"data\"}"
            monitorCriteria = {
              _type = "MonitorCriteria"
              value = {
                monitorCriteriaInstanceArray = [
                  {
                    _type = "MonitorCriteriaInstance"
                    value = {
                      id               = "criteria-api-success"
                      name             = "API Success"
                      description      = "API returns success response"
                      filterCondition  = "All"
                      changeMonitorStatus = true
                      createIncidents  = false
                      createAlerts     = false
                      monitorStatusId  = oneuptime_monitor_status.operational.id
                      filters = [
                        {
                          _type = "CriteriaFilter"
                          value = {
                            checkOn    = "Is Online"
                            filterType = "True"
                          }
                        },
                        {
                          _type = "CriteriaFilter"
                          value = {
                            checkOn    = "Response Status Code"
                            filterType = "Equal To"
                            value      = "200"
                          }
                        }
                      ]
                      incidents = []
                      alerts    = []
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    }
  })

  depends_on = [oneuptime_monitor_status.operational]
}

# =============================================================================
# Test Case 3: Ping Monitor
# =============================================================================
resource "oneuptime_monitor" "ping" {
  name         = "TF Ping Monitor ${random_id.suffix.hex}"
  description  = "Ping monitor with hostname destination"
  monitor_type = "Ping"

  monitor_steps = jsonencode({
    _type = "MonitorSteps"
    value = {
      monitorStepsInstanceArray = [
        {
          _type = "MonitorStep"
          value = {
            id = "step-ping-1"
            monitorDestination = {
              _type = "Hostname"
              value = "google.com"
            }
            requestType = "GET"
            monitorCriteria = {
              _type = "MonitorCriteria"
              value = {
                monitorCriteriaInstanceArray = [
                  {
                    _type = "MonitorCriteriaInstance"
                    value = {
                      id               = "criteria-ping-online"
                      name             = "Ping Success"
                      description      = "Host responds to ping"
                      filterCondition  = "All"
                      changeMonitorStatus = true
                      createIncidents  = false
                      createAlerts     = false
                      monitorStatusId  = oneuptime_monitor_status.operational.id
                      filters = [
                        {
                          _type = "CriteriaFilter"
                          value = {
                            checkOn    = "Is Online"
                            filterType = "True"
                          }
                        }
                      ]
                      incidents = []
                      alerts    = []
                    }
                  },
                  {
                    _type = "MonitorCriteriaInstance"
                    value = {
                      id               = "criteria-ping-offline"
                      name             = "Ping Failure"
                      description      = "Host does not respond"
                      filterCondition  = "All"
                      changeMonitorStatus = true
                      createIncidents  = false
                      createAlerts     = false
                      monitorStatusId  = oneuptime_monitor_status.offline.id
                      filters = [
                        {
                          _type = "CriteriaFilter"
                          value = {
                            checkOn    = "Is Online"
                            filterType = "False"
                          }
                        }
                      ]
                      incidents = []
                      alerts    = []
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    }
  })

  depends_on = [oneuptime_monitor_status.operational, oneuptime_monitor_status.offline]
}

# =============================================================================
# Test Case 4: Port Monitor
# =============================================================================
resource "oneuptime_monitor" "port" {
  name         = "TF Port Monitor ${random_id.suffix.hex}"
  description  = "Port monitor checking HTTPS port"
  monitor_type = "Port"

  monitor_steps = jsonencode({
    _type = "MonitorSteps"
    value = {
      monitorStepsInstanceArray = [
        {
          _type = "MonitorStep"
          value = {
            id = "step-port-1"
            monitorDestination = {
              _type = "Hostname"
              value = "google.com"
            }
            monitorDestinationPort = {
              _type = "Port"
              value = 443
            }
            requestType = "GET"
            monitorCriteria = {
              _type = "MonitorCriteria"
              value = {
                monitorCriteriaInstanceArray = [
                  {
                    _type = "MonitorCriteriaInstance"
                    value = {
                      id               = "criteria-port-open"
                      name             = "Port Open"
                      description      = "Port is accepting connections"
                      filterCondition  = "All"
                      changeMonitorStatus = true
                      createIncidents  = false
                      createAlerts     = false
                      monitorStatusId  = oneuptime_monitor_status.operational.id
                      filters = [
                        {
                          _type = "CriteriaFilter"
                          value = {
                            checkOn    = "Is Online"
                            filterType = "True"
                          }
                        }
                      ]
                      incidents = []
                      alerts    = []
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    }
  })

  depends_on = [oneuptime_monitor_status.operational]
}

# =============================================================================
# Test Case 5: SSL Certificate Monitor
# =============================================================================
resource "oneuptime_monitor" "ssl" {
  name         = "TF SSL Certificate Monitor ${random_id.suffix.hex}"
  description  = "SSL certificate monitor checking certificate validity"
  monitor_type = "SSL Certificate"

  monitor_steps = jsonencode({
    _type = "MonitorSteps"
    value = {
      monitorStepsInstanceArray = [
        {
          _type = "MonitorStep"
          value = {
            id = "step-ssl-1"
            monitorDestination = {
              _type = "URL"
              value = "https://google.com"
            }
            requestType = "GET"
            monitorCriteria = {
              _type = "MonitorCriteria"
              value = {
                monitorCriteriaInstanceArray = [
                  {
                    _type = "MonitorCriteriaInstance"
                    value = {
                      id               = "criteria-ssl-valid"
                      name             = "Certificate Valid"
                      description      = "SSL certificate is valid"
                      filterCondition  = "All"
                      changeMonitorStatus = true
                      createIncidents  = false
                      createAlerts     = false
                      monitorStatusId  = oneuptime_monitor_status.operational.id
                      filters = [
                        {
                          _type = "CriteriaFilter"
                          value = {
                            checkOn    = "Is Valid Certificate"
                            filterType = "True"
                          }
                        }
                      ]
                      incidents = []
                      alerts    = []
                    }
                  },
                  {
                    _type = "MonitorCriteriaInstance"
                    value = {
                      id               = "criteria-ssl-expiring"
                      name             = "Certificate Expiring Soon"
                      description      = "Certificate expires within 30 days"
                      filterCondition  = "All"
                      changeMonitorStatus = true
                      createIncidents  = false
                      createAlerts     = false
                      monitorStatusId  = oneuptime_monitor_status.degraded.id
                      filters = [
                        {
                          _type = "CriteriaFilter"
                          value = {
                            checkOn    = "Expires In Days"
                            filterType = "Less Than"
                            value      = "30"
                          }
                        }
                      ]
                      incidents = []
                      alerts    = []
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    }
  })

  depends_on = [oneuptime_monitor_status.operational, oneuptime_monitor_status.degraded]
}

# =============================================================================
# Test Case 6: IP Monitor
# =============================================================================
resource "oneuptime_monitor" "ip" {
  name         = "TF IP Monitor ${random_id.suffix.hex}"
  description  = "IP monitor checking connectivity"
  monitor_type = "IP"

  monitor_steps = jsonencode({
    _type = "MonitorSteps"
    value = {
      monitorStepsInstanceArray = [
        {
          _type = "MonitorStep"
          value = {
            id = "step-ip-1"
            monitorDestination = {
              _type = "IP"
              value = "8.8.8.8"
            }
            requestType = "GET"
            monitorCriteria = {
              _type = "MonitorCriteria"
              value = {
                monitorCriteriaInstanceArray = [
                  {
                    _type = "MonitorCriteriaInstance"
                    value = {
                      id               = "criteria-ip-online"
                      name             = "IP Reachable"
                      description      = "IP address is reachable"
                      filterCondition  = "All"
                      changeMonitorStatus = true
                      createIncidents  = false
                      createAlerts     = false
                      monitorStatusId  = oneuptime_monitor_status.operational.id
                      filters = [
                        {
                          _type = "CriteriaFilter"
                          value = {
                            checkOn    = "Is Online"
                            filterType = "True"
                          }
                        }
                      ]
                      incidents = []
                      alerts    = []
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    }
  })

  depends_on = [oneuptime_monitor_status.operational]
}

# =============================================================================
# Outputs
# =============================================================================
output "website_monitor_id" {
  value       = oneuptime_monitor.website.id
  description = "Website monitor ID"
}

output "website_monitor_type" {
  value       = oneuptime_monitor.website.monitor_type
  description = "Website monitor type"
}

output "api_monitor_id" {
  value       = oneuptime_monitor.api.id
  description = "API monitor ID"
}

output "api_monitor_type" {
  value       = oneuptime_monitor.api.monitor_type
  description = "API monitor type"
}

output "ping_monitor_id" {
  value       = oneuptime_monitor.ping.id
  description = "Ping monitor ID"
}

output "ping_monitor_type" {
  value       = oneuptime_monitor.ping.monitor_type
  description = "Ping monitor type"
}

output "port_monitor_id" {
  value       = oneuptime_monitor.port.id
  description = "Port monitor ID"
}

output "port_monitor_type" {
  value       = oneuptime_monitor.port.monitor_type
  description = "Port monitor type"
}

output "ssl_monitor_id" {
  value       = oneuptime_monitor.ssl.id
  description = "SSL certificate monitor ID"
}

output "ssl_monitor_type" {
  value       = oneuptime_monitor.ssl.monitor_type
  description = "SSL certificate monitor type"
}

output "ip_monitor_id" {
  value       = oneuptime_monitor.ip.id
  description = "IP monitor ID"
}

output "ip_monitor_type" {
  value       = oneuptime_monitor.ip.monitor_type
  description = "IP monitor type"
}

output "operational_status_id" {
  value       = oneuptime_monitor_status.operational.id
  description = "Operational status ID"
}

output "degraded_status_id" {
  value       = oneuptime_monitor_status.degraded.id
  description = "Degraded status ID"
}

output "offline_status_id" {
  value       = oneuptime_monitor_status.offline.id
  description = "Offline status ID"
}
