// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import MonitorUtil from "../../../../Utils/Monitors/Monitor";
import ApiMonitor, {
  APIResponse,
} from "../../../../Utils/Monitors/MonitorTypes/ApiMonitor";
import ExternalStatusPageMonitorUtil from "../../../../Utils/Monitors/MonitorTypes/ExternalStatusPageMonitor";
import WebsiteMonitor, {
  ProbeWebsiteResponse,
} from "../../../../Utils/Monitors/MonitorTypes/WebsiteMonitor";
import OnlineCheck from "../../../../Utils/OnlineCheck";
import {
  SslCertificateFixtures,
  cleanupSslCertificateFixtures,
  generateSslCertificateFixtures,
} from "./SslTestCertificates";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import logger from "Common/Server/Utils/Logger";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import ExternalStatusPageMonitorResponse from "Common/Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import { NOT_A_URL } from "Common/Utils/Monitor/MonitorUrlInText";
import * as http from "http";
import * as https from "https";
import { AddressInfo, Socket } from "net";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: { "error.class": "user-error" },
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

/*
 * A MONITOR SECRET IN AN API, WEBSITE OR EXTERNAL STATUS PAGE MONITOR'S URL
 * IS NEVER SHOWN IN WHAT A FAILED CHECK REPORTS (#10785).
 *
 * The server fills {{monitorSecrets.NAME}} into the step's URL before it
 * hands the check to the probe, so the URL the probe sends holds the
 * secret itself: https://api.example.com/health?key=<the key>. A request
 * that fails says the URL it went to ("Request failed to <url>. socket hang
 * up"), and that text was the check's failure cause, each attempt's and
 * why the request failed - shown on the monitor's page, its summary and an
 * incident's root cause, to everyone who can read the monitor. Each now
 * names the URL by its scheme, host and port, so people still tell which
 * request failed, and no secret value is in it, nor in a log line.
 *
 * Real requests to servers on this machine, failing as they fail in the
 * field: a dropped connection, a refused one, a redirect to a hop that
 * refuses, a name that does not resolve, a TLS handshake with a server that
 * speaks no TLS and one whose certificate the probe does not trust, a
 * server that never answers, and an address that is no URL at all.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const MONITOR_ID: ObjectID = ObjectID.generate();

// In every secret, so a text that holds one is found.
const MARK: string = "hunter2";

// A secret in the path, the query and the fragment of every URL.
function withSecrets(origin: string, path: string): string {
  return `${origin}${path}/${MARK}-path?key=${MARK}-key&format=json#${MARK}-fragment`;
}

// The real egress guard: a name that does not resolve, an address that is no URL.
const realAssertUrlAllowed: typeof DataSourceEgressGuard.assertUrlAllowed =
  DataSourceEgressGuard.assertUrlAllowed.bind(DataSourceEgressGuard);

let server: http.Server;
let serverUrl: string;
let tlsServer: https.Server;
let tlsServerUrl: string;
let certificates: SslCertificateFixtures;
let refusedUrl: string;
let received: number = 0;
const sockets: Set<Socket> = new Set();

beforeAll(async () => {
  server = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse): void => {
      received++;
      const path: string = request.url || "";

      // Never answers: the check times out.
      if (path.startsWith("/slow")) {
        return;
      }

      // A redirect to a hop that refuses, its URL holding the secret too.
      if (path.startsWith("/moved")) {
        response.writeHead(302, {
          Location: withSecrets(refusedUrl, "/next"),
        });
        response.end();
        return;
      }

      if (path.startsWith("/ok")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      // Anything else fails before any answer: the socket is dropped.
      request.socket.destroy();
    },
  );

  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // A certificate of a CA the probe does not trust.
  certificates = generateSslCertificateFixtures();
  tlsServer = https.createServer(
    { cert: certificates.validCert, key: certificates.validKey },
    (_request: http.IncomingMessage, response: http.ServerResponse) => {
      response.writeHead(200);
      response.end("ok");
    },
  );

  await new Promise<void>((resolve: () => void) => {
    tlsServer.listen(0, "127.0.0.1", resolve);
  });

  tlsServerUrl = `https://127.0.0.1:${(tlsServer.address() as AddressInfo).port}`;

  // A port nothing listens on: the connection is refused.
  const closed: http.Server = http.createServer();

  await new Promise<void>((resolve: () => void) => {
    closed.listen(0, "127.0.0.1", resolve);
  });

  refusedUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;

  await new Promise<void>((resolve: () => void) => {
    closed.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  received = 0;

  // This machine's servers are let through; any other address meets the real guard.
  jest
    .spyOn(DataSourceEgressGuard, "assertUrlAllowed")
    .mockImplementation(async (rawUrl: string, options?: unknown) => {
      let url: globalThis.URL | null = null;

      try {
        url = new globalThis.URL(rawUrl);
      } catch {
        // No URL at all: the real guard's refusal.
      }

      if (url && url.hostname === "127.0.0.1") {
        return { url, addresses: [{ address: "127.0.0.1", family: 4 }] };
      }

      return await realAssertUrlAllowed(rawUrl, options as never);
    });
  jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
  jest
    .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
    .mockResolvedValue(true);
});

afterEach(() => {
  server.closeAllConnections();
  jest.restoreAllMocks();

  for (const method of [logger.error, logger.debug, logger.info, logger.warn]) {
    (method as jest.Mock).mockClear();
  }
});

afterAll(async () => {
  server.closeAllConnections();
  tlsServer.closeAllConnections();
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
  await new Promise<void>((resolve: () => void) => {
    tlsServer.close(() => {
      resolve();
    });
  });
  cleanupSslCertificateFixtures(certificates);
});

// A text of anything handed to the logger, an error's message and stack included.
function asText(value: unknown): string {
  if (value instanceof Error) {
    return `${String(value)}\n${value.stack || ""}\n${JSON.stringify(value)}`;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Everything the logger was handed, as text.
function everythingLogged(): string {
  return [logger.error, logger.debug, logger.info, logger.warn]
    .map((method: unknown) => {
      return (method as jest.Mock).mock.calls
        .map((call: Array<unknown>) => {
          return call.map(asText).join(" ");
        })
        .join("\n");
    })
    .join("\n");
}

/*
 * What a check reports that a reader sees: its cause, each attempt's, why
 * the request failed, an External Status Page check's own. The destination
 * the probe echoes is never shown: the server keeps the step's own, as
 * written (MonitorRecordEvidence).
 */
function reportedTexts(
  response: APIResponse | ProbeWebsiteResponse | ProbeMonitorResponse | null,
): string {
  return JSON.stringify({
    failureCause: response?.failureCause,
    probeAttempts: response?.probeAttempts,
    requestFailedDetails: response?.requestFailedDetails,
    externalStatusPageResponse: (response as ProbeMonitorResponse)
      ?.externalStatusPageResponse,
  });
}

function expectNoSecret(
  response: APIResponse | ProbeWebsiteResponse | ProbeMonitorResponse | null,
): void {
  expect(response).not.toBeNull();
  expect(response?.isOnline).toBe(false);
  expect(reportedTexts(response)).not.toContain(MARK);
  expect(everythingLogged()).not.toContain(MARK);
}

async function pingApi(
  url: URL,
  timeoutInMs: number = 30000,
): Promise<APIResponse | null> {
  return await ApiMonitor.ping(url, {
    requestType: HTTPMethod.GET,
    retry: 0,
    timeout: new PositiveNumber(timeoutInMs),
    monitorId: MONITOR_ID,
  });
}

async function pingWebsite(
  url: URL,
  timeoutInMs: number = 30000,
): Promise<ProbeWebsiteResponse | null> {
  return await WebsiteMonitor.ping(url, {
    retry: 0,
    timeout: new PositiveNumber(timeoutInMs),
    monitorId: MONITOR_ID,
  });
}

describe("an API monitor's failed check names its URL by scheme, host and port", () => {
  it("the issue's check: the connection is dropped, so the error said the whole URL", async () => {
    const response: APIResponse | null = await pingApi(
      URL.fromString(withSecrets(serverUrl, "/health")),
    );

    expect(received).toBe(1);
    expectNoSecret(response);
    // Which request failed is still said: the server it was sent to.
    expect(response?.failureCause).toBe(
      `Request failed to ${serverUrl}. socket hang up`,
    );
    expect(response?.probeAttempts?.[0]?.failureCause).toBe(
      response?.failureCause,
    );
    expect(response?.requestFailedDetails?.rawErrorMessage).toContain(
      `Request failed to ${serverUrl}.`,
    );
    expect(everythingLogged()).toContain(serverUrl);
  });

  it("a refused connection", async () => {
    const response: APIResponse | null = await pingApi(
      URL.fromString(withSecrets(refusedUrl, "/health")),
    );

    expectNoSecret(response);
    expect(response?.failureCause).toBe("Connection Refused.");
    expect(response?.requestFailedDetails?.errorCode).toBe("ECONNREFUSED");
    expect(response?.requestFailedDetails?.rawErrorMessage).toContain(
      `Request failed to ${refusedUrl}.`,
    );
  });

  it("a redirect to a hop that refuses: the hop is named, by its own host", async () => {
    const response: APIResponse | null = await pingApi(
      URL.fromString(withSecrets(serverUrl, "/moved")),
    );

    expect(received).toBe(1);
    expectNoSecret(response);
    expect(response?.requestFailedDetails?.rawErrorMessage).toContain(
      `Request failed to ${refusedUrl}.`,
    );
  });

  it("a name that does not resolve", async () => {
    const response: APIResponse | null = await pingApi(
      URL.fromString(withSecrets("https://nowhere-10785.invalid", "/health")),
    );

    expectNoSecret(response);
    expect(response?.failureCause).toContain("nowhere-10785.invalid");
  });

  it("a TLS handshake with a server that speaks no TLS", async () => {
    const response: APIResponse | null = await pingApi(
      URL.fromString(
        withSecrets(serverUrl.replace("http://", "https://"), "/health"),
      ),
    );

    expectNoSecret(response);
    expect(response?.failureCause).toContain(
      `Request failed to ${serverUrl.replace("http://", "https://")}.`,
    );
  });

  it("a certificate the probe does not trust", async () => {
    const response: APIResponse | null = await pingApi(
      URL.fromString(withSecrets(tlsServerUrl, "/health")),
    );

    expectNoSecret(response);
    expect(response?.failureCause).toContain(
      `Request failed to ${tlsServerUrl}.`,
    );
  });

  it("a server that never answers: the check times out", async () => {
    const response: APIResponse | null = await pingApi(
      URL.fromString(withSecrets(serverUrl, "/slow")),
      1000,
    );

    expectNoSecret(response);
    expect(response?.isTimeout).toBe(true);
  });

  it("an address that is no URL, which the refusal quoted whole", async () => {
    const response: APIResponse | null = await pingApi(
      URL.fromStringLenient(`https://api.exa mple.com/health?key=${MARK}`),
    );

    expect(received).toBe(0);
    expectNoSecret(response);
    expect(response?.failureCause).toBe(
      `Invalid monitor target URL: ${NOT_A_URL}`,
    );
  });

  it("a key whose last characters a sentence would end with", async () => {
    const response: APIResponse | null = await pingApi(
      URL.fromString(`${serverUrl}/health?key=${MARK}!.)`),
    );

    expectNoSecret(response);
    // Not one character of it: "!.)" stays with the key.
    expect(response?.failureCause).toBe(
      `Request failed to ${serverUrl}. socket hang up`,
    );
  });
});

describe("a Website monitor's failed check names its URL by scheme, host and port", () => {
  it("a dropped connection", async () => {
    const response: ProbeWebsiteResponse | null = await pingWebsite(
      URL.fromString(withSecrets(serverUrl, "/health")),
    );

    expect(received).toBe(1);
    expectNoSecret(response);
  });

  it("a refused connection", async () => {
    expectNoSecret(
      await pingWebsite(URL.fromString(withSecrets(refusedUrl, "/health"))),
    );
  });

  it("a redirect to a hop that refuses", async () => {
    expectNoSecret(
      await pingWebsite(URL.fromString(withSecrets(serverUrl, "/moved"))),
    );
  });

  it("a name that does not resolve", async () => {
    expectNoSecret(
      await pingWebsite(
        URL.fromString(withSecrets("https://nowhere-10785.invalid", "/health")),
      ),
    );
  });

  it("a TLS handshake with a server that speaks no TLS, and an untrusted certificate", async () => {
    expectNoSecret(
      await pingWebsite(
        URL.fromString(
          withSecrets(serverUrl.replace("http://", "https://"), "/health"),
        ),
      ),
    );
    expectNoSecret(
      await pingWebsite(URL.fromString(withSecrets(tlsServerUrl, "/health"))),
    );
  });

  it("a server that never answers", async () => {
    const response: ProbeWebsiteResponse | null = await pingWebsite(
      URL.fromString(withSecrets(serverUrl, "/slow")),
      1000,
    );

    expectNoSecret(response);
    expect(response?.isTimeout).toBe(true);
  });

  it("an address that is no URL", async () => {
    const response: ProbeWebsiteResponse | null = await pingWebsite(
      URL.fromStringLenient(`https://api.exa mple.com/health?key=${MARK}`),
    );

    expectNoSecret(response);
    expect(response?.failureCause).toBe(
      `Invalid monitor target URL: ${NOT_A_URL}`,
    );
  });
});

describe("an External Status Page monitor's failed check names its URL by scheme, host and port", () => {
  async function fetchPage(
    statusPageUrl: string,
  ): Promise<ExternalStatusPageMonitorResponse | null> {
    return await ExternalStatusPageMonitorUtil.fetch(
      {
        statusPageUrl: statusPageUrl,
        provider: ExternalStatusPageProviderType.Auto,
        timeout: 5000,
        retries: 0,
      },
      { retry: 0, monitorId: MONITOR_ID },
    );
  }

  it("a dropped connection, every provider tried", async () => {
    const response: ExternalStatusPageMonitorResponse | null = await fetchPage(
      withSecrets(serverUrl, "/status"),
    );

    expect(received).toBeGreaterThan(0);
    expect(response?.isOnline).toBe(false);
    expect(JSON.stringify(response)).not.toContain(MARK);
    expect(everythingLogged()).not.toContain(MARK);
  });

  it("a name that does not resolve", async () => {
    const response: ExternalStatusPageMonitorResponse | null = await fetchPage(
      withSecrets("https://nowhere-10785.invalid", "/status"),
    );

    expect(response?.isOnline).toBe(false);
    expect(JSON.stringify(response)).not.toContain(MARK);
    expect(everythingLogged()).not.toContain(MARK);
  });

  it("an address that is no URL, which the refusal quoted whole", async () => {
    const response: ExternalStatusPageMonitorResponse | null = await fetchPage(
      `https://status.exa mple.com/?key=${MARK}`,
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toContain(NOT_A_URL);
    expect(JSON.stringify(response)).not.toContain(MARK);
    expect(everythingLogged()).not.toContain(MARK);
  });
});

describe("what the probe reports and logs of a step", () => {
  function apiStep(url: string): MonitorStep {
    const criteria: MonitorCriteriaInstance =
      new MonitorCriteriaInstance().setFilters([
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      ]);

    return MonitorStep.fromJSON({
      _type: "MonitorStep",
      value: {
        id: ObjectID.generate().toString(),
        monitorDestination: { _type: "URL", value: url },
        requestType: HTTPMethod.GET,
        retryCount: 0,
        monitorCriteria: {
          _type: "MonitorCriteria",
          value: { monitorCriteriaInstanceArray: [criteria.toJSON()] },
        },
      } as JSONObject,
    });
  }

  function monitorOf(step: MonitorStep): Monitor {
    const monitor: Monitor = new Monitor(MONITOR_ID);
    monitor.projectId = PROJECT_ID;
    monitor.monitorType = MonitorType.API;

    const steps: MonitorSteps = new MonitorSteps();
    steps.data = {
      monitorStepsInstanceArray: [step],
      defaultMonitorStatusId: undefined,
    };
    monitor.monitorSteps = steps;

    return monitor;
  }

  // The check as the probe posts it to OneUptime.
  function capturePosts(): Array<ProbeMonitorResponse> {
    const posted: Array<ProbeMonitorResponse> = [];
    const realFetch: typeof API.fetch = API.fetch.bind(API);

    jest
      .spyOn(API, "fetch")
      .mockImplementation(async (options: Parameters<typeof API.fetch>[0]) => {
        if (options.url.toString().startsWith("https://oneuptime.com")) {
          posted.push(
            (options.data as JSONObject)[
              "probeMonitorResponse"
            ] as unknown as ProbeMonitorResponse,
          );
          return { statusCode: 200, data: {} } as never;
        }

        return await realFetch(options as never);
      });

    return posted;
  }

  it("a step whose check throws an error that names its URL: the cause and the log name its host", async () => {
    const url: string = withSecrets(serverUrl, "/health");
    const posted: Array<ProbeMonitorResponse> = capturePosts();

    jest.spyOn(ApiMonitor, "ping").mockRejectedValue(
      new Error(`URL ${url} is not in valid format.`),
    );

    await MonitorUtil.probeMonitor(monitorOf(apiStep(url)));

    expect(posted).toHaveLength(1);
    expect(posted[0]?.isOnline).toBe(false);
    expect(posted[0]?.failureCause).toBe(
      `URL ${serverUrl} is not in valid format.`,
    );
    expect(logger.error).toHaveBeenCalled();
    expect(everythingLogged()).not.toContain(MARK);
  });

  it("the debug log of a probed step: its destination by its host, its texts written so", async () => {
    const url: string = withSecrets(serverUrl, "/health");
    const posted: Array<ProbeMonitorResponse> = capturePosts();

    await MonitorUtil.probeMonitor(monitorOf(apiStep(url)));

    expect(received).toBe(1);
    expect(posted).toHaveLength(1);
    expect(reportedTexts(posted[0]!)).not.toContain(MARK);
    expect(posted[0]?.failureCause).toBe(
      `Request failed to ${serverUrl}. socket hang up`,
    );

    const logged: string = everythingLogged();

    expect(logged).toContain("Probed monitor step:");
    expect(logged).toContain(serverUrl);
    expect(logged).not.toContain(MARK);
  });
});
