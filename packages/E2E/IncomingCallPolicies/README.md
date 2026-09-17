# Incoming Call Policies fixture

An offline harness for the real
`App/FeatureSet/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicies.tsx` page. It
bundles the production page with esbuild, replaces only the `ModelAPI` / `API` data
boundary and the synthetic user's permissions, and serves it on `127.0.0.1:4214`. No
Docker, no database, no sign-in.

The page's Phone Numbers column is filled by a second request for each policy's
attached numbers, with the legacy scalar number folded back in. The suite pins that
cell through every outcome of that request and through the table's own controls:

- several attached numbers, a legacy-only number, an already-normalized legacy number
  and no number at all
- the request still in flight (`?phoneNumbers=hold`): legacy numbers stay visible,
  the rest say "Loading…" rather than "Setup Needed"
- the request failing (`?phoneNumbers=fail`): "Unavailable" with the error as its
  tooltip, legacy numbers kept
- the Enabled facet and the search box narrowing both the table query and the phone
  number lookup
- the two-step create form: required and minimum-length validation on Name, then the
  created policy appearing in the refetched table

`Fixture/Fixture.js` records every list request and every create on
`window.__fixture`, so the assertions check what the page asked for as well as what
it drew.

## Run it

```
cd E2E
npm install
npm run test-incoming-call-policies-ui
```

Screenshots land in `output/playwright/incoming-call-policies/`, named
`*-synthetic.png` because every record in them is fabricated.

## Poke at it by hand

```
cd E2E
node IncomingCallPolicies/Fixture/server.js
```

then open
`http://127.0.0.1:4214/dashboard/10000000-0000-4000-8000-000000000001/on-call-duty/incoming-call-policies`
(optionally with `?phoneNumbers=hold` or `?phoneNumbers=fail`). In hold mode, run
`window.__fixture.releasePhoneNumbers()` in the console to let the request finish.
