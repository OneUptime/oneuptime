/*
 * A workflow that is turned off is started by nothing but a person - and a
 * person testing it from the Builder may run it, as a test run.
 *
 * "Run - Why do I have to enable a workflow in order to test run it? Can you
 * please fix it?" - the maintainer. Off used to refuse every run, Run
 * Workflow and Run just this step included, so trying a workflow out meant
 * turning it on and letting its trigger loose. Now:
 *
 *   - a run a person starts from the Builder (the two routes pass
 *     startedByUserId) goes ahead while the workflow is off, as a test run:
 *     its log row says so, names who started it, and its log opens with a
 *     line that says both; the job tells the runner so too;
 *   - everything that starts a workflow without a person - its webhook URL
 *     (below, through the real route), and its schedule, OneUptime events,
 *     incoming email and other workflows' Execute Workflow steps, none of
 *     which passes a person - is refused as before, and the refusal says the
 *     trigger can't start it and how to turn it on;
 *   - a workflow that is on runs as before, and a person's run of it records
 *     who started it but is no test.
 */

import ComponentCodeAPI from "../../../FeatureSet/Workflow/API/ComponentCode";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import User from "Common/Models/DatabaseModels/User";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import Queue from "Common/Server/Infrastructure/Queue";
import ProjectService from "Common/Server/Services/ProjectService";
import UserService from "Common/Server/Services/UserService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import WorkflowVariableService from "Common/Server/Services/WorkflowVariableService";
import WebhookTrigger from "Common/Server/Types/Workflow/Components/Webhook";
import { InitProps } from "Common/Server/Types/Workflow/TriggerCode";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Email from "Common/Types/Email";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import {
  WORKFLOW_TURNED_OFF_MESSAGE,
  getWorkflowTestRunLogLine,
} from "Common/Types/Workflow/WorkflowEnabled";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const PERSON_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

// "2026-10-12 10:00:01: <line>", as every run log line is stamped.
const STAMPED_LINE: RegExp = /^.+?: (.*)$/;

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

interface Spies {
  findWorkflow: RecordedSpy;
  createLog: RecordedSpy;
  addJob: RecordedSpy;
  getPlan: RecordedSpy;
  findVariables: RecordedSpy;
  findUser: RecordedSpy;
  countRuns: RecordedSpy;
}

interface PrepareOptions {
  isEnabled: boolean;
  // Who the person is, as UserService reads them; null when they are gone.
  person?: { name?: string; email?: string } | null | "throws";
  plan?: { plan: PlanType | null; isSubscriptionUnpaid: boolean };
  runsThisMonth?: number;
}

type PrepareFunction = (options: PrepareOptions) => Spies;

// A workflow row as QueueWorkflow reads it, and the parts of a run it touches.
const prepare: PrepareFunction = (options: PrepareOptions): Spies => {
  const workflowRow: Workflow = new Workflow();
  workflowRow._id = WORKFLOW_ID.toString();
  workflowRow.isEnabled = options.isEnabled;
  workflowRow.projectId = PROJECT_ID;

  const findWorkflow: RecordedSpy = jest
    .spyOn(WorkflowService as never, "findOneById")
    .mockResolvedValue(workflowRow as never) as unknown as RecordedSpy;

  const runLog: WorkflowLog = new WorkflowLog();
  runLog._id = "88888888-8888-4888-8888-888888888888";

  const createLog: RecordedSpy = jest
    .spyOn(WorkflowLogService as never, "create")
    .mockResolvedValue(runLog as never) as unknown as RecordedSpy;

  const addJob: RecordedSpy = jest
    .spyOn(Queue as never, "addJob")
    .mockResolvedValue({} as never) as unknown as RecordedSpy;

  const getPlan: RecordedSpy = jest
    .spyOn(ProjectService as never, "getCurrentPlan")
    .mockResolvedValue(
      (options.plan || {
        plan: null,
        isSubscriptionUnpaid: false,
      }) as never,
    ) as unknown as RecordedSpy;

  const countRuns: RecordedSpy = jest
    .spyOn(WorkflowLogService as never, "countBy")
    .mockResolvedValue(
      new PositiveNumber(options.runsThisMonth || 0) as never,
    ) as unknown as RecordedSpy;

  const findVariables: RecordedSpy = jest
    .spyOn(WorkflowVariableService as never, "findBy")
    .mockResolvedValue([] as never) as unknown as RecordedSpy;

  const person: PrepareOptions["person"] =
    options.person === undefined ? { name: "Ada Lovelace" } : options.person;

  let user: User | null = null;

  if (person && person !== "throws") {
    user = new User();
    user._id = PERSON_ID.toString();

    if (person.name !== undefined) {
      user.name = new Name(person.name);
    }

    if (person.email !== undefined) {
      user.email = new Email(person.email);
    }
  }

  const findUser: RecordedSpy = (
    person === "throws"
      ? jest
          .spyOn(UserService as never, "findOneById")
          .mockRejectedValue(new Error("database down") as never)
      : jest
          .spyOn(UserService as never, "findOneById")
          .mockResolvedValue(user as never)
  ) as unknown as RecordedSpy;

  return {
    findWorkflow,
    createLog,
    addJob,
    getPlan,
    findVariables,
    findUser,
    countRuns,
  };
};

type CaughtFunction = (promise: Promise<unknown>) => Promise<unknown>;

const caught: CaughtFunction = async (
  promise: Promise<unknown>,
): Promise<unknown> => {
  try {
    await promise;
  } catch (err) {
    return err;
  }

  throw new Error("Expected the run to be refused.");
};

// The run log row QueueWorkflow wrote.
const createdLog: (spies: Spies) => WorkflowLog = (
  spies: Spies,
): WorkflowLog => {
  expect(spies.createLog.mock.calls).toHaveLength(1);

  return (spies.createLog.mock.calls[0]![0] as { data: WorkflowLog }).data;
};

// Its log, one line per entry, without the time each line is stamped with.
const logLines: (log: WorkflowLog) => Array<string> = (
  log: WorkflowLog,
): Array<string> => {
  return String(log.logs || "")
    .split("\n")
    .map((line: string): string => {
      return line.match(STAMPED_LINE)?.[1] ?? line;
    });
};

// What the job tells the runner.
const jobData: (spies: Spies) => JSONObject = (spies: Spies): JSONObject => {
  expect(spies.addJob.mock.calls).toHaveLength(1);

  return spies.addJob.mock.calls[0]![3] as JSONObject;
};

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    // A refused lookup is logged; that is not under test here.
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a person's run of a workflow that is off: a test run", () => {
  test("Run Workflow is queued, not refused", async () => {
    const spies: Spies = prepare({ isEnabled: false });

    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: { value: "Hello" },
      startedByUserId: PERSON_ID,
    });

    expect(spies.createLog.mock.calls).toHaveLength(1);
    expect(spies.addJob.mock.calls).toHaveLength(1);
    expect(jobData(spies)["data"]).toEqual({ value: "Hello" });
  });

  test("its run log row is marked a test run, with who started it", async () => {
    const spies: Spies = prepare({ isEnabled: false });

    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: {},
      startedByUserId: PERSON_ID,
    });

    const log: WorkflowLog = createdLog(spies);

    expect(log.isTestRun).toBe(true);
    expect(log.startedByUserId?.toString()).toBe(PERSON_ID.toString());
    expect(log.workflowId?.toString()).toBe(WORKFLOW_ID.toString());
    expect(log.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(log.workflowStatus).toBe(WorkflowStatus.Scheduled);
  });

  test("its log opens with the line that says it is a test run, and who started it", async () => {
    const spies: Spies = prepare({ isEnabled: false });

    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: {},
      startedByUserId: PERSON_ID,
    });

    expect(logLines(createdLog(spies))).toEqual([
      "Test run, started by Ada Lovelace while this workflow is turned off.",
      `Workflow ${WORKFLOW_ID.toString()} Scheduled.`,
    ]);
    // Every line is stamped with the time, as the runner stamps its own.
    for (const line of String(createdLog(spies).logs).split("\n")) {
      expect(line).toMatch(STAMPED_LINE);
      expect(line).not.toMatch(/^Test run|^Workflow/);
    }
  });

  test("the job tells the runner it is a test run, and who started it", async () => {
    const spies: Spies = prepare({ isEnabled: false });

    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: {},
      startedByUserId: PERSON_ID,
    });

    expect(jobData(spies)).toMatchObject({
      workflowId: WORKFLOW_ID.toString(),
      workflowLogId: "88888888-8888-4888-8888-888888888888",
      isTestRun: true,
      testRunStartedBy: "Ada Lovelace",
    });
  });

  test("Run just this step is a test run too, of that one step", async () => {
    const spies: Spies = prepare({ isEnabled: false });

    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: {},
      runOnlyComponentId: "if-else-1",
      startedByUserId: PERSON_ID,
    });

    expect(createdLog(spies).isTestRun).toBe(true);
    expect(jobData(spies)).toMatchObject({
      runOnlyComponentId: "if-else-1",
      isTestRun: true,
    });
  });

  test("the person is read as OneUptime, for their name only", async () => {
    const spies: Spies = prepare({ isEnabled: false });

    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: {},
      startedByUserId: PERSON_ID,
    });

    expect(spies.findUser.mock.calls).toHaveLength(1);

    const query: { id: ObjectID; select: JSONObject; props: JSONObject } = spies
      .findUser.mock.calls[0]![0] as never;

    expect(query.id.toString()).toBe(PERSON_ID.toString());
    expect(query.select).toEqual({ name: true, email: true });
    expect(query.props["isRoot"]).toBe(true);
  });

  test("a person with no name is named by their email", async () => {
    const spies: Spies = prepare({
      isEnabled: false,
      person: { email: "ada@example.com" },
    });

    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: {},
      startedByUserId: PERSON_ID,
    });

    expect(logLines(createdLog(spies))[0]).toBe(
      "Test run, started by ada@example.com while this workflow is turned off.",
    );
    expect(jobData(spies)["testRunStartedBy"]).toBe("ada@example.com");
  });

  test.each([
    ["is gone", null],
    ["cannot be read", "throws"],
  ] as const)(
    "a person who %s still gets their run: started by hand",
    async (_why: string, person: null | "throws") => {
      const spies: Spies = prepare({ isEnabled: false, person: person });

      await QueueWorkflow.addWorkflowToQueue({
        workflowId: WORKFLOW_ID,
        returnValues: {},
        startedByUserId: PERSON_ID,
      });

      expect(logLines(createdLog(spies))[0]).toBe(
        "Test run, started by hand while this workflow is turned off.",
      );
      expect(createdLog(spies).startedByUserId?.toString()).toBe(
        PERSON_ID.toString(),
      );
      expect(jobData(spies)["isTestRun"]).toBe(true);
      expect(jobData(spies)["testRunStartedBy"]).toBeNull();
    },
  );

  test("a name the person typed over several lines stays on one line of the log", async () => {
    const spies: Spies = prepare({
      isEnabled: false,
      person: {
        name: "Ada\n2026-10-12 10:00:00: Workflow finished\r\nLovelace",
      },
    });

    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: {},
      startedByUserId: PERSON_ID,
    });

    const lines: Array<string> = String(createdLog(spies).logs).split("\n");

    // Still two lines: the name forged none of its own.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(
      "started by Ada 2026-10-12 10:00:00: Workflow finished Lovelace while",
    );
  });

  test("the plan still counts it: an unpaid subscription records it, marked, and runs nothing", async () => {
    const spies: Spies = prepare({
      isEnabled: false,
      plan: { plan: null, isSubscriptionUnpaid: true },
    });

    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: {},
      startedByUserId: PERSON_ID,
    });

    const log: WorkflowLog = createdLog(spies);

    expect(log.workflowStatus).toBe(WorkflowStatus.WorkflowCountExceeded);
    expect(log.isTestRun).toBe(true);
    expect(log.startedByUserId?.toString()).toBe(PERSON_ID.toString());
    expect(logLines(log)).toEqual([
      "Test run, started by Ada Lovelace while this workflow is turned off.",
      "Workflow cannot run because subscription is unpaid.",
    ]);
    expect(spies.addJob.mock.calls).toHaveLength(0);
  });

  test("the plan still counts it: past the plan's runs it is recorded, marked, and runs nothing", async () => {
    const spies: Spies = prepare({
      isEnabled: false,
      plan: { plan: PlanType.Free, isSubscriptionUnpaid: false },
      runsThisMonth: 1_000_000_000,
    });

    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: {},
      startedByUserId: PERSON_ID,
    });

    const log: WorkflowLog = createdLog(spies);

    expect(log.workflowStatus).toBe(WorkflowStatus.WorkflowCountExceeded);
    expect(log.isTestRun).toBe(true);
    expect(logLines(log)[0]).toBe(
      "Test run, started by Ada Lovelace while this workflow is turned off.",
    );
    expect(logLines(log)[1]).toMatch(/^Workflow cannot run because it already ran/);
    expect(spies.addJob.mock.calls).toHaveLength(0);
  });

  test("the line is the one the shared helper words", () => {
    expect(getWorkflowTestRunLogLine({ startedBy: "Ada Lovelace" })).toBe(
      "Test run, started by Ada Lovelace while this workflow is turned off.",
    );
  });
});

describe("everything that is not a person is still refused while the workflow is off", () => {
  test("a start with no person - a trigger, an event, an email, another workflow - is refused with a 400 that says how to turn it on", async () => {
    prepare({ isEnabled: false });

    const error: unknown = await caught(
      QueueWorkflow.addWorkflowToQueue({
        workflowId: WORKFLOW_ID,
        returnValues: {},
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).code).toBe(
      ExceptionCode.BadDataException,
    );
    expect((error as BadDataException).message).toBe(
      WORKFLOW_TURNED_OFF_MESSAGE,
    );
    expect((error as BadDataException).message).toBe(
      "This workflow is turned off, so its trigger can't start it. Turn it on with the Enabled switch at the top of its Builder, then try again.",
    );
  });

  test("it queues nothing, writes no run log, spends no plan check and reads no person", async () => {
    const spies: Spies = prepare({ isEnabled: false });

    await caught(
      QueueWorkflow.addWorkflowToQueue({
        workflowId: WORKFLOW_ID,
        returnValues: {},
        callChain: ["11111111-aaaa-4aaa-8aaa-111111111111"],
      }),
    );

    expect(spies.addJob.mock.calls).toHaveLength(0);
    expect(spies.createLog.mock.calls).toHaveLength(0);
    expect(spies.getPlan.mock.calls).toHaveLength(0);
    expect(spies.findUser.mock.calls).toHaveLength(0);
  });

  test("a schedule is refused before its variables are even read", async () => {
    const spies: Spies = prepare({ isEnabled: false });

    const error: unknown = await caught(
      QueueWorkflow.addWorkflowToQueue(
        { workflowId: WORKFLOW_ID, returnValues: {} },
        "*/5 * * * *",
      ),
    );

    expect((error as Error).message).toBe(WORKFLOW_TURNED_OFF_MESSAGE);
    expect(spies.findVariables.mock.calls).toHaveLength(0);
    expect(spies.addJob.mock.calls).toHaveLength(0);
  });

  test("a schedule is never a person: one that names somebody is refused all the same", async () => {
    const spies: Spies = prepare({ isEnabled: false });

    const error: unknown = await caught(
      QueueWorkflow.addWorkflowToQueue(
        {
          workflowId: WORKFLOW_ID,
          returnValues: {},
          startedByUserId: PERSON_ID,
        },
        "*/5 * * * *",
      ),
    );

    expect((error as Error).message).toBe(WORKFLOW_TURNED_OFF_MESSAGE);
    expect(spies.addJob.mock.calls).toHaveLength(0);
  });

  test("it reads whether the workflow is on, as root, from the row itself", async () => {
    const spies: Spies = prepare({ isEnabled: false });

    await caught(
      QueueWorkflow.addWorkflowToQueue({
        workflowId: WORKFLOW_ID,
        returnValues: {},
      }),
    );

    const query: {
      id: ObjectID;
      select: JSONObject;
      props: JSONObject;
    } = spies.findWorkflow.mock.calls[0]![0] as never;

    expect(query.id.toString()).toBe(WORKFLOW_ID.toString());
    expect(query.select["isEnabled"]).toBe(true);
    expect(query.props["isRoot"]).toBe(true);
  });
});

describe("a workflow that is on", () => {
  test("a start with no person is queued as before, and is no test run", async () => {
    const spies: Spies = prepare({ isEnabled: true });

    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: { value: "Hello" },
    });

    const log: WorkflowLog = createdLog(spies);

    expect(log.isTestRun).toBe(false);
    expect(log.startedByUserId).toBeUndefined();
    expect(logLines(log)).toEqual([
      `Workflow ${WORKFLOW_ID.toString()} Scheduled.`,
    ]);
    expect(jobData(spies)).toEqual({
      data: { value: "Hello" },
      workflowLogId: "88888888-8888-4888-8888-888888888888",
      workflowId: WORKFLOW_ID.toString(),
      callChain: [],
      runOnlyComponentId: null,
    });
    expect(spies.findUser.mock.calls).toHaveLength(0);
  });

  test("a person's run records who started it, is no test run, and reads no name", async () => {
    const spies: Spies = prepare({ isEnabled: true });

    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: {},
      startedByUserId: PERSON_ID,
    });

    const log: WorkflowLog = createdLog(spies);

    expect(log.isTestRun).toBe(false);
    expect(log.startedByUserId?.toString()).toBe(PERSON_ID.toString());
    expect(logLines(log)).toEqual([
      `Workflow ${WORKFLOW_ID.toString()} Scheduled.`,
    ]);
    expect(jobData(spies)["isTestRun"]).toBeUndefined();
    expect(jobData(spies)["testRunStartedBy"]).toBeUndefined();
    expect(spies.findUser.mock.calls).toHaveLength(0);
  });
});

/*
 * A webhook call reaches QueueWorkflow through the Webhook trigger's route
 * and ComponentCodeAPI, exactly as the workflow service wires them. Whatever
 * the route throws is answered by the server's last-resort error handler, so
 * that is what the caller reads.
 */
describe("a webhook call to a workflow that is off", () => {
  type Handler = (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void> | void;

  interface RecordedResponse {
    statusCode: number | null;
    body: unknown;
  }

  let routes: Record<string, Handler> = {};

  type FakeRouterFunction = () => ExpressRouter;

  const fakeRouter: FakeRouterFunction = (): ExpressRouter => {
    return {
      get: (uri: string, handler: Handler): void => {
        routes[`GET ${uri}`] = handler;
      },
      post: (uri: string, handler: Handler): void => {
        routes[`POST ${uri}`] = handler;
      },
    } as unknown as ExpressRouter;
  };

  type FakeResponseFunction = () => {
    res: ExpressResponse;
    recorded: RecordedResponse;
  };

  const fakeResponse: FakeResponseFunction = (): {
    res: ExpressResponse;
    recorded: RecordedResponse;
  } => {
    const recorded: RecordedResponse = { statusCode: null, body: undefined };
    const res: {
      headersSent: boolean;
      status: (code: number) => unknown;
      send: (body: unknown) => unknown;
    } = {
      headersSent: false,
      status: (code: number): unknown => {
        recorded.statusCode = code;
        return res;
      },
      send: (body: unknown): unknown => {
        recorded.body = body;
        return res;
      },
    };

    return { res: res as unknown as ExpressResponse, recorded };
  };

  type CallWebhookFunction = (
    method: "GET" | "POST",
    body?: JSONObject,
  ) => Promise<{
    error: unknown;
    recorded: RecordedResponse;
  }>;

  const callWebhook: CallWebhookFunction = async (
    method: "GET" | "POST",
    body?: JSONObject,
  ): Promise<{ error: unknown; recorded: RecordedResponse }> => {
    const handler: Handler | undefined =
      routes[`${method} /trigger/:secretkey`];

    if (!handler) {
      throw new Error(`The Webhook trigger registered no ${method} route.`);
    }

    const req: ExpressRequest = {
      params: { secretkey: "a-secret-key" },
      headers: { "content-type": "application/json" },
      query: {},
      body: body || { service: "checkout" },
    } as unknown as ExpressRequest;

    const { res, recorded } = fakeResponse();

    let error: unknown = null;

    await handler(req, res, ((err: unknown): void => {
      error = err;
    }) as NextFunction);

    if (error) {
      expressErrorHandler(error as Error, req, res, (() => {
        // Headers were not sent, so the handler answers itself.
      }) as NextFunction);
    }

    return { error, recorded };
  };

  beforeEach(async () => {
    routes = {};

    // The trigger looks the workflow up by the secret key in the URL.
    const keyedWorkflow: Workflow = new Workflow();
    keyedWorkflow._id = WORKFLOW_ID.toString();

    jest
      .spyOn(WorkflowService as never, "findOneBy")
      .mockResolvedValue(keyedWorkflow as never);

    const api: ComponentCodeAPI = new ComponentCodeAPI();
    const props: InitProps = {
      router: fakeRouter(),
      executeWorkflow: api.executeWorkflow,
      scheduleWorkflow: api.scheduleWorkflow,
      removeWorkflow: api.removeWorkflow,
    };

    await new WebhookTrigger().init(props);
  });

  test.each(["GET", "POST"] as const)(
    "%s is answered 400 with how to turn the workflow on",
    async (method: "GET" | "POST") => {
      const spies: Spies = prepare({ isEnabled: false });

      const result: { error: unknown; recorded: RecordedResponse } =
        await callWebhook(method);

      expect(result.recorded.statusCode).toBe(400);
      expect(result.recorded.body).toEqual({
        error: WORKFLOW_TURNED_OFF_MESSAGE,
      });
      expect(spies.addJob.mock.calls).toHaveLength(0);
      expect(spies.createLog.mock.calls).toHaveLength(0);
    },
  );

  test("a body that names a person does not make the call a person's run", async () => {
    const spies: Spies = prepare({ isEnabled: false });

    const result: { error: unknown; recorded: RecordedResponse } =
      await callWebhook("POST", {
        startedByUserId: PERSON_ID.toString(),
        isTestRun: true,
      });

    expect(result.recorded.statusCode).toBe(400);
    expect(spies.addJob.mock.calls).toHaveLength(0);
    expect(spies.findUser.mock.calls).toHaveLength(0);
  });

  test("a workflow that is on is scheduled, as before, and is no test run", async () => {
    const spies: Spies = prepare({ isEnabled: true });

    const result: { error: unknown; recorded: RecordedResponse } =
      await callWebhook("POST");

    expect(result.error).toBeNull();
    expect(result.recorded.body).toEqual({ status: "Scheduled" });
    expect(spies.addJob.mock.calls).toHaveLength(1);
    expect(createdLog(spies).isTestRun).toBe(false);
    expect(createdLog(spies).startedByUserId).toBeUndefined();
  });
});
