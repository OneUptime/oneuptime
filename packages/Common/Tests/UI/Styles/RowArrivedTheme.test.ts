import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  LIVE_ROWS_ARRIVED_IN_MS,
  ROW_ARRIVED_ATTRIBUTE,
} from "../../../UI/Components/ModelTable/LiveRows";

/*
 * A row a list that keeps itself current just read in, as Theme.css draws
 * it (ModelTable/LiveRows, data-row-arrived): a new incident on a list
 * someone keeps open is tinted as the place a link landed on is, and the
 * tint fades, so the eye finds it among the rows that moved down for it.
 *
 * What the sheet must hold:
 *   - a table row's cells take the tint, not the row: the row's white is
 *     !important in the dark theme, which an animation cannot paint over;
 *   - the tint is opaque - the card's own colour with the indigo mixed in -
 *     and fades to each cell's own colour (no "to" frame): the Actions
 *     cell that sticks at the row's end takes the row's colour, and the
 *     cells scrolling under it must never show through it;
 *   - a phone's card takes it as an inset shadow, over its own white;
 *   - it lasts as long as the mark (LIVE_ROWS_ARRIVED_IN_MS), and a reader
 *     who asks for less motion gets it held still until the mark goes;
 *   - the dark theme has a tint of its own, on the dark card.
 *
 * The @keyframes and @media blocks are read from the sheet's text, as
 * PageAnchorLandedTheme reads them.
 */

const THEME_CSS: string = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
  "utf8",
);

const ARRIVED: string = `[${ROW_ARRIVED_ATTRIBUTE}]`;

// The text inside the braces of every block the sheet opens with `prelude`.
function blocksOpenedBy(prelude: string): Array<string> {
  const blocks: Array<string> = [];
  let from: number = 0;

  for (;;) {
    const at: number = THEME_CSS.indexOf(`${prelude} {`, from);

    if (at === -1) {
      return blocks;
    }

    const open: number = THEME_CSS.indexOf("{", at);
    let depth: number = 0;
    let close: number = open;

    for (let index: number = open; index < THEME_CSS.length; index++) {
      if (THEME_CSS[index] === "{") {
        depth++;
      } else if (THEME_CSS[index] === "}") {
        depth--;

        if (depth === 0) {
          close = index;
          break;
        }
      }
    }

    blocks.push(THEME_CSS.slice(open + 1, close));
    from = close + 1;
  }
}

const WHITESPACE: RegExp = /\s+/;

function collapse(text: string): string {
  return text.split(WHITESPACE).join(" ").trim();
}

describe("a row a live read brought in, in Theme.css", () => {
  test("the attribute the sheet draws is the one the table sets", () => {
    expect(ROW_ARRIVED_ATTRIBUTE).toBe("data-row-arrived");
    expect(THEME_CSS).toContain(`${ARRIVED} {`);
  });

  test("the tint is the card's own colour with the indigo mixed in, in each theme", () => {
    const light: Array<string> = blocksOpenedBy(ARRIVED).map(collapse);
    const dark: Array<string> = blocksOpenedBy(`html.dark ${ARRIVED}`).map(
      collapse,
    );

    expect(light).toContain(
      "--ou-row-arrived-tint: color-mix( in srgb, rgb(99 102 241) 12%, var(--ou-surface-primary) );",
    );
    expect(dark).toContain(
      "--ou-row-arrived-tint: color-mix( in srgb, rgb(129 140 248) 18%, var(--ou-surface-primary) );",
    );
  });

  test("it fades from the tint to each cell's own colour: no frame of its own at the end", () => {
    const cells: Array<string> = blocksOpenedBy(
      "@keyframes ou-row-arrived",
    ).map(collapse);
    const card: Array<string> = blocksOpenedBy(
      "@keyframes ou-row-arrived-card",
    ).map(collapse);

    expect(cells).toEqual([
      "from { background-color: var(--ou-row-arrived-tint); }",
    ]);
    expect(card).toEqual([
      "from { box-shadow: inset 0 0 0 100vmax var(--ou-row-arrived-tint); }",
    ]);
  });

  test("a row's cells and a phone's card fade over the time the mark is held", () => {
    const motion: string = blocksOpenedBy(
      "@media (prefers-reduced-motion: no-preference)",
    )
      .map(collapse)
      .join(" ");
    const seconds: number = LIVE_ROWS_ARRIVED_IN_MS / 1000;

    expect(motion).toContain(
      `tr${ARRIVED} > td { animation: ou-row-arrived ${seconds}s ease-out; }`,
    );
    expect(motion).toContain(
      `div${ARRIVED} { animation: ou-row-arrived-card ${seconds}s ease-out; }`,
    );
  });

  test("less motion: the tint is held still until the mark goes", () => {
    const still: string = blocksOpenedBy(
      "@media (prefers-reduced-motion: reduce)",
    )
      .map(collapse)
      .join(" ");

    expect(still).toContain(
      `tr${ARRIVED} > td { background-color: var(--ou-row-arrived-tint); }`,
    );
    expect(still).toContain(
      `div${ARRIVED} { box-shadow: inset 0 0 0 100vmax var(--ou-row-arrived-tint); }`,
    );
  });

  test("never the row itself: its white is !important in the dark theme", () => {
    expect(THEME_CSS).not.toMatch(/tr\[data-row-arrived\]\s*\{/);
    expect(collapse(THEME_CSS)).toContain(
      'html.dark .bg-white, html.dark [class~="!bg-white"] { background-color: var(--ou-surface-primary) !important; }',
    );
  });
});
