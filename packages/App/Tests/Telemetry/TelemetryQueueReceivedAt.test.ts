import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import Queue from "Common/Server/Infrastructure/Queue";

/*
 * WHEN THE INGEST API RECEIVED IT (dataReceivedAt, issue #6647).
 *
 * The ingest routes for what a monitor evaluates - a probe's check result,
 * a trap, a network device poll, an inbound email, a server agent's report
 * - read the clock as the request reaches them and hand that moment to the
 * queue (receivedAt). It travels in the job as the payload's
 * ingestionTimestamp, which the worker puts on the data it evaluates: a
 * page the evaluation starts is timed from it, however long the job waited.
 *
 * A caller that does not say (a job queued as before) gets the moment it
 * was queued, as it always did. The job's own ingestionTimestamp - when it
 * was queued - stays that, whatever the receipt.
 *
 * The Queue module pulls in BullMQ at import time; only "what is enqueued"
 * is under test, so it is replaced wholesale.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Telemetry: "Telemetry",
    },
  };
});

// A device's poll is stored as its newest before its job is queued.
jest.mock(
  "../../FeatureSet/Telemetry/Utils/NetworkDevicePollLatestStore",
  () => {
    return {
      __esModule: true,
      default: {
        store: jest.fn(),
      },
    };
  },
);

jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: {
      storeBody: jest.fn(),
      readBody: jest.fn(),
      deleteBody: jest.fn(),
    },
  };
});

import TelemetryQueueService, {
  TelemetryIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";

const addJobMock: jest.Mock = Queue.addJob as unknown as jest.Mock;

const RECEIVED_AT: Date = new Date("2026-11-10T09:29:20.000Z");
const QUEUED_AT: Date = new Date("2026-11-10T09:29:20.250Z");

const PROBE_ID: ObjectID = new ObjectID("6647aaaa-0000-4000-8000-000000000001");
const SECRET: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";

interface QueuedKind {
  name: string;
  // Queues one, with `receivedAt` when it is given.
  add: (receivedAt: Date | undefined) => Promise<void>;
  // The payload the worker reads the receipt from.
  payloadOf: (job: TelemetryIngestJobData) => JSONObject;
}

const KINDS: Array<QueuedKind> = [
  {
    name: "a probe's check result",
    add: (receivedAt: Date | undefined): Promise<void> => {
      return TelemetryQueueService.addProbeIngestJob({
        probeId: PROBE_ID,
        probeMonitorResponse: { isOnline: true },
        jobType: "probe-response",
        receivedAt: receivedAt,
      });
    },
    payloadOf: (job: TelemetryIngestJobData): JSONObject => {
      return job.probeIngest as unknown as JSONObject;
    },
  },
  {
    name: "a trap a probe received",
    add: (receivedAt: Date | undefined): Promise<void> => {
      return TelemetryQueueService.addSnmpTrapIngestJob({
        probeId: PROBE_ID,
        snmpTrap: { trapOid: "1.3.6.1.6.3.1.1.5.3" },
        receivedAt: receivedAt,
      });
    },
    payloadOf: (job: TelemetryIngestJobData): JSONObject => {
      return job.probeIngest as unknown as JSONObject;
    },
  },
  {
    name: "a network device poll",
    add: (receivedAt: Date | undefined): Promise<void> => {
      return TelemetryQueueService.addNetworkDeviceWalkJob({
        walkRequestBody: {
          probeId: PROBE_ID.toString(),
          networkDeviceId: "6647aaaa-0000-4000-8000-000000000002",
          isOnline: true,
        },
        receivedAt: receivedAt,
      });
    },
    payloadOf: (job: TelemetryIngestJobData): JSONObject => {
      return job.probeIngest as unknown as JSONObject;
    },
  },
  {
    name: "an inbound email",
    add: (receivedAt: Date | undefined): Promise<void> => {
      return TelemetryQueueService.addIncomingEmailJob({
        secretKey: SECRET,
        emailFrom: "alerts@acme.example",
        emailTo: `monitor-${SECRET}@inbound.oneuptime.example`,
        emailSubject: "Nightly backups failed",
        emailBody: "Backup failed.",
        receivedAt: receivedAt,
      });
    },
    payloadOf: (job: TelemetryIngestJobData): JSONObject => {
      return job.probeIngest as unknown as JSONObject;
    },
  },
  {
    name: "a server agent's report",
    add: (receivedAt: Date | undefined): Promise<void> => {
      return TelemetryQueueService.addServerMonitorIngestJob({
        secretKey: SECRET,
        serverMonitorResponse: { serverMonitorResponse: { hostname: "web" } },
        receivedAt: receivedAt,
      });
    },
    payloadOf: (job: TelemetryIngestJobData): JSONObject => {
      return job.serverMonitorIngest as unknown as JSONObject;
    },
  },
];

function enqueued(): TelemetryIngestJobData {
  expect(addJobMock).toHaveBeenCalledTimes(1);
  return addJobMock.mock.calls[0]![3] as TelemetryIngestJobData;
}

let clock: SpyInstance<typeof OneUptimeDate.getCurrentDate>;

beforeEach(() => {
  jest.clearAllMocks();
  addJobMock.mockResolvedValue(undefined as never);

  clock = jest
    .spyOn(OneUptimeDate, "getCurrentDate")
    .mockImplementation((): Date => {
      return new Date(QUEUED_AT.getTime());
    });
});

afterEach(() => {
  clock.mockRestore();
});

describe.each(KINDS)("$name, queued", (kind: QueuedKind) => {
  test("carries the moment the ingest API received it, for the worker", async () => {
    await kind.add(RECEIVED_AT);

    const job: TelemetryIngestJobData = enqueued();

    expect(kind.payloadOf(job)["ingestionTimestamp"]).toEqual(RECEIVED_AT);
    // The job's own moment is still when it was queued.
    expect(job.ingestionTimestamp).toEqual(QUEUED_AT);
  });

  test("read back from the queue, it is the same moment, as text", async () => {
    await kind.add(RECEIVED_AT);

    const readBack: TelemetryIngestJobData = JSON.parse(
      JSON.stringify(enqueued()),
    ) as TelemetryIngestJobData;

    expect(kind.payloadOf(readBack)["ingestionTimestamp"]).toBe(
      RECEIVED_AT.toISOString(),
    );
  });

  test("the receipt rides only there: nothing else of the job names it", async () => {
    await kind.add(RECEIVED_AT);

    expect(JSON.stringify(enqueued())).not.toContain('"receivedAt"');
  });

  test("a caller that does not say: the moment it was queued, as before", async () => {
    await kind.add(undefined);

    expect(kind.payloadOf(enqueued())["ingestionTimestamp"]).toEqual(QUEUED_AT);
  });
});
