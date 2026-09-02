import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import NetworkSiteTypeService from "../../../Server/Services/NetworkSiteTypeService";
import NetworkSiteStatusTimelineService from "../../../Server/Services/NetworkSiteStatusTimelineService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkSiteMaintenanceSuppression from "../../../Server/Utils/NetworkSite/NetworkSiteMaintenanceSuppression";
import NetworkSiteHierarchyLock, {
  NETWORK_SITE_HIERARCHY_ROOT_SCOPE_ERROR_MESSAGE,
} from "../../../Server/Utils/NetworkSite/NetworkSiteHierarchyLock";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkSiteStatusTimeline from "../../../Models/DatabaseModels/NetworkSiteStatusTimeline";
import MonitorType from "../../../Types/Monitor/MonitorType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete, OnUpdate } from "../../../Server/Types/Database/Hooks";
import { FindOperator } from "typeorm";
import DeviceReachabilityUtil from "../../../Utils/NetworkDevice/DeviceReachabilityUtil";
import {
  DEVICE_HEALTH_GROUP_COLUMNS,
  DeviceHealthGroup,
} from "../../../Server/Utils/NetworkDevice/DeviceHealthAggregation";
import { AggregateColumn } from "../../../Server/Types/Database/AggregateBy";
import { describe, expect, it, afterEach, beforeEach } from "@jest/globals";

/*
 * NetworkSiteService only needs the type service's findOneById boundary.
 * Replacing that boundary keeps this focused unit suite from loading the
 * reciprocal NetworkSiteTypeService -> NetworkSiteService graph (and all of
 * its monitoring dependencies) before each isolated hierarchy scenario.
 */
jest.mock("../../../Server/Services/NetworkSiteTypeService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
    },
  };
});

afterEach(() => {
  jest.clearAllMocks();
});

/*
 * Contract under test - the persisted rollup engine and the hierarchy
 * maintenance around it:
 *
 *   - recomputeRollupForSite persists worst-of over the subtree's devices,
 *     closes the open NetworkSiteStatusTimeline row and opens a new one on a
 *     change, and only stamps lastRollupAt when nothing changed (or no
 *     device contributes),
 *   - onMonitorStatusChanged stamps the referenced devices and recomputes
 *     each affected site chain exactly once, and NEVER throws,
 *   - onBeforeUpdate rejects cycles (a site under itself or one of its own
 *     descendants) with BadDataException,
 *   - onUpdateSuccess rebases the entire subtree's materialized paths on a
 *     parent change.
 *
 * Everything below the service boundary is spied - no database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SITE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PARENT_SITE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ROOT_SITE_TYPE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const CHILD_SITE_TYPE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const ALTERNATE_ROOT_SITE_TYPE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const GRANDCHILD_SITE_TYPE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

function fakeSite(overrides: Record<string, unknown>): NetworkSite {
  return {
    id: SITE_ID,
    _id: SITE_ID.toString(),
    projectId: PROJECT_ID,
    ...overrides,
  } as unknown as NetworkSite;
}

function fakeNetworkSiteType(data: {
  id: ObjectID;
  parentNetworkSiteTypeId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
}): any {
  return {
    id: data.id,
    _id: data.id.toString(),
    projectId: data.projectId || PROJECT_ID,
    parentNetworkSiteTypeId: data.parentNetworkSiteTypeId,
  };
}

function mockNetworkSiteTypes(types: Array<any>): jest.SpyInstance {
  const typesById: Map<string, any> = new Map(
    types.map((type: any): [string, any] => {
      return [type.id.toString(), type];
    }),
  );

  return jest
    .spyOn(NetworkSiteTypeService, "findOneById")
    .mockImplementation((input: any) => {
      return Promise.resolve(typesById.get(input.id.toString()) || null);
    });
}

function fakeStatuses(): Array<MonitorStatus> {
  return [
    {
      id: OPERATIONAL_STATUS_ID,
      priority: 1,
      isOperationalState: true,
      isOfflineState: false,
    },
    {
      id: OFFLINE_STATUS_ID,
      priority: 3,
      isOperationalState: false,
      isOfflineState: true,
    },
  ] as unknown as Array<MonitorStatus>;
}

describe("NetworkSiteService.recomputeRollupForSite", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  interface RollupSpies {
    updateColumns: jest.SpyInstance;
    timelineUpdateBy: jest.SpyInstance;
    timelineCreate: jest.SpyInstance;
    deviceHealthGroups: jest.SpyInstance;
    descendantSiteIds: jest.SpyInstance;
    maintainedSiteIds: jest.SpyInstance;
  }

  /*
   * The rollup no longer reads device ROWS — it asks Postgres to bucket the
   * subtree by the facts the reachability rule reads, and classifies the
   * buckets. So a test still describes its scenario as devices (which is what
   * the scenario IS), and this turns them into the buckets the database would
   * have returned for exactly those devices.
   *
   * The staleness predicate is the one thing SQL evaluates rather than the
   * shared util, so it is computed here from that util's own window rather
   * than a hard-coded number — the same arrangement, for the same reason, as
   * Common/Tests/Server/Utils/NetworkDevice/DeviceHealthAggregation.test.ts.
   */
  function toHealthGroups(
    devices: Array<NetworkDevice>,
  ): Array<DeviceHealthGroup> {
    const now: number = Date.now();

    return devices.map((device: NetworkDevice): DeviceHealthGroup => {
      const contactTimes: Array<number> = [
        device.lastPolledAt,
        device.lastSeenAt,
      ]
        .filter((value: Date | undefined): value is Date => {
          return Boolean(value);
        })
        .map((value: Date): number => {
          return new Date(value).getTime();
        });

      const lastContactAt: number | null =
        contactTimes.length > 0 ? Math.max(...contactTimes) : null;

      const staleWindowInMinutes: number =
        DeviceReachabilityUtil.getStaleWindowInMinutes(
          device.pollingIntervalInMinutes,
        );

      return {
        siteId: null,
        monitorStatusId: device.currentMonitorStatusId?.toString() ?? null,
        monitoringMethod: device.monitoringMethod ?? null,
        isReachable:
          device.isReachable === undefined ? null : device.isReachable,
        hasBeenPolled: Boolean(device.lastPolledAt),
        hasBeenSeen: Boolean(device.lastSeenAt),
        /*
         * Guarded exactly as the SQL is: staleness is only computed for the
         * one branch of the reachability rule that can read it.
         */
        isStale:
          (device.isReachable === undefined || device.isReachable === null) &&
          Boolean(device.lastSeenAt) &&
          lastContactAt !== null &&
          lastContactAt < now - staleWindowInMinutes * 60 * 1000,
        hasDownInterfaces: (device.interfacesDown || 0) > 0,
        deviceCount: 1,
        interfacesDownTotal: device.interfacesDown || 0,
      };
    });
  }

  function setupRollup(data: {
    site: NetworkSite | null;
    devices: Array<NetworkDevice>;
    // Site ids an ongoing maintenance window is currently silencing.
    maintainedSiteIds?: Array<ObjectID> | undefined;
  }): RollupSpies {
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(data.site);
    const descendantSiteIds: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "getDescendantSiteIds")
      .mockResolvedValue([]);
    const deviceHealthGroups: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "getHealthGroupsForSites")
      .mockResolvedValue(toHealthGroups(data.devices));
    const maintainedSiteIds: jest.SpyInstance = jest
      .spyOn(
        NetworkSiteMaintenanceSuppression,
        "getSiteIdsUnderOngoingMaintenance",
      )
      .mockResolvedValue(
        new Set<string>(
          (data.maintainedSiteIds || []).map((id: ObjectID) => {
            return id.toString();
          }),
        ),
      );
    jest
      .spyOn(MonitorStatusService, "findBy")
      .mockResolvedValue(fakeStatuses());

    const updateColumns: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    const timelineUpdateBy: jest.SpyInstance = jest
      .spyOn(NetworkSiteStatusTimelineService, "updateBy")
      .mockResolvedValue(0 as never);
    const timelineCreate: jest.SpyInstance = jest
      .spyOn(NetworkSiteStatusTimelineService, "create")
      .mockResolvedValue({} as never);

    return {
      updateColumns,
      timelineUpdateBy,
      timelineCreate,
      deviceHealthGroups,
      descendantSiteIds,
      maintainedSiteIds,
    };
  }

  it("persists a changed status and rolls the timeline (close open row, open new)", async () => {
    const spies: RollupSpies = setupRollup({
      site: fakeSite({ currentMonitorStatusId: OPERATIONAL_STATUS_ID }),
      devices: [
        {
          id: DEVICE_ID,
          currentMonitorStatusId: OFFLINE_STATUS_ID,
        },
      ] as unknown as Array<NetworkDevice>,
    });

    await NetworkSiteService.recomputeRollupForSite(SITE_ID);

    expect(spies.updateColumns).toHaveBeenCalledTimes(1);
    const updateArgs: any = spies.updateColumns.mock.calls[0]![0];
    expect(updateArgs.id.toString()).toBe(SITE_ID.toString());
    expect(updateArgs.data.currentMonitorStatusId.toString()).toBe(
      OFFLINE_STATUS_ID.toString(),
    );
    expect(updateArgs.data.lastRollupAt).toBeInstanceOf(Date);

    // The open row is closed...
    expect(spies.timelineUpdateBy).toHaveBeenCalledTimes(1);
    const closeArgs: any = spies.timelineUpdateBy.mock.calls[0]![0];
    expect(closeArgs.query.siteId.toString()).toBe(SITE_ID.toString());
    expect(closeArgs.data.endsAt).toBeInstanceOf(Date);

    // ...and a new one opened with the new status.
    expect(spies.timelineCreate).toHaveBeenCalledTimes(1);
    const created: NetworkSiteStatusTimeline =
      spies.timelineCreate.mock.calls[0]![0].data;
    expect(created.siteId?.toString()).toBe(SITE_ID.toString());
    expect(created.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(created.monitorStatusId?.toString()).toBe(
      OFFLINE_STATUS_ID.toString(),
    );
    expect(created.startsAt).toBeInstanceOf(Date);
  });

  it("only stamps lastRollupAt when the status is unchanged", async () => {
    const spies: RollupSpies = setupRollup({
      site: fakeSite({ currentMonitorStatusId: OFFLINE_STATUS_ID }),
      devices: [
        {
          id: DEVICE_ID,
          currentMonitorStatusId: OFFLINE_STATUS_ID,
        },
      ] as unknown as Array<NetworkDevice>,
    });

    await NetworkSiteService.recomputeRollupForSite(SITE_ID);

    expect(spies.updateColumns).toHaveBeenCalledTimes(1);
    const updateArgs: any = spies.updateColumns.mock.calls[0]![0];
    expect(Object.keys(updateArgs.data)).toEqual(["lastRollupAt"]);
    expect(spies.timelineUpdateBy).not.toHaveBeenCalled();
    expect(spies.timelineCreate).not.toHaveBeenCalled();
  });

  it("an empty device subtree is a no-op on status (lastRollupAt only)", async () => {
    const spies: RollupSpies = setupRollup({
      site: fakeSite({ currentMonitorStatusId: OPERATIONAL_STATUS_ID }),
      devices: [],
    });

    await NetworkSiteService.recomputeRollupForSite(SITE_ID);

    const updateArgs: any = spies.updateColumns.mock.calls[0]![0];
    expect(Object.keys(updateArgs.data)).toEqual(["lastRollupAt"]);
    expect(spies.timelineUpdateBy).not.toHaveBeenCalled();
    expect(spies.timelineCreate).not.toHaveBeenCalled();
  });

  it("uses the SNMP fallback for devices without a stamped status", async () => {
    const spies: RollupSpies = setupRollup({
      site: fakeSite({ currentMonitorStatusId: OPERATIONAL_STATUS_ID }),
      devices: [
        {
          id: DEVICE_ID,
          // Unmonitored, and its last poll could not reach it.
          isReachable: false,
          lastPolledAt: new Date(Date.now() - 60 * 1000),
          lastSeenAt: new Date(Date.now() - 60 * 60 * 1000),
          pollingIntervalInMinutes: 5,
        },
      ] as unknown as Array<NetworkDevice>,
    });

    await NetworkSiteService.recomputeRollupForSite(SITE_ID);

    const updateArgs: any = spies.updateColumns.mock.calls[0]![0];
    expect(updateArgs.data.currentMonitorStatusId.toString()).toBe(
      OFFLINE_STATUS_ID.toString(),
    );
  });

  /*
   * Issue #3220 at the site card. A probe behind on a large fleet leaves
   * every device's last successful poll well outside the old fixed
   * 15-minute freshness window, and the site above them went red even
   * though each one had answered. The rollup asks about the last poll's
   * OUTCOME now, so it does not.
   */
  it("issue #3220: devices answering 21 minutes ago keep the site operational", async () => {
    const spies: RollupSpies = setupRollup({
      site: fakeSite({ currentMonitorStatusId: OFFLINE_STATUS_ID }),
      devices: [
        {
          id: DEVICE_ID,
          isReachable: true,
          lastPolledAt: new Date(Date.now() - 21 * 60 * 1000),
          lastSeenAt: new Date(Date.now() - 21 * 60 * 1000),
          pollingIntervalInMinutes: 5,
        },
      ] as unknown as Array<NetworkDevice>,
    });

    await NetworkSiteService.recomputeRollupForSite(SITE_ID);

    const updateArgs: any = spies.updateColumns.mock.calls[0]![0];
    expect(updateArgs.data.currentMonitorStatusId.toString()).toBe(
      OPERATIONAL_STATUS_ID.toString(),
    );
  });

  /*
   * The rollup reads four columns, and the hazard has moved from a `select`
   * to a GROUP BY: a fact the rule reads that the grouping does not is a fact
   * two devices can disagree on inside one bucket, and the bucket then gets
   * one verdict for both. A missing `isReachable` still compiles, still runs,
   * and still silently drops the whole subtree onto the legacy freshness path
   * — it just does it one layer down now.
   */
  it("groups by every column the reachability rule reads", async () => {
    const expressions: string = DEVICE_HEALTH_GROUP_COLUMNS.map(
      (column: AggregateColumn): string => {
        return column.expression;
      },
    ).join(" ");

    expect(expressions).toContain("isReachable");
    expect(expressions).toContain("lastPolledAt");
    expect(expressions).toContain("lastSeenAt");
    expect(expressions).toContain("pollingIntervalInMinutes");
    expect(expressions).toContain("currentMonitorStatusId");
  });

  /*
   * Every device in the subtree is classified against ONE instant, passed in
   * rather than read from the database's clock. Two devices measured against
   * two different "now"s can disagree about staleness by a whole polling
   * interval, and the rollup would then flip between runs with nothing
   * having changed.
   */
  it("classifies the whole subtree against one instant", async () => {
    const spies: RollupSpies = setupRollup({
      site: fakeSite({ currentMonitorStatusId: OPERATIONAL_STATUS_ID }),
      devices: [],
    });

    await NetworkSiteService.recomputeRollupForSite(SITE_ID);

    const args: any = spies.deviceHealthGroups.mock.calls[0]![0];
    expect(args.now).toBeInstanceOf(Date);
  });

  it("does nothing when the site does not exist", async () => {
    const spies: RollupSpies = setupRollup({ site: null, devices: [] });

    await NetworkSiteService.recomputeRollupForSite(SITE_ID);

    expect(spies.updateColumns).not.toHaveBeenCalled();
    expect(spies.timelineUpdateBy).not.toHaveBeenCalled();
    expect(spies.timelineCreate).not.toHaveBeenCalled();
  });

  /*
   * The bucketing query is scoped to the site's own project and to its own
   * subtree — one statement, not one per site, and never another tenant's
   * devices. (The archived-device filter lives inside
   * getHealthGroupsForSites and is pinned by
   * App/Tests/BaseAPI/NetworkSiteHierarchyDeviceRollup.test.ts.)
   */
  it("buckets the subtree's devices in one project-scoped call", async () => {
    const spies: RollupSpies = setupRollup({
      site: fakeSite({ currentMonitorStatusId: OPERATIONAL_STATUS_ID }),
      devices: [],
    });

    await NetworkSiteService.recomputeRollupForSite(SITE_ID);

    expect(spies.deviceHealthGroups).toHaveBeenCalledTimes(1);
    const groupArgs: any = spies.deviceHealthGroups.mock.calls[0]![0];
    expect(groupArgs.projectId.toString()).toBe(PROJECT_ID.toString());
    /*
     * The archived filter moved into getHealthGroupsForSites with the query.
     * Asserted there — NetworkDeviceService's own suite pins that the method
     * really does send `isArchived: false`.
     */
    expect(
      groupArgs.siteIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([SITE_ID.toString()]);
  });

  /*
   * Issue #3431. A rollup must not fail because the maintenance lookup did —
   * the util already degrades to "nothing suppressed", and this pins that
   * the engine treats that as an ordinary answer rather than a reason to
   * skip the run.
   */
  it("rolls up normally when nothing is under maintenance", async () => {
    const spies: RollupSpies = setupRollup({
      site: fakeSite({ currentMonitorStatusId: OPERATIONAL_STATUS_ID }),
      devices: [
        {
          id: DEVICE_ID,
          currentMonitorStatusId: OFFLINE_STATUS_ID,
        },
      ] as unknown as Array<NetworkDevice>,
      maintainedSiteIds: [],
    });

    await NetworkSiteService.recomputeRollupForSite(SITE_ID);

    expect(spies.maintainedSiteIds).toHaveBeenCalledTimes(1);
    const updateArgs: any = spies.updateColumns.mock.calls[0]![0];
    expect(updateArgs.data.currentMonitorStatusId.toString()).toBe(
      OFFLINE_STATUS_ID.toString(),
    );
  });

  it("scopes the descendant lookup to the site's own project", async () => {
    const spies: RollupSpies = setupRollup({
      site: fakeSite({ currentMonitorStatusId: OPERATIONAL_STATUS_ID }),
      devices: [],
    });

    await NetworkSiteService.recomputeRollupForSite(SITE_ID);

    expect(spies.descendantSiteIds).toHaveBeenCalledTimes(1);
    const [calledSiteId, calledProjectId]: Array<any> =
      spies.descendantSiteIds.mock.calls[0]!;
    expect(calledSiteId.toString()).toBe(SITE_ID.toString());
    expect(calledProjectId.toString()).toBe(PROJECT_ID.toString());
  });
});

describe("NetworkSiteService.getDescendantSiteIds", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The prefix query must carry projectId (otherwise it reads every tenant's
   * rows) and must not go through QueryHelper.startsWith, whose
   * `CAST(alias AS TEXT) ILIKE` form makes the materializedPath btree index
   * unusable and forces a sequential scan on the hot rollup path.
   */
  it("scopes the prefix query to the project and emits an indexable LIKE", async () => {
    const childId: ObjectID = new ObjectID(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );
    const path: string = `/${SITE_ID.toString()}/`;

    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockResolvedValue(path);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([
        fakeSite({ materializedPath: path }),
        fakeSite({
          id: childId,
          _id: childId.toString(),
          materializedPath: `${path}${childId.toString()}/`,
        }),
      ]);

    const descendants: Array<ObjectID> =
      await NetworkSiteService.getDescendantSiteIds(SITE_ID, PROJECT_ID);

    // The site itself is excluded.
    expect(
      descendants.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([childId.toString()]);

    const query: any = findBySpy.mock.calls[0]![0].query;
    expect(query.projectId.toString()).toBe(PROJECT_ID.toString());

    const pathPredicate: FindOperator<any> = query.materializedPath;
    const boundParameters: Record<string, unknown> =
      pathPredicate.objectLiteralParameters as Record<string, unknown>;
    expect(pathPredicate.getSql!("site.materializedPath")).toBe(
      `(site.materializedPath LIKE :${Object.keys(boundParameters)[0]})`,
    );
    expect(Object.values(boundParameters)[0]).toBe(`${path}%`);
  });

  it("returns [] when the site has no path", async () => {
    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockResolvedValue(null);
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "findBy",
    );

    expect(
      await NetworkSiteService.getDescendantSiteIds(SITE_ID, PROJECT_ID),
    ).toEqual([]);
    expect(findBySpy).not.toHaveBeenCalled();
  });
});

describe("NetworkSiteService.recomputeRollupForSiteAndAncestors", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("recomputes the site first, then each ancestor nearest-first", async () => {
    const rootId: ObjectID = new ObjectID(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    const recomputeSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSite")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(NetworkSiteService, "getAncestorIds")
      .mockResolvedValue([rootId, PARENT_SITE_ID]); // root-first

    await NetworkSiteService.recomputeRollupForSiteAndAncestors(SITE_ID);

    const calledWith: Array<string> = recomputeSpy.mock.calls.map(
      (call: Array<any>) => {
        return call[0].toString();
      },
    );
    expect(calledWith).toEqual([
      SITE_ID.toString(),
      PARENT_SITE_ID.toString(),
      rootId.toString(),
    ]);
  });
});

describe("NetworkSiteService.getAncestorIds", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("parses ancestors (excluding the site itself) from the materialized path", async () => {
    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockResolvedValue(
        `/${PARENT_SITE_ID.toString()}/${SITE_ID.toString()}/`,
      );

    const ancestors: Array<ObjectID> =
      await NetworkSiteService.getAncestorIds(SITE_ID);

    expect(
      ancestors.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([PARENT_SITE_ID.toString()]);
  });

  it("returns [] when the site has no path", async () => {
    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockResolvedValue(null);

    expect(await NetworkSiteService.getAncestorIds(SITE_ID)).toEqual([]);
  });
});

describe("NetworkSiteService.onBeforeUpdate (cycle rejection)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeUpdateBy(parentSiteId: ObjectID | null): UpdateBy<NetworkSite> {
    return {
      query: { _id: SITE_ID.toString() },
      data: { parentSiteId: parentSiteId },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkSite>;
  }

  it("rejects moving a site under one of its own descendants", async () => {
    const childId: ObjectID = new ObjectID(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );

    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([
        fakeSite({ materializedPath: `/${SITE_ID.toString()}/` }),
      ]);
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
      fakeSite({
        id: childId,
        _id: childId.toString(),
      }),
    );
    // The proposed parent's path contains the site being moved -> cycle.
    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockResolvedValue(`/${SITE_ID.toString()}/${childId.toString()}/`);

    await expect(
      (NetworkSiteService as any).onBeforeUpdate(makeUpdateBy(childId)),
    ).rejects.toThrow(BadDataException);
  });

  it("rejects a site becoming its own parent", async () => {
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([
        fakeSite({ materializedPath: `/${SITE_ID.toString()}/` }),
      ]);
    jest
      .spyOn(NetworkSiteService, "findOneById")
      .mockResolvedValue(fakeSite({}));

    await expect(
      (NetworkSiteService as any).onBeforeUpdate(makeUpdateBy(SITE_ID)),
    ).rejects.toThrow(BadDataException);
  });

  it("rejects a missing parent", async () => {
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([fakeSite({})]);
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(null);

    await expect(
      (NetworkSiteService as any).onBeforeUpdate(makeUpdateBy(PARENT_SITE_ID)),
    ).rejects.toThrow(BadDataException);
  });

  it("allows a legal move and carries the previous state forward", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({
        id: CHILD_SITE_TYPE_ID,
        parentNetworkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    ]);
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([
      fakeSite({
        materializedPath: `/${SITE_ID.toString()}/`,
        networkSiteTypeId: CHILD_SITE_TYPE_ID,
      }),
    ]);
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
        networkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    );
    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockResolvedValue(`/${PARENT_SITE_ID.toString()}/`);

    const result: OnUpdate<NetworkSite> = await (
      NetworkSiteService as any
    ).onBeforeUpdate(makeUpdateBy(PARENT_SITE_ID));

    expect(result.carryForward.newParentPath).toBe(
      `/${PARENT_SITE_ID.toString()}/`,
    );
    expect(result.carryForward.previousItems).toHaveLength(1);
  });

  it("moving to root (parentSiteId null) skips parent validation", async () => {
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([
        fakeSite({ materializedPath: `/x/${SITE_ID.toString()}/` }),
      ]);
    const findOneByIdSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "findOneById",
    );

    const result: OnUpdate<NetworkSite> = await (
      NetworkSiteService as any
    ).onBeforeUpdate(makeUpdateBy(null));

    expect(result.carryForward.newParentPath).toBeNull();
    expect(findOneByIdSpy).not.toHaveBeenCalled();
  });

  /*
   * The dashboard's site form posts the `parentSite` RELATION, not the
   * `parentSiteId` column. A hook that watched only the column let a
   * re-parent done from the UI skip cycle detection, the same-project guard
   * and the subtree path rebase entirely - see RelationIdUtil.
   */
  it("rejects a cycle introduced through the `parentSite` relation key", async () => {
    const childId: ObjectID = new ObjectID(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );

    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([
        fakeSite({ materializedPath: `/${SITE_ID.toString()}/` }),
      ]);
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
      fakeSite({
        id: childId,
        _id: childId.toString(),
      }),
    );
    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockResolvedValue(`/${SITE_ID.toString()}/${childId.toString()}/`);

    await expect(
      (NetworkSiteService as any).onBeforeUpdate({
        query: { _id: SITE_ID.toString() },
        data: { parentSite: { _id: childId.toString() } },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkSite>),
    ).rejects.toThrow(BadDataException);
  });

  it("carries a legal move made through the `parentSite` relation key", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({
        id: CHILD_SITE_TYPE_ID,
        parentNetworkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    ]);
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([
      fakeSite({
        materializedPath: `/${SITE_ID.toString()}/`,
        networkSiteTypeId: CHILD_SITE_TYPE_ID,
      }),
    ]);
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
        networkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    );
    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockResolvedValue(`/${PARENT_SITE_ID.toString()}/`);

    const result: any = await (NetworkSiteService as any).onBeforeUpdate({
      query: { _id: SITE_ID.toString() },
      data: { parentSite: { _id: PARENT_SITE_ID.toString() } },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkSite>);

    expect(result.carryForward.newParentId.toString()).toBe(
      PARENT_SITE_ID.toString(),
    );
    expect(result.carryForward.newParentPath).toBe(
      `/${PARENT_SITE_ID.toString()}/`,
    );
  });

  it("does nothing when the update does not touch parentSiteId", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "findBy",
    );

    const result: OnUpdate<NetworkSite> = await (
      NetworkSiteService as any
    ).onBeforeUpdate({
      query: { _id: SITE_ID.toString() },
      data: { name: "renamed" },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkSite>);

    expect(result.carryForward).toBeNull();
    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("rejects moving a site to another project", async () => {
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([fakeSite({ projectId: PROJECT_ID })]);

    await expect(
      (NetworkSiteService as any).onBeforeUpdate({
        query: { _id: SITE_ID.toString() },
        data: { projectId: OTHER_PROJECT_ID },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkSite>),
    ).rejects.toThrow("cannot be moved to another project");
  });

  it.each([
    ["materializedPath", `/${SITE_ID.toString()}/`],
    ["depth", 0],
  ])(
    "rejects a direct write to server-managed %s",
    async (field: string, value: string | number) => {
      const findBySpy: jest.SpyInstance = jest.spyOn(
        NetworkSiteService,
        "findBy",
      );

      await expect(
        (NetworkSiteService as any).onBeforeUpdate({
          query: { _id: SITE_ID.toString() },
          data: { [field]: value },
          props: { isRoot: true },
        } as unknown as UpdateBy<NetworkSite>),
      ).rejects.toThrow("cannot be updated directly");

      expect(findBySpy).not.toHaveBeenCalled();
    },
  );

  it("treats undefined relation properties on a model instance as omitted", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "findBy",
    );

    const result: OnUpdate<NetworkSite> = await (
      NetworkSiteService as any
    ).onBeforeUpdate({
      query: { _id: SITE_ID.toString() },
      data: {
        name: "renamed",
        parentSite: undefined,
        parentSiteId: undefined,
        networkSiteType: undefined,
        networkSiteTypeId: undefined,
      },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkSite>);

    expect(result.carryForward).toBeNull();
    expect(findBySpy).not.toHaveBeenCalled();
  });
});

/*
 * onBeforeUpdate runs BEFORE DatabaseService applies tenant scoping to the
 * query, so an unscoped root read here would hand the hook another project's
 * row - which onUpdateSuccess would then rewrite even though the scoped
 * UPDATE matched nothing.
 */
describe("NetworkSiteService.onBeforeUpdate (tenant scoping)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeTenantUpdateBy(
    parentSiteId: ObjectID | null,
  ): UpdateBy<NetworkSite> {
    return {
      query: { _id: SITE_ID.toString() },
      data: { parentSiteId: parentSiteId },
      props: { tenantId: PROJECT_ID },
    } as unknown as UpdateBy<NetworkSite>;
  }

  it("adds the caller's project to the previous-item read", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([]);

    await (NetworkSiteService as any).onBeforeUpdate(makeTenantUpdateBy(null));

    expect(findBySpy).toHaveBeenCalledTimes(1);
    const query: any = findBySpy.mock.calls[0]![0].query;
    expect(query._id).toBe(SITE_ID.toString());
    expect(query.projectId.toString()).toBe(PROJECT_ID.toString());
  });

  /*
   * The detach case has no parent to compare against, so it used to skip
   * every project check while still carrying the victim row forward.
   */
  it("rejects a parentSiteId:null detach of a site in another project", async () => {
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([
      fakeSite({
        projectId: OTHER_PROJECT_ID,
        materializedPath: `/${PARENT_SITE_ID.toString()}/${SITE_ID.toString()}/`,
      }),
    ]);

    await expect(
      (NetworkSiteService as any).onBeforeUpdate(makeTenantUpdateBy(null)),
    ).rejects.toThrow(BadDataException);
  });

  it("rejects a re-parent of a site in another project", async () => {
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([
        fakeSite({ projectId: OTHER_PROJECT_ID, materializedPath: null }),
      ]);
    const findOneByIdSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "findOneById",
    );

    await expect(
      (NetworkSiteService as any).onBeforeUpdate(
        makeTenantUpdateBy(PARENT_SITE_ID),
      ),
    ).rejects.toThrow(BadDataException);

    // Rejected before the parent is even resolved.
    expect(findOneByIdSpy).not.toHaveBeenCalled();
  });

  it("allows a detach of a site inside the caller's project", async () => {
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([
      fakeSite({
        materializedPath: `/${PARENT_SITE_ID.toString()}/${SITE_ID.toString()}/`,
      }),
    ]);

    const result: OnUpdate<NetworkSite> = await (
      NetworkSiteService as any
    ).onBeforeUpdate(makeTenantUpdateBy(null));

    expect(result.carryForward.previousItems).toHaveLength(1);
    expect(result.carryForward.newParentPath).toBeNull();
  });

  it("reads the same limit and skip window that the bulk update will write", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([]);

    await (NetworkSiteService as any).onBeforeUpdate({
      query: {},
      data: { parentSiteId: null },
      limit: 7,
      skip: 3,
      props: { tenantId: PROJECT_ID },
    } as unknown as UpdateBy<NetworkSite>);

    expect(findBySpy.mock.calls[0]![0].limit).toBe(7);
    expect(findBySpy.mock.calls[0]![0].skip).toBe(3);
  });
});

describe("NetworkSiteService.onBeforeCreate (cross-project parent guard)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects a parent that belongs to another project", async () => {
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
        projectId: OTHER_PROJECT_ID,
      }),
    );

    await expect(
      (NetworkSiteService as any).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          parentSiteId: PARENT_SITE_ID,
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(BadDataException);
  });

  it("rejects a foreign parent given as the `parentSite` relation", async () => {
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
        projectId: OTHER_PROJECT_ID,
      }),
    );

    await expect(
      (NetworkSiteService as any).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          parentSite: { _id: PARENT_SITE_ID.toString() },
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(BadDataException);
  });

  it("carries the parent path forward for a same-project parent", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({
        id: CHILD_SITE_TYPE_ID,
        parentNetworkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    ]);
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
        networkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    );
    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockResolvedValue(`/${PARENT_SITE_ID.toString()}/`);

    const result: any = await (NetworkSiteService as any).onBeforeCreate({
      data: {
        projectId: PROJECT_ID,
        parentSiteId: PARENT_SITE_ID,
        networkSiteTypeId: CHILD_SITE_TYPE_ID,
      },
      props: { tenantId: PROJECT_ID },
    });

    expect(result.carryForward.parentPath).toBe(
      `/${PARENT_SITE_ID.toString()}/`,
    );
  });
});

describe("NetworkSiteService site-type hierarchy enforcement on create", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("allows a root type without a parent when the type arrives as a relation", async () => {
    const typeLookup: jest.SpyInstance = mockNetworkSiteTypes([
      fakeNetworkSiteType({ id: ROOT_SITE_TYPE_ID }),
    ]);

    const result: any = await (NetworkSiteService as any).onBeforeCreate({
      data: {
        projectId: PROJECT_ID,
        networkSiteType: { _id: ROOT_SITE_TYPE_ID.toString() },
      },
      props: { tenantId: PROJECT_ID },
    });

    expect(result.carryForward.parentPath).toBeNull();
    expect(typeLookup).toHaveBeenCalledTimes(1);
    expect(typeLookup.mock.calls[0]![0].id.toString()).toBe(
      ROOT_SITE_TYPE_ID.toString(),
    );
  });

  it("rejects a parent for a root type", async () => {
    mockNetworkSiteTypes([fakeNetworkSiteType({ id: ROOT_SITE_TYPE_ID })]);
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
        networkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    );

    await expect(
      (NetworkSiteService as any).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          networkSiteTypeId: ROOT_SITE_TYPE_ID,
          parentSiteId: PARENT_SITE_ID,
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(
      "A site with a root network site type cannot have a parent site.",
    );
  });

  it("requires a parent for a type configured below another type", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({
        id: CHILD_SITE_TYPE_ID,
        parentNetworkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    ]);

    await expect(
      (NetworkSiteService as any).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          networkSiteTypeId: CHILD_SITE_TYPE_ID,
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("This network site type requires a parent site.");
  });

  it("accepts a direct parent with exactly the configured type through relation fields", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({
        id: CHILD_SITE_TYPE_ID,
        parentNetworkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    ]);
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
        networkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    );
    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockResolvedValue(`/${PARENT_SITE_ID.toString()}/`);

    const result: any = await (NetworkSiteService as any).onBeforeCreate({
      data: {
        projectId: PROJECT_ID,
        networkSiteType: { id: CHILD_SITE_TYPE_ID },
        parentSite: { _id: PARENT_SITE_ID.toString() },
      },
      props: { tenantId: PROJECT_ID },
    });

    expect(result.carryForward.parentPath).toBe(
      `/${PARENT_SITE_ID.toString()}/`,
    );
  });

  it("rejects a parent whose type is not the configured direct parent", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({
        id: CHILD_SITE_TYPE_ID,
        parentNetworkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    ]);
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
        networkSiteTypeId: ALTERNATE_ROOT_SITE_TYPE_ID,
      }),
    );

    await expect(
      (NetworkSiteService as any).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          networkSiteTypeId: CHILD_SITE_TYPE_ID,
          parentSiteId: PARENT_SITE_ID,
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(
      "Parent site must use the configured parent network site type.",
    );
  });

  it("rejects a type from another project", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({
        id: ROOT_SITE_TYPE_ID,
        projectId: OTHER_PROJECT_ID,
      }),
    ]);

    await expect(
      (NetworkSiteService as any).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          networkSiteTypeId: ROOT_SITE_TYPE_ID,
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("Network site type must belong to the same project.");
  });

  it("uses a project relation payload for cross-project validation", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({
        id: ROOT_SITE_TYPE_ID,
        projectId: OTHER_PROJECT_ID,
      }),
    ]);

    await expect(
      (NetworkSiteService as any).onBeforeCreate({
        data: {
          project: { _id: PROJECT_ID.toString() },
          networkSiteTypeId: ROOT_SITE_TYPE_ID,
        },
        props: { isRoot: true },
      }),
    ).rejects.toThrow("Network site type must belong to the same project.");
  });

  it("rejects a missing type", async () => {
    mockNetworkSiteTypes([]);

    await expect(
      (NetworkSiteService as any).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          networkSiteTypeId: ROOT_SITE_TYPE_ID,
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("Network site type not found.");
  });

  it("rejects conflicting scalar and relation references before doing lookups", async () => {
    const siteLookup: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "findOneById",
    );
    const typeLookup: jest.SpyInstance = jest.spyOn(
      NetworkSiteTypeService,
      "findOneById",
    );

    await expect(
      (NetworkSiteService as any).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          networkSiteTypeId: ROOT_SITE_TYPE_ID,
          networkSiteType: { _id: CHILD_SITE_TYPE_ID.toString() },
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(
      "Conflicting Network Site Type references were provided.",
    );

    expect(siteLookup).not.toHaveBeenCalled();
    expect(typeLookup).not.toHaveBeenCalled();
  });

  it("rejects a raw parent SQL expression instead of treating it as a clear", async () => {
    const siteLookup: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "findOneById",
    );

    await expect(
      (NetworkSiteService as any).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          parentSiteId: () => {
            return "some-parent-id";
          },
          networkSiteTypeId: ROOT_SITE_TYPE_ID,
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(
      "parentSiteId cannot be set to a raw SQL expression because the network site hierarchy must be validated against an actual ID.",
    );

    expect(siteLookup).not.toHaveBeenCalled();
  });

  it("rejects a malformed non-null site type relation", async () => {
    const typeLookup: jest.SpyInstance = jest.spyOn(
      NetworkSiteTypeService,
      "findOneById",
    );

    await expect(
      (NetworkSiteService as any).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          networkSiteType: { name: "not an id" },
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(
      "networkSiteType must contain a valid Network Site Type ID.",
    );

    expect(typeLookup).not.toHaveBeenCalled();
  });

  it("does not permit an untyped child under a parent", async () => {
    jest
      .spyOn(NetworkSiteService, "findOneById")
      .mockResolvedValue(fakeSite({ id: PARENT_SITE_ID }));

    await expect(
      (NetworkSiteService as any).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          parentSiteId: PARENT_SITE_ID,
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(
      "A network site with a parent must have a network site type.",
    );
  });
});

describe("NetworkSiteService site-type hierarchy enforcement on update", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeTypeUpdate(
    data: Record<string, unknown>,
  ): UpdateBy<NetworkSite> {
    return {
      query: { _id: SITE_ID.toString() },
      data: data,
      props: { tenantId: PROJECT_ID },
    } as unknown as UpdateBy<NetworkSite>;
  }

  it("rejects attaching a root-typed site to a parent", async () => {
    mockNetworkSiteTypes([fakeNetworkSiteType({ id: ROOT_SITE_TYPE_ID })]);
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([fakeSite({ networkSiteTypeId: ROOT_SITE_TYPE_ID })]);
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
        networkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    );
    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockResolvedValue(`/${PARENT_SITE_ID.toString()}/`);

    await expect(
      (NetworkSiteService as any).onBeforeUpdate(
        makeTypeUpdate({ parentSiteId: PARENT_SITE_ID }),
      ),
    ).rejects.toThrow(
      "A site with a root network site type cannot have a parent site.",
    );
  });

  it("rejects detaching a site whose type requires a parent", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({
        id: CHILD_SITE_TYPE_ID,
        parentNetworkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    ]);
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([
      fakeSite({
        parentSiteId: PARENT_SITE_ID,
        networkSiteTypeId: CHILD_SITE_TYPE_ID,
      }),
    ]);

    await expect(
      (NetworkSiteService as any).onBeforeUpdate(
        makeTypeUpdate({ parentSite: null }),
      ),
    ).rejects.toThrow("This network site type requires a parent site.");
  });

  it("validates a type-only update against the site's existing parent", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({
        id: CHILD_SITE_TYPE_ID,
        parentNetworkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    ]);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValueOnce([
        fakeSite({
          parentSiteId: PARENT_SITE_ID,
          networkSiteTypeId: ALTERNATE_ROOT_SITE_TYPE_ID,
        }),
      ])
      .mockResolvedValueOnce([]);
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
        networkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    );

    const result: OnUpdate<NetworkSite> = await (
      NetworkSiteService as any
    ).onBeforeUpdate(makeTypeUpdate({ networkSiteTypeId: CHILD_SITE_TYPE_ID }));

    expect(result.carryForward).toBeNull();
    expect(findBySpy).toHaveBeenCalledTimes(2);
  });

  it("uses both proposed values when type and parent change together as relations", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({
        id: CHILD_SITE_TYPE_ID,
        parentNetworkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    ]);
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValueOnce([
        fakeSite({ networkSiteTypeId: ROOT_SITE_TYPE_ID }),
      ])
      .mockResolvedValueOnce([]);
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
        networkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    );
    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockResolvedValue(`/${PARENT_SITE_ID.toString()}/`);

    const result: any = await (NetworkSiteService as any).onBeforeUpdate(
      makeTypeUpdate({
        networkSiteType: { _id: CHILD_SITE_TYPE_ID.toString() },
        parentSite: { id: PARENT_SITE_ID },
      }),
    );

    expect(result.carryForward.newParentId.toString()).toBe(
      PARENT_SITE_ID.toString(),
    );
  });

  it("rejects a type change that would invalidate a direct child", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({ id: ALTERNATE_ROOT_SITE_TYPE_ID }),
      fakeNetworkSiteType({
        id: CHILD_SITE_TYPE_ID,
        parentNetworkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    ]);
    const childId: ObjectID = new ObjectID(
      "99999999-9999-4999-8999-999999999999",
    );
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValueOnce([
        fakeSite({ networkSiteTypeId: ROOT_SITE_TYPE_ID }),
      ])
      .mockResolvedValueOnce([
        fakeSite({
          id: childId,
          _id: childId.toString(),
          parentSiteId: SITE_ID,
          networkSiteTypeId: CHILD_SITE_TYPE_ID,
        }),
      ]);

    await expect(
      (NetworkSiteService as any).onBeforeUpdate(
        makeTypeUpdate({
          networkSiteTypeId: ALTERNATE_ROOT_SITE_TYPE_ID,
        }),
      ),
    ).rejects.toThrow(
      "Parent site must use the configured parent network site type.",
    );
  });

  it("allows a type change when every direct child expects the new type", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({ id: ALTERNATE_ROOT_SITE_TYPE_ID }),
      fakeNetworkSiteType({
        id: GRANDCHILD_SITE_TYPE_ID,
        parentNetworkSiteTypeId: ALTERNATE_ROOT_SITE_TYPE_ID,
      }),
    ]);
    const childId: ObjectID = new ObjectID(
      "99999999-9999-4999-8999-999999999999",
    );
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValueOnce([
        fakeSite({ networkSiteTypeId: ROOT_SITE_TYPE_ID }),
      ])
      .mockResolvedValueOnce([
        fakeSite({
          id: childId,
          _id: childId.toString(),
          parentSiteId: SITE_ID,
          networkSiteTypeId: GRANDCHILD_SITE_TYPE_ID,
        }),
      ]);

    await expect(
      (NetworkSiteService as any).onBeforeUpdate(
        makeTypeUpdate({
          networkSiteType: {
            _id: ALTERNATE_ROOT_SITE_TYPE_ID.toString(),
          },
        }),
      ),
    ).resolves.toMatchObject({ carryForward: null });

    const childQuery: any = findBySpy.mock.calls[1]![0].query;
    expect(childQuery.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(childQuery.parentSiteId.toString()).toBe(SITE_ID.toString());
  });

  it("pages past a full batch so wide sites cannot hide invalid direct children", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({ id: ALTERNATE_ROOT_SITE_TYPE_ID }),
      fakeNetworkSiteType({
        id: GRANDCHILD_SITE_TYPE_ID,
        parentNetworkSiteTypeId: ALTERNATE_ROOT_SITE_TYPE_ID,
      }),
      fakeNetworkSiteType({
        id: CHILD_SITE_TYPE_ID,
        parentNetworkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    ]);
    const child: NetworkSite = fakeSite({
      id: new ObjectID("99999999-9999-4999-8999-999999999999"),
      networkSiteTypeId: GRANDCHILD_SITE_TYPE_ID,
    });
    const childReadSkips: Array<number> = [];
    const invalidChildOnSecondPage: NetworkSite = fakeSite({
      id: new ObjectID("aaaaaaaa-1111-4111-8111-111111111111"),
      networkSiteTypeId: CHILD_SITE_TYPE_ID,
    });
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findBy")
      .mockImplementation((input: any) => {
        if (input.query._id) {
          return Promise.resolve([
            fakeSite({ networkSiteTypeId: ROOT_SITE_TYPE_ID }),
          ]);
        }

        childReadSkips.push(input.skip);
        if (input.skip === 0) {
          return Promise.resolve(
            Array.from({ length: input.limit }, () => {
              return child;
            }),
          );
        }

        return Promise.resolve([invalidChildOnSecondPage]);
      });

    await expect(
      (NetworkSiteService as any).onBeforeUpdate(
        makeTypeUpdate({
          networkSiteTypeId: ALTERNATE_ROOT_SITE_TYPE_ID,
        }),
      ),
    ).rejects.toThrow(
      "Parent site must use the configured parent network site type.",
    );

    expect(findBySpy).toHaveBeenCalledTimes(3);
    expect(childReadSkips).toEqual([0, 1000]);
  });

  it("rejects clearing a site's type while it still has direct children", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({
        id: CHILD_SITE_TYPE_ID,
        parentNetworkSiteTypeId: ROOT_SITE_TYPE_ID,
      }),
    ]);
    const childId: ObjectID = new ObjectID(
      "99999999-9999-4999-8999-999999999999",
    );
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValueOnce([
        fakeSite({ networkSiteTypeId: ROOT_SITE_TYPE_ID }),
      ])
      .mockResolvedValueOnce([
        fakeSite({
          id: childId,
          _id: childId.toString(),
          networkSiteTypeId: CHILD_SITE_TYPE_ID,
        }),
      ]);

    await expect(
      (NetworkSiteService as any).onBeforeUpdate(
        makeTypeUpdate({ networkSiteTypeId: null }),
      ),
    ).rejects.toThrow(
      "Parent site must use the configured parent network site type.",
    );
  });

  it("rejects a type-only update to a foreign-project type", async () => {
    mockNetworkSiteTypes([
      fakeNetworkSiteType({
        id: ALTERNATE_ROOT_SITE_TYPE_ID,
        projectId: OTHER_PROJECT_ID,
      }),
    ]);
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([fakeSite({ networkSiteTypeId: ROOT_SITE_TYPE_ID })]);

    await expect(
      (NetworkSiteService as any).onBeforeUpdate(
        makeTypeUpdate({
          networkSiteTypeId: ALTERNATE_ROOT_SITE_TYPE_ID,
        }),
      ),
    ).rejects.toThrow("Network site type must belong to the same project.");
  });

  it("rejects conflicting parent spellings before hierarchy reads", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "findBy",
    );

    await expect(
      (NetworkSiteService as any).onBeforeUpdate(
        makeTypeUpdate({
          parentSiteId: PARENT_SITE_ID,
          parentSite: { _id: SITE_ID.toString() },
        }),
      ),
    ).rejects.toThrow("Conflicting Parent Site references were provided.");

    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("rejects a raw site-type SQL expression before hierarchy reads", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "findBy",
    );

    await expect(
      (NetworkSiteService as any).onBeforeUpdate(
        makeTypeUpdate({
          networkSiteTypeId: () => {
            return "some-type-id";
          },
        }),
      ),
    ).rejects.toThrow(
      "networkSiteTypeId cannot be set to a raw SQL expression because the network site hierarchy must be validated against an actual ID.",
    );

    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("rejects a malformed non-null parent relation before hierarchy reads", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "findBy",
    );

    await expect(
      (NetworkSiteService as any).onBeforeUpdate(
        makeTypeUpdate({ parentSite: { name: "not an id" } }),
      ),
    ).rejects.toThrow("parentSite must contain a valid Parent Site ID.");

    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("does not re-query direct children for a no-op type write", async () => {
    mockNetworkSiteTypes([fakeNetworkSiteType({ id: ROOT_SITE_TYPE_ID })]);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([fakeSite({ networkSiteTypeId: ROOT_SITE_TYPE_ID })]);

    await (NetworkSiteService as any).onBeforeUpdate(
      makeTypeUpdate({ networkSiteTypeId: ROOT_SITE_TYPE_ID }),
    );

    expect(findBySpy).toHaveBeenCalledTimes(1);
  });
});

describe("NetworkSiteService.onUpdateSuccess (subtree rebase)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rebases the moved site and every descendant, then refreshes both chains", async () => {
    const childId: ObjectID = new ObjectID(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );
    const oldParentId: ObjectID = PARENT_SITE_ID;
    const newParentId: ObjectID = new ObjectID(
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
    );

    const oldPath: string = `/${oldParentId.toString()}/${SITE_ID.toString()}/`;
    const oldChildPath: string = `${oldPath}${childId.toString()}/`;

    const updateColumnsSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([
      // The prefix query matches the moved site itself and its child.
      fakeSite({ materializedPath: oldPath }),
      fakeSite({
        id: childId,
        _id: childId.toString(),
        materializedPath: oldChildPath,
      }),
    ]);
    const rollupSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);

    const onUpdate: OnUpdate<NetworkSite> = {
      updateBy: {
        query: { _id: SITE_ID.toString() },
        data: { parentSiteId: newParentId },
        props: { isRoot: true },
      } as unknown as UpdateBy<NetworkSite>,
      carryForward: {
        previousItems: [
          fakeSite({
            materializedPath: oldPath,
            parentSiteId: oldParentId,
          }),
        ],
        newParentId: newParentId,
        newParentPath: `/${newParentId.toString()}/`,
      },
    };

    await (NetworkSiteService as any).onUpdateSuccess(onUpdate, [SITE_ID]);

    const newPath: string = `/${newParentId.toString()}/${SITE_ID.toString()}/`;

    // Moved site rewritten...
    const selfUpdate: any = updateColumnsSpy.mock.calls.find((call: any) => {
      return call[0].id.toString() === SITE_ID.toString();
    });
    expect(selfUpdate[0].data.materializedPath).toBe(newPath);
    expect(selfUpdate[0].data.depth).toBe(1);

    // ...and the descendant rebased under the new prefix.
    const childUpdate: any = updateColumnsSpy.mock.calls.find((call: any) => {
      return call[0].id.toString() === childId.toString();
    });
    expect(childUpdate[0].data.materializedPath).toBe(
      `${newPath}${childId.toString()}/`,
    );
    expect(childUpdate[0].data.depth).toBe(2);

    // Rollups: the moved site's new chain + the old parent's chain.
    const rollupIds: Array<string> = rollupSpy.mock.calls.map(
      (call: Array<any>) => {
        return call[0].toString();
      },
    );
    expect(rollupIds).toContain(SITE_ID.toString());
    expect(rollupIds).toContain(oldParentId.toString());
  });

  it("pages from the old prefix until a subtree larger than one batch is fully rebased", async () => {
    const newParentId: ObjectID = new ObjectID(
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
    );
    const oldPath: string = `/${PARENT_SITE_ID.toString()}/${SITE_ID.toString()}/`;
    const firstBatch: Array<NetworkSite> = Array.from(
      { length: 1000 },
      (): NetworkSite => {
        const id: ObjectID = ObjectID.generate();
        return fakeSite({
          id,
          _id: id.toString(),
          materializedPath: `${oldPath}${id.toString()}/`,
        });
      },
    );
    const finalId: ObjectID = ObjectID.generate();
    const finalSite: NetworkSite = fakeSite({
      id: finalId,
      _id: finalId.toString(),
      materializedPath: `${oldPath}${finalId.toString()}/`,
    });
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce([finalSite]);
    const updateColumnsSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);

    await (NetworkSiteService as any).onUpdateSuccess(
      {
        updateBy: {
          query: { _id: SITE_ID.toString() },
          data: { parentSiteId: newParentId },
          props: { isRoot: true },
        },
        carryForward: {
          previousItems: [
            fakeSite({
              materializedPath: oldPath,
              parentSiteId: PARENT_SITE_ID,
            }),
          ],
          newParentId,
          newParentPath: `/${newParentId.toString()}/`,
        },
      },
      [SITE_ID],
    );

    expect(findBySpy).toHaveBeenCalledTimes(2);
    expect(findBySpy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ limit: 1000, skip: 0 }),
    );
    expect(findBySpy.mock.calls[1]![0]).toEqual(
      expect.objectContaining({ limit: 1000, skip: 0 }),
    );
    expect(updateColumnsSpy).toHaveBeenCalledTimes(1002);
    expect(updateColumnsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: finalId }),
    );
  });

  it("processes overlapping bulk move roots deepest-first", async () => {
    const descendantId: ObjectID = ObjectID.generate();
    const ancestorPath: string = `/${SITE_ID.toString()}/`;
    const descendantPath: string = `${ancestorPath}${descendantId.toString()}/`;
    const updateColumnsSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);

    await (NetworkSiteService as any).onUpdateSuccess(
      {
        updateBy: {
          query: {},
          data: { parentSiteId: PARENT_SITE_ID },
          props: { isRoot: true },
        },
        carryForward: {
          previousItems: [
            fakeSite({ materializedPath: ancestorPath }),
            fakeSite({
              id: descendantId,
              _id: descendantId.toString(),
              parentSiteId: SITE_ID,
              materializedPath: descendantPath,
            }),
          ],
          newParentId: PARENT_SITE_ID,
          newParentPath: `/${PARENT_SITE_ID.toString()}/`,
        },
      },
      [SITE_ID, descendantId],
    );

    expect(updateColumnsSpy.mock.calls[0]![0].id.toString()).toBe(
      descendantId.toString(),
    );
    expect(updateColumnsSpy.mock.calls[1]![0].id.toString()).toBe(
      SITE_ID.toString(),
    );
  });

  /*
   * DatabaseService calls onUpdateSuccess even when the tenant-scoped UPDATE
   * matched zero rows. Nothing may be written for a row the UPDATE did not
   * touch - otherwise a cross-project id in the query rewrites the victim's
   * path and rollup while its parentSiteId column stays untouched.
   */
  it("writes nothing for sites the scoped update did not match", async () => {
    const updateColumnsSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "updateColumnsByIdWithoutHooks",
    );
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "findBy",
    );
    const rollupSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "recomputeRollupForSiteAndAncestors",
    );

    await (NetworkSiteService as any).onUpdateSuccess(
      {
        updateBy: {
          query: { _id: SITE_ID.toString() },
          data: { parentSiteId: null },
          props: { tenantId: PROJECT_ID },
        } as unknown as UpdateBy<NetworkSite>,
        carryForward: {
          previousItems: [
            fakeSite({
              projectId: OTHER_PROJECT_ID,
              parentSiteId: PARENT_SITE_ID,
              materializedPath: `/${PARENT_SITE_ID.toString()}/${SITE_ID.toString()}/`,
            }),
          ],
          newParentId: null,
          newParentPath: null,
        },
      },
      [], // the scoped UPDATE matched nothing
    );

    expect(updateColumnsSpy).not.toHaveBeenCalled();
    expect(findBySpy).not.toHaveBeenCalled();
    expect(rollupSpy).not.toHaveBeenCalled();
  });

  it("is a no-op without a parent-change carryForward", async () => {
    const updateColumnsSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "updateColumnsByIdWithoutHooks",
    );

    await (NetworkSiteService as any).onUpdateSuccess(
      {
        updateBy: {
          query: {},
          data: { name: "renamed" },
          props: { isRoot: true },
        },
        carryForward: null,
      },
      [SITE_ID],
    );

    expect(updateColumnsSpy).not.toHaveBeenCalled();
  });
});

describe("NetworkSiteService.onMonitorStatusChanged", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const MONITOR_ID: ObjectID = new ObjectID(
    "99999999-9999-4999-8999-999999999999",
  );

  function fakeNetworkDeviceMonitor(deviceIds: Array<string>): Monitor {
    return {
      id: MONITOR_ID,
      monitorType: MonitorType.NetworkDevice,
      monitorSteps: {
        data: {
          monitorStepsInstanceArray: deviceIds.map((deviceId: string) => {
            return {
              data: {
                networkDeviceMonitor: { networkDeviceId: deviceId },
              },
            };
          }),
        },
      },
    } as unknown as Monitor;
  }

  it("stamps referenced devices and recomputes each distinct site chain once", async () => {
    const secondDeviceId: ObjectID = new ObjectID(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    const otherSiteId: ObjectID = new ObjectID(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );

    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        fakeNetworkDeviceMonitor([
          DEVICE_ID.toString(),
          secondDeviceId.toString(),
        ]),
      ]);
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([
      { id: DEVICE_ID, siteId: SITE_ID },
      { id: secondDeviceId, siteId: otherSiteId },
    ] as unknown as Array<NetworkDevice>);

    const stampSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    const rollupSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);

    await NetworkSiteService.onMonitorStatusChanged({
      projectId: PROJECT_ID,
      monitorIds: [MONITOR_ID],
      monitorStatusId: OFFLINE_STATUS_ID,
    });

    expect(stampSpy).toHaveBeenCalledTimes(2);
    for (const call of stampSpy.mock.calls) {
      expect((call[0] as any).data.currentMonitorStatusId.toString()).toBe(
        OFFLINE_STATUS_ID.toString(),
      );
    }

    const rollupIds: Array<string> = rollupSpy.mock.calls.map(
      (call: Array<any>) => {
        return call[0].toString();
      },
    );
    expect(rollupIds.sort()).toEqual(
      [SITE_ID.toString(), otherSiteId.toString()].sort(),
    );
  });

  it("deduplicates devices that share a site", async () => {
    const secondDeviceId: ObjectID = new ObjectID(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );

    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        fakeNetworkDeviceMonitor([
          DEVICE_ID.toString(),
          secondDeviceId.toString(),
        ]),
      ]);
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([
      { id: DEVICE_ID, siteId: SITE_ID },
      { id: secondDeviceId, siteId: SITE_ID },
    ] as unknown as Array<NetworkDevice>);
    jest
      .spyOn(NetworkDeviceService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    const rollupSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);

    await NetworkSiteService.onMonitorStatusChanged({
      projectId: PROJECT_ID,
      monitorIds: [MONITOR_ID],
      monitorStatusId: OFFLINE_STATUS_ID,
    });

    expect(rollupSpy).toHaveBeenCalledTimes(1);
  });

  it("still stamps devices that have no site (rollup skipped)", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([fakeNetworkDeviceMonitor([DEVICE_ID.toString()])]);
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([
        { id: DEVICE_ID },
      ] as unknown as Array<NetworkDevice>);
    const stampSpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    const rollupSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "recomputeRollupForSiteAndAncestors",
    );

    await NetworkSiteService.onMonitorStatusChanged({
      projectId: PROJECT_ID,
      monitorIds: [MONITOR_ID],
      monitorStatusId: OFFLINE_STATUS_ID,
    });

    expect(stampSpy).toHaveBeenCalledTimes(1);
    expect(rollupSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the monitors are not NetworkDevice monitors", async () => {
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([]);
    /*
     * A device can be bound to a monitor either through a NetworkDevice
     * monitor's steps or directly by its own monitorId column, so the service
     * still asks NetworkDeviceService for devices carrying these monitorIds.
     * When that also comes back empty there is genuinely nothing to act on.
     */
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([] as unknown as Array<NetworkDevice>);
    const stampSpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "updateColumnsByIdWithoutHooks",
    );
    const rollupSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "recomputeRollupForSiteAndAncestors",
    );

    await NetworkSiteService.onMonitorStatusChanged({
      projectId: PROJECT_ID,
      monitorIds: [MONITOR_ID],
      monitorStatusId: OFFLINE_STATUS_ID,
    });

    // No device resolved, so nothing is stamped and no rollup is recomputed.
    expect(stampSpy).not.toHaveBeenCalled();
    expect(rollupSpy).not.toHaveBeenCalled();
  });

  it("NEVER throws - a failing lookup is logged, not propagated", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      NetworkSiteService.onMonitorStatusChanged({
        projectId: PROJECT_ID,
        monitorIds: [MONITOR_ID],
        monitorStatusId: OFFLINE_STATUS_ID,
      }),
    ).resolves.toBeUndefined();
  });
});

/*
 * The REAL path builder (not the spy the rest of this file installs). It is
 * the single source of truth for getAncestorIds, getDescendantSiteIds and the
 * cycle guard, and the only thing that repairs a row whose path write failed
 * or whose ancestor was deleted out from under it.
 */
describe("NetworkSiteService.getMaterializedPathForSite", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubRows(rows: Array<NetworkSite>): jest.SpyInstance {
    const byId: Map<string, NetworkSite> = new Map(
      rows.map((row: NetworkSite) => {
        return [row.id!.toString(), row];
      }),
    );

    jest
      .spyOn(NetworkSiteService, "findOneById")
      .mockImplementation((input: any) => {
        return Promise.resolve(byId.get(input.id.toString()) || null);
      });

    return jest
      .spyOn(NetworkSiteService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
  }

  it("returns a stored path that agrees with parentSiteId, writing nothing", async () => {
    const storedPath: string = `/${PARENT_SITE_ID.toString()}/${SITE_ID.toString()}/`;
    const updateColumns: jest.SpyInstance = stubRows([
      fakeSite({
        parentSiteId: PARENT_SITE_ID,
        materializedPath: storedPath,
      }),
    ]);

    expect(await NetworkSiteService.getMaterializedPathForSite(SITE_ID)).toBe(
      storedPath,
    );
    expect(updateColumns).not.toHaveBeenCalled();
  });

  it("rebuilds and persists a null path from the parent's stored path", async () => {
    const updateColumns: jest.SpyInstance = stubRows([
      fakeSite({
        parentSiteId: PARENT_SITE_ID,
        materializedPath: undefined,
      }),
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
        materializedPath: `/${PARENT_SITE_ID.toString()}/`,
      }),
    ]);

    const expectedPath: string = `/${PARENT_SITE_ID.toString()}/${SITE_ID.toString()}/`;

    expect(await NetworkSiteService.getMaterializedPathForSite(SITE_ID)).toBe(
      expectedPath,
    );

    expect(updateColumns).toHaveBeenCalledTimes(1);
    const args: any = updateColumns.mock.calls[0]![0];
    expect(args.id.toString()).toBe(SITE_ID.toString());
    expect(args.data.materializedPath).toBe(expectedPath);
    expect(args.data.depth).toBe(1);
  });

  it("heals a whole null-path chain top-down", async () => {
    const rootId: ObjectID = new ObjectID(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    const updateColumns: jest.SpyInstance = stubRows([
      fakeSite({
        parentSiteId: PARENT_SITE_ID,
        materializedPath: undefined,
      }),
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
        parentSiteId: rootId,
        materializedPath: undefined,
      }),
      fakeSite({
        id: rootId,
        _id: rootId.toString(),
        materializedPath: `/${rootId.toString()}/`,
      }),
    ]);

    const expectedPath: string = `/${rootId.toString()}/${PARENT_SITE_ID.toString()}/${SITE_ID.toString()}/`;

    expect(await NetworkSiteService.getMaterializedPathForSite(SITE_ID)).toBe(
      expectedPath,
    );

    // Persisted root-ward first, so each child builds on a healed parent.
    const writes: Array<Array<unknown>> = updateColumns.mock.calls.map(
      (call: Array<any>) => {
        return [
          call[0].id.toString(),
          call[0].data.materializedPath,
          call[0].data.depth,
        ];
      },
    );
    expect(writes).toEqual([
      [
        PARENT_SITE_ID.toString(),
        `/${rootId.toString()}/${PARENT_SITE_ID.toString()}/`,
        1,
      ],
      [SITE_ID.toString(), expectedPath, 2],
    ]);
  });

  /*
   * A deleted mid-tree ancestor leaves parentSiteId NULL (FK SET NULL) while
   * the stored path still routes through the dead row. That desync must not
   * survive - a stale path is as untrustworthy as a missing one.
   */
  it("self-heals a stale path stranded by a deleted ancestor", async () => {
    const deletedId: ObjectID = new ObjectID(
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
    );
    const updateColumns: jest.SpyInstance = stubRows([
      fakeSite({
        parentSiteId: undefined,
        materializedPath: `/${deletedId.toString()}/${SITE_ID.toString()}/`,
      }),
    ]);

    expect(await NetworkSiteService.getMaterializedPathForSite(SITE_ID)).toBe(
      `/${SITE_ID.toString()}/`,
    );

    expect(updateColumns).toHaveBeenCalledTimes(1);
    const args: any = updateColumns.mock.calls[0]![0];
    expect(args.data.materializedPath).toBe(`/${SITE_ID.toString()}/`);
    expect(args.data.depth).toBe(0);
  });

  it("terminates on a corrupted parent cycle instead of looping forever", async () => {
    stubRows([
      fakeSite({
        parentSiteId: PARENT_SITE_ID,
        materializedPath: undefined,
      }),
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
        parentSiteId: SITE_ID,
        materializedPath: undefined,
      }),
    ]);

    // The cycle is broken by treating the topmost visited node as a root.
    expect(await NetworkSiteService.getMaterializedPathForSite(SITE_ID)).toBe(
      `/${PARENT_SITE_ID.toString()}/${SITE_ID.toString()}/`,
    );
  });

  it("returns null when the site does not exist", async () => {
    stubRows([]);

    expect(
      await NetworkSiteService.getMaterializedPathForSite(SITE_ID),
    ).toBeNull();
  });
});

/*
 * A typed child cannot be promoted or attached to its grandparent without
 * violating its configured direct-parent type. The before hook therefore
 * blocks partial subtree deletes. The success-hook tests retain the old
 * orphan repair as a defensive fallback for hook-bypassing/internal deletes.
 */
describe("NetworkSiteService delete hooks (orphan repair)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const REGION_ID: ObjectID = new ObjectID(
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  );
  const DISTRICT_ID: ObjectID = SITE_ID;
  const STORE_ID: ObjectID = new ObjectID(
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  );
  const UNIT_ID: ObjectID = new ObjectID(
    "ffffffff-ffff-4fff-8fff-ffffffffffff",
  );

  const DISTRICT_PATH: string = `/${REGION_ID.toString()}/${DISTRICT_ID.toString()}/`;
  const STORE_PATH: string = `${DISTRICT_PATH}${STORE_ID.toString()}/`;
  const UNIT_PATH: string = `${STORE_PATH}${UNIT_ID.toString()}/`;

  function deletedDistrict(): NetworkSite {
    return fakeSite({
      id: DISTRICT_ID,
      _id: DISTRICT_ID.toString(),
      parentSiteId: REGION_ID,
      materializedPath: DISTRICT_PATH,
    });
  }

  it("onBeforeDelete scopes the pre-delete read to the caller's project", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([]);

    const result: OnDelete<NetworkSite> = await (
      NetworkSiteService as any
    ).onBeforeDelete({
      query: { _id: DISTRICT_ID.toString() },
      props: { tenantId: PROJECT_ID },
    } as unknown as DeleteBy<NetworkSite>);

    const query: any = findBySpy.mock.calls[0]![0].query;
    expect(query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(result.carryForward.sitesToDelete).toEqual([]);
  });

  it("uses the same tenant scope for a root delete preflight", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([]);

    await (NetworkSiteService as any).onBeforeDelete({
      query: { _id: DISTRICT_ID.toString() },
      props: { tenantId: PROJECT_ID, isRoot: true },
    } as unknown as DeleteBy<NetworkSite>);

    expect(findBySpy.mock.calls[0]![0].query.projectId.toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  it("does not invent a tenant scope for a root multi-tenant delete preflight", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([]);

    await (NetworkSiteService as any).onBeforeDelete({
      query: { _id: DISTRICT_ID.toString() },
      props: {
        tenantId: PROJECT_ID,
        isRoot: true,
        isMultiTenantRequest: true,
      },
    } as unknown as DeleteBy<NetworkSite>);

    expect(findBySpy.mock.calls[0]![0].query.projectId).toBeUndefined();
  });

  it("rejects deleting a site while a direct child would survive", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValueOnce([deletedDistrict()])
      .mockResolvedValueOnce([
        fakeSite({
          id: STORE_ID,
          _id: STORE_ID.toString(),
          parentSiteId: DISTRICT_ID,
        }),
      ]);

    await expect(
      (NetworkSiteService as any).onBeforeDelete({
        query: { _id: DISTRICT_ID.toString() },
        limit: 1,
        skip: 0,
        props: { tenantId: PROJECT_ID },
      } as unknown as DeleteBy<NetworkSite>),
    ).rejects.toThrow(
      "A network site with child sites cannot be deleted. Move or delete its child sites first.",
    );

    const childQuery: any = findBySpy.mock.calls[1]![0].query;
    expect(childQuery.projectId).toBeInstanceOf(FindOperator);
    expect(
      Object.values(
        childQuery.projectId.objectLiteralParameters as Record<
          string,
          Array<string>
        >,
      ).flat(),
    ).toContain(PROJECT_ID.toString());
  });

  it("allows a bulk delete when every direct child is in the delete set", async () => {
    const store: NetworkSite = fakeSite({
      id: STORE_ID,
      _id: STORE_ID.toString(),
      parentSiteId: DISTRICT_ID,
      materializedPath: STORE_PATH,
    });
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValueOnce([deletedDistrict(), store])
      .mockResolvedValueOnce([store]);

    const result: OnDelete<NetworkSite> = await (
      NetworkSiteService as any
    ).onBeforeDelete({
      query: {},
      limit: 2,
      skip: 0,
      props: { tenantId: PROJECT_ID },
    } as unknown as DeleteBy<NetworkSite>);

    expect(result.carryForward.sitesToDelete).toEqual([
      deletedDistrict(),
      store,
    ]);
  });

  it("rejects a bulk parent-and-child delete when a grandchild would survive", async () => {
    const store: NetworkSite = fakeSite({
      id: STORE_ID,
      _id: STORE_ID.toString(),
      parentSiteId: DISTRICT_ID,
      materializedPath: STORE_PATH,
    });
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValueOnce([deletedDistrict(), store])
      .mockResolvedValueOnce([
        store,
        fakeSite({
          id: UNIT_ID,
          _id: UNIT_ID.toString(),
          parentSiteId: STORE_ID,
          materializedPath: UNIT_PATH,
        }),
      ]);

    await expect(
      (NetworkSiteService as any).onBeforeDelete({
        query: {},
        limit: 2,
        skip: 0,
        props: { tenantId: PROJECT_ID },
      } as unknown as DeleteBy<NetworkSite>),
    ).rejects.toThrow(
      "A network site with child sites cannot be deleted. Move or delete its child sites first.",
    );
  });

  it("uses the requested window when determining the exact bulk delete set", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([]);

    await (NetworkSiteService as any).onBeforeDelete({
      query: {},
      limit: 7,
      skip: 3,
      props: { tenantId: PROJECT_ID },
    } as unknown as DeleteBy<NetworkSite>);

    expect(findBySpy.mock.calls[0]![0].limit).toBe(7);
    expect(findBySpy.mock.calls[0]![0].skip).toBe(3);
  });

  it("reparents the direct child and rebases the whole subtree", async () => {
    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockResolvedValue(`/${REGION_ID.toString()}/`);
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([
      fakeSite({
        id: STORE_ID,
        _id: STORE_ID.toString(),
        materializedPath: STORE_PATH,
      }),
      fakeSite({
        id: UNIT_ID,
        _id: UNIT_ID.toString(),
        materializedPath: UNIT_PATH,
      }),
    ]);
    const updateColumns: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    const rollupSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);

    await (NetworkSiteService as any).onDeleteSuccess(
      {
        deleteBy: {
          query: { _id: DISTRICT_ID.toString() },
          props: { tenantId: PROJECT_ID },
        },
        carryForward: { sitesToDelete: [deletedDistrict()] },
      },
      [DISTRICT_ID],
    );

    // The direct child is re-attached to the deleted site's own parent...
    const storeWrite: any = updateColumns.mock.calls.find((call: any) => {
      return call[0].id.toString() === STORE_ID.toString();
    })![0];
    expect(storeWrite.data.materializedPath).toBe(
      `/${REGION_ID.toString()}/${STORE_ID.toString()}/`,
    );
    expect(storeWrite.data.depth).toBe(1);
    expect(storeWrite.data.parentSiteId.toString()).toBe(REGION_ID.toString());

    // ...and deeper descendants only lose the deleted segment.
    const unitWrite: any = updateColumns.mock.calls.find((call: any) => {
      return call[0].id.toString() === UNIT_ID.toString();
    })![0];
    expect(unitWrite.data.materializedPath).toBe(
      `/${REGION_ID.toString()}/${STORE_ID.toString()}/${UNIT_ID.toString()}/`,
    );
    expect(unitWrite.data.depth).toBe(2);
    expect(unitWrite.data.parentSiteId).toBeUndefined();

    // The surviving ancestor chain's rollup is refreshed.
    expect(rollupSpy).toHaveBeenCalledTimes(1);
    expect(rollupSpy.mock.calls[0]![0].toString()).toBe(REGION_ID.toString());
  });

  it("pages legacy orphan repair from offset zero until every descendant is rewritten", async () => {
    const repeatedId: ObjectID = ObjectID.generate();
    const repeatedDescendant: NetworkSite = fakeSite({
      id: repeatedId,
      _id: repeatedId.toString(),
      materializedPath: `${DISTRICT_PATH}${repeatedId.toString()}/`,
    });
    const finalId: ObjectID = ObjectID.generate();
    const finalDescendant: NetworkSite = fakeSite({
      id: finalId,
      _id: finalId.toString(),
      materializedPath: `${DISTRICT_PATH}${finalId.toString()}/`,
    });

    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockResolvedValue(`/${REGION_ID.toString()}/`);
    const findBySpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValueOnce(
        new Array<NetworkSite>(1000).fill(repeatedDescendant),
      )
      .mockResolvedValueOnce([finalDescendant]);
    const updateColumnsSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(NetworkSiteService, "recomputeRollupForSiteAndAncestors")
      .mockResolvedValue(undefined as never);

    await (NetworkSiteService as any).onDeleteSuccess(
      {
        deleteBy: { query: {}, props: { tenantId: PROJECT_ID } },
        carryForward: { sitesToDelete: [deletedDistrict()] },
      },
      [DISTRICT_ID],
    );

    expect(findBySpy).toHaveBeenCalledTimes(2);
    expect(findBySpy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ limit: 1000, skip: 0 }),
    );
    expect(findBySpy.mock.calls[1]![0]).toEqual(
      expect.objectContaining({ limit: 1000, skip: 0 }),
    );
    expect(updateColumnsSpy).toHaveBeenCalledTimes(1001);
    expect(updateColumnsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: finalId }),
    );
  });

  it("promotes children to roots when the deleted site was a root", async () => {
    const rootPath: string = `/${DISTRICT_ID.toString()}/`;
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([
      fakeSite({
        id: STORE_ID,
        _id: STORE_ID.toString(),
        materializedPath: `${rootPath}${STORE_ID.toString()}/`,
      }),
    ]);
    const updateColumns: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    const rollupSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "recomputeRollupForSiteAndAncestors",
    );

    await (NetworkSiteService as any).onDeleteSuccess(
      {
        deleteBy: {
          query: {},
          props: { tenantId: PROJECT_ID },
        },
        carryForward: {
          sitesToDelete: [
            fakeSite({
              id: DISTRICT_ID,
              _id: DISTRICT_ID.toString(),
              materializedPath: rootPath,
            }),
          ],
        },
      },
      [DISTRICT_ID],
    );

    const storeWrite: any = updateColumns.mock.calls[0]![0];
    expect(storeWrite.data.materializedPath).toBe(`/${STORE_ID.toString()}/`);
    expect(storeWrite.data.depth).toBe(0);
    expect(storeWrite.data.parentSiteId).toBeNull();
    expect(rollupSpy).not.toHaveBeenCalled();
  });

  it("repairs nothing for sites the permission-checked delete did not remove", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "findBy",
    );
    const updateColumns: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "updateColumnsByIdWithoutHooks",
    );

    await (NetworkSiteService as any).onDeleteSuccess(
      {
        deleteBy: {
          query: { _id: DISTRICT_ID.toString() },
          props: { tenantId: PROJECT_ID },
        },
        carryForward: { sitesToDelete: [deletedDistrict()] },
      },
      [], // nothing was actually deleted
    );

    expect(findBySpy).not.toHaveBeenCalled();
    expect(updateColumns).not.toHaveBeenCalled();
  });

  it("NEVER throws - a repair failure is logged, not propagated", async () => {
    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      (NetworkSiteService as any).onDeleteSuccess(
        {
          deleteBy: {
            query: { _id: DISTRICT_ID.toString() },
            props: { tenantId: PROJECT_ID },
          },
          carryForward: { sitesToDelete: [deletedDistrict()] },
        },
        [DISTRICT_ID],
      ),
    ).resolves.toBeDefined();
  });
});

describe("NetworkSiteService hierarchy mutation lock", () => {
  const runThroughLock: (data: {
    operation: () => Promise<unknown>;
  }) => Promise<unknown> = async (data: {
    operation: () => Promise<unknown>;
  }): Promise<unknown> => {
    return await data.operation();
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses the shared project lock around create", async () => {
    const site: NetworkSite = fakeSite({});
    const runExclusiveSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteHierarchyLock, "runExclusive")
      .mockImplementation(runThroughLock as never);
    const superCreateSpy: jest.SpyInstance = jest
      .spyOn(DatabaseService.prototype, "create")
      .mockResolvedValue(site);

    await expect(
      NetworkSiteService.create({
        data: site,
        props: { isRoot: true },
      }),
    ).resolves.toBe(site);

    expect(runExclusiveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectIds: [PROJECT_ID] }),
    );
    expect(runExclusiveSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      superCreateSpy.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    ["parentSiteId", PARENT_SITE_ID],
    ["networkSiteTypeId", CHILD_SITE_TYPE_ID],
    ["projectId", PROJECT_ID],
    ["depth", 0],
  ])(
    "locks an update that changes %s",
    async (field: string, value: ObjectID | number) => {
      const runExclusiveSpy: jest.SpyInstance = jest
        .spyOn(NetworkSiteHierarchyLock, "runExclusive")
        .mockImplementation(runThroughLock as never);
      const findBySpy: jest.SpyInstance = jest
        .spyOn(NetworkSiteService, "findBy")
        .mockResolvedValue([fakeSite({})]);
      const superUpdateSpy: jest.SpyInstance = jest
        .spyOn(DatabaseService.prototype, "updateOneBy")
        .mockResolvedValue(1);

      await expect(
        NetworkSiteService.updateOneBy({
          query: { _id: SITE_ID.toString() },
          data: { [field]: value },
          props: { isRoot: true },
        } as any),
      ).resolves.toBe(1);

      expect(findBySpy).toHaveBeenCalledWith(
        expect.objectContaining({ select: { projectId: true } }),
      );
      expect(runExclusiveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ projectIds: [PROJECT_ID] }),
      );
      expect(superUpdateSpy).toHaveBeenCalledTimes(1);
    },
  );

  it("locks deletes with the same project key used by type mutations", async () => {
    const runExclusiveSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteHierarchyLock, "runExclusive")
      .mockImplementation(runThroughLock as never);
    jest.spyOn(NetworkSiteService, "findBy").mockResolvedValue([fakeSite({})]);
    jest.spyOn(DatabaseService.prototype, "deleteOneBy").mockResolvedValue(1);

    await expect(
      NetworkSiteService.deleteOneBy({
        query: { _id: SITE_ID.toString() },
        props: { isRoot: true },
      }),
    ).resolves.toBe(1);

    expect(runExclusiveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectIds: [PROJECT_ID] }),
    );
  });

  it("bypasses the lock for rollup-only and ignoreHooks updates", async () => {
    const runExclusiveSpy: jest.SpyInstance = jest.spyOn(
      NetworkSiteHierarchyLock,
      "runExclusive",
    );
    const superUpdateSpy: jest.SpyInstance = jest
      .spyOn(DatabaseService.prototype, "updateOneBy")
      .mockResolvedValue(1);

    await NetworkSiteService.updateOneBy({
      query: { _id: SITE_ID.toString() },
      data: { lastRollupAt: new Date() },
      props: { isRoot: true },
    });
    await NetworkSiteService.updateOneBy({
      query: { _id: SITE_ID.toString() },
      data: { parentSiteId: PARENT_SITE_ID },
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(runExclusiveSpy).not.toHaveBeenCalled();
    expect(superUpdateSpy).toHaveBeenCalledTimes(2);
  });

  it("rejects an unscoped root hierarchy bulk mutation before writing", async () => {
    const superUpdateSpy: jest.SpyInstance = jest.spyOn(
      DatabaseService.prototype,
      "updateBy",
    );

    await expect(
      NetworkSiteService.updateBy({
        query: { name: "Any matching site" },
        data: { parentSiteId: null },
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(NETWORK_SITE_HIERARCHY_ROOT_SCOPE_ERROR_MESSAGE);

    expect(superUpdateSpy).not.toHaveBeenCalled();
  });

  it("rejects an open-ended root update even when root supplies tenantId", async () => {
    const superUpdateSpy: jest.SpyInstance = jest.spyOn(
      DatabaseService.prototype,
      "updateBy",
    );

    await expect(
      NetworkSiteService.updateBy({
        query: { name: "Any matching site" },
        data: { parentSiteId: null },
        limit: 10,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(NETWORK_SITE_HIERARCHY_ROOT_SCOPE_ERROR_MESSAGE);

    expect(superUpdateSpy).not.toHaveBeenCalled();
  });

  it("rejects an open-ended root write to a materialized hierarchy field", async () => {
    const superUpdateSpy: jest.SpyInstance = jest.spyOn(
      DatabaseService.prototype,
      "updateBy",
    );

    await expect(
      NetworkSiteService.updateBy({
        query: { name: "Any matching site" },
        data: { depth: 0 },
        limit: 10,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(NETWORK_SITE_HIERARCHY_ROOT_SCOPE_ERROR_MESSAGE);

    expect(superUpdateSpy).not.toHaveBeenCalled();
  });

  it("turns the retention cron's open root query into a leaf-only ID batch", async () => {
    const parentId: ObjectID = PARENT_SITE_ID;
    const leafId: ObjectID = SITE_ID;
    const retentionQuery: any = { deletedAt: { olderThanThirtyDays: true } };

    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockImplementation(async (findBy: any) => {
        if (findBy.query?.parentSiteId) {
          return [
            fakeSite({
              id: leafId,
              _id: leafId.toString(),
              parentSiteId: parentId,
            }),
          ];
        }

        if (findBy.skip > 0) {
          return [];
        }

        return [
          fakeSite({ id: parentId, _id: parentId.toString() }),
          fakeSite({ id: leafId, _id: leafId.toString() }),
        ];
      });
    const runExclusiveSpy: jest.SpyInstance = jest
      .spyOn(NetworkSiteHierarchyLock, "runExclusive")
      .mockImplementation(runThroughLock as never);
    const superHardDeleteSpy: jest.SpyInstance = jest
      .spyOn(DatabaseService.prototype, "hardDeleteBy")
      .mockResolvedValue(1);

    await expect(
      NetworkSiteService.hardDeleteBy({
        query: retentionQuery,
        limit: 2,
        skip: 0,
        props: { isRoot: true },
      } as DeleteBy<NetworkSite>),
    ).resolves.toBe(1);

    expect(runExclusiveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectIds: [PROJECT_ID] }),
    );
    const closedDelete: any = superHardDeleteSpy.mock.calls[0]![0];
    expect(closedDelete.query.deletedAt).toBe(retentionQuery.deletedAt);
    expect(
      Object.values(closedDelete.query._id.objectLiteralParameters)[0],
    ).toEqual([leafId.toString()]);
    expect(closedDelete.limit).toBe(1);
    expect(closedDelete.skip).toBe(0);
  });
});
