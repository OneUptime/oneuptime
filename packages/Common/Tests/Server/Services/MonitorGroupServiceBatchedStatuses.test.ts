/*
 * MonitorGroupService batched status helpers.
 *
 * The public status-page read paths used to issue one MonitorGroupResource
 * query per monitor group per page view (plus a MonitorGroup and a
 * MonitorStatus fetch each in getCurrentStatus) — an N+1 of 3-4 queries per
 * group per request. getMonitorGroupResourcesByGroupIds /
 * getMonitorIdsInMonitorGroups / getCurrentStatusesForMonitorGroups collapse
 * that to at most ONE batched query. These tests pin:
 *   - exactly one findAllBy regardless of group count, keyed by
 *     QueryHelper.any over DEDUPED ids, with an entry ([] if empty) per
 *     requested group and zero queries for empty input,
 *   - getCurrentStatusesForMonitorGroups preserving getCurrentStatus's EXACT
 *     semantics (operational default, HIGHER priority number wins, throws
 *     when no operational state exists), including a direct equivalence check
 *     against the single-group path so the two cannot silently drift, and
 *   - no resource fetch at all when the caller already supplies the
 *     group-resource dictionary.
 *
 * All service reads are spied on — no database is touched.
 */

import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import MonitorGroupResourceService from "../../../Server/Services/MonitorGroupResourceService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

function makeStatus(data: {
  priority: number;
  isOperationalState?: boolean;
  name?: string;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = ObjectID.generate();
  status.priority = data.priority;
  status.isOperationalState = data.isOperationalState || false;
  status.name = data.name || `status-p${data.priority}`;
  return status;
}

function makeGroupResource(data: {
  monitorGroupId?: ObjectID | undefined;
  monitorId?: ObjectID | undefined;
  currentMonitorStatusId?: ObjectID | undefined;
  omitMonitor?: boolean;
}): MonitorGroupResource {
  const resource: MonitorGroupResource = new MonitorGroupResource();
  if (data.monitorGroupId) {
    resource.monitorGroupId = data.monitorGroupId;
  }
  if (data.monitorId) {
    resource.monitorId = data.monitorId;
  }
  if (!data.omitMonitor) {
    const monitor: Monitor = new Monitor();
    if (data.currentMonitorStatusId) {
      monitor.currentMonitorStatusId = data.currentMonitorStatusId;
    }
    resource.monitor = monitor;
  }
  return resource;
}

function spyOnFindAllBy(rows: Array<MonitorGroupResource>): jest.SpyInstance {
  return (
    jest.spyOn(
      MonitorGroupResourceService,
      "findAllBy",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue(rows as never);
}

function toStrings(ids: Array<ObjectID>): Array<string> {
  return ids.map((id: ObjectID) => {
    return id.toString();
  });
}

describe("MonitorGroupService batched status helpers", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getMonitorGroupResourcesByGroupIds", () => {
    test("issues exactly one findAllBy for N groups, keyed by QueryHelper.any over deduped ids", async () => {
      const groupA: ObjectID = ObjectID.generate();
      const groupB: ObjectID = ObjectID.generate();
      const groupC: ObjectID = ObjectID.generate();

      const rowA1: MonitorGroupResource = makeGroupResource({
        monitorGroupId: groupA,
        monitorId: ObjectID.generate(),
      });
      const rowA2: MonitorGroupResource = makeGroupResource({
        monitorGroupId: groupA,
        monitorId: ObjectID.generate(),
      });
      const rowB1: MonitorGroupResource = makeGroupResource({
        monitorGroupId: groupB,
        monitorId: ObjectID.generate(),
      });
      // Defensive-guard row: a row without monitorGroupId must be dropped, not crash.
      const rowNoGroup: MonitorGroupResource = makeGroupResource({
        monitorId: ObjectID.generate(),
      });

      const findAllBySpy: jest.SpyInstance = spyOnFindAllBy([
        rowA1,
        rowB1,
        rowA2,
        rowNoGroup,
      ]);
      const anySpy: jest.SpyInstance = jest.spyOn(
        QueryHelper,
        "any",
      ) as unknown as jest.SpyInstance;

      const result: Dictionary<Array<MonitorGroupResource>> =
        await MonitorGroupService.getMonitorGroupResourcesByGroupIds([
          groupA,
          groupB,
          groupA, // duplicate must collapse
          groupC,
          groupB, // duplicate must collapse
        ]);

      // The whole point of the batching: ONE query for all groups.
      expect(findAllBySpy).toHaveBeenCalledTimes(1);

      // The IN-list is built via QueryHelper.any over DEDUPED ids, in first-seen order.
      expect(anySpy).toHaveBeenCalledTimes(1);
      expect(toStrings(anySpy.mock.calls[0]![0] as Array<ObjectID>)).toEqual(
        toStrings([groupA, groupB, groupC]),
      );

      const callArg: any = findAllBySpy.mock.calls[0]![0];
      // The exact FindOperator QueryHelper.any built is what findAllBy receives.
      expect(callArg.query.monitorGroupId).toBe(anySpy.mock.results[0]!.value);
      // The select must carry the grouping key and the member's current status.
      expect(callArg.select).toEqual({
        monitorGroupId: true,
        monitorId: true,
        monitor: {
          currentMonitorStatusId: true,
        },
      });
      expect(callArg.props).toEqual({ isRoot: true });

      // Every requested group gets an entry; a group with no rows gets [].
      expect(Object.keys(result).sort()).toEqual(
        [groupA.toString(), groupB.toString(), groupC.toString()].sort(),
      );
      expect(result[groupA.toString()]).toEqual([rowA1, rowA2]);
      expect(result[groupB.toString()]).toEqual([rowB1]);
      expect(result[groupC.toString()]).toEqual([]);
    });

    test("empty input returns {} without querying at all", async () => {
      const findAllBySpy: jest.SpyInstance = spyOnFindAllBy([]);

      const result: Dictionary<Array<MonitorGroupResource>> =
        await MonitorGroupService.getMonitorGroupResourcesByGroupIds([]);

      expect(result).toEqual({});
      expect(findAllBySpy).not.toHaveBeenCalled();
    });
  });

  describe("getMonitorIdsInMonitorGroups", () => {
    test("maps rows to monitor ids, drops null monitorIds, keeps empty-group keys", async () => {
      const groupA: ObjectID = ObjectID.generate();
      const groupB: ObjectID = ObjectID.generate();
      const monitor1: ObjectID = ObjectID.generate();
      const monitor2: ObjectID = ObjectID.generate();

      spyOnFindAllBy([
        makeGroupResource({ monitorGroupId: groupA, monitorId: monitor1 }),
        // A resource row with no monitorId must not surface as a null id.
        makeGroupResource({ monitorGroupId: groupA }),
        makeGroupResource({ monitorGroupId: groupA, monitorId: monitor2 }),
      ]);

      const result: Dictionary<Array<ObjectID>> =
        await MonitorGroupService.getMonitorIdsInMonitorGroups([
          groupA,
          groupB,
        ]);

      expect(Object.keys(result).sort()).toEqual(
        [groupA.toString(), groupB.toString()].sort(),
      );
      expect(toStrings(result[groupA.toString()]!)).toEqual(
        toStrings([monitor1, monitor2]),
      );
      // The empty group still gets an (empty) entry — callers key off it.
      expect(result[groupB.toString()]).toEqual([]);
    });
  });

  describe("getCurrentStatusesForMonitorGroups", () => {
    const operational: MonitorStatus = makeStatus({
      priority: 2,
      isOperationalState: true,
      name: "Operational",
    });
    // Lower priority NUMBER than operational: must never replace it here.
    const lowerThanOperational: MonitorStatus = makeStatus({
      priority: 1,
      name: "Maintenance",
    });
    // Same priority number as operational: a tie must not replace either.
    const tiedWithOperational: MonitorStatus = makeStatus({
      priority: 2,
      name: "Degraded-Tie",
    });
    const degraded: MonitorStatus = makeStatus({
      priority: 3,
      name: "Degraded",
    });
    const offline: MonitorStatus = makeStatus({ priority: 4, name: "Offline" });
    const allStatuses: Array<MonitorStatus> = [
      operational,
      lowerThanOperational,
      tiedWithOperational,
      degraded,
      offline,
    ];

    test("empty group defaults to the operational status", async () => {
      const groupA: ObjectID = ObjectID.generate();
      spyOnFindAllBy([]);

      const result: Dictionary<MonitorStatus> =
        await MonitorGroupService.getCurrentStatusesForMonitorGroups({
          monitorGroupIds: [groupA],
          monitorStatuses: allStatuses,
        });

      expect(result[groupA.toString()]).toBe(operational);
    });

    test("a member with a HIGHER priority number replaces the current status; ties and lower do not", async () => {
      const groupHigh: ObjectID = ObjectID.generate();
      const groupTie: ObjectID = ObjectID.generate();
      const groupLower: ObjectID = ObjectID.generate();

      spyOnFindAllBy([
        makeGroupResource({
          monitorGroupId: groupHigh,
          monitorId: ObjectID.generate(),
          currentMonitorStatusId: degraded.id!,
        }),
        makeGroupResource({
          monitorGroupId: groupHigh,
          monitorId: ObjectID.generate(),
          currentMonitorStatusId: offline.id!,
        }),
        makeGroupResource({
          monitorGroupId: groupTie,
          monitorId: ObjectID.generate(),
          currentMonitorStatusId: tiedWithOperational.id!,
        }),
        makeGroupResource({
          monitorGroupId: groupLower,
          monitorId: ObjectID.generate(),
          currentMonitorStatusId: lowerThanOperational.id!,
        }),
      ]);

      const result: Dictionary<MonitorStatus> =
        await MonitorGroupService.getCurrentStatusesForMonitorGroups({
          monitorGroupIds: [groupHigh, groupTie, groupLower],
          monitorStatuses: allStatuses,
        });

      // In MonitorGroupService semantics the HIGHEST priority number wins.
      expect(result[groupHigh.toString()]).toBe(offline);
      // Strict `<` comparison: a tie keeps the operational default.
      expect(result[groupTie.toString()]).toBe(operational);
      // A lower priority number never demotes the operational default.
      expect(result[groupLower.toString()]).toBe(operational);
    });

    test("members with unknown statuses or missing monitor relation are ignored", async () => {
      const groupA: ObjectID = ObjectID.generate();

      spyOnFindAllBy([
        // Status id that resolves to nothing in monitorStatuses.
        makeGroupResource({
          monitorGroupId: groupA,
          monitorId: ObjectID.generate(),
          currentMonitorStatusId: ObjectID.generate(),
        }),
        // No monitor relation loaded at all.
        makeGroupResource({
          monitorGroupId: groupA,
          monitorId: ObjectID.generate(),
          omitMonitor: true,
        }),
      ]);

      const result: Dictionary<MonitorStatus> =
        await MonitorGroupService.getCurrentStatusesForMonitorGroups({
          monitorGroupIds: [groupA],
          monitorStatuses: allStatuses,
        });

      expect(result[groupA.toString()]).toBe(operational);
    });

    test("throws 'Operational state not found.' when groups are requested but no operational status exists", async () => {
      const findAllBySpy: jest.SpyInstance = spyOnFindAllBy([]);

      await expect(
        MonitorGroupService.getCurrentStatusesForMonitorGroups({
          monitorGroupIds: [ObjectID.generate()],
          monitorStatuses: [degraded, offline],
        }),
      ).rejects.toThrow(new BadDataException("Operational state not found."));

      // The throw happens before any resource fetch is attempted.
      expect(findAllBySpy).not.toHaveBeenCalled();
    });

    test("empty group ids return {} without fetching, even when no operational status exists", async () => {
      const findAllBySpy: jest.SpyInstance = spyOnFindAllBy([]);
      const resourcesSpy: jest.SpyInstance = jest.spyOn(
        MonitorGroupService,
        "getMonitorGroupResourcesByGroupIds",
      ) as unknown as jest.SpyInstance;

      const result: Dictionary<MonitorStatus> =
        await MonitorGroupService.getCurrentStatusesForMonitorGroups({
          monitorGroupIds: [],
          // No operational entry: the empty-input early return wins over the throw.
          monitorStatuses: [degraded],
        });

      expect(result).toEqual({});
      expect(resourcesSpy).not.toHaveBeenCalled();
      expect(findAllBySpy).not.toHaveBeenCalled();
    });

    test("uses supplied monitorGroupResources without fetching", async () => {
      const groupA: ObjectID = ObjectID.generate();
      const findAllBySpy: jest.SpyInstance = spyOnFindAllBy([]);
      const resourcesSpy: jest.SpyInstance = jest.spyOn(
        MonitorGroupService,
        "getMonitorGroupResourcesByGroupIds",
      ) as unknown as jest.SpyInstance;

      const supplied: Dictionary<Array<MonitorGroupResource>> = {
        [groupA.toString()]: [
          makeGroupResource({
            monitorGroupId: groupA,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: offline.id!,
          }),
        ],
      };

      const result: Dictionary<MonitorStatus> =
        await MonitorGroupService.getCurrentStatusesForMonitorGroups({
          monitorGroupIds: [groupA],
          monitorStatuses: allStatuses,
          monitorGroupResources: supplied,
        });

      expect(result[groupA.toString()]).toBe(offline);
      expect(resourcesSpy).not.toHaveBeenCalled();
      expect(findAllBySpy).not.toHaveBeenCalled();
    });
  });

  describe("equivalence with the single-group getCurrentStatus path", () => {
    /*
     * The batched method claims to be an exact twin of getCurrentStatus. This
     * runs BOTH implementations over the same fixture (3 groups: empty /
     * partially degraded / offline-with-noise) and requires identical
     * per-group answers, so a semantic change to either path fails here.
     */
    test("returns the same status per group as getCurrentStatus", async () => {
      const projectId: ObjectID = ObjectID.generate();

      const operational: MonitorStatus = makeStatus({
        priority: 1,
        isOperationalState: true,
        name: "Operational",
      });
      const degraded: MonitorStatus = makeStatus({
        priority: 2,
        name: "Degraded",
      });
      const offline: MonitorStatus = makeStatus({
        priority: 3,
        name: "Offline",
      });
      const statuses: Array<MonitorStatus> = [operational, degraded, offline];

      const groupEmpty: ObjectID = ObjectID.generate();
      const groupDegraded: ObjectID = ObjectID.generate();
      const groupOffline: ObjectID = ObjectID.generate();

      const rowsByGroup: Dictionary<Array<MonitorGroupResource>> = {
        [groupEmpty.toString()]: [],
        [groupDegraded.toString()]: [
          makeGroupResource({
            monitorGroupId: groupDegraded,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: operational.id!,
          }),
          makeGroupResource({
            monitorGroupId: groupDegraded,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: degraded.id!,
          }),
        ],
        [groupOffline.toString()]: [
          makeGroupResource({
            monitorGroupId: groupOffline,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: offline.id!,
          }),
          makeGroupResource({
            monitorGroupId: groupOffline,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: degraded.id!,
          }),
          // Noise both paths must ignore: unknown status + missing relation.
          makeGroupResource({
            monitorGroupId: groupOffline,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: ObjectID.generate(),
          }),
          makeGroupResource({
            monitorGroupId: groupOffline,
            monitorId: ObjectID.generate(),
            omitMonitor: true,
          }),
        ],
      };

      // --- mocks for the single-group path (3 queries per group) ---
      (
        jest.spyOn(
          MonitorGroupService,
          "findOneById",
        ) as unknown as jest.SpyInstance
      ).mockImplementation((...args: Array<unknown>): Promise<MonitorGroup> => {
        const findOneById: { id: ObjectID } = args[0] as { id: ObjectID };
        const group: MonitorGroup = new MonitorGroup();
        group.id = findOneById.id;
        group.projectId = projectId;
        return Promise.resolve(group);
      });

      (
        jest.spyOn(
          MonitorGroupResourceService,
          "findBy",
        ) as unknown as jest.SpyInstance
      ).mockImplementation(
        (...args: Array<unknown>): Promise<Array<MonitorGroupResource>> => {
          const findBy: { query: { monitorGroupId: ObjectID } } = args[0] as {
            query: { monitorGroupId: ObjectID };
          };
          return Promise.resolve(
            rowsByGroup[findBy.query.monitorGroupId.toString()] || [],
          );
        },
      );

      (
        jest.spyOn(
          MonitorStatusService,
          "findBy",
        ) as unknown as jest.SpyInstance
      ).mockResolvedValue(statuses as never);

      // --- mock for the batched path (ONE query) ---
      spyOnFindAllBy([
        ...rowsByGroup[groupEmpty.toString()]!,
        ...rowsByGroup[groupDegraded.toString()]!,
        ...rowsByGroup[groupOffline.toString()]!,
      ]);

      const batched: Dictionary<MonitorStatus> =
        await MonitorGroupService.getCurrentStatusesForMonitorGroups({
          monitorGroupIds: [groupEmpty, groupDegraded, groupOffline],
          monitorStatuses: statuses,
        });

      for (const groupId of [groupEmpty, groupDegraded, groupOffline]) {
        const single: MonitorStatus =
          await MonitorGroupService.getCurrentStatus(groupId, { isRoot: true });
        expect(batched[groupId.toString()]).toBe(single);
      }

      // Anchor the shared expectation so both paths being wrong together fails too.
      expect(batched[groupEmpty.toString()]).toBe(operational);
      expect(batched[groupDegraded.toString()]).toBe(degraded);
      expect(batched[groupOffline.toString()]).toBe(offline);
    });
  });
});
