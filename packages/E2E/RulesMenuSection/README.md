# Rules menu section fixture

An offline harness for the Rules section of two side menus, around their real
view layouts (ModelPage's header and breadcrumbs, the archived banner and the
side menu):

- a status page's menu (`packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SideMenu.tsx`),
  whose Rules section holds Monitor Rules, right below Resources;
- an SLO's menu (`Pages/Slo/View/SideMenu.tsx`), whose Rules section holds
  Monitor Rules and Burn Rate Rules, right below Configuration.

Both sections start folded ("Create a new section for rules and have monitor
rules there. The section should be collapsed by default", the maintainer). The
fixture bundles the production layouts with esbuild, replaces only the
`ModelAPI` / `API` data boundary and the signed-in user, and serves them on
`127.0.0.1:4385` (`RULES_MENU_SECTION_FIXTURE_PORT` moves it). The pages inside
the layouts are stand-ins that name the page they stand for: the suite is
about the menu beside them. No Docker, no database, no sign-in.

```sh
cd packages/E2E
npm run test-rules-menu-section-ui
```

What it checks, in Chromium, that jsdom cannot (the jest suites
`StatusPageRulesMenu`, `SloViewSideMenu` and `RulesMenuSections` in
packages/Common read the classes a folded section carries):

- on a status page's Overview the sections read Basic, Resources, Rules,
  Subscribers and the rest; Rules is drawn folded between the resources entry
  and Subscribers, and Monitor Rules is out of sight;
- a folded Rules is out of the keyboard's way (Tab goes from its title to the
  next section's), opens from a click and from Enter or Space, and its row is
  the next stop on the way to Monitor Rules;
- the Monitor Rules page, and one rule's own page, open Rules by themselves,
  with the entry marked; Rules stays open while the pages change, and is
  folded again on a fresh visit;
- with monitor groups on (`?groups=1`) the resources entry reads Resources and
  Rules still holds Monitor Rules;
- on an SLO's Overview, Configuration, Rules and Management are folded; Rules
  holds Monitor Rules above Burn Rate Rules, and Burn Rate Rules (or one
  monitor rule's page) opens it while Configuration stays folded;
- on a phone, Rules opens in the menu without closing it, Monitor Rules leads
  to its page, and the menu's summary names "Rules / Monitor Rules";
- in German (`?lang=de`) the section is "Regeln" and still folds by its English
  title; in dark mode (`?theme=dark`) its heading reads against the menu.

Every read the fixture does not model is recorded on
`window.__rulesMenuFixture.unhandled`, and the suite fails if any is. So does
an uncaught page error, or a request that leaves the fixture server.

Screenshots land in `output/playwright/rules-menu-section-ui/`, named
`*-synthetic.png` because every record in them is fabricated by
`Fixture/Fixture.js`.

## Poke at it by hand

```sh
cd packages/E2E
node RulesMenuSection/Fixture/server.js
```

then open
`http://127.0.0.1:4385/dashboard/10000000-0000-4000-8000-0000000000f1/status-pages/20000000-0000-4000-8000-0000000000f2`
or
`http://127.0.0.1:4385/dashboard/10000000-0000-4000-8000-0000000000f1/slos/30000000-0000-4000-8000-0000000000f3`,
with `?groups=1`, `?lang=de` or `?theme=dark` if you like.
