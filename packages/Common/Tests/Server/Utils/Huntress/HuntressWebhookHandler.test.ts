jest.mock("../../../../Server/Utils/Logger", () => {
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

import Workflow from "../../../../Models/DatabaseModels/Workflow";
import Redis from "../../../../Server/Infrastructure/Redis";
import WorkflowService from "../../../../Server/Services/WorkflowService";
import { ExecuteWorkflowType } from "../../../../Server/Types/Workflow/TriggerCode";
import HuntressWebhookHandler, {
  HUNTRESS_BODY_TOO_LARGE_MESSAGE,
  HUNTRESS_DELIVERY_CACHE_NAMESPACE,
  HUNTRESS_DELIVERY_REMEMBERED_FOR_SECONDS,
  HUNTRESS_DUPLICATE_MESSAGE,
  HUNTRESS_ERROR_RECORD_INTERVAL_MS,
  HUNTRESS_INVALID_JSON_MESSAGE,
  HUNTRESS_MAX_BODY_LENGTH,
  HUNTRESS_NOT_AN_INCIDENT_REPORT_MESSAGE,
  HUNTRESS_NOT_STARTED_MESSAGE,
  HUNTRESS_NO_BODY_MESSAGE,
  HUNTRESS_NO_SIGNING_SECRET_MESSAGE,
  HUNTRESS_NO_WORKFLOW_MESSAGE,
  HUNTRESS_ORGANIZATION_NOT_WATCHED_MESSAGE,
  getHuntressUnavailableMessage,
  HUNTRESS_WORKFLOW_OFF_MESSAGE,
  HuntressWebhookAnswer,
} from "../../../../Server/Utils/Huntress/HuntressWebhookHandler";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import StandardWebhookSignature from "../../../../Server/Utils/Webhook/StandardWebhookSignature";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ProjectBlockedException from "../../../../Types/Exception/ProjectBlockedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import {
  HUNTRESS_DELIVERY_INDICATOR_COUNTS,
  HuntressTriggerEvent,
  HuntressTriggerSetting,
  HuntressTriggerValue,
} from "../../../../Types/Workflow/HuntressTrigger";
import {
  drawHuntressSigningSecret,
  getHuntressAccountNoticeBody,
  getHuntressClosedBody,
  getHuntressCommentBody,
  getHuntressEscalationBody,
  getHuntressIncidentReportBody,
} from "../../../Types/Huntress/HuntressWebhookFixtures";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { SpyInstance } from "jest-mock";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * One request to a Huntress workflow's URL, from its key to its answer:
 * which requests are refused and with which status (Svix sends anything but
 * a 2xx again), that only a body signed with the workflow's secret starts
 * anything, what the run is started with, that an event Huntress sends
 * again starts nothing more, and what is kept on the workflow for its
 * trigger's panel to show.
 *
 * The workflow is read and written through WorkflowService (stubbed), and
 * the deliveries already seen through GlobalCache, over a stand-in for
 * Valkey that answers SET ... NX and DEL as Valkey does.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const WORKFLOW_ID: string = "20000000-0000-4000-8000-000000000001";
const OTHER_WORKFLOW_ID: string = "20000000-0000-4000-8000-000000000002";
const SECRET_KEY: string = "40000000-0000-4000-8000-000000000001";
const OTHER_SECRET_KEY: string = "40000000-0000-4000-8000-000000000002";
const random: SeededRandom = seededRandom(8603);

const SECRET: string = drawHuntressSigningSecret(random);
const NOW: Date = new Date("2026-10-09T10:00:00.000Z");
const TIMESTAMP: string = String(Math.floor(NOW.getTime() / 1000));

// The workflows by webhook secret key: what WorkflowService.findOneBy finds.
let workflows: Map<string, Workflow>;
let updates: Array<{ id: string; data: JSONObject }>;
let runs: Array<ExecuteWorkflowType>;
let runFailure: Error | null;
let updateFailure: Error | null;
let lookups: Array<{
  query: JSONObject;
  select: JSONObject;
  props: JSONObject;
}>;

// A stand-in for Valkey: SET key value EX seconds NX, and DEL.
let cache: Map<string, { value: string; expiresInSeconds: number }>;
let cacheConnected: boolean;
let cacheFailure: Error | null;

type WorkflowOverrides = {
  [Key in keyof Workflow]?: Workflow[Key] | undefined;
};

function makeWorkflow(
  overrides: WorkflowOverrides = {},
  id: string = WORKFLOW_ID,
): Workflow {
  const model: Workflow = new Workflow();
  model._id = id;
  model.projectId = PROJECT_ID;
  model.isEnabled = true;
  model.isArchived = false;
  model.triggerId = ComponentID.HuntressIncidentReport;
  model.triggerArguments = {};
  model.webhookSigningSecret = SECRET;
  Object.assign(model, overrides);
  return model;
}

function signedHeaders(
  body: string,
  data: { secret?: string; messageId?: string; timestamp?: string } = {},
): Record<string, string> {
  const messageId: string = data.messageId || "msg_1";
  const timestamp: string = data.timestamp || TIMESTAMP;

  return {
    "content-type": "application/json",
    "svix-id": messageId,
    "svix-timestamp": timestamp,
    "svix-signature": StandardWebhookSignature.sign({
      secret: data.secret || SECRET,
      messageId,
      timestamp,
      body,
    }),
  };
}

async function deliver(
  body: string | undefined,
  data: {
    headers?: Record<string, string>;
    secretKey?: string | undefined;
    now?: Date;
  } = {},
): Promise<HuntressWebhookAnswer> {
  return await HuntressWebhookHandler.handle({
    secretKey: "secretKey" in data ? data.secretKey : SECRET_KEY,
    headers: data.headers || (body ? signedHeaders(body) : {}),
    rawBody: body,
    executeWorkflow: async (
      executeWorkflow: ExecuteWorkflowType,
    ): Promise<void> => {
      if (runFailure) {
        throw runFailure;
      }

      runs.push(executeWorkflow);
    },
    now: data.now || NOW,
  });
}

function reportBody(overrides: JSONObject = {}): string {
  return JSON.stringify(getHuntressIncidentReportBody(overrides));
}

// What the workflow was last left with: its last request, or why it was refused.
function lastUpdate(): JSONObject | undefined {
  return updates[updates.length - 1]?.data;
}

beforeEach(() => {
  workflows = new Map<string, Workflow>([[SECRET_KEY, makeWorkflow()]]);
  updates = [];
  runs = [];
  runFailure = null;
  updateFailure = null;
  lookups = [];
  cache = new Map();
  cacheConnected = true;
  cacheFailure = null;

  jest.spyOn(WorkflowService, "findOneBy").mockImplementation((async (findBy: {
    query: JSONObject;
    select: JSONObject;
    props: JSONObject;
  }): Promise<Workflow | null> => {
    lookups.push(findBy);

    return workflows.get(String(findBy.query["webhookSecretKey"])) || null;
  }) as never);

  jest
    .spyOn(WorkflowService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (updateBy: {
      id: ObjectID;
      data: JSONObject;
      skipUpdateDateColumn?: boolean;
    }): Promise<void> => {
      // Bookkeeping: the workflow's Updated At stays the time someone edited it.
      expect(updateBy.skipUpdateDateColumn).toBe(true);

      if (updateFailure) {
        throw updateFailure;
      }

      updates.push({ id: updateBy.id.toString(), data: updateBy.data });
    }) as never);

  jest.spyOn(Redis, "isConnected").mockImplementation((): boolean => {
    return cacheConnected;
  });

  jest.spyOn(Redis, "getClient").mockImplementation((() => {
    return {
      set: async (
        key: string,
        value: string,
        expiry: string,
        seconds: number,
        mode: string,
      ): Promise<string | null> => {
        if (cacheFailure) {
          throw cacheFailure;
        }

        expect(expiry).toBe("EX");
        expect(mode).toBe("NX");

        if (cache.has(key)) {
          return null;
        }

        cache.set(key, { value, expiresInSeconds: seconds });
        return "OK";
      },
      del: async (key: string): Promise<number> => {
        return cache.delete(key) ? 1 : 0;
      },
    };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the address", () => {
  test("no key, or one longer than any key, is no workflow's - without a lookup", async () => {
    for (const secretKey of [undefined, "", "   ", "k".repeat(501)]) {
      const answer: HuntressWebhookAnswer = await deliver(reportBody(), {
        secretKey,
      });

      expect(answer).toEqual({
        statusCode: 404,
        body: { message: HUNTRESS_NO_WORKFLOW_MESSAGE },
      });
    }

    expect(lookups).toHaveLength(0);
    expect(runs).toHaveLength(0);
  });

  test("an unknown key is answered 404, and nothing is written", async () => {
    const answer: HuntressWebhookAnswer = await deliver(reportBody(), {
      secretKey: "40000000-0000-4000-8000-000000000999",
    });

    expect(answer.statusCode).toBe(404);
    expect(answer.body).toEqual({ message: HUNTRESS_NO_WORKFLOW_MESSAGE });
    expect(updates).toHaveLength(0);
  });

  test("the workflow is read as OneUptime, with its secret, its trigger and its last error", async () => {
    await deliver(reportBody());

    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.query).toEqual({ webhookSecretKey: SECRET_KEY });
    expect(lookups[0]!.props).toEqual({ isRoot: true });

    for (const column of [
      "_id",
      "projectId",
      "isEnabled",
      "isArchived",
      "triggerId",
      "triggerArguments",
      "webhookSigningSecret",
      "lastWebhookError",
      "lastWebhookErrorAt",
    ]) {
      expect({ column, selected: lookups[0]!.select[column] }).toEqual({
        column,
        selected: true,
      });
    }
  });

  test("a workflow whose trigger is not Huntress's does not answer Huntress", async () => {
    for (const triggerId of [
      ComponentID.Webhook,
      ComponentID.Manual,
      undefined,
    ]) {
      workflows.set(SECRET_KEY, makeWorkflow({ triggerId }));

      const answer: HuntressWebhookAnswer = await deliver(reportBody());

      expect({ triggerId, statusCode: answer.statusCode }).toEqual({
        triggerId,
        statusCode: 404,
      });
    }

    expect(runs).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  test("an archived workflow does not answer Huntress", async () => {
    workflows.set(SECRET_KEY, makeWorkflow({ isArchived: true }));

    const answer: HuntressWebhookAnswer = await deliver(reportBody());

    expect(answer.statusCode).toBe(404);
    expect(runs).toHaveLength(0);
  });
});

describe("the signature", () => {
  test("with no signing secret saved, every request is refused 401 - and the trigger says how to fix it", async () => {
    workflows.set(
      SECRET_KEY,
      makeWorkflow({ webhookSigningSecret: undefined }),
    );

    const answer: HuntressWebhookAnswer = await deliver(reportBody());

    expect(answer).toEqual({
      statusCode: 401,
      body: { message: HUNTRESS_NO_SIGNING_SECRET_MESSAGE },
    });
    expect(HUNTRESS_NO_SIGNING_SECRET_MESSAGE).toContain("View Signing Secret");
    expect(updates).toEqual([
      {
        id: WORKFLOW_ID,
        data: {
          lastWebhookError: HUNTRESS_NO_SIGNING_SECRET_MESSAGE,
          lastWebhookErrorAt: NOW,
        },
      },
    ]);
    expect(runs).toHaveLength(0);
  });

  test("a request signed with another secret is refused 401, and says so", async () => {
    const body: string = reportBody();
    const answer: HuntressWebhookAnswer = await deliver(body, {
      headers: signedHeaders(body, {
        secret: drawHuntressSigningSecret(random),
      }),
    });

    expect(answer.statusCode).toBe(401);
    expect(String(answer.body["message"])).toMatch(
      /^The request's signature does not match the signing secret/,
    );
    expect(lastUpdate()?.["lastWebhookError"]).toBe(answer.body["message"]);
    expect(runs).toHaveLength(0);
  });

  test("a request without Huntress's headers is refused 401", async () => {
    const answer: HuntressWebhookAnswer = await deliver(reportBody(), {
      headers: { "content-type": "application/json" },
    });

    expect(answer.statusCode).toBe(401);
    expect(runs).toHaveLength(0);
  });

  test("a request signed more than five minutes away is refused 401, either way", async () => {
    for (const minutes of [-6, 6]) {
      const body: string = reportBody();
      const answer: HuntressWebhookAnswer = await deliver(body, {
        headers: signedHeaders(body, {
          timestamp: String(Math.floor(NOW.getTime() / 1000) + minutes * 60),
        }),
      });

      expect({ minutes, statusCode: answer.statusCode }).toEqual({
        minutes,
        statusCode: 401,
      });
      expect(String(answer.body["message"])).toMatch(
        /^The request was signed more than five minutes from now/,
      );
    }

    expect(runs).toHaveLength(0);
  });

  test("a report changed after it was signed is refused, and starts nothing", async () => {
    const body: string = reportBody();
    const headers: Record<string, string> = signedHeaders(body);

    const answer: HuntressWebhookAnswer = await deliver(
      body.replace("Acme Corp", "Evil Corp"),
      { headers },
    );

    expect(answer.statusCode).toBe(401);
    expect(runs).toHaveLength(0);
  });

  test("the bytes that were signed are the ones read: pretty-printed JSON with unicode escapes", async () => {
    const body: string = JSON.stringify(
      getHuntressIncidentReportBody({ summary: 'Café — "quoted"' }),
      null,
      3,
    ).replace("Café", "Caf\\u00e9");

    const answer: HuntressWebhookAnswer = await deliver(body);

    expect(answer.statusCode).toBe(200);
    expect(runs[0]!.returnValues[HuntressTriggerValue.Summary]).toBe(
      'Café — "quoted"',
    );
  });
});

describe("the body", () => {
  test("no body is refused 400 once the secret is saved", async () => {
    const answer: HuntressWebhookAnswer = await deliver(undefined, {
      headers: signedHeaders(""),
    });

    expect(answer).toEqual({
      statusCode: 400,
      body: { message: HUNTRESS_NO_BODY_MESSAGE },
    });
  });

  test("a body larger than any Huntress event is refused 413, before its signature is checked", async () => {
    const verify: SpyInstance<typeof StandardWebhookSignature.verify> =
      jest.spyOn(StandardWebhookSignature, "verify");
    const body: string = "x".repeat(HUNTRESS_MAX_BODY_LENGTH + 1);

    const answer: HuntressWebhookAnswer = await deliver(body, {
      headers: signedHeaders("{}"),
    });

    expect(answer).toEqual({
      statusCode: 413,
      body: { message: HUNTRESS_BODY_TOO_LARGE_MESSAGE },
    });
    expect(verify).not.toHaveBeenCalled();
  });

  test("a signed body that is not JSON is refused 400", async () => {
    const answer: HuntressWebhookAnswer = await deliver("not json");

    expect(answer).toEqual({
      statusCode: 400,
      body: { message: HUNTRESS_INVALID_JSON_MESSAGE },
    });
  });

  test("signed JSON that is no Huntress event is refused 400, saying what is wrong", async () => {
    const answer: HuntressWebhookAnswer = await deliver(
      JSON.stringify({ hello: "world" }),
    );

    expect(answer.statusCode).toBe(400);
    expect(String(answer.body["message"]).length).toBeGreaterThan(0);
    expect(lastUpdate()?.["lastWebhookError"]).toBe(answer.body["message"]);
    expect(runs).toHaveLength(0);
  });
});

describe("events that are not incident reports", () => {
  test.each([
    ["an escalation", getHuntressEscalationBody()],
    ["a platform action", getHuntressEscalationBody("platform_action.created")],
    ["an account notice", getHuntressAccountNoticeBody()],
  ])(
    "%s is received 200 and starts nothing",
    async (_name: string, payload: JSONObject) => {
      const answer: HuntressWebhookAnswer = await deliver(
        JSON.stringify(payload),
      );

      expect(answer.statusCode).toBe(200);
      expect(answer.body).toEqual({
        received: true,
        eventType: payload["event_type"],
        message: HUNTRESS_NOT_AN_INCIDENT_REPORT_MESSAGE,
      });
      expect(runs).toHaveLength(0);
      // Huntress reached the workflow: the panel says so.
      expect(lastUpdate()).toEqual({
        lastWebhookRequestAt: NOW,
        lastWebhookError: null,
        lastWebhookErrorAt: null,
      });
    },
  );
});

describe("an incident report event starts one run", () => {
  test("a new report starts the workflow with the report's values, and is answered 200", async () => {
    const answer: HuntressWebhookAnswer = await deliver(reportBody());

    expect(answer).toEqual({
      statusCode: 200,
      body: {
        received: true,
        event: HuntressTriggerEvent.Created,
        reportId: "1234",
        status: "Scheduled",
      },
    });

    expect(runs).toHaveLength(1);
    expect(runs[0]!.workflowId.toString()).toBe(WORKFLOW_ID);
    expect(runs[0]!.returnValues).toEqual({
      [HuntressTriggerValue.Event]: HuntressTriggerEvent.Created,
      [HuntressTriggerValue.ReportId]: "1234",
      [HuntressTriggerValue.Severity]: "critical",
      [HuntressTriggerValue.Status]: "sent",
      [HuntressTriggerValue.Subject]:
        "CRITICAL - Incident on DESKTOP-ARL0EQ1 (Acme Corp)",
      [HuntressTriggerValue.Summary]:
        "Huntress detected a malicious scheduled task on this host. We recommend removing the file and scheduled task listed in the remediation steps below.",
      [HuntressTriggerValue.Organization]: "Acme Corp",
      [HuntressTriggerValue.OrganizationId]: "4",
      [HuntressTriggerValue.Platform]: "windows",
      [HuntressTriggerValue.Comment]: "",
      [HUNTRESS_DELIVERY_INDICATOR_COUNTS]: {
        footholds: 1,
        process_detections: 2,
      },
      [HuntressTriggerValue.ReceivedAt]: NOW.toISOString(),
    });

    expect(lastUpdate()).toEqual({
      lastWebhookRequestAt: NOW,
      lastWebhookError: null,
      lastWebhookErrorAt: null,
    });
  });

  test("a comment starts it as comment-added, with the comment", async () => {
    const answer: HuntressWebhookAnswer = await deliver(
      JSON.stringify(getHuntressCommentBody("Isolated the host.")),
    );

    expect(answer.body["event"]).toBe(HuntressTriggerEvent.CommentAdded);
    expect(runs[0]!.returnValues[HuntressTriggerValue.Event]).toBe(
      HuntressTriggerEvent.CommentAdded,
    );
    expect(runs[0]!.returnValues[HuntressTriggerValue.Comment]).toBe(
      "Isolated the host.",
    );
  });

  test("a close starts it as closed", async () => {
    await deliver(JSON.stringify(getHuntressClosedBody()));

    expect(runs[0]!.returnValues[HuntressTriggerValue.Event]).toBe(
      HuntressTriggerEvent.Closed,
    );
    expect(runs[0]!.returnValues[HuntressTriggerValue.Status]).toBe("closed");
  });

  test.each(["closed", "dismissed"])(
    "a report first seen already %s starts it as closed, whichever event carried it",
    async (status: string) => {
      await deliver(reportBody({ status }));

      expect(runs[0]!.returnValues[HuntressTriggerValue.Event]).toBe(
        HuntressTriggerEvent.Closed,
      );
    },
  );

  test("a comment on a closed report is still a comment", async () => {
    await deliver(
      JSON.stringify(
        getHuntressCommentBody("For the record.", { status: "closed" }),
      ),
    );

    expect(runs[0]!.returnValues[HuntressTriggerValue.Event]).toBe(
      HuntressTriggerEvent.CommentAdded,
    );
  });

  test("each event of a report starts its own run", async () => {
    const created: string = reportBody();
    const comment: string = JSON.stringify(getHuntressCommentBody("Looking."));
    const closed: string = JSON.stringify(getHuntressClosedBody());

    await deliver(created, {
      headers: signedHeaders(created, { messageId: "msg_1" }),
    });
    await deliver(comment, {
      headers: signedHeaders(comment, { messageId: "msg_2" }),
    });
    await deliver(closed, {
      headers: signedHeaders(closed, { messageId: "msg_3" }),
    });

    expect(
      runs.map((run: ExecuteWorkflowType): unknown => {
        return run.returnValues[HuntressTriggerValue.Event];
      }),
    ).toEqual([
      HuntressTriggerEvent.Created,
      HuntressTriggerEvent.CommentAdded,
      HuntressTriggerEvent.Closed,
    ]);
  });
});

describe("Only These Organizations", () => {
  function watching(organizations: string): void {
    workflows.set(
      SECRET_KEY,
      makeWorkflow({
        triggerArguments: {
          [HuntressTriggerSetting.Organizations]: organizations,
        },
      }),
    );
  }

  test("a report from an organization the trigger leaves out is received 200, and starts nothing", async () => {
    watching("Globex\nInitech");

    const answer: HuntressWebhookAnswer = await deliver(reportBody());

    expect(answer).toEqual({
      statusCode: 200,
      body: {
        received: true,
        event: HuntressTriggerEvent.Created,
        reportId: "1234",
        skipped: true,
        message: HUNTRESS_ORGANIZATION_NOT_WATCHED_MESSAGE,
      },
    });
    expect(runs).toHaveLength(0);
    expect(lastUpdate()?.["lastWebhookRequestAt"]).toEqual(NOW);
  });

  test.each([
    ["by name, whatever its case", "globex\nACME CORP"],
    ["by id", "Globex\n4"],
  ])(
    "a listed organization's report starts it: %s",
    async (_how: string, list: string) => {
      watching(list);

      await deliver(reportBody());

      expect(runs).toHaveLength(1);
    },
  );

  test("an empty list lets every organization's reports through", async () => {
    watching("  \n ");

    await deliver(reportBody());

    expect(runs).toHaveLength(1);
  });

  test("the list is read as a check of the report, not of the request: a forged report from a listed organization is still refused", async () => {
    watching("Acme Corp");

    const body: string = reportBody();
    const answer: HuntressWebhookAnswer = await deliver(body, {
      headers: signedHeaders(body, {
        secret: drawHuntressSigningSecret(random),
      }),
    });

    expect(answer.statusCode).toBe(401);
    expect(runs).toHaveLength(0);
  });
});

describe("a workflow that is off", () => {
  test("refuses a report 503, so Huntress sends it again, and says to turn it on", async () => {
    workflows.set(SECRET_KEY, makeWorkflow({ isEnabled: false }));

    const answer: HuntressWebhookAnswer = await deliver(reportBody());

    expect(answer).toEqual({
      statusCode: 503,
      body: { message: HUNTRESS_WORKFLOW_OFF_MESSAGE },
    });
    expect(runs).toHaveLength(0);
    expect(lastUpdate()).toEqual({
      lastWebhookError: HUNTRESS_WORKFLOW_OFF_MESSAGE,
      lastWebhookErrorAt: NOW,
    });
    // Not remembered: once it is on, the same event goes through.
    expect(cache.size).toBe(0);

    workflows.set(SECRET_KEY, makeWorkflow({ isEnabled: true }));

    const again: HuntressWebhookAnswer = await deliver(reportBody());

    expect(again.statusCode).toBe(200);
    expect(runs).toHaveLength(1);
  });

  test("tells a request that is not Huntress's nothing about the workflow: the signature is checked first", async () => {
    workflows.set(SECRET_KEY, makeWorkflow({ isEnabled: false }));

    const answer: HuntressWebhookAnswer = await deliver(reportBody(), {
      headers: { "content-type": "application/json" },
    });

    expect(answer.statusCode).toBe(401);
  });

  test("still answers 200 for events that would start nothing anyway", async () => {
    workflows.set(SECRET_KEY, makeWorkflow({ isEnabled: false }));

    const answer: HuntressWebhookAnswer = await deliver(
      JSON.stringify(getHuntressEscalationBody()),
    );

    expect(answer.statusCode).toBe(200);
  });
});

describe("an event Huntress sends again", () => {
  test("starts nothing more: the same svix-id is received 200 as a duplicate", async () => {
    const body: string = reportBody();

    const first: HuntressWebhookAnswer = await deliver(body);
    const second: HuntressWebhookAnswer = await deliver(body);

    expect(first.statusCode).toBe(200);
    expect(second).toEqual({
      statusCode: 200,
      body: {
        received: true,
        event: HuntressTriggerEvent.Created,
        reportId: "1234",
        duplicate: true,
        message: HUNTRESS_DUPLICATE_MESSAGE,
      },
    });
    expect(runs).toHaveLength(1);
  });

  test("is remembered for a week, per workflow", async () => {
    await deliver(reportBody());

    expect(Array.from(cache.entries())).toEqual([
      [
        `${HUNTRESS_DELIVERY_CACHE_NAMESPACE}-${WORKFLOW_ID}:msg_1`,
        {
          value: NOW.toISOString(),
          expiresInSeconds: HUNTRESS_DELIVERY_REMEMBERED_FOR_SECONDS,
        },
      ],
    ]);
    expect(HUNTRESS_DELIVERY_REMEMBERED_FOR_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  test("the same event sent to two workflows starts each of them", async () => {
    workflows.set(OTHER_SECRET_KEY, makeWorkflow({}, OTHER_WORKFLOW_ID));

    const body: string = reportBody();

    await deliver(body);
    await deliver(body, { secretKey: OTHER_SECRET_KEY });

    expect(
      runs.map((run: ExecuteWorkflowType): string => {
        return run.workflowId.toString();
      }),
    ).toEqual([WORKFLOW_ID, OTHER_WORKFLOW_ID]);
  });

  test("when OneUptime cannot tell whether it saw the event, nothing starts and Huntress is asked to send it again", async () => {
    cacheConnected = false;

    const answer: HuntressWebhookAnswer = await deliver(reportBody());

    expect(answer).toEqual({
      statusCode: 503,
      body: { message: getHuntressUnavailableMessage() },
    });
    // In the installation's own name.
    expect(getHuntressUnavailableMessage()).toBe(
      `${ProductBrandingText.getProductName()} cannot take Huntress events right now. Huntress sends this one again.`,
    );
    expect(runs).toHaveLength(0);

    cacheConnected = true;
    cacheFailure = new Error(
      "READONLY You can't write against a read only replica.",
    );

    const again: HuntressWebhookAnswer = await deliver(reportBody());

    expect(again.statusCode).toBe(503);
    expect(runs).toHaveLength(0);
  });
});

describe("a run that could not be started", () => {
  test("in a blocked project is answered 403, and the event is forgotten", async () => {
    runFailure = new ProjectBlockedException();

    const answer: HuntressWebhookAnswer = await deliver(reportBody());

    expect(answer.statusCode).toBe(403);
    expect(answer.body).toEqual({ message: runFailure.message });
    expect(cache.size).toBe(0);
  });

  test("for a reason the queue gives is answered 500 with that reason, recorded, and the event forgotten", async () => {
    runFailure = new BadDataException(
      "This project's plan allows no more workflow runs this month.",
    );

    const answer: HuntressWebhookAnswer = await deliver(reportBody());

    expect(answer).toEqual({
      statusCode: 500,
      body: {
        message: "This project's plan allows no more workflow runs this month.",
      },
    });
    expect(lastUpdate()?.["lastWebhookError"]).toBe(
      "This project's plan allows no more workflow runs this month.",
    );
    expect(cache.size).toBe(0);
  });

  test("for any other reason is answered 500 without the details, and the next delivery starts it", async () => {
    runFailure = new Error("connect ECONNREFUSED 10.0.0.12:6379");

    const answer: HuntressWebhookAnswer = await deliver(reportBody());

    expect(answer).toEqual({
      statusCode: 500,
      body: { message: HUNTRESS_NOT_STARTED_MESSAGE },
    });
    expect(JSON.stringify(answer.body)).not.toContain("ECONNREFUSED");

    runFailure = null;

    const again: HuntressWebhookAnswer = await deliver(reportBody());

    expect(again.statusCode).toBe(200);
    expect(runs).toHaveLength(1);
  });
});

describe("what the workflow keeps of the last request", () => {
  test("the same refusal is written at most once a minute", async () => {
    workflows.set(
      SECRET_KEY,
      makeWorkflow({
        webhookSigningSecret: undefined,
        lastWebhookError: HUNTRESS_NO_SIGNING_SECRET_MESSAGE,
        lastWebhookErrorAt: new Date(
          NOW.getTime() - HUNTRESS_ERROR_RECORD_INTERVAL_MS + 1000,
        ),
      }),
    );

    await deliver(reportBody());

    expect(updates).toHaveLength(0);

    await deliver(reportBody(), {
      now: new Date(NOW.getTime() + 2000),
    });

    expect(updates).toHaveLength(1);
  });

  test("a different refusal is written at once", async () => {
    workflows.set(
      SECRET_KEY,
      makeWorkflow({
        isEnabled: false,
        lastWebhookError: HUNTRESS_NO_SIGNING_SECRET_MESSAGE,
        lastWebhookErrorAt: NOW,
      }),
    );

    await deliver(reportBody());

    expect(lastUpdate()?.["lastWebhookError"]).toBe(
      HUNTRESS_WORKFLOW_OFF_MESSAGE,
    );
  });

  test("failing to write it changes nothing about the answer", async () => {
    updateFailure = new Error("the database is busy");

    const answer: HuntressWebhookAnswer = await deliver(reportBody());

    expect(answer.statusCode).toBe(200);
    expect(runs).toHaveLength(1);

    workflows.set(SECRET_KEY, makeWorkflow({ isEnabled: false }));

    const refused: HuntressWebhookAnswer = await deliver(reportBody());

    expect(refused.statusCode).toBe(503);
  });
});

describe("isOrganizationWatched", () => {
  test("reads the trigger's setting, and an unset or odd one watches everything", () => {
    const event: { organization: { id: string | null; name: string | null } } =
      { organization: { id: "4", name: "Acme Corp" } };

    for (const triggerArguments of [
      undefined,
      {},
      { [HuntressTriggerSetting.Organizations]: 42 },
      { [HuntressTriggerSetting.Organizations]: "" },
    ]) {
      expect(
        HuntressWebhookHandler.isOrganizationWatched(
          { triggerArguments: triggerArguments } as never,
          event as never,
        ),
      ).toBe(true);
    }

    expect(
      HuntressWebhookHandler.isOrganizationWatched(
        {
          triggerArguments: {
            [HuntressTriggerSetting.Organizations]: "Globex",
          },
        },
        event as never,
      ),
    ).toBe(false);
  });
});
