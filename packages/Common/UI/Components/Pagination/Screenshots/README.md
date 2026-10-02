# Pagination screenshots

What the shared pagination control (`../Pagination.tsx`) looks like in the
states that are worth arguing about. Rendered from the real component inside
the real Card and Table, against the dashboard's own Tailwind build and
`Common/UI/Styles/Theme.css`, with headless Chromium.

| File                              | Shows                                                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pagination-before-after.png`     | The control before this change (38px bordered buttons and a 34px select in 14px type) and after it (one row of 28px controls in the table's 12px caption type). |
| `pagination-long-list.png`        | Deep in a 24-page list, with the gaps collapsed; a short final page; a page loading; and an empty result set.                                                   |
| `pagination-go-to-page-modal.png` | The jump-to-a-page dialog, opened by clicking one of the collapsed gaps.                                                                                        |
| `pagination-telemetry.png`        | The compact skin (24px controls) used under logs and traces, and has-more mode, where the endpoint skips `COUNT(*)` so there is no last page to link to.        |
| `pagination-mobile.png`           | A narrow screen, where the numbered list gives way to a page-of-pages indicator that opens the jump dialog.                                                     |
| `pagination-dark.png`             | The long-list states in the dark theme: a dead arrow fades rather than turning a paler (there, brighter) grey.                                                  |

Re-shoot these when the control's layout changes.
