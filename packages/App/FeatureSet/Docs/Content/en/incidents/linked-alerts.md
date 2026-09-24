# Linked Alerts

An outage rarely raises one alert. When the primary database falls over, the replication lag monitor fires, the API error rate monitor fires, and the checkout latency SLO starts burning — three alerts, one problem. Linking those alerts to the incident says so: the incident is where the response happens, and every alert shows which incident explains it.

A link is only a link. The alert keeps its own state, owners, on-call policies, notes and feed; the incident keeps its own. Nothing is merged or copied, and linking on its own never acknowledges, resolves or silences an alert. If you want the incident to move its alerts along with it, turn on the two project switches described [further down](#keeping-alert-states-in-step-with-the-incident).

If you are coming from Opsgenie, this is OneUptime's version of associating alerts with an incident.

## At a glance

- **Many-to-many** — an incident can have any number of linked alerts, and one alert can be linked to several incidents.
- **Three places to link** — the incident's **Linked Alerts** page, the alert's **Linked Incidents** page, and the **Link to Incident** bulk action on any alerts list, for up to **50** alerts at a time.
- **Declare an incident from alerts** — **Declare Incident** on an alerts list or on an alert prefills a new incident from the alerts and links them as it is created.
- **Recorded on both sides** — every link and unlink writes a feed entry on the incident and on the alert. Only the incident's entry is posted to Slack and Microsoft Teams.
- **Alert states are yours to sync** — two project switches, both off by default, acknowledge and resolve linked alerts when the incident is acknowledged and resolved.
- **Automatable** — links are an ordinary API resource, `/api/incident-alert`.

## Why link alerts to an incident

Alerts are signals: a monitor's criteria matched, an SLO started burning its budget, a security rule fired. An incident is the coordinated response to a problem. Most problems produce several signals, and without links, the only thing tying them to the response is somebody's memory.

With the alerts linked:

- Responders on the incident see, in one list, which alerts are part of it and what state each one is in.
- Somebody opening one of those alerts sees that it is already being handled, under which incident, instead of declaring a second incident for the same outage.
- The incident's feed records when each alert was linked and by whom, so the timeline shows how the picture came together.
- With the switches on, acknowledging the incident stops the alerts' on-call escalations, so the people working the incident are not paged again by its symptoms.

## How links work

A link connects one alert to one incident. Links go both ways — the same link appears on the incident's **Linked Alerts** page and on the alert's **Linked Incidents** page.

- **An alert can be linked to several incidents.** A shared dependency failing can be a symptom of two separate incidents. Each incident lists the alert, and the alert lists both incidents.
- **Each pair is linked once.** Linking an alert to an incident it is already linked to is rejected with "This alert is already linked to this incident."
- **Links are created or removed, never edited.** A link has no fields of its own beyond its incident, its alert, when it was made and who made it. To move an alert to a different incident, link it to the new one and unlink it from the old one.
- **Links stay inside a project.** The alert and the incident must belong to the same project.

## Linking alerts from an incident

Open the incident and choose **Linked Alerts** in the **Investigation** section of its side menu. The table lists every alert linked to the incident:

| Column            | What it shows                                    |
| ----------------- | ------------------------------------------------ |
| **Alert #**       | The alert number, such as `#17` or `ALT-17`.     |
| **Title**         | The alert's title, linking to the alert.         |
| **Current State** | The alert's own state, such as **Acknowledged**. |
| **Linked At**     | When the alert was linked.                       |
| **Linked By**     | Who linked it.                                   |

To link another alert, click **Link Alert**, pick it from the **Alert** dropdown — it searches as you type — and save. Each row has **View Alert** to open the alert and **Unlink** to remove the link.

## Linking incidents from an alert

The alert side mirrors the incident side. Open an alert and choose **Linked Incidents** in the **Basic** section of its side menu. The table lists every incident the alert is linked to, with the incident number, title and current state, and when and by whom it was linked.

- **Link Incident** links this alert to an existing incident, picked from a dropdown.
- **View Incident** opens a linked incident.
- **Unlink** removes a link.
- **Declare Incident** starts a new incident from this alert. See [Declaring an incident from alerts](#declaring-an-incident-from-alerts).

## Linking many alerts at once

Every alerts list in the dashboard has two bulk actions for this — **Alerts** and **Active Alerts**, the active alerts on the home page, and the **Alerts** page of a monitor, service, host, Kubernetes cluster, SLO or any other resource that has one. Select the alerts, then choose:

- **Link to Incident** — pick the incident in the **Incident** dropdown and click **Link Alerts**. Recent incidents are listed with their numbers, and typing searches every incident by title. OneUptime links every selected alert, showing progress as it goes. An alert that is already linked to that incident counts as done rather than failed, so running the action twice is harmless.
- **Declare Incident** — opens the declare form for a new incident prefilled from the selected alerts. See the next section.

Both actions take up to **50** alerts at a time. Select more and they are disabled, with a tooltip saying why. The cap exists because every link writes to both feeds and posts to the incident's Slack and Microsoft Teams channels — a thousand-alert selection would flood them.

## Declaring an incident from alerts

When a burst of alerts turns out to be an incident nobody has declared yet, declare it from the alerts. There are two ways in:

- Select the alerts on any alerts list and choose **Declare Incident**.
- Open one alert's **Linked Incidents** page and click **Declare Incident**.

Either way you land on the usual **Declare New Incident** form, with the alerts listed as the ones that will be linked and these fields prefilled:

| Field                  | Prefilled with                                                                                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Title**              | One alert: its title. Several: the title of the most severe alert.                                                                                                                                                                                                                     |
| **Description**        | One alert: its description. Several: a list with one line per alert, giving its number and title.                                                                                                                                                                                      |
| **Incident Severity**  | The most severe alert's severity, translated to an incident severity. An incident severity with the same name, ignoring case, wins. Otherwise OneUptime takes the incident severity at the same position in the severity order, or the last one if you have fewer incident severities. |
| **Resources Affected** | Every monitor and every other affected resource of the selected alerts, combined.                                                                                                                                                                                                      |
| **Labels**             | Every label of every selected alert.                                                                                                                                                                                                                                                   |
| **Private Incident**   | On if any of the alerts is private.                                                                                                                                                                                                                                                    |

"Most severe" follows your alert severity order: the first alert severity in the list is the most severe. With the severities every project starts with, a **High** alert becomes a **Critical Incident** and a **Low** alert a **Major Incident**.

Everything is editable before you submit.

**On-call policies are not copied.** The alerts ran their own on-call policies when they were created, so copying them onto the incident would page the same people a second time. The incident's on-call policies are whatever you pick on the **On-Call** step plus whatever your incident on-call rules add — exactly as for any other incident.

**The alerts' monitors are prefilled as affected monitors.** As with any incident declared by hand, active monitoring on the incident's monitors pauses until the incident is resolved. Remove a monitor from **Resources Affected** before you submit if it should keep being checked.

When you submit, the server checks the alerts before it creates anything: at most 50 of them, each an alert in this project that you are allowed to see, and you must be allowed to link alerts to incidents. If any check fails, the request is rejected and no incident is created — so a bad alert id never uses up an incident number. Once the incident exists, every alert is linked before the request returns, so the incident's **Linked Alerts** page already lists them. If a single link fails — say, because the alert was deleted a moment earlier — the incident is still declared and the other alerts are still linked.

### Declaring through the API

`POST /api/incident` accepts the alert ids to link in `miscDataProps`, under `alertIdsToLink`:

```bash
curl -X POST https://oneuptime.com/api/incident \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "Primary database unavailable",
      "incidentSeverityId": "<incident-severity-id>"
    },
    "miscDataProps": {
      "alertIdsToLink": ["<alert-id>", "<another-alert-id>"]
    }
  }'
```

`alertIdsToLink` is an array of 1 to 50 alert ids. Duplicates are ignored, and the same checks apply as in the dashboard, before the incident is created. Nothing is prefilled over the API — send the title, severity and resources you want. The API key needs permission to create incidents and to link alerts to them. For the rest of the request body, see [Declaring an Incident](/docs/incidents/declaring-incidents).

## Linking and unlinking through the API

Links are a standard CRUD resource at `/api/incident-alert`. To link an alert to an incident, create one:

```bash
curl -X POST https://oneuptime.com/api/incident-alert \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "incidentId": "<incident-id>",
      "alertId": "<alert-id>"
    }
  }'
```

To list an incident's linked alerts, query by `incidentId`. Query by `alertId` instead to find the incidents an alert is linked to:

```bash
curl -X POST https://oneuptime.com/api/incident-alert/get-list \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "incidentId": "<incident-id>" },
    "select": { "_id": true, "alertId": true, "createdAt": true },
    "limit": 50,
    "skip": 0
  }'
```

To unlink, delete the link by its own id — the `_id` of the link, not of the alert or the incident:

```bash
curl -X DELETE https://oneuptime.com/api/incident-alert/<link-id> \
  -H "apikey: $ONEUPTIME_API_KEY"
```

Both ids are required. A link request is also rejected when the alert or the incident belongs to another project or is one you cannot see. The error reads the same whether the alert or incident does not exist or is only hidden from you, so it never reveals that a private one exists.

The same resource drives the generated workflow components — **On Create Incident Alert** fires when an alert is linked and **On Delete Incident Alert** when it is unlinked — and the Incident Alert tools of the MCP server. The [API reference](/reference) has the full request and response shapes.

## Unlinking

Unlink from either side: **Unlink** on a row of the incident's **Linked Alerts** page or the alert's **Linked Incidents** page, then confirm. To unlink several at once, select the rows and use the bulk **Delete** action. Despite its name, it deletes only the links — the alerts and incidents themselves are not deleted.

Unlinking removes the link and nothing else. The alert and the incident keep their states, and an alert that was acknowledged or resolved because of the incident stays that way — alert states never move backwards. Both feeds record the unlink.

## Permissions

Linking has four granular permissions of its own, in the **Incident** group of the [Permission Reference](/docs/permissions/reference):

| Permission                | What it allows                                                                     | Roles that include it                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Create Incident Alert** | Linking an alert to an incident, including when declaring an incident from alerts. | Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Alert Admin, Alert Member |
| **Delete Incident Alert** | Unlinking.                                                                         | Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Alert Admin, Alert Member |
| **Read Incident Alert**   | Seeing the **Linked Alerts** and **Linked Incidents** lists.                       | All of the above, plus Viewer, Incident Viewer and Alert Viewer                                          |
| **Edit Incident Alert**   | Nothing in practice — a link has no fields you can change.                         | Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Alert Admin, Alert Member |

Alert roles are included on purpose: somebody who works alerts can link them to incidents without being given incident roles.

Two more rules apply on top:

- **You must be able to see both sides.** A link is only created when you can read both the alert and the incident. Private alerts and incidents, and label restrictions, apply as usual.
- **A link belongs to its incident.** Whether you can see a link follows your access to its incident: label restrictions and owner scope on incidents apply to the link too.

Declaring an incident from alerts also needs permission to create incidents. In the dashboard, the linking and declaring actions are unavailable to people who lack these permissions. For how roles, granular permissions, labels and owner scope combine, see [Users, Teams & Permissions](/docs/permissions/index).

## The feed, Slack and Microsoft Teams

Every link and unlink is written to both feeds, credited to whoever made the change:

| Change    | Incident feed                        | Alert feed                                          |
| --------- | ------------------------------------ | --------------------------------------------------- |
| Linking   | **Alert Linked** (`AlertLinked`)     | **Linked to Incident** (`LinkedToIncident`)         |
| Unlinking | **Alert Unlinked** (`AlertUnlinked`) | **Unlinked from Incident** (`UnlinkedFromIncident`) |

Each entry names the other side by its number and links to it, so you can jump from the incident's feed to the alert and back.

**Only the incident's entry reaches Slack and Microsoft Teams.** **Alert Linked** and **Alert Unlinked** are posted wherever the incident's other feed updates go. The alert-side entries stay in the dashboard, so a link produces one message rather than two. See [Slack](/docs/workspace-connections/slack) and [Microsoft Teams](/docs/workspace-connections/microsoft-teams) for setting up those channels.

Both feeds' **Filter & Sort** menus list these event types, so you can show or hide link activity like any other kind of entry. More on the incident feed in [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed).

## Keeping alert states in step with the incident

By default, linking changes nothing about an alert's state. A linked alert stays where it is until somebody moves it, its on-call policy keeps escalating, and its reminders keep coming.

Two project switches let the incident carry its linked alerts along. Both are off by default. They live on the **Linked Alerts** card at **Incidents → Settings → More Settings** — click **Update** on the card to change them — and only Project Owners and Project Admins can:

- **Acknowledge Linked Alerts When Incident Is Acknowledged** — when the incident reaches your acknowledged state, every linked alert that is not yet acknowledged moves to your alert **Acknowledged** state. This is what stops those alerts' on-call escalations: the next escalation step sees an acknowledged alert and stops, within about a minute. Pages that already went out are not recalled. Alert reminders stop too when the alert's reminder rule has **Stop Reminders When** set to **Acknowledged**; otherwise they carry on until the alert is resolved.
- **Resolve Linked Alerts When Incident Is Resolved** — when the incident reaches your resolved state, every linked alert that is not yet resolved moves to your alert **Resolved** state, except an alert that is still linked to another incident that is not resolved. That alert is left open for the other incident — acknowledged, if the acknowledge switch is on too — and is resolved when the last of its incidents is.

### How the switches behave

- **Order, not names.** "Reaches" means the incident's current state is at or past the acknowledged or resolved state in your state order. A custom state between Acknowledged and Resolved, such as a **Monitoring** state, counts as acknowledged. Alerts are compared the same way, so an alert in a custom state past **Acknowledged** already counts as acknowledged.
- **Never backwards.** Only alerts behind the target state move. An alert that is already acknowledged is left alone by the acknowledge switch, and a resolved alert is never touched.
- **Resolving with only the acknowledge switch on** acknowledges the linked alerts, because resolved is past acknowledged.
- **Linking to an incident that is already acknowledged or resolved** applies the switches to the new alert straight away, as if the incident had just changed state.
- **Reopening an incident does not reopen its alerts.** Alerts cannot move to an earlier state.
- **Only the current state counts.** Adding a past entry to the incident's **State Timeline** — one with an **Ends At** — does not move any alert.
- **Linking alone never changes an alert's state.** With both switches off, the incident never moves its alerts.

The alerts change state in the background, just after the incident does. Each change goes through the alert's own state timeline with a cause such as "Acknowledged because linked Incident INC-42 was acknowledged.", so the alert's **State Timeline** and feed show why it moved. The alert's owners are not sent a state-change notification for it, but the state change is posted to Slack and Microsoft Teams like any other alert state change. One alert failing to move does not stop the others.

### Resolving alerts that come from monitors

Acknowledging is always safe for a monitor's alert: an acknowledged alert still counts as open, so the monitor keeps using it rather than opening another.

Resolving is different. If the monitor is still failing when its alert is resolved, the monitor's next check opens a fresh alert — and the fresh alert is not linked to the incident. If your incidents are often resolved before their monitors recover, keep just the acknowledge switch on, or resolve incidents only once their monitors are healthy.

## Deleting alerts and incidents

- **Deleting an alert** removes it from every incident it was linked to. The incidents are otherwise unchanged.
- **Deleting an incident** removes its links. The alerts are otherwise unchanged and keep their states.
- **Deleting a project** removes all of its links along with everything else.

None of these write **Alert Unlinked** or **Unlinked from Incident** feed entries — only an explicit unlink does.

## Where to read next

- [Incidents Overview](/docs/incidents/index) — how the incident feature fits together.
- [Declaring an Incident](/docs/incidents/declaring-incidents) — the declare form, templates, monitor criteria and the API.
- [Incident States & Severities](/docs/incidents/states-and-severities) — the state order the switches compare against.
- [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) — the incident feed where links are recorded.
- [Incident Settings & Automation](/docs/incidents/settings) — where the two switches live.
- [Users, Teams & Permissions](/docs/permissions/index) — roles, granular permissions and scope.
