---
name: investigate-incident
description: Investigate an active OneUptime incident. Find it, take ownership, read its logs, exceptions and traces, keep notes on it and resolve it. Use when someone asks what is broken, which incidents are open, or for help with an incident, an alert or an on-call page in OneUptime.
---

# Investigate an incident in OneUptime

Work an incident through the OneUptime MCP server: find it, acknowledge it, read its telemetry, write down what you learn, and close it.

The person's own instructions come before these steps: where they ask for something else, do what they ask.

## Before you start

- The tools come from the `oneuptime` MCP server. The first time a tool needs an identity, the person signs in to OneUptime in the browser, from the client's MCP or connector settings, picks one project and chooses read and write or read only.
- On OneUptime Cloud, connecting an MCP client and using API keys need the Growth plan or higher. The public status page tools need no credential.
- You act with the signed-in person's permissions, in one project. Ask before anything that changes a record, unless the person already told you to do it.

## The loop

### 1. Confirm where you are

Call `oneuptime_whoami`. It names the project and, for a sign-in, says whether `access` is `read-only` or `read-and-write`. On a read-only connection you can still investigate: say that the writes below will be refused, and leave them to the person.

### 2. Find the incident

If the person gave you an incident's ID, read it with `get_incident`, which takes it as `id`. Otherwise find what is still open. A project can rename and add incident states, so ask for its states first:

```json list_incident_states
{
  "query": { "isResolvedState": { "_type": "EqualTo", "value": false } },
  "select": ["_id", "name"],
  "limit": 20
}
```

Then list the incidents in those states, newest first:

```json list_incidents
{
  "query": {
    "currentIncidentStateId": {
      "_type": "Includes",
      "value": ["<state id>", "<state id>"]
    }
  },
  "sort": { "createdAt": "DESC" },
  "limit": 5
}
```

If more than one is open, show the person the titles and severities and ask which one. `list_incident_severities` turns an `incidentSeverityId` into a name.

### 3. Take ownership

`acknowledge_incident` with the `incidentId` moves it to the project's Acknowledged state, as the dashboard's Acknowledge button does. An incident that is already acknowledged is left as it is, and the tool answers with an error that says so. Carry on.

### 4. Read the telemetry

Telemetry tables are large, so always filter by a time range and keep `limit` between 10 and 50. Start a little before the incident was declared.

```json list_logs
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-01-01T00:00:00.000Z" },
    "severityText": { "_type": "EqualTo", "value": "Error" }
  },
  "limit": 20
}
```

- `severityText` is one of `Fatal`, `Error`, `Warning`, `Information`, `Debug`, `Trace` and `Unspecified`.
- To search the text of a log, add `"body": { "_type": "Search", "value": "timeout" }`.
- `list_exception_instances` takes the same `time` filter and returns `exceptionType`, `message`, `stackTrace`, `release` and `traceId`.
- `list_spans` filters on `startTime`, or on the `traceId` of a log or an exception, to show one request.
- `list_change_events` shows the deploys and other changes recorded around that time.
- For a field these examples do not show, `oneuptime_describe_resource` lists every field of a resource, and how to filter, sort and select on it. Pass `resource`, such as `list_logs`.

If the repository is open, compare the stack traces with the code and the recent commits. Keep what you measured apart from what you infer, and tell the person which is which.

### 5. Write down what you find

`add_incident_note` takes `incidentId`, `note` (Markdown) and `visibility`. It defaults to `internal`, which only the people who can see the incident can read. `public` posts to the status page, where subscribers and customers read it, so show the person the text and get a yes before you post one.

### 6. Close it

Call `resolve_incident` once the person confirms that the service has recovered. Read the incident's state first: an incident opened by a monitor can resolve itself when its criteria stops matching.

## Alerts

Alerts work the same way with `list_alerts`, `acknowledge_alert`, `add_alert_note` and `resolve_alert`. Alert notes are internal only.

## Another team's status page

`get_public_status_page_overview`, `get_public_status_page_incidents`, `get_public_status_page_scheduled_maintenance` and `get_public_status_page_announcements` read a public OneUptime status page with no credential. Pass its domain or ID as `statusPageIdOrDomain`. A page's owner can turn this off, and the tool then says so.

## When a tool fails

A failed tool answers with `statusCode`, `details` and a `suggestion`. Read the suggestion before you try again.

- `402`: the project's billing does not allow this. Do not retry. A project owner can fix it under **Project Settings > Billing and Invoices > Billing**.
- A write on a read-only connection is refused. The person has to connect again and choose read and write.

The tools see one project. Billing and account settings are not available through them.
