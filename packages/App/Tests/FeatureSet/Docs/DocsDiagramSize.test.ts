import {
  CssRule,
  DOCS_STYLESHEET,
  declaredIn,
  readCssRules,
} from "./DocsStylesheet";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * How big the docs draw a diagram. Mermaid lays a diagram out at a size of
 * its own, and the docs' diagram script (Views/Partials/Head.ejs) used to
 * stretch every diagram to the column's full width: the overhaul's narrow
 * top-to-bottom diagrams were drawn up to twice their size, a 263px one
 * 590px wide with 36px labels. The final pass of the overhaul (task 40)
 * draws each at its own size, in the middle of the column, and a wider one
 * smaller to fit - down to 13/16 of its size, its 16px labels no smaller
 * than the 13px caption under it; wider still, its box scrolls.
 *
 * Common's DocsDiagramScript runs the script in jsdom and E2E's
 * DocsDiagramSizes draws real diagrams in a browser; these hold the two
 * numbers the rule rests on, and the stylesheet that places the drawing.
 */

const HEAD: string = fs.readFileSync(
  path.resolve(__dirname, "../../../FeatureSet/Docs/Views/Partials/Head.ejs"),
  "utf8",
);

const RULES: Array<CssRule> = readCssRules(DOCS_STYLESHEET);

const DIAGRAM_SVG: string = ".docs-diagram .mermaid svg";
const CAPTION: string = ".docs-diagram .docs-diagram__caption";
// Mermaid's flowchart labels: 16px.
const MERMAID_FONT_SIZE: number = 16;
// The docs' root font size, which rem is relative to.
const ROOT_FONT_SIZE: number = 16;
// The script's smallest scale, written as a fraction: "13 / 16".
const MIN_SCALE_DECLARATION: RegExp =
  /const MIN_DIAGRAM_SCALE = (\d+) \/ (\d+);/;

describe("a docs diagram's size", () => {
  it("shrinks a wide diagram no further than to the caption's size", () => {
    const scale: RegExpMatchArray | null = HEAD.match(MIN_SCALE_DECLARATION);

    expect(scale).not.toBeNull();

    const smallest: number = Number(scale?.[1]) / Number(scale?.[2]);
    const caption: string | undefined = declaredIn(RULES, CAPTION, "font-size");

    expect(caption).toBe("0.8125rem");
    expect(smallest * MERMAID_FONT_SIZE).toBe(
      parseFloat(caption as string) * ROOT_FONT_SIZE,
    );
  });

  it("draws a diagram at its own width, at most the column's, and at least the smallest scale of it", () => {
    expect(HEAD).toContain("svg.style.width = Math.ceil(naturalWidth) + 'px';");
    expect(HEAD).toContain("svg.style.maxWidth = '100%';");
    expect(HEAD).toContain(
      "svg.style.minWidth = Math.ceil(naturalWidth * MIN_DIAGRAM_SCALE) + 'px';",
    );
    // Never the column's full width whatever the diagram's own.
    expect(HEAD).not.toContain("svg.style.width = '100%'");
    expect(HEAD).not.toContain("svg.style.maxWidth = 'none'");
  });

  it("places the drawing in the middle of its box, its height following its width", () => {
    expect(declaredIn(RULES, DIAGRAM_SVG, "display")).toBe("block");
    expect(declaredIn(RULES, DIAGRAM_SVG, "margin-inline")).toBe("auto");
    expect(declaredIn(RULES, DIAGRAM_SVG, "height")).toBe("auto");
  });

  it("scrolls a diagram too wide for the column inside its own box", () => {
    expect(declaredIn(RULES, ".docs-diagram", "overflow-x")).toBe("auto");
    // Left to right on every page, so a scrolled diagram starts at its left edge.
    expect(declaredIn(RULES, ".docs-diagram", "direction")).toBe("ltr");
  });
});
