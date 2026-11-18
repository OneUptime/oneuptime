# How to Reach Me fixture

An offline harness for How to Reach Me's ladder (#6820, #7453): the real User
Settings > How to Reach Me page (`Pages/UserSettings/OnCallRules.tsx`, drawn by
`Components/NotificationRule/HowToReachMe.tsx`), its inline add (#7451), and the
real Default Ladder for New Members and Phone for People on Call cards of Project
Settings > Notification Channels (`PagingLadder/DefaultPagingLadderCard.tsx` and
`PagingLadder/PhoneForOnCallCard.tsx`, #7449).
It bundles the production components with esbuild, replaces only the `ModelAPI` /
`API` data boundary and the synthetic user's permissions, and serves them on
`127.0.0.1:4738`. No Docker, no database, no sign-in.

The fixture's people (`?person=`):

- `one-ladder` (the default): Maya, with push, email, SMS and a phone call, and
  one ladder in every card - push and email at once, SMS after 5 minutes, a call
  after 15;
- `differing`: Maya again, with two Incidents cards that differ - a call at once
  more for Critical, no call at all for Minor;
- `email-only`: Maya with only her email, in a project that asks everyone on call
  for a phone method.

`?page=default-ladder` draws the two project cards instead, with no default saved
yet. `?lang=de|fa` draws them in German or Persian (right to left), `?theme=dark`
in dark mode.

The suite checks:

- the steps in the order they page, each with its number, and how many ways each
  step reaches;
- a person with one ladder: nothing differs, and the grid's cards carry no tag;
- a person whose cards differ: the cards named under the steps with what each does
  instead, tagged "Differs from the ladder" in the grid, and named again in the
  confirmation before Use This Ladder for Every Severity replaces them - the one
  request it sends, and the grid with no tag after it;
- the inline add: the project's ask for a phone, Add your phone, its code in the
  dialog every number is verified in, the same number added for calls with no
  second code, and the ladder read again with both; Use this browser; Get the app's
  codes, and on a phone, which shows no codes, the sentence that sends it to the
  stores, with the address to sign in to on one line;
- the project's default ladder: channels, never anybody's devices, and the
  `defaultPagingLadder` it saves; the phone ask's switch;
- both views, the inline add and the default ladder at 1280 and 390 pixels, light
  and dark, in German and in Persian: nothing scrolls sideways, and the
  confirmation fits the window.

Run it from `packages/E2E`:

```sh
npm run test-how-to-reach-me-ui
```

Screenshots land in `output/playwright/how-to-reach-me-ui/`.
