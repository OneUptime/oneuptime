import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import NetworkSiteStatusTimelineService from "../../../Server/Services/NetworkSiteStatusTimelineService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
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
import { describe, expect, it, afterEach } from "@jest/globals";

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

function fakeSite(overrides: Record<string, unknown>): NetworkSite {
  return {
    id: SITE_ID,
    _id: SITE_ID.toString(),
    projectId: PROJECT_ID,
    ...overrides,
  } as unknown as NetworkSite;
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
    deviceFindBy: jest.SpyInstance;
    descendantSiteIds: jest.SpyInstance;
  }

  function setupRollup(data: {
    site: NetworkSite | null;
    devices: Array<NetworkDevice>;
  }): RollupSpies {
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(data.site);
    const descendantSiteIds: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "getDescendantSiteIds")
      .mockResolvedValue([]);
    const deviceFindBy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue(data.devices);
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
      deviceFindBy,
      descendantSiteIds,
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

  it("uses the freshness fallback for devices without a stamped status", async () => {
    const spies: RollupSpies = setupRollup({
      site: fakeSite({ currentMonitorStatusId: OPERATIONAL_STATUS_ID }),
      devices: [
        {
          id: DEVICE_ID,
          // Unmonitored and last seen an hour ago -> offline equivalent.
          lastSeenAt: new Date(Date.now() - 60 * 60 * 1000),
        },
      ] as unknown as Array<NetworkDevice>,
    });

    await NetworkSiteService.recomputeRollupForSite(SITE_ID);

    const updateArgs: any = spies.updateColumns.mock.calls[0]![0];
    expect(updateArgs.data.currentMonitorStatusId.toString()).toBe(
      OFFLINE_STATUS_ID.toString(),
    );
  });

  it("does nothing when the site does not exist", async () => {
    const spies: RollupSpies = setupRollup({ site: null, devices: [] });

    await NetworkSiteService.recomputeRollupForSite(SITE_ID);

    expect(spies.updateColumns).not.toHaveBeenCalled();
    expect(spies.timelineUpdateBy).not.toHaveBeenCalled();
    expect(spies.timelineCreate).not.toHaveBeenCalled();
  });

  /*
   * An archived device is decommissioned: it keeps its siteId but must not
   * vote. Without this filter an archived, never-monitored device hits the
   * freshness fallback and pins its whole ancestor chain Offline forever.
   */
  it("excludes archived devices from the subtree scan", async () => {
    const spies: RollupSpies = setupRollup({
      site: fakeSite({ currentMonitorStatusId: OPERATIONAL_STATUS_ID }),
      devices: [],
    });

    await NetworkSiteService.recomputeRollupForSite(SITE_ID);

    expect(spies.deviceFindBy).toHaveBeenCalledTimes(1);
    const deviceQuery: any = spies.deviceFindBy.mock.calls[0]![0].query;
    expect(deviceQuery.isArchived).toBe(false);
    expect(deviceQuery.projectId.toString()).toBe(PROJECT_ID.toString());
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
    jest
      .spyOn(NetworkSiteService, "findBy")
      .mockResolvedValue([
        fakeSite({ materializedPath: `/${SITE_ID.toString()}/` }),
      ]);
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
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

  it("carries the parent path forward for a same-project parent", async () => {
    jest.spyOn(NetworkSiteService, "findOneById").mockResolvedValue(
      fakeSite({
        id: PARENT_SITE_ID,
        _id: PARENT_SITE_ID.toString(),
      }),
    );
    jest
      .spyOn(NetworkSiteService, "getMaterializedPathForSite")
      .mockResolvedValue(`/${PARENT_SITE_ID.toString()}/`);

    const result: any = await (NetworkSiteService as any).onBeforeCreate({
      data: {
        projectId: PROJECT_ID,
        parentSiteId: PARENT_SITE_ID,
      },
      props: { tenantId: PROJECT_ID },
    });

    expect(result.carryForward.parentPath).toBe(
      `/${PARENT_SITE_ID.toString()}/`,
    );
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
    const deviceFindBySpy: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "findBy",
    );

    await NetworkSiteService.onMonitorStatusChanged({
      projectId: PROJECT_ID,
      monitorIds: [MONITOR_ID],
      monitorStatusId: OFFLINE_STATUS_ID,
    });

    expect(deviceFindBySpy).not.toHaveBeenCalled();
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
 * parentSiteId is onDelete: "SET NULL", so deleting a mid-tree site detaches
 * its children but strands their materializedPath through the dead row -
 * leaving the children endpoint (parentSiteId) and the rollup engine
 * (materializedPath) disagreeing, and double-counting the subtree's outages.
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
