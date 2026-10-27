# First on-call policy fixture

An offline harness for On-Call Duty > Policies
(`packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicies.tsx`) and its
Create On-Call Policy dialog, beside the on-call side menu, as a brand-new project meets
them. It bundles the production layout and page with esbuild, replaces only the
`ModelAPI` / `API` data boundary and the signed-in user's permissions, and serves it on
`127.0.0.1:4729` with the Dashboard's Tailwind runtime, its reading-direction config, the
theme and the font. No Docker, no database, no sign-in.

A policy pages nobody until an on-call rule or a monitor triggers it, and a new project has
neither: the newcomer who did what Home's checklist asked - "Set up an on-call policy" - was
paged by nothing. So a project's first policy is asked "Page this policy for every new
incident and alert", on to start with (`Common/Types/OnCallDutyPolicy/EveryNewEventRules.ts`),
and the server adds an incident and an alert on-call rule for it. The suite pins, in Chromium:

- in a new project (no policy, no on-call rule), the switch in the dialog: named for the
  policy, on, what it does said under it and read with it, between "Who gets paged first?"
  and More fields, the dialog still one page; the project's policies and both kinds of rules
  counted once the empty list is back
- what Create sends: `pageForEveryNewIncidentAndAlert: true` as misc data beside the policy
  (never a column of it), and the new policy opening on its Escalation Rules; switched off
  (by its words, which are its label), nothing asks for the rules
- when it is not asked: a project with a policy (`?policies=one`, and then nothing is
  counted), one with an incident on-call rule and no policy (`?rules=incident`), counts that
  fail (`?counts=fail`), and someone who may create a policy but not an on-call rule
  (`?role=member`, a Project Member); none of them sends the switch
- counts that answer late (`?counts=hold`): the switch joins the dialog already open, on
- the switch's row at a 390px phone (the switch first, its words wrapping beside it, nothing
  to scroll sideways), in German (`?lang=de`) and in Persian in dark mode
  (`?lang=fa&theme=dark`: right to left, the switch on the right with its knob at the end,
  its words light on the dark dialog)

`Fixture/Fixture.js` records every create (the policy and the misc data sent beside it),
every count asked and every read of a table it does not model on `window.__fixture`; the
spec fails on any unmodelled read.

## Run it

```
cd packages/E2E
npm install --ignore-scripts
npm run test-first-on-call-policy-ui
```

Screenshots land in `output/playwright/first-on-call-policy-ui/`, named `*-synthetic.png`
because every record in them is fabricated.
