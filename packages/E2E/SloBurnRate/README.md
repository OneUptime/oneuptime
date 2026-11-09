# SLO Burn Rate Rules, Error Budget Policy and Overview fixture

An offline harness for the real
`packages/App/FeatureSet/Dashboard/src/Pages/Slo/View/BurnRateRules.tsx` page, the
Error Budget Policy page (`Pages/Slo/View/ErrorBudgetPolicy.tsx`), the SLO
overview with its production layout and side menu, and the SLO list with its Bulk
Actions (`Pages/Slo/Slos.tsx`). It bundles the
production component with esbuild, replaces only the `ModelAPI` / `API` data boundary
with synthetic records, and serves it on `127.0.0.1:4213`. No Docker, no database, no
sign-in — so it runs against a branch without touching a shared dev stack.

It exists because a burn rate rule's two outputs (raise an Alert, declare an Incident)
are only legible in the rendered table: which rule declares what, which severities,
on-call policies, owners and labels each output uses, which options depart from the
defaults (resolved by hand, private, SLO owners added as owners), and whether the rule
is firing right now. The spec also walks the create wizard (Rule, Burn Window, What It
Declares, then Alert and Incident for the outputs the rule opens). What It Declares asks
one question, When it fires, with three answers (Create an alert, Declare an incident,
Both), and the step rail follows the answer. It checks expandable settings, prefilled
templates and clearing them to use backend defaults, create/edit persistence,
validation, Enabled on the edit form only, and desktop and mobile modal layouts. It
also saves rules answered with one output only and checks that picking Both again
restores the other output's title, description and routing.

`OverviewDetails.spec.ts` checks the Details card above open alerts and incidents
at desktop widths (1440 and 1280), the single-column tablet/mobile layout (1024
and 390), empty optional fields, edit/save/cancel (the labels fold under Advanced,
and a save keeps them while folded), hero refresh after saving, and documentation
access. It verifies the edit action stays inside the narrow sidebar and captures
desktop and mobile overview screenshots. The hero adds owners right there: Add owners
(nobody owns the SLO) and the + after the avatars (`?owners=team`: the Checkout team owns
it) open the Add owners list, and each pick is a row the hero's next read names. The
overview route is the same URL without `/burn-rate-rules`; add `?details=empty` for blank
description and labels.

`BulkRecommendedRules.spec.ts` opens the SLO list itself
(`/dashboard/10000000-0000-4000-8000-000000000001/slos`, the real `Pages/Slo/Slos.tsx`),
which lists four SLOs with rules of their own: Checkout availability (30 days, missing
Slow leak), Search latency (7 days, missing Slow leak in its 16.8-hour shape), Payments
API (all three rules) and Login (a calendar month with only a renamed fast-burn rule, so
missing Slow burn and Slow leak). Bulk Actions > Add recommended rules on all four says
how many SLOs get which rules, in which shape, before anything is added; confirming adds
exactly that, in one request for the three that need it (recorded on
`window.__bulkRecommendedAdds`), and the result says what happened to each SLO. Asked
again, there is nothing to add. The confirmation is also checked at a phone's width.

`ErrorBudgetPolicy.spec.ts` opens the same URL ending in `/error-budget-policy`. An SLO
with no tiers is offered Use the recommended policy: its confirmation lists exactly the
tiers it adds, each raising nothing, and adds just those (closing it adds nothing). A
new tier's form asks Name, Budget Left Threshold (%) and What We Do, with its alerts and
incidents folded away and switched off. With `?policy=recommended` the SLO has the
recommended tiers and is in Reliability first, which the overview shows under its
summary, with what the team does there and a link to the policy.

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
