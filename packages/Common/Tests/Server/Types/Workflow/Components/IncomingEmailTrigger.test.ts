/*
 * The Incoming Email trigger on the workflow service: where an email for a
 * workflow address becomes a run, or does not.
 *
 * What has to hold, because the address is the only thing that says which
 * workflow an email is for:
 *
 *   - the workflow is found by the key in the address, and only by it - so a
 *     key starts the one workflow it belongs to, in its own project, whatever
 *     the email says;
 *   - a workflow that is off, or whose trigger is no longer Incoming Email,
 *     starts nothing;
 *   - the run is handed every value the trigger promises, with the key masked
 *     wherever the email quotes the address, because the run's log is open to
 *     read-only roles;
 *   - only the ingest worker, with the cluster key, can hand an email over.
 *
 * WorkflowService is spied on, so no database is touched.
 */

jest.mock("isolated-vm", () => {
  return {};
});

import ClusterKeyAuthorization from "../../../../../Server/Middleware/ClusterKeyAuthorization";
import WorkflowService from "../../../../../Server/Services/WorkflowService";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import IncomingEmailWorkflowTrigger from "../../../../../Server/Types/Workflow/Components/IncomingEmail";
import TriggerCode, {
  ExecuteWorkflowType,
} from "../../../../../Server/Types/Workflow/TriggerCode";
import Response from "../../../../../Server/Utils/Response";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import {
  INCOMING_EMAIL_TRIGGER_DELIVERY_PATH,
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
import getJestMockFunction, { MockFunction } from "../../../../MockType";

const DOMAIN: string = "inbound.oneuptime.example";

const KEY_A: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const KEY_B: string = "0f8fad5b-d9cb-469f-a165-70867728950e";

const WORKFLOW_A: string = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const WORKFLOW_B: string = "6ba7b811-9dad-41d1-80b4-00c04fd430c8";
const PROJECT_A: string = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const PROJECT_B: string = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

const ADDRESS_A: string = `workflow-${KEY_A}@${DOMAIN}`;

const RECEIVED_AT: string = "2026-10-01T08:30:00.000Z";

interface StoredWorkflow {
  _id: string;
  projectId: string;
  key: string;
  triggerId: string;
  isEnabled: boolean;
}

let stored: Array<StoredWorkflow> = [];

const workflowRow: (row: StoredWorkflow) => Workflow = (
  row: StoredWorkflow,
): Workflow => {
  const workflow: Workflow = new Workflow();
  workflow._id = row._id;
  workflow.projectId = new ObjectID(row.projectId);
  workflow.triggerId = row.triggerId;
  workflow.isEnabled = row.isEnabled;

  return workflow;
};

let findOneBy: SpyInstance;

const email: (
  overrides?: Partial<IncomingEmailTriggerEmail>,
) => IncomingEmailTriggerEmail = (
  overrides?: Partial<IncomingEmailTriggerEmail>,
): IncomingEmailTriggerEmail => {
  return {
    from: "alerts@vendor.example",
    to: [ADDRESS_A, "ops@acme.example"],
    cc: [],
    subject: "Disk space low on db-1",
    body: `Only 4% left. Reply to ${ADDRESS_A} to acknowledge.`,
    htmlBody: `<p>Only 4% left.</p><p><a href="mailto:${ADDRESS_A}">Acknowledge</a></p>`,
    headers: {
      To: `Ops <${ADDRESS_A}>`,
      "Delivered-To": ADDRESS_A,
      Received: `from mx.vendor.example by mx.sendgrid.net for <${ADDRESS_A.toUpperCase()}>`,
      "Message-ID": "<abc@vendor.example>",
    },
    attachments: [
      { filename: "graph.png", contentType: "image/png", size: 2048 },
    ],
    receivedAt: RECEIVED_AT,
    ...(overrides || {}),
  };
};

type DeliverFunction = (data: {
  secretKey: unknown;
  email?: unknown;
}) => Promise<{
  status: IncomingEmailTriggerDeliveryStatus;
  runs: Array<ExecuteWorkflowType>;
}>;

const trigger: IncomingEmailWorkflowTrigger =
  new IncomingEmailWorkflowTrigger();

const deliver: DeliverFunction = async (data: {
  secretKey: unknown;
  email?: unknown;
}): Promise<{
  status: IncomingEmailTriggerDeliveryStatus;
  runs: Array<ExecuteWorkflowType>;
}> => {
  const runs: Array<ExecuteWorkflowType> = [];

  const status: IncomingEmailTriggerDeliveryStatus = await trigger.deliverEmail(
    {
      secretKey: data.secretKey,
      email: "email" in data ? data.email : email(),
      executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
        runs.push(run);
      },
    },
  );

  return { status, runs };
};

beforeEach(() => {
  stored = [
    {
      _id: WORKFLOW_A,
      projectId: PROJECT_A,
      key: KEY_A,
      triggerId: ComponentID.IncomingEmail,
      isEnabled: true,
    },
    {
      _id: WORKFLOW_B,
      projectId: PROJECT_B,
      key: KEY_B,
      triggerId: ComponentID.IncomingEmail,
      isEnabled: true,
    },
  ];

  /*
   * What the database would answer: the one row whose key is the key asked
   * for. The query is read back, so a lookup by anything else finds nothing.
   */
  findOneBy = jest
    .spyOn(WorkflowService, "findOneBy")
    .mockImplementation((async (args: {
      query: Record<string, unknown>;
    }): Promise<Workflow | null> => {
      const key: unknown = args.query["incomingEmailSecretKey"];

      if (Object.keys(args.query).length !== 1 || !(key instanceof ObjectID)) {
        return null;
      }

      const row: StoredWorkflow | undefined = stored.find(
        (candidate: StoredWorkflow) => {
          return candidate.key === key.toString();
        },
      );

      return row ? workflowRow(row) : null;
    }) as never) as unknown as SpyInstance;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an email for a workflow's address", () => {
  test("starts one run of the workflow that owns the key", async () => {
    const { status, runs } = await deliver({ secretKey: KEY_A });

    expect(status).toBe(IncomingEmailTriggerDeliveryStatus.Scheduled);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.workflowId.toString()).toBe(WORKFLOW_A);
  });

  test("the workflow is looked up by its key alone, as root", async () => {
    await deliver({ secretKey: KEY_A });

    expect(findOneBy).toHaveBeenCalledTimes(1);

    const args: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = findOneBy.mock.calls[0]![0] as never;

    expect(Object.keys(args.query)).toEqual(["incomingEmailSecretKey"]);
    expect((args.query["incomingEmailSecretKey"] as ObjectID).toString()).toBe(
      KEY_A,
    );
    expect(args.props).toEqual({ isRoot: true });
    expect(args.select).toEqual(
      expect.objectContaining({
        _id: true,
        triggerId: true,
        isEnabled: true,
      }),
    );
  });

  test("a key in upper case finds the same workflow", async () => {
    const { runs } = await deliver({ secretKey: KEY_A.toUpperCase() });

    expect(runs[0]!.workflowId.toString()).toBe(WORKFLOW_A);
  });

  test("the run starts with every value, mapped from the email", async () => {
    const { runs } = await deliver({ secretKey: KEY_A });
    const values: JSONObject = runs[0]!.returnValues;

    expect(Object.keys(values).sort()).toEqual(
      [
        "attachments",
        "body",
        "cc",
        "from",
        "headers",
        "html-body",
        "received-at",
        "subject",
        "to",
      ].sort(),
    );
    expect(values["from"]).toBe("alerts@vendor.example");
    expect(values["subject"]).toBe("Disk space low on db-1");
    expect(values["cc"]).toBe("");
    expect(values["received-at"]).toBe(RECEIVED_AT);
    expect(values["attachments"]).toEqual([
      { filename: "graph.png", contentType: "image/png", size: 2048 },
    ]);
    expect((values["headers"] as JSONObject)["message-id"]).toBe(
      "<abc@vendor.example>",
    );
  });

  test("the key is masked everywhere the email quotes the address", async () => {
    const { runs } = await deliver({ secretKey: KEY_A });
    const serialized: string = JSON.stringify(runs[0]!.returnValues);

    expect(serialized.toLowerCase()).not.toContain(KEY_A);
    expect(runs[0]!.returnValues["to"]).toBe(
      `workflow-[REDACTED]@${DOMAIN}, ops@acme.example`,
    );

    const headers: JSONObject = runs[0]!.returnValues["headers"] as JSONObject;

    expect(headers["delivered-to"]).toBe(`workflow-[REDACTED]@${DOMAIN}`);
    expect(headers["to"]).toBe(`Ops <workflow-[REDACTED]@${DOMAIN}>`);
    expect(headers["received"]).toContain("[REDACTED]");
    expect(runs[0]!.returnValues["body"]).toContain(
      `workflow-[REDACTED]@${DOMAIN}`,
    );
    expect(runs[0]!.returnValues["html-body"]).toContain(
      `mailto:workflow-[REDACTED]@${DOMAIN}`,
    );
  });

  test("everything that is not the key survives the masking", async () => {
    const { runs } = await deliver({ secretKey: KEY_A });

    expect(runs[0]!.returnValues["to"]).toContain("ops@acme.example");
    expect(runs[0]!.returnValues["body"]).toContain("Only 4% left.");
  });
});

describe("mail that starts nothing", () => {
  test("a workflow that is off starts no run", async () => {
    stored[0]!.isEnabled = false;

    const { status, runs } = await deliver({ secretKey: KEY_A });

    expect(status).toBe(IncomingEmailTriggerDeliveryStatus.WorkflowDisabled);
    expect(runs).toEqual([]);
  });

  test.each([
    ComponentID.Webhook,
    ComponentID.Manual,
    ComponentID.Schedule,
    "incident-on-create",
  ])(
    "a workflow whose trigger is now %p starts no run, though it still has the key",
    async (triggerId: string) => {
      stored[0]!.triggerId = triggerId;

      const { status, runs } = await deliver({ secretKey: KEY_A });

      expect(status).toBe(
        IncomingEmailTriggerDeliveryStatus.NotIncomingEmailTrigger,
      );
      expect(runs).toEqual([]);
    },
  );

  test("a key no workflow has (it was reset) starts nothing", async () => {
    const { status, runs } = await deliver({
      secretKey: "9f8e7d6c-5b4a-4321-8fed-cba987654321",
    });

    expect(status).toBe(IncomingEmailTriggerDeliveryStatus.NoWorkflow);
    expect(runs).toEqual([]);
  });

  test.each([undefined, null, "", "not-a-key", 42, { $ne: null }, [KEY_A]])(
    "a key like %p is no key, and is not even looked up",
    async (secretKey: unknown) => {
      const { status, runs } = await deliver({ secretKey });

      expect(status).toBe(IncomingEmailTriggerDeliveryStatus.NoWorkflow);
      expect(runs).toEqual([]);
      expect(findOneBy).not.toHaveBeenCalled();
    },
  );

  test("a delivery without the email is refused", async () => {
    await expect(
      deliver({ secretKey: KEY_A, email: undefined }),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(
      deliver({ secretKey: KEY_A, email: "text" }),
    ).rejects.toBeInstanceOf(BadDataException);
  });
});

describe("one project's address never starts another project's workflow", () => {
  test("each key starts its own workflow, in its own project", async () => {
    const a: { runs: Array<ExecuteWorkflowType> } = await deliver({
      secretKey: KEY_A,
    });
    const b: { runs: Array<ExecuteWorkflowType> } = await deliver({
      secretKey: KEY_B,
      email: email({ to: [`workflow-${KEY_B}@${DOMAIN}`] }),
    });

    expect(
      a.runs.map((run: ExecuteWorkflowType) => {
        return run.workflowId.toString();
      }),
    ).toEqual([WORKFLOW_A]);
    expect(
      b.runs.map((run: ExecuteWorkflowType) => {
        return run.workflowId.toString();
      }),
    ).toEqual([WORKFLOW_B]);
  });

  test("what the email says about other workflows changes nothing", async () => {
    const { runs } = await deliver({
      secretKey: KEY_A,
      email: {
        ...email({
          to: [`workflow-${KEY_B}@${DOMAIN}`],
          cc: [`workflow-${KEY_B}@${DOMAIN}`],
          headers: {
            "X-Workflow-Id": WORKFLOW_B,
            "X-Project-Id": PROJECT_B,
          },
        }),
        workflowId: WORKFLOW_B,
        projectId: PROJECT_B,
      },
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]!.workflowId.toString()).toBe(WORKFLOW_A);
    expect(Object.keys(runs[0]!)).toEqual(["workflowId", "returnValues"]);
  });

  test("the run's workflow comes from the database row, never from the request", async () => {
    stored[0]!._id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

    const { runs } = await deliver({ secretKey: KEY_A });

    expect(runs[0]!.workflowId.toString()).toBe(
      "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    );
  });

  test("another workflow's key, typed in another case, still finds only that workflow", async () => {
    const { runs } = await deliver({ secretKey: KEY_B.toUpperCase() });

    expect(runs[0]!.workflowId.toString()).toBe(WORKFLOW_B);
  });
});

describe("the route the ingest worker hands email to", () => {
  type Handler = (req: unknown, res: unknown, next: unknown) => unknown;

  const registered: () => Promise<{
    path: string;
    handlers: Array<Handler>;
    runs: Array<ExecuteWorkflowType>;
  }> = async (): Promise<{
    path: string;
    handlers: Array<Handler>;
    runs: Array<ExecuteWorkflowType>;
  }> => {
    const routes: Array<{ path: string; handlers: Array<Handler> }> = [];
    const runs: Array<ExecuteWorkflowType> = [];

    await new IncomingEmailWorkflowTrigger().init({
      router: {
        post: (path: string, ...handlers: Array<Handler>) => {
          routes.push({ path, handlers });
        },
        get: () => {
          throw new Error("The trigger registers no GET route.");
        },
      } as never,
      executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
        runs.push(run);
      },
      scheduleWorkflow: async (): Promise<void> => {},
      removeWorkflow: async (): Promise<void> => {},
    });

    expect(routes).toHaveLength(1);

    return { ...routes[0]!, runs };
  };

  test("is a POST on the delivery path", async () => {
    const route: { path: string } = await registered();

    expect(route.path).toBe(INCOMING_EMAIL_TRIGGER_DELIVERY_PATH);
    expect(INCOMING_EMAIL_TRIGGER_DELIVERY_PATH).toBe(
      "/incoming-email/deliver",
    );
  });

  test("checks the cluster key before anything else", async () => {
    const route: { handlers: Array<Handler> } = await registered();

    expect(route.handlers).toHaveLength(2);
    expect(route.handlers[0]).toBe(
      ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    );
  });

  test("hands the body's key and email to the trigger and answers with the outcome", async () => {
    const sendJson: SpyInstance = jest
      .spyOn(Response, "sendJsonObjectResponse")
      .mockImplementation((() => {
        return undefined;
      }) as never) as unknown as SpyInstance;

    const route: {
      handlers: Array<Handler>;
      runs: Array<ExecuteWorkflowType>;
    } = await registered();
    const next: MockFunction = getJestMockFunction();

    await route.handlers[1]!(
      { body: { secretKey: KEY_A, email: email() } },
      {},
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(route.runs).toHaveLength(1);
    expect(sendJson.mock.calls[0]![2]).toEqual({
      status: IncomingEmailTriggerDeliveryStatus.Scheduled,
    });
  });

  test("an outcome that starts nothing is still an answer, not an error", async () => {
    stored[0]!.isEnabled = false;

    const sendJson: SpyInstance = jest
      .spyOn(Response, "sendJsonObjectResponse")
      .mockImplementation((() => {
        return undefined;
      }) as never) as unknown as SpyInstance;

    const route: { handlers: Array<Handler> } = await registered();
    const next: MockFunction = getJestMockFunction();

    await route.handlers[1]!(
      { body: { secretKey: KEY_A, email: email() } },
      {},
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(sendJson.mock.calls[0]![2]).toEqual({
      status: IncomingEmailTriggerDeliveryStatus.WorkflowDisabled,
    });
  });

  test("a failure is passed on, so the worker's job fails and is retried", async () => {
    findOneBy.mockRejectedValue(new Error("database is down") as never);

    const route: { handlers: Array<Handler> } = await registered();
    const next: MockFunction = getJestMockFunction();

    await route.handlers[1]!(
      { body: { secretKey: KEY_A, email: email() } },
      {},
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0]![0] as Error).message).toBe("database is down");
  });
});

describe("the step itself, when a run reaches it", () => {
  const options: () => RunOptions = (): RunOptions => {
    return {
      log: () => {},
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      onError: (exception: Exception): Exception => {
        return exception;
      },
      executeWorkflow: async (): Promise<void> => {},
    };
  };

  test("is a trigger", () => {
    expect(trigger).toBeInstanceOf(TriggerCode);
    expect(trigger.getMetadata().id).toBe(ComponentID.IncomingEmail);
  });

  test("goes on through Out, with the values it was started with", async () => {
    const result: RunReturnType = await trigger.run(
      {
        from: "alerts@vendor.example",
        to: "ops@acme.example",
        cc: "",
        subject: "Disk space low",
        body: "Only 4% left.",
        "html-body": "",
        headers: { "message-id": "<abc@vendor.example>" },
        attachments: [],
        "received-at": RECEIVED_AT,
      },
      options(),
    );

    expect(result.executePort?.id).toBe("out");
    expect(result.returnValues["subject"]).toBe("Disk space low");
    expect(result.returnValues["received-at"]).toBe(RECEIVED_AT);
  });

  test("a test run from Run Workflow gets every value too", async () => {
    const result: RunReturnType = await trigger.run(
      { from: "alerts@vendor.example", subject: "Test", body: "Hello" },
      options(),
    );

    expect(result.returnValues).toEqual(
      expect.objectContaining({
        from: "alerts@vendor.example",
        to: "",
        cc: "",
        subject: "Test",
        body: "Hello",
        "html-body": "",
        headers: {},
        attachments: [],
      }),
    );
    expect(
      new Date(result.returnValues["received-at"] as string).getTime(),
    ).not.toBeNaN();
  });
});
