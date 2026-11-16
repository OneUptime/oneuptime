import WebhookService, {
  WEBHOOK_REQUEST_TIMEOUT_MS,
  WEBHOOK_TARGET_VALIDATION,
} from "../../FeatureSet/Notification/Services/WebhookService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import WebhookLogService from "Common/Server/Services/WebhookLogService";
import SafeWebhookRequest from "Common/Server/Utils/SafeWebhookRequest";
import WebhookLog from "Common/Models/DatabaseModels/WebhookLog";
import OnCallTimelineRows from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import WebhookStatus from "Common/Types/WebhookStatus";
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
import crypto from "crypto";
import dns from "dns";
import http from "http";
import net, { AddressInfo, Socket } from "net";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

/*
 * A PROJECT'S WEBHOOK, AND A PERSON'S ON-CALL WEBHOOK, GO TO THE ADDRESS
 * THEIR URL CHECK APPROVED (issue #6611).
 *
 * WebhookService checked a webhook's URL and then let the HTTP client look
 * the name up again: a name that resolved publicly for the check could be
 * dialled at an internal address a moment later. These send for real, to a
 * server on this machine, under names the check is told about and this
 * machine's resolver is not, so only a request that dials what the check
 * approved reaches it. "localhost" is the exception: the check is told it is
 * at 127.0.0.2, this machine's resolver says 127.0.0.1 - DNS rebinding.
 */

const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";
const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const PROJECT_ID: ObjectID = new ObjectID(
  "66110000-0000-4000-8000-000000000001",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "66110000-0000-4000-8000-000000000002",
);
const SECRET: string = "webhook-secret-6611";

interface SeenRequest {
  url: string;
  host: string;
  signature: string;
  body: string;
}

let server: http.Server;
let port: number = 0;
let seen: Array<SeenRequest> = [];
let status: number = 200;
// Null: the endpoint takes the request and never answers.
let answerAfterInMs: number | null = 0;
const openSockets: Set<Socket> = new Set<Socket>();
let canUse127002: boolean = false;
let checkAnswers: Record<string, string> = {};
let logs: Array<WebhookLog> = [];
let timeline: OnCallTimelineRows;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  canUse127002 = await new Promise<boolean>(
    (resolve: (value: boolean) => void) => {
      const probe: http.Server = http.createServer();
      probe.once("error", () => {
        resolve(false);
      });
      probe.listen(0, "127.0.0.2", () => {
        probe.close(() => {
          resolve(true);
        });
      });
    },
  );

  server = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse) => {
      let body: string = "";

      request.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });

      request.on("end", () => {
        seen.push({
          url: request.url || "",
          host: request.headers["host"] || "",
          signature: String(request.headers["x-oneuptime-signature"] || ""),
          body: body,
        });

        if (answerAfterInMs === null) {
          return;
        }

        setTimeout(() => {
          if (status >= 300 && status < 400) {
            response.writeHead(status, {
              Location: `http://127.0.0.1:${port}/redirected`,
            });
            response.end();
            return;
          }

          response.writeHead(status, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ received: true }));
        }, answerAfterInMs);
      });
    },
  );

  server.on("connection", (socket: Socket) => {
    openSockets.add(socket);
    socket.on("close", () => {
      openSockets.delete(socket);
    });
  });

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();

  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  seen = [];
  status = 200;
  answerAfterInMs = 0;
  checkAnswers = {};
  logs = [];

  for (const name of [ALLOWLIST_ENV, ALLOW_ENV, "HTTP_PROXY", "http_proxy"]) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }

  // Loopback, named exactly: the one way a webhook may reach this machine.
  process.env[ALLOWLIST_ENV] = "localhost,127.0.0.0/8";

  jest.spyOn(dns.promises, "lookup").mockImplementation((async (
    hostname: string,
  ) => {
    const address: string | undefined = checkAnswers[hostname];

    if (!address) {
      const error: NodeJS.ErrnoException = new Error(
        `getaddrinfo ENOTFOUND ${hostname}`,
      );
      error.code = "ENOTFOUND";
      throw error;
    }

    return [{ address: address, family: net.isIP(address) }];
  }) as never);

  jest.spyOn(WebhookLogService, "create").mockImplementation((async (data: {
    data: WebhookLog;
  }) => {
    logs.push(data.data);
    return data.data;
  }) as never);

  timeline = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);
});

afterEach(() => {
  jest.restoreAllMocks();

  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

async function send(
  url: string,
  options?: { onCall?: boolean | undefined },
): Promise<void> {
  await WebhookService.sendWebhook(
    {
      url: url,
      eventType: "incident.created",
      payload: { incident: "Checkout API is down" },
      secret: SECRET,
    },
    {
      projectId: PROJECT_ID,
      ...(options?.onCall ? { userOnCallLogTimelineId: TIMELINE_ID } : {}),
    },
  );
}

function onlyLog(): WebhookLog {
  expect(logs).toHaveLength(1);
  return logs[0]!;
}

describe("a project's webhook", () => {
  test("dials the address the check approved: a name only the check knows is reached, signed", async () => {
    checkAnswers["hooks.pinned.example"] = "127.0.0.1";

    await send(`http://hooks.pinned.example:${port}/hook`);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.host).toBe(`hooks.pinned.example:${port}`);
    expect(seen[0]!.signature).toBe(
      `sha256=${crypto.createHmac("sha256", SECRET).update(seen[0]!.body).digest("hex")}`,
    );
    expect(onlyLog().status).toBe(WebhookStatus.Success);
  });

  test("a name that resolves elsewhere after the check is not dialled there: logged as an error, and thrown", async () => {
    if (!canUse127002) {
      return;
    }

    // This machine resolves localhost to 127.0.0.1, where the server is.
    checkAnswers["localhost"] = "127.0.0.2";

    await expect(send(`http://localhost:${port}/hook`)).rejects.toThrow(
      /ECONNREFUSED 127\.0\.0\.2/,
    );

    expect(seen).toHaveLength(0);
    expect(onlyLog().status).toBe(WebhookStatus.Error);
  });

  test("follows no redirect: the endpoint's 302 is logged, and where it points is never asked", async () => {
    status = 302;

    await send(`http://127.0.0.1:${port}/hook`);

    expect(
      seen.map((request: SeenRequest) => {
        return request.url;
      }),
    ).toEqual(["/hook"]);
    expect(onlyLog().status).toBe(WebhookStatus.Error);
    expect(onlyLog().statusMessage).toBe(
      "Webhook endpoint returned status 302.",
    );
  });

  test("a private address is refused where the instance allows none, and posted to where it allows them", async () => {
    process.env[ALLOWLIST_ENV] = "";
    checkAnswers["internal.example"] = "10.20.30.40";

    await expect(send("http://internal.example/hook")).rejects.toThrow(
      "Webhook URL resolves to a private network address and is not allowed. Self-hosted instances can allow this by setting ALLOW_PRIVATE_NETWORK_WEBHOOKS or PRIVATE_NETWORK_WEBHOOK_ALLOWLIST.",
    );
    expect(onlyLog().status).toBe(WebhookStatus.Error);

    process.env[ALLOW_ENV] = "true";
    logs = [];
    const sendSpy: jest.SpiedFunction<typeof SafeWebhookRequest.send> = jest
      .spyOn(SafeWebhookRequest, "send")
      .mockRejectedValue(new Error("not sent in this test") as never);

    await expect(send("http://internal.example/hook")).rejects.toThrow(
      "not sent in this test",
    );

    // Sent, to what the check approved, and given a person's webhook's timeout.
    expect(sendSpy.mock.calls[0]![0].addresses).toEqual([
      { address: "10.20.30.40", family: 4 },
    ]);
    expect(sendSpy.mock.calls[0]![1]?.timeout).toBe(WEBHOOK_REQUEST_TIMEOUT_MS);
  });

  test("loopback and the cloud metadata endpoint are refused on the most permissive setting", async () => {
    process.env[ALLOWLIST_ENV] = "";
    process.env[ALLOW_ENV] = "true";

    for (const url of [
      `http://127.0.0.1:${port}/hook`,
      "http://169.254.169.254/latest/meta-data/",
    ]) {
      await expect(send(url)).rejects.toThrow(
        "Webhook URL points to a private, loopback, or link-local address and is not allowed.",
      );
    }

    expect(seen).toHaveLength(0);
  });

  test("is held to the rule a project member's URL always had", () => {
    expect(WEBHOOK_TARGET_VALIDATION).toEqual({
      allowPrivateNetworkTargets: true,
    });
  });

  test("an endpoint that takes the request and never answers fails at the timeout, is logged an error, and its connection is closed", async () => {
    answerAfterInMs = null;

    // A person's webhook waits ten seconds; here a fiftieth of that.
    const realSend: typeof SafeWebhookRequest.send =
      SafeWebhookRequest.send.bind(SafeWebhookRequest);
    jest.spyOn(SafeWebhookRequest, "send").mockImplementation(((
      ...args: Parameters<typeof SafeWebhookRequest.send>
    ) => {
      return realSend(args[0], {
        ...(args[1] || {}),
        timeout: (args[1]?.timeout || 0) / 50,
      });
    }) as typeof SafeWebhookRequest.send);

    await expect(send(`http://127.0.0.1:${port}/hook`)).rejects.toThrow(
      /timeout/i,
    );

    expect(onlyLog().status).toBe(WebhookStatus.Error);

    const deadline: number = Date.now() + 2000;

    while (openSockets.size > 0 && Date.now() < deadline) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 10);
      });
    }

    expect(openSockets.size).toBe(0);
  });
});

describe("a person's on-call webhook", () => {
  test("is sent the same way: to the approved address, and its page's entry says it was sent", async () => {
    checkAnswers["oncall.pinned.example"] = "127.0.0.1";

    await send(`http://oncall.pinned.example:${port}/page`, { onCall: true });

    expect(seen).toHaveLength(1);
    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Sent,
    });
  });

  test("one whose name resolves elsewhere after the check is not dialled there, and its page's entry says it failed", async () => {
    if (!canUse127002) {
      return;
    }

    checkAnswers["localhost"] = "127.0.0.2";

    await expect(
      send(`http://localhost:${port}/page`, { onCall: true }),
    ).rejects.toThrow(/ECONNREFUSED 127\.0\.0\.2/);

    expect(seen).toHaveLength(0);
    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Error,
    });
  });
});
