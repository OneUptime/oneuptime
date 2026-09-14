# Telemetry ingestion key screenshots

What the two ingestion key pages (`../TelemetryIngestionKeys.tsx` and
`../TelemetryIngestionKeyView.tsx`) look like now that a key has a type.
Rendered from the real page components against the dashboard's own Tailwind
build, on a mock `ModelAPI`.

| File                               | Shows                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ingestion-keys-list.png`          | The key list with the Type and Last Used columns: a server key and two browser keys that have sent something, and a browser key that has not - the column reads "Never" rather than a dash, because empty means no ingest was recorded, not that the key never worked. |
| `create-key-server-vs-browser.png` | The create dialog with Server picked and with Browser picked. Allowed Origins and Pinned Service Name only exist on the form for a browser key, because the ingest guard only reads them there.                                                                        |
| `browser-key-detail.png`           | A browser key's detail page: the type with what it may do, the origin allowlist, the pinned service name, the per-key rate limit, the expiry and when it last wrote anything.                                                                                          |
| `browser-key-no-origins.png`       | The same page for a browser key with an empty allowlist, where empty means nothing is accepted - so the row says so in red instead of rendering blank.                                                                                                                 |
| `disabled-key.png`                 | A key switched off. The kill switch is the fastest answer to a key you think is being abused, and it is the one thing that stops a leaked key whatever else is true of it - so the status says the telemetry is being refused, not just that the key is inactive.      |

The fixtures are invented and every secret key in them is an all-zero UUID.

Re-shoot these when either page's fields or layout change.
