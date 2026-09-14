process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
delete process.env["PROBE_ALLOW_PRIVATE_NETWORK_MONITORS"];
delete process.env["REGISTER_PROBE_KEY"];

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

import ExternalStatusPageMonitorUtil, {
  EXTERNAL_STATUS_PAGE_XML_MAX_DEPTH,
  EXTERNAL_STATUS_PAGE_XML_MAX_ELEMENT_COUNT,
  EXTERNAL_STATUS_PAGE_XML_MAX_RESPONSE_BYTES,
} from "../../../../Utils/Monitors/MonitorTypes/ExternalStatusPageMonitor";
import HttpMonitorRequest, {
  HTTP_MONITOR_MAX_REQUEST_BYTES,
  HttpMonitorExecutionContext,
} from "../../../../Utils/Monitors/HttpMonitorRequest";
import ProxyConfig from "../../../../Utils/ProxyConfig";
import ExternalStatusPageMonitorResponse from "Common/Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import MonitorStepExternalStatusPageMonitor from "Common/Types/Monitor/MonitorStepExternalStatusPageMonitor";
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import http, { IncomingMessage, Server, ServerResponse } from "http";
import { AddressInfo } from "net";
import { Readable } from "stream";

const PUBLIC_BASE_URL: string = "http://1.1.1.1/status";
const PRIVATE_BODY_SENTINEL: string = "external-status-private-body-ghsa-9wgr";
const PRIVATE_HEADER_SENTINEL: string =
  "external-status-private-header-ghsa-9wgr";
const REDIRECT_BODY_SENTINEL: string =
  "external-status-redirect-body-must-not-leak";
const REDIRECT_HEADER_SENTINEL: string =
  "external-status-redirect-header-must-not-leak";

function buildConfig(
  provider: ExternalStatusPageProviderType,
  statusPageUrl: string = PUBLIC_BASE_URL,
): MonitorStepExternalStatusPageMonitor {
  return {
    statusPageUrl: statusPageUrl,
    provider: provider,
    timeout: 4321,
    retries: 8,
  };
}

function axiosResponse(
  status: number,
  data: unknown,
  headers: Record<string, string> = {},
): AxiosResponse {
  const serializedData: string =
    typeof data === "string" ? data : JSON.stringify(data) || "";

  return {
    status: status,
    statusText: String(status),
    data: Readable.from(serializedData ? [Buffer.from(serializedData)] : []),
    headers: headers,
    config: {},
    request: {},
  } as AxiosResponse;
}

function getAxiosCall(index: number): {
  url: string;
  options: AxiosRequestConfig;
} {
  const call: [string, AxiosRequestConfig] = axiosGetSpy.mock.calls[index] as [
    string,
    AxiosRequestConfig,
  ];
  return { url: call[0], options: call[1] };
}

function expectSafeAxiosOptions(options: AxiosRequestConfig): void {
  expect(options.maxRedirects).toBe(0);
  expect(options.proxy).toBe(false);
  expect(options.maxContentLength).toBe(-1);
  expect(options.maxBodyLength).toBe(HTTP_MONITOR_MAX_REQUEST_BYTES);
  expect(options.responseType).toBe("stream");
  expect(options.signal).toBeDefined();
  expect(options.httpAgent).toBeDefined();
  expect(options.httpsAgent).toBeDefined();
}

async function fetchStatusPage(
  provider: ExternalStatusPageProviderType,
  statusPageUrl: string = PUBLIC_BASE_URL,
): Promise<ExternalStatusPageMonitorResponse> {
  const response: ExternalStatusPageMonitorResponse | null =
    await ExternalStatusPageMonitorUtil.fetch(
      buildConfig(provider, statusPageUrl),
      {
        retry: 8,
        isOnlineCheckRequest: true,
      },
    );

  expect(response).not.toBeNull();
  return response!;
}

let privateServer: Server;
let privateServerUrl: string;
let privateServerHits: number = 0;
let axiosGetSpy: ReturnType<typeof jest.spyOn>;
let prepareSpy: ReturnType<typeof jest.spyOn>;
let contextSleepSpy: ReturnType<typeof jest.spyOn>;

beforeAll(async () => {
  privateServer = http.createServer(
    (_request: IncomingMessage, response: ServerResponse) => {
      privateServerHits++;
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.setHeader("X-Private-Status", PRIVATE_HEADER_SENTINEL);
      response.end(JSON.stringify({ secret: PRIVATE_BODY_SENTINEL }));
    },
  );

  await new Promise<void>((resolve: () => void) => {
    privateServer.listen(0, "127.0.0.1", () => {
      const address: AddressInfo = privateServer.address() as AddressInfo;
      privateServerUrl = `http://127.0.0.1:${address.port}/private-status`;
      resolve();
    });
  });
});

beforeEach(() => {
  privateServerHits = 0;
  jest.spyOn(ProxyConfig, "getHttpProxyAgent").mockReturnValue(null);
  jest.spyOn(ProxyConfig, "getHttpsProxyAgent").mockReturnValue(null);
  axiosGetSpy = jest.spyOn(axios, "get");
  prepareSpy = jest.spyOn(HttpMonitorRequest, "prepare");
  contextSleepSpy = jest.spyOn(HttpMonitorExecutionContext.prototype, "sleep");
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

describe("ExternalStatusPageMonitor SSRF protection", () => {
  test.each([
    ExternalStatusPageProviderType.AtlassianStatuspage,
    ExternalStatusPageProviderType.IncidentIo,
    ExternalStatusPageProviderType.RSS,
    ExternalStatusPageProviderType.Atom,
    ExternalStatusPageProviderType.Auto,
  ])(
    "blocks a direct loopback target for %s before Axios, a socket, or a retry",
    async (provider: ExternalStatusPageProviderType) => {
      const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
        provider,
        privateServerUrl,
      );

      expect(response.isOnline).toBe(false);
      expect(response.overallStatus).toBe("unknown");
      expect(response.componentStatuses).toEqual([]);
      expect(response.rawBody).toBeUndefined();
      expect(response.failureCause).toContain("loopback address");
      expect(response.totalAttempts).toBe(1);
      expect(response.probeAttempts).toHaveLength(1);
      expect(JSON.stringify(response)).not.toContain(PRIVATE_BODY_SENTINEL);
      expect(JSON.stringify(response)).not.toContain(PRIVATE_HEADER_SENTINEL);
      expect(privateServerHits).toBe(0);
      expect(prepareSpy).toHaveBeenCalledTimes(1);
      expect(axiosGetSpy).not.toHaveBeenCalled();
      expect(contextSleepSpy).not.toHaveBeenCalled();
    },
  );

  test("short-circuits Auto detection when a public response redirects to loopback", async () => {
    axiosGetSpy.mockResolvedValueOnce(
      axiosResponse(
        302,
        { secret: REDIRECT_BODY_SENTINEL },
        {
          location: privateServerUrl,
          "x-redirect-secret": REDIRECT_HEADER_SENTINEL,
        },
      ),
    );

    const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
      ExternalStatusPageProviderType.Auto,
    );

    expect(response.isOnline).toBe(false);
    expect(response.componentStatuses).toEqual([]);
    expect(response.rawBody).toBeUndefined();
    expect(response.failureCause).toContain("loopback address");
    expect(response.totalAttempts).toBe(1);
    expect(JSON.stringify(response)).not.toContain(REDIRECT_BODY_SENTINEL);
    expect(JSON.stringify(response)).not.toContain(REDIRECT_HEADER_SENTINEL);
    expect(JSON.stringify(response)).not.toContain(PRIVATE_BODY_SENTINEL);
    expect(JSON.stringify(response)).not.toContain(PRIVATE_HEADER_SENTINEL);
    expect(privateServerHits).toBe(0);
    expect(axiosGetSpy).toHaveBeenCalledTimes(1);
    expect(prepareSpy).toHaveBeenCalledTimes(2);
    expect(prepareSpy.mock.calls[0]![0]).toBe("http://1.1.1.1/proxy/1.1.1.1");
    expect(prepareSpy.mock.calls[1]![0]).toBe(privateServerUrl);
    expect(contextSleepSpy).not.toHaveBeenCalled();
    expectSafeAxiosOptions(getAxiosCall(0).options);
  });

  test("revalidates a public Atlassian redirect and preserves JSON parsing", async () => {
    const redirectedStatusUrl: string =
      "http://8.8.8.8/final-atlassian-status.json";

    axiosGetSpy.mockImplementation(async (url: string) => {
      if (url === `${PUBLIC_BASE_URL}/api/v2/status.json`) {
        return axiosResponse(
          302,
          { redirecting: true },
          {
            location: redirectedStatusUrl,
          },
        );
      }

      if (url === redirectedStatusUrl) {
        return axiosResponse(200, {
          status: {
            indicator: "none",
            description: "All Systems Operational",
          },
        });
      }

      if (url === `${PUBLIC_BASE_URL}/api/v2/components.json`) {
        return axiosResponse(200, {
          components: [
            { id: "core", name: "Core Services", group: true },
            {
              id: "api",
              name: "Public API",
              status: "operational",
              group_id: "core",
            },
          ],
        });
      }

      if (url === `${PUBLIC_BASE_URL}/api/v2/incidents/unresolved.json`) {
        return axiosResponse(200, {
          incidents: [
            { name: "API incident", components: [{ name: "Public API" }] },
          ],
        });
      }

      throw new Error(`Unexpected Axios URL: ${url}`);
    });

    const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
      ExternalStatusPageProviderType.AtlassianStatuspage,
    );

    expect(response.isOnline).toBe(true);
    expect(response.provider).toBe(
      ExternalStatusPageProviderType.AtlassianStatuspage,
    );
    expect(response.overallStatus).toBe("All Systems Operational");
    expect(response.activeIncidentCount).toBe(1);
    expect(response.componentStatuses).toEqual([
      {
        name: "Public API",
        status: "operational",
        description: undefined,
        groupName: "Core Services",
      },
    ]);
    expect(response.rawBody).toContain('"indicator":"none"');
    expect(axiosGetSpy).toHaveBeenCalledTimes(4);
    expect(
      prepareSpy.mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual([
      `${PUBLIC_BASE_URL}/api/v2/status.json`,
      redirectedStatusUrl,
      `${PUBLIC_BASE_URL}/api/v2/components.json`,
      `${PUBLIC_BASE_URL}/api/v2/incidents/unresolved.json`,
    ]);

    for (let index: number = 0; index < 4; index++) {
      expectSafeAxiosOptions(getAxiosCall(index).options);
    }
    const requestOptions: Array<AxiosRequestConfig> = [0, 1, 2, 3].map(
      (index: number) => {
        return getAxiosCall(index).options;
      },
    );
    expect(
      new Set(
        requestOptions.map((options: AxiosRequestConfig) => {
          return options.signal;
        }),
      ).size,
    ).toBe(1);
    expect(
      requestOptions.map((options: AxiosRequestConfig) => {
        return options.maxContentLength;
      }),
    ).toEqual([-1, -1, -1, -1]);
  });

  test("revalidates a public RSS redirect and preserves text response parsing", async () => {
    const redirectLocation: string = "/a//b?tag=one&tag=two";
    const redirectedFeedUrl: string = "http://1.1.1.1/a//b?tag=one&tag=two";
    const rssBody: string = [
      "<rss><channel><item>",
      "<title>Public API outage</title>",
      `<pubDate>${new Date().toUTCString()}</pubDate>`,
      "<description>Investigating</description>",
      "</item></channel></rss>",
    ].join("");

    axiosGetSpy
      .mockResolvedValueOnce(
        axiosResponse(302, REDIRECT_BODY_SENTINEL, {
          location: redirectLocation,
        }),
      )
      .mockResolvedValueOnce(axiosResponse(200, rssBody));

    const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
      ExternalStatusPageProviderType.RSS,
    );

    expect(response.isOnline).toBe(true);
    expect(response.provider).toBe(ExternalStatusPageProviderType.RSS);
    expect(response.activeIncidentCount).toBe(1);
    expect(response.componentStatuses[0]).toMatchObject({
      name: "Public API outage",
      status: "incident",
      description: "Investigating",
    });
    expect(response.rawBody).toBe(rssBody);
    expect(
      prepareSpy.mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual([PUBLIC_BASE_URL, redirectedFeedUrl]);
    expect(axiosGetSpy).toHaveBeenCalledTimes(2);
    expect(getAxiosCall(1).url).toBe(redirectedFeedUrl);
    for (let index: number = 0; index < 2; index++) {
      const options: AxiosRequestConfig = getAxiosCall(index).options;
      expectSafeAxiosOptions(options);
      expect(options.responseType).toBe("stream");
    }
  });

  test("uses guarded bounded transport for an incident.io provider response", async () => {
    axiosGetSpy.mockResolvedValueOnce(
      axiosResponse(200, {
        summary: {
          components: [{ id: "api", name: "Public API" }],
          affected_components: [
            { component_id: "api", status: "degraded_performance" },
          ],
          ongoing_incidents: [],
        },
      }),
    );

    const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
      ExternalStatusPageProviderType.IncidentIo,
    );

    expect(response.isOnline).toBe(true);
    expect(response.provider).toBe(ExternalStatusPageProviderType.IncidentIo);
    expect(response.componentStatuses).toEqual([
      {
        name: "Public API",
        status: "degraded_performance",
        groupName: undefined,
        description: undefined,
      },
    ]);
    expect(prepareSpy).toHaveBeenCalledWith(
      "http://1.1.1.1/proxy/1.1.1.1",
      expect.any(Object),
    );
    expect(axiosGetSpy).toHaveBeenCalledTimes(1);
    expectSafeAxiosOptions(getAxiosCall(0).options);
  });

  test("handles reserved JavaScript property names as incident.io component IDs", async () => {
    const prototypeStatusDescriptor: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(Object.prototype, "status");
    const constructorStatusDescriptor: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(Object, "status");

    try {
      axiosGetSpy.mockResolvedValueOnce(
        axiosResponse(200, {
          summary: {
            components: [
              { id: "__proto__", name: "Prototype Component" },
              { id: "constructor", name: "Constructor Component" },
            ],
            affected_components: [
              { component_id: "__proto__", status: "major_outage" },
              {
                component_id: "constructor",
                status: "degraded_performance",
              },
            ],
            ongoing_incidents: [
              {
                name: "Prototype incident",
                affected_components: [{ component_id: "__proto__" }],
              },
              {
                name: "Constructor incident",
                affected_components: [{ component_id: "constructor" }],
              },
            ],
          },
        }),
      );

      const response: ExternalStatusPageMonitorResponse | null =
        await ExternalStatusPageMonitorUtil.fetch(
          {
            ...buildConfig(ExternalStatusPageProviderType.IncidentIo),
            componentName: "Component",
          },
          { retry: 0, isOnlineCheckRequest: true },
        );

      expect(response).not.toBeNull();
      expect(response!.componentStatuses).toEqual([
        {
          name: "Prototype Component",
          status: "major_outage",
          groupName: undefined,
          description: undefined,
        },
        {
          name: "Constructor Component",
          status: "degraded_performance",
          groupName: undefined,
          description: undefined,
        },
      ]);
      expect(response!.activeIncidentCount).toBe(2);
      expect(
        Object.getOwnPropertyDescriptor(Object.prototype, "status"),
      ).toEqual(prototypeStatusDescriptor);
      expect(Object.getOwnPropertyDescriptor(Object, "status")).toEqual(
        constructorStatusDescriptor,
      );
    } finally {
      if (prototypeStatusDescriptor) {
        Object.defineProperty(
          Object.prototype,
          "status",
          prototypeStatusDescriptor,
        );
      } else {
        delete (Object.prototype as { status?: unknown }).status;
      }
      if (constructorStatusDescriptor) {
        Object.defineProperty(Object, "status", constructorStatusDescriptor);
      } else {
        delete (Object as { status?: unknown }).status;
      }
    }
  });

  test("strips a leading UTF-8 BOM before parsing an external status JSON response", async () => {
    axiosGetSpy.mockResolvedValueOnce(
      axiosResponse(
        200,
        `\uFEFF${JSON.stringify({
          summary: {
            components: [{ id: "api", name: "Public API" }],
            affected_components: [],
            ongoing_incidents: [],
          },
        })}`,
      ),
    );

    const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
      ExternalStatusPageProviderType.IncidentIo,
    );

    expect(response.provider).toBe(ExternalStatusPageProviderType.IncidentIo);
    expect(response.componentStatuses).toEqual([
      expect.objectContaining({ name: "Public API", status: "operational" }),
    ]);
  });

  test("guards every Auto detection request through the basic fallback", async () => {
    axiosGetSpy
      .mockResolvedValueOnce(axiosResponse(404, {}))
      .mockResolvedValueOnce(axiosResponse(404, {}))
      .mockResolvedValueOnce(axiosResponse(200, "not an XML feed"))
      .mockResolvedValueOnce(axiosResponse(204, ""));

    const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
      ExternalStatusPageProviderType.Auto,
    );

    expect(response.isOnline).toBe(true);
    expect(response.overallStatus).toBe("reachable");
    expect(response.provider).toBeUndefined();
    expect(axiosGetSpy).toHaveBeenCalledTimes(4);
    expect(
      prepareSpy.mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual([
      "http://1.1.1.1/proxy/1.1.1.1",
      `${PUBLIC_BASE_URL}/api/v2/status.json`,
      PUBLIC_BASE_URL,
      PUBLIC_BASE_URL,
    ]);

    for (let index: number = 0; index < 4; index++) {
      expectSafeAxiosOptions(getAxiosCall(index).options);
    }
    expect(getAxiosCall(2).options.responseType).toBe("stream");
    expect(getAxiosCall(3).options.responseType).toBe("stream");
    expect(
      new Set(
        [0, 1, 2, 3].map((index: number) => {
          return getAxiosCall(index).options.signal;
        }),
      ).size,
    ).toBe(1);
    expect(
      [0, 1, 2, 3].map((index: number) => {
        return getAxiosCall(index).options.maxContentLength;
      }),
    ).toEqual([-1, -1, -1, -1]);
  });

  test.each([
    ["direct doctype", "<!DOCTYPE html>"],
    ["leading comment", "<!-- generated status page -->\n<!DOCTYPE html>"],
    ["leading processing instruction", "<?page generated?>\n<!DOCTYPE html>"],
    [
      "leading comment and processing instruction",
      "<!-- generated -->\n<?page generated?>\n<!DOCTYPE html>",
    ],
  ])(
    "treats an HTML %s as a non-feed and reaches the Auto basic fallback",
    async (_label: string, prefix: string) => {
      axiosGetSpy
        .mockResolvedValueOnce(axiosResponse(404, {}))
        .mockResolvedValueOnce(axiosResponse(404, {}))
        .mockResolvedValueOnce(
          axiosResponse(200, `${prefix}<html><body>Status page</body></html>`, {
            "content-type": "text/html; charset=utf-8",
          }),
        )
        .mockResolvedValueOnce(axiosResponse(200, "status page"));

      const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
        ExternalStatusPageProviderType.Auto,
      );

      expect(response.isOnline).toBe(true);
      expect(response.overallStatus).toBe("reachable");
      expect(response.provider).toBeUndefined();
      expect(response.failureCause).toBe("");
      expect(axiosGetSpy).toHaveBeenCalledTimes(4);
      expect(prepareSpy).toHaveBeenCalledTimes(4);
      expect(contextSleepSpy).not.toHaveBeenCalled();
    },
  );

  test("keeps one cumulative body budget and signal through fallback and retry", async () => {
    const executionContext: HttpMonitorExecutionContext =
      new HttpMonitorExecutionContext(5000, 5);
    const retrySleepSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(executionContext, "sleep")
      .mockResolvedValue(undefined);

    axiosGetSpy
      .mockResolvedValueOnce(
        axiosResponse(500, "four", {
          "content-encoding": "gzip",
          "content-length": "1",
        }),
      )
      .mockRejectedValueOnce(new AxiosError("socket reset", "ECONNRESET"))
      .mockResolvedValueOnce(axiosResponse(200, "xx"));

    try {
      const response: ExternalStatusPageMonitorResponse | null =
        await ExternalStatusPageMonitorUtil.fetch(
          buildConfig(ExternalStatusPageProviderType.RSS),
          {
            retry: 2,
            isOnlineCheckRequest: true,
            executionContext: executionContext,
          },
        );

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(false);
      expect(response!.failureCause).toContain("exceeded the allowed size");
      expect(response!.rawBody).toBeUndefined();
      expect(response!.totalAttempts).toBe(2);
      expect(response!.probeAttempts).toHaveLength(2);
      expect(retrySleepSpy).toHaveBeenCalledTimes(1);
      expect(axiosGetSpy).toHaveBeenCalledTimes(3);
      expect(prepareSpy).toHaveBeenCalledTimes(3);
      expect(
        [0, 1, 2].map((index: number) => {
          return getAxiosCall(index).options.maxContentLength;
        }),
      ).toEqual([-1, -1, -1]);
      for (let index: number = 0; index < 3; index++) {
        expect(getAxiosCall(index).options.signal).toBe(
          executionContext.signal,
        );
      }
      expect(executionContext.responseBodyBudget.remainingBytes).toBe(0);
      expect(executionContext.signal.aborted).toBe(false);
    } finally {
      executionContext.dispose();
    }
  });

  test("rejects an oversized RSS body while streaming before XML parsing or fallback", async () => {
    const oversizedFeed: string = `<rss><channel><description>${"x".repeat(
      EXTERNAL_STATUS_PAGE_XML_MAX_RESPONSE_BYTES,
    )}</description></channel></rss>`;
    axiosGetSpy.mockResolvedValueOnce(axiosResponse(200, oversizedFeed));

    const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
      ExternalStatusPageProviderType.RSS,
    );

    expect(response.isOnline).toBe(false);
    expect(response.failureCause).toContain("exceeded the allowed size");
    expect(response.totalAttempts).toBe(1);
    expect(response.rawBody).toBeUndefined();
    expect(axiosGetSpy).toHaveBeenCalledTimes(1);
    expect(prepareSpy).toHaveBeenCalledTimes(1);
    expect(contextSleepSpy).not.toHaveBeenCalled();
  });

  test.each([
    [
      "DTD with an entity subset",
      '<?xml version="1.0"?>\n<!DoCtYpE rss [<!ENTITY secret SYSTEM "file:///etc/passwd">]><rss><channel/></rss>',
    ],
    [
      "standalone entity declaration after a prolog",
      '<?xml version="1.0"?>\n<!EnTiTy secret "expanded"><rss><channel/></rss>',
    ],
  ])("rejects an XML %s", async (_label: string, unsafeXml: string) => {
    axiosGetSpy.mockResolvedValueOnce(axiosResponse(200, unsafeXml));

    const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
      ExternalStatusPageProviderType.RSS,
    );

    expect(response.isOnline).toBe(false);
    expect(response.failureCause).toContain("unsupported declaration");
    expect(response.totalAttempts).toBe(1);
    expect(axiosGetSpy).toHaveBeenCalledTimes(1);
    expect(contextSleepSpy).not.toHaveBeenCalled();
  });

  test("rejects a compact RSS feed with too many elements before materializing its object graph", async () => {
    const elementHeavyFeed: string = `<rss><channel>${"<item/>".repeat(
      EXTERNAL_STATUS_PAGE_XML_MAX_ELEMENT_COUNT,
    )}</channel></rss>`;
    expect(Buffer.byteLength(elementHeavyFeed)).toBeLessThan(
      EXTERNAL_STATUS_PAGE_XML_MAX_RESPONSE_BYTES,
    );
    axiosGetSpy.mockResolvedValueOnce(axiosResponse(200, elementHeavyFeed));

    const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
      ExternalStatusPageProviderType.RSS,
    );

    expect(response.isOnline).toBe(false);
    expect(response.failureCause).toContain("allowed element count");
    expect(response.totalAttempts).toBe(1);
    expect(axiosGetSpy).toHaveBeenCalledTimes(1);
    expect(contextSleepSpy).not.toHaveBeenCalled();
  });

  test("rejects deeply nested XML even when an attribute contains a misleading tag terminator", async () => {
    const openingTag: string = '<group marker="/>">';
    const deeplyNestedFeed: string = `<rss>${openingTag.repeat(
      EXTERNAL_STATUS_PAGE_XML_MAX_DEPTH,
    )}value${"</group>".repeat(EXTERNAL_STATUS_PAGE_XML_MAX_DEPTH)}</rss>`;
    axiosGetSpy.mockResolvedValueOnce(axiosResponse(200, deeplyNestedFeed));

    const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
      ExternalStatusPageProviderType.Atom,
    );

    expect(response.isOnline).toBe(false);
    expect(response.failureCause).toContain("allowed nesting depth");
    expect(response.totalAttempts).toBe(1);
    expect(axiosGetSpy).toHaveBeenCalledTimes(1);
    expect(contextSleepSpy).not.toHaveBeenCalled();
  });

  test("actively aborts an in-flight provider request at the shared deadline", async () => {
    const executionContext: HttpMonitorExecutionContext =
      new HttpMonitorExecutionContext(25);
    let observedAbort: boolean = false;

    axiosGetSpy.mockImplementation(
      (_url: string, axiosOptions: AxiosRequestConfig) => {
        return new Promise<AxiosResponse>(
          (
            _resolve: (response: AxiosResponse) => void,
            reject: (error: Error) => void,
          ) => {
            const signal: AbortSignal = axiosOptions.signal as AbortSignal;
            signal.addEventListener(
              "abort",
              () => {
                observedAbort = true;
                reject(
                  new AxiosError("request canceled", AxiosError.ERR_CANCELED),
                );
              },
              { once: true },
            );
          },
        );
      },
    );

    try {
      const response: ExternalStatusPageMonitorResponse | null =
        await ExternalStatusPageMonitorUtil.fetch(
          buildConfig(ExternalStatusPageProviderType.Auto),
          {
            retry: 8,
            isOnlineCheckRequest: true,
            executionContext: executionContext,
          },
        );

      expect(response).not.toBeNull();
      expect(response!.isOnline).toBe(false);
      expect(response!.isTimeout).toBe(true);
      expect(response!.failureCause).toContain("timed out");
      expect(response!.totalAttempts).toBe(1);
      expect(observedAbort).toBe(true);
      expect(executionContext.signal.aborted).toBe(true);
      expect(axiosGetSpy).toHaveBeenCalledTimes(1);
      expect(prepareSpy).toHaveBeenCalledTimes(1);
      expect(contextSleepSpy).not.toHaveBeenCalled();
      expect(getAxiosCall(0).options.signal).toBe(executionContext.signal);
      expect(getAxiosCall(0).options.timeout).toBeGreaterThan(0);
      expect(getAxiosCall(0).options.timeout).toBeLessThanOrEqual(25);
    } finally {
      executionContext.dispose();
    }
  });

  test.each([
    ["components", 2, 3],
    ["incidents", 3, 4],
  ])(
    "does not swallow a private redirect from optional Atlassian %s",
    async (
      blockedEndpoint: string,
      expectedAxiosCalls: number,
      expectedPrepareCalls: number,
    ) => {
      axiosGetSpy.mockImplementation(async (url: string) => {
        if (url.endsWith("/api/v2/status.json")) {
          return axiosResponse(200, {
            status: { indicator: "none", description: "Operational" },
          });
        }

        if (url.endsWith("/api/v2/components.json")) {
          if (blockedEndpoint === "components") {
            return axiosResponse(302, REDIRECT_BODY_SENTINEL, {
              location: privateServerUrl,
              "x-redirect-secret": REDIRECT_HEADER_SENTINEL,
            });
          }
          return axiosResponse(200, { components: [] });
        }

        if (url.endsWith("/api/v2/incidents/unresolved.json")) {
          return axiosResponse(302, REDIRECT_BODY_SENTINEL, {
            location: privateServerUrl,
            "x-redirect-secret": REDIRECT_HEADER_SENTINEL,
          });
        }

        throw new Error(`Unexpected Axios URL: ${url}`);
      });

      const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
        ExternalStatusPageProviderType.AtlassianStatuspage,
      );

      expect(response.isOnline).toBe(false);
      expect(response.overallStatus).toBe("unknown");
      expect(response.componentStatuses).toEqual([]);
      expect(response.rawBody).toBeUndefined();
      expect(response.failureCause).toContain("loopback address");
      expect(response.totalAttempts).toBe(1);
      expect(JSON.stringify(response)).not.toContain(REDIRECT_BODY_SENTINEL);
      expect(JSON.stringify(response)).not.toContain(REDIRECT_HEADER_SENTINEL);
      expect(privateServerHits).toBe(0);
      expect(axiosGetSpy).toHaveBeenCalledTimes(expectedAxiosCalls);
      expect(prepareSpy).toHaveBeenCalledTimes(expectedPrepareCalls);
      expect(contextSleepSpy).not.toHaveBeenCalled();
    },
  );

  test("stops at the shared redirect limit without retrying or falling back", async () => {
    let nextHop: number = 0;
    axiosGetSpy.mockImplementation(async () => {
      nextHop++;
      return axiosResponse(302, REDIRECT_BODY_SENTINEL, {
        location: `http://1.1.1.1/redirect-hop-${nextHop}`,
      });
    });

    const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
      ExternalStatusPageProviderType.RSS,
    );

    expect(response.isOnline).toBe(false);
    expect(response.failureCause).toContain("exceeded 10 redirects");
    expect(response.rawBody).toBeUndefined();
    expect(response.totalAttempts).toBe(1);
    expect(axiosGetSpy).toHaveBeenCalledTimes(11);
    expect(prepareSpy).toHaveBeenCalledTimes(11);
    expect(contextSleepSpy).not.toHaveBeenCalled();
  });

  test("rejects an invalid redirect without retrying or provider fallback", async () => {
    axiosGetSpy.mockResolvedValueOnce(
      axiosResponse(302, REDIRECT_BODY_SENTINEL, {
        location: "http://[not-an-ipv6-address",
      }),
    );

    const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
      ExternalStatusPageProviderType.Auto,
    );

    expect(response.isOnline).toBe(false);
    expect(response.failureCause).toContain("invalid redirect URL");
    expect(response.rawBody).toBeUndefined();
    expect(response.totalAttempts).toBe(1);
    expect(JSON.stringify(response)).not.toContain(REDIRECT_BODY_SENTINEL);
    expect(axiosGetSpy).toHaveBeenCalledTimes(1);
    expect(prepareSpy).toHaveBeenCalledTimes(1);
    expect(contextSleepSpy).not.toHaveBeenCalled();
  });
});
