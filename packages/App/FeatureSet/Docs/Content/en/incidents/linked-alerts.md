# Linked Alerts

An outage rarely raises one alert. When the primary database falls over, the replication lag monitor fires, the API error rate monitor fires, and the checkout latency SLO starts burning — three alerts, one problem. Linking those alerts to the incident says so: the incident is where the response happens, and every alert shows which incident explains it.

A link is only a link. The alert keeps its own state, owners, on-call policies, notes and feed; the incident keeps its own. Linking merges and copies nothing, and on its own it never acknowledges, resolves or silences an alert. (Declaring a new incident from alerts is different: the new incident is prefilled from them, as [described below](#declaring-an-incident-from-alerts), and unless you untick the box on the form, the alerts are acknowledged as you declare it, which stops their escalation — see [Acknowledging the alerts as you declare](#acknowledging-the-alerts-as-you-declare).) If you want the incident to move its alerts along with it, turn on the two project switches described [further down](#keeping-alert-states-in-step-with-the-incident).

If you are coming from Opsgenie, this is OneUptime's version of associating alerts with an incident.

## At a glance

- **Many-to-many** — an incident can have any number of linked alerts, and one alert can be linked to several incidents.
- **Three places to link** — the incident's **Linked Alerts** page, the alert's **Linked Incidents** page, and the **Link to Incident** bulk action on the main alerts lists, for up to **50** alerts at a time.
- **Declare an incident from alerts** — **Declare Incident** on an alerts list, in an alert's header or on its **Linked Incidents** page prefills a new incident from the alerts and links them as it is created. A box on the form, ticked by default, acknowledges them too, which stops their own on-call escalation.
- **Recorded on both sides** — every link and unlink writes a feed entry on the incident and on the alert, except that an incident declared from alerts gets one entry listing them all. Only the incident's entries are posted to Slack and Microsoft Teams, and a private alert's or incident's title is never written on the other side.
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
- **Each pair is linked once.** Linking an alert to an incident it is already linked to is rejected with "This alert is already linked to this incident." — even when two people link the same pair at the same moment.
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

To link another alert, click **Link Alert** and pick it from the **Alert** dropdown. The dropdown lists the most recent alerts first, each with its number — such as `ALT-63: Checkout API is offline` — so alerts that share a title, as a monitor's repeated alerts do, can be told apart. To find an older alert, type: the dropdown searches every alert by title. Click **Link Alert** in the dialog to save. If the link is refused, for example because the alert is already linked, the dialog stays open and says why.

Each row has **View Alert** to open the alert and **Unlink** to remove the link.

## Linking incidents from an alert

The alert side mirrors the incident side. Open an alert and choose **Linked Incidents** in the **Basic** section of its side menu. The table lists every incident the alert is linked to, with the incident number, title and current state, and when and by whom it was linked.

- **Link Incident** links this alert to an existing incident. Its dropdown works like the one on the incident side: the most recent incidents first, each with its number — such as `INC-42: Checkout is down` — and typing searches every incident by title.
- **View Incident** opens a linked incident.
- **Unlink** removes a link.
- **Declare Incident** starts a new incident from this alert. The same button sits in the alert's header, next to **Acknowledge** and **Resolve**. See [Declaring an incident from alerts](#declaring-an-incident-from-alerts).

## Linking many alerts at once

The main alerts lists have two bulk actions for this: **All Alerts** and **Active Alerts**, the active alerts on the home page, and the **Alerts** page of a monitor, service, host, Kubernetes cluster, SLO or any other resource that has one. An alert episode's **Member Alerts** list does not have them — select the alerts on one of the main lists instead. Select the alerts, then choose:

- **Link to Incident** — pick the incident in the **Incident** dropdown and click **Link Alerts**. The most recent incidents are listed first, with their numbers, and typing searches every incident by title. OneUptime links every selected alert, showing progress as it goes. An alert that is already linked to that incident counts as done rather than failed, so running the action twice is harmless.
- **Declare Incident** — opens the declare form for a new incident prefilled from the selected alerts. See the next section.

Both actions take up to **50** alerts at a time. Select more and they are disabled, with a tooltip saying why. The cap exists because every link writes to both feeds, and every link made with **Link to Incident** is also posted to the incident's Slack and Microsoft Teams channels — a thousand-alert selection would flood them.

## Declaring an incident from alerts

When a burst of alerts turns out to be an incident nobody has declared yet, declare it from the alerts. There are three ways in:

- Select the alerts on one of the main alerts lists and choose **Declare Incident**.
- Open an alert and click **Declare Incident** in its header, next to **Acknowledge** and **Resolve**. It stays there once the alert is acknowledged or resolved, so you can still declare an incident for an alert after the fact — to run a postmortem on it, say.
- Open one alert's **Linked Incidents** page and click **Declare Incident**.

All three need permission to create incidents and to link alerts to them. Without it, the button is locked, and its tooltip names the missing permission.

Whichever you use, you land on the usual **Declare New Incident** form, with the alerts listed as the ones that will be linked and these fields prefilled:

| Field                  | Prefilled with                                                                                                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Title**              | One alert: its title. Several: the title of the most severe alert.                                                                                                                                                                                                                     |
| **Description**        | One alert: its description. Several: a list with one line per alert, giving its number and title.                                                                                                                                                                                      |
| **Incident Severity**  | The most severe alert's severity, translated to an incident severity. An incident severity with the same name, ignoring case, wins. Otherwise OneUptime takes the incident severity at the same position in the severity order, or the last one if you have fewer incident severities. |
| **Resources Affected** | Every monitor, host, Kubernetes cluster, Docker host, Podman host and service of the selected alerts, combined. Other resources, such as SLOs or VMware, Proxmox and Ceph clusters, are not copied — add them yourself if the incident affects them.                                   |
| **Labels**             | Every label of every selected alert.                                                                                                                                                                                                                                                   |
| **Private Incident**   | On if any of the alerts is private. The form says so, and the alerts' owners become owners of the incident — see below.                                                                                                                                                                |

"Most severe" follows your alert severity order: the first alert severity in the list is the most severe. With the severities every project starts with, a **High** alert becomes a **Critical Incident** and a **Low** alert a **Major Incident**.

Everything is editable before you submit.

**An alert that already has an incident is flagged.** With **Declare Incident** on every alert's page, two responders paged by the same outage can each declare it. So the banner listing the alerts marks each alert that is already linked to an incident — "(already linked to Incident INC-42)", linking to that incident — and adds a note, worded by how many of the alerts are linked:

- Every alert, and there is one: "This alert is already linked to an incident. If it is the same problem, update that incident instead of declaring another one."
- Every alert, and there are several: "These alerts are already linked to incidents. If it is the same problem, update that incident instead of declaring another one."
- Only some of them: "Some of these alerts are already linked to an incident. If it is the same problem, link the other alerts to that incident from the alerts list instead of declaring another one."

The incident links open in a new tab, so you can check the existing incident without losing what you have filled in on the form. The note is a reminder, not a block, and only incidents you are allowed to see are named.

**On-call policies are not copied.** The alerts ran their own on-call policies when they were created, so copying them onto the incident would page the same people a second time. The incident's on-call policies are whatever you pick on the **On-Call** step plus whatever your incident on-call rules add — exactly as for any other incident.

**The alerts' monitors are prefilled as affected monitors.** As with any incident declared by hand, active monitoring on the incident's monitors pauses until the incident is resolved. Remove a monitor from **Resources Affected** before you submit if it should keep being checked.

**A private alert makes a private incident.** If any of the alerts is private, **Private Incident** starts switched on, and the banner listing the alerts says so. A private incident is visible only to its owners, Project Owners and Project Admins, so OneUptime makes sure the people who could see the alerts can see the incident: once it is declared, the owners of every declared alert — users and teams alike — are added as owners of the incident, without being notified. They are added just after the incident's Slack and Microsoft Teams channels are created, so they are invited to those channels like any other owner. You are an owner as well, as with any incident you declare. The same happens when an incident privacy rule makes the new incident private. If you switch **Private Incident** off before submitting and no privacy rule applies, the incident is not private and no owners are copied.

When you submit, the server checks the alerts before it creates anything: at most 50 of them, each an alert in this project that you are allowed to see, and you must be allowed to link alerts to incidents. If any check fails, the request is rejected and no incident is created — so a bad alert id never uses up an incident number. Once the incident exists — and once its privacy rules have run, so the links know whether it is private — every alert is linked before the request returns, so the incident's **Linked Alerts** page already lists them. If a single link fails — say, because the alert was deleted a moment earlier — the incident is still declared and the other alerts are still linked.

The incident's feed gets one **Alert Linked** entry listing the alerts, written after **Incident Created**, rather than one per alert — see [The feed, Slack and Microsoft Teams](#the-feed-slack-and-microsoft-teams).

### Acknowledging the alerts as you declare

Declaring an incident does not, on its own, stop its alerts paging: an alert's on-call escalation stops only once the alert itself is acknowledged. So when any of the alerts is not acknowledged yet, the banner on the form has a checkbox, ticked by default — **Acknowledge this alert to stop its escalation** for one alert, **Acknowledge these 3 alerts to stop their escalation** for several. If some of them are already acknowledged, it names only the others and says the rest are left as they are.

Leave it ticked and, once the incident is declared and the alerts are linked:

- **The alerts are acknowledged as you.** Each moves to your alert **Acknowledged** state as if you had clicked **Acknowledge** on it yourself: the alert's **State Timeline** and feed name you, the alert's owners are notified, and the change is posted to the alert's Slack and Microsoft Teams channels like any other alert state change. The cause reads "Acknowledged because Incident INC-42 was declared from this alert." — or, for a private incident, "Acknowledged because a private incident was declared from this alert.", so a private incident is never named where the alert's audience can read it.
- **Their own on-call escalation stops within about a minute.** The next escalation step sees an acknowledged alert and stops. Pages that already went out are not recalled.
- **Reminders stop only if the reminder rule says so.** An alert's reminders stop on acknowledgement only when its reminder rule has **Stop Reminders When** set to **Acknowledged**; otherwise they carry on until the alert is resolved.
- **An alert episode keeps escalating.** If an alert belongs to an episode that pages through its own on-call policy, the episode keeps escalating until the episode itself is acknowledged.
- **Alerts already acknowledged or resolved are left alone.** As everywhere else, states are compared by their order, so an alert in a custom state after **Acknowledged** counts as acknowledged, and nothing is ever moved backwards.

Untick the box to declare without acknowledging. Whenever alerts will be left unacknowledged — the box is unticked or locked — the form says so: "Declaring the incident does not acknowledge the alert: it keeps escalating until it is acknowledged." And if you acknowledge the alerts without choosing an on-call policy for the incident, the **On-Call** step's summary points out: "The alerts it is declared from are acknowledged too, so their own escalation stops. An alert episode they belong to keeps escalating until the episode is acknowledged, and an incident on-call rule, if any, may still page."

**You need permission to acknowledge the alerts.** Acknowledging writes the alert's state timeline and changes the alert, so it takes **Create Alert State Timeline** and **Edit Alert**: Project Owner, Project Admin, Project Member, Alert Admin and Alert Member have both, while Incident Admin and Incident Member, who can declare incidents from alerts, have neither. Your label and owner scope on alerts must include each alert that will be acknowledged, too — only the ones not acknowledged yet are checked. Alerts that are already acknowledged or resolved need no permission and never block the declaration. Without the permissions the box is locked, with a tooltip naming the missing one, and you can still declare the incident. The server checks again before it creates anything, for each alert it will acknowledge: if you may not acknowledge one of them, no incident is created and the form says why — untick the box and submit again.

**The project needs an Acknowledged alert state.** Every project starts with one. If yours has none, the box is not offered.

The alerts are acknowledged in the background, just after they are linked, a few at a time — up to 5 at once — so the incident's page can open a moment before they are, and declaring from many alerts does not leave the last of them waiting behind all the others. An alert that cannot be acknowledged — because it was deleted in the meantime, say — is logged and never stops the others or the incident, and an alert that somebody else acknowledges or resolves in the meantime is left as they left it.

**With the project's linked alert switches on, the switches may move the alerts instead.** If the incident is declared straight into an acknowledged or resolved state and one of the [linked alert switches](#keeping-alert-states-in-step-with-the-incident) acts on that state, the switch moves the linked alerts as they are linked, and the box leaves those alerts to it, so that each alert has one writer. They are acknowledged or resolved the way the switch does it — with the switch's cause, such as "Acknowledged because linked Incident INC-42 was acknowledged.", which names the incident by its number even when it is private — they are not credited to you, and their owners are not notified. Declaring into your first incident state, as usual, or with the switches off (the default), leaves every alert to the box.

### Declaring through the API

`POST /api/incident` accepts the alert ids to link in `miscDataProps`, under `alertIdsToLink`, and whether to acknowledge those alerts under `acknowledgeAlertsToLink`:

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
      "alertIdsToLink": ["<alert-id>", "<another-alert-id>"],
      "acknowledgeAlertsToLink": true
    }
  }'
```

`alertIdsToLink` is an array of 1 to 50 alert ids. Duplicates are ignored, and the same checks apply as in the dashboard, before the incident is created. Nothing is prefilled over the API — send the title, severity and resources you want. The API key needs permission to create incidents and to link alerts to them, and it must be able to read the alerts. An API key is not a user, so links made with one have no **Linked By**. For the rest of the request body, see [Declaring an Incident](/docs/incidents/declaring-incidents).

`acknowledgeAlertsToLink` is optional, and off unless you send it. Set it to `true` to acknowledge the alerts once they are linked, as the form's box does — alerts already acknowledged or resolved are left alone and need no permission. Leave it out, or send `false`, to declare without acknowledging them. It is checked along with the alert ids, before the incident is created, and the request is rejected with a 400 when:

- it is anything other than `true` or `false`;
- it is sent without `alertIdsToLink`;
- the project has no Acknowledged alert state;
- the API key may not acknowledge every alert that is not acknowledged yet — that takes **Create Alert State Timeline** and **Edit Alert**, with a label scope that includes each of those alerts.

An API key is not a user, so alerts acknowledged with one are credited to nobody, just as its links have no **Linked By**.

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

Unlink from either side: **Unlink** on a row of the incident's **Linked Alerts** page or the alert's **Linked Incidents** page, then confirm. To unlink several at once, select the rows and choose the bulk **Unlink** action. It removes only the links — the alerts and incidents themselves are not deleted.

Unlinking removes the link and nothing else. The alert and the incident keep their states, and an alert that was acknowledged or resolved because of the incident stays that way — alert states never move backwards. Both feeds record the unlink.

## Permissions

Linking has four granular permissions of its own, in the **Incident** group of the [Permission Reference](/docs/permissions/reference):

| Permission                | What it allows                                                                                                         | Roles that include it                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Create Incident Alert** | Linking an alert to an incident, including when declaring an incident from alerts. You must also be able to read both. | Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Alert Admin, Alert Member |
| **Delete Incident Alert** | Unlinking.                                                                                                             | Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Alert Admin, Alert Member |
| **Read Incident Alert**   | Seeing the **Linked Alerts** and **Linked Incidents** lists.                                                           | All of the above, plus Viewer, Incident Viewer and Alert Viewer                                          |
| **Edit Incident Alert**   | Nothing in practice — a link has no fields you can change.                                                             | Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Alert Admin, Alert Member |

Alert roles are included so that people who work alerts can link them, and incident roles so that people who work incidents can. Neither is enough on its own, because a link is only created when you can read both sides:

- **An alert role also needs read access to incidents** — add Viewer, Incident Viewer or Read Incident.
- **An incident role also needs read access to alerts** — add Viewer, Alert Viewer or Read Alert.

Three more rules apply on top:

- **You must be able to see both sides.** A link is only created when you can read both the alert and the incident. Private alerts and incidents, and label restrictions, apply as usual.
- **A link belongs to its incident.** Whether you can see a link follows your access to its incident: label restrictions and owner scope on incidents apply to the link too.
- **Linking needs read access to an alert, not edit access.** With the project's linked alert switches on, that is enough for a link to acknowledge or resolve the alert — see [Who moves a linked alert](#who-moves-a-linked-alert).

Declaring an incident from alerts also needs permission to create incidents, and acknowledging its alerts as you declare needs **Create Alert State Timeline** and **Edit Alert** on each of them that is not acknowledged yet — see [Acknowledging the alerts as you declare](#acknowledging-the-alerts-as-you-declare). In the dashboard, an action you lack a permission for is locked, and its tooltip names the missing permission. That includes read access to the other side: **Link Alert** is locked if you cannot read alerts, and **Link Incident** and **Link to Incident** if you cannot read incidents. For how roles, granular permissions, labels and owner scope combine, see [Users, Teams & Permissions](/docs/permissions/index).

## The feed, Slack and Microsoft Teams

Every link and unlink is written to both feeds, credited to whoever made the change:

| Change    | Incident feed                        | Alert feed                                          |
| --------- | ------------------------------------ | --------------------------------------------------- |
| Linking   | **Alert Linked** (`AlertLinked`)     | **Linked to Incident** (`LinkedToIncident`)         |
| Unlinking | **Alert Unlinked** (`AlertUnlinked`) | **Unlinked from Incident** (`UnlinkedFromIncident`) |

Each entry names the other side by its number and links to it, so you can jump from the incident's feed to the alert and back. It gives the other side's title too, unless that side is private:

- **A private alert's title stays out of the incident's entry**, and so out of Slack and Microsoft Teams. The entry reads, for example, "Linked Alert #12 (private alert) to Incident #5".
- **A private incident's title stays out of the alert's entry**, which reads "Linked to Incident #5 (private incident)".

This holds even when both are private, because a private alert and a private incident can have different owners. Opening the linked alert or incident is subject to its own privacy, as usual.

**Only the incident's entries reach Slack and Microsoft Teams.** **Alert Linked** and **Alert Unlinked** are posted wherever the incident's other feed updates go. The alert-side entries stay in the dashboard, so a link produces one message rather than two. See [Slack](/docs/workspace-connections/slack) and [Microsoft Teams](/docs/workspace-connections/microsoft-teams) for setting up those channels.

**Declaring an incident from alerts writes one entry, not one per alert.** The links made as the incident is declared write no **Alert Linked** entries of their own. Instead, once the incident's **Incident Created** entry is out — and the incident's own Slack and Microsoft Teams channels, if you use them, have been created — the incident gets a single **Alert Linked** entry: "Declared from 3 alerts:", followed by one line per alert with its number and title (a private alert without its title). That is the one message posted to Slack and Microsoft Teams. Each alert still gets its own **Linked to Incident** entry.

Both feeds' **Filter & Sort** menus list these event types, so you can show or hide link activity like any other kind of entry. More on the incident feed in [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed).

## Keeping alert states in step with the incident

By default, linking changes nothing about an alert's state. A linked alert stays where it is until somebody moves it, its on-call policy keeps escalating, and its reminders keep coming. The one exception is declaring an incident from alerts with the form's box left ticked, which acknowledges them as you declare — see [Acknowledging the alerts as you declare](#acknowledging-the-alerts-as-you-declare).

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

### Who moves a linked alert

Turning a switch on hands the linked alerts' states to the incident, by design: the incident is where the response is run, so whoever runs the incident runs its alerts too. From then on:

- **Whoever can change an incident's state moves its linked alerts.** Acknowledging or resolving the incident acknowledges or resolves them.
- **Whoever can link an alert can move it.** Linking an alert to an incident that is already acknowledged or resolved moves the alert as it is linked.

Neither needs permission to edit the alerts. OneUptime moves them itself, and linking needs only read access to an alert. So with the acknowledge switch on, anybody who can link alerts or change incident states can acknowledge — and stop the on-call escalation of — any alert they can see; with the resolve switch on, they can resolve it. That is why only Project Owners and Project Admins can turn the switches on. Leave them off if alert states should only ever be changed by people who can edit alerts.

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
