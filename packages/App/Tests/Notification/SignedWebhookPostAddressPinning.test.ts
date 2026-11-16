import CallAndSmsGatewayService, {
  CallAndSmsGatewayResult,
} from "../../FeatureSet/Notification/Services/CallAndSmsGatewayService";
import SignedWebhookPost, {
  SIGNED_WEBHOOK_MAX_ATTEMPTS,
  SIGNED_WEBHOOK_TARGET_VALIDATION,
  SignedPostOutcome,
} from "../../FeatureSet/Notification/Utils/SignedWebhookPost";
import SafeWebhookRequest, {
  WEBHOOK_MAX_RESPONSE_BYTES,
  WebhookTarget,
} from "Common/Server/Utils/SafeWebhookRequest";
import { CallAndSmsGatewayEvent } from "Common/Types/CallAndSMS/CallAndSmsGatewayPayload";
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
import type { SpyInstance } from "jest-mock";
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
 * THE SMS AND CALL GATEWAY'S REQUESTS, AND A CUSTOM CHANNEL'S, GO TO THE
 * ADDRESS THEIR URL CHECK APPROVED (issue #6611).
 *
 * Both check the service's URL (SIGNED_WEBHOOK_TARGET_VALIDATION) and hand
 * the approved target to SignedWebhookPost, which tries a request up to
 * three times. Every attempt used to look the name up again. These send for
 * real, to a server on this machine, under names the check is told about
 * and this machine's resolver is not.
 */

const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";
const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const SECRET: string = "g".repeat(64);

interface SeenRequest {
  url: string;
  host: string;
  signature: string;
  body: string;
}

let server: http.Server;
let port: number = 0;
let seen: Array<SeenRequest> = [];
let statuses: Array<number> = [];
let answers: boolean = true;
// How many bytes the service answers with, when told to; otherwise "{}".
let answerBytes: number | null = null;
const openSockets: Set<Socket> = new Set<Socket>();
let canUse127002: boolean = false;
let checkAnswers: Record<string, string> = {};
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

        if (!answers) {
          return;
        }

        const status: number = statuses.shift() || 200;

        if (status >= 300 && status < 400) {
          response.writeHead(status, {
            Location: `http://127.0.0.1:${port}/redirected`,
          });
          response.end();
          return;
        }

        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(
          answerBytes === null ? "{}" : `"${"x".repeat(answerBytes)}"`,
        );
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
  statuses = [];
  answers = true;
  answerBytes = null;
  checkAnswers = {};

  for (const name of [ALLOWLIST_ENV, ALLOW_ENV, "HTTP_PROXY", "http_proxy"]) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }

  // Loopback, named exactly: the one way the service may be on this machine.
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

  jest.spyOn(SignedWebhookPost, "sleep").mockResolvedValue();
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

async function postTo(url: string): Promise<SignedPostOutcome> {
  const target: WebhookTarget = await SafeWebhookRequest.resolveTarget(
    url,
    SIGNED_WEBHOOK_TARGET_VALIDATION,
  );

  return await SignedWebhookPost.post({
    target: target,
    secret: SECRET,
    eventType: "sms",
    payload: { to: "+15555550123", message: "Incident #42" },
    userAgent: "OneUptime-Test/1.0",
  });
}

describe("a signed request", () => {
  test("dials the address the check approved: a name only the check knows is reached, signed over its exact body", async () => {
    checkAnswers["gateway.pinned.example"] = "127.0.0.1";

    const outcome: SignedPostOutcome = await postTo(
      `http://gateway.pinned.example:${port}/oneuptime`,
    );

    expect(outcome).toEqual({
      isDelivered: true,
      statusCode: 200,
      error: undefined,
      attempts: 1,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.host).toBe(`gateway.pinned.example:${port}`);
    expect(seen[0]!.signature).toBe(
      `sha256=${crypto.createHmac("sha256", SECRET).update(seen[0]!.body).digest("hex")}`,
    );
  });

  test("every attempt of a service that is restarting dials the approved address", async () => {
    checkAnswers["gateway.pinned.example"] = "127.0.0.1";
    statuses = [503, 503, 200];

    const outcome: SignedPostOutcome = await postTo(
      `http://gateway.pinned.example:${port}/oneuptime`,
    );

    expect(outcome.isDelivered).toBe(true);
    expect(outcome.attempts).toBe(3);
    expect(seen).toHaveLength(3);
  });

  test("a name that resolves elsewhere after the check is not dialled there, on any attempt", async () => {
    if (!canUse127002) {
      return;
    }

    // This machine resolves localhost to 127.0.0.1, where the server is.
    checkAnswers["localhost"] = "127.0.0.2";

    const outcome: SignedPostOutcome = await postTo(
      `http://localhost:${port}/oneuptime`,
    );

    expect(outcome.isDelivered).toBe(false);
    expect(outcome.attempts).toBe(SIGNED_WEBHOOK_MAX_ATTEMPTS);
    expect(outcome.error).toMatch(/ECONNREFUSED 127\.0\.0\.2/);
    expect(seen).toHaveLength(0);
  });

  test("follows no redirect: not delivered, not tried again, and where it points is never asked", async () => {
    statuses = [302];

    const outcome: SignedPostOutcome = await postTo(
      `http://127.0.0.1:${port}/oneuptime`,
    );

    expect(outcome).toMatchObject({
      isDelivered: false,
      statusCode: 302,
      attempts: 1,
    });
    expect(
      seen.map((request: SeenRequest) => {
        return request.url;
      }),
    ).toEqual(["/oneuptime"]);
  });

  test("a service that takes the request and never answers fails each attempt at its timeout, and every connection is closed", async () => {
    answers = false;

    // An attempt waits ten seconds; here a fiftieth of that.
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

    const outcome: SignedPostOutcome = await postTo(
      `http://127.0.0.1:${port}/oneuptime`,
    );

    expect(outcome.isDelivered).toBe(false);
    expect(outcome.attempts).toBe(SIGNED_WEBHOOK_MAX_ATTEMPTS);
    expect(outcome.error).toMatch(/timeout/i);

    const deadline: number = Date.now() + 2000;

    while (openSockets.size > 0 && Date.now() < deadline) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 10);
      });
    }

    expect(openSockets.size).toBe(0);
  });
});

describe("an answer larger than a webhook's can be", () => {
  test("is not read: not delivered, on any attempt", async () => {
    answerBytes = WEBHOOK_MAX_RESPONSE_BYTES * 2;

    const outcome: SignedPostOutcome = await postTo(
      `http://127.0.0.1:${port}/oneuptime`,
    );

    expect(outcome.isDelivered).toBe(false);
    expect(outcome.error).toBe(
      "The answer was larger than 1 MB, so it was not read.",
    );
  });
});

describe("the SMS and call gateway", () => {
  test("a gateway on a private address is refused where the instance allows none, and nothing is sent", async () => {
    process.env[ALLOWLIST_ENV] = "";
    checkAnswers["gateway.corp.example"] = "10.20.30.40";
    const sendSpy: SpyInstance<
      (
        ...args: Parameters<typeof SafeWebhookRequest.send>
      ) => ReturnType<typeof SafeWebhookRequest.send>
    > = jest.spyOn(SafeWebhookRequest, "send");

    const result: CallAndSmsGatewayResult = await CallAndSmsGatewayService.send(
      {
        gateway: {
          url: "https://gateway.corp.example/oneuptime",
          secret: SECRET,
        },
        event: CallAndSmsGatewayEvent.Sms,
        payload: { to: "+15555550123" },
      },
    );

    expect(result).toEqual({
      ok: false,
      message:
        "Not delivered: the URL of the SMS and call gateway is not allowed. Your administrator can see why in the server's log.",
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("where the instance allows private networks, it is sent to the address its check approved", async () => {
    process.env[ALLOWLIST_ENV] = "";
    process.env[ALLOW_ENV] = "true";
    checkAnswers["gateway.corp.example"] = "10.20.30.40";
    const sendSpy: SpyInstance<
      (
        ...args: Parameters<typeof SafeWebhookRequest.send>
      ) => ReturnType<typeof SafeWebhookRequest.send>
    > = jest
      .spyOn(SafeWebhookRequest, "send")
      .mockRejectedValue(new Error("not sent in this test") as never);

    await CallAndSmsGatewayService.send({
      gateway: {
        url: "https://gateway.corp.example/oneuptime",
        secret: SECRET,
      },
      event: CallAndSmsGatewayEvent.Sms,
      payload: { to: "+15555550123" },
    });

    expect(sendSpy.mock.calls[0]![0].addresses).toEqual([
      { address: "10.20.30.40", family: 4 },
    ]);
  });

  test("the cloud metadata endpoint is refused on the most permissive setting", async () => {
    process.env[ALLOW_ENV] = "true";

    const result: CallAndSmsGatewayResult = await CallAndSmsGatewayService.send(
      {
        gateway: {
          url: "http://169.254.169.254/latest/meta-data/",
          secret: SECRET,
        },
        event: CallAndSmsGatewayEvent.Sms,
        payload: { to: "+15555550123" },
      },
    );

    expect(result.ok).toBe(false);
    expect(seen).toHaveLength(0);
  });
});
