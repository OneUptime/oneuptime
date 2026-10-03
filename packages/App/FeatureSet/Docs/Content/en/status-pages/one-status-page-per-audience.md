# One Status Page per Audience

Different people need different news. A client does not want to hear about another client's outage, and the staff at one site do not want an email every time a different site loses its network. In OneUptime the unit of audience is the status page: each one has its own subscribers, its own branding and its own privacy. So give each audience a page of its own, and decide incident by incident which pages hear about it.

Shared infrastructure used to make that hard. An incident reaches a status page through its monitors, so a monitor shared by ten site pages told all ten sites about an outage that affected two. The only workaround was a page, or a monitor, for every combination of sites. This page covers the settings that fix that:

- **Limit to these status pages** on an incident, so it shows on, and notifies, only the pages you pick.
- **Only Show Incidents Scoped to This Page** on a status page, so an incident nobody has scoped yet reaches none of these pages until someone decides. That includes the incidents a monitor, Slack, Microsoft Teams, the API or AI opens on its own.
- A record of which pages were told that an incident was created, so a page you add later is told once and the others are not told again.
- A **Will notify** summary that shows who will hear about an incident before you declare it or post a public note, and **Preview notification**, which shows what each page's subscribers will get.

## When to use it

- **A managed service provider** with a status page per client, on monitors the clients share.
- **An organization with sites, plants or regions**, each with its own staff to tell.
- **Internal IT** with a page per department or building.

If your audience is happy to choose for itself, one page may be enough: let subscribers pick the resources they care about (see [Subscribers & Announcements](/docs/status-pages/subscribers)). Use a page per audience when you make the choice for them, incident by incident, or when one audience must not see another audience's incidents at all.

## How an incident reaches a status page

An incident reaches a status page through its monitors. A page shows an incident, and notifies its subscribers about it, when one of the page's resources is one of the incident's monitors, directly or through a monitor group on the page. Two settings narrow that:

- **Limit to these status pages** on the incident (`statusPages`). Left empty, the incident reaches every page that lists its monitors, as it always has. With pages picked, it reaches only the picked pages **among** the ones that list its monitors.
- **Only Show Incidents Scoped to This Page** on the status page (`onlyShowScopedIncidents`, off by default). With it on, the page never shows, and never notifies anyone about, an incident that is not limited to specific status pages.

For a page that lists one of the incident's monitors:

| The incident is                                  | Page with **Only Show Incidents Scoped to This Page** off | Page with it on         |
| ------------------------------------------------ | --------------------------------------------------------- | ----------------------- |
| Not limited to any status page                   | Shown and notified                                        | Not shown, not notified |
| Limited to status pages, and this page is picked | Shown and notified                                        | Shown and notified      |
| Limited to status pages, but not this one        | Not shown, not notified                                   | Not shown, not notified |

A page that lists none of the incident's monitors never shows it, whatever you pick, and an incident with no monitors notifies no status page subscriber at all. The usual rules still apply on top: the incident must be **Visible on Status Page** and not private, the page must have **Show Incidents** on, and a subscriber who chose only some resources or event types gets only what they chose.

The same rules decide everything that depends on which pages an incident reaches:

- the incident lists, the overview and the incident's own page on the public status page, and the status page [Public API](/docs/status-pages/public-api);
- the email, SMS, Slack, Microsoft Teams and webhook messages sent when the incident is created, changes state, gets a public note or gets a postmortem;
- the incident counts in emailed status page reports, which count only the incidents the page shows.

An incident episode reaches a page when at least one of its incidents does. Its notifications go to every page its incidents reach, and its page on a status page that none of them reach is not found.

## Setting up one page per audience

1. **Create a status page for each audience**, for example `Site 01` to `Site 10`. Make them private if the audience is internal (see [Restricting who can see the page](/docs/status-pages/index#restricting-who-can-see-the-page)). Subscribers of a private page can still unsubscribe without signing in, through the link in every message (see [Managing and canceling a subscription](/docs/status-pages/subscribers#managing-and-canceling-a-subscription)). Give them labels such as `Region East`, so the picker can add every page with a label in one click.
2. **Put the shared monitor on each page** as a resource (see [Status Page Resources & Groups](/docs/status-pages/resources-and-groups)). A rule under **Resources → Monitor Rules** can do this for you from the monitor's labels.
3. **Turn on Only Show Incidents Scoped to This Page** on each of those pages. It is in the **What your status page shows** card on **Status Pages → your page → Advanced → Advanced Settings**, under **Show Incidents**, and it saves the moment you flip it. From then on, nothing reaches a site page unless someone picks it.
4. **Add each audience's subscribers** to its page. For staff, use **Add in Bulk** on **Email Subscribers**, and prefer each person's own address to a mailing list such as `site03-all@`: anyone on the list can unsubscribe it for everyone on it. If a subscriber you added unsubscribes, the page's owners and whoever added it are emailed (see [Shared addresses and mailing lists](/docs/status-pages/subscribers#shared-addresses-and-mailing-lists)).
5. **Let responders read status pages.** The picker lists only the status pages the person can read, and the incident roles cannot read status pages. Give responders the **Status Page Viewer** role next to their incident role; it can be limited to pages with certain labels. Without it the picker is empty.
6. **Decide what every message says.** At **Incidents → Settings → Custom Fields**, define the incident custom fields your team answers every time, for example `Impact` (a dropdown), `Expected Resolution` (a date and time) and `Acknowledgement` (a yes/no switch). Drag them into the **Order** you want them asked and listed in, and turn on **Show on Create** so the declare form asks for them, **Required on Create** where an answer is a must, and **Include in Subscriber Notifications** for the ones every audience may read. Those are then in the default email of every page. See [Custom fields](/docs/incidents/settings#custom-fields).
7. **Optionally, brand each page's email.** On the **Scale** plan, give each page a **Custom SMTP Config** and link custom templates for the incident events; they can place any field with `{{incident.customFields.<key>}}`. While you write a template, **Live preview** under it shows it filled in with sample values. See [What a custom template needs](/docs/status-pages/subscribers#what-a-custom-template-needs), and [What every message carries](#what-every-message-carries) before you use `{{affectedStatusPages}}`.
8. **Optionally, save incident templates with pages already picked.** A `Region East outage` template can carry the East site pages, and default answers for the custom fields.
9. **Check each page's email before the first outage.** Start **Declare Incident** with the shared monitor and two of the site pages picked, and on the summary before you submit, open **Preview notification**: it shows the email each page's subscribers would get, and which template it uses and why. **Send test to me** sends one to your own inbox. Nobody else is sent anything until you declare the incident, so leave the form without submitting it when you are done. See [Who will be notified](#who-will-be-notified).

## Limiting an incident to status pages

### When you declare it

On **Incidents → All Incidents → Declare Incident**, the **Resources Affected** step has **Limit to these status pages** right after the resources. Its placeholder, **Every status page that lists the monitors**, is what leaving it empty means. Pick pages by name, or open the picker's **Labels** tab and pick a label to add every page that carries it.

The form warns you:

- when a picked page lists none of the incident's monitors, or no monitor is attached at all. The incident will not show on that page or notify its subscribers;
- when you also set **Change Monitor Status to**. See [Monitor status is shared](#monitor-status-is-shared);
- when you also tick **Private Incident** on the **More** step. Private incidents are hidden from all status pages, including the ones you picked.

The **Details** step, right after **Resources Affected**, asks for the incident custom fields marked **Show on Create** (see [Declaring Incidents](/docs/incidents/declaring-incidents)). Its answers go to every page the incident reaches: custom field values belong to the incident, not to a status page.

**Create from Template** fills the field from the template. A template's pages are set on its **Resources Affected** step when you create it, and on its **Status Page Scope** card afterwards (**Incidents → Settings → Incident Templates**). As with the other template fields, a list you set yourself wins. A template's pages are filled in even for a responder who cannot read status pages: whoever set up the template chose them for everyone who declares from it.

### Who will be notified

Under **Notify Status Page Subscribers** on the **More** step, and again on the summary before you submit, the form shows who the incident will reach:

> Will notify:
>
> - Site 03 (up to 41 email)
> - Site 07 (up to 18 email)

Below that, under **Not notified:**, it lists the pages that list the monitors but will not be told, and why: not one of the pages the incident is limited to, a page that only shows incidents limited to it, or a page that does not show incidents.

When nobody will be told, the summary shows nothing: the incident has no monitors, no status page lists them, the pages have no subscribers yet, **Notify Status Page Subscribers** is off, or the incident is private. It warns only when the status page scope is the reason, and names the pages it leaves out: the incident is not limited and the pages that list its monitors only show incidents limited to them, it is limited to other pages, or the pages it is limited to list none of its monitors. On the summary, **Notify Status Page Subscribers** reads **Yes** or **No** like every other box, and **Preview notification** is not offered while the box is off, the incident is private, or no monitor is attached.

The same summary appears under **Notify Status Page Subscribers** when you write a note on the incident's **Public Notes** page, for the incident as it stands. There it also says when the incident is hidden from status pages, since nothing will be sent then.

The counts are "up to". They count the confirmed subscribers of each page who have not unsubscribed, per channel, and a subscriber who picked only some resources or event types may not get this message. Pages you cannot read are not named. They are counted as "more status pages you do not have access to".

**Preview notification**, on the summary and under the note's checkbox, shows what they will get: pick a page to see its email as its subscribers will receive it, with its subject, and which template it uses and why, for example that a page's custom template is not used because the page has no **Custom SMTP Config**. **Send test to me** sends the page's email to your own account email, and to nobody else. Pages you cannot read are counted but not previewed. See [Previewing the email before it is sent](/docs/status-pages/subscribers#previewing-the-email-before-it-is-sent).

### After it is declared

Open the incident and go to **Advanced → Settings**. The **Status Page Scope** card lists the pages the incident is limited to, and **Edit Status Page Scope** changes them. The incident's **Overview** shows the same list as **Status Page Scope**, read only, with a **Change in Settings** link.

On **Incidents → All Incidents**, the **Status Page** filter finds the incidents limited to the pages you pick, or the ones not limited to any page.

### Through the API

`statusPages` is a list of status page ids, on `POST /api/incident` and on updates to an incident, and on incident templates. Every page must belong to the incident's project; a page from another project is refused. Every page you add must also be one you can read, as in the picker, or the request is refused. Pages the incident or template already holds are kept whether or not you can read them, and a page of an incident template you can read may be picked when you declare an incident. Two more columns follow from it, and neither is yours to set:

- `isScopedToStatusPages` is worked out from `statusPages`. Anything you send for it is ignored.
- `statusPagesNotifiedOnCreation` is the record of the pages that were told the incident was created. See [Adding status pages](#adding-status-pages).

To see who an incident would reach without sending anything, call the audience endpoint:

```bash
curl -X POST https://oneuptime.com/api/incident/subscriber-audience \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "monitorIds": ["<monitor-id>"],
    "statusPageIds": ["<status-page-id>"]
  }'
```

Send `{"incidentId": "<incident-id>"}` instead for an incident that exists. The answer lists each page that will be notified with a count per channel (`email`, `sms`, `slack`, `microsoftTeams`, `webhook`), the pages left out and why, and `hiddenStatusPageCount` for the pages the caller cannot read. It never returns an address.

## Incidents nobody has scoped yet

Monitor criteria, Slack, Microsoft Teams, the API and AI can all open an incident on their own, and none of them knows which sites a failure on a shared monitor affects. Such an incident is not limited to any page, so every page that lists the monitor would show it, and notify its subscribers, within about a minute. Once a subscriber has been sent an email, it cannot be taken back.

**Only Show Incidents Scoped to This Page** is what stops that. A page with it on ignores every unscoped incident. The incident is still opened, on-call policies still page the responders, and its owners are still told, but none of these pages hears about it. A responder then works out who is affected and adds those pages on the incident's **Settings** tab, with **Send the incident-created notification to newly added pages** ticked. Their subscribers are told within about a minute.

## Adding and removing status pages

### Adding status pages

Subscribers of a page hear that an incident was created once. So when you add pages on the **Status Page Scope** card, the edit form offers **Send the incident-created notification to newly added pages**, ticked by default:

- Ticked, the incident's 'created' notification is queued again, and it goes only to the pages that were not told yet. The incident keeps a record of the pages that were told, so the others do not hear it twice.
- Unticked, the added pages start showing the incident, and hear about everything from now on, but are not told it was created.

The checkbox only appears when ticking it would send something: at least one page you add was not told yet, and the incident was declared with **Notify Status Page Subscribers** on, is visible on status pages and is not private. Some cases are handled for you:

- **The notification is still queued, or being sent right now.** A queued send reads the pages when it goes out, and a send that is running reads them again when it finishes and then tells the pages added meanwhile. So there is no checkbox: the pages you add are told either way. (If that send fails, the pages added meanwhile are among the ones its **Retry** sends to.)
- **Every page you add was told already**, for example a page you removed and add back, or an incident that reached every site and is now narrowed to two of them. Nobody is told again, so there is no checkbox.
- **The incident was never announced.** When it was published without **Notify subscribers that this incident was created**, or declared without monitors, nobody was told. Ticking the checkbox tells only the pages you add, not the pages it was already limited to.
- **The incident was declared before this feature was released.** Its 'created' notification went out to every page that listed its monitors, and there is no record of those pages. Adding pages does not send it again, so the checkbox is not offered.
- **The incident is hidden.** Nothing is sent while it is hidden. When you turn **Visible on Status Page** back on, the **Incident Settings** card offers **Notify subscribers that this incident was created** for the pages of its scope that were never told, such as the ones added while it was hidden.

A page added later hears about what happens next: later public notes, state changes and the postmortem. It is not sent the notes and state changes that went out before it was added. If it needs to catch up, post a public note.

The same record makes **Retry** on a failed 'created' notification resume where it stopped: pages that were already told are skipped. A page counts as told only when every one of its subscribers was sent the message; a page where a message failed, or that the send stopped part-way through, is sent it again in full. The record is written as each page finishes, so this holds even for a send that was interrupted. It is kept per page, not per subscriber: the subscribers of a page the send stopped part-way through who were already sent the message get it a second time.

To start over instead, for example after fixing a template or an SMTP setting, tick **Send it to every status page again, including the pages already reached** in the **Retry** confirmation: the button becomes **Resend to all pages**, the record is emptied, and every page the incident reaches now is sent it again. After a notification that went out in full, the **Subscriber Notification Status** on the incident's **Overview** offers **Resend**, which does the same. Both confirmations list the pages it would reach now, or say that it would reach nobody; the plain **Retry** confirmation lists the pages already reached as not sent again, since it skips them. Neither is offered for a notification that was skipped, or that is still queued or being sent, nor to someone who may not edit the incident.

Through the API, send `"miscDataProps": {"notifyAddedStatusPagesOfIncidentCreated": true}` with the update that changes `statusPages`. Setting `subscriberNotificationStatusOnIncidentCreated` back to `Pending` yourself still resends the 'created' notification to every page the incident reaches, as it always did: the record is emptied with it. After a failure it resumes where the failed send stopped instead. To send it to every page after a failure too, add `"miscDataProps": {"resendIncidentCreatedToAllStatusPages": true}` to that update. That request is refused for a notification that was skipped, or that is queued or being sent.

### Removing status pages

Removing a page recalls nothing. The page stops showing the incident, and its subscribers hear nothing more about it, not even that it was resolved. When you remove a page that was already told about the incident, the edit form warns you and suggests a closing public note. Post that note first, while the page is still in the list, and then remove the page.

Clearing the whole list is different from removing pages: the incident is then not limited at all. It is shown on, and notifies, every page that lists its monitors again, except the pages that only show incidents limited to them. The form warns you about that too.

### When a picked status page is deleted

Deleting a status page removes it from every incident that was limited to it. An incident whose picked pages have all been deleted stays limited, to nothing: it is hidden from every status page rather than shown on every page that lists its monitors. The **Status Page Scope** card says so. Pick other pages, or clear the list, to show it again.

Incident templates work the same way. A template whose pages have all been deleted stays limited: an incident that a workflow's **Create One Incident** step or a [form](/docs/forms/on-submit#the-incident-template) declares from it is hidden from every status page, the template's **Status Page Scope** card warns you, and **Declare Incident** starts with no page picked and asks you to pick the pages the incident is for. Pick other pages on the template, or save its list empty to stop limiting the incidents declared from it.

## One email per person

For an incident limited to specific status pages, an email address or phone number subscribed on more than one of those pages gets one email or text message per send, not one per page. Pages are visited in name order, so the first page's template, branding and unsubscribe link are the ones that person gets.

Webhook, Slack and Microsoft Teams messages are never merged. Their payloads name the status page they are for, and an integration that listens per page has to see every page.

This applies within one send only. Someone subscribed on `Site 03` and `Site 05` who got the 'created' email through `Site 03` gets it again when `Site 05` is added later. An incident that is not limited to any page sends one message per subscription, as it always has.

## What every message carries

Every page the incident reaches gets the same values: they belong to the incident, not to a status page.

- **Custom fields in the default messages.** Incident custom fields with **Include in Subscriber Notifications** on are listed in the created, state change, public note and postmortem messages of every page, in their **Order**: email, Slack, Microsoft Teams and webhooks, but not SMS. This needs neither the Scale plan nor custom SMTP. See [Incident custom fields in notifications](/docs/status-pages/subscribers#incident-custom-fields-in-notifications).
- **Updates.** Changing a custom field on its own tells nobody. The next public note or state change carries the current values, so to tell the sites that `Expected Resolution` moved, change the field and then post a public note.
- **Note templates.** Picking a note template fills in placeholders such as `{{incident.title}}` and `{{incident.customFields.<key>}}` with the incident's current values, and you can still edit the note before posting it. See [Note templates](/docs/incidents/settings#note-templates).
- **The names of the other audiences.** `{{affectedStatusPages}}` in a custom subscriber template, and `{{incident.affectedStatusPages}}` in a note template, list the pages the incident reaches, and everyone the message goes to reads the list: the subscribers of `Site 03` learn that `Site 07` is affected too. Between sites of one organization that may be what you want. Between clients it tells one client about another, so leave both out of the templates and notes those pages get.

## How this differs from scheduled maintenance

Scheduled maintenance events have a **Status Pages** list too, but it works differently:

- **Scheduled maintenance replaces.** The event shows on exactly the pages in its list, whether or not they list its monitors.
- **An incident narrows.** Its list only picks among the pages that already list its monitors. Picking a page that lists none of them does nothing, and the form says so. Put the monitor on that page first.

That keeps a mistaken pick from putting an incident on a page about something else entirely. It also means an incident with no monitors reaches no status page, however many you pick.

## Monitor status is shared

A monitor has one status, and every status page that lists the monitor shows it. Limiting an incident does not change that. If the incident sets **Change Monitor Status to**, or the monitor goes down on its own, the monitor turns red on every page that lists it, including pages the incident is not limited to and pages that only show incidents limited to them. The declare form warns you when you combine a status change with picked pages.

**When each site needs a status of its own, give each site a Manual monitor.** Create a [Manual Monitor](/docs/monitor/manual-monitor) per site, for example `Site 03 network`, and list it only on that site's page. Attach the affected sites' Manual monitors to the incident, with **Change Monitor Status to** if you want their status to change, and leave the shared monitor for the pages that should see it. The incident then reaches exactly the sites whose monitors it carries, and a status change shows only on their pages.

## What is recorded

- **The incident feed.** The 'created' entry of a limited incident lists the pages it is limited to. Every change to the list adds an entry listing the pages added and removed, and whether the added pages will be sent the 'created' notification.
- **Each subscriber notification.** The **Subscriber Notification Sent** entry in the incident feed has a **More Information** panel listing each page the send went to: how many messages were sent and how many failed on each channel, and the subject its email went out with. It also lists the pages it passed over and why (already told, or not showing incidents), the pages the scope left out, and whether email and SMS were sent once per address. When the send put custom field values into a message, the panel ends with them, under **Custom fields sent**.
- **The notification's status.** Each notification's status message says, for each page, how many messages were sent and how many failed on each channel, and after a failure what **Retry** will do. A send that was interrupted part-way, because its server restarted or stopped responding, is marked failed with a message that starts `Interrupted:`, rather than staying in progress. See [Checking what was sent](/docs/status-pages/subscribers#checking-what-was-sent).
- **Notification Logs** on each status page show every message that page sent.

See [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) for the feed itself.

## Permissions

- **Picking a status page needs read access to it.** Status pages are read under the status page roles, not the incident roles, and a status page can be restricted by label. Give responders **Status Page Viewer**, limited to labels if you like. Without it the picker is empty, and the API refuses a page the caller cannot read, on incidents and on incident templates alike.
- **Pages the editor cannot see are kept.** An editor who can read only some of an incident's pages sees only those in the picker, and saving keeps the pages they cannot see.
- **The pages an incident is limited to are part of the incident.** Like its monitors, anyone who can read the incident sees their names, on the **Status Page Scope** card, the overview and in the incident feed, whether or not they can read those status pages.
- **What a send reached is part of the incident too.** Once a notification has gone out, its status message and its feed item name every status page it went to, with what was sent and what failed on each, and anyone who can read the incident sees them, whether or not they can read those status pages. Only the summary and the preview below, which look ahead, keep to the pages the person can read.
- **The audience summary** is open to the roles that can declare or edit an incident or post a public note on one. It names only the pages the person can read. Other pages the incident will notify are counted as "more status pages you do not have access to", and it never shows addresses.
- **Preview notification** is open to the same roles, and previews only the pages the person can read, at most sixty times every ten minutes. Like the summary, it never shows an address. **Send test to me** sends only to the person's own account email, once it is verified, at most ten times every 15 minutes.
- **Sending a notification again** needs the permission to edit the incident, for its 'created' notification, and both the permission to edit public notes and the permission to post public notes that notify subscribers, for a note - and so does telling subscribers about an edit to a note. None of them is accepted while that notification is being sent.

## Upgrading a self-hosted server

The workers that send subscriber notifications are what keep an incident to the pages it is limited to. While an upgrade to a version with this feature rolls out, a worker still on the previous version sends the notifications it picks up the way it always has: to every status page that lists the incident's monitors, including pages that only show incidents limited to them. So let the worker deployment finish rolling out, or scale the old workers to zero, before anyone limits an incident to status pages or turns on **Only Show Incidents Scoped to This Page**. With Helm, `migrate.hook: true` also runs the database migrations before any new pod starts.

## Where to read next

- [Subscribers & Announcements](/docs/status-pages/subscribers) — the subscriber channels, and what each event sends.
- [Status Page Resources & Groups](/docs/status-pages/resources-and-groups) — putting monitors on a page.
- [Status Pages Overview](/docs/status-pages/index) — private pages and the settings on **Advanced Settings**.
- [Declaring an Incident](/docs/incidents/declaring-incidents) — the declare form, step by step.
- [Settings & Automation](/docs/incidents/settings) — incident custom fields and note templates.
- [Incident States & Severities](/docs/incidents/states-and-severities) — what else keeps an incident off a status page.
- [Manual Monitor](/docs/monitor/manual-monitor) — monitors whose status you set yourself.
