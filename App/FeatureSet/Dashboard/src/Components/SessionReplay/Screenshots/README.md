# Session replay screenshots

What the RUM session replay surfaces looked like before the chrome redesign
and after it. Rendered from the real components against the dashboard's own
Tailwind build, on fixture data — the picture on the stage is a stand-in for a
recorded page, everything around it is the shipping UI.

| File                                        | Shows                                                                                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-replay-player-before-after.png`    | The whole player. Three floating boxes with their own borders became one card stacked address bar → picture → track → transport.                                             |
| `session-replay-list-before-after.png`      | The sessions list: a header band on the table, a hover state that reads as a row, and cells that no longer wrap a badge or a date mid-phrase.                                |
| `session-replay-header-before-after.png`    | The player header. One `text-xs` line broken up by a literal `\|` became identity at `text-sm`, device facts as its subtitle, and the actions on their own shelf.             |
| `session-replay-transport-before-after.png` | The transport row and the timeline, in the order every media player uses. Ten outlined chips of equal weight became three grouped clusters around one filled play button.    |
| `session-replay-rail-before-after.png`      | The events rail. Rows were monospace end to end; only the offset column is now, so the titles read as prose and the tabs sit on one recessed track.                          |

Re-shoot these when the player's chrome changes.
