import DeviceReachabilityUtil, {
  NetworkDeviceReachability,
} from "../../../Utils/NetworkDevice/DeviceReachabilityUtil";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import MonitorService from "../../../Server/Services/MonitorService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A monitor-backed NetworkDevice is judged on two surfaces by two rules:
 *
 *   - the pill (and the site rollup, the topology node, the Overview hero)
 *     reads the stamped MonitorStatus row through DeviceReachabilityUtil,
 *     which looks ONLY at `isOfflineState`;
 *   - the device list's summary tiles and Status facet count and filter in
 *     SQL over `isReachable`, which the server now stamps from the same
 *     monitor as `!isOfflineState`.
 *
 * Two rules over the same fact can only stay honest if they are the same
 * rule. MonitorStatus is a ladder, not a pair — a "Degraded" row is neither
 * operational nor offline — so the rung where they could most easily
 * diverge is the middle one: read the operational flag on one side and the
 * offline flag on the other and a degraded-but-reachable device is green in
 * the pill and red in the tiles. What is pinned here is that, for every
 * rung and for "no status yet", the boolean the server writes into
 * `isReachable` is exactly the verdict the pill renders.
 */

interface LadderRung {
  name: string;
  isOperationalState: boolean;
  isOfflineState: boolean;
}

// The three rungs a MonitorStatus row can occupy, as the model flags them.
const LADDER: Array<LadderRung> = [
  { name: "Operational", isOperationalState: true, isOfflineState: false },
  { name: "Degraded", isOperationalState: false, isOfflineState: false },
  { name: "Offline", isOperationalState: false, isOfflineState: true },
];

function pillVerdict(
  monitorStatusIsOffline: boolean | undefined,
): NetworkDeviceReachability {
  return DeviceReachabilityUtil.getStatus({
    monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
    monitorStatusIsOffline: monitorStatusIsOffline,
  });
}

describe("the pill's rule for a monitor-backed device", () => {
  test.each(LADDER)(
    "$name: reachable exactly when the row is not offline",
    (rung: LadderRung) => {
      const isUp: boolean =
        pillVerdict(rung.isOfflineState) === NetworkDeviceReachability.Up;

      expect(isUp).toBe(!rung.isOfflineState);
    },
  );

  /*
   * The rung that tells the two flags apart. Its operational flag is false,
   * and if either side read that flag this device would be Down there.
   */
  test("Degraded is Up, so the operational flag is not what decides", () => {
    const degraded: LadderRung = LADDER.find((rung: LadderRung) => {
      return rung.name === "Degraded";
    })!;

    expect(degraded.isOperationalState).toBe(false);
    expect(pillVerdict(degraded.isOfflineState)).toBe(
      NetworkDeviceReachability.Up,
    );
  });

  test("Offline is Down", () => {
    expect(pillVerdict(true)).toBe(NetworkDeviceReachability.Down);
  });

  /*
   * No status yet — nothing bound, or bound and never evaluated — is a real
   * Pending, and the server stamps NULL for it, which is what the tiles
   * count as Pending too.
   */
  test("no status at all is Pending", () => {
    expect(pillVerdict(undefined)).toBe(NetworkDeviceReachability.Pending);
    expect(pillVerdict(null as unknown as undefined)).toBe(
      NetworkDeviceReachability.Pending,
    );
  });
});

/*
 * The same ladder through the server. refreshStampedMonitorStatus is what
 * writes `isReachable` for a monitor-backed device; drive it with a monitor
 * on each rung and check the boolean it writes against the pill's verdict
 * for that rung. The seams are the three it touches: read the device, read
 * the monitor, write the columns.
 */
describe("the value the server stamps into isReachable", () => {
  const DEVICE_ID: ObjectID = new ObjectID(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  const PROJECT_ID: ObjectID = new ObjectID(
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  );
  const MONITOR_ID: ObjectID = new ObjectID(
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function stampedIsReachable(
    monitor: Monitor | null,
  ): Promise<boolean | null | undefined> {
    jest.spyOn(NetworkDeviceService, "findOneById").mockResolvedValue({
      id: DEVICE_ID,
      _id: DEVICE_ID.toString(),
      projectId: PROJECT_ID,
      monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
      monitorId: MONITOR_ID,
      // A stale value on every column, so the write is never skipped.
      currentMonitorStatusId: ObjectID.generate(),
      isReachable: undefined,
    } as unknown as NetworkDevice);
    jest.spyOn(MonitorService, "findOneBy").mockResolvedValue(monitor);
    jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);

    const update: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);

    await NetworkDeviceService.refreshStampedMonitorStatus({
      deviceId: DEVICE_ID,
      clearWhenNotMonitorBacked: false,
    });

    expect(update).toHaveBeenCalledTimes(1);

    return (
      update.mock.calls[0]![0].data as unknown as {
        isReachable: boolean | null | undefined;
      }
    ).isReachable;
  }

  test.each(LADDER)(
    "$name: equals the pill's verdict",
    async (rung: LadderRung) => {
      const stamped: boolean | null | undefined = await stampedIsReachable({
        id: MONITOR_ID,
        _id: MONITOR_ID.toString(),
        currentMonitorStatusId: ObjectID.generate(),
        currentMonitorStatus: {
          isOperationalState: rung.isOperationalState,
          isOfflineState: rung.isOfflineState,
        },
      } as unknown as Monitor);

      expect(stamped).toBe(
        pillVerdict(rung.isOfflineState) === NetworkDeviceReachability.Up,
      );
    },
  );

  test("no status: NULL, which is the pill's Pending", async () => {
    const stamped: boolean | null | undefined = await stampedIsReachable({
      id: MONITOR_ID,
      _id: MONITOR_ID.toString(),
      currentMonitorStatusId: undefined,
    } as unknown as Monitor);

    expect(stamped).toBeNull();
    expect(pillVerdict(undefined)).toBe(NetworkDeviceReachability.Pending);
  });
});
