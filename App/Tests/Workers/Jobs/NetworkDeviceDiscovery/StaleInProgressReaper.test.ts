import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import ProbeService from "Common/Server/Services/ProbeService";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The job exports no handler for its main passes: it registers one at module
 * load. Capture it so a whole tick can be run without a BullMQ repeatable job.
 */
type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock(
  "../../../../FeatureSet/Workers/Utils/Cron",
  (): { __esModule: boolean; default: ReturnType<typeof jest.fn> } => {
    return {
      __esModule: true,
      default: jest.fn(
        (
          jobName: string,
          _options: unknown,
          runFunction: CronHandler,
        ): void => {
          mockCapturedJobs[jobName] = runFunction;
        },
      ) as unknown as ReturnType<typeof jest.fn>,
    };
  },
);

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

jest.mock("Common/Server/Services/NetworkDeviceDiscoveryScanService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProbeService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
    },
  };
});

// Imported for its side effect: the RunCron mock records the handler.
import "../../../../FeatureSet/Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans";

/*
 * The server's reaper for a scan stranded In Progress by a probe that died
 * mid-sweep.
 *
 * It exists because nothing else can rescue such a row: only a probe's result
 * moves a scan off In Progress, and a probe that crashed will never send one.
 * After two hours the scan is declared abandoned.
 *
 * What changed, and what these tests pin: a sweep now reports what it has
 * found every 30 seconds (OneUptime issue #3598), so "the probe has said
 * nothing" is finally distinguishable from "the probe has been busy". The
 * reaper asks for BOTH — a run that started long ago AND has gone quiet —
 * because keying on start time alone makes this a second, hidden deadline:
 * an operator who raises PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS for a range that
 * legitimately needs longer would have the server mark the scan Failed
 * underneath a probe that was still sweeping it, and the probe's eventual
 * result would land on a row already declared dead.
 */

type MockedScanService = {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
};

const scanService: MockedScanService =
  NetworkDeviceDiscoveryScanService as unknown as MockedScanService;
const probeService: { findOneById: jest.Mock } = ProbeService as unknown as {
  findOneById: jest.Mock;
};

async function runTick(): Promise<void> {
  const handler: CronHandler | undefined =
    mockCapturedJobs["NetworkDeviceDiscovery:RequeueRecurringScans"];

  if (!handler) {
    throw new Error(
      "NetworkDeviceDiscovery:RequeueRecurringScans did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();
}

// The query the reaper pass (the first findAllBy of the tick) issued.
function staleScanQuery(): JSONObject {
  return (scanService.findAllBy.mock.calls[0]![0] as JSONObject)[
    "query"
  ] as JSONObject;
}

/*
 * The cut-off a `QueryHelper.lessThan(date)` filter carries.
 *
 * QueryHelper builds a raw TypeORM FindOperator whose parameters hold the
 * value, so a date filter cannot be compared directly — and a test that only
 * checked "there is some filter" would pass for one pointed at the wrong
 * column or the wrong moment.
 */
function cutOffOf(filter: unknown): Date {
  const parameters: Record<string, Date> = (
    filter as { _objectLiteralParameters?: Record<string, Date> }
  )._objectLiteralParameters!;

  return Object.values(parameters)[0]!;
}

describe("NetworkDeviceDiscovery reaper — a scan stranded In Progress", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    scanService.findAllBy.mockResolvedValue([] as never);
    scanService.updateOneById.mockResolvedValue(undefined as never);
    probeService.findOneById.mockResolvedValue(null as never);
  });

  test("looks for scans that are In Progress", async () => {
    await runTick();

    expect(staleScanQuery()["status"]).toBe("In Progress");
  });

  /*
   * The change. A sweep touches its row every 30 seconds while it works, so a
   * probe that is demonstrably alive and demonstrably finding hosts keeps
   * `updatedAt` fresh — and a scan that is merely LONG is no longer reaped
   * out from under it.
   */
  test("requires the run to have gone quiet, not merely to have started long ago", async () => {
    await runTick();

    const query: JSONObject = staleScanQuery();

    expect(query["startedAt"]).toBeDefined();
    expect(query["updatedAt"]).toBeDefined();
  });

  test("uses the same two-hour window for both", async () => {
    await runTick();

    const query: JSONObject = staleScanQuery();
    const startedCutOff: Date = cutOffOf(query["startedAt"]);
    const updatedCutOff: Date = cutOffOf(query["updatedAt"]);

    /*
     * Both are "two hours ago", computed a microsecond apart in the same
     * statement. Comparing them to each other rather than to a frozen clock
     * keeps this about the WINDOW rather than about test timing.
     */
    expect(
      Math.abs(startedCutOff.getTime() - updatedCutOff.getTime()),
    ).toBeLessThan(1000);

    const twoHoursAgo: Date = OneUptimeDate.getSomeHoursAgo(2);
    expect(
      Math.abs(startedCutOff.getTime() - twoHoursAgo.getTime()),
    ).toBeLessThan(5000);
  });

  test("marks what it does find Failed, and makes a recurring scan due at once", async () => {
    const scanId: ObjectID = ObjectID.generate();

    scanService.findAllBy.mockImplementation(
      async (
        findBy: JSONObject,
      ): Promise<Array<NetworkDeviceDiscoveryScan>> => {
        const query: JSONObject = findBy["query"] as JSONObject;

        if (query["status"] === "In Progress") {
          return [
            {
              id: scanId,
              name: "Switch Discovery",
              cidr: "10.240.249.0-255",
            } as unknown as NetworkDeviceDiscoveryScan,
          ];
        }

        return [];
      },
    );

    await runTick();

    const update: JSONObject = scanService.updateOneById.mock
      .calls[0]![0] as JSONObject;
    const data: JSONObject = update["data"] as JSONObject;

    expect((update["id"] as ObjectID).toString()).toBe(scanId.toString());
    expect(data["status"]).toBe("Failed");
    expect(data["completedAt"]).toBeInstanceOf(Date);
    // Recurring scans become due immediately; ignored for one-shots.
    expect(data["nextScanAt"]).toBeInstanceOf(Date);
  });

  /*
   * The row keeps whatever the sweep had already uploaded, so the message must
   * not imply the scan found nothing — and must say what the reaper actually
   * observed, which is silence rather than merely elapsed time.
   */
  test("explains that the probe went silent, and that any hosts shown are real", async () => {
    scanService.findAllBy.mockImplementation(
      async (
        findBy: JSONObject,
      ): Promise<Array<NetworkDeviceDiscoveryScan>> => {
        const query: JSONObject = findBy["query"] as JSONObject;

        if (query["status"] === "In Progress") {
          return [
            {
              id: ObjectID.generate(),
              cidr: "10.0.0.0/24",
            } as unknown as NetworkDeviceDiscoveryScan,
          ];
        }

        return [];
      },
    );

    await runTick();

    const message: string = (
      (scanService.updateOneById.mock.calls[0]![0] as JSONObject)[
        "data"
      ] as JSONObject
    )["statusMessage"] as string;

    expect(message).toContain("not even progress");
    expect(message).toContain("already found and sent");
    // varchar(500): the row has to be able to hold it.
    expect(message.length).toBeLessThanOrEqual(500);
  });

  test("does not touch the results columns, so an abandoned run keeps its hosts", async () => {
    scanService.findAllBy.mockImplementation(
      async (
        findBy: JSONObject,
      ): Promise<Array<NetworkDeviceDiscoveryScan>> => {
        const query: JSONObject = findBy["query"] as JSONObject;

        if (query["status"] === "In Progress") {
          return [
            {
              id: ObjectID.generate(),
              cidr: "10.0.0.0/24",
            } as unknown as NetworkDeviceDiscoveryScan,
          ];
        }

        return [];
      },
    );

    await runTick();

    const data: JSONObject = (
      scanService.updateOneById.mock.calls[0]![0] as JSONObject
    )["data"] as JSONObject;

    expect(Object.keys(data)).not.toContain("discoveredDevices");
    expect(Object.keys(data)).not.toContain("respondedHostCount");
    expect(Object.keys(data)).not.toContain("scannedHostCount");
  });
});
