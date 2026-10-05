# States & Severities

Every incident carries two classifications: a **state** that says where it is in your response, and a **severity** that says how much it hurts. In the dashboard they look alike — both render as colored pills on the incidents list and as a colored dot before the name wherever you pick one, both are project-scoped lists you can rename and recolor. They do very different jobs.

States drive behavior. Three boolean flags on the state rows decide which incidents count as active, which buttons appear on the incident header, when the SLA clock stops, and when the incident drops off your status page. Severities drive nothing by themselves — they are labels that describe impact, and that other rules can match on.

Both lists are seeded when your project is created, and both are edited under **Incidents → Settings**. That section of the Incidents side menu is collapsed by default, so expand **Settings** before you go looking for it.

## States carry behavior, severities carry meaning

The `IncidentState` model has `name`, `description`, `color` and `order`, plus three booleans: `isCreatedState`, `isAcknowledgedState` and `isResolvedState`. Everything the product does with states keys off those booleans and off `order` — never off the state's name. That is why you can rename **Resolved** to "Closed" and nothing breaks: the flag travels with the row.

The `IncidentSeverity` model has `name`, `description`, `color` and `order` and nothing else. There are no flags. Nothing in OneUptime treats **Critical Incident** differently from **Minor Incident** on its own — severity matters only where you point something at it, such as the **Incident Severities** match criterion on an on-call rule.

A few quick rules:

- **Pick severity to communicate impact** — it shows on the incidents list, on the incident's **Overview**, and it is a required field when you declare an incident.
- **Pick states to model your process** — the response steps you actually walk through, in the order you walk through them.
- **Do not encode urgency in states** — a state named "Critical" would not page anyone. Severity plus an on-call rule does that.

## The seeded states

Three states are created with the project, in this order. The seeding is idempotent — a state is only added when one with that name does not already exist.

| State            | `order` | Flag                  | Color     | What it means                                      |
| ---------------- | ------- | --------------------- | --------- | -------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | The state new incidents land in.                   |
| **Acknowledged** | `2`     | `isAcknowledgedState` | `#ffbf53` | Someone has picked the incident up.                |
| **Resolved**     | `3`     | `isResolvedState`     | `#2ab57d` | The incident is over and stops counting as active. |

Note the name: the first state is **Identified**, even though several descriptions inside the product still call it the "created" state. When a doc or a tooltip says "created state", it means whichever state carries `isCreatedState` — in a fresh project, that is **Identified**.

## What each state flag actually does

| Flag                  | Purpose                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | The state an incident gets when nobody picked one. If no state in the project carries this flag, creating an incident fails with an error telling you to add a created incident state from settings. |
| `isAcknowledgedState` | Powers the **Acknowledge** button and the "<state name> in" stat tile on the incident **Overview**. On a state change into this state, the incident's SLA is marked as responded.                    |
| `isResolvedState`     | Powers the **Resolve** button and the resolved stat tile, defines the **Active Incidents** list, and is what removes the incident from a status page's active section. Marks the SLA resolved.       |

Only one state per project is expected to hold each flag — the lookups fetch the first one in the order. The three flagged states carry a **Built-in** tag on the settings page; hover it (or tab to it) to read what OneUptime does with the state. They can be renamed, recolored and dragged, but:

- **They keep their order.** Created comes before acknowledged, and acknowledged before resolved. A drag that would break that — **Resolved** above **Acknowledged**, say — is refused, the rows go back, and the page says why.
- **They cannot be deleted.** Their **Delete** stays in the row's menu, locked, with the reason. A bulk delete skips them and lists them as not deleted. The API refuses to delete a project's last created, acknowledged or resolved state too.

Because the UI reads state names dynamically, renaming a state changes what you see everywhere — the stat tiles, the confirmation modal titles, and the pill on the incidents list all follow the name you gave the row.

## Adding your own states

Go to **Incidents → Settings → Incident State**. The page lists your states in their order, one row each: a grip to drag it by, its color and name, what an incident in it **Counts as**, and its description. The sentence under the title says it plainly: incidents only ever move down this list.

- **Create Incident State**, in the card's header, adds a state **just above the resolved state** — where most states belong, and never below it, where it would quietly count as resolved.
- **Drag a row by its grip** to move it. The new order is saved as you drop it; there is no order number to type. From the keyboard, focus the grip, press Space, move with the arrow keys and press Space again.
- **Edit** opens the same form as create. The state's ID is under **Show ID** in the row's menu.

**Fields on a state:**

- **Name** — required, at least two characters. The placeholder suggests something like "Investigating".
- **Description** — optional free text explaining when an incident sits in this state.
- **Color** — required, and already picked when the form opens: a color none of the states in the list uses yet, so a new state never comes out the same red as the one above it. Pick another from the color picker if you like; it is stored as a hex value like `#fd625e`. It colors the state's pill and the dot before its name in every state picker: the declare and template forms, the **Change State** bulk action, the header's state menu, and rule and filter conditions.

Every one of those pickers lists the states in the order this page puts them in.

You cannot set the three flags from this form — they belong to the seeded rows. A state you add is therefore an unflagged state, which has three consequences worth planning around:

- **Where it sits decides what it counts as.** The **Counts as** column shows it, and changes as you drag: above the acknowledged state an incident in it is **Not acknowledged**; from the acknowledged state down it counts as **Acknowledged**, so on-call policies stop escalating it; from the resolved state down it counts as **Resolved**, so status pages stop showing it as active.
- **It stays in Active Incidents.** **Active Incidents** is defined as "current state is not the resolved state", so anything you add other than the resolved state keeps the incident in the active list and in the sidebar count.
- **Its transition button is generic.** Instead of **Acknowledge** or **Resolve**, the confirmation modal is titled **Mark Incident as `<state name>`** with a **Mark as `<state name>`** submit button.

A common shape is a mitigation step between the acknowledged and resolved states — create "Mitigated" and it lands just above **Resolved**, after **Acknowledged**, counting as acknowledged. For a triage step before anyone has acknowledged the incident, drag it above **Acknowledged**.

## Order is a real constraint, not a display preference

The order is enforced when a state change is written, not just when the list is drawn:

- **Backwards transitions are rejected.** Moving an incident to a state that sits earlier in the order than its current state fails with an error naming both states.
- **Re-selecting the current state is rejected.** Setting an incident to the state it is already in fails with "Incident state cannot be same as previous state."
- **A backdated row cannot duplicate its neighbor.** Inserting a timeline row whose state matches the row that follows it is refused too.
- **The header buttons follow the flagged states' position in the order.** **Acknowledge** and **Resolve** are offered based on where the current state sits in the order-sorted list. A custom state placed *after* the resolved state will never show a **Resolve** button, because there is nothing left to move forward into.

So when you add a state, put it where an incident would genuinely pass through it. Ordering it wrong does not just look odd — it makes transitions impossible. Moving a state later changes how the incidents already in it count, the moment you drop it.

Through the API and Terraform the order is the `order` column: lower numbers come first. A state created without one goes just above the resolved state; one created or updated with a number takes that place, and the states in the way step down. Numbers nobody else holds are kept as written, so a Terraform-managed state reads back the number it was given.

## The seeded severities

Three severities are created with the project, in this order:

- **Critical Incident** (`order` 1, `#b70400`) — issues causing very high impact to customers, needing an immediate response. A full outage or a data breach.
- **Major Incident** (`order` 2, `#fd625e`) — significant impact, usually needing an immediate response, sometimes with a workaround that limits the damage. An important sub-system failing.
- **Minor Incident** (`order` 3, `#ffbf53`) — low impact, usually handled within working hours, and most customers are unlikely to notice. A slight drop in application performance.

Severity is required when you declare an incident, and it is required on each incident spec in a monitor's criteria, so every incident — manual or automatic — arrives with one. See [Declaring an Incident](/docs/incidents/declaring-incidents) for the declare flow and [Incident and Alert Templating](/docs/monitor/incident-alert-templating) for the monitor-driven path.

## Editing severities

Go to **Incidents → Settings → Incident Severity**. Same shape as the state page — one row per severity, most severe first, drag a row to change its rank, **Create Incident Severity** adds one at the end (the least severe), with **Name**, **Description** and **Color** on the form, the color already picked as on the state form.

The rank matters wherever OneUptime compares severities: an episode takes the severity of its most severe incident, and a monitor recommendation's Critical and Warning map onto your first and second severity.

Two differences from states:

- **There is no delete guard.** Any severity can be deleted, including the three seeded ones.
- **There are no flags to inherit, and no "Counts as".** A new severity behaves exactly like the seeded ones — it is a label with a color and a rank.

Where severity does more than describe: on **Incidents → Rules → On-Call Rules**, a rule's **Incident Severities** field is a match criterion. Listing **Critical Incident** there is how "page the database team for anything critical" gets expressed — the on-call policy lives on the rule, not on the severity.

## Moving an incident through its states

There are four ways an incident changes state:

- **The header buttons.** Open an incident. If its current state is before the acknowledged state, you get **Acknowledge** and **Resolve**; if it is between the two, you get **Resolve**. Each opens a short confirmation — **Acknowledge Incident** or **Resolve Incident** — with **Notify Status Page Subscribers** and, folded under **Add a public note**, the optional **Public Note** and its **Select Note Template** picker (when the project has note templates). Acknowledging also stops any on-call escalation for the incident.
- **The state timeline.** Add a row by hand from the incident's **State Timeline** page with **Incident Status**, **Starts At** and **Notify Status Page Subscribers**.
- **Bulk change.** The incidents list has a **Change State** bulk action for moving several incidents at once: one page with the state, **Notify Status Page Subscribers** and the same folded **Add a public note**.
- **Automatically.** A monitor criterion with **Auto Resolve Incident** enabled resolves its incident when the criterion is no longer met, and the API can update the state through `/api/incident-state-timeline`.

Every one of these writes a timeline row. A state change also does a few things you do not have to ask for: it posts an entry to the incident feed, assigns an Incident Commander if the incident does not have one yet, and updates the SLA clock. Reopening a resolved incident starts a fresh SLA record from the reopen time.

## The state timeline

The incident's **State Timeline** page in the incident side menu is the audit trail of every state the incident has been in. The card on that page is titled **Status Timeline**, and it is sorted newest first.

**Columns:**

- **Incident Status** — a colored pill with the state's name and color.
- **Starts At** — when the incident entered this state.
- **Ends At** — when it left. The current state shows `Currently Active`.
- **Duration** — time spent in the state, counted to now for the current one.
- **Subscriber Notification Status** — whether the status page notification for this change was sent, skipped or is still pending, with a **more details** link, and — when the send failed — a **Retry** action. **Retry** sends the state change again to every status page the incident reaches now, including the subscribers who already got it.

**Row actions:**

- **View Cause** — opens a **Root Cause** modal rendering the markdown recorded with that state change.
- **View Logs** — opens a modal explaining why the status changed, with an **Incident State Log** viewer.

Timeline rows can be created and deleted, but not edited. Deleting the wrong row rewrites the incident's history, so treat it as a correction tool rather than a cleanup habit.

## The Active Incidents list

**Incidents → Active Incidents** is the list you watch during a shift. Its definition is exactly one condition: the incident's current state is a state where `isResolvedState` is false. Nothing else is considered — not severity, not age, not whether anyone has acknowledged it.

The side-menu item carries a red count badge using the same query, so the badge and the list always agree. When there is nothing to see, the page says so.

The practical consequence: any custom state you add keeps incidents in this list. That is usually what you want — "Mitigated" is not "done" — but it does mean the badge only clears when incidents actually reach the resolved state.

## Telling status page subscribers about a state change

A state change can email your status page subscribers, but it goes through several gates. Understanding them saves a lot of "why didn't anyone get notified" debugging.

Notification is requested per timeline row by **Notify Status Page Subscribers** (`shouldStatusPageSubscribersBeNotified`), the checkbox on the state-change modal and on the manual timeline form. On the state-change modal it starts off when the incident was declared without notifying subscribers. The same checkbox also decides whether the modal's public note notifies anyone. When it is off, the row is stored with a skipped status and an explanation. When it is on, the row is queued and a background job picks it up — the job runs every minute, so delivery is quick but not instantaneous.

**The queued row is then skipped when any of these hold:**

- **The new state is the created state.** Subscribers were already told when the incident was declared, so the first timeline row deliberately does not send a second message.
- **The incident has no monitors attached.** With no resources, there is no status page to map the incident onto.
- **The incident is not visible on the status page** (`isVisibleOnStatusPage` is off).
- **The status page has incidents turned off** (`showIncidentsOnStatusPage` is off). This one is per status page — other pages showing the same monitor still get notified.
- **The status page is outside the incident's scope.** An incident limited to some status pages with **Limit to these status pages** notifies only those pages among the ones that list its monitors, and a page with **Only Show Incidents Scoped to This Page** on is never notified about an incident that is not limited to it. This is per status page too. See [One Status Page per Audience](/docs/status-pages/one-status-page-per-audience).

**One more thing that changes the outcome.** If you write a **Public Note** in the state-change modal (under **Add a public note**), the timeline row is marked as already notified rather than queued. The note itself is what reaches subscribers, so they get one message instead of two. The event type behind the plain state-change message is `Subscriber Incident State Changed`.

**Sent means every subscriber was sent it.** The job waits for each message and counts it sent or failed, per status page and channel, and the row's status message lists those counts. One failed message, or a send that ran out of time or was interrupted, makes the row **Failed**. See [Checking what was sent](/docs/status-pages/subscribers#checking-what-was-sent).

For who receives these and how the templates are chosen, see [Subscribers & Announcements](/docs/status-pages/subscribers).

## Keeping an incident off the status page

Four separate things decide whether an incident is on a public page at all, and all four must be true:

- **Show Incidents** (`showIncidentsOnStatusPage`) on the status page itself.
- **Visible on Status Page** (`isVisibleOnStatusPage`) on the incident — a toggle on the incident's **Settings** page. It defaults to true and is not on the declare wizard; a monitor criterion can set it with **Show Incident on Status Page**. An incident declared hidden tells no subscriber when it is created; when you turn this toggle on later, the edit form offers **Notify subscribers that this incident was created**. See [Declaring an Incident](/docs/incidents/declaring-incidents).
- **The page is in the incident's reach.** The page lists one of the incident's monitors and, if the incident is limited to some status pages, is one of them. A page with **Only Show Incidents Scoped to This Page** on shows only the incidents limited to it. See [One Status Page per Audience](/docs/status-pages/one-status-page-per-audience).
- **The current state is not the resolved state.** This is what removes an incident from the active section: the status page query fetches incidents whose current state is any unresolved state. You do not archive or close anything — you resolve it, and it moves into history.

**Private incidents never appear.** Turning on **Private Incident** hides the incident from every status page, regardless of the toggles above, and restricts it to its owners plus project admins and owners.

How much resolved history the page keeps is a status page setting, not an incident one. See [Status Page Resources & Groups](/docs/status-pages/resources-and-groups) for how monitors on the page decide which incidents show up at all.

## Where to read next

- [Incidents Overview](/docs/incidents/index) — how the incident feature area fits together.
- [Declaring an Incident](/docs/incidents/declaring-incidents) — the declare wizard, templates, and the API.
- [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) — public notes, private notes, and the activity feed.
- [Incident Settings & Automation](/docs/incidents/settings) — templates, custom fields, rules, and workflow triggers.
- [Subscribers & Announcements](/docs/status-pages/subscribers) — who gets the emails a state change sends.
- [One Status Page per Audience](/docs/status-pages/one-status-page-per-audience) — limiting an incident to some of the status pages that list its monitors.
- [Status Pages Overview](/docs/status-pages/index) — what a status page shows and to whom.
- [Workflows Overview](/docs/workflows/index) — reacting to state changes with automation.
