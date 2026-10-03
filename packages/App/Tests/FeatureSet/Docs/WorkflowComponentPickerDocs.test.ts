import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Add Component and Add Trigger panels were rebuilt. They open on a
 * short list - Popular, then the other built-in blocks, then OneUptime
 * resources with Browse all resources for the rest - and one click (or
 * Enter on a search result) adds a block. There is no "Add to Workflow"
 * button any more, and no "Utils" or "Conditions" category to look under.
 *
 * Every language's copy of the pages that walk someone through the panels
 * said otherwise: "grouped by category", "select one block and click Add to
 * Workflow", "pick Log (under Utils)", and the incident triggers "under the
 * Incident category in the Add Component panel" - triggers were never in
 * that panel. This reads all seventeen copies and holds them to the panel.
 *
 * The panel's words are not translated, so every language quotes them in
 * English, as the pages already quote Add Trigger.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const PICKER_SOURCE: string = path.resolve(
  __dirname,
  "../../../../Common/UI/Components/Workflow/ComponentsModal.tsx",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const PAGES: Array<string> = [
  "workflows/authoring.md",
  "workflows/components.md",
  "workflows/triggers.md",
  "workflows/variables.md",
  "incidents/settings.md",
];

type ReadPageFunction = (language: string, page: string) => string;

const readPage: ReadPageFunction = (language: string, page: string): string => {
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
};

type CountOfFunction = (text: string, needle: string) => number;

const countOf: CountOfFunction = (text: string, needle: string): number => {
  return text.split(needle).length - 1;
};

type LineWithFunction = (text: string, needles: Array<string>) => string;

// The one line of a page that holds every needle.
const lineWith: LineWithFunction = (
  text: string,
  needles: Array<string>,
): string => {
  const lines: Array<string> = text.split("\n").filter((line: string) => {
    return needles.every((needle: string): boolean => {
      return line.includes(needle);
    });
  });

  expect({ needles, lines: lines.length }).toEqual({ needles, lines: 1 });

  return lines[0]!;
};

describe("docs for the Add Component and Add Trigger panels", () => {
  test("every docs language is checked", () => {
    expect(LANGUAGES.length).toBe(17);
    expect(LANGUAGES).toContain("en");
  });

  test("the words the docs quote are the ones the panel draws", () => {
    const source: string = fs.readFileSync(PICKER_SOURCE, "utf8");

    expect(source).toContain('title="Popular"');
    expect(source).toContain('title="OneUptime resources"');
    // Drawn in the reader's language, from the English the docs quote.
    expect(source).toContain(
      'translator.translateText("Browse all resources")',
    );
    expect(source).not.toContain('submitButtonText="Add to Workflow"');
  });

  test.each(LANGUAGES)(
    "%s: no page sends a reader to an Add to Workflow button, or to a Utils category",
    (language: string) => {
      for (const page of PAGES) {
        const text: string = readPage(language, page);

        expect({ page, mentions: text.includes("Add to Workflow") }).toEqual({
          page,
          mentions: false,
        });
        expect({ page, utils: text.includes("**Utils**") }).toEqual({
          page,
          utils: false,
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: the authoring page says what the panels open on, and how to search and add",
    (language: string) => {
      const page: string = readPage(language, "workflows/authoring.md");

      expect(page).toContain("**OneUptime resources**");
      expect(page).toContain("**Browse all resources**");
      expect(page).toContain("`create incident`");
      expect(page).toContain("`/`");
      // What the panels open on, and where Log is in the first workflow.
      expect(countOf(page, "**Popular**")).toBe(2);
    },
  );

  test.each(LANGUAGES)(
    "%s: If / Else is under Popular, and the database components are found by resource",
    (language: string) => {
      const page: string = readPage(language, "workflows/components.md");

      lineWith(page, ["**If / Else**", "**Popular**"]);
      lineWith(page, ["**OneUptime resources**", "**Browse all resources**"]);
    },
  );

  test.each(LANGUAGES)(
    "%s: the triggers page says where the record triggers are",
    (language: string) => {
      const line: string = lineWith(
        readPage(language, "workflows/triggers.md"),
        ["**Add Trigger**", "**Browse all resources**"],
      );

      expect(line).toContain("OneUptime resources");
      expect(line).toContain("`incident created`");
    },
  );

  test.each(LANGUAGES)(
    "%s: the incident triggers are in the Add Trigger panel, under the Incident resource",
    (language: string) => {
      const line: string = lineWith(
        readPage(language, "incidents/settings.md"),
        ["**On Create Incident**", "/dashboard/{projectId}/workflows"],
      );

      expect(line).toContain("**Add Trigger**");
      expect(line).toContain("OneUptime resources");
      expect(line).toContain("Incident**");
      expect(line).toContain("**Popular**");
      expect(line).not.toContain("**Add Component**");
    },
  );
});
