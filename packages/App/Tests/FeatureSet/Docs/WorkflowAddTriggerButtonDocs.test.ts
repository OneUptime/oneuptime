import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { readPage } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { strayMarkers } from "./DocsTranslationChecks";
import { ComponentType, NodeType } from "Common/Types/Workflow/Component";
import {
  WORKFLOW_ADD_COMPONENT_TITLE,
  WORKFLOW_ADD_TRIGGER_TITLE,
  getWorkflowAddButton,
} from "Common/UI/Components/Workflow/WorkflowAddButton";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Builder toolbar's add button says Add Trigger until the workflow has a
 * trigger, then Add Component, and opens the panel it names.
 *
 * "When there are no triggers on the form, the Add Component button should
 * say 'Add Trigger' so it's easier for people to use and understand." - the
 * maintainer.
 *
 * The authoring page told people the trigger is added from the dashed card
 * only, and that the toolbar's button is Add Component. Every language's
 * copy now names the toolbar's Add Trigger beside the dashed card and says
 * the button reads Add Trigger until there is a trigger. "Add Trigger" was
 * English in the Dashboard of 14 of its 16 languages; it is translated in
 * each now, so the workflow pages name the button and its panel as their
 * Dashboard draws them. This holds every language to that, and the page's
 * words to the Builder's.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const TRANSLATED: Array<string> = LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const AUTHORING: string = "workflows/authoring";

// The pages that send a reader to the Add Trigger panel by its name.
const PAGES_NAMING_THE_PANEL: Array<string> = [
  "workflows/authoring",
  "workflows/index",
  "workflows/triggers",
  "telemetry/ai-agent-circuit-breaker",
];

type SourceFunction = (relativePath: string) => string;

const source: SourceFunction = (relativePath: string): string => {
  return fs.readFileSync(path.join(REPO_DIR, relativePath), "utf8");
};

type BoldFunction = (language: string, english: string) => string;

// A label in bold, as the language's Dashboard draws it.
const bold: BoldFunction = (language: string, english: string): string => {
  return `**${drawnDashboardLabel(language, english)}**`;
};

interface AddBlocksTable {
  // The trigger's row and every other block's: [what, click, panel].
  triggerRow: Array<string>;
  otherRow: Array<string>;
  // The line after the table's blank line, and the one after that.
  sentence: string;
  afterSentence: string;
}

type AddBlocksTableFunction = (language: string) => AddBlocksTable;

/*
 * The page's first table: "Add blocks", what to click for the trigger and
 * for any other block, and the panel each opens.
 */
const addBlocksTable: AddBlocksTableFunction = (
  language: string,
): AddBlocksTable => {
  const lines: Array<string> = readPage(language, AUTHORING).split("\n");
  const separator: number = lines.findIndex((line: string): boolean => {
    return line.startsWith("| ---");
  });

  expect(separator).toBeGreaterThan(0);

  const cells: (line: string) => Array<string> = (
    line: string,
  ): Array<string> => {
    return line
      .split("|")
      .slice(1, -1)
      .map((cell: string): string => {
        return cell.trim();
      });
  };

  // The table ends after its two rows.
  expect({ language, end: lines[separator + 3] }).toEqual({
    language,
    end: "",
  });

  return {
    triggerRow: cells(lines[separator + 1] || ""),
    otherRow: cells(lines[separator + 2] || ""),
    sentence: lines[separator + 4] || "",
    afterSentence: lines[separator + 5] || "",
  };
};

describe("docs for the Builder's add button: Add Trigger until the workflow has a trigger", () => {
  test("every docs language is checked", () => {
    expect(LANGUAGES.length).toBe(17);
    expect(LANGUAGES).toContain("en");
  });

  test("the words the docs quote are the ones the Builder draws, for the canvases they describe", () => {
    expect(WORKFLOW_ADD_TRIGGER_TITLE).toBe("Add Trigger");
    expect(WORKFLOW_ADD_COMPONENT_TITLE).toBe("Add Component");

    // A workflow from scratch: only the dashed card.
    expect(
      getWorkflowAddButton([{ data: { nodeType: NodeType.PlaceholderNode } }]),
    ).toEqual({ title: "Add Trigger", componentsType: ComponentType.Trigger });

    // Once its trigger is on the canvas.
    expect(
      getWorkflowAddButton([
        {
          data: {
            nodeType: NodeType.Node,
            componentType: ComponentType.Trigger,
          },
        },
      ]),
    ).toEqual({
      title: "Add Component",
      componentsType: ComponentType.Component,
    });

    // The Builder draws the button's name from it; the canvas opens its panel.
    const builder: string = source(
      "packages/App/FeatureSet/Dashboard/src/Pages/Workflow/View/Builder.tsx",
    );

    expect(builder).toContain("getWorkflowAddButton(nodes)");
    expect(builder).toContain("title={addButton.title}");
    expect(builder).not.toContain('title="Add Component"');
    expect(
      source("packages/Common/UI/Components/Workflow/Workflow.tsx"),
    ).toContain("getWorkflowAddButton(nodes).componentsType");

    // Each name is the title of the panel it opens.
    expect(
      source("packages/Common/UI/Components/Workflow/ComponentsModal.tsx"),
    ).toContain('title={isTrigger ? "Add Trigger" : "Add Component"}');
  });

  test.each(LANGUAGES)(
    "%s: the Add blocks table names the toolbar's Add Trigger beside the dashed card, and Add Component for every other block",
    (language: string) => {
      const table: AddBlocksTable = addBlocksTable(language);

      expect(table.triggerRow).toHaveLength(3);
      expect(table.otherRow).toHaveLength(3);

      // Clicked: the dashed card, or the toolbar's Add Trigger.
      expect(table.triggerRow[1]).toContain(bold(language, "Add Trigger"));
      // The panel that opens.
      expect(table.triggerRow[2]).toBe(bold(language, "Add Trigger"));

      expect(table.otherRow[1]).toContain(bold(language, "Add Component"));
      expect(table.otherRow[2]).toBe(bold(language, "Add Component"));
    },
  );

  test.each(LANGUAGES)(
    "%s: right after the table, one sentence says the button reads Add Trigger until there is a trigger, then Add Component",
    (language: string) => {
      const table: AddBlocksTable = addBlocksTable(language);
      const addTrigger: string = bold(language, "Add Trigger");
      const addComponent: string = bold(language, "Add Component");

      expect(table.sentence).toContain(addTrigger);
      expect(table.sentence).toContain(addComponent);
      // In that order: first the trigger, then the components.
      expect(table.sentence.indexOf(addTrigger)).toBeLessThan(
        table.sentence.indexOf(addComponent),
      );
      // A paragraph of its own.
      expect(table.afterSentence).toBe("");
    },
  );

  test("en: the table row and the sentence, word for word", () => {
    const table: AddBlocksTable = addBlocksTable("en");

    expect(table.triggerRow).toEqual([
      "The trigger",
      "The dashed placeholder block, or **Add Trigger** in the toolbar",
      "**Add Trigger**",
    ]);
    expect(table.otherRow).toEqual([
      "Any other block",
      "**Add Component**, in the toolbar above the canvas",
      "**Add Component**",
    ]);
    expect(table.sentence).toBe(
      "The toolbar's button says **Add Trigger** until the workflow has a trigger, and **Add Component** once it has one.",
    );
  });

  test.each(TRANSLATED)(
    "%s: the Dashboard translates Add Trigger, and the workflow pages name the button and its panel that way",
    (language: string) => {
      expect({
        language,
        drawn: drawnDashboardLabel(language, "Add Trigger"),
      }).not.toEqual({ language, drawn: "Add Trigger" });

      for (const page of PAGES_NAMING_THE_PANEL) {
        const markdown: string = readPage(language, page);

        expect({
          page,
          drawn: markdown.includes(bold(language, "Add Trigger")),
        }).toEqual({ page, drawn: true });
        expect({ page, english: markdown.includes("**Add Trigger**") }).toEqual(
          { page, english: false },
        );
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: the authoring page draws every bold span it opens",
    async (language: string) => {
      expect(
        await strayMarkers(readPage(language, AUTHORING), language),
      ).toEqual([]);
    },
  );
});
