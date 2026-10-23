# Owners on create fixture

An offline harness for the Owners field of Declare Incident and Create Alert
(`App/FeatureSet/Dashboard/src/Components/OwnersOnCreate`): the real
`Pages/Incidents/Create.tsx` and `Pages/Alerts/Create.tsx`, bundled with
esbuild, with only the `ModelAPI` / `API` data boundary and the signed-in
user replaced, served on `127.0.0.1:4253`. No Docker, no database, no
sign-in.

The project has Ada Lovelace (signed in), Grace Hopper and Linus Torvalds,
and the Platform, Database, SRE On-call, Members and Frontend teams. Its owner
rule preview (`POST /<event>/owner-rule-preview`) answers as the server would
for three rules: "Database incidents" (an incident labelled `database`: Grace
Hopper and the Database team), "Add the creator's team as an owner" (every
incident: of Platform, Database and Frontend, the ones the creator is in) and
"Checkout alerts" (every alert: Linus Torvalds and the SRE On-call team).

The suite drives the field the way a person does:

- Owners waits folded under More fields at the end of the first step, named in
  its header;
- opened, it says the person creating the incident or alert becomes an owner
  anyway, and offers their own teams one click away ("Your teams") with Add
  all - nothing picked by itself, nothing offered to someone in no team
  (`?teams=none`), one team as one team (`?teams=one`);
- the review step's Owners row lists the owners picked and each owner rule that
  will add more, by name, with whom it adds - a label brings a rule in - and
  what the preview was asked;
- what a create sends: the owners picked, as `ownerUsers` / `ownerTeams`;
- what the review says while the preview is asked (`?rules=slow`), when it
  fails (`?rules=error`, and the incident is still declared), when no rule adds
  anyone (`?rules=none`) and to someone who may not read the owner rules
  (`?rules=denied`: nothing);
- Create Alert (`?form=alert`);
- the field and the review at a phone's width, in dark mode (`?theme=dark`) and
  in German (`?lang=de`).

Run it from `packages/E2E`:

```sh
npm run test-owners-on-create-ui
```

Screenshots land in `output/playwright/owners-on-create-ui/`.
