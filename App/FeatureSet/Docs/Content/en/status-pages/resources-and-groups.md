# Resources & Groups

A resource is one row on your status page — a monitor (or a monitor group) with a name visitors can understand, a current status, and optionally an uptime number and a history chart. A group is a section that holds resources, so a page with forty monitors reads as "API", "Web app" and "Data pipeline" instead of one endless list.

You build both on a single screen. Open a status page and pick **Resources** in the side menu (the item reads **Monitors** on projects that don't have monitor groups enabled). Groups used to live on their own page; they no longer do, and the old `/groups` URL just redirects here.

Get this part right and the rest of the status page is decoration. Visitors judge "is it me or is it them?" from these rows, so name them the way customers talk about your product — **Checkout API**, not `prod-checkout-lb-healthcheck-us-east-1`.

## The Resources screen

The screen is split in two. On the left is a navigator listing every group on the page; on the right is the contents of whichever group you selected.

- **The group navigator (left)** — a tree of groups, with a search box (**Search groups...**) above it and a running count below it, like `3 groups · 12 resources`. When a page has more groups than fit, a **Show N more of M** button reveals the rest.
- **Top of page** — the first row in the navigator. It holds resources that aren't in any group, and its tooltip says exactly what that means: visitors see these first, above every group. If the page has no groups at all, the right pane is titled **All resources** instead.
- **The resource pane (right)** — titled with the group you selected. Its header carries **Edit Group**, the primary **Add Monitor** button, and a **More actions** overflow.

Two buttons live in the card header itself: **New Group**, and a three-dot overflow holding **Import groups from CSV** and **Refresh**.

The card's description changes with the shape of your page. With groups, it reads that this is everything visitors see and to pick a group on the left to edit what is in it. With no groups yet, it nudges you to create one to split a longer page into sections.

**Empty states tell you what to do.** An empty group shows **No monitors here yet** with **Add Monitor**, **Add Multiple**, and — only when the status page has no groups at all — **Create a Group**. A search that matches nothing shows **No resources match your search**. An empty navigator says groups split a longer status page into sections and that they can be nested.

## Adding a monitor

Select the group you want the resource to land in (or **Top of page** for an ungrouped row), then click **Add Monitor**. The modal is titled **Add a monitor to {group}** and has two steps: **Monitor Details** and **Advanced**.

On **Monitor Details**:

- **Monitor** — the dropdown of monitors in your project, placeholder **Select Monitor**. Required.
- **Display Name** — required. This is the text visitors read, and it is stored separately from the monitor's own name, so you can rename it here without touching monitoring.
- **Description** — optional markdown shown under the row. Good for a sentence explaining what the service actually does.

If your project has monitor groups enabled, a link under the dropdown reads **Add a Monitor Group instead.** — click it and the **Monitor** dropdown is swapped for a **Monitor Group** dropdown (**Select Monitor Group**). The link then flips to **Add a Monitor instead.** so you can go back. Use a monitor group when you want one row on the page to represent several checks rolled together.

### Adding several at once

**Add Multiple** (also **Add multiple monitors** in the **More actions** menu) opens **Add Multiple Monitors**. It has the same two steps, but the first one is a **Monitors** multi-select instead of a single dropdown, and the display options you choose on **Advanced** apply to every monitor you picked. This is the fastest way to seed a new page.

## Display options on a resource

The **Advanced** step is the same on the single-add form and the bulk modal. Everything here is per-resource — two rows in the same group can be configured differently.

| Field                                                    | Purpose                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Tooltip** (`displayTooltip`)                           | Extra text shown beside the resource on your status page. Use it for scope: "US and EU customers". |
| **Show Current Resource Status** (`showCurrentStatus`)   | On by default. Shows the live status — operational, degraded, offline — next to the row.           |
| **Show Uptime %** (`showUptimePercent`)                  | Off by default. Shows an uptime percentage beside the resource.                                    |
| **Select Uptime Precision** (`uptimePercentPrecision`)   | Only appears once **Show Uptime %** is on. Required, defaults to one decimal.                      |
| **Show Status History Chart** (`showStatusHistoryChart`) | On by default. Shows the day-by-day uptime history bar chart for the resource.                     |

**Display Name** (`displayName`) and **Description** (`displayDescription`) from the first step are display-only too — they never change the monitor itself.

## Uptime percentages and history charts

Both **Show Uptime %** and **Show Status History Chart** depend on a setting that lives somewhere else. The window they cover is **Show Uptime History (in days)** under **Status Pages → your page → Advanced → Advanced Settings**, in the **Uptime History Settings** card. It accepts 1 to 90 days and defaults to 90.

So the sequence is: turn the toggles on per resource, then set the window once for the whole page.

**Precision is a judgment call.** The **Select Uptime Precision** dropdown offers `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` and `99.999% (Three Decimal)`. More decimals look precise and invite arguments about the third one; if you publish an SLA at three nines, match it and no more.

Groups have their own copies of these toggles — see below — so a group can show a rolled-up percentage while the individual monitors inside it stay quiet, or the other way round.

The colors of the history chart bars, and which monitor statuses count as "down", are set on the **Overview Page** branding screen, covered in [Status Page Branding & Domains](/docs/status-pages/branding-and-domains).

## Groups

Click **New Group** to open **Create New Status Page Group**. The form has three steps: **Group Details**, **Layout** and **Advanced**.

**Group Details**:

- **Group Name** (`name`) — required. This is the section heading visitors see.
- **Group Description** (`description`) — optional markdown, shown under the heading.
- **Parent Group** (`parentStatusPageGroupId`) — optional. Leave it at **No parent group (top level)** to keep the group at the top level.
- **Expand on Status Page by Default** (`isExpandedByDefault`) — whether the section starts open or collapsed for visitors.

**Advanced** mirrors the resource toggles at group level:

- **Show Current Group Status** (`showCurrentStatus`) — on by default. Shows a status beside the group heading.
- **Show Uptime %** (`showUptimePercent`) — off by default, with **Select Uptime Precision** appearing once it's on.

Editing works the same way: **Edit Group** in the pane header, or **Edit group** in the navigator's row menu, opens **Edit Status Page Group** with a **Save Changes** button.

The pane header shows chips for the settings that are currently on — **Grid**, **Collapsed by default**, **Uptime %** — so you can see how a group is configured without opening the form.

### Managing a group

The navigator's per-row menu holds **Edit group**, **Move up**, **Move down**, **Show ID** and **Delete group**. The pane's **More actions** overflow has the longer-form equivalents — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Refresh** and **Delete this group**. A group saved without a name renders as **Untitled group**, which is a good sign you meant to type something.

## Nesting groups

Groups are nestable: set **Parent Group** on the child, or use the navigator's **Add a sub group inside this group** action. The form's own help text describes the shape it's built for — something like Corporate Units › Region › Market — and notes that every level shows the rolled-up status and uptime of everything beneath it.

When a group has children, the resource pane shows a **Sub groups** chip row that links straight into each child, so you can walk the hierarchy without going back to the navigator.

Nesting earns its keep on large pages: a hosting provider with regions inside products, or a retailer with markets inside business units. On a page with twelve monitors, one flat level is friendlier.

## List layout vs grid layout

The **Layout** step sets **View Mode** (`viewMode`) for the group, and it changes how the group renders publicly.

| If you want to…                                                     | Pick                   |
| ------------------------------------------------------------------- | ---------------------- |
| Show a plain vertical list of services, one per row                 | **List** (the default) |
| Show the same service across several regions or tenants as a matrix | **Grid**               |

Choose **Grid** and four more fields appear:

- **Row Axis Label** — the name of the row dimension, placeholder `Service`.
- **Row Axis Values** — the rows themselves, added one at a time with **Add Row** (placeholder `e.g. Auth`).
- **Column Axis Label** — the column dimension, placeholder `Region`.
- **Column Axis Values** — added with **Add Column** (placeholder `e.g. US-East`).

Each monitor in a grid group is then placed in a cell, so the bulk modal asks for the row and column alongside the monitors, using your own axis labels.

**Set up the axes before you add monitors.** A grid group with no rows or columns shows an amber notice saying there is nowhere to put a monitor until the axes exist, with a **Set up the grid** button — and the **Add Monitor** button is withdrawn until you do it.

## Ordering what visitors see

Order is explicit, not alphabetical, and it is set in three places:

- **Resources inside a group** — drag a row. The pane says so: **Drag a row to change the order visitors see**.
- **Groups relative to each other** — **Move up** / **Move down** in the navigator row menu, or **Move group up** / **Move group down** in the pane overflow.
- **Ungrouped resources** — they live in **Top of page** and always render above every group, so put the one thing everyone checks first there.

**Two cases where dragging is off.** Filtering the pane with the **Search in {group}...** box disables reordering — the pane tells you `N of M shown · drag to reorder is off while filtering`, so clear the search first. And grid groups never support drag ordering, because position comes from the row and column axes instead.

Put your most-asked-about service at the top. Visitors who came to the page during an outage usually stop reading after the first screen.

## Importing groups from CSV

Building a deep hierarchy by hand is tedious. The three-dot overflow in the card header has **Import groups from CSV**, which opens the **Import Groups from CSV** modal.

The flow is: **Download CSV Template** to get `status-page-groups-template.csv`, fill it in, **Choose CSV File**, then **Preview Import** to check what will be created before anything is written. An **Import results** table then lists every row as **Created**, **Failed** or **Skipped** along with the reason, so a bad row doesn't silently vanish.

Only `name` is required. The accepted columns are:

| Column                   | What it sets                                         |
| ------------------------ | ---------------------------------------------------- |
| `name`                   | The group name. Required.                            |
| `parentName`             | The name of the group this one nests inside.         |
| `description`            | The group description.                               |
| `isExpandedByDefault`    | Whether the section starts open for visitors.        |
| `showCurrentStatus`      | Whether a status shows beside the group heading.     |
| `showUptimePercent`      | Whether an uptime percentage shows beside the group. |
| `uptimePercentPrecision` | How many decimal places that percentage uses.        |
| `viewMode`               | `List` or `Grid`.                                    |
| `rowAxisLabel`           | Row dimension name for a grid group.                 |
| `rowAxisValues`          | The row values for a grid group.                     |
| `columnAxisLabel`        | Column dimension name for a grid group.              |
| `columnAxisValues`       | The column values for a grid group.                  |

The import creates groups, not resources — add monitors afterwards with **Add Monitor** or **Add Multiple**.

## Where to read next

- [Status Pages Overview](/docs/status-pages/index) — what a status page is and how the pieces fit.
- [Status Page Branding & Domains](/docs/status-pages/branding-and-domains) — logo, favicon, chart colors, and putting the page on your own domain.
- [Subscribers & Announcements](/docs/status-pages/subscribers) — who gets told when these resources change.
- [Public API](/docs/status-pages/public-api) — reading status page data programmatically.
- [Incident States & Severities](/docs/incidents/states-and-severities) — what makes an incident appear on, and disappear from, the page.
