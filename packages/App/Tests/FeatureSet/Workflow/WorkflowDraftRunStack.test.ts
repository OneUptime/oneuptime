import { loadAllComponentMetadata } from "../../../FeatureSet/Workflow/Utils/ComponentMetadata";
import RunWorkflow from "../../../FeatureSet/Workflow/Services/RunWorkflow";
import WorkflowService from "Common/Server/Services/WorkflowService";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ComponentMetadata from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import {
  WorkflowDraft,
  buildGraphFromDraft,
} from "Common/Types/Workflow/WorkflowDraft";
import UUID from "Common/Utils/UUID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Issue #5945: a graph built from a draft is one the runner runs and the trigger
 * is read from, by the real code, with the real components: a workflow that looks
 * right in the Builder and never fires is the failure this is here to catch.
 */

const ALL_COMPONENTS: Dictionary<ComponentMetadata> =
  loadAllComponentMetadata();

const DRAFT: WorkflowDraft = {
  steps: [
    { id: "incident-created", componentId: "incident-on-create" },
    {
      id: "is-it-bad",
      componentId: ComponentID.IfElse,
    },
    {
      id: "log-bad",
      componentId: ComponentID.Log,
      arguments: {
        value: "{{local.components.incident-created.returnValues.model.title}}",
      },
    },
    {
      id: "log-fine",
      componentId: ComponentID.Log,
      arguments: { value: "fine" },
    },
  ],
  connections: [
    { from: "incident-created", to: "is-it-bad" },
    { from: "is-it-bad", to: "log-bad", fromOutput: "yes" },
    { from: "is-it-bad", to: "log-fine", fromOutput: "no" },
  ],
};

const GRAPH: JSONObject = buildGraphFromDraft({
  draft: DRAFT,
  getComponent: (id: string): ComponentMetadata | undefined => {
    return ALL_COMPONENTS[id];
  },
  generateId: UUID.generate,
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a graph built from a draft", () => {
  test("the runner reads each step, and starts from the trigger", async () => {
    const stack: {
      stack: Dictionary<{ outPorts: Dictionary<Array<string>> }>;
      startWithComponentId: string;
    } = (await new RunWorkflow().makeRunStack(GRAPH)) as never;

    expect(stack.startWithComponentId).toBe("incident-created");
    expect(stack.stack["incident-created"]?.outPorts["success"]).toEqual([
      "is-it-bad",
    ]);
    expect(stack.stack["is-it-bad"]?.outPorts["yes"]).toEqual(["log-bad"]);
    expect(stack.stack["is-it-bad"]?.outPorts["no"]).toEqual(["log-fine"]);
  });

  test("its trigger is written onto the workflow, so the runner finds it", async () => {
    const write: { mock: { calls: Array<Array<any>> } } = jest
      .spyOn(WorkflowService as never, "updateOneById")
      .mockResolvedValue(undefined as never) as never;

    await (
      WorkflowService as unknown as {
        saveTriggerFromGraph: (data: {
          workflowId: ObjectID;
          graph: JSONObject;
        }) => Promise<void>;
      }
    ).saveTriggerFromGraph({
      workflowId: ObjectID.generate(),
      graph: GRAPH,
    });

    expect(write.mock.calls[0]![0].data.triggerId).toBe("incident-on-create");
  });
});
