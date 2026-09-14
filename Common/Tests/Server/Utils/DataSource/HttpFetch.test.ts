import http from "http";
import https from "https";
import axios, { AxiosRequestConfig } from "axios";
import {
  EgressGuardOptions,
  ResolvedAddress,
} from "../../../../Server/Utils/DataSource/EgressGuard";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import OutboundUserAgent from "../../../../Server/Utils/OutboundUserAgent";
import { DataSourceConnectionSettings } from "../../../../Server/Utils/DataSource/Types";
import {
  DATA_SOURCE_MAX_RESPONSE_SIZE_IN_BYTES,
  DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
} from "../../../../Types/DataSource/DataSourceLimits";
import DataSourceType from "../../../../Types/DataSource/DataSourceType";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Hermetic tests for the SSRF-hardened HTTP client. axios is mocked at the
 * module boundary so no socket is ever opened; every assertion is made
 * against the config object axios ACTUALLY received, because that config IS
 * the security contract (no redirects, response caps, pinned lookup).
 */
jest.mock("axios", () => {
  type IsAxiosErrorFunction = (candidate: unknown) => boolean;
  const isAxiosError: IsAxiosErrorFunction = (candidate: unknown): boolean => {
    return Boolean(
      candidate &&
        typeof candidate === "object" &&
        (candidate as { isAxiosError?: boolean }).isAxiosError === true,
    );
  };
  const axiosFunction: jest.Mock = Object.assign(jest.fn(), {
    isAxiosError: isAxiosError,
  });
  return {
    __esModule: true,
    default: axiosFunction,
  };
});

const axiosMock: jest.Mock = axios as unknown as jest.Mock;

const PUBLIC_IP: string = "93.184.216.34";
const PUBLIC_IPV6: string = "2606:2800:220:1:248:1893:25c8:1946";

interface RecordingEgress {
  options: EgressGuardOptions;
  calls: Array<string>;
}

function makeEgress(addresses?: Array<ResolvedAddress>): RecordingEgress {
  const calls: Array<string> = [];
  const resolved: Array<ResolvedAddress> = addresses || [
    { address: PUBLIC_IP, family: 4 },
  ];
  const options: EgressGuardOptions = {
    blockPrivateAddresses: true,
    resolveFunction: (hostname: string): Promise<Array<ResolvedAddress>> => {
      calls.push(hostname);
      return Promise.resolve(resolved);
    },
  };
  return { options: options, calls: calls };
}

function makeRequest(
  overrides?: Partial<DataSourceHttpRequest>,
): DataSourceHttpRequest {
  return {
    method: "GET",
    url: "https://api.example.com/v1/query?limit=10",
    egressOptions: makeEgress().options,
    ...overrides,
  };
}

function getAxiosConfig(callIndex: number = 0): AxiosRequestConfig {
  expect(axiosMock.mock.calls.length).toBeGreaterThan(callIndex);
  return axiosMock.mock.calls[callIndex]![0] as AxiosRequestConfig;
}

type CaptureRejectionFunction = (promise: Promise<unknown>) => Promise<Error>;

const captureRejection: CaptureRejectionFunction = async (
  promise: Promise<unknown>,
): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected promise to reject, but it resolved.");
};

interface LookupResultEntry {
  address: string;
  family: number;
}

type PinnedLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | Array<LookupResultEntry>,
  family?: number,
) => void;

type PinnedLookup = (
  hostname: string,
  options: { all?: boolean },
  callback: PinnedLookupCallback,
) => void;

interface AgentWithLookupOption {
  options: { lookup?: PinnedLookup };
}

function getPinnedLookup(agent: unknown): PinnedLookup {
  const lookup: PinnedLookup | undefined = (agent as AgentWithLookupOption)
    .options.lookup;
  expect(typeof lookup).toBe("function");
  return lookup!;
}

interface LookupOutcome {
  address: string | Array<LookupResultEntry>;
  family: number | undefined;
}

function runLookup(
  lookup: PinnedLookup,
  hostname: string,
  options: { all?: boolean },
): Promise<LookupOutcome> {
  return new Promise(
    (
      resolve: (outcome: LookupOutcome) => void,
      reject: (error: Error) => void,
    ) => {
      lookup(
        hostname,
        options,
        (
          error: NodeJS.ErrnoException | null,
          address: string | Array<LookupResultEntry>,
          family?: number,
        ): void => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ address: address, family: family });
        },
      );
    },
  );
}

beforeEach(() => {
  axiosMock.mockReset();
  axiosMock.mockResolvedValue({ status: 200, data: "{}" });
});

describe("DataSourceHttpFetch.fetch - hardened axios config", () => {
  test("refuses redirects: maxRedirects is 0", async () => {
    await DataSourceHttpFetch.fetch(makeRequest());
    expect(getAxiosConfig().maxRedirects).toBe(0);
  });

  test("caps response and request body size at DATA_SOURCE_MAX_RESPONSE_SIZE_IN_BYTES", async () => {
    await DataSourceHttpFetch.fetch(makeRequest());
    const config: AxiosRequestConfig = getAxiosConfig();
    expect(config.maxContentLength).toBe(
      DATA_SOURCE_MAX_RESPONSE_SIZE_IN_BYTES,
    );
    expect(config.maxBodyLength).toBe(DATA_SOURCE_MAX_RESPONSE_SIZE_IN_BYTES);
  });

  test("defaults the timeout to DATA_SOURCE_QUERY_TIMEOUT_IN_MS", async () => {
    await DataSourceHttpFetch.fetch(makeRequest());
    expect(getAxiosConfig().timeout).toBe(DATA_SOURCE_QUERY_TIMEOUT_IN_MS);
  });

  test("honors an explicit timeoutInMs", async () => {
    await DataSourceHttpFetch.fetch(makeRequest({ timeoutInMs: 1234 }));
    expect(getAxiosConfig().timeout).toBe(1234);
  });

  test("passes the guard-validated URL and method through to axios", async () => {
    await DataSourceHttpFetch.fetch(makeRequest());
    const config: AxiosRequestConfig = getAxiosConfig();
    expect(config.url).toBe("https://api.example.com/v1/query?limit=10");
    expect(config.method).toBe("GET");
  });

  test("keeps the raw body: responseType text with an identity transform", async () => {
    await DataSourceHttpFetch.fetch(makeRequest());
    const config: AxiosRequestConfig = getAxiosConfig();
    expect(config.responseType).toBe("text");
    const transforms: Array<(body: string) => string> =
      config.transformResponse as Array<(body: string) => string>;
    expect(Array.isArray(transforms)).toBe(true);
    expect(transforms).toHaveLength(1);
    expect(transforms[0]!('{"not":"parsed"}')).toBe('{"not":"parsed"}');
  });

  test("validateStatus accepts only statuses below 300 and refuses every 3xx/4xx/5xx", async () => {
    await DataSourceHttpFetch.fetch(makeRequest());
    const validateStatus: (status: number) => boolean = getAxiosConfig()
      .validateStatus as (status: number) => boolean;

    const redirectStatuses: Array<number> = [301, 302, 303, 307, 308];
    for (const status of redirectStatuses) {
      expect(validateStatus(status)).toBe(false);
    }

    // Contract is `status < 300`: every 2xx (and 1xx) passes...
    expect(validateStatus(200)).toBe(true);
    expect(validateStatus(204)).toBe(true);
    expect(validateStatus(299)).toBe(true);
    expect(validateStatus(101)).toBe(true);

    // ...and every 4xx/5xx throws so connectors surface the body as an error.
    const errorStatuses: Array<number> = [300, 400, 401, 404, 429, 500, 503];
    for (const status of errorStatuses) {
      expect(validateStatus(status)).toBe(false);
    }
  });
});

describe("DataSourceHttpFetch.fetch - pinned socket lookup", () => {
  test("provides per-request http and https agents", async () => {
    await DataSourceHttpFetch.fetch(makeRequest());
    await DataSourceHttpFetch.fetch(makeRequest());

    const first: AxiosRequestConfig = getAxiosConfig(0);
    const second: AxiosRequestConfig = getAxiosConfig(1);

    expect(first.httpAgent).toBeInstanceOf(http.Agent);
    expect(first.httpsAgent).toBeInstanceOf(https.Agent);
    expect(second.httpAgent).toBeInstanceOf(http.Agent);
    expect(second.httpsAgent).toBeInstanceOf(https.Agent);

    // Fresh agents per request — no lookup state shared across requests.
    expect(first.httpAgent).not.toBe(second.httpAgent);
    expect(first.httpsAgent).not.toBe(second.httpsAgent);
  });

  test("the agent lookup yields the pinned validated address, ignoring the hostname it is asked for", async () => {
    await DataSourceHttpFetch.fetch(makeRequest());
    const lookup: PinnedLookup = getPinnedLookup(getAxiosConfig().httpsAgent);

    /*
     * Even if DNS would now answer differently (rebind), the lookup must
     * return the address that was validated — for ANY hostname asked.
     */
    const outcome: LookupOutcome = await runLookup(
      lookup,
      "rebound.attacker.example",
      {},
    );
    expect(outcome.address).toBe(PUBLIC_IP);
    expect(outcome.family).toBe(4);
  });

  test("the agent lookup returns every pinned address when asked for all", async () => {
    const egress: RecordingEgress = makeEgress([
      { address: PUBLIC_IP, family: 4 },
      { address: PUBLIC_IPV6, family: 6 },
    ]);
    await DataSourceHttpFetch.fetch(
      makeRequest({ egressOptions: egress.options }),
    );

    const lookup: PinnedLookup = getPinnedLookup(getAxiosConfig().httpsAgent);
    const allOutcome: LookupOutcome = await runLookup(
      lookup,
      "api.example.com",
      { all: true },
    );
    expect(allOutcome.address).toEqual([
      { address: PUBLIC_IP, family: 4 },
      { address: PUBLIC_IPV6, family: 6 },
    ]);

    // Single-address mode pins the first validated address.
    const singleOutcome: LookupOutcome = await runLookup(
      lookup,
      "api.example.com",
      {},
    );
    expect(singleOutcome.address).toBe(PUBLIC_IP);
    expect(singleOutcome.family).toBe(4);
  });

  test("both the http and https agents carry the pinned lookup", async () => {
    await DataSourceHttpFetch.fetch(makeRequest());
    const config: AxiosRequestConfig = getAxiosConfig();
    const httpOutcome: LookupOutcome = await runLookup(
      getPinnedLookup(config.httpAgent),
      "api.example.com",
      {},
    );
    const httpsOutcome: LookupOutcome = await runLookup(
      getPinnedLookup(config.httpsAgent),
      "api.example.com",
      {},
    );
    expect(httpOutcome.address).toBe(PUBLIC_IP);
    expect(httpsOutcome.address).toBe(PUBLIC_IP);
  });
});

describe("DataSourceHttpFetch.fetch - egress guard runs before axios", () => {
  test("forwards egressOptions and resolves the URL hostname exactly once", async () => {
    const egress: RecordingEgress = makeEgress();
    await DataSourceHttpFetch.fetch(
      makeRequest({ egressOptions: egress.options }),
    );
    expect(egress.calls).toEqual(["api.example.com"]);
  });

  test("a blocked literal host rejects and axios is never called", async () => {
    const error: Error = await captureRejection(
      DataSourceHttpFetch.fetch(
        makeRequest({
          url: "http://169.254.169.254/latest/meta-data",
          egressOptions: { blockPrivateAddresses: false },
        }),
      ),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("169.254.169.254");
    expect(error.message).toContain("link-local");
    expect(axiosMock).not.toHaveBeenCalled();
  });

  test("a hostname resolving to loopback rejects and axios is never called", async () => {
    const egress: RecordingEgress = makeEgress([
      { address: "127.0.0.1", family: 4 },
    ]);
    const error: Error = await captureRejection(
      DataSourceHttpFetch.fetch(
        makeRequest({
          url: "https://evil.example.com/status",
          egressOptions: egress.options,
        }),
      ),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("evil.example.com");
    expect(error.message).toContain("loopback");
    expect(axiosMock).not.toHaveBeenCalled();
  });

  test("a non-http(s) scheme rejects and axios is never called", async () => {
    const error: Error = await captureRejection(
      DataSourceHttpFetch.fetch(makeRequest({ url: "file:///etc/passwd" })),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("http or https");
    expect(axiosMock).not.toHaveBeenCalled();
  });
});

describe("DataSourceHttpFetch.fetch - headers and body encoding", () => {
  test("passes request headers through to axios untouched, plus our User-Agent", async () => {
    const headers: Dictionary<string> = {
      "X-Api-Key": "secret-key",
      Authorization: "Bearer token-123",
    };
    await DataSourceHttpFetch.fetch(makeRequest({ headers: headers }));
    const config: AxiosRequestConfig = getAxiosConfig();
    expect(config.headers).toEqual({
      ...headers,
      "User-Agent": OutboundUserAgent.get(),
    });
  });

  test("GET requests never send a body, even when one is provided", async () => {
    await DataSourceHttpFetch.fetch(
      makeRequest({ method: "GET", body: "should-not-be-sent" }),
    );
    expect(getAxiosConfig().data).toBeUndefined();
  });

  test("POST string body is sent as-is with a default JSON content type", async () => {
    await DataSourceHttpFetch.fetch(
      makeRequest({ method: "POST", body: '{"raw":"body"}' }),
    );
    const config: AxiosRequestConfig = getAxiosConfig();
    expect(config.data).toBe('{"raw":"body"}');
    expect((config.headers as Dictionary<string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  test("POST string body respects an explicit Content-Type header", async () => {
    await DataSourceHttpFetch.fetch(
      makeRequest({
        method: "POST",
        body: "plain text",
        headers: { "Content-Type": "text/plain" },
      }),
    );
    const config: AxiosRequestConfig = getAxiosConfig();
    expect(config.data).toBe("plain text");
    expect((config.headers as Dictionary<string>)["Content-Type"]).toBe(
      "text/plain",
    );
  });

  test("POST object body with formUrlEncoded is sent as URLSearchParams", async () => {
    await DataSourceHttpFetch.fetch(
      makeRequest({
        method: "POST",
        body: { query: "up", start: "123" },
        formUrlEncoded: true,
      }),
    );
    const config: AxiosRequestConfig = getAxiosConfig();
    expect(config.data).toBeInstanceOf(URLSearchParams);
    expect((config.data as URLSearchParams).get("query")).toBe("up");
    expect((config.data as URLSearchParams).get("start")).toBe("123");
    expect((config.headers as Dictionary<string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  test("POST object body without formUrlEncoded is JSON-encoded", async () => {
    await DataSourceHttpFetch.fetch(
      makeRequest({ method: "POST", body: { key: "value" } }),
    );
    const config: AxiosRequestConfig = getAxiosConfig();
    expect(config.data).toBe('{"key":"value"}');
    expect((config.headers as Dictionary<string>)["Content-Type"]).toBe(
      "application/json",
    );
  });
});

/*
 * Regression cover for issue #3555: a bare `axios/<version>` User-Agent got
 * every outbound request 403'd by the target's WAF before it reached the
 * API. The transport now names the product on every request unless the
 * caller deliberately set its own UA.
 */
describe("DataSourceHttpFetch.fetch - outbound User-Agent", () => {
  function getSentHeaders(callIndex: number = 0): Dictionary<string> {
    return getAxiosConfig(callIndex).headers as Dictionary<string>;
  }

  test("sends a descriptive User-Agent when the caller set none", async () => {
    await DataSourceHttpFetch.fetch(makeRequest());
    expect(getSentHeaders()["User-Agent"]).toBe(OutboundUserAgent.get());
  });

  test("the User-Agent names OneUptime and is never axios' default", async () => {
    await DataSourceHttpFetch.fetch(makeRequest());
    const userAgent: string = getSentHeaders()["User-Agent"] as string;

    expect(userAgent.startsWith("OneUptime")).toBe(true);
    expect(userAgent).toContain("https://oneuptime.com");
    expect(userAgent.toLowerCase()).not.toContain("axios");
  });

  test("axios is never left to pick the User-Agent itself — the header is always set", async () => {
    await DataSourceHttpFetch.fetch(makeRequest({ headers: {} }));
    await DataSourceHttpFetch.fetch(
      makeRequest({ method: "POST", body: { q: "up" } }),
    );

    for (const callIndex of [0, 1]) {
      const userAgent: string | undefined =
        getSentHeaders(callIndex)["User-Agent"];
      expect(typeof userAgent).toBe("string");
      expect((userAgent as string).trim()).not.toBe("");
    }
  });

  test("a caller's explicit User-Agent wins — a data source may demand its own", async () => {
    await DataSourceHttpFetch.fetch(
      makeRequest({
        headers: { "User-Agent": "AcmeSOC/3.1 (soc@acme.example)" },
      }),
    );
    expect(getSentHeaders()["User-Agent"]).toBe(
      "AcmeSOC/3.1 (soc@acme.example)",
    );
  });

  test("a caller's lowercase user-agent wins without a second casing being sent", async () => {
    await DataSourceHttpFetch.fetch(
      makeRequest({ headers: { "user-agent": "AcmeSOC/3.1" } }),
    );
    const headers: Dictionary<string> = getSentHeaders();

    expect(headers["user-agent"]).toBe("AcmeSOC/3.1");
    expect(headers["User-Agent"]).toBeUndefined();
  });

  test("a blank User-Agent is replaced rather than sent as-is", async () => {
    await DataSourceHttpFetch.fetch(
      makeRequest({ headers: { "User-Agent": "   " } }),
    );
    expect(getSentHeaders()["User-Agent"]).toBe(OutboundUserAgent.get());
  });

  test("it rides alongside auth headers rather than displacing them", async () => {
    const headers: Dictionary<string> = DataSourceHttpFetch.buildAuthHeaders({
      dataSourceType: DataSourceType.RestApi,
      url: "https://api.example.com",
      apiToken: "tok-abc",
    });

    await DataSourceHttpFetch.fetch(makeRequest({ headers: headers }));
    const sent: Dictionary<string> = getSentHeaders();

    expect(sent["Authorization"]).toBe("Bearer tok-abc");
    expect(sent["User-Agent"]).toBe(OutboundUserAgent.get());
  });

  test("the caller's header dictionary is not mutated — pagination reuses it", async () => {
    const headers: Dictionary<string> = { Accept: "application/json" };

    await DataSourceHttpFetch.fetch(makeRequest({ headers: headers }));

    expect(headers).toEqual({ Accept: "application/json" });
  });
});

describe("DataSourceHttpFetch.buildAuthHeaders", () => {
  function makeSettings(
    overrides?: Partial<DataSourceConnectionSettings>,
  ): DataSourceConnectionSettings {
    return {
      dataSourceType: DataSourceType.RestApi,
      url: "https://api.example.com",
      ...overrides,
    };
  }

  test("returns no headers for settings without credentials", () => {
    expect(DataSourceHttpFetch.buildAuthHeaders(makeSettings())).toEqual({});
  });

  test("apiToken becomes a Bearer Authorization header", () => {
    const headers: Dictionary<string> = DataSourceHttpFetch.buildAuthHeaders(
      makeSettings({ apiToken: "tok-abc" }),
    );
    expect(headers).toEqual({ Authorization: "Bearer tok-abc" });
  });

  test("username and password become HTTP basic auth", () => {
    const headers: Dictionary<string> = DataSourceHttpFetch.buildAuthHeaders(
      makeSettings({ username: "user", password: "pass" }),
    );
    const expected: string = Buffer.from("user:pass").toString("base64");
    expect(headers).toEqual({ Authorization: `Basic ${expected}` });
  });

  test("username without password still produces basic auth", () => {
    const headers: Dictionary<string> = DataSourceHttpFetch.buildAuthHeaders(
      makeSettings({ username: "user" }),
    );
    const expected: string = Buffer.from("user:").toString("base64");
    expect(headers).toEqual({ Authorization: `Basic ${expected}` });
  });

  test("apiToken wins over username/password", () => {
    const headers: Dictionary<string> = DataSourceHttpFetch.buildAuthHeaders(
      makeSettings({ apiToken: "tok", username: "user", password: "pass" }),
    );
    expect(headers).toEqual({ Authorization: "Bearer tok" });
  });

  test("customHeaders are applied last and may override Authorization", () => {
    const headers: Dictionary<string> = DataSourceHttpFetch.buildAuthHeaders(
      makeSettings({
        apiToken: "tok",
        customHeaders: {
          Authorization: "Custom scheme",
          "X-Extra": "extra-value",
        },
      }),
    );
    expect(headers).toEqual({
      Authorization: "Custom scheme",
      "X-Extra": "extra-value",
    });
  });
});

describe("DataSourceHttpFetch.fetch - response handling", () => {
  test("returns status, raw body text and parsed JSON on success", async () => {
    axiosMock.mockResolvedValue({ status: 200, data: '{"ok":true,"n":2}' });
    const response: DataSourceHttpResponse =
      await DataSourceHttpFetch.fetch(makeRequest());
    expect(response.statusCode).toBe(200);
    expect(response.bodyText).toBe('{"ok":true,"n":2}');
    expect(response.bodyJson).toEqual({ ok: true, n: 2 });
  });

  test("leaves bodyJson undefined for a non-JSON body", async () => {
    axiosMock.mockResolvedValue({ status: 200, data: "plain text response" });
    const response: DataSourceHttpResponse =
      await DataSourceHttpFetch.fetch(makeRequest());
    expect(response.bodyText).toBe("plain text response");
    expect(response.bodyJson).toBeUndefined();
  });

  test("normalizes an empty body to an empty string", async () => {
    axiosMock.mockResolvedValue({ status: 204, data: "" });
    const response: DataSourceHttpResponse =
      await DataSourceHttpFetch.fetch(makeRequest());
    expect(response.statusCode).toBe(204);
    expect(response.bodyText).toBe("");
    expect(response.bodyJson).toBeUndefined();
  });
});

describe("DataSourceHttpFetch.fetch - error mapping", () => {
  test("a 302 answer rejects as BadDataException instead of following the redirect", async () => {
    /*
     * With validateStatus refusing 3xx and maxRedirects 0, axios rejects
     * with an error carrying the response — simulate exactly that shape.
     */
    axiosMock.mockRejectedValue({
      isAxiosError: true,
      message: "Request failed with status code 302",
      response: { status: 302, data: "" },
    });
    const error: Error = await captureRejection(
      DataSourceHttpFetch.fetch(makeRequest()),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("Data source responded with HTTP 302");
  });

  test("an HTTP error status surfaces the status and the body excerpt", async () => {
    axiosMock.mockRejectedValue({
      isAxiosError: true,
      message: "Request failed with status code 500",
      response: { status: 500, data: "parse error at char 5" },
    });
    const error: Error = await captureRejection(
      DataSourceHttpFetch.fetch(makeRequest()),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("Data source responded with HTTP 500");
    expect(error.message).toContain("parse error at char 5");
  });

  test("a non-string error body is JSON-encoded into the message", async () => {
    axiosMock.mockRejectedValue({
      isAxiosError: true,
      message: "Request failed with status code 400",
      response: { status: 400, data: { error: "bad query" } },
    });
    const error: Error = await captureRejection(
      DataSourceHttpFetch.fetch(makeRequest()),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("HTTP 400");
    expect(error.message).toContain('{"error":"bad query"}');
  });

  test("the error body excerpt is capped at 500 characters", async () => {
    axiosMock.mockRejectedValue({
      isAxiosError: true,
      message: "Request failed with status code 500",
      response: { status: 500, data: "x".repeat(600) },
    });
    const error: Error = await captureRejection(
      DataSourceHttpFetch.fetch(makeRequest()),
    );
    expect(error.message).toContain("x".repeat(500));
    expect(error.message).not.toContain("x".repeat(501));
  });

  test("a connection failure maps to a friendly could-not-reach error", async () => {
    axiosMock.mockRejectedValue(
      new Error("connect ECONNREFUSED 93.184.216.34:443"),
    );
    const error: Error = await captureRejection(
      DataSourceHttpFetch.fetch(makeRequest()),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("Could not reach data source");
    expect(error.message).toContain("Connection Refused");
  });

  test("an axios timeout without a response maps to a friendly timeout error", async () => {
    axiosMock.mockRejectedValue({
      isAxiosError: true,
      message: "timeout of 30000ms exceeded",
      response: undefined,
    });
    const error: Error = await captureRejection(
      DataSourceHttpFetch.fetch(makeRequest()),
    );
    expect(error instanceof BadDataException).toBe(true);
    expect(error.message).toContain("Could not reach data source");
    expect(error.message).toContain("Timeout Error");
  });
});
