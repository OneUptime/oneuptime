/*
 * An Execute Workflow step that calls a workflow which is archived.
 *
 * The queue refuses an archived workflow with "This workflow is archived",
 * worded for the workflow being run. Logged in the CALLING run, that would
 * read as the calling workflow - plainly running - so the step names the one
 * it called, as it does for one that is turned off. Archived is checked
 * first: turning an archived workflow on would not make it run, so "turn it
 * on" would be the wrong advice. A workflow in another project is still
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
import { getChildWorkflowArchivedMessage } from "Common/Types/Workflow/WorkflowArchive";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

const CALLING_WORKFLOW_ID: ObjectID = new ObjectID(
  "66666666-aaaa-4aaa-8aaa-666666666666",
);
const CALLED_WORKFLOW_ID: ObjectID = new ObjectID(
  "77777777-bbbb-4bbb-8bbb-777777777777",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "88888888-cccc-4ccc-8ccc-888888888888",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-dddd-4ddd-8ddd-999999999999",
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

interface CalledWorkflow {
  projectId: ObjectID;
  isEnabled: boolean;
  isArchived: boolean;
  name?: string | undefined;
}

interface Prepared {
  runner: RunWorkflow;
  findWorkflow: RecordedSpy;
  enqueue: RecordedSpy;
}

type PrepareFunction = (calledWorkflow: CalledWorkflow) => Prepared;

// A runner part-way through the calling workflow's run.
const prepare: PrepareFunction = (calledWorkflow: CalledWorkflow): Prepared => {
  const runner: RunWorkflow = new RunWorkflow();
  const state: {
    workflowId: ObjectID;
    projectId: ObjectID;
    workflowLogId: ObjectID;
    callChain: Array<string>;
  } = runner as never;

  state.workflowId = CALLING_WORKFLOW_ID;
  state.projectId = PROJECT_ID;
  state.workflowLogId = new ObjectID("aaaaaaaa-eeee-4eee-8eee-aaaaaaaaaaaa");
  state.callChain = [];

  const row: Workflow = new Workflow();
  row._id = CALLED_WORKFLOW_ID.toString();
  row.projectId = calledWorkflow.projectId;
  row.isEnabled = calledWorkflow.isEnabled;
  row.isArchived = calledWorkflow.isArchived;

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

function errorOf(result: RunReturnType): string {
  return String((result.returnValues as JSONObject)["error"]);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Execute Workflow calling a workflow that is archived", () => {
  test("takes its Error port, naming the workflow it called and how to bring it back", async () => {
    const prepared: Prepared = prepare({
      projectId: PROJECT_ID,
      isEnabled: true,
      isArchived: true,
      name: "Page the on-call engineer",
    });

    const result: RunReturnType = await runTheStep(prepared.runner);

    expect(result.executePort?.id).toBe("error");
    expect(errorOf(result)).toBe(
      getChildWorkflowArchivedMessage({
        workflowId: CALLED_WORKFLOW_ID.toString(),
        workflowName: "Page the on-call engineer",
      }),
    );
    expect(errorOf(result)).toBe(
      'The workflow "Page the on-call engineer" is archived, so this step could not start it. Unarchive it to run it again.',
    );
  });

  test("does not queue it", async () => {
    const prepared: Prepared = prepare({
      projectId: PROJECT_ID,
      isEnabled: true,
      isArchived: true,
      name: "Page the on-call engineer",
    });

    await runTheStep(prepared.runner);

    expect(prepared.enqueue.mock.calls).toHaveLength(0);
  });

  test("says archived, not turned off, when it is both: turning it on would not run it", async () => {
    const prepared: Prepared = prepare({
      projectId: PROJECT_ID,
      isEnabled: false,
      isArchived: true,
      name: "Page the on-call engineer",
    });

    const error: string = errorOf(await runTheStep(prepared.runner));

    expect(error).toContain("is archived");
    expect(error).not.toContain("turned off");
  });

  test("names it by its ID when it has no name", async () => {
    const prepared: Prepared = prepare({
      projectId: PROJECT_ID,
      isEnabled: true,
      isArchived: true,
    });

    expect(errorOf(await runTheStep(prepared.runner))).toBe(
      `The workflow ${CALLED_WORKFLOW_ID.toString()} is archived, so this step could not start it. Unarchive it to run it again.`,
    );
  });

  test("reads the called workflow's archive flag with its switch, name and project", async () => {
    const prepared: Prepared = prepare({
      projectId: PROJECT_ID,
      isEnabled: true,
      isArchived: true,
    });

    await runTheStep(prepared.runner);

    const query: { select: JSONObject } = prepared.findWorkflow.mock
      .calls[0]![0] as never;

    expect(query.select).toMatchObject({
      projectId: true,
      isEnabled: true,
      isArchived: true,
      name: true,
    });
  });

  test("an archived workflow in another project is refused as such, and never named", async () => {
    const prepared: Prepared = prepare({
      projectId: OTHER_PROJECT_ID,
      isEnabled: true,
      isArchived: true,
      name: "Another team's archived workflow",
    });

    const error: string = errorOf(await runTheStep(prepared.runner));

    expect(error).toBe("Target workflow does not belong to this project.");
    expect(error).not.toContain("Another team's archived workflow");
    expect(prepared.enqueue.mock.calls).toHaveLength(0);
  });
});

describe("Execute Workflow calling a workflow that was unarchived", () => {
  test("queues it again, as long as it is on", async () => {
    const prepared: Prepared = prepare({
      projectId: PROJECT_ID,
      isEnabled: true,
      isArchived: false,
      name: "Page the on-call engineer",
    });

    const result: RunReturnType = await runTheStep(prepared.runner);

    expect(result.executePort?.id).toBe("out");
    expect(prepared.enqueue.mock.calls).toHaveLength(1);
  });
});
