/*
 * A MONITOR SECRET IN A CHECK'S URL NEVER GOES PAST THE SERVER'S INGEST IN
 * WHAT A PROBE REPORTS (#10785).
 *
 * The server fills {{monitorSecrets.NAME}} into an API, Website or External
 * Status Page monitor's URL before it hands the check to the probe. A
 * custom probe from before #10785 says that URL whole when a request fails
 * ("Request failed to https://...?key=<the key>. socket hang up"), in the
 * check's failure cause, each attempt's and why the request failed. The
 * server writes every URL in them by its scheme, host and port as it takes
 * the report in, so what follows - MonitorResource's judging, the
 * monitor's logs and summary, an incident's root cause and the templates of
 * its notifications, a Test Monitor run's kept result - never reads a
 * secret, whichever release the probe runs.
 *
 * MonitorResource and MonitorTestService are mocked: what is checked is
 * what the queue worker hands them.
 */

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: {
      monitorResource: jest.fn(() => {
        return Promise.resolve({});
      }),
    },
  };
});

jest.mock("Common/Server/Services/MonitorTestService", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Services/MonitorTestService",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    MONITOR_TEST_NOT_HANDED_TO_PROBE_MESSAGE:
      actual["MONITOR_TEST_NOT_HANDED_TO_PROBE_MESSAGE"],
    default: {
      findOneById: jest.fn(() => {
        return Promise.resolve(null);
      }),
      mergeStepProbeResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import { processProbeFromQueue } from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest";
import { ProbeIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorTestService from "Common/Server/Services/MonitorTestService";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import { RequestFailedPhase } from "Common/Types/Probe/RequestFailedDetails";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Mock } from "jest-mock";

type AnyMock = Mock<(...args: Array<any>) => any>;

const monitorResource: AnyMock =
  MonitorResourceUtil.monitorResource as unknown as AnyMock;

const mergeStepProbeResponse: AnyMock =
  MonitorTestService.mergeStepProbeResponse as unknown as AnyMock;

const SENDER: string = "2a4c6e8f-0b1d-4f3a-9c5e-7b9d1f3a5c11";
const TEST_ID: string = "3c5e7a9b-1d2f-4a4c-8e6b-0d2f4a6c8e33";
const STEP_ID: string = "8b0d2f4a-6c1e-4e3a-9b5d-7f9b1d3f5a44";

// In every secret, so a text that holds one is found.
const MARK: string = "hunter2";

// The URL the probe sent: the server had filled the secrets in.
const SENT: string = `https://api.example.com/v1/${MARK}-path/health?key=${MARK}-key#${MARK}-fragment`;

function asJson(id: string): JSONObject {
  return JSON.parse(JSON.stringify(new ObjectID(id))) as JSONObject;
}

function attempt(failureCause: string): JSONObject {
  return {
    attemptNumber: 1,
    attemptedAt: "2026-11-23T10:00:00.000Z",
    responseReceivedAt: "2026-11-23T10:00:01.000Z",
    responseTimeInMs: 12,
    isOnline: false,
    failureCause: failureCause,
  };
}

// A failed check as a probe from before #10785 put it on the wire.
function olderProbesReport(): JSONObject {
  return {
    monitorId: asJson("9d1f3b5d-7a2c-4c6e-8f0a-2b4d6f8a0c55"),
    projectId: asJson("0e2a4c6e-8b3d-4f5a-9c7e-1d3f5b7d9f66"),
    monitorStepId: asJson(STEP_ID),
    probeId: asJson(SENDER),
    isOnline: false,
    failureCause: `Request failed to ${SENT}. socket hang up`,
    requestFailedDetails: {
      failedPhase: RequestFailedPhase.Unknown,
      errorCode: "ECONNRESET",
      errorDescription: `The request failed: Request failed to ${SENT}. socket hang up`,
      rawErrorMessage: `Request failed to ${SENT}. socket hang up`,
    },
    probeAttempts: [
      attempt(`Request failed to ${SENT}. socket hang up`),
      attempt(`Request failed to ${SENT}. socket hang up`),
    ],
    totalAttempts: 2,
    externalStatusPageResponse: {
      isOnline: false,
      overallStatus: "unknown",
      componentStatuses: [],
      activeIncidentCount: 0,
      responseTimeInMs: 12,
      failureCause: `Invalid monitor target URL: ${SENT}`,
      probeAttempts: [attempt(`Invalid monitor target URL: ${SENT}`)],
    },
    monitoredAt: "2026-11-23T10:00:01.000Z",
  };
}

// A job as the probe ingest route queues it, read back from Redis.
function job(
  jobType: "probe-response" | "monitor-test",
  result: JSONObject,
): ProbeIngestJobData {
  return JSON.parse(
    JSON.stringify({
      jobType: jobType,
      testId: jobType === "monitor-test" ? TEST_ID : undefined,
      ingestionTimestamp: new Date("2026-11-23T10:00:01.500Z"),
      probeMonitorResponse: {
        probeId: SENDER,
        probeMonitorResponse: result,
      },
    }),
  ) as ProbeIngestJobData;
}

beforeEach(() => {
  monitorResource.mockClear();
  mergeStepProbeResponse.mockReset();
  mergeStepProbeResponse.mockResolvedValue(true as never);
});

describe("an older probe's failed check, as the server takes it in", () => {
  it("is judged with every URL in what it reports by its scheme, host and port", async () => {
    await processProbeFromQueue(job("probe-response", olderProbesReport()));

    expect(monitorResource).toHaveBeenCalledTimes(1);

    const judged: ProbeMonitorResponse = monitorResource.mock
      .calls[0]![0] as ProbeMonitorResponse;

    expect(JSON.stringify(judged)).not.toContain(MARK);

    // What a root cause and a template read: the request still named, by its host.
    expect(judged.failureCause).toBe(
      "Request failed to https://api.example.com. socket hang up",
    );
    expect(
      judged.probeAttempts?.map((item: ProbeAttempt): string | undefined => {
        return item.failureCause;
      }),
    ).toEqual([
      "Request failed to https://api.example.com. socket hang up",
      "Request failed to https://api.example.com. socket hang up",
    ]);
    expect(judged.requestFailedDetails).toEqual({
      failedPhase: RequestFailedPhase.Unknown,
      errorCode: "ECONNRESET",
      errorDescription:
        "The request failed: Request failed to https://api.example.com. socket hang up",
      rawErrorMessage:
        "Request failed to https://api.example.com. socket hang up",
    });
    expect(judged.externalStatusPageResponse?.failureCause).toBe(
      "Invalid monitor target URL: https://api.example.com",
    );

    // Everything else is as the probe said it.
    expect(judged.isOnline).toBe(false);
    expect(judged.totalAttempts).toBe(2);
    expect(judged.monitorStepId.toString()).toBe(STEP_ID);
    expect(judged.probeId.toString()).toBe(SENDER);
    expect(judged.monitoredAt).toEqual(olderProbesReport()["monitoredAt"]);
    expect(judged.ingestedAt).toBeInstanceOf(Date);
  });

  it("keeps a Test Monitor run's result with no secret in it", async () => {
    await processProbeFromQueue(job("monitor-test", olderProbesReport()));

    expect(mergeStepProbeResponse).toHaveBeenCalledTimes(1);

    const kept: JSONObject = mergeStepProbeResponse.mock
      .calls[0]![0] as JSONObject;

    expect(JSON.stringify(kept)).not.toContain(MARK);
    expect(JSON.stringify(kept)).toContain(
      "Request failed to https://api.example.com. socket hang up",
    );
  });

  it("leaves a check that names no URL as the probe said it", async () => {
    const report: JSONObject = {
      ...olderProbesReport(),
      failureCause: "Connection Refused.",
      requestFailedDetails: {
        failedPhase: RequestFailedPhase.TCPConnection,
        errorCode: "ECONNREFUSED",
        errorDescription: "The server refused the connection.",
      },
      probeAttempts: [attempt("Connection Refused.")],
      externalStatusPageResponse: undefined,
    };

    await processProbeFromQueue(job("probe-response", report));

    const judged: ProbeMonitorResponse = monitorResource.mock
      .calls[0]![0] as ProbeMonitorResponse;

    expect(judged.failureCause).toBe("Connection Refused.");
    expect(judged.requestFailedDetails).toEqual(report["requestFailedDetails"]);
    expect(judged.probeAttempts?.[0]?.failureCause).toBe("Connection Refused.");
  });
});
