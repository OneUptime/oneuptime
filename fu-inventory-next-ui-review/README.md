# Inventory Refresh and the Meraki source: UI review screenshots

Before and after frames for the UI review of "Inventory: Refresh a network device, and the Meraki
dashboard as a source of its details" - the Inventory item's **Asset Details** card, the network
device's **Inventory** card and the Meraki connection's row on the network's Traffic page.

Rendered from the real components in headless Chromium with the Dashboard's Tailwind build,
`Theme.css` and Inter, by the offline fixtures `packages/E2E/AssetDetails` and
`packages/E2E/MerakiTraffic`. The "before" frames are the branch as the builder left it. Every
record in them is made up.

| File | Shows |
| --- | --- |
| `refresh-1280-before.png` | Refresh pressed: "Refreshing..." with a spinner, and a second, turning arrow on the line under it; the unknown details name the poll and the scans only. |
| `refresh-1280-after.png` | The button keeps its word, greyed and turning; the line waits with a still clock; the unknown details name the Meraki dashboard too. |
| `refresh-390-de-dark-before.png` | On a phone, in German, dark: the wider "Wird aktualisiert..." pushes the button under the card's title the moment it is pressed. |
| `refresh-390-de-dark-after.png` | The same: the button stays beside the title. |
| `refresh-late-1280-after.png` | Nobody read the device in three minutes: the probe to check, in amber, and Refresh ready again. |
| `refresh-refused-1280-after.png` | A device only a turned-off Meraki connection reads: the reason, in red. |
| `device-card-meraki-1280-before.png` | The device's Inventory card says its details come from its SNMP poll and discovery, when Meraki gave them. |
| `device-card-meraki-1280-after.png` | The card names the Meraki dashboard as a source. |
| `persian-source-line-before.png` | Persian: the time's digit and comma drawn beside the connection's Latin name. |
| `persian-source-line-after.png` | The time set apart in an isolate, where the sentence puts it. |
| `meraki-connection-row-before.png` | The connection's note: "5 of its devices are network devices here: ...". |
| `meraki-connection-row-after.png` | "Fills in the model, serial number and firmware of 5 network devices." |
