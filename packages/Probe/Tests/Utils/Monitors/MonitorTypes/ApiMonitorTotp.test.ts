// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
delete process.env["PROBE_ALLOW_PRIVATE_NETWORK_MONITORS"];

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import ApiMonitor, {
  APIResponse,
} from "../../../../Utils/Monitors/MonitorTypes/ApiMonitor";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import TotpCodeIssuer from "Common/Utils/Monitor/MonitorSecretTotp";
import {
  TotpAlgorithm,
  TotpParameters,
} from "Common/Utils/Totp/TotpParameters";
import { generateTotpCode } from "Common/Utils/Totp/TotpSecret";
import logger from "Common/Server/Utils/Logger";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

/*
 * An API monitor that sends a one-time code (issue #9703): each attempt
 * fills the {{monitorSecrets.NAME}} of a TOTP secret in its URL, headers
 * and body with the code of the moment it is sent - a retry gets a fresh
 * code, never one about to expire - while what the check reports keeps the
 * request as configured, and a response or an error that repeats a code
 * reports it masked. The codes come from a fake clock, so each attempt's
 * code is known.
 */

const LOGIN: TotpParameters = {
  secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  algorithm: TotpAlgorithm.SHA1,
  digits: 6,
  periodInSeconds: 30,
};

// The start of a 30-second period.
const PERIOD_START: number = 1111111080000;

const CHECK_TIMEOUT: PositiveNumber = new PositiveNumber(60000);

const URL_TEMPLATE: string =
  "http://1.1.1.1/verify?otp={{monitorSecrets.LoginCode}}";
const HEADERS_TEMPLATE: Dictionary<string> = {
  "X-OTP": "{{monitorSecrets.LoginCode}}",
  Accept: "application/json",
};
const BODY_TEMPLATE: JSONObject = {
  user: "ops",
  otp: "{{monitorSecrets.LoginCode}}",
};

interface SentRequest {
  url: string;
  headers: Dictionary<string>;
  body: JSONObject | undefined;
  at: number;
}

let nowInMs: number = 0;
let codeSleeps: Array<number> = [];
let sent: Array<SentRequest> = [];

function codeAt(atInMs: number): string {
  return generateTotpCode(LOGIN, atInMs);
}

function issuer(): TotpCodeIssuer {
  return new TotpCodeIssuer({
    secrets: { LoginCode: LOGIN },
    now: (): number => {
      return nowInMs;
    },
    sleep: async (ms: number): Promise<void> => {
      codeSleeps.push(ms);
      nowInMs += ms;
    },
  });
}

function answerWith(
  answers: Array<
    (request: SentRequest) => HTTPResponse<JSONObject> | HTTPErrorResponse
  >,
): void {
  jest.spyOn(API, "fetch").mockImplementation((async (options: {
    url: URL | string;
    headers: Dictionary<string>;
    data?: JSONObject;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    const request: SentRequest = {
      url: options.url.toString(),
      headers: { ...options.headers },
      body: options.data,
      at: nowInMs,
    };

    sent.push(request);

    const answer:
      | ((request: SentRequest) => HTTPResponse<JSONObject> | HTTPErrorResponse)
      | undefined = answers[Math.min(sent.length - 1, answers.length - 1)];

    return answer!(request);
  }) as never);
}

async function ping(retry: number): Promise<APIResponse> {
  const response: APIResponse | null = await ApiMonitor.ping(
    URL.fromString(URL_TEMPLATE),
    {
      retry,
      timeout: CHECK_TIMEOUT,
      isOnlineCheckRequest: true,
      requestType: HTTPMethod.POST,
      requestHeaders: { ...HEADERS_TEMPLATE },
      requestBody: { ...BODY_TEMPLATE },
      totpCodes: issuer(),
    },
  );

  expect(response).not.toBeNull();

  return response!;
}

function ok(data: JSONObject = { ok: true }): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

beforeEach(() => {
  nowInMs = PERIOD_START + 10_000;
  codeSleeps = [];
  sent = [];
  // The second between attempts moves the clock past the period.
  jest.spyOn(Sleep, "sleep").mockImplementation((async (
    ms: number,
  ): Promise<void> => {
    nowInMs += 30_000 + ms;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an attempt that sends a one-time code", () => {
  it("fills the URL, headers and body with the code of the moment it is sent", async () => {
    answerWith([
      (): HTTPResponse<JSONObject> => {
        return ok();
      },
    ]);

    await ping(0);

    const code: string = codeAt(PERIOD_START + 10_000);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(`http://1.1.1.1/verify?otp=${code}`);
    expect(sent[0]!.headers["X-OTP"]).toBe(code);
    expect(sent[0]!.headers["Accept"]).toBe("application/json");
    expect(sent[0]!.body).toEqual({ user: "ops", otp: code });
  });

  it("gives each retry a fresh code", async () => {
    answerWith([
      (): HTTPErrorResponse => {
        return new HTTPErrorResponse(401, { message: "bad code" }, {});
      },
      (): HTTPResponse<JSONObject> => {
        return ok();
      },
    ]);

    const response: APIResponse = await ping(1);

    expect(response.statusCode).toBe(200);
    expect(sent).toHaveLength(2);

    const first: string = codeAt(sent[0]!.at);
    const second: string = codeAt(sent[1]!.at);

    expect(first).not.toBe(second);
    expect(sent[0]!.headers["X-OTP"]).toBe(first);
    expect(sent[1]!.headers["X-OTP"]).toBe(second);
    expect(sent[1]!.body).toEqual({ user: "ops", otp: second });
  });

  it("waits for the next code before sending when the current one is about to expire", async () => {
    nowInMs = PERIOD_START + 27_500;

    answerWith([
      (): HTTPResponse<JSONObject> => {
        return ok();
      },
    ]);

    await ping(0);

    expect(codeSleeps).toEqual([2_500]);
    expect(sent[0]!.at).toBe(PERIOD_START + 30_000);
    expect(sent[0]!.headers["X-OTP"]).toBe(codeAt(PERIOD_START + 30_000));
  });

  it("reports the request as configured, never the codes it sent", async () => {
    answerWith([
      (): HTTPResponse<JSONObject> => {
        return ok();
      },
    ]);

    const response: APIResponse = await ping(0);

    expect(response.url.toString()).toBe(URL_TEMPLATE);
    expect(response.requestHeaders).toEqual(HEADERS_TEMPLATE);
    expect(response.requestBody).toEqual(BODY_TEMPLATE);
  });

  it("masks a code the response repeats, in its body and its headers", async () => {
    jest.spyOn(API, "fetch").mockImplementation((async (options: {
      headers: Dictionary<string>;
    }): Promise<HTTPResponse<JSONObject>> => {
      const code: string = options.headers["X-OTP"] as string;

      return new HTTPResponse<JSONObject>(
        200,
        { received: code, note: `code ${code} accepted`, id: 14920391 },
        { "x-echo": code },
      );
    }) as never);

    const response: APIResponse = await ping(0);
    const code: string = codeAt(PERIOD_START + 10_000);

    expect(response.responseBody).not.toContain(code);
    expect(JSON.parse(response.responseBody)).toEqual({
      received: "******",
      note: "code ****** accepted",
      id: 14920391,
    });
    expect(response.responseHeaders).toEqual({ "x-echo": "******" });
  });

  it("masks a code an error repeats, in the failure, every attempt and the logs", async () => {
    jest.spyOn(API, "fetch").mockImplementation((async (options: {
      headers: Dictionary<string>;
    }): Promise<never> => {
      throw new Error(`Upstream refused code ${options.headers["X-OTP"]}`);
    }) as never);

    const response: APIResponse = await ping(1);

    // The first attempt's code, then the retry's, a second and a period on.
    const codes: Array<string> = [
      codeAt(PERIOD_START + 10_000),
      codeAt(PERIOD_START + 41_000),
    ];

    expect(codes[0]).not.toBe(codes[1]);

    expect(response.isOnline).toBe(false);
    expect(response.failureCause).toContain("******");

    for (const attempt of response.probeAttempts as Array<ProbeAttempt>) {
      expect(attempt.failureCause).toContain("Upstream refused code ******");
    }

    const everything: string = JSON.stringify([
      response,
      (logger.error as jest.Mock).mock.calls,
      (logger.debug as jest.Mock).mock.calls,
    ]);

    for (const code of codes) {
      expect(everything).not.toContain(code);
    }
  });
});

describe("an attempt with no one-time code", () => {
  it("sends the request exactly as configured", async () => {
    answerWith([
      (): HTTPResponse<JSONObject> => {
        return ok();
      },
    ]);

    await ApiMonitor.ping(URL.fromString("http://1.1.1.1/health"), {
      retry: 0,
      timeout: CHECK_TIMEOUT,
      isOnlineCheckRequest: true,
      requestHeaders: { Authorization: "Bearer abc" },
      totpCodes: new TotpCodeIssuer({ secrets: {} }),
    });

    expect(sent[0]!.url).toBe("http://1.1.1.1/health");
    expect(sent[0]!.headers["Authorization"]).toBe("Bearer abc");
    expect(codeSleeps).toEqual([]);
  });

  it("leaves a reference to a secret it has no code for as written", async () => {
    answerWith([
      (): HTTPResponse<JSONObject> => {
        return ok();
      },
    ]);

    await ApiMonitor.ping(URL.fromString("http://1.1.1.1/health"), {
      retry: 0,
      timeout: CHECK_TIMEOUT,
      isOnlineCheckRequest: true,
      requestHeaders: { "X-OTP": "{{monitorSecrets.Unknown}}" },
      totpCodes: issuer(),
    });

    expect(sent[0]!.headers["X-OTP"]).toBe("{{monitorSecrets.Unknown}}");
  });
});
