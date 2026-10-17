jest.mock("../../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import Redis from "../../../../../Server/Infrastructure/Redis";
import IncidentSeverityService from "../../../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../../../Server/Services/LabelService";
import WorkflowService from "../../../../../Server/Services/WorkflowService";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import HuntressWorkflowTrigger from "../../../../../Server/Types/Workflow/Components/Huntress";
import TriggerCode, {
  ExecuteWorkflowType,
} from "../../../../../Server/Types/Workflow/TriggerCode";
import { ExpressRouter } from "../../../../../Server/Utils/Express";
import {
  expressErrorHandler,
  jsonBodyParserOptions,
} from "../../../../../Server/Utils/StartServer";
import StandardWebhookSignature from "../../../../../Server/Utils/Webhook/StandardWebhookSignature";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import Exception from "../../../../../Types/Exception/Exception";
import HuntressSeverity from "../../../../../Types/Huntress/HuntressSeverity";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import {
  HUNTRESS_DELIVERY_INDICATOR_COUNTS,
  HUNTRESS_MAX_LABEL_NAME_LENGTH,
  HUNTRESS_RUN_EVENT_PROBLEM,
  HUNTRESS_RUN_REPORT_ID_PROBLEM,
  HUNTRESS_TRIGGER_PATH,
  HuntressTriggerEvent,
  HuntressTriggerSetting,
  HuntressTriggerValue,
  getHuntressDeliveryValues,
} from "../../../../../Types/Workflow/HuntressTrigger";
import { parseHuntressWebhook } from "../../../../../Types/Huntress/HuntressWebhook";
import {
  drawHuntressSigningSecret,
  getHuntressCommentBody,
  getHuntressIncidentReportBody,
} from "../../../../Types/Huntress/HuntressWebhookFixtures";
import { seededRandom } from "../../../../Helpers/SeededRandom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

// jsdom has no setImmediate, and Express needs it.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * The Huntress Incident Report trigger on the workflow service.
 *
 * Over HTTP, as Huntress (through Svix) reaches it: a real Express app with
 * the app's own JSON body parser - the one that keeps the raw body for
 * signature checks - and the route the trigger mounts, POST
 * /workflow/huntress/<key>. It pins that the bytes Huntress signed reach
 * the signature check unchanged, that a forged or tampered request starts
 * nothing, and that the route needs no OneUptime credential: the signature
 * is the credential.
 *
 * And the run it starts: the report's values, the incident severity it
 * opens at (the trigger's setting while the project still has that
 * severity, else the project's severities in rank order) and the label
 * named after its organization, made the first time.
 *
 * WorkflowService, IncidentSeverityService and LabelService are spied on,
 * and Valkey stood in for, so no database is touched.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const WORKFLOW_ID: string = "20000000-0000-4000-8000-000000000001";
const SECRET_KEY: string = "40000000-0000-4000-8000-000000000001";
const SECRET: string = drawHuntressSigningSecret(seededRandom(1106));

const SEVERITY_IDS: Array<string> = [
  "50000000-0000-4000-8000-000000000001",
  "50000000-0000-4000-8000-000000000002",
  "50000000-0000-4000-8000-000000000003",
  "50000000-0000-4000-8000-000000000004",
];
const LABEL_ID: string = "60000000-0000-4000-8000-000000000001";

const trigger: HuntressWorkflowTrigger = new HuntressWorkflowTrigger();

let cache: Set<string>;

function stubValkey(): void {
  cache = new Set<string>();

  jest.spyOn(Redis, "isConnected").mockReturnValue(true);
  jest.spyOn(Redis, "getClient").mockImplementation((() => {
    return {
      set: async (key: string): Promise<string | null> => {
        if (cache.has(key)) {
          return null;
        }

        cache.add(key);
        return "OK";
      },
      del: async (key: string): Promise<number> => {
        return cache.delete(key) ? 1 : 0;
      },
    };
  }) as never);
}

interface HttpResult {
  status: number;
  body: JSONObject | null;
}

function request(data: {
  port: number;
  method?: string;
  path: string;
  body: string;
  headers: http.OutgoingHttpHeaders;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: data.method || "POST",
          headers: {
            "content-length": Buffer.byteLength(data.body),
            ...data.headers,
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const raw: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject | null = null;

            try {
              body = raw ? (JSON.parse(raw) as JSONObject) : null;
            } catch {
              body = null;
            }

            resolve({ status: response.statusCode || 0, body });
          });
        },
      );

      outgoing.on("error", reject);
      outgoing.write(data.body);
      outgoing.end();
    },
  );
}

function signed(
  body: string,
  messageId: string = "msg_1",
): http.OutgoingHttpHeaders {
  const timestamp: string = String(Math.floor(Date.now() / 1000));

  return {
    "content-type": "application/json",
    "svix-id": messageId,
    "svix-timestamp": timestamp,
    "svix-signature": StandardWebhookSignature.sign({
      secret: SECRET,
      messageId,
      timestamp,
      body,
    }),
  };
}

describe("POST /workflow/huntress/:secretkey", () => {
  let server: http.Server;
  let port: number;
  let runs: Array<ExecuteWorkflowType> = [];

  beforeAll(async () => {
    const app: express.Express = express();
    app.use(express.json(jsonBodyParserOptions));

    const router: ExpressRouter = express.Router();

    await trigger.init({
      router,
      executeWorkflow: async (
        executeWorkflow: ExecuteWorkflowType,
      ): Promise<void> => {
        runs.push(executeWorkflow);
      },
      scheduleWorkflow: async (): Promise<void> => {},
      removeWorkflow: async (): Promise<void> => {},
    });

    // Mounted as the workflow service mounts every trigger's routes.
    app.use("/workflow", router);
    app.use(expressErrorHandler);

    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    runs = [];
    stubValkey();

    jest
      .spyOn(WorkflowService, "findOneBy")
      .mockImplementation((async (findBy: {
        query: JSONObject;
      }): Promise<Workflow | null> => {
        if (findBy.query["webhookSecretKey"] !== SECRET_KEY) {
          return null;
        }

        const workflow: Workflow = new Workflow();
        workflow._id = WORKFLOW_ID;
        workflow.projectId = PROJECT_ID;
        workflow.isEnabled = true;
        workflow.isArchived = false;
        workflow.triggerId = ComponentID.HuntressIncidentReport;
        workflow.triggerArguments = {};
        workflow.webhookSigningSecret = SECRET;
        return workflow;
      }) as never);

    jest
      .spyOn(WorkflowService, "updateColumnsByIdWithoutHooks")
      .mockImplementation((async (): Promise<void> => {}) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is the path the trigger's URL names", () => {
    expect(HUNTRESS_TRIGGER_PATH).toBe("/huntress");
  });

  test("a signed report starts the workflow, with no OneUptime credential", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());

    const result: HttpResult = await request({
      port,
      path: `/workflow/huntress/${SECRET_KEY}`,
      body,
      headers: signed(body),
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      received: true,
      event: HuntressTriggerEvent.Created,
      reportId: "1234",
      status: "Scheduled",
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.workflowId.toString()).toBe(WORKFLOW_ID);
    expect(runs[0]!.returnValues[HuntressTriggerValue.Organization]).toBe(
      "Acme Corp",
    );
  });

  test("the bytes Huntress signed reach the check unchanged: pretty-printed JSON with unicode escapes verifies", async () => {
    const body: string = JSON.stringify(
      getHuntressIncidentReportBody({ summary: 'Café — "quoted"' }),
      null,
      3,
    ).replace("Café", "Caf\\u00e9");

    const result: HttpResult = await request({
      port,
      path: `/workflow/huntress/${SECRET_KEY}`,
      body,
      headers: signed(body),
    });

    expect(result.status).toBe(200);
    expect(runs[0]!.returnValues[HuntressTriggerValue.Summary]).toBe(
      'Café — "quoted"',
    );
  });

  test("a report changed on the way is refused, and starts nothing", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());
    const headers: http.OutgoingHttpHeaders = signed(body);

    const result: HttpResult = await request({
      port,
      path: `/workflow/huntress/${SECRET_KEY}`,
      body: body.replace("Acme Corp", "Evil Corp"),
      headers,
    });

    expect(result.status).toBe(401);
    expect(runs).toHaveLength(0);
  });

  test("an unsigned request is refused", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());

    const result: HttpResult = await request({
      port,
      path: `/workflow/huntress/${SECRET_KEY}`,
      body,
      headers: { "content-type": "application/json" },
    });

    expect(result.status).toBe(401);
    expect(runs).toHaveLength(0);
  });

  test("another workflow's address is answered 404", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());

    const result: HttpResult = await request({
      port,
      path: "/workflow/huntress/40000000-0000-4000-8000-000000000999",
      body,
      headers: signed(body),
    });

    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      message: "No Huntress workflow has this address.",
    });
  });

  test("a body that is not sent as JSON reaches no signature check, and is refused", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());

    const result: HttpResult = await request({
      port,
      path: `/workflow/huntress/${SECRET_KEY}`,
      body,
      headers: { ...signed(body), "content-type": "text/plain" },
    });

    expect(result.status).toBe(400);
    expect(runs).toHaveLength(0);
  });

  test("the same delivery twice starts one run", async () => {
    const body: string = JSON.stringify(getHuntressIncidentReportBody());
    const headers: http.OutgoingHttpHeaders = signed(body, "msg_twice");

    await request({
      port,
      path: `/workflow/huntress/${SECRET_KEY}`,
      body,
      headers,
    });
    const second: HttpResult = await request({
      port,
      path: `/workflow/huntress/${SECRET_KEY}`,
      body,
      headers,
    });

    expect(second.status).toBe(200);
    expect(second.body?.["duplicate"]).toBe(true);
    expect(runs).toHaveLength(1);
  });

  test("only POST is answered", async () => {
    const result: HttpResult = await request({
      port,
      method: "GET",
      path: `/workflow/huntress/${SECRET_KEY}`,
      body: "",
      headers: {},
    });

    expect(result.status).toBe(404);
    expect(runs).toHaveLength(0);
  });
});

/*
 * ------------------------------------------------------------------ The run
 */

function severity(id: string, order: number): IncidentSeverity {
  const model: IncidentSeverity = new IncidentSeverity();
  model._id = id;
  model.name = `Severity ${order}`;
  model.order = order;
  return model;
}

let severities: Array<IncidentSeverity> | Error;
let severityQueries: Array<JSONObject>;
let labelRequests: Array<{ projectId: ObjectID; labelNames: Array<string> }>;
let labelAnswer: Array<ObjectID> | Error;
let logged: Array<unknown>;

function options(): RunOptions {
  return {
    log: (item: unknown): void => {
      logged.push(item);
    },
    workflowLogId: ObjectID.generate(),
    workflowId: new ObjectID(WORKFLOW_ID),
    projectId: PROJECT_ID,
    onError: (exception: Exception): Exception => {
      return exception;
    },
    executeWorkflow: async (): Promise<void> => {},
  };
}

// What a delivery hands the run: the values the webhook read from Huntress's body.
function delivered(body: JSONObject, settings: JSONObject = {}): JSONObject {
  const parsed: ReturnType<typeof parseHuntressWebhook> =
    parseHuntressWebhook(body);

  if (parsed.kind !== "incident-report") {
    throw new Error("Not an incident report.");
  }

  return {
    ...settings,
    ...getHuntressDeliveryValues({
      event: parsed.event,
      receivedAt: new Date("2026-10-09T10:00:00.000Z"),
    }),
  };
}

async function run(args: JSONObject): Promise<RunReturnType> {
  return await trigger.run(args, options());
}

describe("the run the trigger starts", () => {
  beforeEach(() => {
    severities = SEVERITY_IDS.map((id: string, index: number) => {
      return severity(id, index + 1);
    });
    severityQueries = [];
    labelRequests = [];
    labelAnswer = [new ObjectID(LABEL_ID)];
    logged = [];

    jest.spyOn(IncidentSeverityService, "findBy").mockImplementation((async (
      findBy: JSONObject,
    ): Promise<Array<IncidentSeverity>> => {
      severityQueries.push(findBy);

      if (severities instanceof Error) {
        throw severities;
      }

      return severities;
    }) as never);

    jest
      .spyOn(LabelService, "findOrCreateLabelsByNames")
      .mockImplementation((async (data: {
        projectId: ObjectID;
        labelNames: Array<string>;
      }): Promise<Array<ObjectID>> => {
        labelRequests.push(data);

        if (labelAnswer instanceof Error) {
          throw labelAnswer;
        }

        return labelAnswer;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is the Huntress Incident Report trigger", () => {
    expect(trigger).toBeInstanceOf(TriggerCode);
    expect(trigger.getMetadata().id).toBe(ComponentID.HuntressIncidentReport);
  });

  test("goes on through Out with every value the trigger promises", async () => {
    const result: RunReturnType = await run(
      delivered(getHuntressIncidentReportBody()),
    );

    expect(result.executePort?.id).toBe("out");

    const promised: Array<string> = trigger
      .getMetadata()
      .returnValues.map((value: { id: string }): string => {
        return value.id;
      });

    expect(Object.keys(result.returnValues).sort()).toEqual(
      [...promised].sort(),
    );
    expect(result.returnValues).toEqual(
      expect.objectContaining({
        [HuntressTriggerValue.Event]: HuntressTriggerEvent.Created,
        [HuntressTriggerValue.ReportId]: "1234",
        [HuntressTriggerValue.Severity]: HuntressSeverity.Critical,
        [HuntressTriggerValue.Organization]: "Acme Corp",
        [HuntressTriggerValue.OrganizationId]: "4",
        [HuntressTriggerValue.Affected]: "DESKTOP-ARL0EQ1",
        [HuntressTriggerValue.Indicators]:
          "Footholds (1), Process detections (2)",
        [HuntressTriggerValue.IncidentTitle]:
          "Huntress: Incident on DESKTOP-ARL0EQ1 (Acme Corp)",
        [HuntressTriggerValue.IncidentSeverityId]: SEVERITY_IDS[0],
        [HuntressTriggerValue.OrganizationLabelId]: LABEL_ID,
        [HuntressTriggerValue.ReceivedAt]: "2026-10-09T10:00:00.000Z",
        [HuntressTriggerValue.Note]: "",
      }),
    );
    expect(
      String(result.returnValues[HuntressTriggerValue.IncidentDescription]),
    ).toContain("Huntress detected a malicious scheduled task");
    expect(String(result.returnValues[HuntressTriggerValue.ReportUrl])).toBe(
      "https://huntress.io/org/4/incident_reports/1234",
    );
    expect(logged).toContain("Huntress incident report 1234: created.");
  });

  test("a comment hands on its note, and a close says Huntress closed the report", async () => {
    const comment: RunReturnType = await run(
      delivered(getHuntressCommentBody("Isolated the host.")),
    );

    expect(comment.returnValues[HuntressTriggerValue.Event]).toBe(
      HuntressTriggerEvent.CommentAdded,
    );
    expect(String(comment.returnValues[HuntressTriggerValue.Note])).toContain(
      "Isolated the host.",
    );

    const closed: RunReturnType = await run(
      delivered(
        getHuntressIncidentReportBody({
          event_type: "incident_report.closed",
          status: "closed",
        }),
      ),
    );

    expect(closed.returnValues[HuntressTriggerValue.Note]).toBe(
      "Huntress closed incident report 1234 (status: closed).",
    );
  });

  test("reads the project's severities as OneUptime, most severe first", async () => {
    await run(delivered(getHuntressIncidentReportBody()));

    expect(severityQueries).toHaveLength(1);
    expect(severityQueries[0]).toEqual(
      expect.objectContaining({
        query: { projectId: PROJECT_ID },
        sort: { order: SortOrder.Ascending },
        props: { isRoot: true },
      }),
    );
  });

  test.each([
    [HuntressSeverity.Critical, 0],
    [HuntressSeverity.High, 1],
    [HuntressSeverity.Low, 2],
  ])(
    "with no setting, a %s report opens at the project's severity in rank %i",
    async (huntressSeverity: HuntressSeverity, rank: number) => {
      const result: RunReturnType = await run(
        delivered(
          getHuntressIncidentReportBody({ severity: huntressSeverity }),
        ),
      );

      expect(result.returnValues[HuntressTriggerValue.IncidentSeverityId]).toBe(
        SEVERITY_IDS[rank],
      );
    },
  );

  test("a report that names no severity is handled as high", async () => {
    const result: RunReturnType = await run(
      delivered(getHuntressIncidentReportBody({ severity: null })),
    );

    expect(result.returnValues[HuntressTriggerValue.Severity]).toBe(
      HuntressSeverity.High,
    );
    expect(result.returnValues[HuntressTriggerValue.IncidentSeverityId]).toBe(
      SEVERITY_IDS[1],
    );
  });

  test("a project with fewer severities uses its least severe for the rest", async () => {
    severities = [severity(SEVERITY_IDS[0]!, 1)];

    const result: RunReturnType = await run(
      delivered(getHuntressIncidentReportBody({ severity: "low" })),
    );

    expect(result.returnValues[HuntressTriggerValue.IncidentSeverityId]).toBe(
      SEVERITY_IDS[0],
    );
  });

  test("the severity a setting picks wins, while the project still has it", async () => {
    const result: RunReturnType = await run(
      delivered(getHuntressIncidentReportBody({ severity: "critical" }), {
        [HuntressTriggerSetting.CriticalIncidentSeverity]: SEVERITY_IDS[3],
        // The other severities' settings do not apply to a critical report.
        [HuntressTriggerSetting.HighIncidentSeverity]: SEVERITY_IDS[2],
      }),
    );

    expect(result.returnValues[HuntressTriggerValue.IncidentSeverityId]).toBe(
      SEVERITY_IDS[3],
    );
  });

  test("a picked severity that is gone gives way to the rank order, and the log says so", async () => {
    const result: RunReturnType = await run(
      delivered(getHuntressIncidentReportBody({ severity: "high" }), {
        [HuntressTriggerSetting.HighIncidentSeverity]:
          "50000000-0000-4000-8000-000000000999",
      }),
    );

    expect(result.returnValues[HuntressTriggerValue.IncidentSeverityId]).toBe(
      SEVERITY_IDS[1],
    );
    expect(logged).toContain(
      "The incident severity picked for this report's severity is gone, so the project's severities decide it in rank order.",
    );
  });

  test("a project with no severities leaves Incident Severity ID empty, and the log says where to add one", async () => {
    severities = [];

    const result: RunReturnType = await run(
      delivered(getHuntressIncidentReportBody()),
    );

    expect(result.returnValues[HuntressTriggerValue.IncidentSeverityId]).toBe(
      "",
    );
    expect(
      logged.some((item: unknown): boolean => {
        return String(item).includes(
          "Add one under Incidents > Settings > Incident Severity.",
        );
      }),
    ).toBe(true);
  });

  test("severities that cannot be read leave it empty, and the run goes on", async () => {
    severities = new Error("the database is busy");

    const result: RunReturnType = await run(
      delivered(getHuntressIncidentReportBody()),
    );

    expect(result.executePort?.id).toBe("out");
    expect(result.returnValues[HuntressTriggerValue.IncidentSeverityId]).toBe(
      "",
    );
  });

  test("the organization's label is found or made in the workflow's project, by the organization's name", async () => {
    await run(delivered(getHuntressIncidentReportBody()));

    expect(labelRequests).toEqual([
      { projectId: PROJECT_ID, labelNames: ["Acme Corp"] },
    ]);
  });

  test("a report with no organization is labelled Huntress", async () => {
    await run(
      delivered(
        getHuntressIncidentReportBody({
          organization: null,
          organization_id: null,
        }),
      ),
    );

    expect(labelRequests[0]!.labelNames).toEqual(["Huntress"]);
  });

  test("a very long organization name is cut to a label's length", async () => {
    await run(
      delivered(
        getHuntressIncidentReportBody({
          organization: { id: 4, name: "A".repeat(150) },
        }),
      ),
    );

    expect(labelRequests[0]!.labelNames[0]).toHaveLength(
      HUNTRESS_MAX_LABEL_NAME_LENGTH,
    );
  });

  test("a label that cannot be found or made leaves Organization Label ID empty, and the run goes on", async () => {
    labelAnswer = new Error("the database is busy");

    const result: RunReturnType = await run(
      delivered(getHuntressIncidentReportBody()),
    );

    expect(result.executePort?.id).toBe("out");
    expect(result.returnValues[HuntressTriggerValue.OrganizationLabelId]).toBe(
      "",
    );
    expect(logged).toContain(
      "Could not find or make the label Acme Corp, so Organization Label ID is empty.",
    );
  });

  test("Run Workflow: what is typed is read as a delivery is", async () => {
    const result: RunReturnType = await run({
      [HuntressTriggerValue.Event]: " Comment-Added ",
      [HuntressTriggerValue.ReportId]: " 77 ",
      [HuntressTriggerValue.Severity]: "LOW",
      [HuntressTriggerValue.Organization]: "Globex",
      [HuntressTriggerValue.Comment]: "Typed in the Builder.",
    });

    expect(result.returnValues).toEqual(
      expect.objectContaining({
        [HuntressTriggerValue.Event]: HuntressTriggerEvent.CommentAdded,
        [HuntressTriggerValue.ReportId]: "77",
        [HuntressTriggerValue.Severity]: HuntressSeverity.Low,
        [HuntressTriggerValue.Organization]: "Globex",
        [HuntressTriggerValue.IncidentSeverityId]: SEVERITY_IDS[2],
      }),
    );
    expect(labelRequests[0]!.labelNames).toEqual(["Globex"]);
    expect(
      Object.keys(result.returnValues).includes(
        HUNTRESS_DELIVERY_INDICATOR_COUNTS,
      ),
    ).toBe(false);
  });

  test("Run Workflow: an empty Event is created, and an empty Severity is high", async () => {
    const result: RunReturnType = await run({
      [HuntressTriggerValue.ReportId]: "77",
    });

    expect(result.returnValues[HuntressTriggerValue.Event]).toBe(
      HuntressTriggerEvent.Created,
    );
    expect(result.returnValues[HuntressTriggerValue.Severity]).toBe(
      HuntressSeverity.High,
    );
  });

  test.each([
    [
      "an Event it does not know",
      {
        [HuntressTriggerValue.Event]: "resolved",
        [HuntressTriggerValue.ReportId]: "77",
      },
      HUNTRESS_RUN_EVENT_PROBLEM,
    ],
    [
      "no Report ID",
      { [HuntressTriggerValue.Event]: "created" },
      HUNTRESS_RUN_REPORT_ID_PROBLEM,
    ],
    [
      "a Report ID that is not a number",
      { [HuntressTriggerValue.ReportId]: "abc" },
      HUNTRESS_RUN_REPORT_ID_PROBLEM,
    ],
  ])(
    "Run Workflow: %s stops the run, saying what to type",
    async (_case: string, args: JSONObject, problem: string) => {
      await expect(run(args)).rejects.toThrow(problem);
      expect(severityQueries).toHaveLength(0);
      expect(labelRequests).toHaveLength(0);
    },
  );
});
