// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
delete process.env["PROBE_ALLOW_PRIVATE_NETWORK_MONITORS"];

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import ApiMonitor, {
  APIResponse,
} from "../../../../Utils/Monitors/MonitorTypes/ApiMonitor";
import HttpMonitorRequest, {
  HTTP_MONITOR_MAX_REQUEST_BYTES,
  HTTP_MONITOR_MAX_RESPONSE_BYTES,
} from "../../../../Utils/Monitors/HttpMonitorRequest";
import { HttpTimingCollector } from "../../../../Utils/HttpTimingAgents";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import PositiveNumber from "Common/Types/PositiveNumber";
import Sleep from "Common/Types/Sleep";
import API, { APIFetchOptions } from "Common/Utils/API";
import { AddressInfo } from "net";
import dns from "dns";
import http, { IncomingMessage, Server, ServerResponse } from "http";

const PRIVATE_BODY_SENTINEL: string = "private-api-body-ghsa-9wgr";
const PRIVATE_HEADER_SENTINEL: string = "private-api-header-ghsa-9wgr";
const REDIRECT_BODY_SENTINEL: string = "redirect-body-must-not-leak";
const REDIRECT_HEADER_SENTINEL: string = "redirect-header-must-not-leak";

function successResponse(
  statusCode: number,
  data: JSONObject,
  headers: Record<string, string> = {},
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(statusCode, data, headers);
}

describe("ApiMonitor SSRF protection", () => {
  let privateServer: Server;
  let privateServerUrl: URL;
  let privateServerHits: number = 0;

  beforeAll(async () => {
    privateServer = http.createServer(
      (_request: IncomingMessage, response: ServerResponse) => {
        privateServerHits++;
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json");
        response.setHeader("X-Private-Probe", PRIVATE_HEADER_SENTINEL);
        response.end(JSON.stringify({ secret: PRIVATE_BODY_SENTINEL }));
      },
    );

    await new Promise<void>((resolve: () => void) => {
      privateServer.listen(0, "127.0.0.1", () => {
        const address: AddressInfo = privateServer.address() as AddressInfo;
        privateServerUrl = URL.fromString(
          `http://127.0.0.1:${address.port}/private-api`,
        );
        resolve();
      });
    });
  });

  it("creates a fresh deadline when the same caller options object is reused", async () => {
    const requestSignals: Array<AbortSignal | undefined> = [];
    jest.spyOn(API, "fetch").mockImplementation((request: APIFetchOptions) => {
      requestSignals.push(request.options?.signal);
      return Promise.resolve(successResponse(200, { ok: true })) as never;
    });
    const options: Parameters<typeof ApiMonitor.ping>[1] = {
      retry: 0,
      isOnlineCheckRequest: true,
    };

    expect(
      (await ApiMonitor.ping(URL.fromString("http://1.1.1.1/first"), options))
        ?.isOnline,
    ).toBe(true);
    expect(options.executionContext).toBeUndefined();

    expect(
      (await ApiMonitor.ping(URL.fromString("http://1.1.1.1/second"), options))
        ?.isOnline,
    ).toBe(true);
    expect(options.executionContext).toBeUndefined();
    expect(requestSignals).toHaveLength(2);
    expect(requestSignals[0]).toBeDefined();
    expect(requestSignals[1]).toBeDefined();
    expect(requestSignals[1]).not.toBe(requestSignals[0]);
  });
  beforeEach(() => {
    privateServerHits = 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      privateServer.close(() => {
        resolve();
      });
    });
  });

  it("rejects a loopback target before any request, response exfiltration, or retry", async () => {
    const fetchSpy: jest.SpyInstance = jest.spyOn(API, "fetch");
    const prepareSpy: jest.SpyInstance = jest.spyOn(
      HttpMonitorRequest,
      "prepare",
    );
    const sleepSpy: jest.SpyInstance = jest
      .spyOn(Sleep, "sleep")
      .mockResolvedValue(undefined);

    const response: APIResponse | null = await ApiMonitor.ping(
      privateServerUrl,
      {
        requestType: HTTPMethod.POST,
        requestHeaders: {
          Authorization: "Bearer attacker-controlled",
          "X-Attack": "global-probe",
        },
        requestBody: { action: "read-internal-data" },
        retry: 9,
        isOnlineCheckRequest: true,
      },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.statusCode).toBeUndefined();
    expect(response!.responseBody).toBe("");
    expect(response!.responseHeaders).toEqual({});
    expect(response!.failureCause).toContain("loopback address");
    expect(response!.totalAttempts).toBe(1);
    expect(JSON.stringify(response)).not.toContain(PRIVATE_BODY_SENTINEL);
    expect(JSON.stringify(response)).not.toContain(PRIVATE_HEADER_SENTINEL);
    expect(privateServerHits).toBe(0);
    expect(prepareSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it("validates a redirect hop and does not expose the redirect or private response", async () => {
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          302,
          { data: REDIRECT_BODY_SENTINEL },
          {
            Location: privateServerUrl.toString(),
            "X-Redirect-Secret": REDIRECT_HEADER_SENTINEL,
          },
        ) as never,
      );
    const sleepSpy: jest.SpyInstance = jest
      .spyOn(Sleep, "sleep")
      .mockResolvedValue(undefined);

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString("http://1.1.1.1/public-entry"),
      {
        retry: 7,
        isOnlineCheckRequest: true,
      },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.responseBody).toBe("");
    expect(response!.responseHeaders).toEqual({});
    expect(response!.totalAttempts).toBe(1);
    expect(JSON.stringify(response)).not.toContain(REDIRECT_BODY_SENTINEL);
    expect(JSON.stringify(response)).not.toContain(REDIRECT_HEADER_SENTINEL);
    expect(JSON.stringify(response)).not.toContain(PRIVATE_BODY_SENTINEL);
    expect(JSON.stringify(response)).not.toContain(PRIVATE_HEADER_SENTINEL);
    expect(privateServerHits).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it("does not expose a rejected internal DNS answer in the serialized result", async () => {
    const internalAddress: string = "10.23.45.67";
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: internalAddress, family: 4 }] as never);
    const fetchSpy: jest.SpyInstance = jest.spyOn(API, "fetch");

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString("http://internal-api.example.test/secret"),
      { retry: 9, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.totalAttempts).toBe(1);
    expect(response!.failureCause).toBe(
      "Monitor target host internal-api.example.test could not be reached.",
    );
    expect(JSON.stringify(response)).not.toContain(internalAddress);
    expect(JSON.stringify(response)).not.toContain("private network");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows a public redirect only after preparing both hops", async () => {
    const redirectUrl: string = "http://8.8.8.8/a//b?tag=one&tag=two";
    const prepareSpy: jest.SpyInstance = jest.spyOn(
      HttpMonitorRequest,
      "prepare",
    );
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          302,
          { data: "public-redirect" },
          { Location: redirectUrl },
        ) as never,
      )
      .mockResolvedValueOnce(
        successResponse(
          200,
          { ok: true, source: "validated-public-redirect" },
          { "X-Final": "yes" },
        ) as never,
      );

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString("http://1.1.1.1/start"),
      { retry: 0, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(true);
    expect(response!.statusCode).toBe(200);
    expect(response!.responseBody).toContain("validated-public-redirect");
    expect(response!.responseHeaders).toEqual({ "X-Final": "yes" });
    expect(prepareSpy).toHaveBeenCalledTimes(2);
    expect(prepareSpy.mock.calls[0]![0]).toBe("http://1.1.1.1/start");
    expect(prepareSpy.mock.calls[1]![0]).toBe(redirectUrl);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const firstOptions: NonNullable<APIFetchOptions["options"]> = (
      fetchSpy.mock.calls[0]![0] as APIFetchOptions
    ).options!;
    const secondOptions: NonNullable<APIFetchOptions["options"]> = (
      fetchSpy.mock.calls[1]![0] as APIFetchOptions
    ).options!;
    expect(firstOptions.signal).toBe(secondOptions.signal);
    expect(firstOptions.responseBodyBudget).toBe(
      secondOptions.responseBodyBudget,
    );
    expect(secondOptions.dispatchUrl).toBe(redirectUrl);

    for (const call of fetchSpy.mock.calls) {
      const request: APIFetchOptions = call[0] as APIFetchOptions;
      expect(request.options).toEqual(
        expect.objectContaining({
          doNotFollowRedirects: true,
          disableProxy: true,
          maxContentLength: HTTP_MONITOR_MAX_RESPONSE_BYTES,
          maxBodyLength: HTTP_MONITOR_MAX_REQUEST_BYTES,
        }),
      );
      expect(request.options?.httpAgent).toBeDefined();
      expect(request.options?.httpsAgent).toBeDefined();
    }
  });

  it("keeps headers and TLS identity on the same origin but clears both before crossing origins", async () => {
    const prepareSpy: jest.SpyInstance = jest.spyOn(
      HttpMonitorRequest,
      "prepare",
    );
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockResolvedValueOnce(
        new HTTPErrorResponse(302, {}, { Location: "/same-origin" }) as never,
      )
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          302,
          {},
          { Location: "https://8.8.8.8/final" },
        ) as never,
      )
      .mockResolvedValueOnce(successResponse(200, { ok: true }) as never);

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString("https://1.1.1.1/start"),
      {
        requestHeaders: { "X-API-Key": "must-stay-on-first-origin" },
        tlsClientCertificate: "CLIENT CERTIFICATE",
        tlsClientKey: "CLIENT PRIVATE KEY",
        tlsClientKeyPassphrase: "CLIENT KEY PASSPHRASE",
        allowSelfSignedCertificates: true,
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.isOnline).toBe(true);
    expect(prepareSpy).toHaveBeenCalledTimes(3);

    const firstPrepareOptions: NonNullable<
      Parameters<typeof HttpMonitorRequest.prepare>[1]
    > = prepareSpy.mock.calls[0]![1];
    const sameOriginPrepareOptions: NonNullable<
      Parameters<typeof HttpMonitorRequest.prepare>[1]
    > = prepareSpy.mock.calls[1]![1];
    const crossOriginPrepareOptions: NonNullable<
      Parameters<typeof HttpMonitorRequest.prepare>[1]
    > = prepareSpy.mock.calls[2]![1];

    expect(firstPrepareOptions.tls).toEqual({
      allowSelfSignedCertificates: true,
      tlsClientCertificate: "CLIENT CERTIFICATE",
      tlsClientKey: "CLIENT PRIVATE KEY",
      tlsClientKeyPassphrase: "CLIENT KEY PASSPHRASE",
    });
    expect(sameOriginPrepareOptions.tls).toEqual(firstPrepareOptions.tls);
    expect(crossOriginPrepareOptions.tls).toBeUndefined();

    expect((fetchSpy.mock.calls[0]![0] as APIFetchOptions).headers).toEqual({
      "X-API-Key": "must-stay-on-first-origin",
    });
    expect((fetchSpy.mock.calls[1]![0] as APIFetchOptions).headers).toEqual({
      "X-API-Key": "must-stay-on-first-origin",
    });
    expect((fetchSpy.mock.calls[2]![0] as APIFetchOptions).headers).toEqual({});
  });

  it("refuses a cross-origin redirect before replaying a request body", async () => {
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          307,
          {},
          { Location: "https://8.8.8.8/collect" },
        ) as never,
      );

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString("https://1.1.1.1/start"),
      {
        requestType: HTTPMethod.POST,
        requestHeaders: { "X-API-Key": "must-not-leak" },
        requestBody: { secret: "must-not-leak" },
        retry: 9,
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toContain("unsafe cross-origin redirect");
    expect(response?.totalAttempts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("preserves an allowed request method, headers, and body while forcing safe transport options", async () => {
    const requestBody: JSONObject = {
      command: "probe",
      nested: { enabled: true },
    };
    const requestHeaders: Record<string, string> = {
      Authorization: "Bearer public-service-token",
      "Content-Type": "application/json",
      "X-Custom-Header": "kept",
    };
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockResolvedValueOnce(
        successResponse(200, { accepted: true }, { "X-Result": "ok" }) as never,
      );

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString("https://8.8.8.8/custom-api"),
      {
        requestType: HTTPMethod.PATCH,
        requestHeaders,
        requestBody,
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(true);
    expect(response!.requestHeaders).toEqual(requestHeaders);
    expect(response!.requestBody).toEqual(requestBody);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const request: APIFetchOptions = fetchSpy.mock
      .calls[0]![0] as APIFetchOptions;
    expect(request.method).toBe(HTTPMethod.PATCH);
    expect(request.url.toString()).toBe("https://8.8.8.8/custom-api");
    expect(request.headers).toEqual(requestHeaders);
    expect(request.data).toEqual(requestBody);
    expect(request.options).toEqual(
      expect.objectContaining({
        doNotFollowRedirects: true,
        disableProxy: true,
        maxContentLength: HTTP_MONITOR_MAX_RESPONSE_BYTES,
        maxBodyLength: HTTP_MONITOR_MAX_REQUEST_BYTES,
      }),
    );
  });

  it("aborts an active request at one whole-check deadline without retrying", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockImplementation((request: APIFetchOptions) => {
        requestSignal = request.options?.signal;
        return new Promise(() => {}) as never;
      });

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString("http://1.1.1.1/hangs"),
      {
        timeout: new PositiveNumber(30),
        retry: 9,
        isOnlineCheckRequest: true,
      },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.isTimeout).toBe(true);
    expect(response!.totalAttempts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(requestSignal?.aborted).toBe(true);
  });

  it("uses one cumulative response budget across redirect hops", async () => {
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockImplementationOnce((request: APIFetchOptions) => {
        request.options!.responseBodyBudget!.consume(
          HTTP_MONITOR_MAX_RESPONSE_BYTES - 1,
        );
        return Promise.resolve(
          new HTTPErrorResponse(
            302,
            { data: "redirect" },
            { Location: "http://8.8.8.8/final" },
          ),
        ) as never;
      })
      .mockImplementationOnce((request: APIFetchOptions) => {
        request.options!.responseBodyBudget!.consume(2);
        return Promise.resolve(
          successResponse(200, { unreachable: true }),
        ) as never;
      });

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString("http://1.1.1.1/start"),
      { retry: 9, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.responseBody).toBe("");
    expect(response!.totalAttempts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("revalidates and rebuilds the request before a HEAD-to-GET fallback", async () => {
    const timingResetSpy: jest.SpyInstance = jest.spyOn(
      HttpTimingCollector.prototype,
      "reset",
    );
    const prepareSpy: jest.SpyInstance = jest.spyOn(
      HttpMonitorRequest,
      "prepare",
    );
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          405,
          { message: "HEAD unsupported" },
          {},
        ) as never,
      )
      .mockResolvedValueOnce(
        successResponse(200, { fallback: "GET" }) as never,
      );
    const publicUrl: URL = URL.fromString("https://1.1.1.1/head-fallback");

    const response: APIResponse | null = await ApiMonitor.ping(publicUrl, {
      requestType: HTTPMethod.HEAD,
      retry: 0,
      isOnlineCheckRequest: true,
    });

    expect(response).not.toBeNull();
    expect(response!.statusCode).toBe(200);
    expect(response!.responseBody).toContain('"fallback":"GET"');
    expect(prepareSpy).toHaveBeenCalledTimes(2);
    expect(prepareSpy.mock.calls[0]![0]).toBe(publicUrl.toString());
    expect(prepareSpy.mock.calls[1]![0]).toBe(publicUrl.toString());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(timingResetSpy).toHaveBeenCalledTimes(2);
    expect((fetchSpy.mock.calls[0]![0] as APIFetchOptions).method).toBe(
      HTTPMethod.HEAD,
    );
    expect((fetchSpy.mock.calls[1]![0] as APIFetchOptions).method).toBe(
      HTTPMethod.GET,
    );
    expect(
      (fetchSpy.mock.calls[1]![0] as APIFetchOptions).options?.signal,
    ).toBe((fetchSpy.mock.calls[0]![0] as APIFetchOptions).options?.signal);
  });

  it("honors doNotFollowRedirects while still disabling library redirects", async () => {
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          302,
          { data: "caller-visible-redirect" },
          { Location: privateServerUrl.toString() },
        ) as never,
      );

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString("http://1.1.1.1/no-follow"),
      {
        doNotFollowRedirects: true,
        retry: 0,
        isOnlineCheckRequest: true,
      },
    );

    expect(response).not.toBeNull();
    expect(response!.statusCode).toBe(302);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(privateServerHits).toBe(0);
    expect(
      (fetchSpy.mock.calls[0]![0] as APIFetchOptions).options
        ?.doNotFollowRedirects,
    ).toBe(true);
  });
});
