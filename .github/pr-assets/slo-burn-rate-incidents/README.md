# SLO burn rate rules: alerts, incidents, and the create wizard

These images show the production
`App/FeatureSet/Dashboard/src/Pages/Slo/View/BurnRateRules.tsx` page and its create
form, rendered by the Playwright fixture in `E2E/SloBurnRate/Fixture`. The
**Demo workspace · Synthetic data** banner identifies the substituted ModelAPI data
and permission snapshot. No customer data appears in the images, and they do not
demonstrate database persistence.

- `burn-rate-rules-table.png`: the Declares column reporting all three shapes a rule
  can take — Alert + Incident, Alert, Incident — with each output's own severity and
  on-call policy, and the live Firing pill on the rule that has both open.
- `form-step-rule.png`: the create form opens on step one. Four steps in the rail, not
  five — a rule declares no incident until it is asked to, so the step that configures
  one is absent.
- `form-step-burn-window.png`: threshold and the two windows.
- `form-step-declares.png`: both output toggles, together, before either routing step.
  Create Alert carries the column's own default, so it renders on without anyone
  touching it.
- `form-step-declares-both.png`: turning Declare Incident on adds Incident Routing to
  the rail.
- `form-step-alert-routing.png` / `form-step-incident-routing.png`: each output's own
  severity and on-call policies, on its own step.
- `form-no-output-rejected.png`: switching both outputs off is refused in the browser
  rather than after a round-trip. The server enforces the same rule.

Regenerate with `cd E2E && npm run test-slo-burn-rate-ui`; the images land in
`output/playwright/slo-burn-rate/` under their `-synthetic` names. See
`E2E/SloBurnRate/README.md` for running the fixture by hand.
