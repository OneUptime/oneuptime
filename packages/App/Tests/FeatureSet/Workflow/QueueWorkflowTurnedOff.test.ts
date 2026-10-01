/*
 * A workflow that is turned off does not run, however it is started - and
 * the refusal says how to turn it on.
 *
 * "When workflow is not enabled, it doesnt tell me how to enable this
 * workflow." The refusal used to be "This workflow is not enabled". It is
 * read in the Builder (which now asks before sending a run, see
 * UseWorkflowEnabled), and in places nothing else explains it: a webhook
 * sender's delivery log, a script calling the workflow's URL. So the
 * message itself says what to do and where.
 *
 * The rule is unchanged and pinned here too: nothing is queued, no run log is
 * written and no plan check is spent on a workflow that is off.
 */

import ComponentCodeAPI from "../../../FeatureSet/Workflow/API/ComponentCode";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import Queue from "Common/Server/Infrastructure/Queue";
import ProjectService from "Common/Server/Services/ProjectService";
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
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { WORKFLOW_TURNED_OFF_MESSAGE } from "Common/Types/Workflow/WorkflowEnabled";
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

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

interface Spies {
  findWorkflow: RecordedSpy;
  createLog: RecordedSpy;
  addJob: RecordedSpy;
  getPlan: RecordedSpy;
  findVariables: RecordedSpy;
}

type PrepareFunction = (isEnabled: boolean) => Spies;

// A workflow row as QueueWorkflow reads it, and the parts of a run it touches.
const prepare: PrepareFunction = (isEnabled: boolean): Spies => {
  const workflowRow: Workflow = new Workflow();
  workflowRow._id = WORKFLOW_ID.toString();
  workflowRow.isEnabled = isEnabled;
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
    .mockResolvedValue({
      plan: null,
      isSubscriptionUnpaid: false,
    } as never) as unknown as RecordedSpy;

  const findVariables: RecordedSpy = jest
    .spyOn(WorkflowVariableService as never, "findBy")
    .mockResolvedValue([] as never) as unknown as RecordedSpy;

  return { findWorkflow, createLog, addJob, getPlan, findVariables };
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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("QueueWorkflow.addWorkflowToQueue on a workflow that is off", () => {
  test("refuses with a 400 that says how to turn the workflow on", async () => {
    prepare(false);

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
      "This workflow is turned off, so it can't run. Turn it on with the Enabled switch at the top of its Builder, then try again.",
    );
  });

  test("queues nothing, writes no run log and spends no plan check", async () => {
    const spies: Spies = prepare(false);

    await caught(
      QueueWorkflow.addWorkflowToQueue({
        workflowId: WORKFLOW_ID,
        returnValues: {},
      }),
    );

    expect(spies.addJob.mock.calls).toHaveLength(0);
    expect(spies.createLog.mock.calls).toHaveLength(0);
    expect(spies.getPlan.mock.calls).toHaveLength(0);
  });

  test("Run just this step is refused the same way", async () => {
    const spies: Spies = prepare(false);

    const error: unknown = await caught(
      QueueWorkflow.addWorkflowToQueue({
        workflowId: WORKFLOW_ID,
        returnValues: {},
        runOnlyComponentId: "if-else-1",
      }),
    );

    expect((error as Error).message).toBe(WORKFLOW_TURNED_OFF_MESSAGE);
    expect(spies.addJob.mock.calls).toHaveLength(0);
  });

  test("a schedule is refused before its variables are even read", async () => {
    const spies: Spies = prepare(false);

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

  test("it reads whether the workflow is on, as root, from the row itself", async () => {
    const spies: Spies = prepare(false);

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

describe("QueueWorkflow.addWorkflowToQueue on a workflow that is on", () => {
  test("queues the run, as before", async () => {
    const spies: Spies = prepare(true);

    await QueueWorkflow.addWorkflowToQueue({
      workflowId: WORKFLOW_ID,
      returnValues: { value: "Hello" },
    });

    expect(spies.createLog.mock.calls).toHaveLength(1);
    expect(spies.addJob.mock.calls).toHaveLength(1);
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

  type CallWebhookFunction = (method: "GET" | "POST") => Promise<{
    error: unknown;
    recorded: RecordedResponse;
  }>;

  const callWebhook: CallWebhookFunction = async (
    method: "GET" | "POST",
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
      body: { service: "checkout" },
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

    // The error handler logs every refusal; that is not under test here.
    jest.spyOn(logger, "error").mockImplementation((): void => {
      // Quiet.
    });

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
      const spies: Spies = prepare(false);

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

  test("a workflow that is on is scheduled, as before", async () => {
    const spies: Spies = prepare(true);

    const result: { error: unknown; recorded: RecordedResponse } =
      await callWebhook("POST");

    expect(result.error).toBeNull();
    expect(result.recorded.body).toEqual({ status: "Scheduled" });
    expect(spies.addJob.mock.calls).toHaveLength(1);
  });
});
