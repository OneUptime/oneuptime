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
