# Meraki: WAN uplinks and Who talks to whom (#5377)

How these were made: the real Network > Traffic page, bundled with the Dashboard's own esbuild
config and rendered in headless Chromium at 1280px (390px for the phone shots), with Inter and the
production Tailwind config, by the `packages/E2E/MerakiTraffic` suite. Every record is synthetic
data for a made-up "Acme Networks" workspace.

- `uplinks.png`: **WAN uplinks**. The page's uplinks side by side over its time range, with what
  each carried, its share, its average and peak, and its latency and packet loss. The cellular line
  carried nothing and is still measured, so a standby line shows how it is doing.
- `uplinks-latency.png`: the same card charting latency. A stretch nobody measured would be a gap
  in the line, never a zero.
- `one-uplink.png`: after a click on `wan2`. The chip, the numbers and the chart are wan2's, Flows
  is a dash because Meraki counts them per network, and wan1 stays listed to compare it with.
- `one-uplink-of-one-appliance.png`: the bug from the issue. A click on `wan1` in **Uplinks** now
  narrows to that one uplink of that one appliance. Before, it narrowed to the appliance and wan1
  and wan2 lit up together.
- `who-talks-to-whom.png`: what used to be one sentence and a button. What each network reached,
  by protocol and port, with the traffic each way, the flows and the clients, and what Meraki
  cannot say.
- `organization-dark.png`: the whole page in the dark theme.
- `organization-de.png`: the whole page in German.
- `phone-uplinks.png`: the card at 390px, where each cell carries its own label.
