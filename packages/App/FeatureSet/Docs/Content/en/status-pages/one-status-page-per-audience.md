# One Status Page per Audience

Different people need different news. A client does not want to hear about another client's outage, and the staff at one site do not want an email every time a different site loses its network. In OneUptime the unit of audience is the status page: each one has its own subscribers, its own branding and its own privacy. So give each audience a page of its own, and decide incident by incident which pages hear about it.

Shared infrastructure used to make that hard. An incident reaches a status page through its monitors, so a monitor shared by ten site pages told all ten sites about an outage that affected two. The only workaround was a page, or a monitor, for every combination of sites. This page covers the settings that fix that:

- **Limit to these status pages** on an incident, so it shows on, and notifies, only the pages you pick.
- **Only Show Incidents Scoped to This Page** on a status page, so an incident nobody has scoped yet reaches none of these pages until someone decides. That includes the incidents a monitor, Slack, Microsoft Teams, the API or AI opens on its own.
- A record of which pages were told that an incident was created, so a page you add later is told once and the others are not told again.
- A **Will notify** summary that shows who will hear about an incident before you declare it or post a public note.

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
3. **Turn on Only Show Incidents Scoped to This Page** on each of those pages. It is on **Status Pages → your page → Advanced → Advanced Settings**, behind **Edit Settings** on the **Incident Settings** card. From then on, nothing reaches a site page unless someone picks it.
4. **Add each audience's subscribers** to its page. For staff, use **Add in Bulk** on **Email Subscribers**, and prefer each person's own address to a mailing list such as `site03-all@`: anyone on the list can unsubscribe it for everyone on it. If a subscriber you added unsubscribes, the page's owners and whoever added it are emailed (see [Shared addresses and mailing lists](/docs/status-pages/subscribers#shared-addresses-and-mailing-lists)).
5. **Let responders read status pages.** The picker lists only the status pages the person can read, and the incident roles cannot read status pages. Give responders the **Status Page Viewer** role next to their incident role; it can be limited to pages with certain labels. Without it the picker is empty, and says why.
6. **Optionally, save incident templates with pages already picked.** A `Region East outage` template can carry the East site pages.

## Limiting an incident to status pages

### When you declare it

On **Incidents → All Incidents → Declare Incident**, the **Resources Affected** step has **Limit to these status pages** right after the resources. Its placeholder, **Every status page that lists the monitors**, is what leaving it empty means. Pick pages by name, or open the picker's **Labels** tab and pick a label to add every page that carries it.

The form warns you:

- when a picked page lists none of the incident's monitors. The incident will not show on that page or notify its subscribers;
- when you also set **Change Monitor Status to**. See [Monitor status is shared](#monitor-status-is-shared);
- when you also tick **Private Incident** on the **More** step. Private incidents are hidden from all status pages, including the ones you picked.

**Create from Template** fills the field from the template. A template's pages are set on its **Resources Affected** step when you create it, and on its **Status Page Scope** card afterwards (**Incidents → Settings → Incident Templates**). As with the other template fields, a list you set yourself wins. A template's pages are filled in even for a responder who cannot read status pages: whoever set up the template chose them for everyone who declares from it.

### Who will be notified

Under **Notify Status Page Subscribers** on the **More** step, and again on the summary before you submit, the form shows who the incident will reach:

> Will notify:
>
> - Site 03 (up to 41 email)
> - Site 07 (up to 18 email)

Below that, under **Not notified:**, it lists the pages that list the monitors but will not be told, and why: not one of the pages the incident is limited to, a page that only shows incidents limited to it, or a page that does not show incidents. When nothing will be sent at all, it says why instead: no monitors, no status page that will show the incident, **Notify Status Page Subscribers** turned off, a private incident, or no subscribers yet.

The same summary appears under **Notify Status Page Subscribers** when you write a note on the incident's **Public Notes** page, for the incident as it stands.

The counts are "up to". They count the confirmed subscribers of each page who have not unsubscribed, per channel, and a subscriber who picked only some resources or event types may not get this message. Pages you cannot read are not named. They are counted as "more status pages you do not have access to".

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

- **The notification is still queued, or being sent right now.** A queued send reads the pages when it goes out, and a send that is running reads them again when it finishes and then tells the pages added meanwhile. So there is no checkbox: the pages you add are told either way.
- **Every page you add was told already**, for example a page you removed and add back, or an incident that reached every site and is now narrowed to two of them. Nobody is told again, so there is no checkbox.
- **The incident was never announced.** When it was published without **Notify subscribers that this incident was created**, or declared without monitors, nobody was told. Ticking the checkbox tells only the pages you add, not the pages it was already limited to.
- **The incident was declared before this feature was released.** Its 'created' notification went out to every page that listed its monitors, and there is no record of those pages. Adding pages does not send it again, so the checkbox is not offered.
- **The incident is hidden.** Nothing is sent while it is hidden. When you turn **Visible on Status Page** back on, the **Incident Settings** card offers **Notify subscribers that this incident was created** for the pages of its scope that were never told, such as the ones added while it was hidden.

A page added later hears about what happens next: later public notes, state changes and the postmortem. It is not sent the notes and state changes that went out before it was added. If it needs to catch up, post a public note.

The same record makes **Retry** on a failed 'created' notification resume where it stopped: pages that were already told are skipped.

Through the API, send `"miscDataProps": {"notifyAddedStatusPagesOfIncidentCreated": true}` with the update that changes `statusPages`. Setting `subscriberNotificationStatusOnIncidentCreated` back to `Pending` yourself still resends the 'created' notification to every page the incident reaches, as it always did: the record is emptied with it. After a failure it resumes where the failed send stopped instead.

### Removing status pages

Removing a page recalls nothing. The page stops showing the incident, and its subscribers hear nothing more about it, not even that it was resolved. When you remove a page that was already told about the incident, the edit form warns you and suggests a closing public note. Post that note first, while the page is still in the list, and then remove the page.

Clearing the whole list is different from removing pages: the incident is then not limited at all. It is shown on, and notifies, every page that lists its monitors again, except the pages that only show incidents limited to them. The form warns you about that too.

### When a picked status page is deleted

Deleting a status page removes it from every incident that was limited to it. An incident whose picked pages have all been deleted stays limited, to nothing: it is hidden from every status page rather than shown on every page that lists its monitors. The **Status Page Scope** card says so. Pick other pages, or clear the list, to show it again.

Incident templates work the same way. A template whose pages have all been deleted stays limited: an incident declared from it through the API is hidden from every status page, the template's **Status Page Scope** card warns you, and **Declare Incident** starts with no page picked and asks you to pick the pages the incident is for. Pick other pages on the template, or save its list empty to stop limiting the incidents declared from it.

## One email per person

For an incident limited to specific status pages, an email address or phone number subscribed on more than one of those pages gets one email or text message per send, not one per page. Pages are visited in name order, so the first page's template, branding and unsubscribe link are the ones that person gets.

Webhook, Slack and Microsoft Teams messages are never merged. Their payloads name the status page they are for, and an integration that listens per page has to see every page.

This applies within one send only. Someone subscribed on `Site 03` and `Site 05` who got the 'created' email through `Site 03` gets it again when `Site 05` is added later. An incident that is not limited to any page sends one message per subscription, as it always has.

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
- **Each subscriber notification.** The **Subscriber Notification Sent** entry in the incident feed has a **More Information** panel listing each page the send went to: how many messages were queued on each channel, and the subject its email went out with. It also lists the pages it passed over and why (already told, or not showing incidents), the pages the scope left out, and whether email and SMS were sent once per address.
- **Notification Logs** on each status page show every message that page sent.

See [Incident Notes, Owners & Feed](/docs/incidents/notes-owners-and-feed) for the feed itself.

## Permissions

- **Picking a status page needs read access to it.** Status pages are read under the status page roles, not the incident roles, and a status page can be restricted by label. Give responders **Status Page Viewer**, limited to labels if you like. The picker says so when it has nothing to list, and the API refuses a page the caller cannot read, on incidents and on incident templates alike.
- **Pages the editor cannot see are kept.** An editor who can read only some of an incident's pages sees only those in the picker, and saving keeps the pages they cannot see.
- **The pages an incident is limited to are part of the incident.** Like its monitors, anyone who can read the incident sees their names, on the **Status Page Scope** card, the overview and in the incident feed, whether or not they can read those status pages.
- **The audience summary** is open to the roles that can declare or edit an incident or post a public note on one. It names only the pages the person can read. Other pages the incident will notify are counted as "more status pages you do not have access to", and it never shows addresses.

## Where to read next

- [Subscribers & Announcements](/docs/status-pages/subscribers) — the subscriber channels, and what each event sends.
- [Status Page Resources & Groups](/docs/status-pages/resources-and-groups) — putting monitors on a page.
- [Status Pages Overview](/docs/status-pages/index) — private pages and the settings on **Advanced Settings**.
- [Declaring an Incident](/docs/incidents/declaring-incidents) — the declare form, step by step.
- [Incident States & Severities](/docs/incidents/states-and-severities) — what else keeps an incident off a status page.
- [Manual Monitor](/docs/monitor/manual-monitor) — monitors whose status you set yourself.
