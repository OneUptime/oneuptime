# Time with monitoring off on the Status Timeline (#6480, #6987)

These screenshots come from the Status Timeline offline fixture (`packages/E2E/StatusTimeline/Fixture`), which builds the real Status Timeline page from this branch with the real locale files and stubs only the data. They use `?scenario=monitoring-off`: a monitor whose monitoring is off now (turned off right after a 2-second Offline, by Ada Lovelace) and was off for three days in October before it was turned back on. Add `&lang=de` or `&lang=fa` for German or Persian, and `&theme=dark` for the dark theme.

The Recent status changes card is from the Monitor Overview offline fixture (`packages/E2E/MonitorOverview/Fixture`), whose disabled monitor had its monitoring turned off six hours ago.

## Before the UI review, 1280

- `before-1280-en-timeline.png`: the time with monitoring off is drawn in the status's colour, the legend counts it in the shares, and turning the switch looks like a second "Operational" with nothing to tell the two apart.
- `before-1280-en-table.png`: the same rows in the table.

## After, 1280

- `after-1280-en-timeline.png`: each event held with monitoring off has a grey Monitoring Off pill, the band stripes that time grey, and the legend lists Monitoring Off last with its duration and no share.
- `after-1280-en-table.png`: the Monitor Status column carries the same pill.
- `after-1280-en-dark.png`: the dark theme.
- `after-1280-de-timeline.png`: German, the long language. The legend's durations no longer end in a comma.
- `after-tooltip-monitoring-off.png`: hovering the October stripe.
- `after-overview-recent-status-changes.png`: Recent status changes on the monitor overview.

## After, Persian at 390

- `after-390-fa-timeline.png` and `after-390-fa-dark.png`: right to left, at phone width, light and dark.
