/*
 * StatusPageService monitor-group batching.
 *
 * Public status-page reads (overview, badge, subscriber reports) used to
 * issue one MonitorGroupResource query PER STATUS PAGE RESOURCE (not even per
 * distinct group) and re-fetch the page's StatusPageResource rows the caller
 * already had in hand. These tests pin the two batched entry points:
 *   - getMonitorIdsOnStatusPage: skips the StatusPageResource query entirely
 *     when the caller supplies the rows, resolves ALL groups through ONE
 *     MonitorGroupService.getMonitorIdsInMonitorGroups call, and de-dupes a
 *     monitor that is both directly on the page and inside a group,
 *   - getMonitorGroupCurrentStatuses: one batched group-resource fetch for
 *     any number of resources (including repeated references to the same
 *     group), while keeping its OWN worst-status semantics (see below).
 *
 * SEMANTICS NOTE (deliberate, preserved as-is by the batching change):
 * StatusPageService.getMonitorGroupCurrentStatuses picks the LOWEST
 * priority-number status as "worst" and produces NO entry for a group whose
 * member statuses cannot be resolved — the exact OPPOSITE of
 * MonitorGroupService.getCurrentStatus(es), where the HIGHEST priority number
 * wins on top of an operational default. Both behaviors predate the batching
 * and both are pinned so neither can silently converge on the other.
 *
 * All service reads are spied on — no database is touched.
 */

import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

function makeStatusPageResource(data: {
  monitorId?: ObjectID | undefined;
  monitorGroupId?: ObjectID | undefined;
}): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  if (data.monitorId) {
    resource.monitorId = data.monitorId;
  }
  if (data.monitorGroupId) {
    resource.monitorGroupId = data.monitorGroupId;
  }
  return resource;
}

function makeGroupResource(data: {
  monitorGroupId: ObjectID;
  monitorId?: ObjectID | undefined;
  currentMonitorStatusId?: ObjectID | undefined;
  omitMonitor?: boolean;
}): MonitorGroupResource {
  const resource: MonitorGroupResource = new MonitorGroupResource();
  resource.monitorGroupId = data.monitorGroupId;
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

function makeStatus(data: { priority: number; name: string }): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = ObjectID.generate();
  status.priority = data.priority;
  status.name = data.name;
  return status;
}

function toStrings(ids: Array<ObjectID>): Array<string> {
  return ids.map((id: ObjectID) => {
    return id.toString();
  });
}

describe("StatusPageService monitor-group batching", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getMonitorIdsOnStatusPage", () => {
    test("supplied resources skip the StatusPageResource query; groups resolve via ONE batched call; direct+group monitor de-dupes", async () => {
      const statusPageId: ObjectID = ObjectID.generate();
      const groupA: ObjectID = ObjectID.generate();
      const groupB: ObjectID = ObjectID.generate();
      const directMonitor: ObjectID = ObjectID.generate();
      const groupOnlyMonitorA: ObjectID = ObjectID.generate();
      const groupOnlyMonitorB: ObjectID = ObjectID.generate();

      const statusPageResources: Array<StatusPageResource> = [
        // Direct monitor, no group: must contribute no group lookup.
        makeStatusPageResource({ monitorId: directMonitor }),
        makeStatusPageResource({ monitorGroupId: groupA }),
        makeStatusPageResource({ monitorGroupId: groupB }),
      ];

      const getResourcesSpy: jest.SpyInstance = jest.spyOn(
        StatusPageService,
        "getStatusPageResources",
      ) as unknown as jest.SpyInstance;
      const findBySpy: jest.SpyInstance = jest.spyOn(
        StatusPageResourceService,
        "findBy",
      ) as unknown as jest.SpyInstance;
      const batchedSpy: jest.SpyInstance = (
        jest.spyOn(
          MonitorGroupService,
          "getMonitorIdsInMonitorGroups",
        ) as unknown as jest.SpyInstance
      ).mockResolvedValue({
        // groupA contains the direct monitor too — it must appear only once.
        [groupA.toString()]: [directMonitor, groupOnlyMonitorA],
        [groupB.toString()]: [groupOnlyMonitorB],
      } as never);

      const result: {
        monitorsOnStatusPage: Array<ObjectID>;
        monitorsInGroup: Dictionary<Array<ObjectID>>;
      } = await StatusPageService.getMonitorIdsOnStatusPage({
        statusPageId: statusPageId,
        statusPageResources: statusPageResources,
      });

      // Supplied rows mean the (identical) StatusPageResource query never runs.
      expect(getResourcesSpy).not.toHaveBeenCalled();
      expect(findBySpy).not.toHaveBeenCalled();

      // ONE batched group lookup for all groups; null groupIds filtered out.
      expect(batchedSpy).toHaveBeenCalledTimes(1);
      expect(
        toStrings(batchedSpy.mock.calls[0]![0] as Array<ObjectID>),
      ).toEqual(toStrings([groupA, groupB]));

      // Union of direct + group monitors, without duplicating directMonitor.
      expect(toStrings(result.monitorsOnStatusPage)).toEqual(
        toStrings([directMonitor, groupOnlyMonitorA, groupOnlyMonitorB]),
      );

      // The per-group membership dict is passed through exactly.
      expect(Object.keys(result.monitorsInGroup).sort()).toEqual(
        [groupA.toString(), groupB.toString()].sort(),
      );
      expect(toStrings(result.monitorsInGroup[groupA.toString()]!)).toEqual(
        toStrings([directMonitor, groupOnlyMonitorA]),
      );
      expect(toStrings(result.monitorsInGroup[groupB.toString()]!)).toEqual(
        toStrings([groupOnlyMonitorB]),
      );
    });

    test("without supplied resources it fetches them once itself", async () => {
      const statusPageId: ObjectID = ObjectID.generate();
      const directMonitor: ObjectID = ObjectID.generate();

      const getResourcesSpy: jest.SpyInstance = (
        jest.spyOn(
          StatusPageService,
          "getStatusPageResources",
        ) as unknown as jest.SpyInstance
      ).mockResolvedValue([
        makeStatusPageResource({ monitorId: directMonitor }),
      ] as never);
      const batchedSpy: jest.SpyInstance = (
        jest.spyOn(
          MonitorGroupService,
          "getMonitorIdsInMonitorGroups",
        ) as unknown as jest.SpyInstance
      ).mockResolvedValue({} as never);

      const result: {
        monitorsOnStatusPage: Array<ObjectID>;
        monitorsInGroup: Dictionary<Array<ObjectID>>;
      } = await StatusPageService.getMonitorIdsOnStatusPage({
        statusPageId: statusPageId,
      });

      expect(getResourcesSpy).toHaveBeenCalledTimes(1);
      expect(getResourcesSpy).toHaveBeenCalledWith({
        statusPageId: statusPageId,
      });
      expect(batchedSpy).toHaveBeenCalledTimes(1);
      expect(batchedSpy).toHaveBeenCalledWith([]);
      expect(toStrings(result.monitorsOnStatusPage)).toEqual(
        toStrings([directMonitor]),
      );
      expect(result.monitorsInGroup).toEqual({});
    });
  });

  describe("getMonitorGroupCurrentStatuses", () => {
    const statusOperational: MonitorStatus = makeStatus({
      priority: 1,
      name: "Operational",
    });
    const statusDegraded: MonitorStatus = makeStatus({
      priority: 2,
      name: "Degraded",
    });
    const statusOffline: MonitorStatus = makeStatus({
      priority: 3,
      name: "Offline",
    });
    const allStatuses: Array<MonitorStatus> = [
      statusOperational,
      statusDegraded,
      statusOffline,
    ];

    test("one batched fetch for many resources; LOWEST priority number wins; direct/unresolvable groups get no entry", async () => {
      const groupA: ObjectID = ObjectID.generate();
      const groupB: ObjectID = ObjectID.generate();

      const statusPageResources: Array<StatusPageResource> = [
        makeStatusPageResource({ monitorGroupId: groupA }),
        makeStatusPageResource({ monitorGroupId: groupB }),
        // The same group referenced twice must not trigger a second fetch.
        makeStatusPageResource({ monitorGroupId: groupA }),
        // Direct monitor resource: contributes no group, gets no entry.
        makeStatusPageResource({ monitorId: ObjectID.generate() }),
      ];

      const batchedSpy: jest.SpyInstance = (
        jest.spyOn(
          MonitorGroupService,
          "getMonitorGroupResourcesByGroupIds",
        ) as unknown as jest.SpyInstance
      ).mockResolvedValue({
        [groupA.toString()]: [
          makeGroupResource({
            monitorGroupId: groupA,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: statusDegraded.id!,
          }),
          makeGroupResource({
            monitorGroupId: groupA,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: statusOffline.id!,
          }),
          /*
           * Would be the "worst" under these semantics (lowest number), but
           * the row has no monitorId, so the filter must drop it.
           */
          makeGroupResource({
            monitorGroupId: groupA,
            currentMonitorStatusId: statusOperational.id!,
          }),
          // No monitor relation loaded: filtered out.
          makeGroupResource({
            monitorGroupId: groupA,
            monitorId: ObjectID.generate(),
            omitMonitor: true,
          }),
        ],
        // groupB's only member points at a status that no longer exists.
        [groupB.toString()]: [
          makeGroupResource({
            monitorGroupId: groupB,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: ObjectID.generate(),
          }),
        ],
      } as never);

      const result: Dictionary<ObjectID> =
        await StatusPageService.getMonitorGroupCurrentStatuses({
          statusPageResources: statusPageResources,
          monitorStatuses: allStatuses,
        });

      // ONE batched query serves every resource on the page.
      expect(batchedSpy).toHaveBeenCalledTimes(1);
      /*
       * The raw (non-deduped, null-filtered) group id list is handed to the
       * helper — deduping is the helper's job, pinned in its own suite.
       */
      expect(
        toStrings(batchedSpy.mock.calls[0]![0] as Array<ObjectID>),
      ).toEqual(toStrings([groupA, groupB, groupA]));

      /*
       * StatusPageService semantics: the LOWEST priority number is "worst",
       * so Degraded (2) beats Offline (3). This is the OPPOSITE of
       * MonitorGroupService.getCurrentStatus(es), where the HIGHEST number
       * wins — both pre-existing behaviors are preserved as-is by the
       * batching change, and this assertion keeps them from converging.
       */
      expect(result[groupA.toString()]).toBeInstanceOf(ObjectID);
      expect(result[groupA.toString()]!.toString()).toBe(
        statusDegraded.id!.toString(),
      );

      // No resolvable member status -> NO dict entry (no operational default).
      expect(result[groupB.toString()]).toBeUndefined();
      // Direct-monitor resources never produce group entries.
      expect(Object.keys(result)).toEqual([groupA.toString()]);
    });

    test("no group resources at all yields an empty dictionary", async () => {
      const batchedSpy: jest.SpyInstance = (
        jest.spyOn(
          MonitorGroupService,
          "getMonitorGroupResourcesByGroupIds",
        ) as unknown as jest.SpyInstance
      ).mockResolvedValue({} as never);

      const result: Dictionary<ObjectID> =
        await StatusPageService.getMonitorGroupCurrentStatuses({
          statusPageResources: [
            makeStatusPageResource({ monitorId: ObjectID.generate() }),
          ],
          monitorStatuses: allStatuses,
        });

      expect(result).toEqual({});
      // Still exactly one batched call (with an empty id list).
      expect(batchedSpy).toHaveBeenCalledTimes(1);
      expect(batchedSpy).toHaveBeenCalledWith([]);
    });
  });
});
