# SLO burn rate rules: alerts and incidents

These images show the production
`App/FeatureSet/Dashboard/src/Pages/Slo/View/BurnRateRules.tsx` page and its create
form, rendered by the Playwright fixture in `E2E/SloBurnRate/Fixture`. The
**Demo workspace · Synthetic data** banner identifies the substituted ModelAPI data
and permission snapshot. No customer data appears in the images, and they do not
demonstrate database persistence.

- `burn-rate-rules-table.png`: the Declares column reporting all three shapes a rule
  can take — Alert + Incident, Alert, Incident — with each output's own severity and
  on-call policy, and the live Firing pill on the rule that has both open.
- `burn-rate-rule-form-alert.png`: the alert half of the create form. Create Alert
  carries the column's own default, so it renders ON without anyone touching it.
- `burn-rate-rule-form-incident.png`: the incident half — its own toggle, its own
  severity, and its own on-call policies.

Regenerate with `cd E2E && npm run test-slo-burn-rate-ui`; the images land in
`output/playwright/slo-burn-rate/` under their `-synthetic` names. See
`E2E/SloBurnRate/README.md` for running the fixture by hand.
