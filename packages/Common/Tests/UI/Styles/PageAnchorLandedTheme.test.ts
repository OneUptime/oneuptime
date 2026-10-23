import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { declaredValue, selectorsDeclaring } from "./ThemeStylesheet";
import {
  PAGE_ANCHOR_FOCUSED_ATTRIBUTE,
  PAGE_ANCHOR_LANDED_ATTRIBUTE,
  PAGE_ANCHOR_LANDED_IN_MS,
} from "../../../UI/Utils/PageAnchor";

/*
 * The place a link landed on, as Theme.css draws it (UI/Utils/PageAnchor,
 * markPageAnchorLanded): "Pick a Runner" lands on a repository's Runner,
 * one of six settings under More settings. On a tall screen the page cannot
 * scroll it to the top, so the setting the link was for is tinted and the
 * tint fades - over the time the mark is held - in both themes; a reader
 * who asks for less motion gets the tint held still instead. The focus the
 * landing gives the place is ringed for a keyboard reader inside its edge,
 * as a row's focus ring is, so the card it is a section of does not clip
 * it - and no focus ring anywhere is silenced for it (ChartFocusRing holds
 * that only charts silence theirs).
 *
 * The @keyframes and @media blocks are read from the sheet's text (the
 * shared reader collects top-level rules only).
 */

const THEME_CSS: string = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
  "utf8",
);

const LANDED: string = `[${PAGE_ANCHOR_LANDED_ATTRIBUTE}]`;

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

describe("the place a link landed on, in Theme.css", () => {
  test("the attributes the sheet draws are the ones markPageAnchorLanded sets", () => {
    expect(PAGE_ANCHOR_LANDED_ATTRIBUTE).toBe("data-page-anchor-landed");
    expect(PAGE_ANCHOR_FOCUSED_ATTRIBUTE).toBe("data-page-anchor-focused");
    expect(THEME_CSS).toContain(`${LANDED} {`);
    expect(THEME_CSS).toContain(
      `[${PAGE_ANCHOR_FOCUSED_ATTRIBUTE}]:focus-visible {`,
    );
  });

  test("a tint of the product's indigo in each theme - light on white, lighter on the dark card", () => {
    expect(declaredValue(LANDED, "--ou-page-anchor-landed-tint")).toBe(
      "rgb(99 102 241 / 12%)",
    );
    expect(
      declaredValue(`html.dark ${LANDED}`, "--ou-page-anchor-landed-tint"),
    ).toBe("rgb(129 140 248 / 18%)");
  });

  test("the tint fades from the theme's tint to clear", () => {
    const keyframes: Array<string> = blocksOpenedBy(
      "@keyframes ou-page-anchor-landed",
    );

    expect(keyframes).toHaveLength(1);
    expect(collapse(keyframes[0]!)).toBe(
      "from { background-color: var(--ou-page-anchor-landed-tint); } to { background-color: transparent; }",
    );
  });

  test("it fades only for a reader who has not asked for less motion, over exactly the time the mark is held", () => {
    const animated: Array<string> = blocksOpenedBy(
      "@media (prefers-reduced-motion: no-preference)",
    ).filter((block: string): boolean => {
      return block.includes(LANDED);
    });

    expect(animated.map(collapse)).toEqual([
      `${LANDED} { animation: ou-page-anchor-landed ${
        PAGE_ANCHOR_LANDED_IN_MS / 1000
      }s ease-out; }`,
    ]);

    // Nowhere else: no motion outside that block.
    expect(THEME_CSS.split("animation: ou-page-anchor-landed").length - 1).toBe(
      1,
    );
  });

  test("a reader who asks for less motion gets the tint held still, gone when the mark goes", () => {
    const still: Array<string> = blocksOpenedBy(
      "@media (prefers-reduced-motion: reduce)",
    ).filter((block: string): boolean => {
      return block.includes(LANDED);
    });

    expect(still.map(collapse)).toEqual([
      `${LANDED} { background-color: var(--ou-page-anchor-landed-tint); }`,
    ]);
  });

  test("the focus a landing gives the place is ringed for a keyboard reader, inside its edge, in each theme's indigo", () => {
    const focused: string = `[${PAGE_ANCHOR_FOCUSED_ATTRIBUTE}]:focus-visible`;

    expect(declaredValue(focused, "outline")).toBe("2px solid #6366f1");
    // Inside the edge: the card it is a section of clips what reaches past.
    expect(declaredValue(focused, "outline-offset")).toBe("-2px");
    expect(declaredValue(`html.dark ${focused}`, "outline-color")).toBe(
      "#818cf8",
    );
  });

  test("no focus ring is silenced for it: the browser's ring for a mouse click stays the browser's", () => {
    for (const selector of selectorsDeclaring("outline", "none")) {
      expect(selector).not.toContain(PAGE_ANCHOR_FOCUSED_ATTRIBUTE);
      expect(selector).not.toContain(PAGE_ANCHOR_LANDED_ATTRIBUTE);
    }
    expect(declaredValue(LANDED, "outline")).toBeUndefined();
  });

  test("it comes before the spinner arcs' colours, which stay last in the sheet", () => {
    expect(THEME_CSS.indexOf("@keyframes ou-page-anchor-landed")).toBeLessThan(
      THEME_CSS.indexOf("html.dark .border-t-indigo-500,"),
    );
  });
});
