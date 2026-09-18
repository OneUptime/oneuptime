# SLO Burn Rate Rules fixture

An offline harness for the real
`packages/App/FeatureSet/Dashboard/src/Pages/Slo/View/BurnRateRules.tsx` page. It bundles the
production component with esbuild, replaces only the `ModelAPI` / `API` data boundary
with synthetic records, and serves it on `127.0.0.1:4213`. No Docker, no database, no
sign-in — so it runs against a branch without touching a shared dev stack.

It exists because a burn rate rule's two outputs (raise an Alert, declare an Incident)
are only legible in the rendered table: which rule declares what, which severities,
on-call policies, owners and labels each output uses, which options depart from the
defaults (resolved by hand, private, SLO owners added as owners), and whether the rule
is firing right now. The spec also walks the create wizard (Rule, Burn Window, What It
Declares, then Alert and Incident for the enabled outputs). It checks expandable
settings, prefilled templates and clearing them to use backend defaults,
create/edit persistence, validation, the conditional step rail, and desktop and
mobile modal layouts. It also saves rules with either configured output disabled
and checks that re-enabling it restores its title, description and routing.

## Run it

```
cd packages/E2E
npm install
npm run test-slo-burn-rate-ui
```

Screenshots land in `output/playwright/slo-burn-rate/`, named `*-synthetic.png`
because every record in them is fabricated by `Fixture/Fixture.js`.

## Poke at it by hand

```
cd packages/E2E
node SloBurnRate/Fixture/server.js
```

then open
`http://127.0.0.1:4213/dashboard/10000000-0000-4000-8000-000000000001/slos/20000000-0000-4000-8000-000000000001/burn-rate-rules`.

The clock the fixture stamps its records against is fixed
(`2026-09-11T12:00:00Z`), so the relative "Last fired" text is stable run to run.
