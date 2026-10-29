import { beforeAll, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import { JSDOM } from "jsdom";
import path from "path";
import postcss, { AtRule, Declaration, Root, Rule } from "postcss";

/*
 * The face every page draws its text in until Geist has loaded.
 *
 * Geist comes from Google Fonts with display=swap: the page first paints in
 * the next face of the font stack, then redraws in Geist. If that face is
 * wider or narrower than Geist, a line breaks at another word, a paragraph
 * gains or loses a line, and everything under it jumps - the layout shift a
 * search engine counts against the page. So the stack's second face is
 * "Geist Fallback": Arial (Liberation Sans, its metric twin, on Linux)
 * scaled to Geist's width weight by weight, on Geist's own line.
 *
 * Measured as the integrations index, the 43 guides and six product pages
 * load (Chromium, with the fractional glyph widths macOS and Windows draw):
 * without a fallback, up to 0.30 of shift and 31 page widths over 0.1; with
 * one regular and one bold face scaled by English letter frequencies, up to
 * 0.20 and 3 over; with these four faces, at most 0.075 and none over.
 */

const HEAD_TEMPLATE: string = path.join(
  __dirname,
  "..",
  "Views",
  "head-basic.ejs",
);

// Geist's vertical metrics, as a share of its size (its hhea table: 1005 and -295 per 1000).
const GEIST_ASCENT: number = 1.005;
const GEIST_DESCENT: number = 0.295;

interface FallbackFace {
  minWeight: number;
  maxWeight: number;
  sources: string;
  sizeAdjust: number;
  ascent: number;
  descent: number;
  lineGap: number;
}

function percent(value: string): number {
  return Number(value.trim().replace("%", "")) / 100;
}

function declarationOf(rule: AtRule | Rule, property: string): string {
  let value: string = "";

  rule.walkDecls(property, (declaration: Declaration) => {
    value = declaration.value;
  });

  return value;
}

let head: Document;
let styles: Root;

beforeAll(async () => {
  head = new JSDOM(
    (await ejs.renderFile(HEAD_TEMPLATE, {
      enableGoogleTagManager: false,
      homeUrl: "https://oneuptime.com",
    })) as string,
  ).window.document;
  styles = postcss.parse(
    Array.from(head.querySelectorAll("style"))
      .map((style: Element): string => {
        return style.textContent || "";
      })
      .join("\n"),
  );
});

function fallbackFaces(): Array<FallbackFace> {
  const faces: Array<FallbackFace> = [];

  styles.walkAtRules("font-face", (rule: AtRule) => {
    if (declarationOf(rule, "font-family") !== '"Geist Fallback"') {
      return;
    }

    const [minWeight, maxWeight] = declarationOf(rule, "font-weight")
      .split(" ")
      .map((part: string): number => {
        return Number(part);
      });

    faces.push({
      minWeight: minWeight || 0,
      maxWeight: maxWeight || 0,
      sources: declarationOf(rule, "src"),
      sizeAdjust: percent(declarationOf(rule, "size-adjust")),
      ascent: percent(declarationOf(rule, "ascent-override")),
      descent: percent(declarationOf(rule, "descent-override")),
      lineGap: percent(declarationOf(rule, "line-gap-override")),
    });
  });

  return faces;
}

describe("the face a page draws in until Geist has loaded", () => {
  test("comes right after Geist in the font every element is drawn in", () => {
    let stack: string = "";

    styles.walkRules("*", (rule: Rule) => {
      stack = declarationOf(rule, "font-family");
    });

    expect(stack.startsWith('Geist, "Geist Fallback", ')).toBe(true);
  });

  test("is there because Geist swaps in: the stylesheet asks for display=swap", () => {
    const stylesheet: Element | null = head.querySelector(
      'link[rel="stylesheet"][href^="https://fonts.googleapis.com/"]',
    );
    const address: URL = new URL(stylesheet?.getAttribute("href") || "");

    expect(address.searchParams.get("family")).toContain("Geist");
    expect(address.searchParams.get("display")).toBe("swap");
  });

  test("has a face for every weight, each weight in exactly one", () => {
    const faces: Array<FallbackFace> = fallbackFaces();

    expect(
      faces.map((face: FallbackFace): [number, number] => {
        return [face.minWeight, face.maxWeight];
      }),
    ).toEqual([
      [100, 449],
      [450, 549],
      [550, 649],
      [650, 900],
    ]);

    for (const [index, face] of faces.entries()) {
      if (index > 0) {
        expect(face.minWeight).toBe(faces[index - 1]!.maxWeight + 1);
      }
    }
  });

  test("draws regular and medium text in Arial, semibold and bold in Arial Bold, on every system", () => {
    for (const face of fallbackFaces()) {
      const bold: boolean = face.minWeight >= 550;
      const names: Array<string> = bold
        ? [
            'local("Arial Bold")',
            'local("Arial-BoldMT")',
            'local("Liberation Sans Bold")',
            'local("LiberationSans-Bold")',
          ]
        : [
            'local("Arial")',
            'local("ArialMT")',
            'local("Liberation Sans")',
            'local("LiberationSans")',
          ];

      expect([face.minWeight, face.sources]).toEqual([
        face.minWeight,
        names.join(", "),
      ]);
    }
  });

  test("is as wide as Geist at each weight, as measured on the site's pages", () => {
    /*
     * Geist's text over Arial's, summed over every line of text on the
     * integrations index, the 43 guides and the product pages that list
     * them, laid out in each face at its own size, weight and spacing,
     * kerned: Geist Medium is the widest against Arial, Geist SemiBold
     * almost exactly Arial Bold's width. A face scaled for one weight and
     * used for another (one regular and one bold face did) moves the lines
     * of the other - up to 4% at semibold, where every heading is - and
     * English letter frequencies alone (next/font's estimate) put regular
     * text 3% too wide: guide leads broke a line later than in Geist.
     */
    expect(
      fallbackFaces().map((face: FallbackFace): number => {
        return Math.round(face.sizeAdjust * 10000) / 100;
      }),
    ).toEqual([102.23, 105.09, 100.32, 102.38]);
  });

  test("keeps Geist's line: its ascent and descent, whatever the face's scale", () => {
    for (const face of fallbackFaces()) {
      /*
       * The overrides are shares of the face's size before size-adjust
       * scales it, so they are Geist's metrics over that scale.
       */
      expect([
        face.minWeight,
        Math.abs(face.ascent * face.sizeAdjust - GEIST_ASCENT) < 0.0005,
        Math.abs(face.descent * face.sizeAdjust - GEIST_DESCENT) < 0.0005,
        face.lineGap,
      ]).toEqual([face.minWeight, true, true, 0]);
    }
  });
});
