# Public addresses fixture

An offline harness for the addresses a status page, a public dashboard or
a form answers at - `Components/CustomDomain/PublicAddresses`, drawn by a
status page's **Status Page Link** card on its Overview, under a dashboard's
public choice on its **Sharing** page, and by a form's **Share Link** card
on its **Share** page. It bundles the real pages with
esbuild, replaces only the `ModelAPI` / `API` data boundary and the synthetic
user's permissions, and serves them on `127.0.0.1:4381`
(`PUBLIC_ADDRESSES_FIXTURE_PORT` moves it). No Docker, no database, no
sign-in.

The pages:

- `/dashboard/<project>/status-pages/<id>` - a status page's Overview;
- `/dashboard/<project>/dashboards/<id>/authentication-settings` - a
  dashboard's Sharing page;
- `/dashboard/<project>/forms/<id>/share` - a form's Share page.

The suite (`PublicAddresses.spec.ts`) checks in Chromium what jsdom cannot:

- the addresses in their order - live custom domains, those not live yet,
  then the OneUptime address - each live one a link that opens in a new tab
  and copies the whole address, each custom domain not live yet saying
  "Not live yet" and why, with DNS Setup (the Custom Domains page's own
  dialog) where there is something to do, and Check now reading the list
  again;
- a long address cut short with "..." inside its row, with the whole of it
  on hover; at a phone's width every row inside its card, the tile beside
  each address not drawn so the address has its width, its action under
  the address, nothing scrolling sideways; Copy link and DNS Setup one size;
- a live address is a link only as wide as its words, so a click on the
  empty space beside it opens nothing, and the keyboard's focus ring is
  drawn inside its line, never over the line under it;
- the line saying visitors sign in or enter the password, under the
  addresses and before the offer to add a domain;
- someone who may not read the custom domains is not asked about them; a
  read that fails says so and Try again reads them again; the loading
  placeholder keeps a row's shape;
- the words and the frame legible in the dark theme (WCAG AA), and in German;
- a dashboard's custom domains under its public choice, and none read while
  it is private;
- a form's own domains first on its Share Link card, then its link, with
  Reset Link; the offer to add a domain linking to the form's Custom Domains
  page; the turned-off notice under the addresses; dark, German and Persian.

`Fixture/Fixture.js` records every list read on
`window.__fixture.listRequests`, every API read on `window.__fixture.apiGets`,
and every read it does not model on `window.__fixture.unmodelled` (the suite
fails on any).

## Run it

```
cd packages/E2E
npm install
npm run test-public-addresses-ui
```

Screenshots land in `output/playwright/public-addresses-ui/`, named
`*-synthetic.png` because every record in them is made up.

## Poke at it by hand

```
cd packages/E2E
node PublicAddresses/Fixture/server.js
```

Then open
`http://127.0.0.1:4381/dashboard/10000000-0000-4000-8000-000000000001/status-pages/30000000-0000-4000-8000-000000000001`
(or the Sharing page above), adding
`?domains=live:status.acme.com;dns:status-eu.acme.com;issuing:status-apac.acme.com`
(states: live, dns, issuing, unordered, failed, expired, uploaded, renewal),
`?access=signin|password`, `?share=private|link|password`, `?enabled=0`,
`?role=viewer|noread`, `?fail=domains|certs`, `?delay=<ms>`, `?cname=0`,
`?lang=de|ja|fa` or `?theme=dark`.
