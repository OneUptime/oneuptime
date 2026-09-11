# Session replay screenshots

The `*-standard-ui.png` screenshots show the current production components with
synthetic data from `E2E/SessionReplay`. The recording is reconstructed and played
by the real rrweb engine. The fixture replaces API responses and the outer
workspace header; the RUM page layout, navigation, table, facets and player are
shipping components.

| Screenshot                                     | Shows                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `session-replay-list-standard-ui.png`          | Shared table, recording actions and the Session Replay menu category. |
| `session-replay-empty-standard-ui.png`         | Compact empty state with a link to separate setup documentation.      |
| `session-replay-facet-standard-ui.png`         | Standard searchable facet dropdown.                                   |
| `session-replay-player-standard-ui.png`        | Recording summary, playback controls and Events sidebar.              |
| `session-replay-player-laptop-standard-ui.png` | Recording and primary controls visible together at 1440 × 900.        |
| `session-replay-list-mobile-standard-ui.png`   | Responsive recording cards and navigation.                            |
| `session-replay-player-mobile-standard-ui.png` | Playback and events on a narrow screen.                               |

Regenerate them with `cd E2E && npm run test-session-replay-ui`, then copy the
selected PNGs from `output/playwright/session-replay-ui/` to this directory.
The suite also asserts filter request values, navigation, actual playback,
control visibility, keyboard access and absence of horizontal overflow.

The older `*-before-after.png` images are historical references from the previous
player chrome redesign.
