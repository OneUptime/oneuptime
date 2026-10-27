# Runbook Variables fixture

An offline harness for the pages runbook variables changed: Runbooks →
Settings → Global Variables
(`packages/App/FeatureSet/Dashboard/src/Pages/Runbook/Variables.tsx`), a
runbook's own Variables page (`Pages/Runbook/View/Variables.tsx`) and a
runbook's Steps page with its SSH and kubectl steps
(`Pages/Runbook/View/Steps.tsx`). It bundles the production
pages with esbuild, replaces only the `ModelAPI` / `API` data boundary and the
synthetic user's permissions, and serves them on `127.0.0.1:4383`
(`RUNBOOK_VARIABLES_FIXTURE_PORT` to change it). No Docker, no database, no
sign-in.

```sh
cd packages/E2E
npm run test-runbook-variables-ui
```

The suite drives the pages the way a person does:

- the Global Variables list says what a step writes to use each variable
  (`{{global.variables.NAME}}`, copied with one click), shows a plain value as
  it is and a secret as "Secret" only, and which Runners get each secret;
- Create Variable starts secret: name and Secret Value, then who may use it -
  global Runners switched on while the project uses them, and the project's
  own Runners; turned plain it is one step with a readable Value; a name a
  step could not write is refused on the form;
- Replace Value replaces a secret's value and sends only that; a plain
  variable has no such button; a Runbook Admin sees Create and Replace Value
  locked;
- a runbook's own Variables page lists its own (`{{local.variables.NAME}}`)
  and makes new ones the runbook's;
- an SSH step asks for the machine as `user@host`, the secret variable it
  signs in with and a bash script, with its port, key passphrase and host
  key folded under More fields; its sign-in picker offers secret variables
  only, by keyboard or mouse, and says when the step's Runner may not use
  the one picked; a host key pasted as `ssh-keyscan` prints it is saved as
  written, and a line that is not a key says the step will fail; Save Steps
  sends references, never values;
- a kubectl step takes a kubeconfig variable, or the Runner's own access, and
  a script of kubectl commands; a script naming a variable that is not there
  says so; a variable added in another tab
  (`window.__fixture.addVariable(name)`) is offered on coming back;
- steps written with a runbook credential through the API (`?legacy=1`) say
  they no longer run, as runbook credentials were removed, and one button
  turns each into a script step that does the same;
- a phone (nothing runs off the screen), dark mode (`?theme=dark`) and German
  (`?lang=de`).

`Fixture/Fixture.js` records every save (`updates`, with the model, the id and
the data) and every created record (`creates`) on `window.__fixture`, so the
assertions check what the pages sent as well as what they drew. The query
string steers it - see the comment at the top of `Fixture/Fixture.js`.
Screenshots of each state are written to
`output/playwright/runbook-variables-ui/`.
