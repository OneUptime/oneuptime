# Profiler fixture

An offline harness for the real Profiler: its layout and overview
(`packages/App/FeatureSet/Dashboard/src/Pages/Profiles`), a function's panel
with Fix with AI, the compare menu, and a service's Profiles tab
(`Pages/Service/View/Profiles.tsx`). It bundles the production components with
esbuild, replaces only the `API` / `ModelAPI` / `AnalyticsModelAPI` data
boundary and the synthetic user, and serves them on `127.0.0.1:4391`. No
Docker, no database, no sign-in.

Behind the data boundary is a small profile store that answers the Profiler's
reads the way the server does: four services and a host sampled every
minute, whose checkout service shipped v2.4.0 forty minutes before the
spec's clock (its order parser has parsed a much bigger payload since).
The function list counts self, total and own-code time as
`ProfileAggregationService.buildFunctionList` does, comparisons are Common's
`compareProfileWindows`, and Fix with AI is offered by Common's
`getProfileFixOffer` on own-code time read from the focus trees, as
`ProfileFixTaskTrigger` decides it.

The suite covers, on a laptop and on a phone:

- the answer in words before any chart: where the time goes, and the
  application's own code that takes the most;
- the kinds a scope has data for (and nothing else), the eBPF profiler's CPU
  samples read apart from CPU time in nanoseconds, kernel threads folded
  away in what is profiled;
- comparing with the period before and with a deploy picked from the compare
  menu, the diff flame graph, and the functions that moved - by self share,
  or the application's own by own-code share;
- a function's panel: its shares, who calls it, what it calls, its source in
  the repository, the flame graphs, a monitor on its share (Create Monitor,
  prefilled), and code that is not the application's own pointing at the
  own code that calls it;
- Fix with AI started, a repository picked, and every reason it is not
  offered said in its place (no repository, a fix on its way, no AI credits,
  AI off, a refusal);
- the first steps with no profile anywhere, an empty window with the past
  week one click away, and a service's own tab locked to it;
- dark mode.

## Run it

```
cd packages/E2E
npm install
npm run test-profiles-ui
```

Screenshots land in `output/playwright/profiles-ui/`, named `*-synthetic.png`
because every record in them is fabricated.

## Poke at it by hand

```
cd packages/E2E
node Profiles/Fixture/server.js --watch
```

then open `http://127.0.0.1:4391/dashboard/10000000-0000-4000-8000-000000000001/profiles`.
`--watch` rebuilds the bundle when a source file changes. The scenario query
parameters (`?data=`, `?ai=`, `?repo=`, `?fix=`, `?blocker=`, `?fail=`,
`?theme=dark`) are documented at the top of `Fixture/Fixture.js`, beside the
page's own address parameters.
