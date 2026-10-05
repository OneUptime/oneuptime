# Color picker fixture

An offline harness for the product's one color field,
`Common/UI/Components/Forms/Fields/ColorPicker` (its parts live in
`Common/UI/Components/ColorPicker`), in a real browser:

| Scenario (`?scenario=`) | What it draws                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label` (default)       | The Create Label dialog of the report: the real `Modal` and `BasicForm` with Name, Description and a required Label Color, already picked (`?color=`, `""` for none). |
| `options`               | A dialog holding a custom field's options (`DropdownOptionsInput`), each with an optional color in the compact layout, the last ones at the foot of the dialog. |
| `page`                  | An optional color field on a page, and a compact one at the foot of a long page.                                                                               |

`?theme=dark` turns the dark theme on before anything renders. What a form submits
is written to `[data-testid=submitted]`, and whether the dialog is still open to
`[data-testid=dialog-state]`.

`Fixture/server.js` bundles the production components with esbuild and serves them
with the app's Tailwind runtime, `Theme.css`, Inter and the Dashboard's universal
font rule, on `127.0.0.1:4262` (`COLOR_PICKER_FIXTURE_PORT`). No Docker, no
database, no API.

## Running it

```bash
cd packages/E2E
npm run test-color-picker-ui
```

It runs in Chromium and Firefox at a desktop size, and in Chromium at a small
phone's width (360px). jsdom lays nothing out, so this is where the field's
layout is checked: Custom color opening inside the dialog body above its buttons,
a row's popover staying inside the dialog body and the window (the report showed
the old picker spilling over Create Label's footer and out of the dialog), a real
drag across the saturation square, the dark theme's surfaces, and the swatches
wrapping as two lines of five on a phone. The component, keyboard and placement
rules themselves are pinned in `packages/Common/Tests/UI/Components/ColorPicker`
and `packages/Common/Tests/UI/Components/Forms/ColorPicker*.test.tsx`.

CI's Dashboard Offline UI job lists the suites it runs in
`.github/workflows/test.app.yaml`; `test-color-picker-ui` belongs in a group
that installs Chromium and Firefox.
