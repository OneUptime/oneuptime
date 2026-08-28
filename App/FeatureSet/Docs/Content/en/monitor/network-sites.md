# Network Sites

A **Network Site** is a place: a region, a market, a franchisee, a distribution centre, one store. Sites nest inside each other, Network Devices attach to them, and OneUptime rolls the health of those devices up the tree so that one number on a Region card answers "is anything wrong out there?".

Find them under **Network** -> **Sites**.

This page documents the three things people most often want pinned down: **how a parent's status is calculated from its children**, **what the uptime percentages mean**, and **how scheduled maintenance changes both**.

## The Hierarchy

Sites form a tree. Each site has a **Site Type** (Region, Market, Unit, Data Center — the list is per-project and editable under **Network -> Settings -> Site Types**) and an optional **parent site**. A type can be flagged **unit-level**, which marks the leaf tier of your estate — the individual store or branch.

Devices attach to exactly one site. A site's *subtree* is itself plus every site beneath it, and that subtree's devices are what its health rolls up from. A Region with no devices of its own still has a status, because the units under it do.

> Rollups are recomputed when a device's monitor status changes, when a device moves site, when the tree is re-parented, and by a sweep every five minutes that catches the cases where only the passage of time changed the answer.

## How Parent Health Is Calculated

Each site chooses **one of two rollup policies**, under **Site -> Settings -> Health Rollup**.

### Worst status of any device (default)

The worst status any device in the subtree reports becomes the site's status. Status severity is the MonitorStatus **priority** — the seeded ladder is Operational (1), Degraded (2), Offline (3), and higher is worse.

One offline device makes the site offline, however many healthy devices sit beside it.

This is the right answer for a **Unit**. Four switches and a firewall in one building are not independent things: one of them dark is a problem at that address, and averaging it away hides a real outage.

It is usually the wrong answer for a **Region above four hundred stores**. A single dark switch in store 12,000 paints the whole region Offline — true in the narrowest sense, useless in every practical one, because the region card can then never be green and stops carrying information.

### Percentage of devices down

The site's status is decided by the **share** of the subtree's reporting devices that are not in an operational status:

| Share of devices down | Site status |
| --------------------- | ----------- |
| 0% | Operational |
| Above 0%, below the threshold | Degraded (the project's status that is neither operational nor offline; falls back to Offline if the project has none) |
| At or above the threshold | Offline |

The threshold is per-site (**Offline Threshold (%)**, default 50).

Note the first row: nothing down is Operational **however low the threshold is set**. A threshold of 0 means "any device down makes this offline", not "a healthy region is offline".

### Which devices get a vote

Both policies agree here, and it matters more than it sounds:

- **Archived devices never vote.** They are decommissioned; they keep their `siteId` but are excluded.
- **Devices that have never reported anything never vote.** A device mid-way through its first discovery walk is not evidence of an outage. It is excluded from the numerator *and* the denominator, so a region half-way through onboarding is scored on the half that has answered.
- A device with a **monitor** attached votes with that monitor's status.
- A device with **no monitor** votes with its SNMP reachability: the outcome of its last poll, not the age of its last success.

### Choosing a policy

A reasonable default for a franchise estate:

| Tier | Policy | Why |
| ---- | ------ | --- |
| Unit / store | Worst status | One device down is one site in trouble. |
| Market | Percentage, threshold ~50% | A market with half its stores down is down. |
| Region | Percentage, threshold ~25-50% | The card should stay green through single-store failures and go red when something systemic happens. |

The policy is set per site, so you can apply it to the Region rows and leave everything beneath them on the default.

## Uptime

Every site has a **status timeline** — one row per rolled-up status change, opened when the status changes and closed when it changes again. Uptime is computed from it:

- Time in a status **not flagged operational** is downtime.
- Overlapping rows are merged, so no second is counted twice.
- Time not covered by **any** row counts as up. The timeline only gains rows once a rollup has run, and absence of evidence is not an outage.
- A still-open row runs to the end of the measured window.

A site with **no timeline rows at all** shows `—` rather than 100%: a site nothing has ever rolled up is unmonitored, not perfect.

### Daily uptime

Alongside the 30-day figure, every site shows **Uptime (24h)**, and the **Status Timeline** page draws a bar per day for the last 30.

This exists because a 30-day average cannot show a bad day. A full day of outage inside a 30-day window costs 3.3 points — so a site that was dark for an entire Tuesday still reports 96.7% for the month, a number that reads like a rounding artifact. The daily strip puts the same data on an axis where one bad day is one bad bar.

Days are rolling 24-hour slices ending now, not local calendar days: the devices, the viewer and the server can all be in different time zones, and there is no single "day" they would agree on.

### Parent uptime is not an average of child uptime

A parent's uptime comes from **the parent's own timeline**, which the rollup policy above produced. It is not the arithmetic mean of its children's percentages.

That distinction is deliberate. An average over children weights a store with two devices the same as a distribution centre with two hundred, and it cannot express "the region was fine, because only one store was out". Under the percentage policy the parent's uptime becomes something you can state in one sentence: *the share of time this region was above its degradation threshold*. Under the worst-status policy it becomes *the share of time nothing at all in this region was down* — a strict reading, which is why regions usually want the other policy.

## Scheduled Maintenance for Network Sites

Attach sites to a **Scheduled Maintenance** event from the event's **Resources Affected** picker, exactly as you would a monitor or a host. A site's own **Scheduled Maintenance** tab lists the events attached to it.

**Attaching a parent covers everything beneath it.** A window on a Region covers every Market and Unit in it, including sites created after the window was scheduled. A regional carrier cutover does not have to enumerate four hundred stores.

Coverage is inherited **downward only**. A window on one Unit does not put its Region "under maintenance": the region is still expected to be up, and a genuine failure in a different unit during the same hours must still count against it.

### What a maintenance window changes

| | During the window |
| --- | --- |
| The maintained site's **live status** | **Unchanged.** A unit that is off for planned work still reads Offline on the map and in the tree, with an "In maintenance" badge next to it. Someone looking at it needs to know it is off. |
| The maintained site's **uptime %** | The window is subtracted from *both* the downtime and the measured period. Two hours of maintenance make the day 22 hours long, and nothing inside those two hours counts either way. |
| Its **ancestors' health rollup** | The maintained subtree's devices stop voting. The region does not turn red for a cutover that was on the calendar. |
| Its **ancestors' uptime %** | Unaffected, and needing no correction — because the planned outage never reached their timeline in the first place. |

That last row is the reason ancestors are handled by suppressing votes rather than by subtracting the interval from their uptime. Subtracting the window from the region's denominator would also erase any *genuine* failure elsewhere in the region during the same hours.

Subtraction uses the event's declared **Starts At / Ends At**, not when a worker happened to move it between states — so the uptime number can be reconciled by hand against the calendar.

If a whole day falls inside a window, its bar in the daily strip is drawn as maintenance rather than as a perfect day, and contributes nothing to the average.

### Interaction with monitors

Attaching a **monitor** to the same event still does what it always did: active monitoring for that monitor is paused for the duration. The two are independent — attach the site to exclude it from the site rollup and its uptime, attach the monitors to stop them alerting.

## Alerting on a Site

**Site -> Settings -> Alerting** opens an alert when a site's rollup *transitions* to a non-operational status, and auto-resolves it when the site recovers. It is transition-only by design: enabling alerting on an already-unhealthy site arms the next transition rather than retro-alerting.

Because alerting rides the rollup, the policy above decides when it fires. A Region on the percentage policy alerts when the region crosses its threshold, not when its first store goes dark.

## Related

- [Network Device Monitor](/docs/monitor/network-device-monitor) — registering, polling and alerting on the devices that attach to these sites
- [Inventory](/docs/inventory/overview) — where network devices show up in the wider catalog
