# Session replay screenshots

The `*-standard-ui.png` screenshots show the current production components with
synthetic data from `packages/E2E/SessionReplay`. The recording is reconstructed and played
by the real rrweb engine. The fixture replaces API responses and the outer
workspace header; the RUM page layout, navigation, table, facets and player are
shipping components.

| Screenshot                                         | Shows                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `session-replay-list-standard-ui.png`              | Shared table, recording actions and the Session Replay menu category.       |
| `session-replay-empty-standard-ui.png`             | Compact empty state with a link to separate setup documentation.            |
| `session-replay-facet-standard-ui.png`             | Standard searchable facet dropdown.                                         |
| `session-replay-player-standard-ui.png`            | Compact header bar, the recording, one-row transport and Events rail.       |
| `session-replay-player-laptop-standard-ui.png`     | The recording at 1440 × 900: ≥ 55% scale with the transport above the fold. |
| `session-replay-player-tabs-standard-ui.png`       | An eight-tab recording: open tabs lead the strip, each pill names a page.   |
| `session-replay-player-tab-picker-standard-ui.png` | The tab picker, grouped Open / Closed / No footage with a page filter.      |
| `session-replay-list-mobile-standard-ui.png`       | Responsive recording cards and navigation.                                  |
| `session-replay-player-mobile-standard-ui.png`     | Playback and events on a narrow screen.                                     |

Regenerate them with `cd packages/E2E && npm run test-session-replay-ui`, then copy the
selected PNGs from `output/playwright/session-replay-ui/` to this directory
(`session-replay-player-tabs.png` and `session-replay-player-tab-picker.png`
come from the `?tabs=many` fixture). The suite also asserts filter request
values, navigation, actual playback, how large the recording is drawn, stage
fit, tab switching, control visibility, keyboard access and absence of
horizontal overflow.

The older `*-before-after.png` images are historical references from the previous
player chrome redesign.
