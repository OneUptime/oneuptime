# Shared buttons, dialogs and cards: before and after

Each pair is the same page from the Shared UI fixture (`packages/E2E/SharedUi`), which draws the
production components offline over synthetic data: every name in it (Notify on-call, Frankfurt,
Ada Lovelace, the teams) is made up. "Before" is built from master's components at the branch
point, "after" from this branch's. Captured at 1x.

- `buttons-1280` and `buttons-dark-1280`: every `ButtonStyleType`, pressable, locked and busy.
  Before, `OUTLINE` and the three `HOVER_*_OUTLINE` styles were bare words. A locked `NORMAL`,
  `OUTLINE`, `SUCCESS` or `WARNING` looked pressable, and a locked `PRIMARY`, `SECONDARY` or
  `DANGER` swapped to a paler fill, which was a bright block in the dark theme. A busy link's
  spinner pushed its words onto a line of their own.
- `ping-traceroute-1280`: a network device's Connectivity tools (the real `DeviceDiagnostics`).
- `locked-and-menus-1280`: a locked button with a reason (Reset API Key, Turn monitoring on), a
  card's outline Refresh, a bare ⋯ and a worded menu ("1m").
- `buttons-fa-1280`: the same in Persian. The icon keeps its gap on the words' side.
- `cards-390`: the Duplicate, Reset and Delete cards on a phone. Before, each was only a title
  and a button.
- `edit-dialog-1280`: an edit dialog that reads its record first, opened from the keyboard.
  Before, the focus stayed on Save Changes. After, it is on the form's first control, a switch.
- `duplicate-dialog-1280` and `reset-dialog-1280`: what each says now in place of "Are you sure".
- `delete-dialog-ja-1280`: a Japanese Delete question, with no space after "？".
- `pills-1280`: a label, a yes/no and a choice as one pill, and the stat tiles' plain names.
- `chips-390`: a multi-select's chips on a phone, whole names instead of cut ones.
- `avatars-dark-1280`: people and team avatars on a dark card.
- `add-custom-role-dialog-after.png`: a team's Add a Custom Role, with "Roles" as a link (from
  the Custom Roles suite's fixture).

Made by:

- `cd packages/E2E && node SharedUi/Fixture/server.js` (after), and the same `server.js` copied
  into an export of master's `packages/Common` and Dashboard sources with
  `SHARED_UI_FIXTURE_OUTPUT` and `SHARED_UI_FIXTURE_PORT` set (before), shot at 1x;
- `CI=1 npm run test-custom-roles-ui` (the Add a Custom Role dialog).

`CI=1 npm run test-shared-ui-ui` writes the suite's own frames to `output/playwright/shared-ui/`.
