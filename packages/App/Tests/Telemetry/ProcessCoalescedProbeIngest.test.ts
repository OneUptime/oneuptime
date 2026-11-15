/*
 * The jobs a backlog holds one of: a device's poll job processes the
 * device's NEWEST poll (NetworkDevicePollLatestStore), and a sender's trap
 * job works through the sender's waiting traps in order
 * (SnmpTrapPendingStore). The stores and the processing are mocked here;
 * NetworkDevicePollCoalescingRedis runs the same jobs on a real Redis and
 * BullMQ.
 */

jest.mock(
  "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest",
  () => {
    return {
      __esModule: true,
      processNetworkDeviceWalkFromQueue: jest.fn(),
      processSnmpTrapFromQueue: jest.fn(),
    };
  },
);

jest.mock(
  "../../FeatureSet/Telemetry/Utils/NetworkDevicePollLatestStore",
  () => {
    return {
      __esModule: true,
      default: {
        getLatest: jest.fn(),
        clearIfUnchanged: jest.fn(),
      },
    };
  },
);

jest.mock("../../FeatureSet/Telemetry/Utils/SnmpTrapPendingStore", () => {
  return {
    __esModule: true,
    MAX_ATTEMPTS_PER_TRAP: 3,
    default: {
      peekOldest: jest.fn(),
      removeOldest: jest.fn(),
      countFailure: jest.fn(),
      hasPending: jest.fn(),
    },
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addSnmpTrapBatchJob: jest.fn(),
      },
    };
  },
);

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
  MAX_TRAPS_PER_JOB,
  processNetworkDevicePollFromQueue,
  processSnmpTrapBatchFromQueue,
} from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessCoalescedProbeIngest";
import {
  processNetworkDeviceWalkFromQueue,
  processSnmpTrapFromQueue,
} from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest";
import TelemetryQueueService, {
  ProbeIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import NetworkDevicePollLatestStore from "../../FeatureSet/Telemetry/Utils/NetworkDevicePollLatestStore";
import SnmpTrapPendingStore, {
  PendingSnmpTrap,
} from "../../FeatureSet/Telemetry/Utils/SnmpTrapPendingStore";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";

const processWalk: jest.Mock =
  processNetworkDeviceWalkFromQueue as unknown as jest.Mock;
const processTrap: jest.Mock = processSnmpTrapFromQueue as unknown as jest.Mock;
const getLatest: jest.Mock =
  NetworkDevicePollLatestStore.getLatest as unknown as jest.Mock;
const clearIfUnchanged: jest.Mock =
  NetworkDevicePollLatestStore.clearIfUnchanged as unknown as jest.Mock;
const peekOldest: jest.Mock =
  SnmpTrapPendingStore.peekOldest as unknown as jest.Mock;
const removeOldest: jest.Mock =
  SnmpTrapPendingStore.removeOldest as unknown as jest.Mock;
const countFailure: jest.Mock =
  SnmpTrapPendingStore.countFailure as unknown as jest.Mock;
const hasPending: jest.Mock =
  SnmpTrapPendingStore.hasPending as unknown as jest.Mock;
const addSnmpTrapBatchJob: jest.Mock =
  TelemetryQueueService.addSnmpTrapBatchJob as unknown as jest.Mock;

const PROBE_ID: string = ObjectID.generate().toString();
const DEVICE_ID: string = ObjectID.generate().toString();
const SOURCE: string = "10.0.0.7";

function pollJob(pollId: string): ProbeIngestJobData {
  return {
    jobType: "network-device-poll",
    ingestionTimestamp: new Date("2026-11-14T10:00:00.000Z"),
    networkDevicePoll: {
      probeId: PROBE_ID,
      networkDeviceId: DEVICE_ID,
      pollId: pollId,
    },
  };
}

function storedPoll(isOnline: boolean): ProbeIngestJobData {
  return {
    jobType: "network-device-walk",
    ingestionTimestamp: new Date("2026-11-14T10:00:00.000Z"),
    networkDeviceWalk: {
      probeId: PROBE_ID,
      networkDeviceId: DEVICE_ID,
      isOnline: isOnline,
    },
  };
}

function trapJob(): ProbeIngestJobData {
  return {
    jobType: "snmp-trap-batch",
    ingestionTimestamp: new Date("2026-11-14T10:00:00.000Z"),
    snmpTrapBatch: { probeId: PROBE_ID, sourceIpAddress: SOURCE },
  };
}

// A sender's waiting traps, oldest first, as the store hands them out.
let waiting: Array<PendingSnmpTrap> = [];

function trap(trapOid: string, attempts: number = 0): PendingSnmpTrap {
  const payload: ProbeIngestJobData = {
    jobType: "snmp-trap",
    ingestionTimestamp: new Date("2026-11-14T10:00:00.000Z"),
    snmpTrap: {
      probeId: PROBE_ID,
      snmpTrap: { sourceIpAddress: SOURCE, trapOid: trapOid },
    },
  };

  return {
    raw: JSON.stringify({ payload, attempts, trapOid }),
    payload: payload,
    attempts: attempts,
  };
}

function trapOidsProcessed(): Array<string> {
  return processTrap.mock.calls.map((call: Array<unknown>) => {
    return (
      (call[0] as ProbeIngestJobData).snmpTrap!["snmpTrap"] as {
        trapOid: string;
      }
    ).trapOid;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  waiting = [];

  processWalk.mockResolvedValue(undefined);
  processTrap.mockResolvedValue(undefined);
  clearIfUnchanged.mockResolvedValue(true);

  peekOldest.mockImplementation(async () => {
    return waiting[0] || null;
  });
  removeOldest.mockImplementation(
    async (_probeId: string, _source: string, raw: string) => {
      if (waiting[0]?.raw === raw) {
        waiting.shift();
        return true;
      }
      return false;
    },
  );
  countFailure.mockImplementation(
    async (_probeId: string, _source: string, failed: PendingSnmpTrap) => {
      if (waiting[0]?.raw === failed.raw) {
        waiting[0] = { ...failed, attempts: failed.attempts + 1 };
      }
    },
  );
  hasPending.mockImplementation(async () => {
    return waiting.length > 0;
  });
});

describe("a device's poll job", () => {
  test("processes the device's newest poll, not the one that queued it, and clears it", async () => {
    const newest: ProbeIngestJobData = storedPoll(false);
    getLatest.mockResolvedValue({ pollId: "poll-3", payload: newest });

    await processNetworkDevicePollFromQueue(pollJob("poll-1"));

    expect(getLatest).toHaveBeenCalledWith(PROBE_ID, DEVICE_ID);
    expect(processWalk).toHaveBeenCalledTimes(1);
    expect(processWalk).toHaveBeenCalledWith(newest);
    expect(clearIfUnchanged).toHaveBeenCalledWith({
      probeId: PROBE_ID,
      networkDeviceId: DEVICE_ID,
      pollId: "poll-3",
    });
  });

  test("a poll at least as new was processed already: nothing to do", async () => {
    getLatest.mockResolvedValue(null);

    await processNetworkDevicePollFromQueue(pollJob("poll-1"));

    expect(processWalk).not.toHaveBeenCalled();
    expect(clearIfUnchanged).not.toHaveBeenCalled();
  });

  test("a failure leaves the poll stored for the retry, and fails the job", async () => {
    getLatest.mockResolvedValue({
      pollId: "poll-2",
      payload: storedPoll(true),
    });
    processWalk.mockRejectedValue(new Error("lock timeout"));

    await expect(
      processNetworkDevicePollFromQueue(pollJob("poll-2")),
    ).rejects.toThrow("lock timeout");

    expect(clearIfUnchanged).not.toHaveBeenCalled();
  });

  test("a poll that can never be processed is cleared, and the job fails as before", async () => {
    getLatest.mockResolvedValue({
      pollId: "poll-2",
      payload: storedPoll(true),
    });
    processWalk.mockRejectedValue(
      new BadDataException(
        "Network device walk has neither snmpResponse nor isOnline",
      ),
    );

    await expect(
      processNetworkDevicePollFromQueue(pollJob("poll-2")),
    ).rejects.toThrow(BadDataException);

    expect(clearIfUnchanged).toHaveBeenCalledWith({
      probeId: PROBE_ID,
      networkDeviceId: DEVICE_ID,
      pollId: "poll-2",
    });
  });

  test("a job that does not say whose poll it is is refused", async () => {
    await expect(
      processNetworkDevicePollFromQueue({
        jobType: "network-device-poll",
        ingestionTimestamp: new Date(),
      }),
    ).rejects.toThrow(BadDataException);

    expect(getLatest).not.toHaveBeenCalled();
  });
});

describe("a sender's trap job", () => {
  test("processes every waiting trap, oldest first, removing each once processed", async () => {
    waiting = [trap("linkDown"), trap("linkUp"), trap("coldStart")];

    await processSnmpTrapBatchFromQueue(trapJob());

    expect(trapOidsProcessed()).toEqual(["linkDown", "linkUp", "coldStart"]);
    expect(waiting).toEqual([]);
    expect(addSnmpTrapBatchJob).not.toHaveBeenCalled();
  });

  test("a trap is removed only after it was processed", async () => {
    waiting = [trap("linkDown")];
    processTrap.mockImplementation(async () => {
      expect(waiting).toHaveLength(1);
    });

    await processSnmpTrapBatchFromQueue(trapJob());

    expect(waiting).toEqual([]);
  });

  test("no traps waiting: nothing to do", async () => {
    await processSnmpTrapBatchFromQueue(trapJob());

    expect(processTrap).not.toHaveBeenCalled();
    expect(addSnmpTrapBatchJob).not.toHaveBeenCalled();
  });

  test("a sender with more than one job's worth gets one more job for the rest, behind the others", async () => {
    waiting = Array.from(
      { length: MAX_TRAPS_PER_JOB + 7 },
      (_v: unknown, i: number) => {
        return trap(`oid-${i}`);
      },
    );

    await processSnmpTrapBatchFromQueue(trapJob());

    expect(processTrap).toHaveBeenCalledTimes(MAX_TRAPS_PER_JOB);
    expect(waiting).toHaveLength(7);
    expect(addSnmpTrapBatchJob).toHaveBeenCalledWith({
      probeId: PROBE_ID,
      sourceIpAddress: SOURCE,
    });
  });

  test("a trap that fails stays at the head, counted, and the job fails for its retry; the traps behind it wait", async () => {
    waiting = [trap("linkDown"), trap("linkUp")];
    processTrap.mockRejectedValueOnce(new Error("clickhouse is down"));

    await expect(processSnmpTrapBatchFromQueue(trapJob())).rejects.toThrow(
      "clickhouse is down",
    );

    expect(
      waiting.map((each: PendingSnmpTrap) => {
        return each.attempts;
      }),
    ).toEqual([1, 0]);
    expect(trapOidsProcessed()).toEqual(["linkDown"]);

    // The retry: processed in order.
    await processSnmpTrapBatchFromQueue(trapJob());

    expect(trapOidsProcessed()).toEqual(["linkDown", "linkDown", "linkUp"]);
    expect(waiting).toEqual([]);
  });

  test("a trap that failed MAX_ATTEMPTS_PER_TRAP times is given up on, and the rest go on", async () => {
    waiting = [trap("poison", 3), trap("linkUp")];

    await processSnmpTrapBatchFromQueue(trapJob());

    expect(trapOidsProcessed()).toEqual(["linkUp"]);
    expect(waiting).toEqual([]);
  });

  test("a trap that can never be processed is dropped, and the rest go on", async () => {
    waiting = [trap("broken"), trap("linkUp")];
    processTrap.mockRejectedValueOnce(
      new BadDataException("SNMP trap is missing source or trap OID"),
    );

    await processSnmpTrapBatchFromQueue(trapJob());

    expect(trapOidsProcessed()).toEqual(["broken", "linkUp"]);
    expect(waiting).toEqual([]);
    expect(countFailure).not.toHaveBeenCalled();
  });

  test("a job that does not say whose traps it is is refused", async () => {
    await expect(
      processSnmpTrapBatchFromQueue({
        jobType: "snmp-trap-batch",
        ingestionTimestamp: new Date(),
      }),
    ).rejects.toThrow(BadDataException);
  });
});
