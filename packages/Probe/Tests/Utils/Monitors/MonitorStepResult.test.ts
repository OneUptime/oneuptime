// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

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

// eslint-disable-next-line @typescript-eslint/typedef
const mockSslPing = jest.fn();

jest.mock("../../../Utils/Monitors/MonitorTypes/SslMonitor", () => {
  return {
    __esModule: true,
    default: {
      ping: (...args: Array<unknown>): unknown => {
        return mockSslPing(...args);
      },
    },
  };
});

import MonitorUtil from "../../../Utils/Monitors/Monitor";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import URL from "Common/Types/API/URL";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";

/*
 * Covers how the probe assembles a ProbeMonitorResponse for an SSL
 * Certificate step — see https://github.com/OneUptime/oneuptime/issues/3225.
 *
 * Two defects lived here: the SSL branch never set responseTimeInMs (so no
 * ResponseTime metric row was ever written), and a step with no destination
 * returned a result with isOnline left undefined, which matches no criteria
 * and therefore reads as healthy.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const MONITOR_ID: ObjectID = ObjectID.generate();

function buildSslStep(destination?: string): MonitorStep {
  const step: MonitorStep = new MonitorStep();

  step.data = {
    ...(step.data as NonNullable<MonitorStep["data"]>),
    id: ObjectID.generate().toString(),
  } as NonNullable<MonitorStep["data"]>;

  if (destination) {
    step.setMonitorDestination(URL.fromString(destination));
  } else if (step.data) {
    step.data.monitorDestination = undefined;
  }

  return step;
}

beforeEach(() => {
  mockSslPing.mockReset();
});

describe("SSL Certificate step result assembly (issue #3225)", () => {
  test("copies responseTimeInMs so a ResponseTime metric is written", async () => {
    mockSslPing.mockResolvedValue({
      isOnline: true,
      failureCause: "",
      isTimeout: false,
      isValidCertificate: true,
      responseTimeInMs: 123,
      expiresAt: new Date(),
      probeAttempts: [],
      totalAttempts: 1,
    } as never);

    const result: ProbeMonitorResponse | null =
      await MonitorUtil.probeMonitorStep({
        monitorStep: buildSslStep("https://example.com/"),
        monitorType: MonitorType.SSLCertificate,
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
      });

    /*
     * MonitorMetricUtil gates the ResponseTime metric on this field, so
     * leaving it undefined left the SSL metrics chart permanently empty.
     */
    expect(result?.responseTimeInMs).toBe(123);
  });

  test("copies the certificate verdict through to the response", async () => {
    mockSslPing.mockResolvedValue({
      isOnline: true,
      failureCause: "Hostname/IP does not match",
      isTimeout: false,
      isValidCertificate: false,
      isSelfSigned: false,
      certificateValidationErrorCode: "ERR_TLS_CERT_ALTNAME_INVALID",
      responseTimeInMs: 10,
      probeAttempts: [],
      totalAttempts: 1,
    } as never);

    const result: ProbeMonitorResponse | null =
      await MonitorUtil.probeMonitorStep({
        monitorStep: buildSslStep("https://example.com/"),
        monitorType: MonitorType.SSLCertificate,
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
      });

    expect(result?.isOnline).toBe(true);
    expect(result?.sslResponse?.isValidCertificate).toBe(false);
    expect(result?.sslResponse?.certificateValidationErrorCode).toBe(
      "ERR_TLS_CERT_ALTNAME_INVALID",
    );
    expect(result?.failureCause).toBe("Hostname/IP does not match");
  });

  test("a step with no destination reports a definite failure, not an undefined status", async () => {
    const result: ProbeMonitorResponse | null =
      await MonitorUtil.probeMonitorStep({
        monitorStep: buildSslStep(),
        monitorType: MonitorType.SSLCertificate,
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
      });

    /*
     * Previously this returned a bare result with isOnline undefined, which
     * satisfies no criterion — so a misconfigured monitor read as healthy
     * forever instead of surfacing the misconfiguration.
     */
    expect(result?.isOnline).toBe(false);
    expect(result?.failureCause).toContain("SSL Certificate Monitor");
    expect(mockSslPing).not.toHaveBeenCalled();
  });

  test("passes the step timeout down to the SSL monitor", async () => {
    mockSslPing.mockResolvedValue({
      isOnline: true,
      failureCause: "",
      isValidCertificate: true,
      responseTimeInMs: 5,
    } as never);

    const step: MonitorStep = buildSslStep("https://example.com/");
    if (step.data) {
      step.data.requestTimeoutInMs = 4321;
    }

    await MonitorUtil.probeMonitorStep({
      monitorStep: step,
      monitorType: MonitorType.SSLCertificate,
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
    });

    const options: { timeout?: { toNumber: () => number } } = mockSslPing.mock
      .calls[0]?.[1] as { timeout?: { toNumber: () => number } };

    // The UI advertises this setting for SSL monitors; it must be honoured.
    expect(options?.timeout?.toNumber()).toBe(4321);
  });

  test("a null ping result is propagated as null", async () => {
    mockSslPing.mockResolvedValue(null as never);

    const result: ProbeMonitorResponse | null =
      await MonitorUtil.probeMonitorStep({
        monitorStep: buildSslStep("https://example.com/"),
        monitorType: MonitorType.SSLCertificate,
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
      });

    expect(result).toBeNull();
  });
});
