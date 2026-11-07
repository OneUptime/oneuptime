import { describe, expect, test } from "@jest/globals";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import {
  AUDIT_LOG_SUMMARIZED_COLUMNS,
  AuditLogColumnSummarizer,
  AuditLogValueSummary,
  getAuditLogColumnSummarizer,
  lookUpWorkflowComponent,
} from "../../../../Server/Utils/AuditLog/AuditLogColumnSummaries";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../../../Types/JSON";
import ComponentID from "../../../../Types/Workflow/ComponentID";

/*
 * A workflow's graph is recorded as what changed (issue #6187): the builder
 * saves the whole canvas a second after every click, and an entry holding two
 * copies of it - card positions, selection and all - says nothing a person
 * can read, and repeats every secret typed into a step.
 */

function graph(nodes: Array<JSONObject>, edges: Array<JSONObject>): JSONObject {
  return { nodes, edges };
}

function step(data: {
  key: string;
  stepId: string;
  componentId: string;
  args?: JSONObject;
  x?: number;
  selected?: boolean;
}): JSONObject {
  return {
    id: data.key,
    type: "node",
    position: { x: data.x ?? 0, y: 0 },
    selected: Boolean(data.selected),
    data: {
      id: data.stepId,
      metadataId: data.componentId,
      nodeType: "Node",
      componentType: "Component",
      internalId: `i-${data.key}`,
      arguments: data.args || {},
      returnValues: {},
      error: "",
    },
  };
}

const MANUAL: JSONObject = step({
  key: "a",
  stepId: "manual-1",
  componentId: ComponentID.Manual,
});

const WEBHOOK_POST: JSONObject = step({
  key: "b",
  stepId: "api-post-1",
  componentId: ComponentID.ApiPost,
  args: {
    "request-headers": '{"Authorization":"Bearer sk-live-123"}',
  },
});

describe("which columns are described rather than copied", () => {
  test("a workflow's graph, and a column of any other table is not", () => {
    expect(getAuditLogColumnSummarizer("Workflow", "graph")).not.toBeNull();
    expect(getAuditLogColumnSummarizer("Workflow", "name")).toBeNull();
    expect(getAuditLogColumnSummarizer("Dashboard", "graph")).toBeNull();
    expect(getAuditLogColumnSummarizer(undefined, "graph")).toBeNull();
    expect(getAuditLogColumnSummarizer("Workflow", "constructor")).toBeNull();
  });

  test("every column described is a real column of an audited model", () => {
    for (const key of AUDIT_LOG_SUMMARIZED_COLUMNS) {
      const [tableName, column] = key.split(".") as [string, string];
      const modelType: { new (): BaseModel } | undefined = (
        AllModelTypes as Array<{ new (): BaseModel }>
      ).find((candidate: { new (): BaseModel }): boolean => {
        return new candidate().tableName === tableName;
      });

      expect(modelType).toBeDefined();

      const model: BaseModel = new modelType!();

      expect(model.isTableColumn(column)).toBe(true);
      expect(model.enableAuditLogOn?.update).toBe(true);
    }
  });
});

describe("a workflow's graph in an entry", () => {
  const summarizer: AuditLogColumnSummarizer = getAuditLogColumnSummarizer(
    new Workflow().tableName,
    "graph",
  ) as AuditLogColumnSummarizer;

  test("a save that only moved and selected a card is no change at all", () => {
    expect(
      summarizer.summarizeUpdate(
        graph([MANUAL, WEBHOOK_POST], []),
        graph(
          [
            { ...MANUAL, position: { x: 500, y: 300 }, selected: true },
            WEBHOOK_POST,
          ],
          [],
        ),
      ),
    ).toBeNull();
  });

  test("a real change is its lines, with the graph before and after in a few words", () => {
    const summary: AuditLogValueSummary | null = summarizer.summarizeUpdate(
      graph([MANUAL], []),
      graph(
        [MANUAL, WEBHOOK_POST],
        [
          {
            id: "e",
            source: "a",
            target: "b",
            sourceHandle: "success",
            targetHandle: "in",
          },
        ],
      ),
    );

    expect(summary).toEqual({
      oldValue: "1 step and no connections",
      newValue: "2 steps and 1 connection",
      summary: [
        'Added "API Post (JSON)" (api-post-1)',
        'Connected "Manual" (manual-1) to "API Post (JSON)" (api-post-1)',
      ],
    });
  });

  test("a step's settings are named in the words the builder uses, never quoted", () => {
    const summary: AuditLogValueSummary | null = summarizer.summarizeUpdate(
      graph([WEBHOOK_POST], []),
      graph(
        [
          step({
            key: "b",
            stepId: "api-post-1",
            componentId: ComponentID.ApiPost,
            args: {
              "request-headers": '{"Authorization":"Bearer sk-live-456"}',
            },
          }),
        ],
        [],
      ),
    );

    expect(summary?.summary).toEqual([
      'Changed "Request Headers" in "API Post (JSON)" (api-post-1)',
    ]);
    expect(JSON.stringify(summary)).not.toContain("sk-live");
  });

  test("a workflow created or deleted is its steps, listed", () => {
    expect(
      summarizer.summarizeSnapshot(graph([MANUAL, WEBHOOK_POST], [])),
    ).toEqual({
      value: "2 steps and no connections",
      summary: ['"API Post (JSON)" (api-post-1)', '"Manual" (manual-1)'],
    });
    expect(summarizer.summarizeSnapshot(undefined)).toEqual({
      value: "No steps and no connections",
      summary: [],
    });
  });

  test("the lookup knows built-in steps and each model's record steps", () => {
    expect(lookUpWorkflowComponent(ComponentID.SendEmail)?.title).toBe(
      "Send Email",
    );
    expect(lookUpWorkflowComponent("monitor-on-create")).toBeDefined();
    expect(lookUpWorkflowComponent("not-a-step")).toBeUndefined();
  });
});
