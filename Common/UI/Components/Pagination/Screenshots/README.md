# Pagination screenshots

What the shared pagination control (`../Pagination.tsx`) looks like in the
states that are worth arguing about. Rendered from the real component against
the dashboard's own Tailwind build, on a mock table.

| File | Shows |
| --- | --- |
| `pagination-before-after.png` | The control before this change (page size and page number hidden behind a light-grey icon button) and after it (rows per page, the numbered pages and the range all on the page). |
| `pagination-long-list.png` | Deep in a 24-page list, with the gaps collapsed and a direct jump; a short final page; and an empty result set. |
| `pagination-telemetry.png` | The compact skin used under logs and traces, and has-more mode, where the endpoint skips `COUNT(*)` so there is no last page to link to. |
| `pagination-mobile.png` | A narrow screen, where the numbered list gives way to a page-of-pages indicator. |

Re-shoot these when the control's layout changes.
