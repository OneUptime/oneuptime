import {
  TABLE_THRESHOLD_CELL_CLASS_NAMES,
  TABLE_THRESHOLD_ICONS,
} from "../../../FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTableThresholdCopy";
import {
  TableThresholdDirection,
  TableThresholdLevel,
  TableThresholdStyle,
} from "Common/Types/Dashboard/DashboardComponents/DashboardTableComponent";
import {
  TABLE_THRESHOLD_PERCENT_PRESET,
  getTableColumnDisplay,
  getTableThresholdLevel,
  getTableThresholdPreset,
} from "Common/Utils/Dashboard/TableThresholds";
import IconProp from "Common/Types/Icon/IconProp";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { drawnActionLabel } from "./DocsDashboardLabels";
import { toLatinDigits } from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The widgets guide's paragraphs on a metric table's threshold colors (issue
 * #5231), held to the product: the labels it names in bold are the words the
 * column card and the Threshold colors choice draw, the 80 and 90 a percent
 * column starts at are the preset's, amber with a triangle and red and bold
 * with a circle are the cells' classes and icons, and a fraction shown as a
 * percent is what the display rule does. Markdown is not compiled, so a
 * guide that drifts from any of them fails here. Every language's copy is
 * held to the English one, line for line, by DashboardsDocsTranslations;
 * this also checks each one names these labels as its Dashboard draws them.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const CANVAS_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas",
);

function readPage(language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, "dashboards/widgets.md"),
    "utf8",
  );
}

function readCanvas(fileName: string): string {
  return fs.readFileSync(path.join(CANVAS_DIR, fileName), "utf8");
}

// The text under a heading, up to the next heading of its level or above.
function sectionOf(page: string, heading: string): string {
  const level: number = heading.indexOf(" ");
  const start: number = page.indexOf(`\n${heading}\n`);

  expect([heading, start >= 0]).toEqual([heading, true]);

  const rest: string = page.slice(start + heading.length + 2);
  const ends: Array<number> = [];

  for (let depth: number = 1; depth <= level; depth++) {
    const end: number = rest.indexOf(`\n${"#".repeat(depth)} `);

    if (end >= 0) {
      ends.push(end);
    }
  }

  return ends.length > 0 ? rest.slice(0, Math.min(...ends)) : rest;
}

function bold(label: string): string {
  return `**${label}**`;
}

const table: string = sectionOf(readPage("en"), "### Table");

// The column card's words for its thresholds, and the table's choice.
const CARD_LABELS: Array<string> = [
  "Color by thresholds",
  "Warning at",
  "Critical at",
  "Direction",
  "Lower is worse",
];
const STYLE_LABELS: Array<string> = ["Threshold colors", "Colored background"];

describe("the Table section's threshold colors, against the product", () => {
  it("names in bold the words the column card draws, as its source writes them", () => {
    const card: string = readCanvas("TableColumnThresholdsEditor.tsx");

    for (const label of CARD_LABELS) {
      expect({ label, inGuide: table.includes(bold(label)) }).toEqual({
        label,
        inGuide: true,
      });
      expect({ label, inCard: card.includes(`"${label}"`) }).toEqual({
        label,
        inCard: true,
      });
    }

    // Lower is worse is one of the two directions the card offers.
    expect(card).toContain(
      `value: TableThresholdDirection.LowerIsWorse, label: "Lower is worse"`,
    );
  });

  it("names the Threshold colors choice and its Colored background as the choice draws them", () => {
    const picker: string = readCanvas("TableThresholdStylePicker.tsx");

    for (const label of STYLE_LABELS) {
      expect({ label, inGuide: table.includes(bold(label)) }).toEqual({
        label,
        inGuide: true,
      });
      expect({ label, inPicker: picker.includes(`"${label}"`) }).toEqual({
        label,
        inPicker: true,
      });
    }

    // The choice the guide does not name is the default, Colored text.
    expect(picker).toContain(
      `{ value: TableThresholdStyle.Text, title: "Colored text" }`,
    );
    expect(table).toContain(
      `${bold("Colored background")} fills the whole cell instead of coloring the number`,
    );
  });

  it("says a percent column starts at the preset's 80 and 90, higher is worse", () => {
    expect(TABLE_THRESHOLD_PERCENT_PRESET).toEqual({
      warning: 80,
      critical: 90,
    });
    expect(getTableThresholdPreset({ unit: "%", factor: 1 })).toEqual({
      warning: 80,
      critical: 90,
      direction: TableThresholdDirection.HigherIsWorse,
    });
    expect(table).toContain("A percent column starts at 80 and 90.");
  });

  it("describes each level as the cells draw it: amber with a triangle, red and bold with a circle", () => {
    const text: Readonly<Record<TableThresholdLevel, string>> =
      TABLE_THRESHOLD_CELL_CLASS_NAMES[TableThresholdStyle.Text];

    expect(text[TableThresholdLevel.Warning]).toContain("text-amber-");
    expect(text[TableThresholdLevel.Warning]).not.toContain("font-bold");
    expect(text[TableThresholdLevel.Critical]).toContain("text-red-");
    expect(text[TableThresholdLevel.Critical]).toContain("font-bold");
    // The exclamation triangle, and the exclamation circle.
    expect(TABLE_THRESHOLD_ICONS[TableThresholdLevel.Warning]).toBe(
      IconProp.Alert,
    );
    expect(TABLE_THRESHOLD_ICONS[TableThresholdLevel.Critical]).toBe(
      IconProp.ExclaimationCircle,
    );

    expect(table).toContain(
      `a value that reaches ${bold("Warning at")} turns amber, with a triangle, and one that reaches ${bold("Critical at")} turns red and bold, with a circle`,
    );
  });

  it("says a value reaches a threshold at it, as the rule compares", () => {
    const thresholds: { warning: number; critical: number } = {
      warning: 80,
      critical: 90,
    };

    expect(getTableThresholdLevel({ value: 80, thresholds })).toBe(
      TableThresholdLevel.Warning,
    );
    expect(getTableThresholdLevel({ value: 90, thresholds })).toBe(
      TableThresholdLevel.Critical,
    );
    expect(table).toContain("a value that reaches");
  });

  it("says Colored background fills the cell, which only that style's classes do", () => {
    for (const level of [
      TableThresholdLevel.Warning,
      TableThresholdLevel.Critical,
    ]) {
      expect(
        TABLE_THRESHOLD_CELL_CLASS_NAMES[TableThresholdStyle.Background][level],
      ).toContain("bg-");
      expect(
        TABLE_THRESHOLD_CELL_CLASS_NAMES[TableThresholdStyle.Text][level],
      ).not.toContain("bg-");
    }
  });

  it("says a usage metric sent as a fraction of 1 shows and compares as a percent, as its example does", () => {
    expect(
      getTableColumnDisplay({
        metricUnit: "1",
        metricName: "system.cpu.utilization",
      }),
    ).toEqual({ unit: "%", factor: 100 });
    expect(table).toContain(
      "a usage metric sent as a fraction of 1, such as `system.cpu.utilization`, shows and compares as a percent",
    );
  });

  it("points lower-is-worse columns at an example the direction fits", () => {
    expect(table).toContain(
      `For a column where low values are the problem, such as free disk space, pick ${bold("Lower is worse")} under ${bold("Direction")}.`,
    );
  });
});

/*
 * The Table section of a translation: the lines of the English one's, as
 * DashboardsDocsTranslations holds every translation line for line.
 */
function tableSectionIn(language: string): string {
  const english: Array<string> = readPage("en").split("\n");
  const start: number = english.indexOf("### Table");
  const end: number = english.findIndex((line: string, index: number) => {
    return index > start && line.startsWith("#");
  });

  expect([start > 0, end > start]).toEqual([true, true]);

  return readPage(language).split("\n").slice(start, end).join("\n");
}

describe("the Table section's threshold colors in every language", () => {
  const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
    (language: string): boolean => {
      return language !== "en";
    },
  );

  it("reads the English section where the guide has it", () => {
    const section: string = tableSectionIn("en");

    expect(section.startsWith("### Table\n")).toBe(true);
    expect(section.trim()).toBe(`### Table\n${table}`.trim());
    expect(section).toContain(bold("Color by thresholds"));
  });

  it.each(LANGUAGES)(
    "%s names each label as its Dashboard draws it",
    (language: string) => {
      const section: string = tableSectionIn(language);

      const missing: Array<string> = [...CARD_LABELS, ...STYLE_LABELS]
        .map((label: string): string => {
          return bold(drawnActionLabel(language, label));
        })
        .filter((drawn: string): boolean => {
          return !section.includes(drawn);
        });

      expect(missing).toEqual([]);
    },
  );

  it.each(LANGUAGES)(
    "%s keeps the preset's 80 and 90 and the metric's name",
    (language: string) => {
      const section: string = toLatinDigits(tableSectionIn(language));

      expect(section).toContain("80");
      expect(section).toContain("90");
      expect(section).toContain("`system.cpu.utilization`");
    },
  );

  it("Persian writes the preset in its own digits, as its other numbers", () => {
    const section: string = tableSectionIn("fa");

    expect(section).toContain("۸۰");
    expect(section).toContain("۹۰");
  });
});
