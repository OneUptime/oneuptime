/*
 * The runtime component registry reaches the native isolated-vm addon through
 * the JavaScript component's sandbox. Nothing here runs a sandbox, so stub
 * the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import Services from "../../../../../Server/Services/Index";
import MonitorService from "../../../../../Server/Services/MonitorService";
import WorkflowService from "../../../../../Server/Services/WorkflowService";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import RuntimeComponents from "../../../../../Server/Types/Workflow/Components/Index";
import OnCreateBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/OnCreateBaseModel";
import OnCreateOrUpdateBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/OnCreateOrUpdateBaseModel";
import OnDeleteBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/OnDeleteBaseModel";
import OnTriggerBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel";
import OnUpdateBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/OnUpdateBaseModel";
import {
  ExecuteWorkflowType,
  InitProps,
} from "../../../../../Server/Types/Workflow/TriggerCode";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../../Server/Utils/Express";
import Response from "../../../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WHAT_HAPPENED_ID,
  getCreateOrUpdateTriggerId,
  hasCreateOrUpdateTrigger,
} from "../../../../../Types/Workflow/CreateOrUpdateTrigger";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ON CREATE OR UPDATE RUNS ONCE FOR A NEW RECORD AND ONCE FOR EACH WATCHED
 * CHANGE, AND SAYS WHICH (Types/Workflow/CreateOrUpdateTrigger).
 *
 * It has no route of its own: the On Create and On Update events start its
 * workflows, in the same lookup as their own (OnTriggerBaseModel.initTrigger).
 * These drive that lookup and the trigger's run with the database left out:
 * WorkflowService.findBy answers with the workflows given, and a run reads
 * the record from a stubbed service.
 */

const PROJECT_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd43000";
const RECORD_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd43001";

const ON_CREATE: string = "monitor-on-create";
const ON_UPDATE: string = "monitor-on-update";
const ON_DELETE: string = "monitor-on-delete";
const CREATE_OR_UPDATE: string = "monitor-on-create-or-update";

// Workflow ids, one per kind of workflow these tests start.
const CREATE_WORKFLOW: string = "6ba7b810-9dad-41d1-80b4-00c04fd43101";
const UPDATE_WORKFLOW: string = "6ba7b810-9dad-41d1-80b4-00c04fd43102";
const BOTH_WORKFLOW: string = "6ba7b810-9dad-41d1-80b4-00c04fd43103";
const BOTH_WATCHING_NAME: string = "6ba7b810-9dad-41d1-80b4-00c04fd43104";

function workflow(
  id: string,
  triggerId: string,
  listenOn?: JSONObject | string,
): Workflow {
  const row: Workflow = new Workflow();
  row._id = id;
  row.id = new ObjectID(id);
  row.isEnabled = true;
  row.triggerId = triggerId;
  row.triggerArguments =
    listenOn === undefined
      ? { select: { name: true } }
      : { "listen-on": listenOn as JSONObject, select: { name: true } };
  return row;
}

interface Event {
  // What the lookup was asked.
  query: JSONObject;
  select: JSONObject;
  // The triggers whose workflows it asked for.
  triggerIds: Array<string>;
  // What it started, in order.
  started: Array<ExecuteWorkflowType>;
}

/*
 * The triggers a lookup asks for: one id, or several in an IN (...) the
 * query helper writes as a raw condition with the ids as its parameter.
 */
function askedTriggerIds(triggerId: unknown): Array<string> {
  if (typeof triggerId === "string") {
    return [triggerId];
  }

  const operator: { type?: string; objectLiteralParameters?: JSONObject } =
    (triggerId || {}) as {
      type?: string;
      objectLiteralParameters?: JSONObject;
    };

  expect(operator.type).toBe("raw");

  return Object.values(
    operator.objectLiteralParameters || {},
  ).flat() as Array<string>;
}

/*
 * Sends one event to a trigger, as DatabaseService's POST does: the record
 * and what changed, and - for an update its own create made - isPartOfCreate.
 */
async function send(data: {
  trigger: OnTriggerBaseModel<never>;
  workflows: Array<Workflow>;
  miscData?: JSONObject | undefined;
  isPartOfCreate?: boolean | undefined;
}): Promise<Event> {
  /*
   * Answered as the database would: the workflows on the triggers asked
   * for, of the project asked for, that are on.
   */
  const findBy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
    WorkflowService,
    "findBy",
  ).mockImplementation((async (args: { query: JSONObject }) => {
    const ids: Array<string> = askedTriggerIds(args.query["triggerId"]);

    return data.workflows.filter((row: Workflow): boolean => {
      return ids.includes(row.triggerId || "");
    });
  }) as never);

  const started: Array<ExecuteWorkflowType> = [];

  await data.trigger.initTrigger(
    {
      params: { projectId: PROJECT_ID },
      body: {
        data: {
          _id: RECORD_ID,
          ...(data.miscData ? { miscData: data.miscData } : {}),
        },
        ...(data.isPartOfCreate ? { isPartOfCreate: true } : {}),
      },
    } as unknown as ExpressRequest,
    {} as unknown as ExpressResponse,
    {
      router: {} as InitProps["router"],
      executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
        started.push(run);
      },
      scheduleWorkflow: async (): Promise<void> => {},
      removeWorkflow: async (): Promise<void> => {},
    },
  );

  const asked: { query: JSONObject; select: JSONObject } = findBy.mock
    .calls[0]![0] as { query: JSONObject; select: JSONObject };

  findBy.mockRestore();

  return {
    query: asked.query,
    select: asked.select,
    triggerIds: askedTriggerIds(asked.query["triggerId"]),
    started: started,
  };
}

type RunOfFunction = (event: Event) => Array<[string, JSONObject]>;

// Each workflow started, with the values it was started with.
const runsOf: RunOfFunction = (event: Event): Array<[string, JSONObject]> => {
  return event.started.map((run: ExecuteWorkflowType): [string, JSONObject] => {
    return [run.workflowId.toString(), run.returnValues];
  });
};

const onCreate: () => OnTriggerBaseModel<never> =
  (): OnTriggerBaseModel<never> => {
    return new OnCreateBaseModel(MonitorService as never) as never;
  };

const onUpdate: () => OnTriggerBaseModel<never> =
  (): OnTriggerBaseModel<never> => {
    return new OnUpdateBaseModel(MonitorService as never) as never;
  };

const onDelete: () => OnTriggerBaseModel<never> =
  (): OnTriggerBaseModel<never> => {
    return new OnDeleteBaseModel(MonitorService as never) as never;
  };

const RECORD: JSONObject = { _id: RECORD_ID };

beforeEach(() => {
  jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("one lookup finds both triggers' workflows", () => {
  test("a create asks for On Create's workflows and On Create or Update's, by their trigger", async () => {
    const event: Event = await send({ trigger: onCreate(), workflows: [] });

    expect(event.triggerIds).toEqual([ON_CREATE, CREATE_OR_UPDATE]);
    // Each workflow says which of the two it is on.
    expect(event.select["triggerId"]).toBe(true);
    // And only the workflows that may run, as before.
    expect(event.query["isEnabled"]).toBe(true);
    expect(event.query["isArchived"]).toBe(false);
  });

  test("an update asks for On Update's and On Create or Update's", async () => {
    const event: Event = await send({ trigger: onUpdate(), workflows: [] });

    expect(event.triggerIds).toEqual([ON_UPDATE, CREATE_OR_UPDATE]);
  });

  test("a delete asks for On Delete's only, as it always did", async () => {
    const event: Event = await send({ trigger: onDelete(), workflows: [] });

    expect(event.query["triggerId"]).toBe(ON_DELETE);
    expect(onDelete().createOrUpdateTriggerId).toBeNull();
  });

  test("a model without both triggers asks for its own trigger's only", async () => {
    const createOnly: DatabaseService<BaseModel> | undefined = Services.find(
      (service: unknown): boolean => {
        return (
          service instanceof DatabaseService &&
          Boolean(service.getModel().enableWorkflowOn?.create) &&
          !service.getModel().enableWorkflowOn?.update
        );
      },
    ) as DatabaseService<BaseModel> | undefined;

    expect(createOnly).toBeDefined();
    expect(
      hasCreateOrUpdateTrigger(createOnly!.getModel().enableWorkflowOn),
    ).toBe(false);

    const trigger: OnTriggerBaseModel<never> = new OnCreateBaseModel(
      createOnly as never,
    ) as never;

    expect(trigger.createOrUpdateTriggerId).toBeNull();

    const event: Event = await send({ trigger: trigger, workflows: [] });

    expect(event.query["triggerId"]).toBe(trigger.getMetadata().id);
  });
});

describe("a create", () => {
  test("starts On Create or Update's workflow once, as created, and On Create's as before", async () => {
    const event: Event = await send({
      trigger: onCreate(),
      workflows: [
        workflow(CREATE_WORKFLOW, ON_CREATE),
        workflow(BOTH_WORKFLOW, CREATE_OR_UPDATE),
      ],
    });

    expect(runsOf(event)).toEqual([
      [CREATE_WORKFLOW, { data: RECORD }],
      [BOTH_WORKFLOW, { data: RECORD, [WHAT_HAPPENED_ID]: "created" }],
    ]);
  });

  test("always starts it, whatever its Fields to watch hold: they are about updates", async () => {
    const event: Event = await send({
      trigger: onCreate(),
      workflows: [
        workflow(BOTH_WATCHING_NAME, CREATE_OR_UPDATE, { name: true }),
      ],
    });

    expect(runsOf(event)).toEqual([
      [BOTH_WATCHING_NAME, { data: RECORD, [WHAT_HAPPENED_ID]: "created" }],
    ]);
  });

  test("starts On Create's workflow exactly as it always did: no What Happened", async () => {
    const event: Event = await send({
      trigger: onCreate(),
      workflows: [workflow(CREATE_WORKFLOW, ON_CREATE)],
    });

    expect(event.started).toHaveLength(1);
    expect(Object.keys(event.started[0]!).sort()).toEqual([
      "returnValues",
      "workflowId",
    ]);
    expect(event.started[0]!.returnValues).toEqual({ data: RECORD });
  });
});

describe("an update", () => {
  const changedName: JSONObject = { updatedFields: { name: "Checkout API" } };

  test("starts it as updated, with nothing watched", async () => {
    const event: Event = await send({
      trigger: onUpdate(),
      workflows: [workflow(BOTH_WORKFLOW, CREATE_OR_UPDATE)],
      miscData: changedName,
    });

    expect(runsOf(event)).toEqual([
      [
        BOTH_WORKFLOW,
        {
          data: { ...RECORD, miscData: changedName },
          [WHAT_HAPPENED_ID]: "updated",
        },
      ],
    ]);
  });

  test("starts it when a watched field changed, whatever to", async () => {
    for (const value of ["Checkout API", "", null, false, 0]) {
      const event: Event = await send({
        trigger: onUpdate(),
        workflows: [
          workflow(BOTH_WATCHING_NAME, CREATE_OR_UPDATE, { name: true }),
        ],
        miscData: { updatedFields: { name: value } as JSONObject },
      });

      expect([value, event.started.length]).toEqual([value, 1]);
      expect(event.started[0]!.returnValues[WHAT_HAPPENED_ID]).toBe("updated");
    }
  });

  test("does not start it when only an unwatched field changed", async () => {
    const event: Event = await send({
      trigger: onUpdate(),
      workflows: [
        workflow(BOTH_WATCHING_NAME, CREATE_OR_UPDATE, { name: true }),
      ],
      miscData: { updatedFields: { description: "Checks checkout" } },
    });

    expect(event.started).toEqual([]);
  });

  test("reads Fields to watch kept as JSON text, as On Update does", async () => {
    const event: Event = await send({
      trigger: onUpdate(),
      workflows: [
        workflow(BOTH_WATCHING_NAME, CREATE_OR_UPDATE, '{"name": true}'),
      ],
      miscData: changedName,
    });

    expect(event.started).toHaveLength(1);
  });

  test("hears a watched related record by the column holding its ID", async () => {
    const event: Event = await send({
      trigger: onUpdate(),
      workflows: [
        workflow(BOTH_WATCHING_NAME, CREATE_OR_UPDATE, {
          currentMonitorStatus: { name: true },
        }),
      ],
      miscData: {
        updatedFields: {
          currentMonitorStatusId: "6ba7b810-9dad-41d1-80b4-00c04fd43199",
        },
      },
    });

    expect(event.started).toHaveLength(1);
  });

  test("that says nothing of what it changed starts it, as it starts On Update", async () => {
    const event: Event = await send({
      trigger: onUpdate(),
      workflows: [
        workflow(UPDATE_WORKFLOW, ON_UPDATE, { name: true }),
        workflow(BOTH_WATCHING_NAME, CREATE_OR_UPDATE, { name: true }),
      ],
    });

    expect(
      runsOf(event).map((run: [string, JSONObject]) => {
        return run[0];
      }),
    ).toEqual([UPDATE_WORKFLOW, BOTH_WATCHING_NAME]);
  });

  test("starts On Update's workflow beside it exactly as before", async () => {
    const event: Event = await send({
      trigger: onUpdate(),
      workflows: [
        workflow(UPDATE_WORKFLOW, ON_UPDATE),
        workflow(BOTH_WORKFLOW, CREATE_OR_UPDATE),
      ],
      miscData: changedName,
    });

    expect(runsOf(event)).toEqual([
      [UPDATE_WORKFLOW, { data: { ...RECORD, miscData: changedName } }],
      [
        BOTH_WORKFLOW,
        {
          data: { ...RECORD, miscData: changedName },
          [WHAT_HAPPENED_ID]: "updated",
        },
      ],
    ]);
  });
});

describe("one save is one run", () => {
  /*
   * A create can change its own record before it is announced: an on-call
   * policy run sets its status twice, then its On Create event follows.
   * Those updates say they are part of the create (RecordsBeingCreated).
   */
  test("an update the record's create made does not start it; On Update still hears it", async () => {
    const event: Event = await send({
      trigger: onUpdate(),
      workflows: [
        workflow(UPDATE_WORKFLOW, ON_UPDATE),
        workflow(BOTH_WORKFLOW, CREATE_OR_UPDATE),
      ],
      miscData: { updatedFields: { name: "Checkout API" } },
      isPartOfCreate: true,
    });

    expect(
      runsOf(event).map((run: [string, JSONObject]) => {
        return run[0];
      }),
    ).toEqual([UPDATE_WORKFLOW]);
  });

  test("a create with two updates of its own starts it once, as created; a later change once more, as updated", async () => {
    const workflows: Array<Workflow> = [
      workflow(CREATE_WORKFLOW, ON_CREATE),
      workflow(UPDATE_WORKFLOW, ON_UPDATE),
      workflow(BOTH_WORKFLOW, CREATE_OR_UPDATE),
    ];
    const ownUpdate: JSONObject = { updatedFields: { name: "Checkout API" } };

    // In the order DatabaseService sends them for such a create.
    const events: Array<Event> = [
      await send({
        trigger: onUpdate(),
        workflows: workflows,
        miscData: ownUpdate,
        isPartOfCreate: true,
      }),
      await send({
        trigger: onUpdate(),
        workflows: workflows,
        miscData: ownUpdate,
        isPartOfCreate: true,
      }),
      await send({ trigger: onCreate(), workflows: workflows }),
    ];

    const bothRuns: Array<JSONObject> = events.flatMap(
      (event: Event): Array<JSONObject> => {
        return event.started
          .filter((run: ExecuteWorkflowType): boolean => {
            return run.workflowId.toString() === BOTH_WORKFLOW;
          })
          .map((run: ExecuteWorkflowType): JSONObject => {
            return run.returnValues;
          });
      },
    );

    expect(bothRuns).toEqual([{ data: RECORD, [WHAT_HAPPENED_ID]: "created" }]);

    // On Create once, On Update for each of the two, as they always did.
    const others: Array<string> = events.flatMap(
      (event: Event): Array<string> => {
        return event.started
          .map((run: ExecuteWorkflowType): string => {
            return run.workflowId.toString();
          })
          .filter((id: string): boolean => {
            return id !== BOTH_WORKFLOW;
          });
      },
    );

    expect(others).toEqual([UPDATE_WORKFLOW, UPDATE_WORKFLOW, CREATE_WORKFLOW]);

    // Once the create is over, a change is an update like any other.
    const later: Event = await send({
      trigger: onUpdate(),
      workflows: workflows,
      miscData: ownUpdate,
    });

    expect(
      later.started
        .filter((run: ExecuteWorkflowType): boolean => {
          return run.workflowId.toString() === BOTH_WORKFLOW;
        })
        .map((run: ExecuteWorkflowType): unknown => {
          return run.returnValues[WHAT_HAPPENED_ID];
        }),
    ).toEqual(["updated"]);
  });

  test("a create event never starts it twice, even if it were sent saying part of a create", async () => {
    const event: Event = await send({
      trigger: onCreate(),
      workflows: [workflow(BOTH_WORKFLOW, CREATE_OR_UPDATE)],
      isPartOfCreate: true,
    });

    expect(runsOf(event)).toEqual([
      [BOTH_WORKFLOW, { data: RECORD, [WHAT_HAPPENED_ID]: "created" }],
    ]);
  });

  test("the flag must be the switch itself, not a word that looks like it", async () => {
    const findBy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      WorkflowService,
      "findBy",
    ).mockResolvedValue([workflow(BOTH_WORKFLOW, CREATE_OR_UPDATE)] as never);
    const started: Array<ExecuteWorkflowType> = [];

    await onUpdate().initTrigger(
      {
        params: { projectId: PROJECT_ID },
        body: { data: { _id: RECORD_ID }, isPartOfCreate: "true" },
      } as unknown as ExpressRequest,
      {} as unknown as ExpressResponse,
      {
        router: {} as InitProps["router"],
        executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
          started.push(run);
        },
        scheduleWorkflow: async (): Promise<void> => {},
        removeWorkflow: async (): Promise<void> => {},
      },
    );

    findBy.mockRestore();
    expect(started).toHaveLength(1);
  });
});

describe("the trigger itself", () => {
  test("registers no route: nothing sends an event of its own", async () => {
    const router: {
      get: ReturnType<typeof jest.fn>;
      post: ReturnType<typeof jest.fn>;
    } = {
      get: jest.fn(),
      post: jest.fn(),
    };
    const props: InitProps = {
      router: router as unknown as InitProps["router"],
      executeWorkflow: async (): Promise<void> => {},
      scheduleWorkflow: async (): Promise<void> => {},
      removeWorkflow: async (): Promise<void> => {},
    };

    await new OnCreateOrUpdateBaseModel(MonitorService as never).setupComponent(
      props,
    );

    expect(router.get).not.toHaveBeenCalled();
    expect(router.post).not.toHaveBeenCalled();

    // The trigger it stands beside has its two, as before.
    await new OnCreateBaseModel(MonitorService as never).setupComponent(props);

    expect(router.get).toHaveBeenCalledTimes(1);
    expect(router.post).toHaveBeenCalledTimes(1);
    expect(router.post.mock.calls[0]![0]).toBe(
      "/model/:projectId/monitor/on-create",
    );
  });

  test("is the worker's step for every model that has it", () => {
    let checked: number = 0;

    for (const service of Services) {
      if (!(service instanceof DatabaseService)) {
        continue;
      }

      const model: BaseModel = service.getModel();

      if (!hasCreateOrUpdateTrigger(model.enableWorkflowOn)) {
        continue;
      }

      const step: unknown =
        RuntimeComponents[getCreateOrUpdateTriggerId(model.tableName!)];

      expect({
        table: model.tableName,
        isIt: step instanceof OnCreateOrUpdateBaseModel,
      }).toEqual({
        table: model.tableName,
        isIt: true,
      });
      checked++;
    }

    expect(checked).toBeGreaterThan(100);
    expect(RuntimeComponents[CREATE_OR_UPDATE]).toBeInstanceOf(
      OnCreateOrUpdateBaseModel,
    );
  });

  test("the On Create and On Update steps on the worker know it, On Delete does not", () => {
    expect(
      (RuntimeComponents[ON_CREATE] as OnTriggerBaseModel<never>)
        .createOrUpdateTriggerId,
    ).toBe(CREATE_OR_UPDATE);
    expect(
      (RuntimeComponents[ON_UPDATE] as OnTriggerBaseModel<never>)
        .createOrUpdateTriggerId,
    ).toBe(CREATE_OR_UPDATE);
    expect(
      (RuntimeComponents[ON_DELETE] as OnTriggerBaseModel<never>)
        .createOrUpdateTriggerId,
    ).toBeNull();
    expect(
      (RuntimeComponents[CREATE_OR_UPDATE] as OnTriggerBaseModel<never>)
        .createOrUpdateTriggerId,
    ).toBeNull();
  });
});

describe("a run", () => {
  const STEP_PROPS: DatabaseCommonInteractionProps = {
    tenantId: new ObjectID(PROJECT_ID),
  };

  function trigger(record: Monitor | null): {
    step: OnCreateOrUpdateBaseModel<Monitor>;
    findOneById: ReturnType<typeof getJestSpyOn>;
  } {
    const service: DatabaseService<Monitor> = new DatabaseService<Monitor>(
      Monitor,
    );
    const findOneById: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      service,
      "findOneById",
    ).mockResolvedValue(record as never);
    const step: OnCreateOrUpdateBaseModel<Monitor> =
      new OnCreateOrUpdateBaseModel<Monitor>(service);

    getJestSpyOn(
      step as unknown as { getStepProps: () => unknown },
      "getStepProps",
    ).mockResolvedValue(STEP_PROPS as never);

    return { step, findOneById };
  }

  function options(lines: Array<string>): RunOptions {
    return {
      log: ((line: unknown): void => {
        lines.push(typeof line === "string" ? line : JSON.stringify(line));
      }) as RunOptions["log"],
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: new ObjectID(PROJECT_ID),
      onError: ((exception: Exception): Exception => {
        return exception;
      }) as RunOptions["onError"],
      executeWorkflow: async (): Promise<void> => {},
    };
  }

  function stored(): Monitor {
    const monitor: Monitor = new Monitor();
    monitor._id = RECORD_ID;
    monitor.name = "Checkout API";
    return monitor;
  }

  test("started by an update hands on the record, read with its fields, and updated", async () => {
    const { step, findOneById } = trigger(stored());

    const result: RunReturnType = await step.run(
      {
        data: { _id: RECORD_ID },
        select: { name: true },
        [WHAT_HAPPENED_ID]: "updated",
      },
      options([]),
    );

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues[WHAT_HAPPENED_ID]).toBe("updated");
    expect((result.returnValues["model"] as JSONObject)["name"]).toBe(
      "Checkout API",
    );

    const read: { id: ObjectID; select: JSONObject; props: unknown } =
      findOneById.mock.calls[0]![0] as {
        id: ObjectID;
        select: JSONObject;
        props: unknown;
      };

    expect(read.id.toString()).toBe(RECORD_ID);
    expect(read.select).toEqual({ _id: true, name: true });
    // As a Project Admin of the workflow's project, like every record step.
    expect(read.props).toBe(STEP_PROPS);
  });

  test("started by a create hands on created", async () => {
    const { step } = trigger(stored());

    const result: RunReturnType = await step.run(
      {
        data: { _id: RECORD_ID },
        select: { name: true },
        [WHAT_HAPPENED_ID]: "created",
      },
      options([]),
    );

    expect(result.returnValues[WHAT_HAPPENED_ID]).toBe("created");
  });

  test("started from Run Workflow: the record by its ID, and What Happened as asked, in any case", async () => {
    const { step, findOneById } = trigger(stored());

    const result: RunReturnType = await step.run(
      {
        _id: RECORD_ID,
        select: { name: true },
        [WHAT_HAPPENED_ID]: " Updated ",
      },
      options([]),
    );

    expect(result.returnValues[WHAT_HAPPENED_ID]).toBe("updated");
    expect(
      (findOneById.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(RECORD_ID);
  });

  test("asked nothing, a run is for a create, as an empty choice is its first", async () => {
    const { step } = trigger(stored());

    const result: RunReturnType = await step.run(
      { _id: RECORD_ID, select: { name: true } },
      options([]),
    );

    expect(result.returnValues[WHAT_HAPPENED_ID]).toBe("created");
  });

  test.each([
    ["another word", "deleted"],
    ["a number", 3],
    ["an object", { created: true }],
  ] as Array<[string, unknown]>)(
    "asked %s, the run stops before reading anything, saying what it may be",
    async (_label: string, value: unknown) => {
      const { step, findOneById } = trigger(stored());

      await expect(
        step.run(
          {
            _id: RECORD_ID,
            select: { name: true },
            [WHAT_HAPPENED_ID]: value as JSONObject,
          },
          options([]),
        ),
      ).rejects.toThrow(/^What Happened must be "created" or "updated", not "/);
      expect(findOneById).not.toHaveBeenCalled();
    },
  );

  test("with nothing to read, it still says what happened", async () => {
    const { step, findOneById } = trigger(stored());

    const result: RunReturnType = await step.run(
      { data: { _id: RECORD_ID }, [WHAT_HAPPENED_ID]: "updated" },
      options([]),
    );

    expect(findOneById).not.toHaveBeenCalled();
    expect(result.returnValues[WHAT_HAPPENED_ID]).toBe("updated");
    expect((result.returnValues["model"] as JSONObject)["_id"]).toBe(RECORD_ID);
  });

  test("a record that is gone fails the run, as On Update's does", async () => {
    const { step } = trigger(null);

    await expect(
      step.run(
        {
          data: { _id: RECORD_ID },
          select: { name: true },
          [WHAT_HAPPENED_ID]: "updated",
        },
        options([]),
      ),
    ).rejects.toThrow(`Model not found with id ${RECORD_ID}`);
  });
});
