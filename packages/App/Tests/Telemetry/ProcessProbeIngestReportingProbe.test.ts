/*
 * The probe ingest queue worker holds every job to the probe that sent it.
 *
 * A probe ingest route writes the authenticated probe beside what it queues
 * ({ probeId, probeMonitorResponse }, { probeId, snmpTrap }). A job queued
 * before the routes did that carries the whole request body instead - the
 * probe's key with it - whose top-level probeId is the one the probe
 * authenticated with. Either way the worker:
 *
 *   - reads the sender from that top-level probeId, and refuses a job that
 *     does not say (never guessing from the result);
 *   - refuses a result that names another probe, and writes the sender into
 *     one that names none;
 *   - hands MonitorResource the sender as reportingProbeId, so the result is
 *     taken only for a monitor that probe checks;
 *   - writes a monitor test's result only on a test handed to the sender,
 *     and refuses the job when it was not;
 *   - matches a trap only to the devices the sender polls.
 *
 * MonitorResource and MonitorTestService are mocked: what they do with the
 * reporting probe is MonitorResourceReportingProbe (Common) and
 * MonitorTestProbeResponsePostgres; the whole path end to end is
 * ProbeIngestReportsAsItselfPostgres.
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
      // The test's steps, which the kept result names its destination by.
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

import {
  processProbeFromQueue,
  processSnmpTrapFromQueue,
} from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest";
import { ProbeIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import SnmpTrapLogWriter from "../../FeatureSet/Telemetry/Services/SnmpTrapLogWriter";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorTestService, {
  MONITOR_TEST_NOT_HANDED_TO_PROBE_MESSAGE,
} from "Common/Server/Services/MonitorTestService";
import ProbeService from "Common/Server/Services/ProbeService";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkDeviceWalkUtil from "Common/Server/Utils/Monitor/NetworkDeviceWalkUtil";
import OnCallPageTiming from "Common/Server/Utils/OnCall/OnCallPageTiming";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import {
  PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE,
  REPORTING_PROBE_NOT_KNOWN_MESSAGE,
} from "Common/Server/Utils/Probe/ProbeReportIdentity";
import Probe from "Common/Models/DatabaseModels/Probe";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

type AnyMock = jest.Mock<(...args: Array<any>) => any>;

const monitorResource: AnyMock =
  MonitorResourceUtil.monitorResource as unknown as AnyMock;

const mergeStepProbeResponse: AnyMock =
  MonitorTestService.mergeStepProbeResponse as unknown as AnyMock;

const SENDER: string = "2a4c6e8f-0b1d-4f3a-9c5e-7b9d1f3a5c11";
const OTHER: string = "6e8a0c2d-4f1b-4d3c-8e5f-9a1c3e5b7d22";
const TEST_ID: string = "3c5e7a9b-1d2f-4a4c-8e6b-0d2f4a6c8e33";
const STEP_ID: string = "8b0d2f4a-6c1e-4e3a-9b5d-7f9b1d3f5a44";
const PROBE_KEY: string = "probe-key-from-an-older-job";

function asJson(id: string): JSONObject {
  return JSON.parse(JSON.stringify(new ObjectID(id))) as JSONObject;
}

// A check result as the probe put it on the wire.
function wireResult(namedProbe?: unknown): JSONObject {
  const result: JSONObject = {
    monitorId: asJson("9d1f3b5d-7a2c-4c6e-8f0a-2b4d6f8a0c55"),
    projectId: asJson("0e2a4c6e-8b3d-4f5a-9c7e-1d3f5b7d9f66"),
    monitorStepId: asJson(STEP_ID),
    isOnline: false,
    failureCause: "Connection refused",
    responseTimeInMs: 99999,
    monitoredAt: "2026-10-17T10:00:00.000Z",
  };

  if (namedProbe !== undefined) {
    result["probeId"] = namedProbe as JSONObject;
  }

  return result;
}

// A job as the probe ingest route queues it now, read back from Redis.
function job(input: {
  jobType: "probe-response" | "monitor-test";
  sender?: unknown;
  result: JSONObject;
}): ProbeIngestJobData {
  return JSON.parse(
    JSON.stringify({
      jobType: input.jobType,
      testId: input.jobType === "monitor-test" ? TEST_ID : undefined,
      ingestionTimestamp: new Date("2026-10-17T10:00:01.000Z"),
      probeMonitorResponse: {
        ...(input.sender === undefined ? {} : { probeId: input.sender }),
        probeMonitorResponse: input.result,
      },
    }),
  ) as ProbeIngestJobData;
}

// A job as the route used to queue it: the whole request body.
function olderJob(input: {
  jobType: "probe-response" | "monitor-test";
  result: JSONObject;
}): ProbeIngestJobData {
  return JSON.parse(
    JSON.stringify({
      jobType: input.jobType,
      testId: input.jobType === "monitor-test" ? TEST_ID : undefined,
      ingestionTimestamp: new Date("2026-10-17T10:00:01.000Z"),
      probeMonitorResponse: {
        probeKey: PROBE_KEY,
        probeId: SENDER,
        probeCapabilities: ["networkDevicePing"],
        probeMonitorResponse: input.result,
      },
    }),
  ) as ProbeIngestJobData;
}

function judgedResult(): { result: ProbeMonitorResponse; options: JSONObject } {
  expect(monitorResource).toHaveBeenCalledTimes(1);

  return {
    result: monitorResource.mock.calls[0]![0] as ProbeMonitorResponse,
    options: monitorResource.mock.calls[0]![1] as JSONObject,
  };
}

beforeEach(() => {
  monitorResource.mockClear();
  mergeStepProbeResponse.mockReset();
  mergeStepProbeResponse.mockResolvedValue(true as never);
});

describe("a queued check result", () => {
  it("is judged as the sender's, and MonitorResource is told the sender", async () => {
    await processProbeFromQueue(
      job({
        jobType: "probe-response",
        sender: SENDER,
        result: wireResult(asJson(SENDER)),
      }),
    );

    const { result, options } = judgedResult();

    expect(result.probeId).toBeInstanceOf(ObjectID);
    expect(result.probeId.toString()).toBe(SENDER);
    expect((options["reportingProbeId"] as ObjectID).toString()).toBe(SENDER);
    expect(result.ingestedAt).toBeInstanceOf(Date);
  });

  it("that names no probe becomes the sender's", async () => {
    await processProbeFromQueue(
      job({ jobType: "probe-response", sender: SENDER, result: wireResult() }),
    );

    expect(judgedResult().result.probeId.toString()).toBe(SENDER);
  });

  it("that names another probe is refused, and never judged", async () => {
    for (const named of [asJson(OTHER), OTHER, OTHER.toUpperCase()]) {
      monitorResource.mockClear();

      await expect(
        processProbeFromQueue(
          job({
            jobType: "probe-response",
            sender: SENDER,
            result: wireResult(named),
          }),
        ),
      ).rejects.toThrow(
        new BadDataException(PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE),
      );

      expect(monitorResource).not.toHaveBeenCalled();
    }
  });

  it("whose sender is not written down is refused, never guessed from the result", async () => {
    for (const sender of [
      undefined,
      "",
      "some-probe",
      42,
      { _type: "ObjectID", value: "not-a-uuid" },
    ]) {
      monitorResource.mockClear();

      await expect(
        processProbeFromQueue(
          job({
            jobType: "probe-response",
            sender: sender,
            result: wireResult(asJson(SENDER)),
          }),
        ),
      ).rejects.toThrow(
        new BadDataException(REPORTING_PROBE_NOT_KNOWN_MESSAGE),
      );

      expect(monitorResource).not.toHaveBeenCalled();
    }
  });

  it("the sender is read whatever case or form it was written in", async () => {
    for (const sender of [SENDER.toUpperCase(), asJson(SENDER)]) {
      monitorResource.mockClear();

      await processProbeFromQueue(
        job({
          jobType: "probe-response",
          sender: sender,
          result: wireResult(asJson(SENDER)),
        }),
      );

      expect(
        (judgedResult().options["reportingProbeId"] as ObjectID).toString(),
      ).toBe(SENDER);
    }
  });
});

describe("a check result queued the older way (the whole request body)", () => {
  it("is the probe's that authenticated, and judged as before", async () => {
    await processProbeFromQueue(
      olderJob({
        jobType: "probe-response",
        result: wireResult(asJson(SENDER)),
      }),
    );

    const { result, options } = judgedResult();

    expect(result.probeId.toString()).toBe(SENDER);
    expect((options["reportingProbeId"] as ObjectID).toString()).toBe(SENDER);
    // The key that rode along in the old job goes nowhere.
    expect(JSON.stringify(result)).not.toContain(PROBE_KEY);
  });

  it("is refused when the result inside names another probe", async () => {
    await expect(
      processProbeFromQueue(
        olderJob({
          jobType: "probe-response",
          result: wireResult(asJson(OTHER)),
        }),
      ),
    ).rejects.toThrow(PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE);

    expect(monitorResource).not.toHaveBeenCalled();
  });
});

describe("a queued monitor test result", () => {
  it("is written only on a test handed to the sender", async () => {
    await processProbeFromQueue(
      job({
        jobType: "monitor-test",
        sender: SENDER,
        result: wireResult(asJson(SENDER)),
      }),
    );

    expect(mergeStepProbeResponse).toHaveBeenCalledTimes(1);

    const input: {
      testId: ObjectID;
      probeId: ObjectID;
      monitorStepProbeResponse: JSONObject;
    } = mergeStepProbeResponse.mock.calls[0]![0] as {
      testId: ObjectID;
      probeId: ObjectID;
      monitorStepProbeResponse: JSONObject;
    };

    expect(input.testId.toString()).toBe(TEST_ID);
    expect(input.probeId.toString()).toBe(SENDER);
    expect(Object.keys(input.monitorStepProbeResponse)).toEqual([STEP_ID]);
    // A test run is never judged as a check result.
    expect(monitorResource).not.toHaveBeenCalled();
  });

  it("for a test the sender was not handed is refused, and says so", async () => {
    mergeStepProbeResponse.mockResolvedValue(false as never);

    await expect(
      processProbeFromQueue(
        job({
          jobType: "monitor-test",
          sender: SENDER,
          result: wireResult(asJson(SENDER)),
        }),
      ),
    ).rejects.toThrow(
      new BadDataException(MONITOR_TEST_NOT_HANDED_TO_PROBE_MESSAGE),
    );
  });

  it("that names another probe is refused before anything is written", async () => {
    await expect(
      processProbeFromQueue(
        job({
          jobType: "monitor-test",
          sender: SENDER,
          result: wireResult(asJson(OTHER)),
        }),
      ),
    ).rejects.toThrow(PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE);

    expect(mergeStepProbeResponse).not.toHaveBeenCalled();
  });

  it("queued the older way is written for the probe that authenticated", async () => {
    await processProbeFromQueue(
      olderJob({ jobType: "monitor-test", result: wireResult() }),
    );

    expect(
      (
        mergeStepProbeResponse.mock.calls[0]![0] as { probeId: ObjectID }
      ).probeId.toString(),
    ).toBe(SENDER);
  });
});

describe("a queued SNMP trap", () => {
  const snmpTrap: JSONObject = {
    sourceIpAddress: "10.0.0.7",
    trapOid: "1.3.6.1.6.3.1.1.5.3",
  };

  let findDevices: AnyMock;

  beforeEach(() => {
    findDevices = jest
      .spyOn(NetworkDeviceHydrationUtil, "findDevicesByProbeAndSource")
      .mockResolvedValue([] as never) as unknown as AnyMock;

    jest.spyOn(ProbeService, "findOneById").mockResolvedValue(new Probe());
    jest
      .spyOn(SnmpTrapLogWriter, "writeUnmatchedTrapLogRow")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function trapJob(body: JSONObject): ProbeIngestJobData {
    return JSON.parse(
      JSON.stringify({
        jobType: "snmp-trap",
        ingestionTimestamp: new Date("2026-10-17T10:00:01.000Z"),
        snmpTrap: body,
      }),
    ) as ProbeIngestJobData;
  }

  it("is matched only to the devices of the probe that received it", async () => {
    await processSnmpTrapFromQueue(trapJob({ probeId: SENDER, snmpTrap }));

    expect(findDevices).toHaveBeenCalledTimes(1);
    expect(
      (
        findDevices.mock.calls[0]![0] as { probeId: ObjectID }
      ).probeId.toString(),
    ).toBe(SENDER);
  });

  it("queued the older way (the whole request body) is matched the same way", async () => {
    await processSnmpTrapFromQueue(
      trapJob({ probeId: SENDER, probeKey: PROBE_KEY, snmpTrap }),
    );

    expect(
      (
        findDevices.mock.calls[0]![0] as { probeId: ObjectID }
      ).probeId.toString(),
    ).toBe(SENDER);
  });

  it("that does not say which probe received it is refused", async () => {
    await expect(
      processSnmpTrapFromQueue(trapJob({ snmpTrap })),
    ).rejects.toThrow("Probe ID not found on SNMP trap request");

    await expect(
      processSnmpTrapFromQueue(trapJob({ probeId: "some-probe", snmpTrap })),
    ).rejects.toThrow(REPORTING_PROBE_NOT_KNOWN_MESSAGE);

    expect(findDevices).not.toHaveBeenCalled();
  });
});

/*
 * WHEN ONEUPTIME RECEIVED A PROBE'S REPORT (dataReceivedAt, issue #6647).
 *
 * The probe ingest route queues the moment it received a check result or
 * a trap as the job's ingestionTimestamp. The worker puts it on what each
 * monitor evaluates, in place of anything the probe wrote there, so a page
 * the evaluation starts is timed from then - however long the job waited -
 * and never from monitoredAt, the probe's own clock. A monitor test's
 * result pages nobody and is not stamped.
 */
describe("when OneUptime received a probe's report", () => {
  // The job()s above were received a second after the probe's check.
  const RECEIVED_AT: Date = new Date("2026-10-17T10:00:01.000Z");
  const PROBES_WORD: string = "2020-01-01T00:00:00.000Z";

  it("a check result carries it - the moment the ingest API received it, read back from the queue", async () => {
    await processProbeFromQueue(
      job({
        jobType: "probe-response",
        sender: SENDER,
        result: wireResult(asJson(SENDER)),
      }),
    );

    const { result } = judgedResult();

    expect(result.dataReceivedAt).toBeInstanceOf(Date);
    expect(result.dataReceivedAt).toEqual(RECEIVED_AT);
    expect(OnCallPageTiming.getMonitorDataReceivedAt(result)).toEqual(
      RECEIVED_AT,
    );
    // Not the probe's clock, which said a second earlier.
    expect(new Date(result.monitoredAt).toISOString()).toBe(
      "2026-10-17T10:00:00.000Z",
    );
  });

  it("what the probe wrote there is replaced by OneUptime's own stamp", async () => {
    await processProbeFromQueue(
      job({
        jobType: "probe-response",
        sender: SENDER,
        result: { ...wireResult(asJson(SENDER)), dataReceivedAt: PROBES_WORD },
      }),
    );

    expect(judgedResult().result.dataReceivedAt).toEqual(RECEIVED_AT);
  });

  it("a job that carries no stamp: what the probe wrote is taken off, and the page is timed as before", async () => {
    const queued: ProbeIngestJobData = job({
      jobType: "probe-response",
      sender: SENDER,
      result: { ...wireResult(asJson(SENDER)), dataReceivedAt: PROBES_WORD },
    });

    delete (queued as unknown as JSONObject)["ingestionTimestamp"];

    await processProbeFromQueue(queued);

    const { result } = judgedResult();

    expect("dataReceivedAt" in result).toBe(false);
    expect(OnCallPageTiming.getMonitorDataReceivedAt(result)).toBeUndefined();
  });

  it("a stamp after now - the ingest server's clock ahead of the worker's - is now", async () => {
    const queued: ProbeIngestJobData = job({
      jobType: "probe-response",
      sender: SENDER,
      result: wireResult(asJson(SENDER)),
    });

    (queued as unknown as JSONObject)["ingestionTimestamp"] = new Date(
      Date.now() + 60 * 60 * 1000,
    ).toISOString();

    const before: number = Date.now();
    await processProbeFromQueue(queued);

    const stamped: number = judgedResult().result.dataReceivedAt!.getTime();

    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it("a monitor test's result pages nobody: nothing it writes carries one", async () => {
    await processProbeFromQueue(
      job({
        jobType: "monitor-test",
        sender: SENDER,
        result: wireResult(asJson(SENDER)),
      }),
    );

    expect(mergeStepProbeResponse).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(mergeStepProbeResponse.mock.calls[0]![0]),
    ).not.toContain("dataReceivedAt");
  });

  describe("a trap", () => {
    const DEVICE_ID: string = "4d6f8a0c-2e1b-4b3d-9f5a-7c9e1b3d5f77";
    const PROJECT_ID: string = "5e7a9c1d-3f2b-4c4e-8a6b-8d0f2a4c6e88";
    const snmpTrap: JSONObject = {
      sourceIpAddress: "10.0.0.7",
      trapOid: "1.3.6.1.6.3.1.1.5.3",
    };

    // A Network Device monitor whose one step watches the device.
    function monitorWatchingTheDevice(stepId: string): Monitor {
      const monitor: Monitor = new Monitor();
      monitor.id = ObjectID.generate();
      monitor.projectId = new ObjectID(PROJECT_ID);
      monitor.monitorSteps = {
        data: {
          monitorStepsInstanceArray: [
            {
              id: new ObjectID(stepId),
              data: { networkDeviceMonitor: { networkDeviceId: DEVICE_ID } },
            },
          ],
        },
      } as never;
      return monitor;
    }

    function trapJob(ingestionTimestamp: unknown): ProbeIngestJobData {
      return JSON.parse(
        JSON.stringify({
          jobType: "snmp-trap",
          ingestionTimestamp: ingestionTimestamp,
          snmpTrap: { probeId: SENDER, snmpTrap },
        }),
      ) as ProbeIngestJobData;
    }

    beforeEach(() => {
      const device: NetworkDevice = new NetworkDevice();
      device.id = new ObjectID(DEVICE_ID);
      device.projectId = new ObjectID(PROJECT_ID);

      jest
        .spyOn(NetworkDeviceHydrationUtil, "findDevicesByProbeAndSource")
        .mockResolvedValue([device] as never);
      jest
        .spyOn(SnmpTrapLogWriter, "writeTrapLogRows")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(NetworkDeviceWalkUtil, "findMonitorsWatchingDevices")
        .mockResolvedValue([
          monitorWatchingTheDevice(STEP_ID),
          monitorWatchingTheDevice("9c1e3a5b-7d2f-4e6a-8b0c-1d3f5a7c9e99"),
        ] as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("every monitor it reaches evaluates it as received when the ingest API received it", async () => {
      await processSnmpTrapFromQueue(trapJob(RECEIVED_AT));

      expect(monitorResource).toHaveBeenCalledTimes(2);

      for (const call of monitorResource.mock.calls) {
        const response: ProbeMonitorResponse = call[0] as ProbeMonitorResponse;

        expect(response.snmpTrapResponse).toBeTruthy();
        expect(response.dataReceivedAt).toEqual(RECEIVED_AT);
        expect(OnCallPageTiming.getMonitorDataReceivedAt(response)).toEqual(
          RECEIVED_AT,
        );
        // monitoredAt is when the worker got to it, as before.
        expect(response.monitoredAt.getTime()).toBeGreaterThan(
          RECEIVED_AT.getTime(),
        );
      }
    });

    it("a trap job with no stamp is timed as before", async () => {
      await processSnmpTrapFromQueue(trapJob(undefined));

      expect(monitorResource).toHaveBeenCalledTimes(2);

      for (const call of monitorResource.mock.calls) {
        expect("dataReceivedAt" in (call[0] as JSONObject)).toBe(false);
      }
    });
  });
});
