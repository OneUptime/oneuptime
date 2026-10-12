import SendMessageToChannel, {
  MATTERMOST_MAX_STEP_TIME_IN_MS,
} from "../../../../../Server/Types/Workflow/Components/Mattermost/SendMessageToChannel";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import DataSourceEgressGuard, {
  PinnedAgents,
  ResolvedAddress,
} from "../../../../../Server/Utils/DataSource/EgressGuard";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { MATTERMOST_MAX_MESSAGE_LENGTH } from "../../../../../Types/Workflow/Components/Mattermost";
import { TRUNCATED_TEXT_NOTE } from "../../../../../Utils/MessageFit";
import {
  FakeMattermostAnswer,
  FakeMattermostServer,
  MATTERMOST_OK,
  ReceivedRequest,
  getClosedPort,
  mattermostAppError,
  startFakeMattermostServer,
} from "../../../Utils/Mattermost/FakeMattermostServer";
import {
  TestCertificate,
  createTestCertificate,
} from "../../../Utils/IRC/TestCertificate";
/*
 * jest itself is the global one: @jest/globals types jest.spyOn() as a spy
 * the global jest.SpiedFunction annotations here do not accept.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import dns from "dns";
import tls from "tls";

/*
 * "Send Message to Mattermost" against a Mattermost of its own: a real HTTP
 * (and HTTPS) server on 127.0.0.1 that answers as Mattermost's incoming
 * webhooks do. Nothing about the request is mocked - the address guard, the
 * pinned lookup, axios and the socket are the ones production uses.
 *
 * The server is reached the way a self-hosted operator reaches theirs: by a
 * name, mattermost.internal, that the operator put on the webhook allowlist
 * (PRIVATE_NETWORK_WEBHOOK_ALLOWLIST). The guard's DNS lookup is the one
 * thing answered here, with 127.0.0.1; a real lookup of the name finds
 * nothing, so a request that arrives at all was dialled at the address the
 * guard approved, not at one looked up again.
 */

/*
 * Common's suites run under jsdom, where jest resolves axios to its browser
 * build - whose `http` adapter is a placeholder. The step names the Node
 * adapter explicitly (production runs in Node), so give it the Node build,
 * the way OAuth2TokenClientHttpIntegration.test.ts does.
 */
jest.mock("axios", () => {
  return jest.requireActual("axios/dist/node/axios.cjs");
});

const HOOK_ID: string = "3fd8pjcne7ry5bauiz8kpfo3hy";
const HOST: string = "mattermost.internal";

const WEBHOOK_ENV: Array<string> = [
  "ALLOW_PRIVATE_NETWORK_WEBHOOKS",
  "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
];

interface StepRun {
  port: string;
  returnValues: JSONObject;
  logs: Array<string>;
}

type LookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

let servers: Array<FakeMattermostServer> = [];
let savedEnv: Record<string, string | undefined> = {};
let addressesByName: Record<string, Array<string>> = {};
let lookupSpy: LookupSpy;

function makeOptions(
  logs: Array<string>,
  remainingInMs?: number | undefined,
): RunOptions {
  return {
    log: ((item: unknown) => {
      logs.push(typeof item === "string" ? item : JSON.stringify(item));
    }) as RunOptions["log"],
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    onError: ((exception: Exception): Exception => {
      return exception;
    }) as RunOptions["onError"],
    executeWorkflow: async (): Promise<void> => {},
    getRemainingExecutionTimeInMs:
      remainingInMs === undefined
        ? undefined
        : (): number => {
            return remainingInMs;
          },
  };
}

async function run(
  args: JSONObject,
  remainingInMs?: number | undefined,
): Promise<StepRun> {
  const logs: Array<string> = [];
  const result: RunReturnType = await new SendMessageToChannel().run(
    args,
    makeOptions(logs, remainingInMs),
  );

  return {
    port: result.executePort?.id || "",
    returnValues: result.returnValues,
    logs: logs,
  };
}

// The run stops: the step throws, through onError, before anything is sent.
async function refusal(args: JSONObject): Promise<Error> {
  try {
    await new SendMessageToChannel().run(args, makeOptions([]));
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected the step to stop the run");
}

async function serve(
  answer?: (request: ReceivedRequest) => FakeMattermostAnswer,
  certificate?: TestCertificate | undefined,
): Promise<FakeMattermostServer> {
  const server: FakeMattermostServer = await startFakeMattermostServer({
    answer: answer,
    tls: certificate,
  });

  servers.push(server);

  return server;
}

function webhookUrl(
  server: FakeMattermostServer | { port: number },
  options: { scheme?: string; host?: string; path?: string } = {},
): string {
  return `${options.scheme || "http"}://${options.host || HOST}:${server.port}${options.path || ""}/hooks/${HOOK_ID}`;
}

// What a step's error says, and what it must never: the webhook's secret.
function expectNoSecret(text: string): void {
  expect(text).not.toContain(HOOK_ID);
  expect(text).not.toContain("/hooks/" + HOOK_ID);
}

// Trust a test certificate, the way NODE_EXTRA_CA_CERTS would in production.
function trust(certificate: TestCertificate): void {
  const realConnect: typeof tls.connect = tls.connect;

  jest.spyOn(tls, "connect").mockImplementation(((
    connectOptions: tls.ConnectionOptions,
  ) => {
    return realConnect({ ...connectOptions, ca: [certificate.cert] });
  }) as never);
}

beforeEach(() => {
  savedEnv = {};

  for (const name of WEBHOOK_ENV) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }

  // The operator named their internal Mattermost.
  process.env["PRIVATE_NETWORK_WEBHOOK_ALLOWLIST"] = HOST;

  addressesByName = { [HOST]: ["127.0.0.1"] };

  lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;
  lookupSpy.mockImplementation((async (hostname: string) => {
    const addresses: Array<string> | undefined = addressesByName[hostname];

    if (!addresses) {
      const error: NodeJS.ErrnoException = new Error(
        `getaddrinfo ENOTFOUND ${hostname}`,
      );
      error.code = "ENOTFOUND";
      throw error;
    }

    return addresses.map((address: string) => {
      return { address: address, family: address.includes(":") ? 6 : 4 };
    });
  }) as never);
});

afterEach(async () => {
  jest.restoreAllMocks();

  for (const server of servers) {
    await server.close();
  }

  servers = [];

  for (const name of WEBHOOK_ENV) {
    if (savedEnv[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = savedEnv[name];
    }
  }
});

describe("Send Message to Mattermost posts to the incoming webhook", () => {
  test("POSTs the text as Mattermost's JSON, to the webhook's path, and takes Success", async () => {
    const server: FakeMattermostServer = await serve();

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: "Incident #42 declared",
    });

    expect(result.port).toBe("success");
    expect(result.returnValues).toEqual({});
    expect(result.logs).toContain("Mattermost took the message.");

    expect(server.requests).toHaveLength(1);
    const request: ReceivedRequest = server.requests[0]!;

    expect(request.method).toBe("POST");
    expect(request.url).toBe(`/hooks/${HOOK_ID}`);
    expect(request.headers["content-type"]).toMatch(/^application\/json/);
    expect(request.headers["user-agent"]).toMatch(/^OneUptime/);
    expect(JSON.parse(request.body)).toEqual({ text: "Incident #42 declared" });
  });

  test("sends the text exactly as typed: Markdown, mentions, line breaks and emoji are Mattermost's to read", async () => {
    const server: FakeMattermostServer = await serve();
    const text: string =
      ":rotating_light: **Incident 42**\n_Severity:_ Critical | @channel\n> quoted `code` <https://example.com|link> 🚨";

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: text,
    });

    expect(result.port).toBe("success");
    expect(JSON.parse(server.requests[0]!.body)["text"]).toBe(text);
  });

  test("puts Channel, Username and Icon URL in only when they are filled in", async () => {
    const server: FakeMattermostServer = await serve();

    await run({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
      channel: "town-square",
      username: "OneUptime",
      "icon-url": "https://example.com/oneuptime.png",
    });

    await run({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
      channel: "   ",
      username: "",
      "icon-url": "",
    });

    expect(JSON.parse(server.requests[0]!.body)).toEqual({
      text: "Deploy finished",
      channel: "town-square",
      username: "OneUptime",
      icon_url: "https://example.com/oneuptime.png",
    });
    expect(JSON.parse(server.requests[1]!.body)).toEqual({
      text: "Deploy finished",
    });
  });

  test("names the channel it posted to in the log", async () => {
    const server: FakeMattermostServer = await serve();

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
      channel: "~Ops-Alerts",
    });

    expect(result.logs).toContain(
      "Mattermost took the message for ops-alerts.",
    );
    expect(JSON.parse(server.requests[0]!.body)["channel"]).toBe("ops-alerts");
  });

  test.each([
    ["town-square", "town-square"],
    ["~town-square", "town-square"],
    ["#town-square", "town-square"],
    ["Town-Square", "town-square"],
    ["  ops_alerts  ", "ops_alerts"],
    ["@jane.doe", "@jane.doe"],
    ["@Jane.Doe", "@jane.doe"],
    [
      "4xp9fdt77pncbef59f4k1qe83o__9a6u3eqz9fbjxctjo4ixnmz4ie",
      "4xp9fdt77pncbef59f4k1qe83o__9a6u3eqz9fbjxctjo4ixnmz4ie",
    ],
  ])("Channel %j is sent as %j", async (typed: string, sent: string) => {
    const server: FakeMattermostServer = await serve();

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
      channel: typed,
    });

    expect(result.port).toBe("success");
    expect(JSON.parse(server.requests[0]!.body)["channel"]).toBe(sent);
  });

  test("a webhook served under a path of its own, or on another port, is posted to there", async () => {
    const server: FakeMattermostServer = await serve();

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server, { path: "/chat/mattermost" }),
      text: "Deploy finished",
    });

    expect(result.port).toBe("success");
    expect(server.requests[0]!.url).toBe(`/chat/mattermost/hooks/${HOOK_ID}`);
  });

  test("a URL pasted with a line break or spaces around it is still the URL", async () => {
    const server: FakeMattermostServer = await serve();

    const result: StepRun = await run({
      "webhook-url": `  ${webhookUrl(server)}\r\n`,
      text: "Deploy finished",
    });

    expect(result.port).toBe("success");
    expect(server.requests).toHaveLength(1);
  });

  test("text a reference left as a number or an object is sent as text", async () => {
    const server: FakeMattermostServer = await serve();

    await run({ "webhook-url": webhookUrl(server), text: 42 });
    await run({
      "webhook-url": webhookUrl(server),
      text: { incident: "42" } as JSONObject,
    });

    expect(JSON.parse(server.requests[0]!.body)["text"]).toBe("42");
    expect(JSON.parse(server.requests[1]!.body)["text"]).toBe(
      '{"incident":"42"}',
    );
  });
});

describe("a message longer than a Mattermost post", () => {
  test("one that fits is sent whole, and nothing is said about it", async () => {
    const server: FakeMattermostServer = await serve();
    const text: string = "x".repeat(MATTERMOST_MAX_MESSAGE_LENGTH);

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: text,
    });

    expect(JSON.parse(server.requests[0]!.body)["text"]).toBe(text);
    expect(
      result.logs.some((line: string) => {
        return line.includes("cut to fit");
      }),
    ).toBe(false);
  });

  test("a longer one is cut to one post, at a line break, ending with the note, and the log says so", async () => {
    const server: FakeMattermostServer = await serve();
    const text: string = `Deploy log:\n${"step finished\n".repeat(2000)}`;

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: text,
    });

    const sent: string = JSON.parse(server.requests[0]!.body)["text"];

    expect(result.port).toBe("success");
    expect(sent.length).toBeLessThanOrEqual(MATTERMOST_MAX_MESSAGE_LENGTH);
    expect(sent.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
    expect(sent.startsWith("Deploy log:\nstep finished\n")).toBe(true);
    // Cut between lines, not inside one.
    expect(sent.slice(0, -TRUNCATED_TEXT_NOTE.length)).toMatch(
      /step finished$/,
    );
    expect(result.logs).toContain(
      `Message Text is longer than a Mattermost post can be (16,383 characters), so it was cut to fit and ends with "${TRUNCATED_TEXT_NOTE}".`,
    );
  });

  test("an emoji at the cut is not split in two", async () => {
    const server: FakeMattermostServer = await serve();
    // One character short of the limit, then emoji: the cut falls inside one.
    const text: string = "a".repeat(16000) + "🚨".repeat(1000);

    await run({ "webhook-url": webhookUrl(server), text: text });

    const sent: string = JSON.parse(server.requests[0]!.body)["text"];
    const beforeNote: string = sent.slice(0, -TRUNCATED_TEXT_NOTE.length);
    const last: number = beforeNote.charCodeAt(beforeNote.length - 1);

    // Not a lone high surrogate: the last emoji is whole.
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    expect(sent.length).toBeLessThanOrEqual(MATTERMOST_MAX_MESSAGE_LENGTH);
  });

  test("sixteen megabytes on one line are cut quickly, and only one post goes out", async () => {
    const server: FakeMattermostServer = await serve();
    const text: string = "A".repeat(16 * 1024 * 1024);
    const startedAt: number = Date.now();

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: text,
    });

    expect(result.port).toBe("success");
    expect(server.requests).toHaveLength(1);
    expect(
      JSON.parse(server.requests[0]!.body)["text"].length,
    ).toBeLessThanOrEqual(MATTERMOST_MAX_MESSAGE_LENGTH);
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });
});

describe("what Mattermost refuses takes the Error port, with Mattermost's reason", () => {
  test.each([
    [
      mattermostAppError(
        404,
        "web.incoming_webhook.invalid.app_error",
        "Invalid webhook.",
      ),
      "Mattermost refused the message (HTTP 404 Not Found): Invalid webhook. The webhook may have been deleted: add a new one, and use its URL.",
    ],
    [
      mattermostAppError(
        501,
        "web.incoming_webhook.disabled.app_error",
        "Incoming webhooks have been disabled by the system admin.",
      ),
      "Mattermost could not take the message (HTTP 501 Not Implemented): Incoming webhooks have been disabled by the system admin. A Mattermost system admin turns incoming webhooks on in the System Console, under Integrations.",
    ],
    [
      mattermostAppError(
        403,
        "web.incoming_webhook.channel_locked.app_error",
        "This webhook is not permitted to post to the requested channel.",
      ),
      "Mattermost refused the message (HTTP 403 Forbidden): This webhook is not permitted to post to the requested channel. This webhook is locked to its own channel: leave Channel empty, or use a webhook that is not locked.",
    ],
    [
      mattermostAppError(
        400,
        "web.incoming_webhook.user.app_error",
        "Couldn't find the user.",
      ),
      "Mattermost refused the message (HTTP 400 Bad Request): Couldn't find the user.",
    ],
    [
      mattermostAppError(
        403,
        "api.post.create_post.town_square_read_only",
        "This channel is read-only. Only members with permission can post here",
      ),
      "Mattermost refused the message (HTTP 403 Forbidden): This channel is read-only. Only members with permission can post here.",
    ],
  ])(
    "an AppError is quoted, with what to do about it where that is known (%#)",
    async (answer: FakeMattermostAnswer, error: string) => {
      const server: FakeMattermostServer = await serve(() => {
        return answer;
      });

      const result: StepRun = await run({
        "webhook-url": webhookUrl(server),
        text: "Deploy finished",
      });

      expect(result.port).toBe("error");
      expect(result.returnValues["error"]).toBe(error);
      expect(result.logs).toContain(error);
    },
  );

  test("Couldn't find the channel says how Channel is written, but only when Channel was filled in", async () => {
    const server: FakeMattermostServer = await serve(() => {
      return mattermostAppError(
        404,
        "web.incoming_webhook.channel.app_error",
        "Couldn't find the channel.",
      );
    });

    const withChannel: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
      channel: "ops",
    });
    const withoutChannel: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
    });

    expect(withChannel.returnValues["error"]).toBe(
      "Mattermost refused the message (HTTP 404 Not Found): Couldn't find the channel. Channel takes the channel's name as its URL shows it, such as town-square, not the name it is shown under.",
    );
    expect(withoutChannel.returnValues["error"]).toBe(
      "Mattermost refused the message (HTTP 404 Not Found): Couldn't find the channel.",
    );
  });

  test("Mattermost's reason is shown as one short line: control and direction characters go, a long one is cut", async () => {
    const reason: string = `Bad\u0000thing\r\nhappened\u202e here.${" and more".repeat(100)}`;
    const server: FakeMattermostServer = await serve(() => {
      return mattermostAppError(400, "some.app_error", reason);
    });

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
    });

    const error: string = String(result.returnValues["error"]);

    expect(
      error.startsWith(
        "Mattermost refused the message (HTTP 400 Bad Request): Bad thing happened here. and more",
      ),
    ).toBe(true);
    expect(error.endsWith("…")).toBe(true);
    expect(
      Array.from(error).some((character: string) => {
        const code: number = character.codePointAt(0) as number;
        return code < 0x20 || (code >= 0x202a && code <= 0x202e);
      }),
    ).toBe(false);
    expect(error.length).toBeLessThan(400);
  });

  test.each([
    [
      502,
      "<html><body>502 Bad Gateway nginx INTERNAL-DETAIL</body></html>",
      "text/html",
      "Mattermost did not take the message: the server answered HTTP 502 Bad Gateway.",
    ],
    [
      429,
      "limit exceeded",
      "text/plain",
      "Mattermost did not take the message: the server answered HTTP 429 Too Many Requests.",
    ],
    [
      500,
      '{"error": "INTERNAL-DETAIL"}',
      "application/json",
      "Mattermost did not take the message: the server answered HTTP 500 Internal Server Error.",
    ],
    [
      404,
      "<html>INTERNAL-DETAIL</html>",
      "text/html",
      "Mattermost did not take the message: the server answered HTTP 404 Not Found, and not as Mattermost answers. Check that Mattermost Incoming Webhook URL is the webhook's URL, as Mattermost shows it.",
    ],
    [
      599,
      "",
      "text/plain",
      "Mattermost did not take the message: the server answered HTTP 599.",
    ],
  ])(
    "an answer that is not Mattermost's is reported by its status alone (HTTP %i)",
    async (
      status: number,
      body: string,
      contentType: string,
      error: string,
    ) => {
      const server: FakeMattermostServer = await serve(() => {
        return { status, body, headers: { "Content-Type": contentType } };
      });

      const result: StepRun = await run({
        "webhook-url": webhookUrl(server),
        text: "Deploy finished",
      });

      expect(result.port).toBe("error");
      expect(result.returnValues["error"]).toBe(error);
      expect(JSON.stringify(result)).not.toContain("INTERNAL-DETAIL");
    },
  );

  test.each([301, 302, 307, 308])(
    "a redirect (HTTP %i) is not followed: the address it names gets nothing",
    async (status: number) => {
      const elsewhere: FakeMattermostServer = await serve();
      const server: FakeMattermostServer = await serve(() => {
        return {
          status: status,
          headers: {
            Location: `http://127.0.0.1:${elsewhere.port}/hooks/${HOOK_ID}`,
          },
        };
      });

      const result: StepRun = await run({
        "webhook-url": webhookUrl(server),
        text: "Deploy finished",
      });

      expect(result.port).toBe("error");
      expect(result.returnValues["error"]).toContain(
        "the server answered with a redirect",
      );
      expect(result.returnValues["error"]).toContain(
        "with https:// if the server uses it.",
      );
      expect(server.requests).toHaveLength(1);
      expect(elsewhere.requests).toHaveLength(0);
    },
  );

  test("any 2xx is Mattermost taking the message", async () => {
    const server: FakeMattermostServer = await serve(() => {
      return { status: 201, body: "", headers: {} };
    });

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
    });

    expect(result.port).toBe("success");
  });
});

describe("when no answer comes back, the Error port says why", () => {
  test("a server that never answers is given up on within the step's time, inside the workflow's", async () => {
    const server: FakeMattermostServer = await serve(() => {
      return { status: 200, delayInMs: Infinity };
    });
    const startedAt: number = Date.now();

    // 4.5 s of the workflow left: 2 s kept back, 2.5 s for the step.
    const result: StepRun = await run(
      { "webhook-url": webhookUrl(server), text: "Deploy finished" },
      4500,
    );

    expect(result.port).toBe("error");
    expect(result.returnValues["error"]).toMatch(
      /^Mattermost did not answer within \d seconds, so the message may not have been posted\.$/,
    );
    expect(Date.now() - startedAt).toBeLessThan(4500);
    expect(server.requests).toHaveLength(1);
  });

  test("with less than the step needs left of the workflow's time, nothing is sent", async () => {
    const server: FakeMattermostServer = await serve();

    const result: StepRun = await run(
      { "webhook-url": webhookUrl(server), text: "Deploy finished" },
      3000,
    );

    expect(result.port).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "Not enough of the workflow's run time is left to send a message to Mattermost.",
    );
    expect(server.requests).toHaveLength(0);
  });

  test("the step's time is at most 30 seconds, however much the workflow has left", () => {
    expect(
      SendMessageToChannel.getTimeoutInMs(makeOptions([], 10 * 60 * 1000)),
    ).toBe(MATTERMOST_MAX_STEP_TIME_IN_MS);
    expect(MATTERMOST_MAX_STEP_TIME_IN_MS).toBe(30 * 1000);
    expect(SendMessageToChannel.getTimeoutInMs(makeOptions([]))).toBe(
      MATTERMOST_MAX_STEP_TIME_IN_MS,
    );
    expect(SendMessageToChannel.getTimeoutInMs(makeOptions([], 12_000))).toBe(
      10_000,
    );
  });

  test("a refused connection", async () => {
    const port: number = await getClosedPort();

    const result: StepRun = await run({
      "webhook-url": webhookUrl({ port }),
      text: "Deploy finished",
    });

    expect(result.port).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "The Mattermost server refused the connection. Check the server and port in Mattermost Incoming Webhook URL.",
    );
  });

  test("a connection closed before the answer", async () => {
    const server: FakeMattermostServer = await serve(() => {
      return { status: 200, hangUp: true };
    });

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
    });

    expect(result.port).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "The connection to the Mattermost server closed before it answered, so the message may not have been posted.",
    );
  });

  test("an answer larger than a webhook's is not read", async () => {
    const server: FakeMattermostServer = await serve(() => {
      return {
        status: 400,
        body: JSON.stringify({ message: "x".repeat(200 * 1024) }),
        headers: { "Content-Type": "application/json" },
      };
    });

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
    });

    expect(result.port).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "Mattermost's answer was larger than an answer to a webhook can be, so it was not read.",
    );
  });

  test("a name that does not resolve", async () => {
    process.env["PRIVATE_NETWORK_WEBHOOK_ALLOWLIST"] = "";

    const result: StepRun = await run({
      "webhook-url": `https://chat.example.invalid/hooks/${HOOK_ID}`,
      text: "Deploy finished",
    });

    expect(result.port).toBe("error");
    expect(result.returnValues["error"]).toMatch(
      /^Mattermost Incoming Webhook URL (hostname could not be resolved via DNS|could not be reached)\.$/,
    );
  });
});

describe("TLS: the certificate is checked against the name in the URL, though the socket dials the approved address", () => {
  let certificate: TestCertificate;

  beforeEach(() => {
    certificate = createTestCertificate({
      commonName: HOST,
      dnsNames: [HOST],
    });
  });

  test("a certificate for the server's name, from a trusted authority: the message goes", async () => {
    const server: FakeMattermostServer = await serve(undefined, certificate);
    trust(certificate);

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server, { scheme: "https" }),
      text: "Deploy finished",
    });

    expect(result.port).toBe("success");
    expect(server.requests).toHaveLength(1);
  });

  test("a certificate for another name", async () => {
    const other: TestCertificate = createTestCertificate({
      commonName: "other.example",
      dnsNames: ["other.example"],
    });
    const server: FakeMattermostServer = await serve(undefined, other);
    trust(other);

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server, { scheme: "https" }),
      text: "Deploy finished",
    });

    expect(result.port).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "The Mattermost server's TLS certificate is not for the server named in Mattermost Incoming Webhook URL.",
    );
    expect(server.requests).toHaveLength(0);
  });

  test("a certificate nobody trusts", async () => {
    const server: FakeMattermostServer = await serve(undefined, certificate);

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server, { scheme: "https" }),
      text: "Deploy finished",
    });

    expect(result.port).toBe("error");
    expect(result.returnValues["error"]).toMatch(
      /^The Mattermost server's TLS certificate is not trusted \([A-Z_]+\)\. A self-hosted install can trust its own certificate authority with NODE_EXTRA_CA_CERTS\.$/,
    );
    expect(server.requests).toHaveLength(0);
  });

  test("https to a server that only speaks plain HTTP", async () => {
    const server: FakeMattermostServer = await serve();

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server, { scheme: "https" }),
      text: "Deploy finished",
    });

    expect(result.port).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "Could not make a TLS connection to the Mattermost server. If it does not use TLS, Mattermost Incoming Webhook URL starts with http://.",
    );
  });
});

describe("where the step may send: the API steps' address guard, and nowhere else", () => {
  test("loopback is refused without the operator naming it, before anything is sent", async () => {
    process.env["PRIVATE_NETWORK_WEBHOOK_ALLOWLIST"] = "";
    const server: FakeMattermostServer = await serve();

    const result: StepRun = await run({
      "webhook-url": `http://127.0.0.1:${server.port}/hooks/${HOOK_ID}`,
      text: "Deploy finished",
    });

    expect(result.port).toBe("error");
    expect(result.returnValues["error"]).toBe(
      "Mattermost Incoming Webhook URL points to a private, loopback, or link-local address and is not allowed.",
    );
    expect(server.requests).toHaveLength(0);
  });

  test("a name that resolves to loopback is refused too", async () => {
    process.env["PRIVATE_NETWORK_WEBHOOK_ALLOWLIST"] = "";
    const server: FakeMattermostServer = await serve();

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
    });

    expect(result.port).toBe("error");
    expect(result.returnValues["error"]).toMatch(
      /^Mattermost Incoming Webhook URL (resolves to a private, loopback, or link-local address and is not allowed|could not be reached)\.$/,
    );
    expect(server.requests).toHaveLength(0);
  });

  test.each([
    "http://169.254.169.254/hooks/" + HOOK_ID,
    "http://[::1]/hooks/" + HOOK_ID,
    "http://localhost/hooks/" + HOOK_ID,
    "http://metadata.google.internal/hooks/" + HOOK_ID,
    "http://0.0.0.0/hooks/" + HOOK_ID,
  ])(
    "%s is refused even where private networks are allowed",
    async (url: string) => {
      process.env["ALLOW_PRIVATE_NETWORK_WEBHOOKS"] = "true";
      process.env["PRIVATE_NETWORK_WEBHOOK_ALLOWLIST"] = "";
      const pinSpy: jest.SpiedFunction<
        typeof DataSourceEgressGuard.createPinnedAgents
      > = jest.spyOn(DataSourceEgressGuard, "createPinnedAgents");

      const result: StepRun = await run({
        "webhook-url": url,
        text: "Deploy finished",
      });

      expect(result.port).toBe("error");
      expect(result.returnValues["error"]).toBe(
        "Mattermost Incoming Webhook URL points to a private, loopback, or link-local address and is not allowed.",
      );
      expect(pinSpy).not.toHaveBeenCalled();
    },
  );

  test("a private address is refused unless an administrator allows private networks", async () => {
    process.env["PRIVATE_NETWORK_WEBHOOK_ALLOWLIST"] = "";
    addressesByName["chat.corp.example"] = ["10.1.2.3"];
    const pinSpy: jest.SpiedFunction<
      typeof DataSourceEgressGuard.createPinnedAgents
    > = jest.spyOn(DataSourceEgressGuard, "createPinnedAgents");

    const result: StepRun = await run({
      "webhook-url": `https://chat.corp.example/hooks/${HOOK_ID}`,
      text: "Deploy finished",
    });

    expect(result.port).toBe("error");
    expect(result.returnValues["error"]).toMatch(
      /^Mattermost Incoming Webhook URL (resolves to a private network address and is not allowed\. Self-hosted instances can allow this by setting ALLOW_PRIVATE_NETWORK_WEBHOOKS or PRIVATE_NETWORK_WEBHOOK_ALLOWLIST\.|could not be reached\.)$/,
    );
    expect(pinSpy).not.toHaveBeenCalled();
  });

  test("with private networks allowed, the socket dials exactly the address the guard approved", async () => {
    process.env["PRIVATE_NETWORK_WEBHOOK_ALLOWLIST"] = "";
    process.env["ALLOW_PRIVATE_NETWORK_WEBHOOKS"] = "true";
    addressesByName["chat.corp.example"] = ["10.1.2.3"];

    // The approved address is 10.1.2.3; the test's Mattermost is on 127.0.0.1.
    const server: FakeMattermostServer = await serve();
    const realCreatePinnedAgents: (
      addresses: Array<ResolvedAddress>,
    ) => PinnedAgents = DataSourceEgressGuard.createPinnedAgents.bind(
      DataSourceEgressGuard,
    );
    const pinned: Array<Array<ResolvedAddress>> = [];

    jest
      .spyOn(DataSourceEgressGuard, "createPinnedAgents")
      .mockImplementation((addresses: Array<ResolvedAddress>) => {
        pinned.push(addresses);
        return realCreatePinnedAgents([{ address: "127.0.0.1", family: 4 }]);
      });

    const result: StepRun = await run({
      "webhook-url": `http://chat.corp.example:${server.port}/hooks/${HOOK_ID}`,
      text: "Deploy finished",
    });

    expect(pinned).toEqual([[{ address: "10.1.2.3", family: 4 }]]);
    expect(result.port).toBe("success");
    expect(server.requests[0]!.headers["host"]).toBe(
      `chat.corp.example:${server.port}`,
    );
  });

  test("the name is looked up once, by the guard: the socket never looks it up again", async () => {
    const server: FakeMattermostServer = await serve();
    const socketLookups: Array<string> = [];
    const realLookup: typeof dns.lookup = dns.lookup;

    jest.spyOn(dns, "lookup").mockImplementation(((
      hostname: string,
      ...rest: Array<unknown>
    ) => {
      socketLookups.push(hostname);
      return (realLookup as unknown as (...args: Array<unknown>) => void)(
        hostname,
        ...rest,
      );
    }) as never);

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
    });

    // mattermost.internal resolves nowhere real: only the pinned lookup could reach the server.
    expect(result.port).toBe("success");
    expect(lookupSpy).toHaveBeenCalledTimes(1);
    expect(socketLookups).toEqual([]);
  });

  test("a proxy in the environment is not used: it would choose its own address", async () => {
    const proxy: FakeMattermostServer = await serve();
    const server: FakeMattermostServer = await serve();

    for (const name of [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "http_proxy",
      "https_proxy",
    ]) {
      process.env[name] = `http://127.0.0.1:${proxy.port}`;
    }

    const result: StepRun = await run({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
    });

    expect(result.port).toBe("success");
    expect(server.requests).toHaveLength(1);
    expect(proxy.requests).toHaveLength(0);
  });
});

describe("a setting that can never work stops the run, before anything is sent", () => {
  test.each([
    [undefined, "Mattermost Incoming Webhook URL not found."],
    ["", "Mattermost Incoming Webhook URL not found."],
    ["   ", "Mattermost Incoming Webhook URL not found."],
    [
      `ftp://${HOST}/hooks/${HOOK_ID}`,
      "Mattermost Incoming Webhook URL must start with https:// (or http:// for a server without TLS).",
    ],
    [
      `javascript:alert(1)//hooks/${HOOK_ID}`,
      "Mattermost Incoming Webhook URL must start with https:// (or http:// for a server without TLS).",
    ],
    [
      `${HOST}/hooks/${HOOK_ID}`,
      "Mattermost Incoming Webhook URL is not a URL.",
    ],
    [
      `https://user:pass@${HOST}/hooks/${HOOK_ID}`,
      "Mattermost Incoming Webhook URL must not hold a user name or a password.",
    ],
    [
      `https://evil.example@${HOST}/hooks/${HOOK_ID}`,
      "Mattermost Incoming Webhook URL must not hold a user name or a password.",
    ],
    [
      `https://${HOST}/hooks/${HOOK_ID}?channel=ops`,
      "Mattermost Incoming Webhook URL ends with the webhook's ID: nothing goes after it, no ? and no #.",
    ],
    [
      `https://${HOST}/hooks/${HOOK_ID}#x`,
      "Mattermost Incoming Webhook URL ends with the webhook's ID: nothing goes after it, no ? and no #.",
    ],
    [
      `https://${HOST}/hooks/${HOOK_ID}?`,
      "Mattermost Incoming Webhook URL ends with the webhook's ID: nothing goes after it, no ? and no #.",
    ],
    [
      `https://${HOST}`,
      "Mattermost Incoming Webhook URL is not an incoming webhook's URL.",
    ],
    [
      `https://${HOST}/hooks/`,
      "Mattermost Incoming Webhook URL is not an incoming webhook's URL.",
    ],
    [
      `https://${HOST}/hooks/${HOOK_ID}/`,
      "Mattermost Incoming Webhook URL is not an incoming webhook's URL.",
    ],
    [
      `https://${HOST}/hooks/${HOOK_ID.slice(1)}`,
      "Mattermost Incoming Webhook URL is not an incoming webhook's URL.",
    ],
    [
      `https://${HOST}/hooks/${HOOK_ID.toUpperCase()}`,
      "Mattermost Incoming Webhook URL is not an incoming webhook's URL.",
    ],
    [
      `https://${HOST}/hooks/commands/${HOOK_ID}`,
      "Mattermost Incoming Webhook URL is not an incoming webhook's URL.",
    ],
    [
      `https://${HOST}/api/v4/posts`,
      "Mattermost Incoming Webhook URL is not an incoming webhook's URL.",
    ],
    [
      `https://${HOST}/hooks/${HOOK_ID}/../../admin`,
      "Mattermost Incoming Webhook URL is not an incoming webhook's URL.",
    ],
    [
      `https://${HOST}/integrations/incoming_webhooks`,
      "Mattermost Incoming Webhook URL is not an incoming webhook's URL.",
    ],
    [
      `https://${HOST} /hooks/${HOOK_ID}`,
      "Mattermost Incoming Webhook URL holds a space, a line break or a backslash",
    ],
    [
      `https://${HOST}\\@169.254.169.254/hooks/${HOOK_ID}`,
      "Mattermost Incoming Webhook URL holds a space, a line break or a backslash",
    ],
    [
      `https://${HOST}/${"a/".repeat(1100)}hooks/${HOOK_ID}`,
      "Mattermost Incoming Webhook URL is too long to be a webhook's URL.",
    ],
  ])(
    "Mattermost Incoming Webhook URL %j",
    async (url: string | undefined, message: string) => {
      const server: FakeMattermostServer = await serve();
      const error: Error = await refusal({
        ...(url === undefined ? {} : { "webhook-url": url }),
        text: "Deploy finished",
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message.startsWith(message)).toBe(true);
      expectNoSecret(error.message);
      expect(server.requests).toHaveLength(0);
      expect(lookupSpy).not.toHaveBeenCalled();
    },
  );

  test.each([
    [undefined, "Mattermost message not found."],
    ["", "Mattermost message not found."],
    ["  \n\t ", "Message Text has nothing to send: it is blank."],
  ])("Message Text %j", async (text: string | undefined, message: string) => {
    const server: FakeMattermostServer = await serve();
    const error: Error = await refusal({
      "webhook-url": webhookUrl(server),
      ...(text === undefined ? {} : { text: text }),
    });

    expect(error.message).toBe(message);
    expect(server.requests).toHaveLength(0);
  });

  test.each([
    [
      "Town Square",
      "Channel takes the channel's name as its URL shows it, such as town-square, not the name it is shown under: lowercase letters, digits, '-' and '_'.",
    ],
    [
      "#ops,#dev",
      "Channel takes the channel's name as its URL shows it, such as town-square, not the name it is shown under: lowercase letters, digits, '-' and '_'.",
    ],
    [
      "@jane doe",
      "Channel takes @ and a username for a direct message, such as @jane.doe: lowercase letters, digits, '.', '-' and '_'.",
    ],
    [
      "@",
      "Channel needs a channel's name, such as town-square, or @ and a username for a direct message.",
    ],
    [
      "~",
      "Channel needs a channel's name, such as town-square, or @ and a username for a direct message.",
    ],
    [
      "a".repeat(65),
      "Channel is longer than a Mattermost channel's name can be (64 characters).",
    ],
  ])("Channel %j", async (channel: string, message: string) => {
    const server: FakeMattermostServer = await serve();
    const error: Error = await refusal({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
      channel: channel,
    });

    expect(error.message).toBe(message);
    expect(server.requests).toHaveLength(0);
  });

  test.each([
    [
      "x".repeat(65),
      "Username can be at most 64 characters, as a Mattermost username can.",
    ],
    ["One\nUptime", "Username must be one line, without line breaks or tabs."],
  ])("Username %j", async (username: string, message: string) => {
    const server: FakeMattermostServer = await serve();
    const error: Error = await refusal({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
      username: username,
    });

    expect(error.message).toBe(message);
    expect(server.requests).toHaveLength(0);
  });

  test.each([
    "oneuptime.png",
    "javascript:alert(1)",
    "data:image/png;base64,iVBORw0KGgo=",
    "ftp://example.com/icon.png",
  ])("Icon URL %j", async (iconUrl: string) => {
    const server: FakeMattermostServer = await serve();
    const error: Error = await refusal({
      "webhook-url": webhookUrl(server),
      text: "Deploy finished",
      "icon-url": iconUrl,
    });

    expect(error.message).toBe(
      "Icon URL must be the https:// address of a picture, such as https://example.com/oneuptime.png.",
    );
    expect(server.requests).toHaveLength(0);
  });
});

describe("the webhook's URL is a secret, and nothing the step says gives it away", () => {
  test("not on success, not on any refusal, not on any failure to connect", async () => {
    const closedPort: number = await getClosedPort();
    const answers: Array<FakeMattermostAnswer> = [
      MATTERMOST_OK,
      mattermostAppError(
        404,
        "web.incoming_webhook.invalid.app_error",
        "Invalid webhook.",
      ),
      { status: 502, body: `<html>${HOOK_ID}</html>` },
      { status: 302, headers: { Location: `http://${HOST}/hooks/${HOOK_ID}` } },
      { status: 200, hangUp: true },
    ];
    const said: Array<string> = [];

    for (const answer of answers) {
      const server: FakeMattermostServer = await serve(() => {
        return answer;
      });
      const result: StepRun = await run({
        "webhook-url": webhookUrl(server),
        text: "Deploy finished",
      });

      said.push(JSON.stringify(result.returnValues), ...result.logs);
    }

    const refused: StepRun = await run({
      "webhook-url": webhookUrl({ port: closedPort }),
      text: "Deploy finished",
    });
    said.push(JSON.stringify(refused.returnValues), ...refused.logs);

    process.env["PRIVATE_NETWORK_WEBHOOK_ALLOWLIST"] = "";
    const guarded: StepRun = await run({
      "webhook-url": `http://127.0.0.1/hooks/${HOOK_ID}`,
      text: "Deploy finished",
    });
    said.push(JSON.stringify(guarded.returnValues), ...guarded.logs);

    expect(said.length).toBeGreaterThan(7);

    for (const text of said) {
      expectNoSecret(text);
    }
  });
});

describe("getSettings reads every setting as the builder saves it", () => {
  test("a URL, text and the optional settings, with whitespace taken off what it does not belong to", () => {
    expect(
      SendMessageToChannel.getSettings({
        "webhook-url": `  https://${HOST}/hooks/${HOOK_ID}\n`,
        text: "  Deploy finished  ",
        channel: " #Ops ",
        username: "  OneUptime  ",
        "icon-url": " https://example.com/oneuptime.png ",
      }),
    ).toEqual({
      webhookUrl: `https://${HOST}/hooks/${HOOK_ID}`,
      message: {
        // The text is the author's, spaces and all.
        text: "  Deploy finished  ",
        channel: "ops",
        username: "OneUptime",
        iconUrl: "https://example.com/oneuptime.png",
      },
      isTextCut: false,
    });
  });

  test("optional settings that are missing, null or blank are left out", () => {
    for (const blank of [undefined, null, "", "   "] as Array<
      JSONValue | undefined
    >) {
      const args: JSONObject = {
        "webhook-url": `https://${HOST}/hooks/${HOOK_ID}`,
        text: "Deploy finished",
      };

      if (blank !== undefined) {
        args["channel"] = blank;
        args["username"] = blank;
        args["icon-url"] = blank;
      }

      expect(SendMessageToChannel.getSettings(args).message).toEqual({
        text: "Deploy finished",
      });
    }
  });
});
