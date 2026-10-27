import { describe, expect, test } from "@jest/globals";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError, {
  MAX_LLM_PROVIDER_ERROR_LENGTH,
} from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import LlmProviderHttp, {
  buildQueryString,
  readArray,
  readCount,
  readObject,
  readText,
} from "../../../../Server/Utils/LlmObservability/LlmProviderHttp";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * The one error a connector throws and the one way it sends a request:
 * failures classified by what the provider answered, secrets and anything
 * shaped like a provider key removed before a message exists, messages held
 * to the stored length in linear time, and a request that never settles
 * held to a deadline.
 */

const SECRET: string = "very-secret-client-value-123";

describe("LlmProviderError.kindFromStatus", () => {
  test.each([
    [401, LlmConnectionFailureKind.Authentication],
    [403, LlmConnectionFailureKind.Permission],
    [404, LlmConnectionFailureKind.Settings],
    [429, LlmConnectionFailureKind.RateLimited],
    [500, LlmConnectionFailureKind.Unavailable],
    [503, LlmConnectionFailureKind.Unavailable],
    [400, LlmConnectionFailureKind.Other],
    [409, LlmConnectionFailureKind.Other],
  ])("HTTP %i is %s", (status: number, kind: LlmConnectionFailureKind) => {
    expect(LlmProviderError.kindFromStatus(status)).toBe(kind);
  });
});

describe("LlmProviderError.from", () => {
  test("a transport HTTP failure is classified by its status and keeps the provider's reason", () => {
    const error: LlmProviderError = LlmProviderError.from({
      error: new BadDataException(
        `Data source responded with HTTP 401: {"error":"invalid key ${SECRET}"}`,
      ),
      step: "usage report",
      providerTitle: "OpenAI",
      secretValues: [SECRET],
    });

    expect(error.kind).toBe(LlmConnectionFailureKind.Authentication);
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe(
      'OpenAI usage report failed with HTTP 401: {"error":"invalid key [REDACTED]"}',
    );
    expect(error.responseBody).toBe('{"error":"invalid key [REDACTED]"}');
  });

  test("anything else is a provider that could not be reached", () => {
    const error: LlmProviderError = LlmProviderError.from({
      error: new Error("getaddrinfo ENOTFOUND api.openai.com"),
      step: "usage report",
      providerTitle: "OpenAI",
    });

    expect(error.kind).toBe(LlmConnectionFailureKind.Unavailable);
    expect(error.message).toContain("did not complete: getaddrinfo ENOTFOUND");
    expect(
      LlmProviderError.from({ error: "boom", step: "x", providerTitle: "Y" })
        .message,
    ).toBe("Y x did not complete: boom");
  });

  test("an LlmProviderError keeps its kind and is redacted again with the secrets at hand", () => {
    const error: LlmProviderError = LlmProviderError.from({
      error: new LlmProviderError({
        message: `refused ${SECRET}`,
        kind: LlmConnectionFailureKind.RateLimited,
        statusCode: 429,
        retryAfterSeconds: 30,
        responseBody: `body ${SECRET}`,
      }),
      step: "read",
      providerTitle: "Anthropic",
      secretValues: [SECRET],
    });

    expect(error).toMatchObject({
      kind: LlmConnectionFailureKind.RateLimited,
      statusCode: 429,
      retryAfterSeconds: 30,
      message: "refused [REDACTED]",
      responseBody: "body [REDACTED]",
    });
  });
});

describe("LlmProviderError.redact", () => {
  test("the connection's secrets and anything shaped like a provider key are removed", () => {
    expect(
      LlmProviderError.redact(
        `key sk-admin-AbC123xyz_456AbC123xyz_456 and sk-ant-admin01-QQQQQQQQQQQQQQQQQQQQ and ${SECRET} twice ${SECRET}`,
        [SECRET],
      ),
    ).toBe("key [REDACTED] and [REDACTED] and [REDACTED] twice [REDACTED]");
  });

  test("the key prefixes the guidance names stay readable", () => {
    const guidance: string =
      "An OpenAI admin key starts with sk-admin-. A compliance key starts with sk-ant-api01-, as in sk-ant-api01-...";

    expect(LlmProviderError.redact(guidance)).toBe(guidance);
  });

  test("short or empty secret values never blank out ordinary words", () => {
    expect(
      LlmProviderError.redact("the key was refused", ["", "the", "e"]),
    ).toBe("the key was refused");
  });

  test("a message is held to the stored length, marked where it was cut", () => {
    const redacted: string = LlmProviderError.redact("x".repeat(5000));

    expect(redacted).toHaveLength(MAX_LLM_PROVIDER_ERROR_LENGTH);
    expect(redacted.endsWith("... (truncated)")).toBe(true);
  });

  test("400,000 characters of hostile text are redacted in linear time", () => {
    const hostile: Array<string> = [
      "sk-".repeat(133_334),
      `sk-${"a".repeat(400_000)}`,
      `${"sk-a".repeat(100_000)}`,
      `Data source responded with HTTP 500: ${" ".repeat(400_000)}`,
    ];

    for (const text of hostile) {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          LlmProviderError.redact(text, [SECRET]);
          LlmProviderError.readTransportHttpError(new Error(text));
        },
        limitInMs: 2000,
      });
      expect(timed.inMs).toBeLessThan(2000);
    }
  });

  test("the transport's HTTP failure is read back; other errors are not one", () => {
    expect(
      LlmProviderError.readTransportHttpError(
        new Error("Data source responded with HTTP 429: slow down\nplease"),
      ),
    ).toEqual({ status: 429, body: "slow down\nplease" });
    expect(
      LlmProviderError.readTransportHttpError(new Error("socket hang up")),
    ).toBeNull();
    expect(LlmProviderError.readTransportHttpError(undefined)).toBeNull();
  });
});

describe("LlmProviderHttp", () => {
  test("query strings repeat keys in order, encode values and skip empty ones", () => {
    expect(
      buildQueryString([
        ["group_by[]", "model"],
        ["group_by[]", "project_id"],
        ["limit", 31],
        ["after", ""],
        ["page", undefined],
        ["x", null],
        ["$filter", "a eq 'b c'&d"],
        ["flag", false],
      ]),
    ).toBe(
      "group_by%5B%5D=model&group_by%5B%5D=project_id&limit=31&%24filter=a%20eq%20'b%20c'%26d&flag=false",
    );
  });

  test("an answer that is not a JSON object is a failure without the secret", async () => {
    for (const bodyJson of [[1, 2], "text", null]) {
      await expect(
        LlmProviderHttp.requestJson({
          transport: async () => {
            return {
              statusCode: 200,
              bodyText: "",
              bodyJson,
              headers: {},
            } as never;
          },
          method: "GET",
          url: "https://api.example.com/x",
          step: "usage report",
          providerTitle: "OpenAI",
          secretValues: [SECRET],
        }),
      ).rejects.toMatchObject({ kind: LlmConnectionFailureKind.Other });
    }
  });

  test("the request carries the method, headers, body and timeout it was given", async () => {
    const sent: Array<DataSourceHttpRequest> = [];

    const json: unknown = await LlmProviderHttp.requestJson({
      transport: async (request: DataSourceHttpRequest) => {
        sent.push(request);
        return {
          statusCode: 200,
          bodyText: "{}",
          bodyJson: { ok: true },
          headers: {},
        } as never;
      },
      method: "POST",
      url: "https://api.example.com/token",
      headers: { Accept: "application/json" },
      body: { grant_type: "client_credentials" },
      formUrlEncoded: true,
      timeoutInMs: 5000,
      step: "sign-in",
      providerTitle: "Azure",
      secretValues: [],
    });

    expect(json).toEqual({ ok: true });
    expect(sent[0]).toEqual({
      method: "POST",
      url: "https://api.example.com/token",
      headers: { Accept: "application/json" },
      body: { grant_type: "client_credentials" },
      formUrlEncoded: true,
      timeoutInMs: 5000,
    });
  });

  test("a transport that never answers is held to its deadline", async () => {
    const started: number = Date.now();

    await expect(
      LlmProviderHttp.send({
        transport: () => {
          return new Promise(() => {
            // Never settles.
          });
        },
        method: "GET",
        url: "https://api.example.com/slow",
        timeoutInMs: 10,
        step: "usage report",
        providerTitle: "OpenAI",
        secretValues: [],
      }),
    ).rejects.toMatchObject({
      kind: LlmConnectionFailureKind.Unavailable,
      message: "OpenAI usage report timed out after 0 seconds.",
    });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test("values read off a provider's JSON are what they claim to be, or nothing", () => {
    expect(readCount(12)).toBe(12);
    expect(readCount("12.5")).toBe(12.5);
    for (const value of [
      -1,
      "",
      " ",
      "x",
      null,
      undefined,
      Number.NaN,
      Infinity,
      {},
    ]) {
      expect(readCount(value)).toBe(0);
    }

    expect(readText("  a ")).toBe("a");
    expect(readText(5)).toBe("");
    expect(readObject({ a: 1 })).toEqual({ a: 1 });
    expect(readObject([1])).toEqual({});
    expect(readObject(null)).toEqual({});
    expect(readArray([1])).toEqual([1]);
    expect(readArray({})).toEqual([]);
  });
});
