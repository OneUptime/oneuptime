import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../Types/API/HTTPMethod";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import Dictionary from "../../Types/Dictionary";
import APIException from "../../Types/Exception/ApiException";
import { JSONObject } from "../../Types/JSON";
import Sleep from "../../Types/Sleep";
import API, { RequestOptions, RequestOutcome } from "../../Utils/API";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import axios, {
  AxiosError,
  AxiosHeaders,
  AxiosRequestConfig,
  AxiosResponse,
  AxiosStatic,
} from "axios";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError) and mock only the callable.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

const mockedAxios: jest.MockedFunction<AxiosStatic> =
  axios as unknown as jest.MockedFunction<AxiosStatic>;

const TEST_URL: URL = new URL(
  Protocol.HTTPS,
  "provider.example.com",
  new Route("/v1/chat/completions"),
);

/*
 * Simulated wall clock. Both the transport and the backoff sleep advance it,
 * so budget assertions are exact instead of racing real time.
 */
let nowInMs: number = 0;

/** Milliseconds passed to every Sleep.sleep call, in order. */
let sleptForInMs: Array<number> = [];

function createAxiosError(data: {
  status?: number | undefined;
  code?: string | undefined;
  headers?: Dictionary<string> | undefined;
  message?: string | undefined;
}): AxiosError {
  const error: AxiosError = new Error(
    data.message ?? "request failed",
  ) as AxiosError;

  error.isAxiosError = true;
  error.name = "AxiosError";
  error.config = { headers: new AxiosHeaders() };
  error.toJSON = () => {
    return {};
  };

  if (data.code) {
    error.code = data.code;
  }

  if (data.status !== undefined) {
    error.response = {
      status: data.status,
      statusText: "",
      data: { error: { message: "provider said no" } },
      headers: data.headers ?? {},
      config: { headers: new AxiosHeaders() },
    } as unknown as AxiosResponse;
  }

  return error;
}

function createAxiosSuccess(data: JSONObject = { ok: true }): AxiosResponse {
  return {
    data: data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: { headers: new AxiosHeaders() },
  } as unknown as AxiosResponse;
}

/**
 * Make every attempt fail with `error`, taking `elapsedPerAttemptInMs` of
 * simulated wall clock each time.
 */
function alwaysFailWith(
  error: AxiosError,
  elapsedPerAttemptInMs: number = 0,
): void {
  mockedAxios.mockImplementation(async () => {
    nowInMs += elapsedPerAttemptInMs;
    throw error;
  });
}

async function post(
  options: RequestOptions,
): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
  return API.post<JSONObject>({
    url: URL.fromString(TEST_URL.toString()),
    data: { hello: "world" },
    options: options,
  });
}

beforeEach(() => {
  nowInMs = 1_700_000_000_000;
  sleptForInMs = [];

  jest.spyOn(Date, "now").mockImplementation(() => {
    return nowInMs;
  });

  jest.spyOn(Sleep, "sleep").mockImplementation(async (ms: number) => {
    sleptForInMs.push(ms);
    nowInMs += ms;
  });

  // Deterministic jitter unless a test says otherwise: the midpoint.
  jest.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  mockedAxios.mockReset();
  jest.restoreAllMocks();
});

describe("API.isRetryableError", () => {
  interface RetryableCase {
    name: string;
    error: unknown;
    isRetryable: boolean;
  }

  const cases: Array<RetryableCase> = [
    {
      name: "a timeout that never produced a response",
      error: createAxiosError({
        code: "ECONNABORTED",
        message: "timeout of 120000ms exceeded",
      }),
      isRetryable: true,
    },
    {
      name: "a refused connection",
      error: createAxiosError({ code: "ECONNREFUSED" }),
      isRetryable: true,
    },
    {
      name: "a reset connection",
      error: createAxiosError({ code: "ECONNRESET" }),
      isRetryable: true,
    },
    {
      name: "a DNS failure",
      error: createAxiosError({ code: "ENOTFOUND" }),
      isRetryable: true,
    },
    {
      name: "HTTP 500",
      error: createAxiosError({ status: 500 }),
      isRetryable: true,
    },
    {
      name: "HTTP 502",
      error: createAxiosError({ status: 502 }),
      isRetryable: true,
    },
    {
      name: "HTTP 503",
      error: createAxiosError({ status: 503 }),
      isRetryable: true,
    },
    {
      name: "HTTP 504",
      error: createAxiosError({ status: 504 }),
      isRetryable: true,
    },
    {
      name: "HTTP 408 Request Timeout",
      error: createAxiosError({ status: 408 }),
      isRetryable: true,
    },
    {
      name: "HTTP 425 Too Early",
      error: createAxiosError({ status: 425 }),
      isRetryable: true,
    },
    {
      name: "HTTP 429 Too Many Requests",
      error: createAxiosError({ status: 429 }),
      isRetryable: true,
    },
    {
      name: "HTTP 400 Bad Request",
      error: createAxiosError({ status: 400 }),
      isRetryable: false,
    },
    {
      name: "HTTP 401 Unauthorized",
      error: createAxiosError({ status: 401 }),
      isRetryable: false,
    },
    {
      name: "HTTP 403 Forbidden",
      error: createAxiosError({ status: 403 }),
      isRetryable: false,
    },
    {
      name: "HTTP 404 Not Found",
      error: createAxiosError({ status: 404 }),
      isRetryable: false,
    },
    {
      name: "HTTP 422 Unprocessable Entity",
      error: createAxiosError({ status: 422 }),
      isRetryable: false,
    },
    {
      name: "a redirect surfaced because redirects are refused",
      error: createAxiosError({ status: 302 }),
      isRetryable: false,
    },
    {
      name: "a request the caller cancelled",
      error: createAxiosError({ code: "ERR_CANCELED" }),
      isRetryable: false,
    },
    {
      name: "a non-axios error thrown while building the request",
      error: new Error("cannot serialize body"),
      isRetryable: false,
    },
    { name: "a non-error value", error: "boom", isRetryable: false },
  ];

  test.each(cases)(
    "$name is retryable: $isRetryable",
    ({ error, isRetryable }: RetryableCase) => {
      expect(API.isRetryableError(error)).toBe(isRetryable);
    },
  );
});

describe("attempt counting", () => {
  test("stops as soon as an attempt succeeds", async () => {
    mockedAxios
      .mockRejectedValueOnce(createAxiosError({ status: 503 }))
      .mockRejectedValueOnce(createAxiosError({ status: 503 }))
      .mockResolvedValueOnce(createAxiosSuccess({ answer: 42 }));

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await post({
      retries: 9,
      exponentialBackoff: true,
    });

    expect(mockedAxios).toHaveBeenCalledTimes(3);
    expect(response).toBeInstanceOf(HTTPResponse);
    expect((response as HTTPResponse<JSONObject>).data).toEqual({ answer: 42 });
  });

  test("a 10-attempt budget makes exactly 10 attempts before giving up", async () => {
    alwaysFailWith(createAxiosError({ status: 503 }));

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await post({
      retries: 9,
      exponentialBackoff: true,
    });

    expect(mockedAxios).toHaveBeenCalledTimes(10);
    expect(response).toBeInstanceOf(HTTPErrorResponse);
    expect((response as HTTPErrorResponse).statusCode).toBe(503);
  });

  test("retries: 0 sends the request exactly once", async () => {
    alwaysFailWith(createAxiosError({ status: 503 }));

    await post({ retries: 0, exponentialBackoff: true });

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    expect(sleptForInMs).toEqual([]);
  });

  test("no retry option at all still sends the request once", async () => {
    mockedAxios.mockResolvedValueOnce(createAxiosSuccess());

    await post({});

    expect(mockedAxios).toHaveBeenCalledTimes(1);
  });

  test("a negative retry budget sends the request rather than reporting no response", async () => {
    mockedAxios.mockResolvedValueOnce(createAxiosSuccess({ answer: 1 }));

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await post({
      retries: -5,
    });

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    expect(response).toBeInstanceOf(HTTPResponse);
  });

  test("reports every attempt through onRequestComplete on success", async () => {
    mockedAxios
      .mockRejectedValueOnce(createAxiosError({ status: 503 }))
      .mockResolvedValueOnce(createAxiosSuccess());

    let outcome: RequestOutcome | undefined = undefined;

    await post({
      retries: 9,
      exponentialBackoff: true,
      onRequestComplete: (result: RequestOutcome) => {
        outcome = result;
      },
    });

    expect(outcome).toBeDefined();
    expect(outcome!.attempts).toBe(2);
    expect(outcome!.statusCode).toBe(200);
  });

  test("reports every attempt through onRequestComplete on failure", async () => {
    alwaysFailWith(createAxiosError({ status: 503 }));

    let outcome: RequestOutcome | undefined = undefined;

    await post({
      retries: 3,
      exponentialBackoff: true,
      onRequestComplete: (result: RequestOutcome) => {
        outcome = result;
      },
    });

    expect(outcome!.attempts).toBe(4);
    expect(outcome!.statusCode).toBe(503);
  });

  test("a request that never gets a response still throws after the full budget", async () => {
    alwaysFailWith(
      createAxiosError({
        code: "ECONNABORTED",
        message: "timeout of 120000ms exceeded",
      }),
    );

    await expect(
      post({ retries: 2, exponentialBackoff: true }),
    ).rejects.toThrow(APIException);
    expect(mockedAxios).toHaveBeenCalledTimes(3);
  });
});

describe("exponential backoff", () => {
  test("doubles the wait between attempts", async () => {
    // Midpoint jitter (Math.random = 0.5) puts each wait at 75% of its base.
    alwaysFailWith(createAxiosError({ status: 503 }));

    await post({ retries: 3, exponentialBackoff: true });

    expect(sleptForInMs).toEqual([1500, 3000, 6000]);
  });

  test("never waits at all when backoff is off", async () => {
    alwaysFailWith(createAxiosError({ status: 503 }));

    await post({ retries: 3 });

    expect(mockedAxios).toHaveBeenCalledTimes(4);
    expect(sleptForInMs).toEqual([]);
  });

  test("caps each wait at maxBackoffInMs instead of doubling without limit", async () => {
    alwaysFailWith(createAxiosError({ status: 503 }));

    await post({ retries: 9, exponentialBackoff: true, maxBackoffInMs: 8000 });

    /*
     * The uncapped ladder would end at 2^9 = 512s for the last wait alone.
     * Capped at 8s (6s after midpoint jitter) the whole ladder is under a
     * minute.
     */
    expect(sleptForInMs).toEqual([
      1500, 3000, 6000, 6000, 6000, 6000, 6000, 6000, 6000,
    ]);
    expect(
      sleptForInMs.reduce((total: number, ms: number) => {
        return total + ms;
      }, 0),
    ).toBeLessThan(60_000);
  });

  test("falls back to a generous default cap when the caller names none", async () => {
    alwaysFailWith(createAxiosError({ status: 503 }));

    await post({ retries: 9, exponentialBackoff: true });

    for (const ms of sleptForInMs) {
      expect(ms).toBeLessThanOrEqual(API.DEFAULT_MAX_BACKOFF_IN_MS);
    }
    // The last waits are the ones the default cap actually bites on.
    expect(sleptForInMs[sleptForInMs.length - 1]).toBe(
      API.DEFAULT_MAX_BACKOFF_IN_MS / 2 + API.DEFAULT_MAX_BACKOFF_IN_MS / 2 / 2,
    );
  });

  test("the default cap leaves a short retry budget untouched", async () => {
    alwaysFailWith(createAxiosError({ status: 503 }));

    await post({ retries: 3, exponentialBackoff: true });

    // 2s, 4s, 8s bases — nowhere near the 60s default ceiling.
    expect(sleptForInMs).toEqual([1500, 3000, 6000]);
  });

  interface JitterCase {
    name: string;
    random: number;
    expectedFirstWaitInMs: number;
  }

  const jitterCases: Array<JitterCase> = [
    { name: "lowest", random: 0, expectedFirstWaitInMs: 1000 },
    { name: "midpoint", random: 0.5, expectedFirstWaitInMs: 1500 },
    { name: "highest", random: 0.999999, expectedFirstWaitInMs: 2000 },
  ];

  test.each(jitterCases)(
    "$name jitter keeps the first wait inside half the base and the full base",
    async ({ random, expectedFirstWaitInMs }: JitterCase) => {
      jest.spyOn(Math, "random").mockReturnValue(random);
      alwaysFailWith(createAxiosError({ status: 503 }));

      await post({ retries: 1, exponentialBackoff: true });

      expect(sleptForInMs).toEqual([expectedFirstWaitInMs]);
    },
  );

  test("spreads concurrent callers rather than releasing them together", async () => {
    // Real randomness for this one: the point is that the waits differ.
    jest.spyOn(Math, "random").mockRestore();
    alwaysFailWith(createAxiosError({ status: 503 }));

    const waitsByCaller: Array<number> = [];

    for (let caller: number = 0; caller < 25; caller++) {
      sleptForInMs = [];
      await post({ retries: 1, exponentialBackoff: true });
      waitsByCaller.push(sleptForInMs[0]!);
    }

    for (const wait of waitsByCaller) {
      expect(wait).toBeGreaterThanOrEqual(1000);
      expect(wait).toBeLessThanOrEqual(2000);
    }

    expect(new Set(waitsByCaller).size).toBeGreaterThan(1);
  });
});

describe("Retry-After", () => {
  test("waits as long as the server asked instead of using the formula", async () => {
    alwaysFailWith(
      createAxiosError({ status: 429, headers: { "retry-after": "7" } }),
    );

    await post({
      retries: 1,
      exponentialBackoff: true,
      maxBackoffInMs: 30_000,
    });

    expect(sleptForInMs).toEqual([7000]);
  });

  test("is read case-insensitively", async () => {
    alwaysFailWith(
      createAxiosError({ status: 429, headers: { "Retry-After": "3" } }),
    );

    await post({
      retries: 1,
      exponentialBackoff: true,
      maxBackoffInMs: 30_000,
    });

    expect(sleptForInMs).toEqual([3000]);
  });

  test("is still capped, so the server cannot own the caller's clock", async () => {
    alwaysFailWith(
      createAxiosError({ status: 429, headers: { "retry-after": "3600" } }),
    );

    await post({ retries: 1, exponentialBackoff: true, maxBackoffInMs: 8000 });

    expect(sleptForInMs).toEqual([8000]);
  });

  test("accepts the HTTP-date form", async () => {
    const retryAt: string = new Date(nowInMs + 5000).toUTCString();

    alwaysFailWith(
      createAxiosError({ status: 503, headers: { "retry-after": retryAt } }),
    );

    await post({
      retries: 1,
      exponentialBackoff: true,
      maxBackoffInMs: 30_000,
    });

    // toUTCString truncates to whole seconds, so allow the rounding.
    expect(sleptForInMs).toHaveLength(1);
    expect(sleptForInMs[0]).toBeGreaterThanOrEqual(4000);
    expect(sleptForInMs[0]).toBeLessThanOrEqual(5000);
  });

  test("treats a date already in the past as retry immediately", async () => {
    const retryAt: string = new Date(nowInMs - 60_000).toUTCString();

    alwaysFailWith(
      createAxiosError({ status: 503, headers: { "retry-after": retryAt } }),
    );

    await post({ retries: 1, exponentialBackoff: true });

    expect(mockedAxios).toHaveBeenCalledTimes(2);
    expect(sleptForInMs).toEqual([]);
  });

  test("ignores a value it cannot make sense of and backs off normally", async () => {
    alwaysFailWith(
      createAxiosError({
        status: 503,
        headers: { "retry-after": "soon-ish" },
      }),
    );

    await post({ retries: 1, exponentialBackoff: true });

    expect(sleptForInMs).toEqual([1500]);
  });

  test("ignores an empty header and backs off normally", async () => {
    alwaysFailWith(
      createAxiosError({ status: 503, headers: { "retry-after": "  " } }),
    );

    await post({ retries: 1, exponentialBackoff: true });

    expect(sleptForInMs).toEqual([1500]);
  });

  test("applies even when exponential backoff is off", async () => {
    alwaysFailWith(
      createAxiosError({ status: 429, headers: { "retry-after": "2" } }),
    );

    await post({ retries: 1 });

    expect(sleptForInMs).toEqual([2000]);
  });
});

describe("retryOnlyOnRetryableErrors", () => {
  test("spends nothing on a rejection that repeating cannot fix", async () => {
    alwaysFailWith(createAxiosError({ status: 400 }));

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await post({
      retries: 9,
      exponentialBackoff: true,
      retryOnlyOnRetryableErrors: true,
    });

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    expect(sleptForInMs).toEqual([]);
    expect(response).toBeInstanceOf(HTTPErrorResponse);
    expect((response as HTTPErrorResponse).statusCode).toBe(400);
  });

  test("still spends the full budget on an overloaded server", async () => {
    alwaysFailWith(createAxiosError({ status: 503 }));

    await post({
      retries: 9,
      exponentialBackoff: true,
      retryOnlyOnRetryableErrors: true,
      maxBackoffInMs: 8000,
    });

    expect(mockedAxios).toHaveBeenCalledTimes(10);
  });

  test("still spends the full budget on a rate limit", async () => {
    alwaysFailWith(createAxiosError({ status: 429 }));

    await post({
      retries: 9,
      exponentialBackoff: true,
      retryOnlyOnRetryableErrors: true,
      maxBackoffInMs: 8000,
    });

    expect(mockedAxios).toHaveBeenCalledTimes(10);
  });

  test("still spends the full budget on a timeout", async () => {
    alwaysFailWith(
      createAxiosError({
        code: "ECONNABORTED",
        message: "timeout of 120000ms exceeded",
      }),
    );

    await expect(
      post({
        retries: 9,
        exponentialBackoff: true,
        retryOnlyOnRetryableErrors: true,
        maxBackoffInMs: 8000,
      }),
    ).rejects.toThrow(APIException);

    expect(mockedAxios).toHaveBeenCalledTimes(10);
  });

  test("recovers when a rejected request starts succeeding", async () => {
    mockedAxios
      .mockRejectedValueOnce(createAxiosError({ status: 429 }))
      .mockRejectedValueOnce(
        createAxiosError({ code: "ECONNRESET", message: "socket hang up" }),
      )
      .mockResolvedValueOnce(createAxiosSuccess({ answer: "recovered" }));

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await post({
      retries: 9,
      exponentialBackoff: true,
      retryOnlyOnRetryableErrors: true,
      maxBackoffInMs: 8000,
    });

    expect(mockedAxios).toHaveBeenCalledTimes(3);
    expect((response as HTTPResponse<JSONObject>).data).toEqual({
      answer: "recovered",
    });
  });

  test("callers that have not opted in keep retrying everything", async () => {
    alwaysFailWith(createAxiosError({ status: 400 }));

    await post({ retries: 2, exponentialBackoff: true });

    expect(mockedAxios).toHaveBeenCalledTimes(3);
  });
});

describe("totalTimeoutInMs", () => {
  test("stops starting attempts once the budget is spent", async () => {
    const startedAtInMs: number = nowInMs;

    // Every attempt burns a full 120s per-attempt timeout.
    alwaysFailWith(
      createAxiosError({
        code: "ECONNABORTED",
        message: "timeout of 120000ms exceeded",
      }),
      120_000,
    );

    await expect(
      post({
        retries: 9,
        exponentialBackoff: true,
        maxBackoffInMs: 8000,
        totalTimeoutInMs: 360_000,
        timeout: 120_000,
      }),
    ).rejects.toThrow(APIException);

    /*
     * Three attempts start inside the budget; a fourth would start past it.
     * Without the budget this is ten attempts and twenty minutes.
     */
    expect(mockedAxios).toHaveBeenCalledTimes(3);

    /*
     * The budget gates when an attempt STARTS, so the last one is still
     * allowed to run its per-attempt timeout out past the line. It bounds the
     * total at budget + one timeout, which is the guarantee that matters.
     */
    expect(nowInMs - startedAtInMs).toBeLessThanOrEqual(360_000 + 120_000);
    expect(nowInMs - startedAtInMs).toBeLessThan(10 * 120_000);
  });

  test("leaves the full attempt budget available to failures that fail fast", async () => {
    // A rate limit answers in milliseconds, so all ten attempts fit easily.
    alwaysFailWith(createAxiosError({ status: 429 }), 10);

    await post({
      retries: 9,
      exponentialBackoff: true,
      maxBackoffInMs: 8000,
      totalTimeoutInMs: 360_000,
    });

    expect(mockedAxios).toHaveBeenCalledTimes(10);
  });

  test("does not sleep out a budget it cannot use", async () => {
    alwaysFailWith(createAxiosError({ status: 503 }), 1000);

    await post({
      retries: 9,
      exponentialBackoff: true,
      maxBackoffInMs: 8000,
      totalTimeoutInMs: 2_000,
    });

    /*
     * Attempt 1 ends at 1000ms and the next wait would land at 2500ms, past
     * the budget — so it gives up now rather than waiting first.
     */
    expect(mockedAxios).toHaveBeenCalledTimes(1);
    expect(sleptForInMs).toEqual([]);
  });

  test("is unbounded when the caller sets no budget", async () => {
    alwaysFailWith(
      createAxiosError({
        code: "ECONNABORTED",
        message: "timeout of 120000ms exceeded",
      }),
      120_000,
    );

    await expect(
      post({ retries: 9, exponentialBackoff: true, maxBackoffInMs: 8000 }),
    ).rejects.toThrow(APIException);

    expect(mockedAxios).toHaveBeenCalledTimes(10);
  });

  test("a budget of zero still sends the first attempt", async () => {
    alwaysFailWith(createAxiosError({ status: 503 }), 10);

    await post({ retries: 9, exponentialBackoff: true, totalTimeoutInMs: 0 });

    expect(mockedAxios).toHaveBeenCalledTimes(1);
  });
});

describe("request configuration across attempts", () => {
  test("every attempt carries the same method, url, body and per-attempt timeout", async () => {
    mockedAxios
      .mockRejectedValueOnce(createAxiosError({ status: 503 }))
      .mockResolvedValueOnce(createAxiosSuccess());

    await post({
      retries: 9,
      exponentialBackoff: true,
      timeout: 120_000,
      doNotFollowRedirects: true,
    });

    expect(mockedAxios).toHaveBeenCalledTimes(2);

    const first: AxiosRequestConfig = mockedAxios.mock
      .calls[0]![0] as AxiosRequestConfig;
    const second: AxiosRequestConfig = mockedAxios.mock
      .calls[1]![0] as AxiosRequestConfig;

    expect(first).toEqual(second);
    expect(first.method).toBe(HTTPMethod.POST);
    expect(first.url).toBe(TEST_URL.toString());
    expect(first.data).toEqual({ hello: "world" });
    expect(first.timeout).toBe(120_000);
    expect(first.maxRedirects).toBe(0);
  });

  test("keeps the SSRF guard's pinned agents on the retried attempt", async () => {
    const httpAgent: Record<string, unknown> = { pinned: "http" };
    const httpsAgent: Record<string, unknown> = { pinned: "https" };

    mockedAxios
      .mockRejectedValueOnce(createAxiosError({ status: 503 }))
      .mockResolvedValueOnce(createAxiosSuccess());

    await API.post<JSONObject>({
      url: URL.fromString(TEST_URL.toString()),
      data: { hello: "world" },
      options: {
        retries: 9,
        exponentialBackoff: true,
        doNotFollowRedirects: true,
        httpAgent: httpAgent as never,
        httpsAgent: httpsAgent as never,
      },
    });

    const retried: AxiosRequestConfig = mockedAxios.mock
      .calls[1]![0] as AxiosRequestConfig;

    expect(retried.httpAgent).toBe(httpAgent);
    expect(retried.httpsAgent).toBe(httpsAgent);
    expect(retried.maxRedirects).toBe(0);
  });
});
