# Inventory: what a device reports about itself, and why the rest is unknown

Screenshots for "Inventory: read what a device reports about itself, and tie an MX to its Meraki
record" (issue #5384). The issue's own screenshot is the "before".

Rendered from the real **Asset Details** card in headless Chromium with the Dashboard's Tailwind
build, `Theme.css` and Inter, by the offline fixture `packages/E2E/AssetDetails`. The MX is named as
in the issue; its MAC address and everything else on it is made up.

| File | Shows |
| --- | --- |
| `mx85-1280-after.png` | The MX walked over SNMP with no Meraki connection: its MAC from its own port, its operating system from its model, and one line saying only the Meraki dashboard has the rest, with a link to connect it. |
| `mx85-390-after.png` | The same on a phone: every line wraps inside the card. |
| `quiet-switch-1280-after.png` | A switch whose walk reads its system group and nothing more: the line says the device does not report the rest over SNMP, rather than reading as if something were still to come. |
