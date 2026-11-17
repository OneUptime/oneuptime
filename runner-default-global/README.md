# An AI rule's Runner on the Global Runner

How these were made: the repository's offline AI rules fixture
(`packages/E2E/AutoRemediationRules`), which bundles the real Incidents → AI → Settings page,
its AI rules table and the rule's create dialog with the Dashboard's own esbuild config, rendered
in headless Chromium with the model APIs answered from memory, the Dashboard's Tailwind runtime
and the Inter font, at 2x (`after-more-fields.png` at 1x). `before-*` is master at abd6e865be,
rendered the same way; `review-before-*` is this pull request before its UI review. They are
not screenshots of a running stack. Every name in them is made up.

Each shot is the create dialog's Fix step with More fields open, at the Runner field.

- `before-no-runners.png`: what the maintainer saw in a project with no Runner of its own:
  **No Runner**, and a line to go and add one.
- `before-runners-menu.png`: with Runners of its own, the menu offered them only, and a rule that
  picked none read **No Runner**.
- `after-no-runners.png`: the same project now shows **Global Runner · Connected**. The line
  under it is drawn like the hints under the rule's other pickers, and says that OneUptime AI
  runs no Bash commands on the Global Runner, which every project shares, with where to add a
  Runner that will.
- `after-runners-menu.png`: with Runners of its own, the Global Runner comes first, saying what
  it is; picking it saves none.
- `after-project-default-menu.png`: a new rule in a project with a default Runner starts on
  that Runner, tagged; the Global Runner follows it.
- `after-global-runners-off.png`: a project that turned global Runners off reads **No Runner**,
  as before.
- `after-more-fields.png`: the whole Fix step, More fields open: the Runner's line is the size
  and colour of the Code Repositories, MCP Servers and LLM Provider hints above it.
- `after-390-dark.png` and `after-de.png`: a phone in dark mode, and German.
- `review-before-fa-390.png` and `after-fa-390.png`: Persian. Before the review the box laid
  "Runner سراسری · متصل" out left to right, so "Runner" came after "Connected"; it now reads
  right to left, as the menu does.
