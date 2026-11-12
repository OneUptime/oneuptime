# A code change's cautions, a line each

The UI review of PR #6977 (issues #6533 and #6570).

How these were made: the real `ToolApprovalCard`, inside Ask AI's panel, from a copy of the Ask AI
offline fixture (`packages/E2E/AskAi/Fixture`). It was bundled with the Dashboard's esbuild config,
Tailwind runtime, `Theme.css` and Inter, and rendered in headless Chromium at 2x, in the panel
docked at 1280 px and on a 390 px phone. Each commit and pull request was built the way the server
stores it: the card lines from `CodeFilesSeen` as `Common/Types/AI/AIActionWords` sentences, drawn
in the reader's language. Every `before-*` image is the branch at 12edce07b60 (before the review),
rendered the same way. These are not screenshots of a running stack, and every file and commit is
made up.

- `before-two-cautions-1280.png` / `after-two-cautions-1280.png`: a commit with a file read in an
  earlier answer and one read earlier in this answer (the line #6570 adds). Before: the two
  sentences ran on in one paragraph. They begin with the same words, so they read as one sentence
  said twice, and README.md sat in the middle of the paragraph. After: each caution is its own
  line, with an amber warning mark at its start.
- `before-four-cautions-1280.png` / `after-four-cautions-1280.png`: a pull request with four kinds
  of caution: changed since read, read in an earlier answer, two files read earlier in this
  answer, and read in part.
- `before-four-cautions-390-de.png` / `after-four-cautions-390-de.png`: the same in German on a
  phone. Before: one block of 13 lines. After: four cautions, each with its files at its end.
- `before-two-cautions-1280-fa.png` / `after-two-cautions-1280-fa.png`: Persian, right to left. The
  marks sit at the right, where each line starts, and each file name keeps its own direction.
- `after-two-cautions-1280-ar-dark.png`: Arabic in the dark theme; the marks use the dark theme's
  amber.
- `after-two-cautions-390-ja.png`: Japanese on a phone; no space follows a Japanese full stop.
- `after-long-path-390.png`: a long path wraps inside its line, under its sentence, never past the
  card.
- `after-four-cautions-390-dark.png`: the four cautions on a phone in the dark theme.

The offline browser suite takes the same card at 1280 px, in the dark and at 390 px in Persian
(`AskAi.spec.ts`, "a code change's cautions"), from the fixture's `?thread=code`.
