import {
  WORKFLOW_ADD_COMPONENT_TITLE,
  WORKFLOW_ADD_TRIGGER_TITLE,
  WorkflowAddButton,
  WorkflowAddButtonNode,
  getWorkflowAddButton,
  isWorkflowTriggerNode,
  workflowHasTrigger,
} from "../../../../UI/Components/Workflow/WorkflowAddButton";
import { getPlaceholderTriggerNode } from "../../../../UI/Components/Workflow/Workflow";
import {
  ComponentType,
  NodeType,
} from "../../../../Types/Workflow/Component";
import { JSONObject } from "../../../../Types/JSON";
import {
  WorkflowTemplate,
  buildGraphForTemplate,
  getWorkflowTemplates,
} from "../../../../Types/Workflow/Templates";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the Builder toolbar's add button says, and which panel it opens.
 *
 * "When there are no triggers on the form, the Add Component button should
 * say 'Add Trigger' so it's easier for people to use and understand." - the
 * maintainer.
 *
 * Until the workflow has a trigger the button says Add Trigger and opens the
 * Add Trigger panel - the dashed "Choose what starts this workflow" card's
 * panel. Once a trigger is on the canvas it says Add Component and opens the
 * Add Component panel. The Builder page and the canvas both ask this module,
 * so these cases are what both of them do; Workflow.test.tsx and the
 * Builder's own tests hold them to it.
 */

const MODULE_SOURCE: string = fs.readFileSync(
  path.join(__dirname, "../../../../UI/Components/Workflow/WorkflowAddButton.ts"),
  "utf8",
);

// An import's path: `from "../../Utils/TranslateTemplate";`.
const IMPORT_PATH: RegExp = /from "([^"]+)";/g;

type NodeFunction = (
  componentType: ComponentType,
  id: string,
) => WorkflowAddButtonNode;

// A step as the canvas holds it, and as a saved graph stores it.
const step: NodeFunction = (
  componentType: ComponentType,
  id: string,
): WorkflowAddButtonNode => {
  const node: JSONObject = {
    id: `canvas-${id}`,
    type: "node",
    position: { x: 0, y: 0 },
    data: {
      id: id,
      internalId: `runner-${id}`,
      nodeType: NodeType.Node,
      componentType: componentType,
      metadataId: id.slice(0, id.lastIndexOf("-")),
      error: "",
      arguments: {},
      returnValues: {},
    },
  };

  return node as unknown as WorkflowAddButtonNode;
};

const TRIGGER: WorkflowAddButtonNode = step(ComponentType.Trigger, "manual-1");
const ACTION: WorkflowAddButtonNode = step(ComponentType.Component, "log-1");
const ANOTHER_ACTION: WorkflowAddButtonNode = step(
  ComponentType.Component,
  "if-else-1",
);

// The dashed "Choose what starts this workflow" card, as the canvas draws it.
const PLACEHOLDER: WorkflowAddButtonNode = getPlaceholderTriggerNode();

const ADD_TRIGGER: WorkflowAddButton = {
  title: "Add Trigger",
  componentsType: ComponentType.Trigger,
};

const ADD_COMPONENT: WorkflowAddButton = {
  title: "Add Component",
  componentsType: ComponentType.Component,
};

describe("the toolbar's add button: the words", () => {
  test("are the titles of the panels it opens", () => {
    expect(WORKFLOW_ADD_TRIGGER_TITLE).toBe("Add Trigger");
    expect(WORKFLOW_ADD_COMPONENT_TITLE).toBe("Add Component");

    /*
     * The panel draws the same English: ComponentsModal's SideOver title,
     * which the Dashboard translates the same way as the button.
     */
    const panelSource: string = fs.readFileSync(
      path.join(__dirname, "../../../../UI/Components/Workflow/ComponentsModal.tsx"),
      "utf8",
    );

    expect(panelSource).toContain(
      `title={isTrigger ? "${WORKFLOW_ADD_TRIGGER_TITLE}" : "${WORKFLOW_ADD_COMPONENT_TITLE}"}`,
    );
  });

  test("are translation keys, so the extractor and every locale have them", () => {
    expect(MODULE_SOURCE).toContain('translationKey("Add Trigger")');
    expect(MODULE_SOURCE).toContain('translationKey("Add Component")');
  });

  test("the module stays React-free, for the App's docs tests and the offline fixture", () => {
    const imported: Array<string> = Array.from(
      MODULE_SOURCE.matchAll(IMPORT_PATH),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(imported.length).toBeGreaterThan(0);

    for (const importPath of imported) {
      const resolved: string = path.join(
        __dirname,
        "../../../../UI/Components/Workflow",
        importPath,
      );

      // A module of the repository's own, written in .ts: no React, no JSX.
      expect({
        importPath,
        isOwnTsModule: importPath.startsWith(".") && fs.existsSync(`${resolved}.ts`),
      }).toEqual({ importPath, isOwnTsModule: true });
      expect(fs.readFileSync(`${resolved}.ts`, "utf8")).not.toContain(
        'from "react"',
      );
    }
  });
});

describe("the toolbar's add button on a workflow with no trigger: Add Trigger", () => {
  test("a workflow from scratch: only the dashed card", () => {
    expect(getWorkflowAddButton([PLACEHOLDER])).toEqual(ADD_TRIGGER);
  });

  test("a canvas with nothing on it at all", () => {
    expect(getWorkflowAddButton([])).toEqual(ADD_TRIGGER);
    expect(getWorkflowAddButton(null)).toEqual(ADD_TRIGGER);
    expect(getWorkflowAddButton(undefined)).toEqual(ADD_TRIGGER);
  });

  test("steps whose trigger was deleted: the dashed card is back beside them", () => {
    expect(
      getWorkflowAddButton([PLACEHOLDER, ACTION, ANOTHER_ACTION]),
    ).toEqual(ADD_TRIGGER);
    expect(getWorkflowAddButton([ACTION, PLACEHOLDER])).toEqual(ADD_TRIGGER);
  });

  test("steps and no dashed card: still no trigger", () => {
    expect(getWorkflowAddButton([ACTION, ANOTHER_ACTION])).toEqual(
      ADD_TRIGGER,
    );
  });

  test("the dashed card is no trigger, whatever it says it stands in for", () => {
    // It names itself a trigger in its metadata: it is where one will go.
    expect(
      (PLACEHOLDER.data as unknown as { metadata: JSONObject }).metadata[
        "componentType"
      ],
    ).toBe(ComponentType.Trigger);
    expect(isWorkflowTriggerNode(PLACEHOLDER)).toBe(false);

    // A stored card that also names itself a trigger on the step.
    expect(
      isWorkflowTriggerNode({
        data: {
          nodeType: NodeType.PlaceholderNode,
          componentType: ComponentType.Trigger,
        },
      }),
    ).toBe(false);
  });

  test("nodes without data are skipped, not read", () => {
    expect(
      getWorkflowAddButton([null, undefined, {}, { data: null }, ACTION]),
    ).toEqual(ADD_TRIGGER);
    expect(isWorkflowTriggerNode(null)).toBe(false);
    expect(isWorkflowTriggerNode(undefined)).toBe(false);
    expect(isWorkflowTriggerNode({})).toBe(false);
  });

  test("a step that names a trigger only in its metadata is read as the canvas reads it: no trigger", () => {
    /*
     * The Builder's load and deleteNode decide whether to draw the dashed
     * card from the step's own componentType. A step without one gets the
     * card beside it, and the button says what the card says.
     */
    const metadataOnly: JSONObject = {
      id: "canvas-manual-1",
      data: {
        id: "manual-1",
        nodeType: NodeType.Node,
        metadata: { componentType: ComponentType.Trigger },
      },
    };

    expect(
      getWorkflowAddButton([metadataOnly as unknown as WorkflowAddButtonNode]),
    ).toEqual(ADD_TRIGGER);
  });
});

describe("the toolbar's add button once the workflow has a trigger: Add Component", () => {
  test("the trigger alone", () => {
    expect(getWorkflowAddButton([TRIGGER])).toEqual(ADD_COMPONENT);
    expect(isWorkflowTriggerNode(TRIGGER)).toBe(true);
  });

  test("the trigger and its steps, in any order", () => {
    expect(getWorkflowAddButton([TRIGGER, ACTION, ANOTHER_ACTION])).toEqual(
      ADD_COMPONENT,
    );
    expect(getWorkflowAddButton([ACTION, ANOTHER_ACTION, TRIGGER])).toEqual(
      ADD_COMPONENT,
    );
  });

  test("a trigger beside a dashed card left over: the trigger counts", () => {
    expect(getWorkflowAddButton([PLACEHOLDER, TRIGGER])).toEqual(
      ADD_COMPONENT,
    );
  });

  test("a graph read back from JSON, its types as plain strings", () => {
    const stored: { nodes: Array<WorkflowAddButtonNode> } = JSON.parse(
      JSON.stringify({ nodes: [ACTION, TRIGGER] }),
    ) as { nodes: Array<WorkflowAddButtonNode> };

    expect(getWorkflowAddButton(stored.nodes)).toEqual(ADD_COMPONENT);
    expect(
      isWorkflowTriggerNode({
        data: { nodeType: "Node", componentType: "Trigger" },
      }),
    ).toBe(true);
  });

  test("workflowHasTrigger says the same", () => {
    expect(workflowHasTrigger([TRIGGER])).toBe(true);
    expect(workflowHasTrigger([ACTION, TRIGGER])).toBe(true);
    expect(workflowHasTrigger([PLACEHOLDER, ACTION])).toBe(false);
    expect(workflowHasTrigger([])).toBe(false);
    expect(workflowHasTrigger(null)).toBe(false);
  });
});

describe("the toolbar's add button on every workflow template", () => {
  /*
   * A workflow made from a template opens with its trigger in place, so the
   * button says Add Component from the start, as it always did.
   */
  const templates: Array<WorkflowTemplate> = getWorkflowTemplates();

  test("there are templates to read", () => {
    expect(templates.length).toBeGreaterThan(20);
  });

  test.each(
    templates.map((template: WorkflowTemplate): [string] => {
      return [template.id];
    }),
  )("%s opens with Add Component", (templateId: string) => {
    let counter: number = 0;
    const graph: JSONObject | null = buildGraphForTemplate(
      templateId,
      (): string => {
        counter++;
        return `0198c8ec-2a1d-7f0c-9e75-${String(counter).padStart(12, "0")}`;
      },
    );

    expect(graph).not.toBeNull();
    expect(
      getWorkflowAddButton(
        (graph as JSONObject)["nodes"] as unknown as Array<WorkflowAddButtonNode>,
      ),
    ).toEqual(ADD_COMPONENT);
  });
});

describe("the toolbar's add button: what it says is what it opens", () => {
  /*
   * Canvases drawn at random from the dashed card, steps and triggers: the
   * button says Add Trigger exactly when none of them is a trigger, and
   * always opens the panel of the name it shows.
   */
  test("on 2,000 canvases", () => {
    const random: SeededRandom = seededRandom(4712);
    const kinds: Array<() => WorkflowAddButtonNode> = [
      (): WorkflowAddButtonNode => {
        return getPlaceholderTriggerNode();
      },
      (): WorkflowAddButtonNode => {
        return step(ComponentType.Component, `log-${random(9) + 1}`);
      },
      (): WorkflowAddButtonNode => {
        return step(ComponentType.Trigger, `webhook-${random(9) + 1}`);
      },
    ];
    let withTrigger: number = 0;
    let withoutTrigger: number = 0;

    for (let canvas: number = 0; canvas < 2000; canvas++) {
      const nodes: Array<WorkflowAddButtonNode> = [];
      const size: number = random(6);

      for (let index: number = 0; index < size; index++) {
        nodes.push(kinds[random(kinds.length)]!());
      }

      const hasTrigger: boolean = nodes.some(
        (node: WorkflowAddButtonNode): boolean => {
          return (
            node.data?.nodeType === NodeType.Node &&
            node.data?.componentType === ComponentType.Trigger
          );
        },
      );
      const button: WorkflowAddButton = getWorkflowAddButton(nodes);

      expect({ canvas, nodes: nodes.length, button }).toEqual({
        canvas,
        nodes: nodes.length,
        button: hasTrigger ? ADD_COMPONENT : ADD_TRIGGER,
      });

      if (hasTrigger) {
        withTrigger++;
      } else {
        withoutTrigger++;
      }
    }

    // Both kinds of canvas were drawn, plenty of each.
    expect(withTrigger).toBeGreaterThan(500);
    expect(withoutTrigger).toBeGreaterThan(500);
  });

  test("never mixes one panel's name with the other's panel", () => {
    for (const nodes of [
      [],
      [PLACEHOLDER],
      [PLACEHOLDER, ACTION],
      [TRIGGER],
      [TRIGGER, ACTION],
    ] as Array<Array<WorkflowAddButtonNode>>) {
      const button: WorkflowAddButton = getWorkflowAddButton(nodes);

      expect(button.title === "Add Trigger").toBe(
        button.componentsType === ComponentType.Trigger,
      );
    }
  });
});
