# Scheduled maintenance in the 90-day uptime history (#5236)

Shots for the pull request, at 2x, from the offline browser fixtures:

- `*-tooltip.png`, `*-day-dialog.png`, `*-resource-card.png`,
  `after-day-dialog-phone-dark.png` and `after-tooltip-persian.png`: the real
  public status page Overview from `packages/E2E/StatusPageSearch` (Database 0660's
  outage day, Service 0039's card), read in Europe/Paris.
- `*-dashboard-*.png`: a monitor's page from `packages/E2E/MonitorOverview`
  (Sep 19, the day of its completed Database upgrade), read in UTC.

"before" opens each fixture without `?maintenance=1`, which is what master draws for
the same day whatever maintenance ran: master neither sends nor draws it. "after"
opens it with `?maintenance=1`.

## UI review

`review-before-*.png` and `review-after-*.png`: the same page and day before and
after the UI review, at 2x. "before" is the branch as built (b22d400822), "after"
the review's changes:

- The status page shots are the whole public status page app as it ships (its own
  `index.ejs`, Inter, Theme.css and dark theme), from a copy of
  `packages/E2E/StatusPageTheme`'s fixture whose overview also carries the history's
  maintenance and incidents: Email delivery's day of a 3-hour outage, an incident and
  a maintenance event (`*-tooltip.png`, `*-day-dialog*.png`), the Dashboard
  resource's database upgrade in progress in the stock "Ongoing" amber
  (`*-tooltip-ongoing.png`), and a resource with a long name on a phone, in German
  (`*-resource-phone-german.png`). Read in Europe/Berlin.
- `*-dashboard-incident-dialog.png`: the monitor page of `packages/E2E/MonitorOverview`
  (Aug 29, the day of its incident), read in UTC.
- `review-after-keyboard-focus.png`: the day dialog opened with Enter, then two Tabs
  (its X, then the first event).
