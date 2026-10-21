# Postmortem rules browser coverage

The production-page browser suite runs without a OneUptime server:

```bash
cd packages/E2E
npm run test-postmortem-rules-ui
```

`PostmortemRules/Fixture/server.js` bundles the real **Incidents → AI →
Settings** page with the Dashboard's esbuild config, Tailwind, theme and font,
over in-memory records. Only ModelAPI data access, the project's plan and the
user's permission snapshot are replaced, and every create, update and delete
the page sends is recorded, so the tests check what was sent as well as what
was drawn.

It covers the **Postmortem rules** table under **More settings**: the
**Draft a postmortem when an incident resolves** switch staying the only way to
turn drafting off, the folded header and its count, the table in the order
rules are tried, creating a rule through its **Match** and **Draft** steps (the
name following the templates picked, a typed name kept, conditions saved),
reordering by keyboard drag and a refused drop, a viewer who can read but not
add, edit or drag, a project below the Growth plan (no templates offered or
listed), a phone-width screen, dark mode and German.

Screenshots are saved under `output/playwright/postmortem-rules-ui/` at the
repository root: `folded-no-rules.png`, `rules-listed.png`,
`create-draft-step.png`, `create-two-templates.png`,
`create-match-conditions.png`, `phone.png`, `dark.png` and `german.png`. The
records in them are made up. These screenshots verify the production UI; they
do not demonstrate database persistence or the drafting job, which the Common
suites cover.

The fixture listens on port 4373; set `POSTMORTEM_RULES_FIXTURE_PORT` to use
another one.
