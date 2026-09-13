# Google SecOps form steps fixture

This offline harness renders the production
`App/FeatureSet/Dashboard/src/Pages/SecurityEvents/GoogleSecOpsConnections.tsx`
page with a synthetic project and permission snapshot. Only the `ModelAPI` / `API`
boundary is replaced. It opens the real `ModelTable` create modal, checks the
three-step rail and validation barriers, and walks the form without creating a
connection or using a credential.

## Run it

```text
cd E2E
npm install
npm run test-google-secops-form-steps-ui
```

Stable viewport screenshots are written to
`output/playwright/google-secops-form-steps/`. Their names end in
`-synthetic.png`; every visible value is fabricated by the fixture.

## Open it manually

```text
cd E2E
node GoogleSecOpsFormSteps/Fixture/server.js
```

Then open
`http://127.0.0.1:4216/dashboard/10000000-0000-4000-8000-000000000001/security-events/connections`.
