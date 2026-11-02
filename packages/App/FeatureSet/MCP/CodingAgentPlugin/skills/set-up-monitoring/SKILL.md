---
name: set-up-monitoring
description: Set up OneUptime monitors and a status page for a service. Use when someone asks to monitor a website, API, host or port with OneUptime, add uptime checks, or create a status page for what they run.
---

# Set up monitors and a status page in OneUptime

Create the checks for a service through the OneUptime MCP server, then give it a status page. One step needs the dashboard: there is no tool that puts a monitor on a status page.

## Before you start

- The tools come from the `oneuptime` MCP server. The first time a tool needs an identity, the person signs in to OneUptime in the browser (in Claude Code, from `/mcp`), picks one project and chooses read and write or read only.
- On OneUptime Cloud, connecting an MCP client and using API keys need the Growth plan or higher. The public status page tools need no credential.
- Every create is a change to the person's project. Show them what you are about to create and get a yes.

## 1. Confirm where you are

Call `oneuptime_whoami`. If `access` is `read-only`, stop: the person has to connect again and choose read and write.

## 2. Decide what to check

Read the repository for the addresses that matter: the public site, an API's health endpoint, the ports it serves. Confirm them with the person and do not guess an address. OneUptime's probes check from outside, so `localhost` and private addresses need a custom probe inside that network.

Call `list_monitors` with a `name` filter so you do not create a monitor that already exists.

## 3. Collect the project's IDs

A monitor's criteria name the project's own records:

- `list_monitor_statuses`: the `_id` of the status with `isOperationalState` true, and of the one with `isOfflineState` true.
- `list_incident_severities`: the `_id` of the severity an outage of this service should have. Ask the person if the names do not make it clear.

## 4. Create the monitor

`create_monitor` needs `name` and `monitorType`. A monitor of any type but `Manual` also needs `monitorSteps`, which say what to check and how to judge the result. These are the criteria a new website monitor starts with in the dashboard: offline and an incident when the site does not answer or answers with an error, operational otherwise.

```json create_monitor
{
  "name": "Checkout website",
  "monitorType": "Website",
  "monitoringInterval": "*/5 * * * *",
  "monitorSteps": {
    "_type": "MonitorSteps",
    "value": {
      "defaultMonitorStatusId": "<operational status id>",
      "monitorStepsInstanceArray": [
        {
          "_type": "MonitorStep",
          "value": {
            "monitorDestination": {
              "_type": "URL",
              "value": "https://example.com"
            },
            "requestType": "GET",
            "monitorCriteria": {
              "_type": "MonitorCriteria",
              "value": {
                "monitorCriteriaInstanceArray": [
                  {
                    "_type": "MonitorCriteriaInstance",
                    "value": {
                      "name": "Check if Checkout website is offline",
                      "description": "The website does not answer, or answers with an error status code",
                      "filterCondition": "Any",
                      "filters": [
                        { "checkOn": "Is Online", "filterType": "False" },
                        {
                          "checkOn": "Response Status Code",
                          "filterType": "Greater Than Or Equal To",
                          "value": 400
                        },
                        {
                          "checkOn": "Response Status Code",
                          "filterType": "Less Than",
                          "value": 200
                        }
                      ],
                      "changeMonitorStatus": true,
                      "monitorStatusId": "<offline status id>",
                      "createIncidents": true,
                      "incidents": [
                        {
                          "title": "Checkout website is offline",
                          "description": "Checkout website is not responding, or is responding with an error status code.",
                          "incidentSeverityId": {
                            "_type": "ObjectID",
                            "value": "<incident severity id>"
                          },
                          "autoResolveIncident": true
                        }
                      ],
                      "createAlerts": false,
                      "alerts": []
                    }
                  },
                  {
                    "_type": "MonitorCriteriaInstance",
                    "value": {
                      "name": "Check if Checkout website is online",
                      "description": "The website answers with a 2xx or 3xx status code",
                      "filterCondition": "All",
                      "filters": [
                        { "checkOn": "Is Online", "filterType": "True" },
                        {
                          "checkOn": "Response Status Code",
                          "filterType": "Greater Than Or Equal To",
                          "value": 200
                        },
                        {
                          "checkOn": "Response Status Code",
                          "filterType": "Less Than",
                          "value": 400
                        }
                      ],
                      "changeMonitorStatus": true,
                      "monitorStatusId": "<operational status id>",
                      "createIncidents": false,
                      "incidents": [],
                      "createAlerts": false,
                      "alerts": []
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    }
  }
}
```

For the other common types, change the destination and the filters:

| `monitorType`     | `monitorDestination`                                                                | Filters                                         |
| ----------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| `API`             | `URL`, with `requestType`, and `requestHeaders` and `requestBody` if it needs them  | As above                                        |
| `Ping`            | `Hostname` or `IP`, such as `{"_type": "Hostname", "value": "example.com"}`         | `Is Online` only                                |
| `Port`            | `Hostname` or `IP`, and `monitorDestinationPort`: `{"_type": "Port", "value": 443}` | `Is Online` only                                |
| `SSL Certificate` | `URL`                                                                               | `Is Valid Certificate`, in place of `Is Online` |

The server gives every step and criteria its ID and attaches the project's default probes, so leave those out. `monitoringInterval` is a cron expression, not a label: `*/5 * * * *` is every five minutes. A `Manual` monitor needs only `name` and `monitorType`: nothing checks it, and its status is set by hand.

If a monitor type needs more than this, ask the person to set one up in the dashboard, then read its `monitorSteps` with `get_monitor` and copy them.

## 5. Check that it works

Read the monitor back with `get_monitor`. The first check runs on its interval, so `currentMonitorStatusId` starts at the operational status. Use `list_monitor_logs` with a `time` filter to see the checks once they have run.

## 6. Create the status page

`create_status_page` needs only a `name` of at least two characters:

```json create_status_page
{
  "name": "Checkout status",
  "pageTitle": "Checkout status",
  "pageDescription": "Current status of the Checkout service"
}
```

A new page is public: anyone with the link can read it. Leave the other settings at their defaults, which work on every plan. A page created with a setting the plan does not include, such as making it private or adding SMS subscribers, is refused with `402`, and the message names the plan.

## 7. Put the monitors on the page

The MCP server and the CLI have no tool for this, so tell the person to do it:

1. Open **Status Pages**, then the new page, then **Resources** in its side menu. It reads **Monitors** on projects without monitor groups.
2. Click **Add Monitor**, or **Add Multiple** for several, and pick the monitors.

The page stays empty until they do. An incident reaches a status page only when one of its monitors is a resource on that page. The page's **Status Page Link** is on its **Overview** screen.

## When a tool fails

A failed tool answers with `statusCode`, `details` and a `suggestion`. Read the suggestion before you try again. `402` means the project's billing does not allow this: do not retry. A project owner can fix it under **Project Settings > Billing and Invoices > Billing**.
