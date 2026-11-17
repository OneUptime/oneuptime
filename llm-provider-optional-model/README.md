# Optional Model Name and the provider picker: before and after

Screenshots for the pull request "Optional Model Name for OpenAI-compatible
servers, and a cleaner provider picker". Each `<name>-before.png` is master at
344515bc18, each `<name>-after.png` this branch, both drawn by the
LlmProviderTest fixture (`packages/E2E/LlmProviderTest`), which renders the real
Project Settings > AI > LLM Providers page with the app's esbuild config,
Tailwind, theme and font.

- `provider-step-1280-*`: Create LLM Provider, the Provider step, 1280px.
- `provider-step-picked-1280-*`: the same, OpenAI-Compatible picked.
- `provider-step-1280-dark-*`: the dark theme, Anthropic picked.
- `provider-step-1280-de-*`: in German.
- `provider-step-390-*`: at phone width (2x).
- `connection-compatible-1280-*`: the Connection step of an OpenAI-compatible
  server: Model Name was required, it is optional now, and its hint says what a
  blank one gets.
- `list-blank-model-1280-after.png`: the project's list (`?blankmodel=1`): an
  OpenAI-compatible provider with no Model Name reads "First model the server
  lists".
