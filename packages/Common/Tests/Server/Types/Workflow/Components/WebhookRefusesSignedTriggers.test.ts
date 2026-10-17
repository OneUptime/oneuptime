/*
 * The Webhook trigger's URL (…/workflow/trigger/<key>) starts the workflow
 * that key belongs to, with whatever the caller sent, and checks no
 * signature. A Huntress workflow's key is the last part of its own URL too
 * (…/workflow/huntress/<key>), whose whole point is that only a request
 * Huntress signed starts it - so the Webhook URL must refuse a Huntress
 * workflow, or anyone with the key could start it with made-up reports and
 * open, page and resolve incidents. Every other workflow it starts as
 * before.
 *
 * WorkflowService is spied on, so no database is touched.
 */

jest.mock("isolated-vm", () => {
  return {};
});

import WorkflowService from "../../../../../Server/Services/WorkflowService";
import WebhookTrigger, {
  SIGNED_WEBHOOK_TRIGGER_IDS,
  SIGNED_WEBHOOK_WORKFLOW_MESSAGE,
} from "../../../../../Server/Types/Workflow/Components/Webhook";
import {
  ExecuteWorkflowType,
  InitProps,
} from "../../../../../Server/Types/Workflow/TriggerCode";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../../../Server/Utils/Express";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const WORKFLOW_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> | void;

let routes: Record<string, Handler>;
let started: Array<ExecuteWorkflowType>;
let triggerId: string | undefined;

function fakeRouter(): ExpressRouter {
  return {
    get: (uri: string, handler: Handler): void => {
      routes[`GET ${uri}`] = handler;
    },
    post: (uri: string, handler: Handler): void => {
      routes[`POST ${uri}`] = handler;
    },
  } as unknown as ExpressRouter;
}

// Calls the route as Express would; what it passed to next(), if anything.
async function call(method: "GET" | "POST"): Promise<unknown> {
  const handler: Handler | undefined = routes[`${method} /trigger/:secretkey`];

  if (!handler) {
    throw new Error(`The Webhook trigger registered no ${method} route.`);
  }

  let passedOn: unknown = null;

  await handler(
    {
      params: { secretkey: "a-secret-key" },
      headers: { "content-type": "application/json" },
      query: {},
      body: { event: "created", "report-id": "1234" },
    } as unknown as ExpressRequest,
    {
      headersSent: false,
      status: () => {
        return {
          send: (): void => {},
        };
      },
      send: (): void => {},
    } as unknown as ExpressResponse,
    ((err: unknown): void => {
      passedOn = err;
    }) as NextFunction,
  );

  return passedOn;
}

beforeEach(async () => {
  routes = {};
  started = [];
  triggerId = ComponentID.Webhook;

  jest.spyOn(WorkflowService, "findOneBy").mockImplementation((async (findBy: {
    select: Record<string, boolean>;
  }): Promise<Workflow> => {
    // The trigger is read with the workflow, to tell which it is.
    expect(findBy.select["triggerId"]).toBe(true);

    const workflow: Workflow = new Workflow();
    workflow._id = WORKFLOW_ID;

    if (triggerId) {
      workflow.triggerId = triggerId;
    }

    return workflow;
  }) as never);

  const props: InitProps = {
    router: fakeRouter(),
    executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
      started.push(run);
    },
    scheduleWorkflow: async (): Promise<void> => {},
    removeWorkflow: async (): Promise<void> => {},
  };

  await new WebhookTrigger().init(props);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the Webhook URL", () => {
  test("knows Huntress's trigger as one that signs its requests", () => {
    expect(SIGNED_WEBHOOK_TRIGGER_IDS).toEqual([
      ComponentID.HuntressIncidentReport,
    ]);
    expect(SIGNED_WEBHOOK_WORKFLOW_MESSAGE).toContain("Huntress trigger");
  });

  test.each(["GET", "POST"] as const)(
    "%s refuses a Huntress workflow, and starts nothing",
    async (method: "GET" | "POST") => {
      triggerId = ComponentID.HuntressIncidentReport;

      const passedOn: unknown = await call(method);

      expect(passedOn).toBeInstanceOf(BadDataException);
      expect((passedOn as Error).message).toBe(SIGNED_WEBHOOK_WORKFLOW_MESSAGE);
      expect(started).toHaveLength(0);
    },
  );

  test.each([ComponentID.Webhook, ComponentID.Manual, undefined])(
    "still starts a workflow whose trigger is %s",
    async (id: string | undefined) => {
      triggerId = id;

      const passedOn: unknown = await call("POST");

      expect(passedOn).toBeNull();
      expect(started).toHaveLength(1);
      expect(started[0]!.workflowId.toString()).toBe(WORKFLOW_ID);
    },
  );
});
