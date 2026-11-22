import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A SCHEDULED RUN IS NOBODY'S RUN AGAIN (OneUptime issue #10334).
 *
 * A scan keeps who asked for the run on its row with Run Again
 * (runRequestedAt, runRequestedByUserId), and the scans list names them. The
 * requeue worker queues a recurring scan's next run by itself, so the run it
 * queues is not that person's: it clears both in the write that queues it,
 * and the row stops naming them. Everything else the requeue writes is as it
 * was - the scan is reset to a fresh Pending, its hosts kept until the new
 * run reports - and the schedule columns are not touched.
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
      getRepository: jest.fn(),
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

type MockedScanService = {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
};

const scanService: MockedScanService =
  NetworkDeviceDiscoveryScanService as unknown as MockedScanService;

const SCAN_ID: ObjectID = new ObjectID("10334000-0000-4000-8000-0000000000d1");

async function runTick(): Promise<void> {
  const handler: CronHandler | undefined =
    mockCapturedJobs["NetworkDeviceDiscovery:RequeueRecurringScans"];

  if (!handler) {
    throw new Error(
      "NetworkDeviceDiscovery:RequeueRecurringScans did not register a cron handler.",
    );
  }

  await handler();
}

beforeEach(() => {
  jest.clearAllMocks();

  const due: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
    SCAN_ID,
  );
  due.name = "Core switches";
  due.cidr = "10.0.0.0/24";

  /*
   * The tick's three reads, in order: scans stranded In Progress (none),
   * recurring scans whose next run is due (this one), and scans nobody has
   * claimed (none).
   */
  scanService.findAllBy
    .mockResolvedValueOnce([] as never)
    .mockResolvedValueOnce([due] as never)
    .mockResolvedValue([] as never);
  scanService.updateOneById.mockResolvedValue(undefined as never);
});

describe("the requeue worker, on a recurring scan someone ran again last", () => {
  test("queues the scheduled run, and clears who asked for the one before", async () => {
    await runTick();

    expect(scanService.updateOneById).toHaveBeenCalledTimes(1);

    const write: { id: ObjectID; data: JSONObject; props: JSONObject } = scanService
      .updateOneById.mock.calls[0]![0] as {
      id: ObjectID;
      data: JSONObject;
      props: JSONObject;
    };

    expect(write.id.toString()).toBe(SCAN_ID.toString());
    expect(write.data).toEqual({
      status: "Pending",
      statusMessage: null,
      startedAt: null,
      completedAt: null,
      nextScanAt: null,
      runRequestedAt: null,
      runRequestedByUserId: null,
    });
    expect(write.props).toEqual({ isRoot: true });
  });

  test("keeps the previous hosts and the schedule: neither is in the write", async () => {
    await runTick();

    const data: JSONObject = (
      scanService.updateOneById.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    for (const kept of [
      "discoveredDevices",
      "scannedHostCount",
      "respondedHostCount",
      "isRecurring",
      "rescanIntervalInMinutes",
    ]) {
      expect(Object.keys(data)).not.toContain(kept);
    }
  });
});
