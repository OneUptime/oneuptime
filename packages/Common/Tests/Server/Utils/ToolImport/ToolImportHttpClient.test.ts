import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ToolImportHttpClient, {
  createToolImportTransport,
  TOOL_IMPORT_MAX_RATE_LIMIT_RETRIES,
  ToolImportHttpClientOptions,
  ToolImportHttpError,
  ToolImportHttpErrorKind,
  ToolImportHttpRequest,
  ToolImportHttpResponse,
  ToolImportTransport,
} from "../../../../Server/Utils/ToolImport/ToolImportHttpClient";
import { TOOL_IMPORT_MAX_RESPONSE_BYTES } from "../../../../Types/ToolImport/ToolImportLimits";
import { FixtureApi, json, RecordingSleep } from "./ToolImportFixtureTransport";
import axios from "axios";
import type { SpyInstance } from "jest-mock";

/*
 * The one door an import has to another tool. These pin the rules every
 * tool's read relies on: only the tool's own hosts, never a redirect; backing
 * off exactly as the tool asks on a 429 (Retry-After in seconds or as a date,
 * a rate-limit reset, or doubling waits) and giving up in plain words; a few
 * tries on a server error; a budget of requests and time; and the key never
 * in a message. The transport is a fixture, or axios mocked: nothing here
 * opens a socket.
 */

const KEY: string = "secret-key-0123456789abcdef";
const NOW: number = Date.parse("2026-10-08T12:00:00Z");

interface Harness {
  client: ToolImportHttpClient;
  api: FixtureApi;
  sleep: RecordingSleep;
  clock: { now: number };
}

function harness(
  routes: Array<{ path: string; answers: Array<ToolImportHttpResponse | Error> }>,
  overrides: Partial<ToolImportHttpClientOptions> = {},
): Harness {
  const api: FixtureApi = new FixtureApi(routes);
  const clock: { now: number } = { now: NOW };
  const sleep: RecordingSleep = new RecordingSleep(clock);

  const client: ToolImportHttpClient = new ToolImportHttpClient({
    toolName: "Tool",
    baseUrl: "https://api.tool.example",
    allowedHosts: ["api.tool.example"],
    headers: { Authorization: `Bearer ${KEY}` },
    secrets: [KEY, `Bearer ${KEY}`],
    transport: api.transport,
    sleep: sleep.sleep,
    now: (): number => {
      return clock.now;
    },
    maxRequests: 100,
    deadlineAt: NOW + 30 * 60 * 1000,
    ...overrides,
  });

  return { client, api, sleep, clock };
}

async function failure(promise: Promise<unknown>): Promise<ToolImportHttpError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ToolImportHttpError);
    return error as ToolImportHttpError;
  }

  throw new Error("Expected the request to fail.");
}

describe("ToolImportHttpClient: where it may go", () => {
  test("a base URL off the tool's hosts, or not HTTPS, is refused before anything is sent", () => {
    for (const baseUrl of [
      "https://evil.example",
      "http://api.tool.example",
      "https://api.tool.example.evil.example",
      "not a url",
    ]) {
      expect(() => {
        return harness([], { baseUrl: baseUrl });
      }).toThrow("can only be read from its own address");
    }
  });

  test("a path that tries to leave the API is refused", async () => {
    const { client, api } = harness([]);

    for (const path of [
      "v2/users",
      "https://evil.example/x",
      "/v2/../../admin",
      "//evil.example/x",
    ]) {
      await expect(client.getJson(path)).rejects.toThrow();
    }

    expect(api.requests).toHaveLength(0);
  });

  test("the request carries the key's header, asks for JSON, and the query as given", async () => {
    const { client, api } = harness([
      { path: "/v2/users", answers: [json({ data: [] })] },
    ]);

    await client.getJson("/v2/users", {
      limit: 100,
      offset: 0,
      flag: true,
      tags: ["a", "b"],
      skipped: undefined,
    });

    const request: ToolImportHttpRequest = api.requests[0]!;
    const url: URL = new URL(request.url);

    expect(url.origin).toBe("https://api.tool.example");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("offset")).toBe("0");
    expect(url.searchParams.get("flag")).toBe("true");
    expect(url.searchParams.getAll("tags")).toEqual(["a", "b"]);
    expect(url.searchParams.has("skipped")).toBe(false);
    expect(request.headers["Authorization"]).toBe(`Bearer ${KEY}`);
    expect(request.headers["Accept"]).toBe("application/json");
    expect(request.timeoutInMs).toBe(30000);
  });

  test("a 2xx answer that is not JSON is a bad response", async () => {
    const { client } = harness([
      {
        path: "/x",
        answers: [
          { statusCode: 200, bodyText: "<html>", bodyJson: undefined, headers: {} },
        ],
      },
    ]);

    const error: ToolImportHttpError = await failure(client.getJson("/x"));

    expect(error.kind).toBe(ToolImportHttpErrorKind.BadResponse);
  });
});

describe("ToolImportHttpClient: slowing down when the tool says to", () => {
  test("Retry-After in seconds is waited out", async () => {
    const { client, sleep } = harness([
      {
        path: "/x",
        answers: [
          json({}, 429, { "retry-after": "7" }),
          json({ ok: true }),
        ],
      },
    ]);

    expect(await client.getJson("/x")).toEqual({ ok: true });
    expect(sleep.waits).toEqual([7000]);
    expect(client.getRateLimitWaitMs()).toBe(7000);
  });

  test("Retry-After as a date is waited until", async () => {
    const { client, sleep } = harness([
      {
        path: "/x",
        answers: [
          json({}, 429, {
            "retry-after": new Date(NOW + 12000).toUTCString(),
          }),
          json({ ok: true }),
        ],
      },
    ]);

    await client.getJson("/x");

    expect(sleep.waits).toEqual([12000]);
  });

  test("a rate-limit reset time (epoch seconds) is waited until, and a period in seconds is waited", async () => {
    const reset: Harness = harness([
      {
        path: "/x",
        answers: [
          json({}, 429, { "x-ratelimit-reset": String(NOW / 1000 + 9) }),
          json({}),
        ],
      },
    ]);
    await reset.client.getJson("/x");
    expect(reset.sleep.waits).toEqual([9000]);

    const period: Harness = harness([
      {
        path: "/x",
        answers: [
          json({}, 429, { "x-ratelimit-period-in-sec": "4" }),
          json({}),
        ],
      },
    ]);
    await period.client.getJson("/x");
    expect(period.sleep.waits).toEqual([4000]);
  });

  test("with no hint, the waits double from two seconds up to a minute", async () => {
    const { client, sleep } = harness([
      {
        path: "/x",
        answers: [
          json({}, 429),
          json({}, 429),
          json({}, 429),
          json({}, 429),
          json({}, 429),
          json({}, 429),
          json({ ok: true }),
        ],
      },
    ]);

    await client.getJson("/x");

    expect(sleep.waits).toEqual([2000, 4000, 8000, 16000, 32000, 60000]);
  });

  test("a hint over a minute is capped at a minute, one under a quarter second is a quarter second", async () => {
    const long: Harness = harness([
      {
        path: "/x",
        answers: [json({}, 429, { "retry-after": "3600" }), json({})],
      },
    ]);
    await long.client.getJson("/x");
    expect(long.sleep.waits).toEqual([60000]);

    const short: Harness = harness([
      {
        path: "/x",
        answers: [json({}, 429, { "retry-after": "0" }), json({})],
      },
    ]);
    await short.client.getJson("/x");
    expect(short.sleep.waits).toEqual([250]);
  });

  test("it gives up in plain words after so many tries", async () => {
    const { client, api } = harness([
      { path: "/x", answers: [json({}, 429, { "retry-after": "1" })] },
    ]);

    const error: ToolImportHttpError = await failure(client.getJson("/x"));

    expect(error.kind).toBe(ToolImportHttpErrorKind.RateLimited);
    expect(error.message).toBe(
      "Tool kept asking OneUptime to slow down, so the read was stopped. Try again in a few minutes.",
    );
    expect(api.requests).toHaveLength(TOOL_IMPORT_MAX_RATE_LIMIT_RETRIES + 1);
  });

  test("it gives up at once when the wait would run past the read's deadline", async () => {
    const { client, sleep } = harness(
      [{ path: "/x", answers: [json({}, 429, { "retry-after": "50" })] }],
      { deadlineAt: NOW + 10_000 },
    );

    const error: ToolImportHttpError = await failure(client.getJson("/x"));

    expect(error.kind).toBe(ToolImportHttpErrorKind.RateLimited);
    expect(sleep.waits).toEqual([]);
  });
});

describe("ToolImportHttpClient: failures", () => {
  test("a server error is tried again a few times with growing waits, then reported", async () => {
    const { client, sleep, api } = harness([
      { path: "/x", answers: [json({}, 502)] },
    ]);

    const error: ToolImportHttpError = await failure(client.getJson("/x"));

    expect(error.kind).toBe(ToolImportHttpErrorKind.Unavailable);
    expect(error.statusCode).toBe(502);
    expect(error.message).toBe("Tool kept failing (HTTP 502). Try again later.");
    expect(sleep.waits).toEqual([1000, 2000, 4000]);
    expect(api.requests).toHaveLength(4);
  });

  test("a server error that recovers is not an error", async () => {
    const { client } = harness([
      { path: "/x", answers: [json({}, 503, { "retry-after": "2" }), json({ ok: 1 })] },
    ]);

    expect(await client.getJson("/x")).toEqual({ ok: 1 });
  });

  test("a dropped connection is tried again, and the message never carries the key", async () => {
    const { client } = harness([
      {
        path: "/x",
        answers: [new Error(`socket hang up while sending Bearer ${KEY}`)],
      },
    ]);

    const error: ToolImportHttpError = await failure(client.getJson("/x"));

    expect(error.kind).toBe(ToolImportHttpErrorKind.Unavailable);
    expect(error.message).toContain("Tool could not be reached");
    expect(error.message).not.toContain(KEY);
  });

  test.each([
    [401, ToolImportHttpErrorKind.Unauthorized, "Tool did not accept the API key"],
    [403, ToolImportHttpErrorKind.Forbidden, "The API key may not read this from Tool"],
    [404, ToolImportHttpErrorKind.NotFound, "Tool could not find this"],
    [422, ToolImportHttpErrorKind.Rejected, "Tool refused the request (HTTP 422)"],
    [301, ToolImportHttpErrorKind.Rejected, "Tool refused the request (HTTP 301)"],
  ] as Array<[number, ToolImportHttpErrorKind, string]>)(
    "HTTP %i is %s",
    async (
      status: number,
      kind: ToolImportHttpErrorKind,
      message: string,
    ) => {
      const { client, api } = harness([
        { path: "/x", answers: [json({ message: "nope" }, status)] },
      ]);

      const error: ToolImportHttpError = await failure(client.getJson("/x"));

      expect(error.kind).toBe(kind);
      expect(error.statusCode).toBe(status);
      expect(error.message).toContain(message);
      expect(error.message).toContain("(nope)");
      // Never tried again: these will not change by trying.
      expect(api.requests).toHaveLength(1);
    },
  );

  test("the tool's own words are read from either documented error shape, with the key cut out", async () => {
    const opsgenie: Harness = harness([
      {
        path: "/x",
        answers: [json({ message: `Key ${KEY} is not valid` }, 401)],
      },
    ]);
    const incidentIo: Harness = harness([
      {
        path: "/x",
        answers: [
          json(
            {
              type: "authentication_error",
              errors: [{ code: "invalid", message: `Bearer ${KEY} rejected` }],
            },
            401,
          ),
        ],
      },
    ]);

    const first: ToolImportHttpError = await failure(opsgenie.client.getJson("/x"));
    const second: ToolImportHttpError = await failure(
      incidentIo.client.getJson("/x"),
    );

    expect(first.message).toContain("is not valid");
    expect(second.message).toContain("rejected");

    for (const message of [first.message, second.message]) {
      expect(message).not.toContain(KEY);
      expect(message).toContain("[REDACTED]");
    }
  });

  test("a long message is cut short", async () => {
    const { client } = harness([
      { path: "/x", answers: [json({ message: "x".repeat(5000) }, 400)] },
    ]);

    const error: ToolImportHttpError = await failure(client.getJson("/x"));

    expect(error.message.length).toBeLessThan(400);
  });
});

describe("ToolImportHttpClient: its budget", () => {
  test("a read stops at its request budget", async () => {
    const { client, api } = harness(
      [{ path: "/x", answers: [json({})] }],
      { maxRequests: 2 },
    );

    await client.getJson("/x");
    await client.getJson("/x");

    const error: ToolImportHttpError = await failure(client.getJson("/x"));

    expect(error.kind).toBe(ToolImportHttpErrorKind.BudgetExhausted);
    expect(error.message).toBe(
      "Reading Tool took more than 2 requests, so it was stopped.",
    );
    expect(api.requests).toHaveLength(2);
    expect(client.getRequestCount()).toBe(2);
  });

  test("a read stops at its deadline", async () => {
    const { client, clock } = harness([{ path: "/x", answers: [json({})] }]);

    clock.now = NOW + 31 * 60 * 1000;

    const error: ToolImportHttpError = await failure(client.getJson("/x"));

    expect(error.kind).toBe(ToolImportHttpErrorKind.BudgetExhausted);
    expect(error.message).toBe("Reading Tool took too long, so it was stopped.");
  });

  test("retries count against the budget too", async () => {
    const { client, api } = harness(
      [{ path: "/x", answers: [json({}, 429, { "retry-after": "1" })] }],
      { maxRequests: 3 },
    );

    const error: ToolImportHttpError = await failure(client.getJson("/x"));

    expect(error.kind).toBe(ToolImportHttpErrorKind.BudgetExhausted);
    expect(api.requests).toHaveLength(3);
  });
});

describe("createToolImportTransport: the production transport", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("only HTTPS to an allowed host is ever sent", async () => {
    const send: SpyInstance<typeof axios.request> = jest.spyOn(
      axios,
      "request",
    );
    const transport: ToolImportTransport = createToolImportTransport([
      "api.opsgenie.com",
    ]);

    for (const url of [
      "http://api.opsgenie.com/v2/users",
      "https://api.opsgenie.com.evil.example/v2/users",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/v2/users",
      "not a url",
    ]) {
      await expect(
        transport({ method: "GET", url: url, headers: {}, timeoutInMs: 1000 }),
      ).rejects.toThrow(ToolImportHttpError);
    }

    expect(send).not.toHaveBeenCalled();
  });

  test("it never follows a redirect, caps the response, hands every status back and parses JSON", async () => {
    const send: SpyInstance<typeof axios.request> = jest
      .spyOn(axios, "request")
      .mockResolvedValue({
        status: 429,
        data: JSON.stringify({ message: "slow down" }),
        headers: { "Retry-After": "5", "X-Other": 3 },
      } as never);

    const transport: ToolImportTransport = createToolImportTransport([
      "api.opsgenie.com",
    ]);

    const response: ToolImportHttpResponse = await transport({
      method: "GET",
      url: "https://api.opsgenie.com/v2/users?limit=1",
      headers: { Authorization: "GenieKey k" },
      timeoutInMs: 1234,
    });

    expect(response).toEqual({
      statusCode: 429,
      bodyText: JSON.stringify({ message: "slow down" }),
      bodyJson: { message: "slow down" },
      headers: { "retry-after": "5", "x-other": "3" },
    });

    const config: Record<string, unknown> = send.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(config["maxRedirects"]).toBe(0);
    expect(config["timeout"]).toBe(1234);
    expect(config["maxContentLength"]).toBe(TOOL_IMPORT_MAX_RESPONSE_BYTES);
    expect(config["url"]).toBe("https://api.opsgenie.com/v2/users?limit=1");
    expect(
      (config["validateStatus"] as (status: number) => boolean)(500),
    ).toBe(true);
    expect(
      (config["headers"] as Record<string, string>)["Authorization"],
    ).toBe("GenieKey k");
    expect(
      (config["headers"] as Record<string, string>)["User-Agent"],
    ).toContain("OneUptime");
  });

  test("a body that is not JSON comes back as text only", async () => {
    jest.spyOn(axios, "request").mockResolvedValue({
      status: 200,
      data: "<html>maintenance</html>",
      headers: {},
    } as never);

    const response: ToolImportHttpResponse = await createToolImportTransport([
      "api.incident.io",
    ])({
      method: "GET",
      url: "https://api.incident.io/v1/identity",
      headers: {},
      timeoutInMs: 1000,
    });

    expect(response.bodyJson).toBeUndefined();
    expect(response.bodyText).toBe("<html>maintenance</html>");
  });
});
