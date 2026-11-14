import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * Telemetry a worker of this release cannot process (issue #5546, the same
 * failure on the Telemetry queue).
 *
 * Ingest runs on the app servers and the Telemetry queue on the workers, so
 * while the two run different releases - a rolling upgrade, a worker rollout
 * that stalled - a worker gets a type of telemetry, or a kind of probe
 * ingest, that only a newer release has. It used to fail the job ("Unknown
 * telemetry type") three times and drop the telemetry, or read an unknown
 * probe ingest as a probe's monitor response. Now the job goes back to the
 * queue, its body kept, for a worker of the release that queued it, and
 * fails once, saying why, only when nobody runs it for half an hour.
 *
 * The worker handler is captured by mocking QueueWorker.getWorker, as the
 * other ProcessTelemetry suites do.
 */

let capturedHandler: ((job: unknown, token?: string) => Promise<void>) | null =
  null;

jest.mock("Common/Server/Infrastructure/QueueWorker", () => {
  return {
    __esModule: true,
    default: {
      getWorker: (
        _name: unknown,
        handler: (job: unknown, token?: string) => Promise<void>,
      ): void => {
        capturedHandler = handler;
      },
    },
  };
});

const processTracesFromQueue: jest.Mock = jest.fn();
jest.mock("../../FeatureSet/Telemetry/Services/OtelTracesIngestService", () => {
  return {
    __esModule: true,
    default: { processTracesFromQueue },
  };
});

const processProbeFromQueue: jest.Mock = jest.fn();
const processIncomingEmailFromQueue: jest.Mock = jest.fn();
const processSnmpTrapFromQueue: jest.Mock = jest.fn();
const processNetworkDeviceWalkFromQueue: jest.Mock = jest.fn();
jest.mock(
  "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest",
  () => {
    return {
      __esModule: true,
      processProbeFromQueue,
      processIncomingEmailFromQueue,
      processSnmpTrapFromQueue,
      processNetworkDeviceWalkFromQueue,
    };
  },
);

const processNetworkDevicePollFromQueue: jest.Mock = jest.fn();
const processSnmpTrapBatchFromQueue: jest.Mock = jest.fn();
jest.mock(
  "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessCoalescedProbeIngest",
  () => {
    return {
      __esModule: true,
      processNetworkDevicePollFromQueue,
      processSnmpTrapBatchFromQueue,
    };
  },
);

const deleteBody: jest.Mock = jest.fn();
jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: { deleteBody, readBody: jest.fn(), storeBody: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder",
  );
  return {
    __esModule: true,
    ...actual,
    default: {
      ...(actual["default"] as Record<string, unknown>),
      decodeFromQueue: jest.fn().mockResolvedValue({ resourceSpans: [] }),
    },
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    AppVersion: "14.0.97",
  };
});

jest.mock(
  "isolated-vm",
  () => {
    const Isolate: jest.Mock = jest.fn();
    const Reference: jest.Mock = jest.fn();
    const Callback: jest.Mock = jest.fn();
    const ExternalCopy: jest.Mock = jest
      .fn()
      .mockImplementation((value: unknown) => {
        return {
          copyInto: jest.fn(() => {
            return value;
          }),
        };
      });

    return {
      __esModule: true,
      default: {
        Isolate,
        Reference,
        Callback,
        ExternalCopy,
      },
      Isolate,
      Reference,
      Callback,
      ExternalCopy,
    };
  },
  { virtual: true },
);

import { describeUnknownTelemetryJob } from "../../FeatureSet/Telemetry/Jobs/TelemetryIngest/ProcessTelemetry";
import {
  ProbeIngestJobType,
  TelemetryIngestJobData,
  TelemetryType,
  isKnownProbeIngestJobType,
  isKnownTelemetryType,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";

const MINUTE: number = 60 * 1000;
const PROJECT_ID: string = "11111111-1111-1111-1111-111111111111";

type FakeJob = {
  id: string;
  name: string;
  data: Record<string, unknown>;
  timestamp: number;
  opts: Record<string, unknown>;
  moveToDelayed: jest.Mock;
};

function telemetryJob(
  data: Record<string, unknown>,
  queuedAt: number = Date.now(),
): FakeJob {
  return {
    id: `telemetry-${queuedAt}`,
    name: "ProcessTelemetry",
    data: { projectId: PROJECT_ID, requestHeaders: {}, ...data },
    timestamp: queuedAt,
    opts: { attempts: 3 },
    moveToDelayed: jest.fn().mockResolvedValue(undefined),
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("expected the job to throw");
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ProcessTelemetry worker — telemetry this release cannot process", () => {
  test("the worker handler was registered/captured", () => {
    expect(typeof capturedHandler).toBe("function");
  });

  test("a type of telemetry only a newer release has goes back to the queue, its body kept", async () => {
    const job: FakeJob = telemetryJob({
      type: "llm-evaluations",
      bodyKey: "telemetry:body:newer",
      bodyFormat: "json",
      bodyEncoding: "none",
    });

    const error: Error = await rejectionOf(capturedHandler!(job, "lock"));

    expect(error.name).toBe("DelayedError");
    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "lock");
    expect(deleteBody).not.toHaveBeenCalled();
    expect(processTracesFromQueue).not.toHaveBeenCalled();
  });

  test("a kind of probe ingest only a newer release has goes back too, and is not read as a monitor response", async () => {
    const job: FakeJob = telemetryJob({
      type: TelemetryType.ProbeIngest,
      probeIngest: { jobType: "packet-capture-result" },
    });

    const error: Error = await rejectionOf(capturedHandler!(job, "lock"));

    expect(error.name).toBe("DelayedError");
    expect(processProbeFromQueue).not.toHaveBeenCalled();
    expect(processIncomingEmailFromQueue).not.toHaveBeenCalled();
    expect(processSnmpTrapFromQueue).not.toHaveBeenCalled();
    expect(processNetworkDeviceWalkFromQueue).not.toHaveBeenCalled();
  });

  test("telemetry nobody processes for thirty minutes fails once, saying why", async () => {
    const job: FakeJob = telemetryJob(
      { type: "llm-evaluations" },
      Date.now() - 31 * MINUTE,
    );

    const error: Error = await rejectionOf(capturedHandler!(job, "lock"));

    // Unrecoverable: the job's three attempts are not spent on it.
    expect(error.name).toBe("UnrecoverableError");
    expect(error.message).toContain(
      'No worker ran telemetry of type "llm-evaluations" within 30 minutes',
    );
    expect(error.message).toContain("This worker runs OneUptime 14.0.97");
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });

  test("telemetry this release knows is processed as before", async () => {
    processTracesFromQueue.mockResolvedValueOnce(undefined);
    const job: FakeJob = telemetryJob({
      type: TelemetryType.Traces,
      bodyKey: "telemetry:body:known",
      bodyFormat: "json",
      bodyEncoding: "none",
      productType: "Traces",
    });

    await capturedHandler!(job, "lock");

    expect(processTracesFromQueue).toHaveBeenCalledTimes(1);
    expect(job.moveToDelayed).not.toHaveBeenCalled();
    expect(deleteBody).toHaveBeenCalledWith("telemetry:body:known");
  });

  test("every kind of probe ingest this release knows is processed as before", async () => {
    for (const jobType of [
      "probe-response",
      "monitor-test",
      "incoming-email",
      "snmp-trap",
      "network-device-walk",
      "network-device-poll",
      "snmp-trap-batch",
    ]) {
      const job: FakeJob = telemetryJob({
        type: TelemetryType.ProbeIngest,
        probeIngest: { jobType },
      });

      await capturedHandler!(job, "lock");

      expect(job.moveToDelayed).not.toHaveBeenCalled();
    }

    expect(processProbeFromQueue).toHaveBeenCalledTimes(2);
    expect(processIncomingEmailFromQueue).toHaveBeenCalledTimes(1);
    // A device's newest poll and a sender's traps, coalesced in Redis.
    expect(processNetworkDevicePollFromQueue).toHaveBeenCalledTimes(1);
    expect(processSnmpTrapBatchFromQueue).toHaveBeenCalledTimes(1);
    expect(processSnmpTrapFromQueue).toHaveBeenCalledTimes(1);
    expect(processNetworkDeviceWalkFromQueue).toHaveBeenCalledTimes(1);
  });
});

describe("describeUnknownTelemetryJob", () => {
  test("is null for every type of telemetry this release has", () => {
    for (const type of Object.values(TelemetryType)) {
      expect(
        describeUnknownTelemetryJob({ type } as TelemetryIngestJobData),
      ).toBeNull();
    }
  });

  test("names a type this release does not have", () => {
    expect(
      describeUnknownTelemetryJob({
        type: "llm-evaluations",
      } as unknown as TelemetryIngestJobData),
    ).toBe('telemetry of type "llm-evaluations"');
    expect(
      describeUnknownTelemetryJob({} as unknown as TelemetryIngestJobData),
    ).toBe('telemetry of type "undefined"');
    expect(describeUnknownTelemetryJob(undefined)).toBe(
      'telemetry of type "undefined"',
    );
  });

  test("names a kind of probe ingest this release does not have", () => {
    expect(
      describeUnknownTelemetryJob({
        type: TelemetryType.ProbeIngest,
        probeIngest: { jobType: "packet-capture-result" },
      } as unknown as TelemetryIngestJobData),
    ).toBe('probe ingest of kind "packet-capture-result"');
  });

  test("a probe ingest job with no kind is processed as before", () => {
    expect(
      describeUnknownTelemetryJob({
        type: TelemetryType.ProbeIngest,
        probeIngest: {},
      } as unknown as TelemetryIngestJobData),
    ).toBeNull();
    expect(
      describeUnknownTelemetryJob({
        type: TelemetryType.ProbeIngest,
      } as unknown as TelemetryIngestJobData),
    ).toBeNull();
  });
});

describe("the kinds and types a release knows", () => {
  test("every probe ingest kind of the type is known", () => {
    const kinds: Array<ProbeIngestJobType> = [
      "probe-response",
      "monitor-test",
      "incoming-email",
      "snmp-trap",
      "network-device-walk",
      "network-device-poll",
      "snmp-trap-batch",
    ];

    for (const kind of kinds) {
      expect(isKnownProbeIngestJobType(kind)).toBe(true);
    }
  });

  test("nothing else is", () => {
    for (const kind of ["packet-capture-result", "", "toString", 3, null]) {
      expect(isKnownProbeIngestJobType(kind)).toBe(false);
    }

    for (const type of ["llm-evaluations", "", "constructor", undefined]) {
      expect(isKnownTelemetryType(type)).toBe(false);
    }
  });
});
