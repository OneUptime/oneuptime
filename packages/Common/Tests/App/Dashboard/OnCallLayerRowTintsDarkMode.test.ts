import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE LAYERS PAGE'S MARKED ROWS KEEP THEIR WASH IN DARK MODE (issue #7575).
 *
 * The Layers page holds its changes until Save, and marks them: a person
 * added is a green row (New), a person moved an indigo one (Moved), each a
 * faint wash of a -50 colour with some opacity (bg-emerald-50/40). Tailwind
 * paints that wash light in either theme; the dark theme paints it dark only
 * for the classes Theme.css names. The green row's class was not named, and
 * a person added showed on a grey-white band, their email hard to read.
 *
 * The browser check is the Layers page harness's dark-mode screenshot.
 */

const LAYERS_FOLDER: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "OnCallPolicy",
  "OnCallScheduleLayer",
);

const readLayersFile: (name: string) => string = (name: string): string => {
  return fs.readFileSync(path.join(LAYERS_FOLDER, name), "utf8");
};

const LAYER_USER: string = readLayersFile("LayerUser.tsx");

const THEME: string = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
  "utf8",
);

// The dark rule a selector is in: from its html.dark to its closing brace.
const darkRuleWith: (selector: string) => string | null = (
  selector: string,
): string | null => {
  const at: number = THEME.indexOf(selector);

  if (at === -1) {
    return null;
  }

  const start: number = THEME.lastIndexOf("html.dark", at);
  const end: number = THEME.indexOf("}", at);

  if (start === -1 || end === -1) {
    return null;
  }

  return THEME.slice(start, end + 1);
};

// A -50 wash with an opacity, plain or on hover: bg-emerald-50/40, hover:bg-indigo-50/70.
const WASH: RegExp = /(?<![\w:-])(hover:)?bg-([a-z]+)-50\/(\d+)(?![\w/])/g;

const washesIn: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const washes: Set<string> = new Set<string>();

  for (const match of source.matchAll(WASH)) {
    washes.add(match[0]);
  }

  return Array.from(washes).sort();
};

describe("the Layers page's marked rows in dark mode", () => {
  test("a person added is a green row, a person moved an indigo one", () => {
    expect(LAYER_USER).toContain('"bg-emerald-50/40 hover:bg-emerald-50/70"');
    expect(LAYER_USER).toContain('"bg-indigo-50/40 hover:bg-indigo-50/70"');
  });

  test("the green row is a dark green wash, as the indigo one is a dark indigo wash", () => {
    expect(darkRuleWith('[class~="bg-emerald-50/40"]')).toContain(
      "background-color: rgb(6 78 59 / 32%);",
    );
    expect(darkRuleWith('[class~="bg-indigo-50/40"]')).toContain(
      "background-color: rgb(49 46 129 / 35%);",
    );
  });

  test("on hover, each deepens in its own colour", () => {
    const greenHover: string | null = darkRuleWith(
      '[class~="hover:bg-emerald-50/70"]:hover',
    );
    expect(greenHover).toContain(
      "background-color: rgb(6 78 59 / 48%) !important;",
    );

    // Every hover:bg-indigo-50... class, the Moved row's among them.
    const indigoHover: string | null = darkRuleWith(
      '[class*="hover:bg-indigo-50"]',
    );
    expect(indigoHover).toContain(":hover");
    expect(indigoHover).toContain(
      "background-color: rgb(49 46 129 / 48%) !important;",
    );
  });

  test("every wash on the page's cards and bar has a dark one", () => {
    const files: Array<string> = [
      "LayerUser.tsx",
      "LayerCard.tsx",
      "DeletedLayerCard.tsx",
      "Layers.tsx",
      "LayersSaveBar.tsx",
    ];

    const washes: Array<string> = washesIn(
      files.map(readLayersFile).join("\n"),
    );

    expect(washes).toEqual(
      expect.arrayContaining(["bg-emerald-50/40", "hover:bg-emerald-50/70"]),
    );

    const missing: Array<string> = washes.filter((wash: string): boolean => {
      if (darkRuleWith(`[class~="${wash}"]`)) {
        return false;
      }

      // A hover wash may be named by its colour: [class*="hover:bg-indigo-50"].
      const hue: RegExpMatchArray | null = wash.match(
        /^hover:bg-([a-z]+)-50\//,
      );

      return !(hue && darkRuleWith(`[class*="hover:bg-${hue[1]}-50"]`));
    });

    expect(missing).toEqual([]);
  });
});
