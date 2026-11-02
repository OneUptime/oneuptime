# Permissions per tab fixture

An offline harness for two projects open in two tabs of one browser
(#5306's follow-up): the Dashboard's real
`packages/App/FeatureSet/Dashboard/src/Pages/Settings/Labels.tsx` and
`Pages/Settings/DangerZone.tsx` pages, for the project the tab's address
names, served on `127.0.0.1:4487`. No Docker, no database, no sign-in.

Nothing between the pages and the wire is replaced. Their requests go through
the Dashboard's own `ModelAPI` and API client (`Common/UI/Utils/API`) to the
fixture server as JSON, with the `tenantid` header naming the tab's project.
The server answers as OneUptime's API does
(`Common/Server/Middleware/UserAuthorization`): every answer about a project
carries the person's permission snapshot in that project and its hash
(`project-permissions`, `project-permissions-hash`), unless the request's own
hash says the browser already has it, and their global snapshot the same way.
The person is Project Owner of Acme Production and Viewer of Beta Staging and
Gamma Sandbox (`Fixture/Projects.js`).

The suite checks, in Chromium:

- the Owner's tab offers Create Label and Delete Project and the Viewer's
  locks them, saying why, whichever tab's answers came back last - on a page
  that asks the server nothing on its way in, and on one drawn while the
  tab's own answer is still held;
- each tab's requests send the hash of their own project's snapshot, so the
  server sends each snapshot once;
- a tab moved to another project shows that project's role at once, and a
  project this browser has not opened yet offers nothing until its own answer
  comes back - never the previous project's role;
- a snapshot a tab of the version before left under the one name every
  project shared (`project_permissions`) is never read, nor its hash sent,
  and both are left where they are.

All five fail on the code before the snapshots were kept per project.

## Run it

```
cd packages/E2E
npm install
CI=1 npm run test-permissions-per-tab-ui
```

Screenshots of the two tabs land in `output/playwright/permissions-per-tab-ui/`;
every record in them is fabricated.

## Poke at it by hand

```
cd packages/E2E
node PermissionsPerTab/Fixture/server.js
```

Then open, in two tabs of one window:

- `http://127.0.0.1:4487/dashboard/8f100000-0000-4000-8000-000000000001/settings/labels`
  (Acme Production, Project Owner)
- `http://127.0.0.1:4487/dashboard/8f200000-0000-4000-8000-000000000001/settings/labels`
  (Beta Staging, Viewer)

`POST /__fixture/hold?project=<id>` holds every answer about a project until
`POST /__fixture/release?project=<id>`, and `GET /__fixture/requests` lists
what the pages asked, with the project and the hashes each request sent.
