# Acknowledgement Timeout fixture

An offline harness for the real
`packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/Escalation.tsx`
page: an on-call policy's Escalation Rules, beside the policy's own side menu, with
the Acknowledgement Timeout card folded under More settings (issue #5123: page again
when an acknowledged incident or alert is not resolved in time). It bundles the
production page with esbuild, replaces only the `ModelAPI` / `API` data boundary and
the signed-in user's permissions, and serves it on `127.0.0.1:4241`. No Docker, no
database, no sign-in.

The suite pins what the maintainer asked for - an advanced setting, hidden until
somebody looks for it, with as few decisions as possible:

- More settings is folded at first, below the level and the Repeat Policy card, and
  names the card it holds; once the policy pages again, it says after how long
  ("30 min")
- opened, it is one card with one row: "Don't page again", or "Page again if not
  resolved within 30 minutes"; its header is then "More settings" alone, the title
  level with the icon tile beside it
- the dialog asks one question with two answers, and the minutes only once Page
  again is picked, 30 to start with
- a save sends the one column, `acknowledgementTimeoutInMinutes`: the minutes, or
  empty (null) to turn it off; the form's own choice is never sent
- minutes under 5 or over 1440 are refused before anything is sent
- a save the server refuses says why and keeps the dialog open
- all of it at 1280 and 390 pixels wide, with nothing to scroll sideways, in dark
  mode and in German

`Fixture/Fixture.js` records every save on `window.__fixture.saves` (the policy as
the Dashboard serialises it for the API), so the assertions check what the page sent
as well as what it drew.

## Run it

```
cd packages/E2E
npm install --ignore-scripts
npm run test-acknowledgement-timeout-ui
```

Screenshots land in `output/playwright/acknowledgement-timeout-ui/`.

## Poke at it by hand

```
cd packages/E2E
node AcknowledgementTimeout/Fixture/server.js
```

then open
`http://127.0.0.1:4241/dashboard/10000000-0000-4000-8000-0000000000d1/on-call-duty/policies/20000000-0000-4000-8000-0000000000d1/escalation`,
optionally with `?timeout=30` (the policy pages again after 30 minutes),
`?fail=save` (the next save is refused), `?lang=de` or `?theme=dark`.
