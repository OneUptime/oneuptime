import LLMProviderExchangeRecorder, {
  REDACTED,
} from "../../../../Server/Utils/LLM/LLMProviderExchangeRecorder";
import {
  LLM_PROVIDER_EXCHANGE_MAX_BODY_LENGTH,
  LLM_PROVIDER_EXCHANGE_MAX_COUNT,
  LLM_PROVIDER_EXCHANGE_TRUNCATED_SUFFIX,
  LLMProviderExchange,
  readLLMProviderExchanges,
} from "../../../../Types/LLM/LLMProviderExchange";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT TEST LLM PROVIDER KEEPS OF EACH REQUEST (issue #7080), and what it
 * never lets out: the recorder collects only inside record(), masks every
 * credential - in headers, the URL, and wherever else a header's secret
 * turns up - drops cookies, and cuts what is too long to show.
 */

const KEY: string = "sk-proj-abcdefghijklmnop-WXYZ";

function capture(
  overrides: Partial<Parameters<typeof LLMProviderExchangeRecorder.capture>[0]>,
): void {
  LLMProviderExchangeRecorder.capture({
    method: "post",
    url: "https://api.openai.com/v1/chat/completions",
    requestHeaders: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    requestBody: { model: "gpt-4o" },
    statusCode: 200,
    responseHeaders: { "content-type": "application/json" },
    responseBody: { ok: true },
    startedAt: Date.now(),
    ...overrides,
  });
}

describe("record() collects; nothing else does", () => {
  test("a request outside record() is kept nowhere", async () => {
    expect(LLMProviderExchangeRecorder.isRecording()).toBe(false);
    capture({});

    const recorded: { exchanges: Array<LLMProviderExchange> } =
      await LLMProviderExchangeRecorder.record(async () => {
        return "done";
      });

    expect(recorded.exchanges).toEqual([]);
  });

  test("requests inside record() are collected, in order, with the value", async () => {
    const recorded: {
      exchanges: Array<LLMProviderExchange>;
      value?: string;
      failed: boolean;
    } = await LLMProviderExchangeRecorder.record(async () => {
      expect(LLMProviderExchangeRecorder.isRecording()).toBe(true);
      capture({ url: "https://a.example/one" });
      await Promise.resolve();
      capture({ url: "https://a.example/two" });
      return "value";
    });

    expect(recorded.failed).toBe(false);
    expect(recorded.value).toBe("value");
    expect(
      recorded.exchanges.map((exchange: LLMProviderExchange) => {
        return exchange.url;
      }),
    ).toEqual(["https://a.example/one", "https://a.example/two"]);
    expect(recorded.exchanges[0]!.method).toBe("POST");
  });

  test("work that throws still hands back what it collected, and the error", async () => {
    const boom: Error = new Error("provider said no");

    const recorded: {
      exchanges: Array<LLMProviderExchange>;
      error?: unknown;
      failed: boolean;
    } = await LLMProviderExchangeRecorder.record(async () => {
      capture({ statusCode: 401 });
      throw boom;
    });

    expect(recorded.failed).toBe(true);
    expect(recorded.error).toBe(boom);
    expect(recorded.exchanges).toHaveLength(1);
    expect(recorded.exchanges[0]!.statusCode).toBe(401);
  });

  test("two tests at once keep their own requests apart", async () => {
    const [first, second] = await Promise.all([
      LLMProviderExchangeRecorder.record(async () => {
        await new Promise((resolve: (v: unknown) => void) => {
          setTimeout(resolve, 5);
        });
        capture({ url: "https://first.example/" });
      }),
      LLMProviderExchangeRecorder.record(async () => {
        capture({ url: "https://second.example/" });
      }),
    ]);

    expect(
      first.exchanges.map((e: LLMProviderExchange) => {
        return e.url;
      }),
    ).toEqual(["https://first.example/"]);
    expect(
      second.exchanges.map((e: LLMProviderExchange) => {
        return e.url;
      }),
    ).toEqual(["https://second.example/"]);
  });

  test(`at most ${LLM_PROVIDER_EXCHANGE_MAX_COUNT} requests are kept`, async () => {
    const recorded: { exchanges: Array<LLMProviderExchange> } =
      await LLMProviderExchangeRecorder.record(async () => {
        for (let i: number = 0; i < LLM_PROVIDER_EXCHANGE_MAX_COUNT + 5; i++) {
          capture({});
        }
      });

    expect(recorded.exchanges).toHaveLength(LLM_PROVIDER_EXCHANGE_MAX_COUNT);
  });
});

describe("credentials are masked", () => {
  test("maskSecret shows a long secret's ends only, and nothing of a short one", () => {
    expect(LLMProviderExchangeRecorder.maskSecret(KEY)).toBe("sk-p…WXYZ");
    expect(LLMProviderExchangeRecorder.maskSecret(`Bearer ${KEY}`)).toBe(
      "Bearer sk-p…WXYZ",
    );
    expect(LLMProviderExchangeRecorder.maskSecret("short")).toBe("…");
    expect(LLMProviderExchangeRecorder.maskSecret("Bearer short")).toBe(
      "Bearer …",
    );
  });

  test.each([
    ["Authorization", `Bearer ${KEY}`, "Bearer sk-p…WXYZ"],
    ["authorization", `Bearer ${KEY}`, "Bearer sk-p…WXYZ"],
    ["api-key", KEY, "sk-p…WXYZ"],
    ["x-api-key", KEY, "sk-p…WXYZ"],
    ["x-goog-api-key", KEY, "sk-p…WXYZ"],
    ["Proxy-Authorization", `Basic ${KEY}`, "Basic sk-p…WXYZ"],
    ["Ocp-Apim-Subscription-Key", KEY, "sk-p…WXYZ"],
  ])("the %s header", (name: string, value: string, shown: string) => {
    const exchange: LLMProviderExchange =
      LLMProviderExchangeRecorder.toExchange({
        method: "POST",
        url: "https://p.example/",
        requestHeaders: { [name]: value },
        startedAt: Date.now(),
      });

    expect(exchange.requestHeaders[name]).toBe(shown);
  });

  test("cookies, sent or set, are redacted outright", () => {
    const exchange: LLMProviderExchange =
      LLMProviderExchangeRecorder.toExchange({
        method: "POST",
        url: "https://p.example/",
        requestHeaders: { Cookie: "session=abc" },
        statusCode: 200,
        responseHeaders: { "set-cookie": ["a=1", "b=2"] },
        startedAt: Date.now(),
      });

    expect(exchange.requestHeaders["Cookie"]).toBe(REDACTED);
    expect(exchange.responseHeaders!["set-cookie"]).toBe(REDACTED);
  });

  test("a key a provider echoes in its body or headers is masked there too", () => {
    const exchange: LLMProviderExchange =
      LLMProviderExchangeRecorder.toExchange({
        method: "POST",
        url: "https://p.example/",
        requestHeaders: { Authorization: `Bearer ${KEY}` },
        requestBody: { note: `my key is ${KEY}` },
        statusCode: 401,
        responseHeaders: { "x-debug": KEY },
        responseBody: { error: { message: `Incorrect API key: ${KEY}` } },
        error: `failed with ${KEY}`,
        startedAt: Date.now(),
      });

    expect(JSON.stringify(exchange)).not.toContain(KEY);
    expect((exchange.responseBody as JSONObject)["error"]).toEqual({
      message: "Incorrect API key: sk-p…WXYZ",
    });
    expect(exchange.responseHeaders!["x-debug"]).toBe("sk-p…WXYZ");
    expect(exchange.error).toBe("failed with sk-p…WXYZ");
  });

  test("a URL's password and key-like query parameters are masked; the rest is kept", () => {
    expect(
      LLMProviderExchangeRecorder.maskUrl(
        `https://user:hunter2-password@llm.example/v1/chat?api-version=2024-10-21&key=${KEY}&api_key=${KEY}&token=${KEY}`,
      ),
    ).toBe(
      "https://user:%5Bredacted%5D@llm.example/v1/chat?api-version=2024-10-21&key=sk-p%E2%80%A6WXYZ&api_key=sk-p%E2%80%A6WXYZ&token=sk-p%E2%80%A6WXYZ",
    );

    expect(
      LLMProviderExchangeRecorder.maskUrl(
        "https://api.openai.com/v1/chat/completions",
      ),
    ).toBe("https://api.openai.com/v1/chat/completions");

    // Not a URL: kept as it is.
    expect(LLMProviderExchangeRecorder.maskUrl("not a url")).toBe("not a url");
  });
});

describe("what is kept, and how", () => {
  test("headers of any shape become lower-case strings", () => {
    expect(
      LLMProviderExchangeRecorder.normalizeHeaders({
        "Content-Type": "application/json",
        "X-Count": 3,
        Vary: ["Accept", "Origin"],
        Skipped: undefined,
        Nested: { no: "objects" },
      }),
    ).toEqual({
      "content-type": "application/json",
      "x-count": "3",
      vary: "Accept, Origin",
    });

    expect(
      LLMProviderExchangeRecorder.normalizeHeaders({
        toJSON: () => {
          return { "X-From-ToJson": "yes" };
        },
      }),
    ).toEqual({ "x-from-tojson": "yes" });

    expect(LLMProviderExchangeRecorder.normalizeHeaders(undefined)).toEqual({});
    expect(LLMProviderExchangeRecorder.normalizeHeaders("nope")).toEqual({});
  });

  test("no status: no response headers or body, the error kept", () => {
    const exchange: LLMProviderExchange =
      LLMProviderExchangeRecorder.toExchange({
        method: "POST",
        url: "https://p.example/",
        requestHeaders: {},
        statusCode: -1,
        responseBody: { ignored: true },
        error: "OneUptime could not reach OpenAI: connection refused.",
        startedAt: Date.now(),
      });

    expect(exchange.statusCode).toBeUndefined();
    expect(exchange.responseHeaders).toBeUndefined();
    expect(exchange.responseBody).toBeUndefined();
    expect(exchange.error).toBe(
      "OneUptime could not reach OpenAI: connection refused.",
    );
  });

  test("a JSON body that fits is kept as JSON", () => {
    const body: JSONObject = { model: "gpt-4o", messages: [{ role: "user" }] };
    const exchange: LLMProviderExchange =
      LLMProviderExchangeRecorder.toExchange({
        method: "POST",
        url: "https://p.example/",
        requestHeaders: {},
        requestBody: body,
        startedAt: Date.now(),
      });

    expect(exchange.requestBody).toEqual(body);
  });

  test("a body too long to show is cut, and says so", () => {
    const long: string = "x".repeat(LLM_PROVIDER_EXCHANGE_MAX_BODY_LENGTH * 2);

    const exchange: LLMProviderExchange =
      LLMProviderExchangeRecorder.toExchange({
        method: "POST",
        url: "https://p.example/",
        requestHeaders: {},
        requestBody: { content: long },
        statusCode: 500,
        responseBody: long,
        startedAt: Date.now(),
      });

    for (const body of [exchange.requestBody, exchange.responseBody]) {
      expect(typeof body).toBe("string");
      expect(body as string).toHaveLength(
        LLM_PROVIDER_EXCHANGE_MAX_BODY_LENGTH +
          LLM_PROVIDER_EXCHANGE_TRUNCATED_SUFFIX.length,
      );
      expect(
        (body as string).endsWith(LLM_PROVIDER_EXCHANGE_TRUNCATED_SUFFIX),
      ).toBe(true);
    }
  });

  test("an empty response body is left out", () => {
    const exchange: LLMProviderExchange =
      LLMProviderExchangeRecorder.toExchange({
        method: "GET",
        url: "https://p.example/",
        requestHeaders: {},
        statusCode: 204,
        responseBody: "",
        startedAt: Date.now(),
      });

    expect(exchange.responseBody).toBeUndefined();
  });

  test("the duration is how long ago the request started, never negative", () => {
    const past: LLMProviderExchange = LLMProviderExchangeRecorder.toExchange({
      method: "GET",
      url: "https://p.example/",
      requestHeaders: {},
      startedAt: Date.now() - 1500,
    });
    const future: LLMProviderExchange = LLMProviderExchangeRecorder.toExchange({
      method: "GET",
      url: "https://p.example/",
      requestHeaders: {},
      startedAt: Date.now() + 60000,
    });

    expect(past.durationMs).toBeGreaterThanOrEqual(1500);
    expect(future.durationMs).toBe(0);
  });

  test("a body that cannot be serialized does not break the test", async () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    const recorded: { exchanges: Array<LLMProviderExchange> } =
      await LLMProviderExchangeRecorder.record(async () => {
        capture({ responseBody: circular });
      });

    expect(recorded.exchanges[0]!.responseBody).toBe("[unreadable body]");
  });
});

describe("readLLMProviderExchanges: the dialog's reading of the answer", () => {
  test("reads what the server sends", () => {
    const sent: Array<JSONValue> = [
      {
        method: "POST",
        url: "https://p.example/",
        requestHeaders: { a: "1", dropped: 2 },
        requestBody: { model: "m" },
        statusCode: 401,
        responseHeaders: { b: "2" },
        responseBody: "text",
        error: "why",
        durationMs: 42,
      },
    ];

    expect(readLLMProviderExchanges(sent)).toEqual([
      {
        method: "POST",
        url: "https://p.example/",
        requestHeaders: { a: "1" },
        requestBody: { model: "m" },
        statusCode: 401,
        responseHeaders: { b: "2" },
        responseBody: "text",
        error: "why",
        durationMs: 42,
      },
    ]);
  });

  test("skips what is not an exchange, and reads nothing from an older server", () => {
    expect(readLLMProviderExchanges(undefined)).toEqual([]);
    expect(readLLMProviderExchanges("nope")).toEqual([]);
    expect(readLLMProviderExchanges({ method: "POST" })).toEqual([]);
    expect(
      readLLMProviderExchanges([
        null,
        "x",
        [],
        { method: "POST" },
        { url: "https://p.example/" },
        { method: "GET", url: "https://p.example/", durationMs: "slow" },
      ]),
    ).toEqual([
      {
        method: "GET",
        url: "https://p.example/",
        requestHeaders: {},
        durationMs: 0,
      },
    ]);
  });

  test(`keeps at most ${LLM_PROVIDER_EXCHANGE_MAX_COUNT}`, () => {
    const many: Array<JSONValue> = Array.from(
      { length: LLM_PROVIDER_EXCHANGE_MAX_COUNT + 3 },
      () => {
        return { method: "POST", url: "https://p.example/" };
      },
    );

    expect(readLLMProviderExchanges(many)).toHaveLength(
      LLM_PROVIDER_EXCHANGE_MAX_COUNT,
    );
  });
});
