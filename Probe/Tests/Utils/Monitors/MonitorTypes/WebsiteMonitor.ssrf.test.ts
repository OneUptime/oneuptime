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
import WebsiteMonitor, {
  ProbeWebsiteResponse,
} from "../../../../Utils/Monitors/MonitorTypes/WebsiteMonitor";
import HttpMonitorRequest, {
  HTTP_MONITOR_MAX_REQUEST_BYTES,
  HTTP_MONITOR_MAX_RESPONSE_BYTES,
} from "../../../../Utils/Monitors/HttpMonitorRequest";
import URL from "Common/Types/API/URL";
import HTML from "Common/Types/Html";
import PositiveNumber from "Common/Types/PositiveNumber";
import Sleep from "Common/Types/Sleep";
import WebsiteRequest, { WebsiteResponse } from "Common/Types/WebsiteRequest";
import { AddressInfo } from "net";
import dns from "dns";
import http, { IncomingMessage, Server, ServerResponse } from "http";

const PRIVATE_BODY_SENTINEL: string = "private-website-body-ghsa-9wgr";
const PRIVATE_HEADER_SENTINEL: string = "private-website-header-ghsa-9wgr";
const REDIRECT_BODY_SENTINEL: string = "website-redirect-body-must-not-leak";
const REDIRECT_HEADER_SENTINEL: string =
  "website-redirect-header-must-not-leak";

function websiteResponse(data: {
  url: string;
  statusCode: number;
  body: string;
  headers?: Record<string, string> | undefined;
}): WebsiteResponse {
  return {
    url: URL.fromString(data.url),
    requestHeaders: {},
    responseHeaders: data.headers || {},
    responseStatusCode: data.statusCode,
    responseBody: new HTML(data.body),
    isOnline: true,
  };
}

describe("WebsiteMonitor SSRF protection", () => {
  let privateServer: Server;
  let privateServerUrl: URL;
  let privateServerHits: number = 0;

  beforeAll(async () => {
    privateServer = http.createServer(
      (_request: IncomingMessage, response: ServerResponse) => {
        privateServerHits++;
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/html");
        response.setHeader("X-Private-Probe", PRIVATE_HEADER_SENTINEL);
        response.end(`<html>${PRIVATE_BODY_SENTINEL}</html>`);
      },
    );

    await new Promise<void>((resolve: () => void) => {
      privateServer.listen(0, "127.0.0.1", () => {
        const address: AddressInfo = privateServer.address() as AddressInfo;
        privateServerUrl = URL.fromString(
          `http://127.0.0.1:${address.port}/private-website`,
        );
        resolve();
      });
    });
  });

  it("creates a fresh deadline when the same caller options object is reused", async () => {
    const requestSignals: Array<AbortSignal | undefined> = [];
    jest
      .spyOn(WebsiteRequest, "fetch")
      .mockImplementation(
        (
          requestUrl: URL,
          requestOptions: Parameters<typeof WebsiteRequest.fetch>[1],
        ) => {
          requestSignals.push(requestOptions.signal);
          return Promise.resolve(
            websiteResponse({
              url: requestUrl.toString(),
              statusCode: 200,
              body: "ok",
            }),
          );
        },
      );
    const options: Parameters<typeof WebsiteMonitor.ping>[1] = {
      retry: 0,
      isOnlineCheckRequest: true,
    };

    expect(
      (
        await WebsiteMonitor.ping(
          URL.fromString("http://1.1.1.1/first"),
          options,
        )
      )?.isOnline,
    ).toBe(true);
    expect(options.executionContext).toBeUndefined();

    expect(
      (
        await WebsiteMonitor.ping(
          URL.fromString("http://1.1.1.1/second"),
          options,
        )
      )?.isOnline,
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
    const fetchSpy: jest.SpyInstance = jest.spyOn(WebsiteRequest, "fetch");
    const prepareSpy: jest.SpyInstance = jest.spyOn(
      HttpMonitorRequest,
      "prepare",
    );
    const sleepSpy: jest.SpyInstance = jest
      .spyOn(Sleep, "sleep")
      .mockResolvedValue(undefined);

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      privateServerUrl,
      { retry: 9, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.statusCode).toBeUndefined();
    expect(response!.responseBody).toBeUndefined();
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
      .spyOn(WebsiteRequest, "fetch")
      .mockResolvedValueOnce(
        websiteResponse({
          url: "http://1.1.1.1/public-entry",
          statusCode: 302,
          body: REDIRECT_BODY_SENTINEL,
          headers: {
            Location: privateServerUrl.toString(),
            "X-Redirect-Secret": REDIRECT_HEADER_SENTINEL,
          },
        }),
      );
    const sleepSpy: jest.SpyInstance = jest
      .spyOn(Sleep, "sleep")
      .mockResolvedValue(undefined);

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString("http://1.1.1.1/public-entry"),
      { retry: 7, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.responseBody).toBeUndefined();
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
    const fetchSpy: jest.SpyInstance = jest.spyOn(WebsiteRequest, "fetch");

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString("http://internal-website.example.test/secret"),
      { retry: 9, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.totalAttempts).toBe(1);
    expect(response!.failureCause).toBe(
      "Monitor target host internal-website.example.test could not be reached.",
    );
    expect(JSON.stringify(response)).not.toContain(internalAddress);
    expect(JSON.stringify(response)).not.toContain("private network");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows a public redirect only after preparing both hops", async () => {
    const redirectUrl: string = "http://8.8.8.8/~health";
    const prepareSpy: jest.SpyInstance = jest.spyOn(
      HttpMonitorRequest,
      "prepare",
    );
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(WebsiteRequest, "fetch")
      .mockResolvedValueOnce(
        websiteResponse({
          url: "http://1.1.1.1/start",
          statusCode: 302,
          body: "public redirect",
          headers: { Location: redirectUrl },
        }),
      )
      .mockResolvedValueOnce(
        websiteResponse({
          url: "http://8.8.8.8/final",
          statusCode: 200,
          body: "validated-public-website",
          headers: { "X-Final": "yes" },
        }),
      );

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString("http://1.1.1.1/start"),
      { retry: 0, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(true);
    expect(response!.statusCode).toBe(200);
    expect(response!.responseBody?.toString()).toBe("validated-public-website");
    expect(response!.responseHeaders).toEqual({ "X-Final": "yes" });
    expect(prepareSpy).toHaveBeenCalledTimes(2);
    expect(prepareSpy.mock.calls[0]![0]).toBe("http://1.1.1.1/start");
    expect(prepareSpy.mock.calls[1]![0]).toBe(redirectUrl);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const firstRequestOptions: Parameters<typeof WebsiteRequest.fetch>[1] =
      fetchSpy.mock.calls[0]![1] as Parameters<typeof WebsiteRequest.fetch>[1];
    const secondRequestOptions: Parameters<typeof WebsiteRequest.fetch>[1] =
      fetchSpy.mock.calls[1]![1] as Parameters<typeof WebsiteRequest.fetch>[1];
    expect(firstRequestOptions.signal).toBe(secondRequestOptions.signal);
    expect(firstRequestOptions.responseBodyBudget).toBe(
      secondRequestOptions.responseBodyBudget,
    );
    expect(secondRequestOptions.dispatchUrl).toBe(redirectUrl);

    for (const call of fetchSpy.mock.calls) {
      const options: Parameters<typeof WebsiteRequest.fetch>[1] =
        call[1] as Parameters<typeof WebsiteRequest.fetch>[1];
      expect(options).toEqual(
        expect.objectContaining({
          doNotFollowRedirects: true,
          doNotFallbackFromHead: true,
          acceptRedirectResponses: true,
          disableProxy: true,
          maxContentLength: HTTP_MONITOR_MAX_RESPONSE_BYTES,
          maxBodyLength: HTTP_MONITOR_MAX_REQUEST_BYTES,
        }),
      );
      expect(options.httpAgent).toBeDefined();
      expect(options.httpsAgent).toBeDefined();
    }
  });

  it("keeps TLS identity on the same origin but clears it before crossing origins", async () => {
    const prepareSpy: jest.SpyInstance = jest.spyOn(
      HttpMonitorRequest,
      "prepare",
    );
    jest
      .spyOn(WebsiteRequest, "fetch")
      .mockResolvedValueOnce(
        websiteResponse({
          url: "https://1.1.1.1/start",
          statusCode: 302,
          body: "same origin",
          headers: { Location: "/same-origin" },
        }),
      )
      .mockResolvedValueOnce(
        websiteResponse({
          url: "https://1.1.1.1/same-origin",
          statusCode: 302,
          body: "cross origin",
          headers: { Location: "https://8.8.8.8/final" },
        }),
      )
      .mockResolvedValueOnce(
        websiteResponse({
          url: "https://8.8.8.8/final",
          statusCode: 200,
          body: "ok",
        }),
      );

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString("https://1.1.1.1/start"),
      {
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
  });

  it("revalidates and rebuilds the request before a HEAD-to-GET fallback", async () => {
    const prepareSpy: jest.SpyInstance = jest.spyOn(
      HttpMonitorRequest,
      "prepare",
    );
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(WebsiteRequest, "fetch")
      .mockRejectedValueOnce(new Error("HEAD is not supported"))
      .mockResolvedValueOnce(
        websiteResponse({
          url: "https://1.1.1.1/head-fallback",
          statusCode: 200,
          body: "GET fallback succeeded",
        }),
      );
    const publicUrl: URL = URL.fromString("https://1.1.1.1/head-fallback");

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      publicUrl,
      { isHeadRequest: true, retry: 0, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.statusCode).toBe(200);
    expect(response!.responseBody?.toString()).toBe("GET fallback succeeded");
    expect(prepareSpy).toHaveBeenCalledTimes(2);
    expect(prepareSpy.mock.calls[0]![0]).toBe(publicUrl.toString());
    expect(prepareSpy.mock.calls[1]![0]).toBe(publicUrl.toString());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(
      (fetchSpy.mock.calls[0]![1] as Parameters<typeof WebsiteRequest.fetch>[1])
        .isHeadRequest,
    ).toBe(true);
    expect(
      (fetchSpy.mock.calls[1]![1] as Parameters<typeof WebsiteRequest.fetch>[1])
        .isHeadRequest,
    ).toBe(false);
    expect(
      (fetchSpy.mock.calls[0]![1] as Parameters<typeof WebsiteRequest.fetch>[1])
        .signal,
    ).toBe(
      (fetchSpy.mock.calls[1]![1] as Parameters<typeof WebsiteRequest.fetch>[1])
        .signal,
    );
    expect(
      (fetchSpy.mock.calls[0]![1] as Parameters<typeof WebsiteRequest.fetch>[1])
        .responseBodyBudget,
    ).toBe(
      (fetchSpy.mock.calls[1]![1] as Parameters<typeof WebsiteRequest.fetch>[1])
        .responseBodyBudget,
    );
  });

  it("aborts an active request at one whole-check deadline without retrying", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(WebsiteRequest, "fetch")
      .mockImplementation(
        (_url: URL, options: Parameters<typeof WebsiteRequest.fetch>[1]) => {
          requestSignal = options.signal;
          return new Promise(() => {});
        },
      );

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
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
      .spyOn(WebsiteRequest, "fetch")
      .mockImplementationOnce(
        (_url: URL, options: Parameters<typeof WebsiteRequest.fetch>[1]) => {
          options.responseBodyBudget!.consume(
            HTTP_MONITOR_MAX_RESPONSE_BYTES - 1,
          );
          return Promise.resolve(
            websiteResponse({
              url: "http://1.1.1.1/start",
              statusCode: 302,
              body: "redirect",
              headers: { Location: "http://8.8.8.8/final" },
            }),
          );
        },
      )
      .mockImplementationOnce(
        (_url: URL, options: Parameters<typeof WebsiteRequest.fetch>[1]) => {
          options.responseBodyBudget!.consume(2);
          return Promise.resolve(
            websiteResponse({
              url: "http://8.8.8.8/final",
              statusCode: 200,
              body: "unreachable",
            }),
          );
        },
      );

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString("http://1.1.1.1/start"),
      { retry: 9, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.responseBody).toBeUndefined();
    expect(response!.totalAttempts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("honors doNotFollowRedirects while still disabling library redirects", async () => {
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(WebsiteRequest, "fetch")
      .mockResolvedValueOnce(
        websiteResponse({
          url: "http://1.1.1.1/no-follow",
          statusCode: 302,
          body: "caller-visible-redirect",
          headers: { Location: privateServerUrl.toString() },
        }),
      );

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
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
      (fetchSpy.mock.calls[0]![1] as Parameters<typeof WebsiteRequest.fetch>[1])
        .doNotFollowRedirects,
    ).toBe(true);
  });

  it("uses GET for an ordinary website request and forces bounded direct transport", async () => {
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(WebsiteRequest, "fetch")
      .mockResolvedValueOnce(
        websiteResponse({
          url: "https://8.8.8.8/website",
          statusCode: 200,
          body: "ok",
        }),
      );

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString("https://8.8.8.8/website"),
      { retry: 0, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const options: Parameters<typeof WebsiteRequest.fetch>[1] = fetchSpy.mock
      .calls[0]![1] as Parameters<typeof WebsiteRequest.fetch>[1];
    expect(options.isHeadRequest).toBe(false);
    expect(options.doNotFollowRedirects).toBe(true);
    expect(options.disableProxy).toBe(true);
    expect(options.maxContentLength).toBe(HTTP_MONITOR_MAX_RESPONSE_BYTES);
    expect(options.maxBodyLength).toBe(HTTP_MONITOR_MAX_REQUEST_BYTES);
    expect(options.httpAgent).toBeDefined();
    expect(options.httpsAgent).toBeDefined();
  });
});
