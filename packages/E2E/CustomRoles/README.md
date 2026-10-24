# Custom Roles fixture

An offline harness for the real Teams pages a custom role lives on: Teams >
Settings > Roles (core's shell `packages/App/FeatureSet/Dashboard/src/Pages/Teams/Roles.tsx`
and the Enterprise page `ee/Dashboard/CustomRoles/RolesPage.tsx`), a role's own
page (`ee/Dashboard/CustomRoles/RoleViewPage.tsx`), a team's Permissions page
(`Pages/Teams/View/Permissions.tsx`) and Create Team on the Teams list
(`Pages/Teams/Index.tsx`). It mounts the production `TeamsRoutes`, bundled with
the app's esbuild config, Tailwind, theme and font, replaces only the
`ModelAPI` / `API` data boundary and the synthetic user's permissions, and
serves them on `127.0.0.1:4313`. No Docker, no database, no sign-in.

Custom roles are an Enterprise feature. The server resolves the Dashboard's
plugin specifier as the Dashboard's own build does
(`Common/UI/esbuild-enterprise.js`): the Enterprise pages when `ee/` is checked
out, the Community stub otherwise, and `/edition.json` says which.
`CustomRoles.spec.ts` and `ApiKeyCustomRoles.spec.ts` skip on the Community
Edition (the Dashboard Offline UI jobs run without `ee/`); run them from a
checkout with `ee/` to see them pass. `AddRoleDialog.spec.ts` drives a team's
own Permissions page, which every edition has, and always runs.

The project holds four roles - Incident Responder (6 permissions, one of them
restricted to the Production label), Team Lead (3), Auditor (none yet) and
Incident Helper (Incident Member and Alert Member) - and five teams: Owners and
Admin, whose permissions can't change, Members, Platform On-Call and Support.
Incident Responder is given to Platform On-Call and Support: four people who
accepted, and one still invited, who holds nothing yet.

The suite drives custom roles the way a person does:

- the Roles page: each role with its permission count and description, the
  empty page, and the built-in roles folded under it, opening to all forty;
- the Teams menu: Roles in its Settings section, first, above Custom Fields;
  Settings folded on All Teams, open by itself on Roles, a role's page and
  Custom Fields; and Roles reached from All Teams on a phone, whose menu
  button's two lines ("Navigate to", "Settings / Roles") start at one edge;
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
  card's "Roles" a link to the Roles page (in German too), the role's copies
  left out of its own list, Add Custom Role offering only the roles the team
  does not have, and the page as it always was in a project with no custom
  role (`?roles=none`);
- Create Team: the custom roles after the built-in ones, only those the user
  could give (`?user=editor`), a search box once there are many
  (`?roles=many`), and the team opening on its Members page;
- long names (`?long=1`) wrapping inside their cards at a phone's and a
  laptop's width, and dark mode (`?theme=dark`).

It also mounts the production `SettingsRoutes`, for custom roles on API keys
(`ApiKeyCustomRoles.spec.ts`). The project holds two keys: Deploy bot, given
Team Lead and Incident Helper, with Workflow Viewer of its own; and Terraform,
given no role, with Monitor Admin of its own. Team Lead's Alert Member is
limited to what someone owns, which gives a key nothing, so Deploy bot holds 2
of its 3 permissions. That suite drives, at 1280 and 390 pixels:

- a key's page: its Custom Roles card above its own Permissions, each role a
  link with how many of its permissions apply to the key - and, behind an
  (i), why not the rest - the role's copies left out of the key's own list,
  Add Custom Role offering only the roles the key does not have, Remove
  saying what the key keeps, and the page as it always was in a project with
  no custom role (`?roles=none`);
- a role's page: API Keys with this Role under the teams, saying what a key
  gets of the role (and following a permission's removal), Give to an API
  Key offering only the keys without it and off once every key has it,
  Remove, the reach and Delete counting the keys, a project with no key yet
  (`?keys=none`: the card links to the API Keys page), and nothing about keys
  for someone who may not read them (`?user=editor`);
- Create API Key: the custom roles that give a key something, and the new key
  opening on its page with the role picked;
- long names (`?long=1`, given to Deploy bot too) on a phone, and dark mode.

`Fixture/Fixture.js` records every create, update, delete and list request the
pages send on `window.__fixture`, and answers writes as the services do: a role
given to a team or an API key copies its permissions to it (to a key, all but
those limited to what someone owns), and a role's permission count follows
what it holds.

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
`?refuse=AlertMember`, `?members=hidden`, `?keys=none`, `?lang=de`,
`?lang=ja` or `?theme=dark` as needed.

The other pages:

- Incident Responder:
  `http://127.0.0.1:4313/dashboard/10000000-0000-4000-8000-000000000001/teams/roles/30000000-0000-4000-8000-000000000001`
- Platform On-Call's Permissions page:
  `http://127.0.0.1:4313/dashboard/10000000-0000-4000-8000-000000000001/teams/50000000-0000-4000-8000-000000000004/permissions`
- the Teams list, with Create Team:
  `http://127.0.0.1:4313/dashboard/10000000-0000-4000-8000-000000000001/teams`
- Deploy bot's page, with its custom roles:
  `http://127.0.0.1:4313/dashboard/10000000-0000-4000-8000-000000000001/settings/api-keys/60000000-0000-4000-8000-000000000001`
- the API Keys list, with Create API Key:
  `http://127.0.0.1:4313/dashboard/10000000-0000-4000-8000-000000000001/settings/api-keys`

`CUSTOM_ROLES_FIXTURE_PORT` serves it on another port.
