# Signing an MCP client in with OAuth

How these were made: a real stack on one machine (the App run natively from this branch, with
Postgres, Valkey, ClickHouse and nginx in containers, Enterprise edition so that the audit log is
available), driven by headless Chromium through Playwright at 1280px wide (the audit log at
1440px), 2x. The clients' half of each flow is plain HTTP against `/mcp/oauth/*`. "Visual Studio
Code" is VS Code's real published client metadata document
(`https://vscode.dev/oauth/client-metadata.json`), fetched by the server. Nothing is mocked.

One thing was arranged for the picture: the Visual Studio Code row's "connected" and "last used"
dates were moved back in the database, so the Last Used column shows something other than
"a few seconds ago" twice.

The pictures were taken just before the branch was rebased onto a master that moved Runners out of
the Settings side menu, so the menu on the left of the two Settings pictures still lists them.
Nothing else on those pages changed.

- `consent-claude-code.png`: the consent screen, for a client that registered itself (Dynamic
  Client Registration) and listens on a loopback port. It says that the name is the client's own
  claim, where the browser goes next and who is signed in, and warns that any app on the device
  could receive the sign-in. The member picks the project and the access.
- `consent-vscode-read-only.png`: the same screen for a client identified by a metadata document.
  The host the document is published at leads, because it is the one part of a client's identity
  the client did not merely assert. The member has chosen Read only.
- `consent-persian.png`: the screen in Persian, right to left. The address and the email stay left
  to right inside their sentences, and the buttons swap sides.
- `settings-connected-clients.png`: Settings → MCP Server. The Authentication card explains both
  ways in; Connected MCP Clients lists each client, who connected it, what it may do and when it
  last made a request. A member sees their own, owners and admins see everyone's.
- `settings-disconnect-confirmation.png`: disconnecting. It says what happens, and that nothing the
  client created is deleted, instead of the table's stock "this action cannot be undone".
- `audit-log-actor.png`: the audit log (Enterprise). A change made through an MCP client is the
  member's, marked "via Claude Code (MCP client)". A change made with an API key names the key
  ("Terraform"); before, every key's change read "API Key", because nothing recorded which one.
