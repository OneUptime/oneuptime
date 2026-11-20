---
name: set-up-monitoring
description: Set up OneUptime monitors, who is paged, and a status page for a service. Use when someone asks to monitor a website, API, host or port with OneUptime, add uptime checks, be paged when it is down, or create a status page for what they run.
---

# Set up monitors and a status page in OneUptime

Set up the checks for a service through the OneUptime MCP server, decide who is paged when one fails, then give it a status page that shows them. A website or an API, a service's recommended monitors, paging, the people on call and the status page take one call each: the setup tools make what OneUptime's guided setups and Ask AI make for the same answers.

The person's own instructions come before these steps: where they ask for something else, do what they ask.

## Before you start

- The tools come from the `oneuptime` MCP server. The first time a tool needs an identity, the person signs in to OneUptime in the browser, from the client's MCP or connector settings, picks one project and chooses read and write or read only.
- On OneUptime Cloud, connecting an MCP client and using API keys need the Growth plan or higher. The public status page tools need no credential.
- Every create is a change to the person's project. Show them what you are about to create and get a yes.
- The setup tools - `set_up_website_monitoring`, `set_up_service_monitor`, `set_up_paging`, `add_to_on_call_policy`, `invite_people`, `set_how_to_reach_me`, `publish_status_page` and `add_monitors_to_status_page` - act as the person signed in, with their permissions: the monitor is theirs, the policy pages them, an invitation goes out in their name, and How to Reach Me is their own. A project API key cannot use them.
- Each setup tool says what a second identical call does, and makes nothing twice: retrying one after a timeout is safe.

## 1. Confirm where you are

Call `oneuptime_whoami`. If `access` is `read-only`, stop: the person has to connect again and choose read and write.

## 2. Decide what to check

Find the addresses that matter: the public site, an API's health endpoint, the ports it serves. Read them from the service's code or configuration when you can see it, and ask the person otherwise. Confirm them with the person and do not guess an address. OneUptime's probes check from outside, so `localhost` and private addresses need a custom probe inside that network.

A website or an API needs no search first: `set_up_website_monitoring` makes no second monitor for an address a monitor checks already, and its answer names that monitor. For the other types, call `list_monitors` with a `name` filter so you do not create a monitor that already exists.

## 3. Monitor a website or an API

`set_up_website_monitoring` needs only the `address`:

```json set_up_website_monitoring
{
  "address": "https://example.com",
  "checkEveryMinutes": 5
}
```

Add `"isApi": true` for an API endpoint, such as `https://api.example.com/health`. The monitor opens an incident when the address does not answer or answers with an error, is checked from the locations a new monitor starts with, and belongs to the person, who is emailed when its status changes. The answer's `details` say this in OneUptime's own words: tell the person what was set up from them, and the monitor's ID is in `record`. On OneUptime Cloud's Free plan each new monitor is billed as it is used: tell the person what it costs a month before you set one up, as the tool's description says, and `details` say it again.

A service that sends OpenTelemetry data to OneUptime gets the monitors the telemetry guided setup recommends with `set_up_service_monitor`, one call for each: `errors` (failing requests), `slow_requests`, `exceptions` and `error_logs`. Each opens an alert for the team, never an incident on a status page:

```json set_up_service_monitor
{
  "service": "checkout",
  "monitor": "errors"
}
```

A monitor of data the service does not send yet is refused, and so is one it has already: call it for all four, and tell the person which were set up.

## 4. Other types: collect the project's IDs

A monitor's criteria name the project's own records:

- `list_monitor_statuses`: the `_id` of the status with `isOperationalState` true, and of the one with `isOfflineState` true.
- `list_incident_severities`: the `_id` of the severity an outage of this service should have. Ask the person if the names do not make it clear.

## 5. Other types: create the monitor

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

If a monitor type needs more than this, ask the person to set one up in the dashboard, then read its `monitorSteps` with `get_monitor` and copy them. `oneuptime_describe_resource`, with `resource` set to `monitor`, lists every other field a monitor has.

## 6. Decide who is paged

A monitor's incident pages whoever the project's on-call policies page. In a project that pages nobody yet, `set_up_paging` makes the on-call policy "Default on-call policy": it pages the person, and the members (`alsoPage`) and teams (`teams`) they name, for every new incident and alert. Pass how they asked to be reached in `reachMeBy` (`sms`, `call`, `push` or `email`):

```json set_up_paging
{
  "reachMeBy": ["sms"]
}
```

For someone paged next when nobody acknowledges, add `escalateTo` (or `escalateToTeams`) and `afterMinutes`; to page the same people again, `repeatTimes`. A project that pages people already keeps its own policies and rules, and the tool says so instead of making a second one. A phone number or the app is added and verified by the person: when `details` say one is missing, send them to **User Settings > Notification Methods** in OneUptime.

In a project that pages people already, `add_to_on_call_policy` adds members and teams to one of its policies, by the policy's name: to its first level, or with `level` one past its last and `afterMinutes`, as a new level paged when nobody acknowledges.

```json add_to_on_call_policy
{
  "policy": "Default on-call policy",
  "alsoPage": ["ana@example.com"]
}
```

Someone who is not in the project yet is invited first, with `invite_people`: OneUptime emails each address an invitation in the person's name, and they can be added to a policy once they join.

```json invite_people
{
  "emails": ["ana@example.com"]
}
```

How pages reach the person themselves is their How to Reach Me: `set_how_to_reach_me` sets it from what they said, such as "text me, then call me after five minutes". It replaces how pages reach them now, and reaches only the methods they have verified.

```json set_how_to_reach_me
{
  "steps": [
    { "by": "sms", "afterMinutes": 0 },
    { "by": "call", "afterMinutes": 5 }
  ]
}
```

## 7. Check that it works

Read the monitor back with `get_monitor`. The first check runs on its interval, so `currentMonitorStatusId` starts at the operational status. Use `list_monitor_logs` with a `time` filter to see the checks once they have run. `who_is_told` says who is told when it goes down, and what would stop them being reached:

```json who_is_told
{
  "monitor": "https://example.com"
}
```

## 8. Put the monitors on a status page

For a new page, `publish_status_page` makes the page with the monitors on it, named by their names or the addresses they check:

```json publish_status_page
{
  "name": "Checkout status",
  "monitors": ["https://example.com"]
}
```

For a page the project has, `add_monitors_to_status_page` adds them after the ones it shows:

```json add_monitors_to_status_page
{
  "statusPage": "Checkout status",
  "monitors": ["https://api.example.com/health"]
}
```

A new page is public as soon as it is made: anyone with its link sees the status of the monitors it shows. Its link is in the answer. An incident reaches a status page only when one of its monitors is on that page. On a plan that allows no more status pages, `publish_status_page` is refused with `402` and the plan's own words: add the monitors to the page the project has instead.

## When a tool fails

A failed tool answers with `statusCode`, `details` and a `suggestion`. Read the suggestion before you try again. `402` means the project's billing does not allow this: do not retry. A project owner can fix it under **Project Settings > Billing and Invoices > Billing**. A setup tool that refuses says what is needed, such as a permission or an address it can check: tell the person in its words.
