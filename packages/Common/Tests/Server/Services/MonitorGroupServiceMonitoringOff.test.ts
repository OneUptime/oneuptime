/*
 * A MONITOR WHOSE MONITORING IS OFF DOES NOT DECIDE ITS GROUP'S STATUS
 * (issue #6478).
 *
 * Nothing checks a monitor whose monitoring is turned off, so the status it
 * holds is only what its last check saw - "Offline", say, for as long as it
 * stays off. A monitor group's current status, timeline and uptime used to
 * count it anyway: a group of nine Operational monitors and one Offline
 * monitor whose monitoring is off read Offline. Now only the monitors that
 * are checked - neither archived nor off - decide them
 * (Utils/StatusPage/FrozenMonitorResources), on every path that reads them:
 *
 *   - getCurrentStatus, behind the Dashboard's Current Status;
 *   - getCurrentStatusesForMonitorGroups, behind a status page's groups;
 *   - getMonitorGroupResourcesByGroupIds, which keeps the members whose
 *     monitoring is off - their incidents and maintenance still show on a
 *     status page, which draws a group whose monitors all have it off as Not
 *     monitored - and reads the switch so the paths above can tell.
 *
 * getStatusTimeline, behind the Dashboard's Uptime Graph and percentage,
 * reads the history of every member but an archived one (issue #6987): a
 * member whose monitoring is off keeps what it recorded up to the moment it
 * was turned off, and its rows from then on mark monitoring off
 * (MonitorStatusTimeline.isMonitoringOff, issue #6480), which uptime and the
 * graph leave out (UptimeUtil). Before, the whole member was dropped, so a
 * day it was Offline ten days ago vanished from the group's graph the moment
 * its monitoring was turned off.
 *
 * All service reads are spied on - no database is touched.
 */

import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import MonitorGroupResourceService from "../../../Server/Services/MonitorGroupResourceService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Event from "../../../Utils/Uptime/Event";
import FrozenMonitorResources from "../../../Utils/StatusPage/FrozenMonitorResources";
import UptimeUtil from "../../../Utils/Uptime/UptimeUtil";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

type AnySpy = jest.SpyInstance;

interface MemberFlags {
  isArchived?: boolean | undefined;
  disableActiveMonitoring?: boolean | undefined;
}

function makeStatus(data: {
  priority: number;
  name: string;
  isOperationalState?: boolean;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = ObjectID.generate();
  status.priority = data.priority;
  status.name = data.name;
  status.isOperationalState = Boolean(data.isOperationalState);
  return status;
}

const OPERATIONAL: MonitorStatus = makeStatus({
  priority: 1,
  name: "Operational",
  isOperationalState: true,
});
const DEGRADED: MonitorStatus = makeStatus({ priority: 2, name: "Degraded" });
const OFFLINE: MonitorStatus = makeStatus({ priority: 3, name: "Offline" });
const STATUSES: Array<MonitorStatus> = [OPERATIONAL, DEGRADED, OFFLINE];

const CHECKED: MemberFlags = {
  isArchived: false,
  disableActiveMonitoring: false,
};
const OFF: MemberFlags = { isArchived: false, disableActiveMonitoring: true };
const ARCHIVED: MemberFlags = {
  isArchived: true,
  disableActiveMonitoring: false,
};

function member(data: {
  monitorGroupId: ObjectID;
  status: MonitorStatus;
  flags: MemberFlags;
  monitorId?: ObjectID | undefined;
}): MonitorGroupResource {
  const resource: MonitorGroupResource = new MonitorGroupResource();
  resource.monitorGroupId = data.monitorGroupId;
  resource.monitorId = data.monitorId || ObjectID.generate();

  const monitor: Monitor = new Monitor();
  monitor.currentMonitorStatusId = data.status.id!;

  if (data.flags.isArchived !== undefined) {
    monitor.isArchived = data.flags.isArchived;
  }

  if (data.flags.disableActiveMonitoring !== undefined) {
    monitor.disableActiveMonitoring = data.flags.disableActiveMonitoring;
  }

  resource.monitor = monitor;
  return resource;
}

// The issue's group: nine Operational monitors, and one Offline whose monitoring is off.
function nineUpAndOneOffOffline(
  monitorGroupId: ObjectID,
): Array<MonitorGroupResource> {
  const members: Array<MonitorGroupResource> = [];

  for (let index: number = 0; index < 9; index++) {
    members.push(
      member({ monitorGroupId, status: OPERATIONAL, flags: CHECKED }),
    );
  }

  members.push(member({ monitorGroupId, status: OFFLINE, flags: OFF }));

  return members;
}

function firstCallArg(spy: AnySpy): any {
  return spy.mock.calls[0]![0];
}

function spyOnGroup(): AnySpy {
  return (
    jest.spyOn(MonitorGroupService, "findOneById") as unknown as AnySpy
  ).mockImplementation((...args: Array<unknown>): Promise<MonitorGroup> => {
    const group: MonitorGroup = new MonitorGroup();
    group.id = (args[0] as { id: ObjectID }).id;
    group.projectId = ObjectID.generate();
    return Promise.resolve(group);
  });
}

function spyOnMembers(members: Array<MonitorGroupResource>): AnySpy {
  return (
    jest.spyOn(MonitorGroupResourceService, "findBy") as unknown as AnySpy
  ).mockResolvedValue(members as never);
}

function spyOnAllMembers(members: Array<MonitorGroupResource>): AnySpy {
  return (
    jest.spyOn(MonitorGroupResourceService, "findAllBy") as unknown as AnySpy
  ).mockResolvedValue(members as never);
}

function spyOnStatuses(): AnySpy {
  return (
    jest.spyOn(MonitorStatusService, "findBy") as unknown as AnySpy
  ).mockResolvedValue(STATUSES as never);
}

function toStrings(ids: Array<ObjectID>): Array<string> {
  return ids.map((id: ObjectID): string => {
    return id.toString();
  });
}

describe("a monitor group's status leaves out monitors whose monitoring is off", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getCurrentStatus (the Dashboard's Current Status)", () => {
    test("nine Operational monitors and one Offline whose monitoring is off: Operational", async () => {
      const groupId: ObjectID = ObjectID.generate();
      spyOnGroup();
      spyOnMembers(nineUpAndOneOffOffline(groupId));
      spyOnStatuses();

      const status: MonitorStatus = await MonitorGroupService.getCurrentStatus(
        groupId,
        { isRoot: true },
      );

      expect(status).toBe(OPERATIONAL);
    });

    test("an Offline monitor that is checked still makes the group Offline", async () => {
      const groupId: ObjectID = ObjectID.generate();
      spyOnGroup();
      spyOnMembers([
        member({
          monitorGroupId: groupId,
          status: OPERATIONAL,
          flags: CHECKED,
        }),
        member({ monitorGroupId: groupId, status: OFFLINE, flags: CHECKED }),
        member({ monitorGroupId: groupId, status: DEGRADED, flags: OFF }),
      ]);
      spyOnStatuses();

      expect(
        await MonitorGroupService.getCurrentStatus(groupId, { isRoot: true }),
      ).toBe(OFFLINE);
    });

    test("the worst status among the checked monitors wins, not the frozen one", async () => {
      const groupId: ObjectID = ObjectID.generate();
      spyOnGroup();
      spyOnMembers([
        member({ monitorGroupId: groupId, status: DEGRADED, flags: CHECKED }),
        member({ monitorGroupId: groupId, status: OFFLINE, flags: OFF }),
        member({ monitorGroupId: groupId, status: OFFLINE, flags: ARCHIVED }),
      ]);
      spyOnStatuses();

      expect(
        await MonitorGroupService.getCurrentStatus(groupId, { isRoot: true }),
      ).toBe(DEGRADED);
    });

    test("every monitor off: the operational status, which the Dashboard draws as Disabled", async () => {
      const groupId: ObjectID = ObjectID.generate();
      spyOnGroup();
      spyOnMembers([
        member({ monitorGroupId: groupId, status: OFFLINE, flags: OFF }),
        member({ monitorGroupId: groupId, status: DEGRADED, flags: OFF }),
      ]);
      spyOnStatuses();

      expect(
        await MonitorGroupService.getCurrentStatus(groupId, { isRoot: true }),
      ).toBe(OPERATIONAL);
    });

    test("reads whether each member's monitoring is off along with its status", async () => {
      const groupId: ObjectID = ObjectID.generate();
      spyOnGroup();
      const findBy: AnySpy = spyOnMembers([]);
      spyOnStatuses();

      await MonitorGroupService.getCurrentStatus(groupId, { isRoot: true });

      expect(firstCallArg(findBy)["select"]).toEqual({
        monitor: {
          currentMonitorStatusId: true,
          isArchived: true,
          disableActiveMonitoring: true,
        },
      });
    });
  });

  describe("getStatusTimeline (the Dashboard's Uptime Graph and percentage)", () => {
    function spyOnTimelines(rows: Array<MonitorStatusTimeline>): AnySpy {
      return (
        jest.spyOn(MonitorStatusTimelineService, "findBy") as unknown as AnySpy
      ).mockResolvedValue(rows as never);
    }

    function readTimeline(
      groupId: ObjectID,
    ): Promise<Array<MonitorStatusTimeline>> {
      return MonitorGroupService.getStatusTimeline(
        groupId,
        new Date("2026-08-01T00:00:00Z"),
        new Date("2026-11-01T00:00:00Z"),
        { isRoot: true },
      );
    }

    test("reads the timeline of every member but the archived ones, those whose monitoring is off included", async () => {
      const groupId: ObjectID = ObjectID.generate();
      const checkedA: ObjectID = ObjectID.generate();
      const off: ObjectID = ObjectID.generate();
      const checkedB: ObjectID = ObjectID.generate();
      spyOnGroup();
      spyOnMembers([
        member({
          monitorGroupId: groupId,
          status: OPERATIONAL,
          flags: CHECKED,
          monitorId: checkedA,
        }),
        member({
          monitorGroupId: groupId,
          status: OFFLINE,
          flags: OFF,
          monitorId: off,
        }),
        member({ monitorGroupId: groupId, status: OFFLINE, flags: ARCHIVED }),
        member({
          monitorGroupId: groupId,
          status: DEGRADED,
          flags: CHECKED,
          monitorId: checkedB,
        }),
      ]);
      const anySpy: AnySpy = jest.spyOn(
        QueryHelper,
        "any",
      ) as unknown as AnySpy;
      const row: MonitorStatusTimeline = new MonitorStatusTimeline();
      const timelines: AnySpy = spyOnTimelines([row]);

      const result: Array<MonitorStatusTimeline> = await readTimeline(groupId);

      expect(result).toEqual([row]);
      expect(timelines).toHaveBeenCalledTimes(1);
      expect(toStrings(anySpy.mock.calls[0]![0] as Array<ObjectID>)).toEqual(
        toStrings([checkedA, off, checkedB]),
      );
      expect(firstCallArg(timelines)["query"]["monitorId"]).toBe(
        anySpy.mock.results[0]!.value,
      );
    });

    test("every monitor off: their timelines are still read, so what they recorded before the switch still shows", async () => {
      const groupId: ObjectID = ObjectID.generate();
      const first: ObjectID = ObjectID.generate();
      const second: ObjectID = ObjectID.generate();
      spyOnGroup();
      spyOnMembers([
        member({
          monitorGroupId: groupId,
          status: OFFLINE,
          flags: OFF,
          monitorId: first,
        }),
        member({
          monitorGroupId: groupId,
          status: OPERATIONAL,
          flags: OFF,
          monitorId: second,
        }),
      ]);
      const anySpy: AnySpy = jest.spyOn(
        QueryHelper,
        "any",
      ) as unknown as AnySpy;
      const row: MonitorStatusTimeline = new MonitorStatusTimeline();
      const timelines: AnySpy = spyOnTimelines([row]);

      expect(await readTimeline(groupId)).toEqual([row]);
      expect(timelines).toHaveBeenCalledTimes(1);
      expect(toStrings(anySpy.mock.calls[0]![0] as Array<ObjectID>)).toEqual(
        toStrings([first, second]),
      );
    });

    test("every monitor archived: no timeline at all, and nothing read for one", async () => {
      const groupId: ObjectID = ObjectID.generate();
      spyOnGroup();
      spyOnMembers([
        member({ monitorGroupId: groupId, status: OFFLINE, flags: ARCHIVED }),
        member({
          monitorGroupId: groupId,
          status: OPERATIONAL,
          flags: ARCHIVED,
        }),
      ]);
      const timelines: AnySpy = spyOnTimelines([]);

      expect(await readTimeline(groupId)).toEqual([]);
      expect(timelines).not.toHaveBeenCalled();
    });

    test("a group with no members reads nothing", async () => {
      const groupId: ObjectID = ObjectID.generate();
      spyOnGroup();
      spyOnMembers([]);
      const timelines: AnySpy = spyOnTimelines([]);

      expect(await readTimeline(groupId)).toEqual([]);
      expect(timelines).not.toHaveBeenCalled();
    });

    test("reads whether each member is archived, and nothing it does not need", async () => {
      const groupId: ObjectID = ObjectID.generate();
      spyOnGroup();
      const findBy: AnySpy = spyOnMembers([]);
      spyOnTimelines([]);

      await readTimeline(groupId);

      expect(firstCallArg(findBy)["select"]).toEqual({
        monitorId: true,
        monitor: {
          isArchived: true,
        },
      });
    });

    test("reads which rows have monitoring off, so uptime and the graph can leave that time out", async () => {
      const groupId: ObjectID = ObjectID.generate();
      spyOnGroup();
      spyOnMembers([
        member({ monitorGroupId: groupId, status: OFFLINE, flags: OFF }),
      ]);
      const timelines: AnySpy = spyOnTimelines([]);

      await readTimeline(groupId);

      const select: Dictionary<unknown> = firstCallArg(timelines)["select"];

      expect(select["isMonitoringOff"]).toBe(true);
      expect(select["startsAt"]).toBe(true);
      expect(select["endsAt"]).toBe(true);
      expect(select["monitorId"]).toBe(true);
    });

    describe("the issue's member: Offline for a day ten days ago, with monitoring off since yesterday", () => {
      /*
       * The window the Uptime Graph draws: the last 90 days to "now" - a
       * moment in the past, so an open row runs past it and is cut at it.
       */
      const NOW: Date = new Date("2026-11-01T12:00:00.000Z");

      function daysAgo(days: number): Date {
        return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
      }

      const WINDOW_START: Date = daysAgo(90);

      function row(data: {
        monitorId: ObjectID;
        status: MonitorStatus;
        startsAt: Date;
        endsAt?: Date | undefined;
        isMonitoringOff?: boolean | undefined;
      }): MonitorStatusTimeline {
        const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
        timeline.monitorId = data.monitorId;
        timeline.monitorStatusId = data.status.id!;
        timeline.monitorStatus = data.status;
        timeline.startsAt = data.startsAt;

        if (data.endsAt) {
          timeline.endsAt = data.endsAt;
        }

        timeline.isMonitoringOff = Boolean(data.isMonitoringOff);
        return timeline;
      }

      /*
       * The group: one monitor still checked, Operational throughout, and the
       * issue's member - Offline for a day ten days ago, Offline again the day
       * before yesterday, and then turned off yesterday, holding that Offline
       * frozen from then on.
       */
      function issueRows(data: {
        checked: ObjectID;
        member: ObjectID;
      }): Array<MonitorStatusTimeline> {
        return [
          row({
            monitorId: data.checked,
            status: OPERATIONAL,
            startsAt: daysAgo(100),
          }),
          row({
            monitorId: data.member,
            status: OPERATIONAL,
            startsAt: daysAgo(100),
            endsAt: daysAgo(10),
          }),
          row({
            monitorId: data.member,
            status: OFFLINE,
            startsAt: daysAgo(10),
            endsAt: daysAgo(9),
          }),
          row({
            monitorId: data.member,
            status: OPERATIONAL,
            startsAt: daysAgo(9),
            endsAt: daysAgo(2),
          }),
          row({
            monitorId: data.member,
            status: OFFLINE,
            startsAt: daysAgo(2),
            endsAt: daysAgo(1),
          }),
          // The switch: monitoring turned off yesterday, the Offline frozen.
          row({
            monitorId: data.member,
            status: OFFLINE,
            startsAt: daysAgo(1),
            isMonitoringOff: true,
          }),
        ];
      }

      async function groupTimeline(data: {
        checkedFlags: MemberFlags;
      }): Promise<{
        rows: Array<MonitorStatusTimeline>;
        checked: ObjectID;
        member: ObjectID;
      }> {
        const groupId: ObjectID = ObjectID.generate();
        const checked: ObjectID = ObjectID.generate();
        const offMember: ObjectID = ObjectID.generate();
        const all: Array<MonitorStatusTimeline> = issueRows({
          checked,
          member: offMember,
        });

        spyOnGroup();
        spyOnMembers([
          member({
            monitorGroupId: groupId,
            status: OPERATIONAL,
            flags: data.checkedFlags,
            monitorId: checked,
          }),
          member({
            monitorGroupId: groupId,
            status: OFFLINE,
            flags: OFF,
            monitorId: offMember,
          }),
        ]);

        // The database returns the rows of the monitors it is asked for.
        const anySpy: AnySpy = jest.spyOn(
          QueryHelper,
          "any",
        ) as unknown as AnySpy;
        (
          jest.spyOn(
            MonitorStatusTimelineService,
            "findBy",
          ) as unknown as AnySpy
        ).mockImplementation((): Promise<Array<MonitorStatusTimeline>> => {
          const asked: Array<string> = toStrings(
            (anySpy.mock.calls[0]?.[0] as Array<ObjectID>) || [],
          );
          return Promise.resolve(
            all.filter((timeline: MonitorStatusTimeline): boolean => {
              return asked.includes(timeline.monitorId!.toString());
            }),
          );
        });

        return {
          rows: await MonitorGroupService.getStatusTimeline(
            groupId,
            WINDOW_START,
            NOW,
            { isRoot: true },
          ),
          checked,
          member: offMember,
        };
      }

      function graphEvents(rows: Array<MonitorStatusTimeline>): Array<Event> {
        return UptimeUtil.getNonOverlappingMonitorEvents(
          rows,
          { startDate: WINDOW_START, endDate: NOW },
          { downtimeMonitorStatusIds: [OFFLINE.id!.toString()] },
        );
      }

      function offlineSpans(events: Array<Event>): Array<[string, string]> {
        return events
          .filter((event: Event): boolean => {
            return event.eventStatusId.toString() === OFFLINE.id!.toString();
          })
          .map((event: Event): [string, string] => {
            return [
              new Date(event.startDate).toISOString(),
              new Date(event.endDate).toISOString(),
            ];
          });
      }

      test("the group's timeline still holds the Offline day, and nothing of the member after the switch", async () => {
        const read: {
          rows: Array<MonitorStatusTimeline>;
          checked: ObjectID;
          member: ObjectID;
        } = await groupTimeline({ checkedFlags: CHECKED });

        // The member's rows are read: its history before the switch is there.
        expect(
          read.rows.filter((timeline: MonitorStatusTimeline): boolean => {
            return timeline.monitorId!.toString() === read.member.toString();
          }),
        ).toHaveLength(5);

        const events: Array<Event> = graphEvents(read.rows);

        // The day ten days ago, and the day before yesterday - nothing after the switch.
        expect(offlineSpans(events)).toEqual([
          [daysAgo(10).toISOString(), daysAgo(9).toISOString()],
          [daysAgo(2).toISOString(), daysAgo(1).toISOString()],
        ]);

        // After the switch, only the monitor still checked speaks for the group.
        const afterSwitch: Array<Event> = events.filter(
          (event: Event): boolean => {
            return new Date(event.endDate).getTime() > daysAgo(1).getTime();
          },
        );

        expect(afterSwitch).toHaveLength(1);
        expect(afterSwitch[0]!.eventStatusId.toString()).toBe(
          OPERATIONAL.id!.toString(),
        );
        expect(new Date(afterSwitch[0]!.startDate).toISOString()).toBe(
          daysAgo(1).toISOString(),
        );
        expect(new Date(afterSwitch[0]!.endDate).toISOString()).toBe(
          NOW.toISOString(),
        );

        // And none of the member's own events runs past the switch.
        const memberEvents: Array<Event> = UptimeUtil.getMonitorEventsForId(
          read.member,
          read.rows,
          { startDate: WINDOW_START, endDate: NOW },
        );

        expect(
          Math.max(
            ...memberEvents.map((event: Event): number => {
              return new Date(event.endDate).getTime();
            }),
          ),
        ).toBe(daysAgo(1).getTime());
      });

      test("the group's uptime counts the two Offline days of the 90 and not the frozen one: 97.777%", async () => {
        const read: {
          rows: Array<MonitorStatusTimeline>;
          checked: ObjectID;
          member: ObjectID;
        } = await groupTimeline({ checkedFlags: CHECKED });

        expect(
          UptimeUtil.calculateUptimePercentageOfMonitoredTime(
            read.rows,
            UptimePrecision.THREE_DECIMAL,
            [OFFLINE],
            { startDate: WINDOW_START, endDate: NOW },
          ),
          // 88 of 90 days up, cut (not rounded) to three decimals.
        ).toBe(97.777);
      });

      test("the other member archived too: the group's uptime ends at the switch, with both Offline days in it", async () => {
        const read: {
          rows: Array<MonitorStatusTimeline>;
          checked: ObjectID;
          member: ObjectID;
        } = await groupTimeline({ checkedFlags: ARCHIVED });

        // Only the off member is read; the archived one is retired.
        expect(
          new Set(
            read.rows.map((timeline: MonitorStatusTimeline): string => {
              return timeline.monitorId!.toString();
            }),
          ),
        ).toEqual(new Set([read.member.toString()]));

        // 89 monitored days (the 90 less the day since the switch), 2 of them Offline.
        expect(
          UptimeUtil.calculateUptimePercentageOfMonitoredTime(
            read.rows,
            UptimePrecision.THREE_DECIMAL,
            [OFFLINE],
            { startDate: WINDOW_START, endDate: NOW },
          ),
          // 87 of 89 days up, cut (not rounded) to three decimals.
        ).toBe(97.752);

        expect(offlineSpans(graphEvents(read.rows))).toEqual([
          [daysAgo(10).toISOString(), daysAgo(9).toISOString()],
          [daysAgo(2).toISOString(), daysAgo(1).toISOString()],
        ]);
      });
    });
  });

  describe("getMonitorGroupResourcesByGroupIds (what a status page reads a group's members from)", () => {
    test("keeps the members whose monitoring is off, with the switch read, and drops archived ones", async () => {
      const groupId: ObjectID = ObjectID.generate();
      const checked: MonitorGroupResource = member({
        monitorGroupId: groupId,
        status: OPERATIONAL,
        flags: CHECKED,
      });
      const off: MonitorGroupResource = member({
        monitorGroupId: groupId,
        status: OFFLINE,
        flags: OFF,
      });
      const archived: MonitorGroupResource = member({
        monitorGroupId: groupId,
        status: OFFLINE,
        flags: ARCHIVED,
      });
      spyOnAllMembers([checked, off, archived]);

      const result: Dictionary<Array<MonitorGroupResource>> =
        await MonitorGroupService.getMonitorGroupResourcesByGroupIds([groupId]);

      expect(result[groupId.toString()]).toEqual([checked, off]);
      expect(
        result[groupId.toString()]![1]!.monitor!.disableActiveMonitoring,
      ).toBe(true);
    });

    test("the monitors of a group still name every member that is not archived, so its incidents still show", async () => {
      const groupId: ObjectID = ObjectID.generate();
      const offMonitor: ObjectID = ObjectID.generate();
      const checkedMonitor: ObjectID = ObjectID.generate();
      spyOnAllMembers([
        member({
          monitorGroupId: groupId,
          status: OFFLINE,
          flags: OFF,
          monitorId: offMonitor,
        }),
        member({
          monitorGroupId: groupId,
          status: OPERATIONAL,
          flags: CHECKED,
          monitorId: checkedMonitor,
        }),
      ]);

      const result: Dictionary<Array<ObjectID>> =
        await MonitorGroupService.getMonitorIdsInMonitorGroups([groupId]);

      expect(toStrings(result[groupId.toString()]!)).toEqual(
        toStrings([offMonitor, checkedMonitor]),
      );
    });
  });

  describe("getCurrentStatusesForMonitorGroups (a status page's groups)", () => {
    test("the issue's group reads Operational; a group with a checked Offline monitor reads Offline", async () => {
      const issueGroup: ObjectID = ObjectID.generate();
      const downGroup: ObjectID = ObjectID.generate();
      spyOnAllMembers([
        ...nineUpAndOneOffOffline(issueGroup),
        member({ monitorGroupId: downGroup, status: OFFLINE, flags: CHECKED }),
        member({ monitorGroupId: downGroup, status: DEGRADED, flags: OFF }),
      ]);

      const result: Dictionary<MonitorStatus> =
        await MonitorGroupService.getCurrentStatusesForMonitorGroups({
          monitorGroupIds: [issueGroup, downGroup],
          monitorStatuses: STATUSES,
        });

      expect(result[issueGroup.toString()]).toBe(OPERATIONAL);
      expect(result[downGroup.toString()]).toBe(OFFLINE);
    });

    test("a group whose monitors are all off is left at the operational status, as getCurrentStatus leaves it", async () => {
      const groupId: ObjectID = ObjectID.generate();
      spyOnAllMembers([
        member({ monitorGroupId: groupId, status: OFFLINE, flags: OFF }),
      ]);

      const result: Dictionary<MonitorStatus> =
        await MonitorGroupService.getCurrentStatusesForMonitorGroups({
          monitorGroupIds: [groupId],
          monitorStatuses: STATUSES,
        });

      expect(result[groupId.toString()]).toBe(OPERATIONAL);
    });

    test("members the caller supplies are held to the same rule", async () => {
      const groupId: ObjectID = ObjectID.generate();
      const findAllBy: AnySpy = spyOnAllMembers([]);

      const result: Dictionary<MonitorStatus> =
        await MonitorGroupService.getCurrentStatusesForMonitorGroups({
          monitorGroupIds: [groupId],
          monitorStatuses: STATUSES,
          monitorGroupResources: {
            [groupId.toString()]: [
              member({
                monitorGroupId: groupId,
                status: DEGRADED,
                flags: CHECKED,
              }),
              member({ monitorGroupId: groupId, status: OFFLINE, flags: OFF }),
            ],
          },
        });

      expect(result[groupId.toString()]).toBe(DEGRADED);
      expect(findAllBy).not.toHaveBeenCalled();
    });

    test("a status page leaves the all-off group out of its statuses, and draws it as Not monitored", async () => {
      const offGroup: ObjectID = ObjectID.generate();
      const mixedGroup: ObjectID = ObjectID.generate();
      spyOnAllMembers([
        member({ monitorGroupId: offGroup, status: OFFLINE, flags: OFF }),
        member({ monitorGroupId: mixedGroup, status: OFFLINE, flags: OFF }),
        member({
          monitorGroupId: mixedGroup,
          status: DEGRADED,
          flags: CHECKED,
        }),
      ]);

      const members: Dictionary<Array<MonitorGroupResource>> =
        await MonitorGroupService.getMonitorGroupResourcesByGroupIds([
          offGroup,
          mixedGroup,
        ]);

      const shown: Dictionary<MonitorStatus> =
        FrozenMonitorResources.withoutNotMonitoredMonitorGroups({
          monitorGroupStatuses:
            await MonitorGroupService.getCurrentStatusesForMonitorGroups({
              monitorGroupIds: [offGroup, mixedGroup],
              monitorStatuses: STATUSES,
              monitorGroupResources: members,
            }),
          monitorGroupResources: members,
        });

      expect(Object.keys(shown)).toEqual([mixedGroup.toString()]);
      expect(shown[mixedGroup.toString()]).toBe(DEGRADED);
    });
  });

  describe("the batched path and the single-group path still agree", () => {
    test("with monitors that are off, archived and checked in every mix", async () => {
      const rowsByGroup: Dictionary<Array<MonitorGroupResource>> = {};
      const groupIds: Array<ObjectID> = [];

      const mixes: Array<Array<[MonitorStatus, MemberFlags]>> = [
        [],
        [[OFFLINE, OFF]],
        [
          [OFFLINE, OFF],
          [OPERATIONAL, CHECKED],
        ],
        [
          [DEGRADED, CHECKED],
          [OFFLINE, OFF],
          [OFFLINE, ARCHIVED],
        ],
        [
          [OFFLINE, CHECKED],
          [DEGRADED, OFF],
        ],
        [
          [DEGRADED, ARCHIVED],
          [OFFLINE, OFF],
        ],
      ];

      for (const mix of mixes) {
        const groupId: ObjectID = ObjectID.generate();
        groupIds.push(groupId);
        rowsByGroup[groupId.toString()] = mix.map(
          (entry: [MonitorStatus, MemberFlags]): MonitorGroupResource => {
            return member({
              monitorGroupId: groupId,
              status: entry[0],
              flags: entry[1],
            });
          },
        );
      }

      spyOnGroup();
      (
        jest.spyOn(MonitorGroupResourceService, "findBy") as unknown as AnySpy
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
      spyOnStatuses();
      spyOnAllMembers(
        groupIds.flatMap((groupId: ObjectID): Array<MonitorGroupResource> => {
          return rowsByGroup[groupId.toString()] || [];
        }),
      );

      const batched: Dictionary<MonitorStatus> =
        await MonitorGroupService.getCurrentStatusesForMonitorGroups({
          monitorGroupIds: groupIds,
          monitorStatuses: STATUSES,
        });

      const expected: Array<MonitorStatus> = [
        OPERATIONAL,
        OPERATIONAL,
        OPERATIONAL,
        DEGRADED,
        OFFLINE,
        OPERATIONAL,
      ];

      for (let index: number = 0; index < groupIds.length; index++) {
        const groupId: ObjectID = groupIds[index]!;
        const single: MonitorStatus =
          await MonitorGroupService.getCurrentStatus(groupId, {
            isRoot: true,
          });

        expect({ index, status: batched[groupId.toString()]?.name }).toEqual({
          index,
          status: single.name,
        });
        expect(batched[groupId.toString()]).toBe(expected[index]);
      }
    });
  });
});
