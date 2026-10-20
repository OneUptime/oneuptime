# External MCP Servers fixture

An offline harness for Project Settings → AI → External MCP Servers: the MCP
servers outside OneUptime (AWS, Azure, GitHub, a team's own) whose tools
OneUptime AI may use while it investigates and fixes. The pages
(`packages/App/FeatureSet/Dashboard/src/Pages/Settings/ExternalMcpServers.tsx`
and `Pages/Settings/ExternalMcpServerView.tsx`), the create and edit form
(`Components/ExternalMcpServer/ExternalMcpServerFormFields.tsx`), the Test
connection dialog, the status pill, the Tools card and the switch that turns a
server off are the production ones. It bundles them with esbuild, replaces
only the `ModelAPI` / `API` data boundary and the synthetic user's
permissions, and serves them on `127.0.0.1:4397`
(`EXTERNAL_MCP_SERVERS_FIXTURE_PORT`). No Docker, no database, no sign-in.

```sh
cd packages/E2E
npm run test-external-mcp-servers-ui
```

The suite drives the pages the way a person does:

- the list says how each server is doing (Connected with its tool count,
  Can't connect with the reason on hover, Not checked yet, Off), and that
  OneUptime's own MCP server, the one AI assistants connect to, has its own
  page;
- adding a server asks for a name and an address, then how OneUptime signs
  in, a card each (no sign-in, a bearer token, custom headers, OAuth client
  credentials, with a step of its own and scope and audience folded); an
  address with a password in it is refused before anything is sent;
- once added, the Test dialog opens by itself and says what OneUptime found:
  the server, how it talks and each tool, marked Reads only or May change
  things; a failed test says why and what to check, and Test again tries
  anew; while it runs, the dialog says so;
- whoever may not change a server sees the servers, but Create and Test are
  locked, and say who may;
- a server's page has its details (the names of its headers, never their
  values), the switch that lets OneUptime AI use it - turning it off asks
  first - and its tools with Test connection;
- an empty project, OneUptime AI turned off, a phone, dark mode
  (`?theme=dark`) and German (`?lang=de`).

`Fixture/Fixture.js` records every create (`creates`), edit (`edits`), switch
(`updates`), delete (`deletes`) and Test request (`tests`, with its path, body
and headers) on `window.__externalMcpServersFixture.state`, so the assertions
check what the pages sent as well as what they drew. The query string steers
it - see the comment at the top of `Fixture/Fixture.js`. Screenshots of each
state are written to `output/playwright/external-mcp-servers-ui/`.
