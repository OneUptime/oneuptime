# Episode Bulk Add fixture

An offline harness for adding several alerts or incidents to an episode at once:
the real Alerts and Incidents lists (`Pages/Alerts/Alerts.tsx`,
`Pages/Incidents/Incidents.tsx`) with their Bulk Actions **Add to Existing
Episode** and **Add to New Episode**, and an episode's own Alerts / Incidents page
(`Pages/Alerts/EpisodeView/Alerts.tsx`, `Pages/Incidents/EpisodeView/Incidents.tsx`)
with its several-at-once **Add Alerts** / **Add Incidents** dialog. It bundles the
production pages with esbuild, replaces only the `ModelAPI` / `API` data boundary
and the synthetic user's permissions, and serves them on `127.0.0.1:4297`. No
Docker, no database, no sign-in.

The add request is answered as the server answers it (`EpisodeMembersAdd`): what
was added, what was in the episode already, and what was not added and why. Every
request the page sends is recorded on `window.__fixture` (`adds`, `creates`,
`deletes`, `listRequests`), so the suite checks what was asked as well as what was
drawn.

The suite drives it the way a person does:

- the alerts list's Bulk Actions offering both episode actions, before Delete;
- Add to Existing Episode: ongoing episodes first, then recently resolved ones;
  search by number; what happens to the selected alerts already in an episode;
  a resolved episode not reopened; one request for the whole selection; the
  result (added, in already, not added and why) with a link to the episode;
- one the server does not add (`?refuse=<id>`): reported with the reason, the
  rest added;
- no episode yet (`?noEpisodes=1`): the dialog offers Add to New Episode instead;
- Add to New Episode: the title and severity started from the most severe
  selected alert, never a private title; one create carrying every id; a refused
  create (`?failNew=1`) adding none;
- a viewer (`?role=viewer`): both actions locked, with the missing permission on
  hover; someone who may add but not create an episode (`?role=adder`);
- an alert episode's Add Alerts (`?page=alert-episode`): the episode's alerts left
  out, a note on those in another episode, number / state / severity per row,
  search by number with or without its prefix, several added in one request, what
  could not be added kept in the dialog with why;
- the same for incidents (`?page=incidents`, `?page=incident-episode`);
- loading and failing reads (`?slow=<tables>&slowMs=<ms>`, `?fail=<tables>`):
  the skeleton, then the list; the error, and Refresh reading it again;
- past what a dialog lists before a search (`?many=<n>`): it says so, and a
  search reaches the older ones;
- nothing left to add (`?onlyMembers=1`): the empty state, without a search
  box that could find nothing;
- long titles (`?long=1`) at a phone's width;
- a phone-width screen and dark mode (`?theme=dark`).

Run it with:

```bash
cd packages/E2E
npm run test-episode-bulk-add-ui
```

Screenshots land in `output/playwright/episode-bulk-add-ui/`. To look at a page by
hand, run `node EpisodeBulkAdd/Fixture/server.js` and open
`http://127.0.0.1:4297/dashboard/10000000-0000-4000-8000-000000000001/alerts`
(add `?page=alert-episode` to an episode's address, and `&lang=de` or `&lang=ja`
for the Dashboard's German or Japanese words).
