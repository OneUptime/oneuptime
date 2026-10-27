import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A RUNBOOK STEP'S CARD KEEPS ITS COLOURED EDGE IN DARK MODE.
 *
 * Each step on a runbook's Steps page is a card with a gray-200 border and
 * a 4px left edge in its type's colour (indigo for Manual, amber for
 * JavaScript, ...). In dark mode the theme repaints a gray-200 border on all
 * four sides (Theme.css, `html.dark .border-gray-200 { border-color }`),
 * whose selector outweighs the edge's own class - so every step's edge was
 * grey. The edge's colour is important now, and wins in both themes.
 *
 * The browser check is the offline RunbookSteps suite's dark-mode test,
 * which reads each card's computed left border colour.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const STEPS_PAGE: string = fs.readFileSync(
  path.join(DASHBOARD_SRC, "Pages", "Runbook", "View", "Steps.tsx"),
  "utf8",
);

const THEME: string = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
  "utf8",
);

// Every `borderL: "..."` of the step types' table.
const BORDER_LEFT_VALUE: RegExp = /borderL: "([^"]*)"/g;

const borderLeftValues: () => Array<string> = (): Array<string> => {
  const values: Array<string> = [];

  for (const match of STEPS_PAGE.matchAll(BORDER_LEFT_VALUE)) {
    values.push(match[1] as string);
  }

  return values;
};

describe("a step card's coloured edge", () => {
  test("every step type has one", () => {
    // Manual, JavaScript, HTTP, Bash, SSH, kubectl, AI, and the two OneUptime AI composes.
    expect(borderLeftValues()).toHaveLength(9);
  });

  test("each is important, so the dark theme's gray-200 repaint cannot turn it grey", () => {
    for (const value of borderLeftValues()) {
      expect({ value, isImportant: value.startsWith("!border-l-") }).toEqual({
        value,
        isImportant: true,
      });
    }
  });

  test("each is a colour of its own, never a grey", () => {
    const hues: Array<string> = borderLeftValues().map(
      (value: string): string => {
        return value.replace("!border-l-", "").replace("-500", "");
      },
    );

    expect(new Set(hues).size).toBe(hues.length);

    for (const hue of hues) {
      expect(["gray", "zinc", "neutral", "stone"]).not.toContain(hue);
    }
  });

  test("the card draws it over its gray-200 border, 4px wide", () => {
    const flat: string = STEPS_PAGE.replace(/\s+/g, " ");

    expect(flat).toContain(
      "rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden border-l-4 ${meta.borderL}",
    );
  });

  test("the dark theme repaints gray-200 borders without !important, so an important edge wins", () => {
    const remap: number = THEME.indexOf(
      "html.dark :is(\n    .border-gray-200,",
    );

    expect(remap).toBeGreaterThan(-1);

    const rule: string = THEME.slice(remap, THEME.indexOf("}", remap));

    expect(rule).toContain("border-color: var(--ou-border-default);");
    expect(rule).not.toContain("!important");
  });
});
