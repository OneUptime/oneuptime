/*
 * An Execute Workflow step that calls a workflow which is turned off.
 *
 * The queue refuses the called workflow with "This workflow is turned off",
 * worded for the workflow being run. Logged in the CALLING run, that read as
 * the calling workflow - plainly running - so the step now names the one it
 * called, and says how to turn it on. A workflow in another project is still
 * refused as not belonging to this one, before anything about it is said.
 */

import RunWorkflow from "../../../FeatureSet/Workflow/Services/RunWorkflow";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowService from "Common/Server/Services/WorkflowService";
import { RunReturnType } from "Common/Server/Types/Workflow/ComponentCode";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ComponentMetadata, {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import WorkflowComponents from "Common/Types/Workflow/Components/Workflow";
import { getChildWorkflowTurnedOffMessage } from "Common/Types/Workflow/WorkflowEnabled";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

const CALLING_WORKFLOW_ID: ObjectID = new ObjectID(
  "11111111-aaaa-4aaa-8aaa-111111111111",
);
const CALLED_WORKFLOW_ID: ObjectID = new ObjectID(
  "22222222-bbbb-4bbb-8bbb-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-cccc-4ccc-8ccc-333333333333",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-dddd-4ddd-8ddd-444444444444",
);

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

const EXECUTE_WORKFLOW: ComponentMetadata = WorkflowComponents.find(
  (component: ComponentMetadata) => {
    return component.id === ComponentID.WorkflowRun;
  },
)!;

const STEP: NodeDataProp = {
  id: "workflow-run-1",
  internalId: "runner-workflow-run-1",
  nodeType: NodeType.Node,
  componentType: ComponentType.Component,
  metadataId: ComponentID.WorkflowRun,
  metadata: EXECUTE_WORKFLOW,
  error: "",
  arguments: {},
  returnValues: {},
};

interface Prepared {
  runner: RunWorkflow;
  findWorkflow: RecordedSpy;
  enqueue: RecordedSpy;
}

type PrepareFunction = (calledWorkflow: {
  projectId: ObjectID;
  isEnabled: boolean;
  name?: string | undefined;
}) => Prepared;

/*
 * A runner part-way through the calling workflow's run, as runWorkflow leaves
 * it before it runs a step.
 */
const prepare: PrepareFunction = (calledWorkflow: {
  projectId: ObjectID;
  isEnabled: boolean;
  name?: string | undefined;
}): Prepared => {
  const runner: RunWorkflow = new RunWorkflow();
  const state: {
    workflowId: ObjectID;
    projectId: ObjectID;
    workflowLogId: ObjectID;
    callChain: Array<string>;
  } = runner as never;

  state.workflowId = CALLING_WORKFLOW_ID;
  state.projectId = PROJECT_ID;
  state.workflowLogId = new ObjectID("55555555-eeee-4eee-8eee-555555555555");
  state.callChain = [];

  const row: Workflow = new Workflow();
  row._id = CALLED_WORKFLOW_ID.toString();
  row.projectId = calledWorkflow.projectId;
  row.isEnabled = calledWorkflow.isEnabled;

  if (calledWorkflow.name !== undefined) {
    row.name = calledWorkflow.name;
  }

  const findWorkflow: RecordedSpy = jest
    .spyOn(WorkflowService as never, "findOneById")
    .mockResolvedValue(row as never) as unknown as RecordedSpy;

  const enqueue: RecordedSpy = jest
    .spyOn(QueueWorkflow, "addWorkflowToQueue")
    .mockResolvedValue(undefined) as unknown as RecordedSpy;

  return { runner, findWorkflow, enqueue };
};

type RunStepFunction = (runner: RunWorkflow) => Promise<RunReturnType>;

const runTheStep: RunStepFunction = async (
  runner: RunWorkflow,
): Promise<RunReturnType> => {
  return await runner.runComponent(
    {
      workflowId: CALLED_WORKFLOW_ID.toString(),
      arguments: '{"incident": "INC-42"}',
    },
    STEP,
    (): void => {
      // The step reports through its Error port, not here.
    },
  );
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Execute Workflow calling a workflow that is off", () => {
  test("takes its Error port, naming the workflow it called", async () => {
    const prepared: Prepared = prepare({
      projectId: PROJECT_ID,
      isEnabled: false,
      name: "Page the on-call engineer",
    });

    const result: RunReturnType = await runTheStep(prepared.runner);

    expect(result.executePort.id).toBe("error");
    expect((result.returnValues as JSONObject)["error"]).toBe(
      getChildWorkflowTurnedOffMessage({
        workflowId: CALLED_WORKFLOW_ID.toString(),
        workflowName: "Page the on-call engineer",
      }),
    );
    expect((result.returnValues as JSONObject)["error"]).toBe(
      'The workflow "Page the on-call engineer" is turned off, so this step could not start it. Turn it on with the Enabled switch at the top of its Builder.',
    );
  });

  test("does not queue it", async () => {
    const prepared: Prepared = prepare({
      projectId: PROJECT_ID,
      isEnabled: false,
      name: "Page the on-call engineer",
    });

    await runTheStep(prepared.runner);

    expect(prepared.enqueue.mock.calls).toHaveLength(0);
  });

  test("names it by its ID when it has no name", async () => {
    const prepared: Prepared = prepare({
      projectId: PROJECT_ID,
      isEnabled: false,
    });

    const result: RunReturnType = await runTheStep(prepared.runner);

    expect((result.returnValues as JSONObject)["error"]).toBe(
      `The workflow ${CALLED_WORKFLOW_ID.toString()} is turned off, so this step could not start it. Turn it on with the Enabled switch at the top of its Builder.`,
    );
  });

  test("reads the called workflow's switch and name with its project", async () => {
    const prepared: Prepared = prepare({
      projectId: PROJECT_ID,
      isEnabled: false,
      name: "Page the on-call engineer",
    });

    await runTheStep(prepared.runner);

    const query: { id: ObjectID; select: JSONObject } = prepared.findWorkflow
      .mock.calls[0]![0] as never;

    expect(query.id.toString()).toBe(CALLED_WORKFLOW_ID.toString());
    expect(query.select).toMatchObject({
      projectId: true,
      isEnabled: true,
      name: true,
    });
  });

  test("a workflow in another project is refused as such, and never named", async () => {
    const prepared: Prepared = prepare({
      projectId: OTHER_PROJECT_ID,
      isEnabled: false,
      name: "Another team's secret workflow",
    });

    const result: RunReturnType = await runTheStep(prepared.runner);
    const error: string = String((result.returnValues as JSONObject)["error"]);

    expect(result.executePort.id).toBe("error");
    expect(error).toBe("Target workflow does not belong to this project.");
    expect(error).not.toContain("Another team's secret workflow");
    expect(prepared.enqueue.mock.calls).toHaveLength(0);
  });
});

describe("Execute Workflow calling a workflow that is on", () => {
  test("queues it, with the calling workflow in its call chain, and carries on", async () => {
    const prepared: Prepared = prepare({
      projectId: PROJECT_ID,
      isEnabled: true,
      name: "Page the on-call engineer",
    });

    const result: RunReturnType = await runTheStep(prepared.runner);

    expect(result.executePort.id).toBe("out");
    expect(prepared.enqueue.mock.calls).toHaveLength(1);

    const queued: {
      workflowId: ObjectID;
      returnValues: JSONObject;
      callChain: Array<string>;
    } = prepared.enqueue.mock.calls[0]![0] as never;

    expect(queued.workflowId.toString()).toBe(CALLED_WORKFLOW_ID.toString());
    expect(queued.returnValues).toEqual({ incident: "INC-42" });
    expect(queued.callChain).toEqual([CALLING_WORKFLOW_ID.toString()]);
  });
});
