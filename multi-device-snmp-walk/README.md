# The Network's SNMP Walk page: many devices walked at once (#5548)

How these were made: the real card of the page (`MultiDeviceSnmpWalkCard` and `MultiDeviceSnmpWalkResults`),
bundled with the Dashboard's esbuild config and rendered in headless Chromium by the offline suite
`packages/E2E/MultiDeviceSnmpWalk`, with the model APIs answered from memory, the Dashboard's Tailwind runtime,
`Theme.css` and the Inter font, at 1x. They are not screenshots of a running stack; every device, probe and
value in them is made up: seven Meraki routers, one answering everything, one without sysLocation, one with no
SNMP credentials, one with no probe, one that does not answer, one whose walk stops at its limit and one
monitor-backed.

- `1280-walked.png`: the walk of the seven routers on a laptop. A chip per device with what its walk read; the
  three devices that were not walked in full, with why and the way to their Settings; every OID any device
  answered, with how many of the devices whose walk reached it answer it, their values, and Collect.
- `1280-answers.png`: "Answered by" opened on sysLocation: Amsterdam's and Geneva's values, Berlin's
  "Not answered", and Frankfurt's walk, which stopped before the OID.
- `1280-collected.png`: Collect on 3 devices pressed on sysDescr - collected on every probe-polled device that
  answers it, not on the monitor-backed one.
- `390-walked.png`: the same walk on a phone: each OID is a card.
- `1280-dark.png`: the dark theme.
- `1280-de.png`: German.
