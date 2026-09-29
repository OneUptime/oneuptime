// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import { JSONObject } from "Common/Types/JSON";
import { RequestOutcome } from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import ProbeApiDiagnostics, {
  ProbeRequestStallPhase,
} from "../../Utils/ProbeApiDiagnostics";
import { PROBE_PRIVATE_NETWORK_MONITOR_POLICY } from "../../Config";
import PrivateNetworkMonitorPolicy from "../../Utils/PrivateNetworkMonitorPolicy";

/*
 * A probe that cannot reach the server logs `timeout of 45000ms exceeded`
 * and nothing else — the same sentence whether it never got a socket, never
 * finished the TCP handshake, never finished TLS, or connected perfectly and
 * the server never answered. Those are four different tickets. These tests
 * pin the classification that tells them apart, because that classification
 * is the entire point of the failure report.
 */

interface FakeSocket {
  connecting?: boolean;
  bytesWritten?: number;
  bytesRead?: number;
  remoteAddress?: string;
  remotePort?: number;
  getProtocol?: () => string | null;
  getCipher?: () => { name: string };
  authorized?: boolean;
}

function buildTimeoutOutcome(options: {
  socket?: FakeSocket | null;
  hasResponse?: boolean;
  useFollowRedirectsWrapper?: boolean;
  elapsedInMs?: number;
  timeoutInMs?: number;
}): RequestOutcome {
  const clientRequest: JSONObject = {
    socket: (options.socket ?? null) as unknown as JSONObject,
    res: options.hasResponse ? ({ statusCode: 200 } as JSONObject) : null,
  };

  /*
   * axios goes through follow-redirects, whose RedirectableRequest wraps the
   * ClientRequest that actually owns the socket — both shapes have to be
   * unwrapped or every real failure reads as "no socket".
   */
  const request: JSONObject = options.useFollowRedirectsWrapper
    ? ({ _currentRequest: clientRequest, _redirectCount: 0 } as JSONObject)
    : clientRequest;

  return {
    method: HTTPMethod.POST,
    url: "https://oneuptime.example.com/probe-ingest/alive",
    elapsedInMs: options.elapsedInMs ?? 45010,
    attempts: 1,
    timeoutInMs: options.timeoutInMs ?? 45000,
    error: new Error("timeout of 45000ms exceeded"),
    axiosError: {
      code: "ECONNABORTED",
      request: request,
    } as never,
  };
}

function connectedTlsSocket(overrides?: Partial<FakeSocket>): FakeSocket {
  return {
    connecting: false,
    bytesWritten: 412,
    bytesRead: 0,
    remoteAddress: "10.1.2.3",
    remotePort: 443,
    getProtocol: (): string | null => {
      return "TLSv1.3";
    },
    getCipher: (): { name: string } => {
      return { name: "TLS_AES_256_GCM_SHA384" };
    },
    authorized: true,
    ...(overrides || {}),
  };
}

beforeEach(() => {
  ProbeApiDiagnostics.reset();
});

afterEach(() => {
  jest.restoreAllMocks();
  ProbeApiDiagnostics.reset();
});

describe("where the request stalled", () => {
  test("no socket at all: nothing ever left this machine", () => {
    const report: JSONObject = ProbeApiDiagnostics.buildFailureReport(
      buildTimeoutOutcome({ socket: null }),
    );

    expect(report["stalledAt"]).toBe(ProbeRequestStallPhase.SocketAssignment);
    expect((report["connection"] as JSONObject)["socketAssigned"]).toBe(false);
  });

  test("socket still connecting: the TCP handshake never completed", () => {
    const report: JSONObject = ProbeApiDiagnostics.buildFailureReport(
      buildTimeoutOutcome({
        socket: { connecting: true, bytesWritten: 0, bytesRead: 0 },
      }),
    );

    expect(report["stalledAt"]).toBe(ProbeRequestStallPhase.TcpConnect);
  });

  test("TLS socket with nothing negotiated: stuck in the handshake", () => {
    const report: JSONObject = ProbeApiDiagnostics.buildFailureReport(
      buildTimeoutOutcome({
        socket: connectedTlsSocket({
          getProtocol: (): string | null => {
            return null;
          },
        }),
      }),
    );

    expect(report["stalledAt"]).toBe(ProbeRequestStallPhase.TlsHandshake);
  });

  test("request written, zero bytes back: the SERVER is the one that stalled", () => {
    const report: JSONObject = ProbeApiDiagnostics.buildFailureReport(
      buildTimeoutOutcome({ socket: connectedTlsSocket() }),
    );

    /*
     * This is the case that matters most in the field: the probe's network
     * path is healthy and the request is sitting on the server. Saying so
     * stops the customer from re-auditing their firewall.
     */
    expect(report["stalledAt"]).toBe(
      ProbeRequestStallPhase.WaitingForServerResponse,
    );

    const connection: JSONObject = report["connection"] as JSONObject;
    expect(connection["remoteAddress"]).toBe("10.1.2.3");
    expect(connection["bytesWrittenToServer"]).toBe(412);
    expect(connection["bytesReadFromServer"]).toBe(0);
    expect((connection["tls"] as JSONObject)["protocol"]).toBe("TLSv1.3");
  });

  test("nothing written to a connected socket: the far end stopped reading", () => {
    const report: JSONObject = ProbeApiDiagnostics.buildFailureReport(
      buildTimeoutOutcome({
        socket: connectedTlsSocket({ bytesWritten: 0 }),
      }),
    );

    expect(report["stalledAt"]).toBe(ProbeRequestStallPhase.RequestSend);
  });

  test("headers arrived but the body never finished", () => {
    const report: JSONObject = ProbeApiDiagnostics.buildFailureReport(
      buildTimeoutOutcome({
        socket: connectedTlsSocket({ bytesRead: 120 }),
        hasResponse: true,
      }),
    );

    expect(report["stalledAt"]).toBe(ProbeRequestStallPhase.ResponseBody);
  });

  test("the follow-redirects wrapper is unwrapped to reach the real socket", () => {
    const report: JSONObject = ProbeApiDiagnostics.buildFailureReport(
      buildTimeoutOutcome({
        socket: connectedTlsSocket(),
        useFollowRedirectsWrapper: true,
      }),
    );

    expect(report["stalledAt"]).toBe(
      ProbeRequestStallPhase.WaitingForServerResponse,
    );
    expect((report["connection"] as JSONObject)["socketAssigned"]).toBe(true);
  });

  test("an error with no request object is Unknown, not a false SocketAssignment", () => {
    /*
     * Absence of evidence is not evidence: a failure raised before axios
     * built a request (or a non-axios throw) must not be reported as
     * "nothing left this machine", which would send the customer after a
     * firewall that has nothing to do with it.
     */
    const report: JSONObject = ProbeApiDiagnostics.buildFailureReport({
      method: HTTPMethod.POST,
      url: "https://oneuptime.example.com/probe-ingest/alive",
      elapsedInMs: 5,
      attempts: 1,
      timeoutInMs: 45000,
      error: new Error("URL is required for static method"),
    });

    expect(report["stalledAt"]).toBe(ProbeRequestStallPhase.Unknown);
  });

  test("every phase comes with an explanation, not just a label", () => {
    const report: JSONObject = ProbeApiDiagnostics.buildFailureReport(
      buildTimeoutOutcome({ socket: connectedTlsSocket() }),
    );

    expect(String(report["whatThisMeans"]).length).toBeGreaterThan(0);
  });
});

describe("a deadline that fires late means the probe was blocked", () => {
  test("a large overrun is called out explicitly", () => {
    /*
     * axios starts its timer when the request is created, so 45s of deadline
     * taking 120s of wall clock means this process could not run its own
     * timer — a blocked event loop or a suspended VM, NOT a network fault.
     */
    const report: JSONObject = ProbeApiDiagnostics.buildFailureReport(
      buildTimeoutOutcome({
        socket: connectedTlsSocket(),
        elapsedInMs: 120000,
        timeoutInMs: 45000,
      }),
    );

    expect((report["request"] as JSONObject)["deadlineOverrunInMs"]).toBe(
      75000,
    );
    expect(report["alsoNote"]).toBeDefined();
  });

  test("a timeout that fired on schedule adds no such note", () => {
    const report: JSONObject = ProbeApiDiagnostics.buildFailureReport(
      buildTimeoutOutcome({
        socket: connectedTlsSocket(),
        elapsedInMs: 45010,
        timeoutInMs: 45000,
      }),
    );

    expect(report["alsoNote"]).toBeUndefined();
  });
});

describe("contact history", () => {
  test("consecutive transport failures accumulate, per route", () => {
    // The self-test opens real sockets; this suite is about the counters.
    jest
      .spyOn(ProbeApiDiagnostics, "maybeRunConnectivitySelfTest")
      .mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const outcome: RequestOutcome = buildTimeoutOutcome({ socket: null });

    ProbeApiDiagnostics.onRequestComplete(1, outcome);
    ProbeApiDiagnostics.onRequestComplete(2, outcome);

    const contact: JSONObject = ProbeApiDiagnostics.getServerContactSnapshot();

    expect(contact["consecutiveFailures"]).toBe(2);
    expect(
      (contact["failuresByRoute"] as JSONObject)["/probe-ingest/alive"],
    ).toBe(2);
    expect(contact["lastSuccessfulContactAt"]).toBe(
      "never since this probe started",
    );
  });

  test("any HTTP status — 500 included — counts as reaching the server", () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest
      .spyOn(ProbeApiDiagnostics, "maybeRunConnectivitySelfTest")
      .mockImplementation((): void => {});

    ProbeApiDiagnostics.onRequestComplete(1, buildTimeoutOutcome({}));

    /*
     * A 500 proves DNS, TCP, TLS, the proxy and the ingress all work, so it
     * must clear the connectivity streak — otherwise the self-test fires at
     * a network that is demonstrably fine.
     */
    ProbeApiDiagnostics.onRequestComplete(2, {
      method: HTTPMethod.POST,
      url: "https://oneuptime.example.com/probe-ingest/alive",
      elapsedInMs: 40,
      attempts: 1,
      statusCode: 500,
    });

    const contact: JSONObject = ProbeApiDiagnostics.getServerContactSnapshot();

    expect(contact["consecutiveFailures"]).toBe(0);
    expect(contact["secondsSinceLastSuccessfulContact"]).toBe(0);
  });
});

describe("slow-but-successful requests", () => {
  test("a request over the threshold is warned about, with its elapsed time", () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const warnSpy = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});

    ProbeApiDiagnostics.onRequestComplete(1, {
      method: HTTPMethod.POST,
      url: "https://oneuptime.example.com/probe-ingest/alive",
      elapsedInMs: 22000,
      attempts: 1,
      timeoutInMs: 45000,
      statusCode: 200,
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain("22000ms");
  });

  test("a fast request stays silent", () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const warnSpy = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});

    ProbeApiDiagnostics.onRequestComplete(1, {
      method: HTTPMethod.POST,
      url: "https://oneuptime.example.com/probe-ingest/alive",
      elapsedInMs: 120,
      attempts: 1,
      timeoutInMs: 45000,
      statusCode: 200,
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("in-flight requests", () => {
  test("requests still in flight are listed, so a pile-up is visible", () => {
    ProbeApiDiagnostics.beginRequest({
      toString: (): string => {
        return "https://oneuptime.example.com/probe-ingest/monitor/list";
      },
    } as never);

    const snapshot: JSONObject = ProbeApiDiagnostics.getProcessSnapshot();

    expect(snapshot["inFlightRequestCount"]).toBe(1);
  });

  test("a settled request is no longer in flight", () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});

    const id: number = ProbeApiDiagnostics.beginRequest({
      toString: (): string => {
        return "https://oneuptime.example.com/probe-ingest/monitor/list";
      },
    } as never);

    ProbeApiDiagnostics.onRequestComplete(id, {
      method: HTTPMethod.POST,
      url: "https://oneuptime.example.com/probe-ingest/monitor/list",
      elapsedInMs: 30,
      attempts: 1,
      statusCode: 200,
    });

    const snapshot: JSONObject = ProbeApiDiagnostics.getProcessSnapshot();

    expect(snapshot["inFlightRequestCount"]).toBe(0);
  });
});

describe("the startup environment dump records the private-network monitor policy", () => {
  /*
   * OneUptime issue #3879 reached support as "monitors on internal targets
   * broke after the upgrade", and the environment dump support asks for said
   * nothing about why: the probe had dropped its operator's opt-in without a
   * word. The dump now carries the decision and the inputs it came from.
   */
  const policyEnvironmentKeys: Array<string> = [
    "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS",
    "REGISTER_PROBE_KEY",
    "BILLING_ENABLED",
  ];
  const originalPolicyEnvironment: Array<string | undefined> =
    policyEnvironmentKeys.map((key: string): string | undefined => {
      return process.env[key];
    });

  afterEach(() => {
    policyEnvironmentKeys.forEach((key: string, index: number) => {
      const original: string | undefined = originalPolicyEnvironment[index];
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    });
  });

  function readStartupEnvironment(
    diagnostics: typeof ProbeApiDiagnostics,
    log: typeof logger,
  ): JSONObject {
    const info: ReturnType<typeof jest.spyOn> = jest
      .spyOn(log, "info")
      .mockImplementation((): void => {});

    diagnostics.logStartupEnvironment();

    const dumps: Array<JSONObject> = info.mock.calls
      .map((call: Array<unknown>): string => {
        return String(call[0]);
      })
      .filter((text: string): boolean => {
        return text.startsWith("{");
      })
      .map((text: string): JSONObject => {
        return JSON.parse(text) as JSONObject;
      });

    expect(dumps).toHaveLength(1);
    return dumps[0]!;
  }

  // Re-imports the probe under this environment: Config.ts reads it once.
  function readStartupEnvironmentUnder(
    environment: Record<string, string | undefined>,
  ): JSONObject {
    for (const key of policyEnvironmentKeys) {
      const value: string | undefined = environment[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    const dumps: Array<JSONObject> = [];
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      const isolatedLogger: typeof logger = (
        require("Common/Server/Utils/Logger") as { default: typeof logger }
      ).default;
      const isolatedDiagnostics: typeof ProbeApiDiagnostics = (
        require("../../Utils/ProbeApiDiagnostics") as {
          default: typeof ProbeApiDiagnostics;
        }
      ).default;
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

      dumps.push(readStartupEnvironment(isolatedDiagnostics, isolatedLogger));
    });

    return dumps[0]!;
  }

  test("records the policy this probe resolved at startup, as a JSON field support can read", () => {
    const environment: JSONObject = readStartupEnvironment(
      ProbeApiDiagnostics,
      logger,
    );

    expect(environment["privateNetworkMonitors"]).toEqual(
      PrivateNetworkMonitorPolicy.getDiagnosticsSnapshot(
        PROBE_PRIVATE_NETWORK_MONITOR_POLICY,
      ),
    );
    expect(
      Object.keys(environment["privateNetworkMonitors"] as JSONObject).sort(),
    ).toEqual([
      "allowed",
      "autoRegisteredGlobalProbe",
      "billingEnabled",
      "configuredValue",
      "reason",
    ]);
  });

  test("ISSUE #3879: a bundled global probe on a self-hosted instance records the opt-in as honored", () => {
    const environment: JSONObject = readStartupEnvironmentUnder({
      PROBE_ALLOW_PRIVATE_NETWORK_MONITORS: "true",
      REGISTER_PROBE_KEY: "11111111-2222-3333-4444-555555555555",
      BILLING_ENABLED: undefined,
    });

    expect(environment["privateNetworkMonitors"]).toEqual({
      allowed: true,
      reason: "Allowed",
      configuredValue: "true",
      autoRegisteredGlobalProbe: true,
      billingEnabled: false,
    });
  });

  test("a global probe on a billing-enabled instance records the opt-in as refused, and why", () => {
    const environment: JSONObject = readStartupEnvironmentUnder({
      PROBE_ALLOW_PRIVATE_NETWORK_MONITORS: "true",
      REGISTER_PROBE_KEY: "11111111-2222-3333-4444-555555555555",
      BILLING_ENABLED: "true",
    });

    expect(environment["privateNetworkMonitors"]).toEqual({
      allowed: false,
      reason: "RefusedOnHostedGlobalProbe",
      configuredValue: "true",
      autoRegisteredGlobalProbe: true,
      billingEnabled: true,
    });
  });

  test("an unset opt-in is recorded as null rather than left out of the dump", () => {
    const environment: JSONObject = readStartupEnvironmentUnder({
      PROBE_ALLOW_PRIVATE_NETWORK_MONITORS: undefined,
      REGISTER_PROBE_KEY: undefined,
      BILLING_ENABLED: undefined,
    });

    expect(environment["privateNetworkMonitors"]).toEqual({
      allowed: false,
      reason: "NotRequested",
      configuredValue: null,
      autoRegisteredGlobalProbe: false,
      billingEnabled: false,
    });
  });
});
