# API Reference

OneUptime provides a comprehensive REST API that allows you to integrate monitoring, incident management, and status page functionality into your applications and workflows. **Anything you an do on the OneUptime dashboard can also be done through the API, enabling automation and custom integrations.**

### Getting Started

Our API is organized around REST principles and uses standard HTTP response codes, authentication, and verbs. All API endpoints return JSON responses.

### Authentication

All API requests require authentication using API keys. You can generate API keys from your OneUptime dashboard under Settings > API Keys.

### Examples for each resource

Every resource in the OneUptime dashboard has a **Developer** section in its side menu, collapsed until you open it. Its **API** page has ready-to-run `curl` commands for that resource, pointed at your OneUptime and filled in from your own project: read, change and delete it from the resource's own page, or list, count and create from a list page (for example **Monitors**). The commands read your API key from the `ONEUPTIME_API_KEY` environment variable.

The examples are written for the resource. On the **Incidents** list, for example, the list request shows its answer with your first incident, the filters find incidents that are not resolved, of one severity, about one monitor or from the last seven days, using your own states, severities and monitors, and the create request declares an incident with one of your severities, with a line on what each field is for. An incident's own page reads it with its real answer, moves it to another of your severities, and has its common tasks: acknowledge and resolve it (with your project's own states), and add internal or public notes. Every API page ends with the resource's endpoints.

### Features your plan does not include

On OneUptime Cloud, some resources are sold on a plan: single sign-on providers and SCIM connections on **Scale**; API keys, on-call schedules, and Slack and Microsoft Teams notification rules and summaries on **Growth**, among others. Creating one, changing one or switching one on needs that plan. Below it, the request is refused with `402 Payment Required`, and the message names the plan.

What a project already has stays manageable whatever its plan, for example after a trial ends or the plan goes down:

- you can delete those records;
- you can switch one off, on a resource with an `isEnabled` field, by sending `"isEnabled": false` and nothing else;
- you can list and read the ones that keep working after the plan goes down: single sign-on providers, SCIM connections, API keys and their permissions, on-call schedules, and Slack and Microsoft Teams notification rules and summaries.

The usual permissions still decide who can do each, exactly as on the plan. Reading the other resources a plan sells, such as templates, custom fields, monitor groups, on-call logs and form submissions, still needs the plan: reading them is using the feature. An API key's permissions are not deleted one by one below **Growth**, because deleting a block permission would give the key more access; delete the key instead.

API keys keep working after a plan goes down. Below **Growth**, **Project Settings** > **API Keys** lists the keys the project still has, so any of them can be deleted (revoked) on every plan. Creating or changing keys needs **Growth**.

### Finding a resource's ID

Requests that read, change or delete one resource name it by its ID, a UUID. On the resource's own page, its details card ends with a small **ID** line that shows the start of the ID: click the ID, or the copy button beside it, to copy the whole ID. Lists that offer it have **Show ID** in a row's **⋯** menu, and the ID is also the last part of the page's address. Your project's ID is the first thing on the **Project Details** card of **Project Settings → Project**.

### Records a request names

Many resources name other records: a monitor its labels and probes, a status page subscriber its status page, a network device its site, an incident's member the incident and the role. Every ID you send for one must be a record of your project — the dashboard's pickers offer nothing else — and requests from Terraform and workflows are held to the same. An ID of another project's record and an ID that does not exist are refused alike, with a `400` that names the field and the ID:

```text
This network device references records that are not in this project: Network Site "…". Please pick values from this project and try again.
```

People are checked by membership: someone who is not a member of the project is refused the same way. A global probe, which every project can use, counts as your project's. Changing a resource checks only the IDs the change adds, so a resource that names something that has since gone can still be saved.

A record can be named in two ways: by its ID field (`monitorId`), or by the relation (`"monitor": { "_id": "…" }`), which is what the dashboard's forms send. Send one of them. If a request sends both, they must name the same record: a request whose two disagree — two different IDs, or an ID and an empty value — is refused with a `400` that names both fields:

```text
Conflicting Monitor references were provided. monitorId and monitor are names for the same field and must hold the same value: send only one of them, or the same id in each.
```

Either name is checked the same way. The rules about the record you name hold whichever name you send it under: a status page group's parent group must be on the same status page, a status page takes at most three header links, and a group's name must be unique on its status page.

### Who created a record

OneUptime records who created a record — and who archived it, resolved it, acknowledged it or triggered it — from the request itself: the person signed in, or nobody when the request comes with an API key or from a workflow. These fields (`createdByUserId` and the other fields ending in `ByUserId`, with their relations such as `createdByUser`) are read-only, and so is when a record was archived or resolved (`archivedAt`, `markedAsResolvedAt`, `markedAsArchivedAt`): turning `isArchived` or `isResolved` on records who did it and when, and turning it off clears both. Sending a switch as it already stands keeps who turned it, and when.

The API reference marks these fields read-only. A value a request sends for one beside other changes is ignored, so the rest of the change goes through; an update that sends nothing else is refused with a message naming the fields. Records that OneUptime itself creates on someone's behalf — a note posted from Slack or Microsoft Teams, an account made by an invitation — name that person.

### The state a new record starts in

An incident, an alert, an incident episode and an alert episode can be created in any of your project's states, as the **Initial State** field of their create forms does: send `currentIncidentStateId` (incidents and incident episodes) or `currentAlertStateId` (alerts and alert episodes), or the relation. The record starts in that state and its state timeline begins with it. Leave it out and it starts in your project's created state, the one flagged `isCreatedState` — or, for an incident declared from a template that has an initial state, in the template's. A state of another project is refused like any other record. Terraform's `current_incident_state_id` and `current_alert_state_id` work the same way. A record created at or past your acknowledged state pages no one, and one created resolved is also not grouped, remediated or investigated by AI and gets no Slack or Microsoft Teams channel — see [Declared already acknowledged or resolved](/docs/incidents/declaring-incidents#declared-already-acknowledged-or-resolved).

### API Reference

Please click here to check out OneUptime's API reference ➡️ [OneUptime API Reference](/reference). The API reference is available in multiple languages — your preferred language is auto-detected from your browser, and you can switch languages at any time using the selector in the top navigation.
