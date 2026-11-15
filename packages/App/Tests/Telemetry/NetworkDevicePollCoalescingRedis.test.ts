/*
 * Device polls and SNMP traps on a real Redis and real BullMQ: what a backlog
 * holds, and what the workers process when they get to it.
 *
 * A device's probe reports a poll every few minutes; each used to be a job
 * of its own, so when Postgres slowed the queue grew without bound (16,000
 * to 30,000 jobs in a minute on one install), and the workers spent the
 * backlog on polls newer polls had already made stale. Now a backlog holds
 * at most one poll job per (probe, device), and that job processes the
 * device's NEWEST poll (NetworkDevicePollLatestStore) - BullMQ's
 * deduplication alone would keep the oldest. Traps are events, so none is
 * skipped: a backlog holds one job per sender, which processes all of the
 * sender's traps, in order (SnmpTrapPendingStore).
 *
 * The processing itself (ProcessProbeIngest) is mocked to record what it
 * was handed; the queueing, the deduplication and the stores are real. The
 * queue has a name of its own, removed afterwards.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  type QueueModule = {
    default: unknown;
    QueueName: Record<string, string>;
  };

  const actual: QueueModule = jest.requireActual(
    "Common/Server/Infrastructure/Queue",
  ) as QueueModule;

  actual.QueueName["Telemetry"] =
    `NetworkDevicePollCoalescingTest-${process.pid}-${Date.now()}`;

  return {
    __esModule: true,
    default: actual.default,
    QueueName: actual.QueueName,
  };
});

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

import Queue, { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import {
  processNetworkDevicePollFromQueue,
  processSnmpTrapBatchFromQueue,
} from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessCoalescedProbeIngest";
import {
  processNetworkDeviceWalkFromQueue,
  processSnmpTrapFromQueue,
} from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest";
import TelemetryQueueService, {
  ProbeIngestJobData,
  TelemetryIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import NetworkDevicePollLatestStore from "../../FeatureSet/Telemetry/Utils/NetworkDevicePollLatestStore";
import SnmpTrapPendingStore from "../../FeatureSet/Telemetry/Utils/SnmpTrapPendingStore";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
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

type BullQueue = ReturnType<typeof Queue.getQueue>;
type BullWorker = ReturnType<typeof QueueWorker.getWorker>;

const processWalk: jest.Mock =
  processNetworkDeviceWalkFromQueue as unknown as jest.Mock;
const processTrap: jest.Mock = processSnmpTrapFromQueue as unknown as jest.Mock;

let queue: BullQueue;
const workers: Array<BullWorker> = [];
const keysToRemove: Array<string> = [];

// What the processing was handed, in order: "<device>:<sequence>".
let processedPolls: Array<string> = [];
let processedTraps: Array<string> = [];
// Polls to hold open until released.
let held: Map<string, Promise<void>> = new Map();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(
  what: string,
  condition: () => boolean | Promise<boolean>,
  timeoutInMs: number = 15000,
): Promise<void> {
  const deadline: number = Date.now() + timeoutInMs;

  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }

    await sleep(20);
  }
}

// A poll as the ingest route queues it; the body says which one it is.
async function poll(input: {
  probeId: string;
  deviceId: string;
  sequence: number;
}): Promise<void> {
  keysToRemove.push(
    NetworkDevicePollLatestStore.getKey(input.probeId, input.deviceId),
  );

  await TelemetryQueueService.addNetworkDeviceWalkJob({
    walkRequestBody: {
      probeId: input.probeId,
      networkDeviceId: input.deviceId,
      isOnline: true,
      pollMode: "ping",
      sequence: input.sequence,
    },
    receivedAt: new Date(Date.UTC(2026, 10, 14, 10, 0, input.sequence)),
  });
}

async function trap(input: {
  probeId: ObjectID;
  source: string;
  sequence: number;
}): Promise<void> {
  keysToRemove.push(
    SnmpTrapPendingStore.getKey(input.probeId.toString(), input.source),
  );

  await TelemetryQueueService.addSnmpTrapIngestJob({
    probeId: input.probeId,
    snmpTrap: {
      sourceIpAddress: input.source,
      trapOid: `1.3.6.1.6.3.1.1.5.${input.sequence}`,
    },
    receivedAt: new Date(),
  });
}

function hold(deviceId: string, sequence: number): () => void {
  let release: () => void = (): void => {};

  held.set(
    `${deviceId}:${sequence}`,
    new Promise<void>((resolve: () => void) => {
      release = resolve;
    }),
  );

  return (): void => {
    release();
  };
}

function startWorker(): BullWorker {
  const worker: BullWorker = QueueWorker.getWorker(
    QueueName.Telemetry,
    async (job: QueueJob): Promise<void> => {
      const data: TelemetryIngestJobData = job.data as TelemetryIngestJobData;

      if (data.probeIngest?.jobType === "network-device-poll") {
        await processNetworkDevicePollFromQueue(data.probeIngest);
      } else if (data.probeIngest?.jobType === "snmp-trap-batch") {
        await processSnmpTrapBatchFromQueue(data.probeIngest);
      } else {
        throw new Error(`Unexpected job ${String(data.probeIngest?.jobType)}`);
      }
    },
    { concurrency: 1 },
  );

  workers.push(worker);

  return worker;
}

// The jobs waiting for this probe: each test uses probes of its own.
async function waitingJobsOf(probeId: string): Promise<number> {
  const jobs: Array<QueueJob> = await queue.getJobs([
    "waiting",
    "prioritized",
    "delayed",
  ]);

  return jobs.filter((job: QueueJob): boolean => {
    const data: ProbeIngestJobData | undefined = (
      job.data as TelemetryIngestJobData
    ).probeIngest;

    return (
      data?.networkDevicePoll?.probeId === probeId ||
      data?.snmpTrapBatch?.probeId === probeId
    );
  }).length;
}

/*
 * Every add is a few Redis round trips; on a loaded machine fifty of them
 * and the worker's turn can take longer than Jest's default 30 seconds.
 */
jest.setTimeout(120_000);

beforeAll(async () => {
  await Redis.connect();
  queue = Queue.getQueue(QueueName.Telemetry);
  await queue.waitUntilReady();
});

afterAll(async () => {
  await Promise.all(
    workers.map((worker: BullWorker) => {
      return worker.close();
    }),
  );

  if (queue) {
    await queue.obliterate({ force: true });
    await queue.close();
  }

  const client: ClientType | null = Redis.getClient();

  if (client && keysToRemove.length > 0) {
    await client.del(...Array.from(new Set(keysToRemove)));
  }

  await Redis.disconnect();
});

beforeEach(() => {
  processedPolls = [];
  processedTraps = [];
  held = new Map();

  processWalk.mockImplementation(async (data: ProbeIngestJobData) => {
    const body: JSONObject = data.networkDeviceWalk!;
    const name: string = `${String(body["networkDeviceId"])}:${String(body["sequence"])}`;
    processedPolls.push(name);
    await held.get(name);
  });

  processTrap.mockImplementation(async (data: ProbeIngestJobData) => {
    const body: JSONObject = data.snmpTrap!["snmpTrap"] as JSONObject;
    processedTraps.push(String(body["trapOid"]));
  });
});

afterEach(async () => {
  await Promise.all(
    workers.splice(0).map((worker: BullWorker) => {
      return worker.close();
    }),
  );
  await queue.drain(true);
});

describe("device polls on Redis and BullMQ", () => {
  test("20 polls of one device while no worker runs: one job waits, and the newest poll is processed, once", async () => {
    const probeId: string = ObjectID.generate().toString();
    const deviceId: string = ObjectID.generate().toString();

    for (let sequence: number = 1; sequence <= 20; sequence++) {
      await poll({ probeId, deviceId, sequence });
    }

    expect(await waitingJobsOf(probeId)).toBe(1);

    startWorker();
    await waitFor("the poll to be processed", () => {
      return processedPolls.length >= 1;
    });
    await sleep(300);

    expect(processedPolls).toEqual([`${deviceId}:20`]);
    // Processed and cleared: nothing left for a later job.
    expect(
      await NetworkDevicePollLatestStore.getLatest(probeId, deviceId),
    ).toBeNull();
  });

  test("polls of ten devices make ten jobs, and each device's newest is processed", async () => {
    const probeId: string = ObjectID.generate().toString();
    const devices: Array<string> = Array.from({ length: 10 }, () => {
      return ObjectID.generate().toString();
    });

    for (let sequence: number = 1; sequence <= 5; sequence++) {
      for (const deviceId of devices) {
        await poll({ probeId, deviceId, sequence });
      }
    }

    expect(await waitingJobsOf(probeId)).toBe(10);

    startWorker();
    await waitFor("every device's poll", () => {
      return processedPolls.length >= 10;
    });
    await sleep(300);

    expect(processedPolls.sort()).toEqual(
      devices
        .map((deviceId: string) => {
          return `${deviceId}:5`;
        })
        .sort(),
    );
  });

  test("a poll that arrives while the device's poll is processed is processed after it - the newest of them", async () => {
    const probeId: string = ObjectID.generate().toString();
    const deviceId: string = ObjectID.generate().toString();
    const release: () => void = hold(deviceId, 1);

    await poll({ probeId, deviceId, sequence: 1 });
    startWorker();
    await waitFor("poll 1 to start", () => {
      return processedPolls.includes(`${deviceId}:1`);
    });

    await poll({ probeId, deviceId, sequence: 2 });
    await poll({ probeId, deviceId, sequence: 3 });

    release();
    await waitFor("poll 3", () => {
      return processedPolls.includes(`${deviceId}:3`);
    });
    await sleep(300);

    expect(processedPolls).toEqual([`${deviceId}:1`, `${deviceId}:3`]);
  });

  test("a probe reporting a device it does not poll cannot replace the polls of the probe that does", async () => {
    const ownProbe: string = ObjectID.generate().toString();
    const otherProbe: string = ObjectID.generate().toString();
    const deviceId: string = ObjectID.generate().toString();

    await poll({ probeId: ownProbe, deviceId, sequence: 1 });
    await poll({ probeId: otherProbe, deviceId, sequence: 2 });

    expect(await waitingJobsOf(ownProbe)).toBe(1);
    expect(await waitingJobsOf(otherProbe)).toBe(1);

    startWorker();
    await waitFor("both polls", () => {
      return processedPolls.length >= 2;
    });

    expect(processedPolls.sort()).toEqual(
      [`${deviceId}:1`, `${deviceId}:2`].sort(),
    );
  });
});

describe("SNMP traps on Redis and BullMQ", () => {
  test("30 traps from one sender while no worker runs: one job waits, and every trap is processed, in order", async () => {
    const probeId: ObjectID = ObjectID.generate();

    for (let sequence: number = 1; sequence <= 30; sequence++) {
      await trap({ probeId, source: "10.9.0.1", sequence });
    }

    expect(await waitingJobsOf(probeId.toString())).toBe(1);

    startWorker();
    await waitFor("every trap", () => {
      return processedTraps.length >= 30;
    });

    expect(processedTraps).toEqual(
      Array.from({ length: 30 }, (_value: unknown, index: number) => {
        return `1.3.6.1.6.3.1.1.5.${index + 1}`;
      }),
    );
  });

  test("traps from two senders make two jobs", async () => {
    const probeId: ObjectID = ObjectID.generate();

    for (let sequence: number = 1; sequence <= 3; sequence++) {
      await trap({ probeId, source: "10.9.0.2", sequence });
      await trap({ probeId, source: "10.9.0.3", sequence });
    }

    expect(await waitingJobsOf(probeId.toString())).toBe(2);

    startWorker();
    await waitFor("every trap", () => {
      return processedTraps.length >= 6;
    });
  });

  test("traps that arrive while the sender's job runs are processed after it, none lost, in order", async () => {
    const probeId: ObjectID = ObjectID.generate();
    let releaseFirst: () => void = (): void => {};
    const first: Promise<void> = new Promise<void>((resolve: () => void) => {
      releaseFirst = resolve;
    });

    processTrap.mockImplementation(async (data: ProbeIngestJobData) => {
      const body: JSONObject = data.snmpTrap!["snmpTrap"] as JSONObject;
      processedTraps.push(String(body["trapOid"]));

      if (processedTraps.length === 1) {
        await first;
      }
    });

    await trap({ probeId, source: "10.9.0.4", sequence: 1 });
    startWorker();
    await waitFor("trap 1 to start", () => {
      return processedTraps.length === 1;
    });

    for (let sequence: number = 2; sequence <= 10; sequence++) {
      await trap({ probeId, source: "10.9.0.4", sequence });
    }

    releaseFirst();
    await waitFor("every trap", () => {
      return processedTraps.length >= 10;
    });
    await sleep(300);

    expect(processedTraps).toEqual(
      Array.from({ length: 10 }, (_value: unknown, index: number) => {
        return `1.3.6.1.6.3.1.1.5.${index + 1}`;
      }),
    );
  });
});
