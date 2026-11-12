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
 *     group), each group asked for once.
 *
 * SEMANTICS NOTE: getMonitorGroupCurrentStatuses (what the embedded badge
 * reads) used to keep the LOWEST priority number among a group's monitors -
 * its best status - and no entry for a group whose member statuses it could
 * not resolve: the OPPOSITE of MonitorGroupService.getCurrentStatus(es),
 * which the page's own overview reads, where the HIGHEST priority number
 * wins on top of an operational default. So a badge read Operational for a
 * group the page showed as Offline. It now asks
 * MonitorGroupService.getCurrentStatusesForMonitorGroups, so the two agree,
 * and leaves out a group whose monitors all have monitoring off
 * (FrozenMonitorResources.withoutNotMonitoredMonitorGroups).
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
  // The monitor's monitoring switch, as read; unset: not read.
  disableActiveMonitoring?: boolean | undefined;
  isArchived?: boolean | undefined;
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
    if (data.disableActiveMonitoring !== undefined) {
      monitor.disableActiveMonitoring = data.disableActiveMonitoring;
    }
    if (data.isArchived !== undefined) {
      monitor.isArchived = data.isArchived;
    }
    resource.monitor = monitor;
  }
  return resource;
}

function makeStatus(data: {
  priority: number;
  name: string;
  isOperationalState?: boolean | undefined;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = ObjectID.generate();
  status.priority = data.priority;
  status.name = data.name;
  status.isOperationalState = Boolean(data.isOperationalState);
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
      isOperationalState: true,
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

    test("one batched fetch for many resources; the WORST status (highest priority number) wins; direct resources get no entry", async () => {
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
          makeGroupResource({
            monitorGroupId: groupA,
            currentMonitorStatusId: statusOperational.id!,
          }),
          // No monitor relation loaded: decides nothing.
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

      // ONE batched query serves every resource on the page, each group once.
      expect(batchedSpy).toHaveBeenCalledTimes(1);
      expect(
        toStrings(batchedSpy.mock.calls[0]![0] as Array<ObjectID>),
      ).toEqual(toStrings([groupA, groupB]));

      // Offline (3) beats Degraded (2): the group's worst status.
      expect(result[groupA.toString()]).toBeInstanceOf(ObjectID);
      expect(result[groupA.toString()]!.toString()).toBe(
        statusOffline.id!.toString(),
      );

      /*
       * No member status it knows: the operational status, as the group
       * reads everywhere else (MonitorGroupService.getCurrentStatus).
       */
      expect(result[groupB.toString()]!.toString()).toBe(
        statusOperational.id!.toString(),
      );

      // Direct-monitor resources never produce group entries.
      expect(Object.keys(result).sort()).toEqual(
        [groupA.toString(), groupB.toString()].sort(),
      );
    });

    /*
     * The badge used to keep the LOWEST priority number among a group's
     * monitors - its best status - while the page's own overview keeps the
     * worst (MonitorGroupService.getCurrentStatusesForMonitorGroups). So a
     * badge read Operational for a group the page showed as Offline.
     */
    test("a group with one Offline and one Operational monitor reads Offline, as the page shows it", async () => {
      const group: ObjectID = ObjectID.generate();
      const members: Dictionary<Array<MonitorGroupResource>> = {
        [group.toString()]: [
          makeGroupResource({
            monitorGroupId: group,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: statusOperational.id!,
            disableActiveMonitoring: false,
          }),
          makeGroupResource({
            monitorGroupId: group,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: statusOffline.id!,
            disableActiveMonitoring: false,
          }),
        ],
      };

      const badge: Dictionary<ObjectID> =
        await StatusPageService.getMonitorGroupCurrentStatuses({
          statusPageResources: [
            makeStatusPageResource({ monitorGroupId: group }),
          ],
          monitorStatuses: allStatuses,
          monitorGroupResources: members,
        });

      const page: Dictionary<MonitorStatus> =
        await MonitorGroupService.getCurrentStatusesForMonitorGroups({
          monitorGroupIds: [group],
          monitorStatuses: allStatuses,
          monitorGroupResources: members,
        });

      expect(badge[group.toString()]!.toString()).toBe(
        statusOffline.id!.toString(),
      );
      expect(badge[group.toString()]!.toString()).toBe(
        page[group.toString()]!.id!.toString(),
      );
    });

    test("asks MonitorGroupService for the statuses, with each group once and the members it was given", async () => {
      const groupA: ObjectID = ObjectID.generate();
      const groupB: ObjectID = ObjectID.generate();
      const members: Dictionary<Array<MonitorGroupResource>> = {
        [groupA.toString()]: [
          makeGroupResource({
            monitorGroupId: groupA,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: statusDegraded.id!,
          }),
        ],
        [groupB.toString()]: [
          makeGroupResource({
            monitorGroupId: groupB,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: statusOffline.id!,
          }),
        ],
      };

      const statusesSpy: jest.SpyInstance = jest.spyOn(
        MonitorGroupService,
        "getCurrentStatusesForMonitorGroups",
      ) as unknown as jest.SpyInstance;

      const result: Dictionary<ObjectID> =
        await StatusPageService.getMonitorGroupCurrentStatuses({
          statusPageResources: [
            makeStatusPageResource({ monitorGroupId: groupA }),
            makeStatusPageResource({ monitorGroupId: groupB }),
            makeStatusPageResource({ monitorGroupId: groupA }),
          ],
          monitorStatuses: allStatuses,
          monitorGroupResources: members,
        });

      expect(statusesSpy).toHaveBeenCalledTimes(1);

      const call: {
        monitorGroupIds: Array<ObjectID>;
        monitorStatuses: Array<MonitorStatus>;
        monitorGroupResources: Dictionary<Array<MonitorGroupResource>>;
      } = statusesSpy.mock.calls[0]![0] as {
        monitorGroupIds: Array<ObjectID>;
        monitorStatuses: Array<MonitorStatus>;
        monitorGroupResources: Dictionary<Array<MonitorGroupResource>>;
      };

      expect(toStrings(call.monitorGroupIds)).toEqual(
        toStrings([groupA, groupB]),
      );
      expect(call.monitorStatuses).toBe(allStatuses);
      expect(call.monitorGroupResources).toBe(members);

      expect(result[groupA.toString()]!.toString()).toBe(
        statusDegraded.id!.toString(),
      );
      expect(result[groupB.toString()]!.toString()).toBe(
        statusOffline.id!.toString(),
      );
    });

    /*
     * Issue #6478: a member nothing checks - its monitoring is off, or it
     * is archived - holds a frozen status, so it decides nothing: the
     * group's status (what the embedded badge reads) comes from the members
     * still checked, and a group whose members are all off has no entry.
     */
    test("a member whose monitoring is off decides nothing: the status comes from the members still checked", async () => {
      const group: ObjectID = ObjectID.generate();

      (
        jest.spyOn(
          MonitorGroupService,
          "getMonitorGroupResourcesByGroupIds",
        ) as unknown as jest.SpyInstance
      ).mockResolvedValue({
        [group.toString()]: [
          // Would win (the worst), but nothing checks it: its Offline is frozen.
          makeGroupResource({
            monitorGroupId: group,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: statusOffline.id!,
            disableActiveMonitoring: true,
          }),
          makeGroupResource({
            monitorGroupId: group,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: statusDegraded.id!,
            disableActiveMonitoring: false,
          }),
        ],
      } as never);

      const result: Dictionary<ObjectID> =
        await StatusPageService.getMonitorGroupCurrentStatuses({
          statusPageResources: [
            makeStatusPageResource({ monitorGroupId: group }),
          ],
          monitorStatuses: allStatuses,
        });

      expect(result[group.toString()]?.toString()).toBe(
        statusDegraded.id!.toString(),
      );
    });

    test("a group whose members all have monitoring off gets no entry, so it colors nothing", async () => {
      const allOff: ObjectID = ObjectID.generate();
      const checked: ObjectID = ObjectID.generate();

      (
        jest.spyOn(
          MonitorGroupService,
          "getMonitorGroupResourcesByGroupIds",
        ) as unknown as jest.SpyInstance
      ).mockResolvedValue({
        [allOff.toString()]: [
          makeGroupResource({
            monitorGroupId: allOff,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: statusOffline.id!,
            disableActiveMonitoring: true,
          }),
          makeGroupResource({
            monitorGroupId: allOff,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: statusDegraded.id!,
            disableActiveMonitoring: true,
          }),
        ],
        [checked.toString()]: [
          makeGroupResource({
            monitorGroupId: checked,
            monitorId: ObjectID.generate(),
            currentMonitorStatusId: statusOperational.id!,
            disableActiveMonitoring: false,
          }),
        ],
      } as never);

      const result: Dictionary<ObjectID> =
        await StatusPageService.getMonitorGroupCurrentStatuses({
          statusPageResources: [
            makeStatusPageResource({ monitorGroupId: allOff }),
            makeStatusPageResource({ monitorGroupId: checked }),
          ],
          monitorStatuses: allStatuses,
        });

      expect(result[allOff.toString()]).toBeUndefined();
      expect(result[checked.toString()]?.toString()).toBe(
        statusOperational.id!.toString(),
      );
      expect(Object.keys(result)).toEqual([checked.toString()]);
    });

    test("an archived member decides nothing either, wherever the members came from", async () => {
      const group: ObjectID = ObjectID.generate();

      const result: Dictionary<ObjectID> =
        await StatusPageService.getMonitorGroupCurrentStatuses({
          statusPageResources: [
            makeStatusPageResource({ monitorGroupId: group }),
          ],
          monitorStatuses: allStatuses,
          monitorGroupResources: {
            [group.toString()]: [
              // Would win (the worst), but it is archived.
              makeGroupResource({
                monitorGroupId: group,
                monitorId: ObjectID.generate(),
                currentMonitorStatusId: statusOffline.id!,
                isArchived: true,
              }),
              makeGroupResource({
                monitorGroupId: group,
                monitorId: ObjectID.generate(),
                currentMonitorStatusId: statusDegraded.id!,
              }),
            ],
          },
        });

      expect(result[group.toString()]?.toString()).toBe(
        statusDegraded.id!.toString(),
      );
    });

    test("a member read without the switch counts as checked", async () => {
      const group: ObjectID = ObjectID.generate();

      const result: Dictionary<ObjectID> =
        await StatusPageService.getMonitorGroupCurrentStatuses({
          statusPageResources: [
            makeStatusPageResource({ monitorGroupId: group }),
          ],
          monitorStatuses: allStatuses,
          monitorGroupResources: {
            [group.toString()]: [
              makeGroupResource({
                monitorGroupId: group,
                monitorId: ObjectID.generate(),
                currentMonitorStatusId: statusDegraded.id!,
              }),
            ],
          },
        });

      expect(result[group.toString()]?.toString()).toBe(
        statusDegraded.id!.toString(),
      );
    });

    test("members the caller already read are used as they are: nothing is fetched", async () => {
      const group: ObjectID = ObjectID.generate();

      const batchedSpy: jest.SpyInstance = jest.spyOn(
        MonitorGroupService,
        "getMonitorGroupResourcesByGroupIds",
      ) as unknown as jest.SpyInstance;

      const result: Dictionary<ObjectID> =
        await StatusPageService.getMonitorGroupCurrentStatuses({
          statusPageResources: [
            makeStatusPageResource({ monitorGroupId: group }),
          ],
          monitorStatuses: allStatuses,
          monitorGroupResources: {
            [group.toString()]: [
              makeGroupResource({
                monitorGroupId: group,
                monitorId: ObjectID.generate(),
                currentMonitorStatusId: statusOffline.id!,
                disableActiveMonitoring: false,
              }),
            ],
          },
        });

      expect(batchedSpy).not.toHaveBeenCalled();
      expect(result[group.toString()]?.toString()).toBe(
        statusOffline.id!.toString(),
      );
    });

    test("no group resources at all: an empty dictionary, and nothing fetched", async () => {
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
      expect(batchedSpy).not.toHaveBeenCalled();
    });
  });
});
