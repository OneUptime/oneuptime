import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Adding a step to a workflow no longer opens its settings. The step lands
 * selected and in view, says "Click to set up" while its required settings
 * are empty, and opens when it is clicked (or focused and given Enter).
 *
 * The authoring page told people the opposite in places: that new blocks all
 * land in one spot and must be dragged clear, that every problem is a red
 * badge, and it quoted a placeholder text the canvas stopped drawing. This
 * reads every language's copy of the page and holds it to the builder.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const WORKFLOW_UI_DIR: string = path.resolve(
  __dirname,
  "../../../../Common/UI/Components/Workflow",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const SETUP_TEXT: string = "Click to set up";
const PLACEHOLDER_TEXT: string = "Choose what starts this workflow";

type ReadFunction = (name: string) => string;

const readAuthoringPage: ReadFunction = (language: string): string => {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, "workflows/authoring.md"),
    "utf8",
  );
};

const readBuilderSource: ReadFunction = (file: string): string => {
  return fs.readFileSync(path.join(WORKFLOW_UI_DIR, file), "utf8");
};

type CountFunction = (text: string, needle: string) => number;

const countOf: CountFunction = (text: string, needle: string): number => {
  return text.split(needle).length - 1;
};

describe("docs for adding a step to a workflow", () => {
  test("every docs language is checked", () => {
    expect(LANGUAGES.length).toBe(17);
    expect(LANGUAGES).toContain("en");
  });

  test("the words the docs quote are the ones the canvas draws", () => {
    expect(readBuilderSource("Component.tsx")).toContain(
      `WORKFLOW_NODE_SETUP_TEXT: string = "${SETUP_TEXT}"`,
    );
    expect(readBuilderSource("Workflow.tsx")).toContain(
      `description: "${PLACEHOLDER_TEXT}"`,
    );
  });

  test.each(LANGUAGES)(
    "%s: the dashed placeholder is quoted as the canvas draws it",
    (language: string) => {
      const page: string = readAuthoringPage(language);

      expect(page).toContain(`**${PLACEHOLDER_TEXT}**`);
      expect(page).not.toContain("Please click here to add trigger");
    },
  );

  test.each(LANGUAGES)(
    "%s: the setup prompt is named where blocks are added, in the checks, and in the first workflow",
    (language: string) => {
      expect(countOf(readAuthoringPage(language), `**${SETUP_TEXT}**`)).toBe(3);
    },
  );

  test.each(LANGUAGES)(
    "%s: a block's settings can be opened from the keyboard",
    (language: string) => {
      const page: string = readAuthoringPage(language);

      expect(page).toContain("**Tab**");
      expect(page).toMatch(/\*\*(Enter|Entrée|Invio)\*\*/);
    },
  );

  test("en: what the page says about a new block matches the builder", () => {
    const page: string = readAuthoringPage("en");

    expect(page).toContain("Its settings don't open by themselves");
    expect(page).toContain("A new block lands below the lowest block");
    expect(page).toContain("red for an error, amber for a warning");
    expect(page).toContain("The new block lands below the trigger.");

    expect(page).not.toContain("always land in the same spot");
    expect(page).not.toContain("Drag the new block clear of the trigger");
    expect(page).not.toContain("Blocks with a problem also carry a red badge");
  });
});
