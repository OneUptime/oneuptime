import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import ProbeService from "Common/Server/Services/ProbeService";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { UNCLAIMED_PENDING_MINUTES } from "Common/Utils/NetworkDiscovery/UnclaimedScanDiagnosis";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock(
  "../../../../FeatureSet/Workers/Utils/Cron",
  (): { __esModule: boolean; default: ReturnType<typeof jest.fn> } => {
    return {
      __esModule: true,
      default: jest.fn(),
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

import { explainUnclaimedScans } from "../../../../FeatureSet/Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans";

/*
 * The pass that gives a stuck discovery scan something to say.
 *
 * The two older passes in this job rescue scans a probe TOOK and abandoned.
 * Neither can see the opposite failure — a scan no probe ever took — because
 * only the claim endpoint moves a row off "Pending" and there is nothing for a
 * reaper to time out. OneUptime issue #3287 is that gap: four scans submitted
 * over an hour, every one of them "Pending" indefinitely, an em-dash where the
 * result goes, and no timestamp, probe state or message anywhere in the
 * product to explain it.
 *
 * These tests pin the two things that make this pass safe to run every minute:
 * it must not mistake a legitimately QUEUED scan for a stuck one, and it must
 * not rewrite the same sentence forever.
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

const probeId: ObjectID = ObjectID.generate();
const otherProbeId: ObjectID = ObjectID.generate();

function makeScan(overrides?: Partial<JSONObject>): NetworkDeviceDiscoveryScan {
  return {
    id: ObjectID.generate(),
    cidr: "10.240-249.0-254.220-226",
    probeId: probeId,
    statusMessage: null,
    ...overrides,
  } as unknown as NetworkDeviceDiscoveryScan;
}

function makeProbe(overrides?: Partial<JSONObject>): Probe {
  return {
    id: probeId,
    name: "Datacentre Probe",
    connectionStatus: ProbeConnectionStatus.Disconnected,
    lastAlive: OneUptimeDate.getSomeHoursAgo(6),
    ...overrides,
  } as unknown as Probe;
}

/*
 * The job asks for unclaimed scans first, then for whatever is In Progress.
 * Driving both off the query's status keeps the tests readable and means a
 * reordering of the two calls does not silently invert them.
 */
function respondWith(data: {
  unclaimed: Array<NetworkDeviceDiscoveryScan>;
  inProgress?: Array<NetworkDeviceDiscoveryScan> | undefined;
}): void {
  scanService.findAllBy.mockImplementation((args: unknown) => {
    const query: JSONObject = (args as JSONObject)["query"] as JSONObject;

    if (query["status"] === "In Progress") {
      return Promise.resolve(data.inProgress || []);
    }

    return Promise.resolve(data.unclaimed);
  });
}

function updateCalls(): Array<{ id: ObjectID; data: JSONObject }> {
  return scanService.updateOneById.mock.calls.map((call: Array<unknown>) => {
    const arg: JSONObject = call[0] as JSONObject;
    return {
      id: arg["id"] as ObjectID,
      data: arg["data"] as JSONObject,
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  probeService.findOneById.mockResolvedValue(makeProbe() as never);
});

describe("explainUnclaimedScans — which scans it looks at", () => {
  test("asks only for Pending scans that have been sitting untouched", async () => {
    respondWith({ unclaimed: [] });

    await explainUnclaimedScans();

    const query: JSONObject = scanService.findAllBy.mock
      .calls[0]![0] as JSONObject;
    const scanQuery: JSONObject = query["query"] as JSONObject;

    expect(scanQuery["status"]).toBe("Pending");
    /*
     * updatedAt, not createdAt: a recurring scan the requeue pass just flipped
     * back to Pending has been Pending for seconds however old the row is.
     */
    expect(Object.keys(scanQuery)).toContain("updatedAt");
    expect(Object.keys(scanQuery)).not.toContain("createdAt");
  });

  test("does nothing at all when no scan has been waiting", async () => {
    respondWith({ unclaimed: [] });

    await explainUnclaimedScans();

    // No probe lookup, no write — the common case must be two cheap SELECTs.
    expect(probeService.findOneById).not.toHaveBeenCalled();
    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(scanService.findAllBy).toHaveBeenCalledTimes(1);
  });
});

describe("explainUnclaimedScans — a probe that is not connected", () => {
  test("writes the diagnosis onto the scan", async () => {
    const scan: NetworkDeviceDiscoveryScan = makeScan();
    respondWith({ unclaimed: [scan] });

    await explainUnclaimedScans();

    const calls: Array<{ id: ObjectID; data: JSONObject }> = updateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.id).toBe(scan.id);
    expect(String(calls[0]!.data["statusMessage"])).toContain(
      "Datacentre Probe",
    );
    expect(String(calls[0]!.data["statusMessage"])).toContain(
      "is not connected",
    );
  });

  /*
   * The scan stays runnable. Failing it would throw away work the operator
   * asked for, and for a recurring scan it would fight the requeue pass in the
   * same cron tick.
   */
  test("does NOT change the scan's status", async () => {
    respondWith({ unclaimed: [makeScan()] });

    await explainUnclaimedScans();

    const data: JSONObject = updateCalls()[0]!.data;
    expect(Object.keys(data)).toEqual(["statusMessage"]);
    expect(data["status"]).toBeUndefined();
  });

  test("writes as root — the worker has no user context", async () => {
    respondWith({ unclaimed: [makeScan()] });

    await explainUnclaimedScans();

    const props: JSONObject = scanService.updateOneById.mock
      .calls[0]![0] as JSONObject;
    expect((props["props"] as JSONObject)["isRoot"]).toBe(true);
  });

  test("a probe row that no longer exists is reported as not connected", async () => {
    probeService.findOneById.mockResolvedValue(null as never);
    respondWith({ unclaimed: [makeScan()] });

    await explainUnclaimedScans();

    expect(String(updateCalls()[0]!.data["statusMessage"])).toContain(
      "The assigned probe is not connected",
    );
  });
});

describe("explainUnclaimedScans — a probe that IS connected", () => {
  test("writes the other diagnosis, which names a different fix", async () => {
    probeService.findOneById.mockResolvedValue(
      makeProbe({
        connectionStatus: ProbeConnectionStatus.Connected,
      }) as never,
    );
    respondWith({ unclaimed: [makeScan()] });

    await explainUnclaimedScans();

    const message: string = String(updateCalls()[0]!.data["statusMessage"]);
    expect(message).toContain("is connected but has not picked this scan up");
    expect(message).toContain(`${UNCLAIMED_PENDING_MINUTES} minutes`);
  });
});

describe("explainUnclaimedScans — scans that are legitimately queued", () => {
  /*
   * The claim endpoint hands out one scan at a time per probe, and a sweep at
   * the size ceiling runs for the better part of an hour. Every other scan on
   * that probe is Pending for that whole time and is not stuck at all —
   * reporting those would turn normal queueing into an alarm.
   */
  test("skips a scan whose probe is mid-sweep", async () => {
    respondWith({
      unclaimed: [makeScan()],
      inProgress: [makeScan({ id: ObjectID.generate() })],
    });

    await explainUnclaimedScans();

    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(probeService.findOneById).not.toHaveBeenCalled();
  });

  test("a sweep on a DIFFERENT probe does not excuse this one", async () => {
    const stuck: NetworkDeviceDiscoveryScan = makeScan();

    respondWith({
      unclaimed: [stuck],
      inProgress: [
        makeScan({ id: ObjectID.generate(), probeId: otherProbeId }),
      ],
    });

    await explainUnclaimedScans();

    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0]!.id).toBe(stuck.id);
  });

  test("a scan with no probe at all is left alone rather than guessed about", async () => {
    respondWith({
      unclaimed: [makeScan({ probeId: undefined })],
    });

    await explainUnclaimedScans();

    expect(scanService.updateOneById).not.toHaveBeenCalled();
  });
});

describe("explainUnclaimedScans — it runs every minute, so it must not churn", () => {
  /*
   * A probe can stay offline for days. Re-writing the identical sentence would
   * be one UPDATE per scan per minute forever — and because the write bumps
   * updatedAt, it would also reset the very clock the query uses to decide
   * what counts as unclaimed.
   */
  test("does not rewrite a message that has not changed", async () => {
    const scan: NetworkDeviceDiscoveryScan = makeScan();
    respondWith({ unclaimed: [scan] });

    await explainUnclaimedScans();
    const written: string = String(updateCalls()[0]!.data["statusMessage"]);

    jest.clearAllMocks();
    probeService.findOneById.mockResolvedValue(makeProbe() as never);
    respondWith({
      unclaimed: [makeScan({ id: scan.id, statusMessage: written })],
    });

    await explainUnclaimedScans();

    expect(scanService.updateOneById).not.toHaveBeenCalled();
  });

  test("does rewrite when the probe's state changes underneath it", async () => {
    const scan: NetworkDeviceDiscoveryScan = makeScan();
    respondWith({ unclaimed: [scan] });

    await explainUnclaimedScans();
    const firstMessage: string = String(
      updateCalls()[0]!.data["statusMessage"],
    );

    jest.clearAllMocks();
    probeService.findOneById.mockResolvedValue(
      makeProbe({
        connectionStatus: ProbeConnectionStatus.Connected,
      }) as never,
    );
    respondWith({
      unclaimed: [makeScan({ id: scan.id, statusMessage: firstMessage })],
    });

    await explainUnclaimedScans();

    expect(scanService.updateOneById).toHaveBeenCalledTimes(1);
    expect(String(updateCalls()[0]!.data["statusMessage"])).not.toBe(
      firstMessage,
    );
  });

  /*
   * Several scans behind one dead probe is the common shape of this failure —
   * it is exactly what the issue's screenshot shows. One probe row is enough
   * for all of them.
   */
  test("looks the probe up once, however many of its scans are waiting", async () => {
    respondWith({
      unclaimed: [makeScan(), makeScan(), makeScan()],
    });

    await explainUnclaimedScans();

    expect(probeService.findOneById).toHaveBeenCalledTimes(1);
    expect(scanService.updateOneById).toHaveBeenCalledTimes(3);
  });

  test("but a second probe is looked up separately", async () => {
    probeService.findOneById.mockImplementation((args: unknown) => {
      const id: ObjectID = (args as JSONObject)["id"] as ObjectID;
      return Promise.resolve(
        makeProbe({
          id: id,
          name: id === probeId ? "Probe A" : "Probe B",
        }),
      );
    });

    respondWith({
      unclaimed: [makeScan(), makeScan({ probeId: otherProbeId })],
    });

    await explainUnclaimedScans();

    expect(probeService.findOneById).toHaveBeenCalledTimes(2);
    const messages: string = updateCalls()
      .map((call: { data: JSONObject }) => {
        return String(call.data["statusMessage"]);
      })
      .join("\n");
    expect(messages).toContain("Probe A");
    expect(messages).toContain("Probe B");
  });
});
