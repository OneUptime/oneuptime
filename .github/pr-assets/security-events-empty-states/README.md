# Security Events empty-state screenshots

These compare the empty tables on **Security Events** and **Security Events > Connections**
before and after the redesign.

- `connections-before.png` / `connections-after.png`: the Connections table with no connections.
- `connections-after-no-permission.png`: the same, for a member who cannot create connections
  (Add connection is disabled and explains why on hover).
- `connections-after-mobile.png`: the Connections empty state at a 390 px viewport.
- `events-before.png` / `events-after.png`: the Security Events table with no events.
- `events-after-mobile.png`: the Security Events empty state at a 390 px viewport.

They were captured at 2× from a standalone page that renders the real `Card`, `Table` and
`ErrorMessage` components around each empty state, next to a 16 rem placeholder for the side
menu. The "before" images render the previous empty-state markup in the same frame.
