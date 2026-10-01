import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import MonitorService from "../../../../../Server/Services/MonitorService";
import WorkflowService from "../../../../../Server/Services/WorkflowService";
import OnTriggerBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel";
import ScheduleTrigger, {
  isScheduleLive,
} from "../../../../../Server/Types/Workflow/Components/Schedule";
import {
  ExecuteWorkflowType,
  InitProps,
} from "../../../../../Server/Types/Workflow/TriggerCode";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../../Server/Utils/Express";
import Response from "../../../../../Server/Utils/Response";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * An archived workflow never runs, from any trigger. The queue refuses every
 * run it is asked for (QueueWorkflow, tested in App), but two triggers decide
 * earlier whether to ask at all, and both must leave an archived workflow out:
 *
 *   - the Schedule trigger registers a repeating job per scheduled workflow,
 *     and must remove an archived workflow's job (and not register one) - on
 *     startup and whenever the workflow is saved, archived or unarchived;
 *   - the model-event triggers (on create / update / delete) look up the
 *     workflows to run by query, and must not find archived ones.
 *
 * Archiving never touches isEnabled, so a workflow that was on runs again on
 * unarchive and one that was off stays off.
 */

const WORKFLOW_ID: ObjectID = new ObjectID(
  "6ba7b810-9dad-41d1-80b4-00c04fd430c9",
);

function scheduledWorkflow(values: {
  isEnabled: boolean;
  isArchived?: boolean;
}): Workflow {
  const workflow: Workflow = new Workflow();
  workflow._id = WORKFLOW_ID.toString();
  workflow.id = WORKFLOW_ID;
  workflow.isEnabled = values.isEnabled;

  if (values.isArchived !== undefined) {
    workflow.isArchived = values.isArchived;
  }

  workflow.triggerArguments = { schedule: "*/5 * * * *" };
  return workflow;
}

interface Calls {
  scheduled: Array<{ workflowId: string; scheduleAt: string }>;
  removed: Array<string>;
}

function initProps(calls: Calls): InitProps {
  return {
    router: {
      get: (): void => {},
      post: (): void => {},
    } as unknown as InitProps["router"],
    executeWorkflow: async (): Promise<void> => {},
    scheduleWorkflow: async (
      run: ExecuteWorkflowType,
      scheduleAt: string,
    ): Promise<void> => {
      calls.scheduled.push({
        workflowId: run.workflowId.toString(),
        scheduleAt: scheduleAt,
      });
    },
    removeWorkflow: async (workflowId: ObjectID): Promise<void> => {
      calls.removed.push(workflowId.toString());
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isScheduleLive", () => {
  test.each([
    [true, false, true],
    [true, undefined, true],
    [false, false, false],
    [true, true, false],
    [false, true, false],
  ])(
    "enabled %s, archived %s: the schedule is live = %s",
    (
      isEnabled: boolean,
      isArchived: boolean | undefined,
      expected: boolean,
    ) => {
      expect(
        isScheduleLive(
          scheduledWorkflow({
            isEnabled,
            ...(isArchived === undefined ? {} : { isArchived }),
          }),
        ),
      ).toBe(expected);
    },
  );
});

describe("the Schedule trigger", () => {
  let calls: Calls;
  let trigger: ScheduleTrigger;

  beforeEach(() => {
    calls = { scheduled: [], removed: [] };
    trigger = new ScheduleTrigger();
  });

  test("on startup, an archived workflow's schedule is removed and not registered, even though it is on", async () => {
    const findBy: SpyInstance<typeof WorkflowService.findBy> = jest
      .spyOn(WorkflowService, "findBy")
      .mockResolvedValue([
        scheduledWorkflow({ isEnabled: true, isArchived: true }),
      ]);

    await trigger.setupComponent(initProps(calls));

    expect(calls.scheduled).toEqual([]);
    expect(calls.removed).toEqual([WORKFLOW_ID.toString()]);

    const select: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(select["isArchived"]).toBe(true);
  });

  test("on startup, a live enabled workflow is scheduled as before", async () => {
    jest
      .spyOn(WorkflowService, "findBy")
      .mockResolvedValue([
        scheduledWorkflow({ isEnabled: true, isArchived: false }),
      ]);

    await trigger.setupComponent(initProps(calls));

    expect(calls.scheduled).toEqual([
      { workflowId: WORKFLOW_ID.toString(), scheduleAt: "*/5 * * * *" },
    ]);
    expect(calls.removed).toEqual([]);
  });

  test("saving an archived workflow takes its schedule down", async () => {
    jest.spyOn(WorkflowService, "findBy").mockResolvedValue([]);
    await trigger.setupComponent(initProps(calls));

    const findOneBy: SpyInstance<typeof WorkflowService.findOneBy> = jest
      .spyOn(WorkflowService, "findOneBy")
      .mockResolvedValue(
        scheduledWorkflow({ isEnabled: true, isArchived: true }),
      );

    await trigger.update({ workflowId: WORKFLOW_ID });

    expect(calls.scheduled).toEqual([]);
    expect(calls.removed).toEqual([WORKFLOW_ID.toString()]);
    expect(
      (findOneBy.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select["isArchived"],
    ).toBe(true);
  });

  test("unarchiving a workflow that was on puts its schedule back", async () => {
    jest.spyOn(WorkflowService, "findBy").mockResolvedValue([]);
    await trigger.setupComponent(initProps(calls));

    jest
      .spyOn(WorkflowService, "findOneBy")
      .mockResolvedValue(
        scheduledWorkflow({ isEnabled: true, isArchived: false }),
      );

    await trigger.update({ workflowId: WORKFLOW_ID });

    expect(calls.scheduled).toHaveLength(1);
    expect(calls.removed).toEqual([]);
  });

  test("unarchiving a workflow that was off leaves it off", async () => {
    jest.spyOn(WorkflowService, "findBy").mockResolvedValue([]);
    await trigger.setupComponent(initProps(calls));

    jest
      .spyOn(WorkflowService, "findOneBy")
      .mockResolvedValue(
        scheduledWorkflow({ isEnabled: false, isArchived: false }),
      );

    await trigger.update({ workflowId: WORKFLOW_ID });

    expect(calls.scheduled).toEqual([]);
    expect(calls.removed).toEqual([WORKFLOW_ID.toString()]);
  });
});

describe("the model-event triggers", () => {
  test("look up only workflows that are on and not archived", async () => {
    jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation((() => {
      return undefined;
    }) as never);

    const findBy: SpyInstance<typeof WorkflowService.findBy> = jest
      .spyOn(WorkflowService, "findBy")
      .mockResolvedValue([]);

    const trigger: OnTriggerBaseModel<never> = new OnTriggerBaseModel(
      MonitorService as never,
      "on-create",
    );

    const executed: Array<ExecuteWorkflowType> = [];

    await trigger.initTrigger(
      {
        params: { projectId: ObjectID.generate().toString() },
        body: { data: {} },
      } as unknown as ExpressRequest,
      {} as unknown as ExpressResponse,
      {
        router: {} as InitProps["router"],
        executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
          executed.push(run);
        },
        scheduleWorkflow: async (): Promise<void> => {},
        removeWorkflow: async (): Promise<void> => {},
      },
    );

    const query: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["isEnabled"]).toBe(true);
    expect(query["isArchived"]).toBe(false);
    expect(executed).toEqual([]);
  });
});
