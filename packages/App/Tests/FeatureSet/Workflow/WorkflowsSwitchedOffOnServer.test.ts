import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import Queue from "Common/Server/Infrastructure/Queue";
import ProjectService from "Common/Server/Services/ProjectService";
import UserService from "Common/Server/Services/UserService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import { describeRefusal } from "Common/Server/Types/Workflow/Components/BaseModel/LogComponentError";
import logger from "Common/Server/Utils/Logger";
import ServerProducts from "Common/Server/Utils/ServerProducts/ServerProducts";
import ProductSwitchedOffException from "Common/Types/Exception/ProductSwitchedOffException";
import ObjectID from "Common/Types/ObjectID";
import ProductKey from "Common/Types/Product/ProductKey";
import { ServerProductOffReason } from "Common/Types/Product/ServerProducts";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WORKFLOWS SWITCHED OFF ON THE SERVER (#7479).
 *
 * Nobody starts a run while the server has Workflows off: Run Workflow, Run
 * just this step and Run again - the runs a person starts, the only ones
 * that pass startedByUserId - are refused at QueueWorkflow, where every run
 * is asked for, with who can switch it on, and nothing is written. What
 * already runs keeps running, as everywhere a product is switched off: a
 * webhook, an event, a schedule or another workflow starts it as before.
 * A step that writes a record of a product that is off is refused (the
 * write's own check, ProductWriteRefusal), and the run log says why.
 */

const WORKFLOW_ID: ObjectID = new ObjectID(
  "c7479000-0000-4000-8000-0000000000c1",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "c7479000-0000-4000-8000-0000000000c2",
);
const USER_ID: ObjectID = new ObjectID("c7479000-0000-4000-8000-0000000000c3");

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

const workflowRow: () => Workflow = (): Workflow => {
  const workflow: Workflow = new Workflow();
  workflow._id = WORKFLOW_ID.toString();
  workflow.id = WORKFLOW_ID;
  workflow.projectId = PROJECT_ID;
  workflow.isEnabled = true;
  workflow.isArchived = false;
  workflow.graph = { nodes: [], edges: [] };
  return workflow;
};

let addJob: RecordedSpy;
let createLog: RecordedSpy;

beforeEach(() => {
  jest
    .spyOn(WorkflowService as never, "findOneById")
    .mockResolvedValue(workflowRow() as never);
  jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockResolvedValue(false as never);
  jest.spyOn(ProjectService as never, "getCurrentPlan").mockResolvedValue({
    plan: null,
    isSubscriptionUnpaid: false,
  } as never);
  jest
    .spyOn(UserService as never, "findOneById")
    .mockResolvedValue(null as never);
  createLog = jest
    .spyOn(WorkflowLogService as never, "create")
    .mockResolvedValue(new WorkflowLog() as never) as unknown as RecordedSpy;
  addJob = jest
    .spyOn(Queue as never, "addJob")
    .mockResolvedValue({} as never) as unknown as RecordedSpy;
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const switchWorkflowsOff: () => void = (): void => {
  jest.spyOn(ServerProducts, "getOff").mockResolvedValue({
    [ProductKey.Workflows]: ServerProductOffReason.SwitchedOff,
  });
};

describe("QueueWorkflow while the server has Workflows off", () => {
  test("refuses a run a person starts, saying who can switch Workflows on, and writes nothing", async () => {
    switchWorkflowsOff();

    const run: Promise<void> = QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: {},
      startedByUserId: USER_ID,
    });

    await expect(run).rejects.toBeInstanceOf(ProductSwitchedOffException);
    await expect(run).rejects.toThrow(
      "Workflows is switched off on this server. A server admin can switch it on in Admin Dashboard > Settings > Products. Nothing was deleted.",
    );

    expect(addJob.mock.calls).toHaveLength(0);
    expect(createLog.mock.calls).toHaveLength(0);
  });

  test("lets what already runs keep running: a run nobody started by hand", async () => {
    switchWorkflowsOff();

    await expect(
      QueueWorkflow.addWorkflowToQueue({
        workflowId: WORKFLOW_ID,
        returnValues: {},
      }),
    ).resolves.toBeUndefined();

    expect(addJob.mock.calls.length).toBeGreaterThan(0);
  });

  test("lets a person run it while Workflows is on", async () => {
    jest.spyOn(ServerProducts, "getOff").mockResolvedValue({
      [ProductKey.Logs]: ServerProductOffReason.SwitchedOff,
    });

    await expect(
      QueueWorkflow.addWorkflowToQueue({
        workflowId: WORKFLOW_ID,
        returnValues: {},
        startedByUserId: USER_ID,
      }),
    ).resolves.toBeUndefined();

    expect(addJob.mock.calls.length).toBeGreaterThan(0);
  });
});

describe("a step that writes a record of a product that is off", () => {
  test("is said in the run log, naming the step, with who can switch it on", () => {
    const error: ProductSwitchedOffException = new ProductSwitchedOffException(
      {
        product: ProductKey.Incidents,
        reason: ServerProductOffReason.SwitchedOff,
      },
    );

    expect(
      describeRefusal({
        error: error,
        message: error.message,
        stepTitle: "Create Incident",
      }),
    ).toBe(
      '"Create Incident" was refused. Incidents is switched off on this server. A server admin can switch it on in Admin Dashboard > Settings > Products. Nothing was deleted.',
    );
  });
});
