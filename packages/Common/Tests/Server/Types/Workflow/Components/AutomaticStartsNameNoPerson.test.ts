/*
 * What starts a workflow on its own never names a person.
 *
 * "Why do I have to enable a workflow in order to test run it?" A run that
 * names the person who started it (ExecuteWorkflowType.startedByUserId) goes
 * ahead while the workflow is turned off, as a test run: that is how the
 * Builder's Run Workflow and Run just this step work on a workflow that is
 * off (QueueWorkflow, in App). So every other way a run is asked for must
 * name nobody - or turning a workflow off would stop pausing it:
 *
 *   - its webhook URL, whatever the request's body says;
 *   - its schedule, which is not even registered while the workflow is off;
 *   - a OneUptime event, which only looks up workflows that are on;
 *   - an incoming email, which starts nothing while the workflow is off;
 *   - another workflow's Execute Workflow step.
 *
 * Each is driven here as the workflow service drives it, with what it hands
 * over recorded. WorkflowService is spied on, so no database is touched.
 */

jest.mock("isolated-vm", () => {
  return {};
});

import MonitorService from "../../../../../Server/Services/MonitorService";
import WorkflowService from "../../../../../Server/Services/WorkflowService";
import {
  ExecuteChildWorkflow,
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import OnTriggerBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel";
import IncomingEmailWorkflowTrigger from "../../../../../Server/Types/Workflow/Components/IncomingEmail";
import ScheduleTrigger from "../../../../../Server/Types/Workflow/Components/Schedule";
import WebhookTrigger from "../../../../../Server/Types/Workflow/Components/Webhook";
import ExecuteWorkflow from "../../../../../Server/Types/Workflow/Components/Workflow";
import {
  ExecuteWorkflowType,
  InitProps,
} from "../../../../../Server/Types/Workflow/TriggerCode";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../../Server/Utils/Express";
import Response from "../../../../../Server/Utils/Response";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import Exception from "../../../../../Types/Exception/Exception";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import {
  IncomingEmailTriggerDeliveryStatus,
  IncomingEmailTriggerEmail,
} from "../../../../../Types/Workflow/IncomingEmailTrigger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "6ba7b812-9dad-41d1-80b4-00c04fd430c8",
);
const OTHER_WORKFLOW_ID: string = "6ba7b813-9dad-41d1-80b4-00c04fd430c8";
const PROJECT_ID: ObjectID = new ObjectID(
  "3c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
);
const PERSON_ID: string = "4d9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const KEY: string = "8c9e6679-7425-40de-944b-e07fc1f90ae7";

// The only keys a run asked for without a person may carry.
const NO_PERSON_KEYS: Array<string> = ["returnValues", "workflowId"];

type AskedForRun = ExecuteWorkflowType | ExecuteChildWorkflow;

type KeysFunction = (run: AskedForRun) => Array<string>;

const keysOf: KeysFunction = (run: AskedForRun): Array<string> => {
  return Object.keys(run).sort();
};

interface Recorded {
  executed: Array<ExecuteWorkflowType>;
  scheduled: Array<{ run: ExecuteWorkflowType; scheduleAt: string }>;
  removed: Array<string>;
}

type InitPropsFunction = (recorded: Recorded) => InitProps;

const initProps: InitPropsFunction = (recorded: Recorded): InitProps => {
  return {
    router: {
      get: (): void => {},
      post: (): void => {},
    } as unknown as InitProps["router"],
    executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
      recorded.executed.push(run);
    },
    scheduleWorkflow: async (
      run: ExecuteWorkflowType,
      scheduleAt: string,
    ): Promise<void> => {
      recorded.scheduled.push({ run, scheduleAt });
    },
    removeWorkflow: async (workflowId: ObjectID): Promise<void> => {
      recorded.removed.push(workflowId.toString());
    },
  };
};

type WorkflowRowFunction = (values: {
  isEnabled: boolean;
  triggerId?: string;
}) => Workflow;

const workflowRow: WorkflowRowFunction = (values: {
  isEnabled: boolean;
  triggerId?: string;
}): Workflow => {
  const workflow: Workflow = new Workflow();
  workflow._id = WORKFLOW_ID.toString();
  workflow.id = WORKFLOW_ID;
  workflow.projectId = PROJECT_ID;
  workflow.isEnabled = values.isEnabled;
  workflow.isArchived = false;
  workflow.triggerId = values.triggerId || ComponentID.Schedule;
  workflow.triggerArguments = { schedule: "*/5 * * * *" };
  return workflow;
};

let recorded: Recorded;

beforeEach(() => {
  recorded = { executed: [], scheduled: [], removed: [] };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a call to the webhook URL", () => {
  test("starts a run that names nobody, whatever the request's body says", async () => {
    jest
      .spyOn(WorkflowService, "findOneBy")
      .mockResolvedValue(workflowRow({ isEnabled: true }) as never);
    jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation((() => {
      return undefined;
    }) as never);

    await new WebhookTrigger().initTrigger(
      {
        params: { secretkey: "a-secret-key" },
        headers: {},
        query: { startedByUserId: PERSON_ID },
        body: { startedByUserId: PERSON_ID, isTestRun: true },
      } as unknown as ExpressRequest,
      {} as unknown as ExpressResponse,
      initProps(recorded),
    );

    expect(recorded.executed).toHaveLength(1);
    expect(keysOf(recorded.executed[0]!)).toEqual(NO_PERSON_KEYS);
    expect(recorded.executed[0]!.startedByUserId).toBeUndefined();
  });
});

describe("a schedule", () => {
  test("of a workflow that is off is not registered, and is taken down", async () => {
    jest
      .spyOn(WorkflowService, "findBy")
      .mockResolvedValue([workflowRow({ isEnabled: false })] as never);

    await new ScheduleTrigger().setupComponent(initProps(recorded));

    expect(recorded.scheduled).toEqual([]);
    expect(recorded.removed).toEqual([WORKFLOW_ID.toString()]);
  });

  test("of a workflow that is on is registered with no person", async () => {
    jest
      .spyOn(WorkflowService, "findBy")
      .mockResolvedValue([workflowRow({ isEnabled: true })] as never);

    await new ScheduleTrigger().setupComponent(initProps(recorded));

    expect(recorded.scheduled).toHaveLength(1);
    expect(keysOf(recorded.scheduled[0]!.run)).toEqual(NO_PERSON_KEYS);
  });
});

describe("a OneUptime event", () => {
  test("looks up only the workflows that are on, and starts each with no person", async () => {
    jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation((() => {
      return undefined;
    }) as never);

    const findBy: SpyInstance<typeof WorkflowService.findBy> = jest
      .spyOn(WorkflowService, "findBy")
      .mockResolvedValue([
        workflowRow({ isEnabled: true, triggerId: "monitor-on-create" }),
      ] as never);

    await new OnTriggerBaseModel(
      MonitorService as never,
      "on-create",
    ).initTrigger(
      {
        params: { projectId: PROJECT_ID.toString() },
        body: { data: { _id: PERSON_ID } },
      } as unknown as ExpressRequest,
      {} as unknown as ExpressResponse,
      initProps(recorded),
    );

    const query: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["isEnabled"]).toBe(true);
    expect(recorded.executed).toHaveLength(1);
    expect(keysOf(recorded.executed[0]!)).toEqual(NO_PERSON_KEYS);
  });
});

describe("an incoming email", () => {
  const anEmail: IncomingEmailTriggerEmail = {
    from: "alerts@vendor.example",
    to: [`workflow-${KEY}@inbound.example`],
    cc: [],
    subject: "Disk space low",
    body: "Only 4% left.",
    htmlBody: "",
    headers: {},
    attachments: [],
    receivedAt: "2026-10-12T08:30:00.000Z",
  };

  type DeliverFunction = (isEnabled: boolean) => Promise<{
    status: IncomingEmailTriggerDeliveryStatus;
  }>;

  const deliver: DeliverFunction = async (
    isEnabled: boolean,
  ): Promise<{ status: IncomingEmailTriggerDeliveryStatus }> => {
    jest.spyOn(WorkflowService, "findOneBy").mockResolvedValue(
      workflowRow({
        isEnabled,
        triggerId: ComponentID.IncomingEmail,
      }) as never,
    );

    const status: IncomingEmailTriggerDeliveryStatus =
      await new IncomingEmailWorkflowTrigger().deliverEmail({
        secretKey: KEY,
        email: anEmail,
        executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
          recorded.executed.push(run);
        },
      });

    return { status };
  };

  test("to a workflow that is off starts nothing", async () => {
    const { status } = await deliver(false);

    expect(status).toBe(IncomingEmailTriggerDeliveryStatus.WorkflowDisabled);
    expect(recorded.executed).toEqual([]);
  });

  test("to a workflow that is on starts a run that names nobody", async () => {
    const { status } = await deliver(true);

    expect(status).toBe(IncomingEmailTriggerDeliveryStatus.Scheduled);
    expect(recorded.executed).toHaveLength(1);
    expect(keysOf(recorded.executed[0]!)).toEqual(NO_PERSON_KEYS);
  });
});

describe("another workflow's Execute Workflow step", () => {
  test("hands over the workflow and its values, and nobody", async () => {
    const children: Array<ExecuteChildWorkflow> = [];

    const result: RunReturnType = await new ExecuteWorkflow().run(
      {
        workflowId: OTHER_WORKFLOW_ID,
        arguments: { startedByUserId: PERSON_ID },
      },
      {
        log: (): void => {},
        workflowLogId: ObjectID.generate(),
        workflowId: WORKFLOW_ID,
        projectId: PROJECT_ID,
        onError: (exception: Exception): Exception => {
          return exception;
        },
        executeWorkflow: async (child: ExecuteChildWorkflow): Promise<void> => {
          children.push(child);
        },
      } as RunOptions,
    );

    expect(result.executePort?.id).toBe("out");
    expect(children).toHaveLength(1);
    expect(keysOf(children[0]!)).toEqual(NO_PERSON_KEYS);
    // A key the step's own arguments name stays among its values.
    expect(children[0]!.returnValues).toEqual({ startedByUserId: PERSON_ID });
  });
});
