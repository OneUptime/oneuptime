# Custom Roles fixture

An offline harness for the real Teams pages a custom role lives on: Teams >
Roles (`packages/App/FeatureSet/Dashboard/src/Pages/Teams/Roles.tsx`), a role's
own page (`Pages/Teams/RoleView.tsx`), a team's Permissions page
(`Pages/Teams/View/Permissions.tsx`) and Create Team on the Teams list
(`Pages/Teams/Index.tsx`). It mounts the production `TeamsRoutes`, bundled with
the app's esbuild config, Tailwind, theme and font, replaces only the
`ModelAPI` / `API` data boundary and the synthetic user's permissions, and
serves them on `127.0.0.1:4313`. No Docker, no database, no sign-in.

The project holds four roles - Incident Responder (6 permissions, one of them
restricted to the Production label), Team Lead (3), Auditor (none yet) and
Incident Helper (Incident Member and Alert Member) - and five teams: Owners and
Admin, whose permissions can't change, Members, Platform On-Call and Support.
Incident Responder is given to Platform On-Call and Support: four people who
accepted, and one still invited, who holds nothing yet.

The suite drives custom roles the way a person does:

- the Roles page: each role with its permission count and description, the
  empty page, and the built-in roles folded under it, opening to all forty;
- Create Custom Role: a name and the built-in roles it bundles, each sent as
  its own permission of the role for every resource, then the new role's page;
  and a pick the server refuses (`?refuse=AlertMember`): the role is kept, and
  a notice names what was left out and why;
- Delete, from the list and from the role's page: what deleting any custom role
  does (DeleteConsequences), then who has this one right now ("It is given to
  2 teams (4 people) right now."), or that no one loses access; the teams alone
  when the reader may not read who is on them (`?members=hidden`);
- a role's page: who a change reaches, its permissions with their scopes, Add
  Role without Project Owner, the Labels scope refusing to add anything without
  a label, Give to a Team offering only the teams that could take it, Remove
  saying what the team keeps, and a rename reaching the breadcrumb trail;
- a team's Permissions page: its custom roles above its own permissions, the
  role's copies left out of its own list, Add Custom Role offering only the
  roles the team does not have, and the page as it always was in a project with
  no custom role (`?roles=none`);
- Create Team: the custom roles after the built-in ones, only those the user
  could give (`?user=editor`), a search box once there are many
  (`?roles=many`), and the team opening on its Members page;
- long names (`?long=1`) wrapping inside their cards at a phone's and a
  laptop's width, and dark mode (`?theme=dark`).

`Fixture/Fixture.js` records every create, update, delete and list request the
pages send on `window.__fixture`, and answers writes as the services do: a role
given to a team copies its permissions to the team, and a role's permission
count follows what it holds.

## Run it

```
cd packages/E2E
npm install
npm run test-custom-roles-ui
```

Screenshots land in `output/playwright/custom-roles-ui/`.

## Poke at it by hand

```
cd packages/E2E
node CustomRoles/Fixture/server.js
```

Then open
`http://127.0.0.1:4313/dashboard/10000000-0000-4000-8000-000000000001/teams/roles`,
adding `?roles=none`, `?roles=many`, `?long=1`, `?user=editor`,
`?refuse=AlertMember`, `?members=hidden`, `?lang=de`, `?lang=ja` or
`?theme=dark` as needed.

The other pages:

- Incident Responder:
  `http://127.0.0.1:4313/dashboard/10000000-0000-4000-8000-000000000001/teams/roles/30000000-0000-4000-8000-000000000001`
- Platform On-Call's Permissions page:
  `http://127.0.0.1:4313/dashboard/10000000-0000-4000-8000-000000000001/teams/50000000-0000-4000-8000-000000000004/permissions`
- the Teams list, with Create Team:
  `http://127.0.0.1:4313/dashboard/10000000-0000-4000-8000-000000000001/teams`

`CUSTOM_ROLES_FIXTURE_PORT` serves it on another port.
