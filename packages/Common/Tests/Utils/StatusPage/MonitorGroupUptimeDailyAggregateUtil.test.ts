import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  MonitorGroupUptimeDailyAggregate,
  UptimeDayBucket,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import MonitorGroupUptimeDailyAggregateUtil from "../../../Utils/StatusPage/MonitorGroupUptimeDailyAggregateUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * MonitorGroupUptimeDailyAggregateUtil: the order a monitor group's day is
 * merged by, and the wire format of every group's day buckets on a status
 * page (the overview's monitorGroupUptimeDailyAggregate, issue #6697).
 */

function status(data: {
  id: string;
  name: string;
  priority?: number | undefined;
}): MonitorStatus {
  const monitorStatus: MonitorStatus = new MonitorStatus();
  monitorStatus.id = new ObjectID(data.id);
  monitorStatus.name = data.name;

  if (data.priority !== undefined) {
    monitorStatus.priority = data.priority;
  }

  return monitorStatus;
}

const OPERATIONAL: MonitorStatus = status({
  id: "10000000-0000-4000-8000-000000000001",
  name: "Operational",
  priority: 1,
});
const DEGRADED: MonitorStatus = status({
  id: "10000000-0000-4000-8000-000000000002",
  name: "Degraded",
  priority: 2,
});
const OFFLINE: MonitorStatus = status({
  id: "10000000-0000-4000-8000-000000000003",
  name: "Offline",
  priority: 3,
});
const MAINTENANCE: MonitorStatus = status({
  id: "10000000-0000-4000-8000-000000000004",
  name: "Maintenance",
  priority: 4,
});

const GROUP_A: string = "20000000-0000-4000-8000-000000000001";
const GROUP_B: string = "20000000-0000-4000-8000-000000000002";

function bucket(data: {
  start: string;
  end: string;
  covered: number;
  durations: Array<[MonitorStatus, number]>;
}): UptimeDayBucket {
  return {
    bucketStart: new Date(data.start),
    bucketEnd: new Date(data.end),
    daySeconds:
      (new Date(data.end).getTime() - new Date(data.start).getTime()) / 1000,
    coveredSeconds: data.covered,
    statusDurations: data.durations.map(
      ([monitorStatus, seconds]: [MonitorStatus, number]) => {
        return { monitorStatusId: monitorStatus.id!, seconds: seconds };
      },
    ),
  };
}

function idsOf(statuses: Array<MonitorStatus>): Array<string> {
  return statuses.map((monitorStatus: MonitorStatus) => {
    return monitorStatus.id!.toString();
  });
}

describe("MonitorGroupUptimeDailyAggregateUtil.getRankedMonitorStatusIds", () => {
  test("with the page's downtime statuses at the top of the project's order, it is the project's order", () => {
    expect(
      MonitorGroupUptimeDailyAggregateUtil.getRankedMonitorStatusIds({
        monitorStatuses: [OFFLINE, OPERATIONAL, DEGRADED],
        downtimeMonitorStatusIds: [DEGRADED.id!, OFFLINE.id!],
      }),
    ).toEqual(idsOf([OPERATIONAL, DEGRADED, OFFLINE]));
  });

  test("a downtime status outranks a status above it that is not down, so a monitor down always makes the group down", () => {
    expect(
      MonitorGroupUptimeDailyAggregateUtil.getRankedMonitorStatusIds({
        monitorStatuses: [MAINTENANCE, OPERATIONAL, OFFLINE, DEGRADED],
        downtimeMonitorStatusIds: [OFFLINE.id!.toString()],
      }),
    ).toEqual(idsOf([OPERATIONAL, DEGRADED, MAINTENANCE, OFFLINE]));
  });

  test("with no downtime statuses it is the project's order alone", () => {
    expect(
      MonitorGroupUptimeDailyAggregateUtil.getRankedMonitorStatusIds({
        monitorStatuses: [MAINTENANCE, OFFLINE, OPERATIONAL, DEGRADED],
        downtimeMonitorStatusIds: [],
      }),
    ).toEqual(idsOf([OPERATIONAL, DEGRADED, OFFLINE, MAINTENANCE]));
  });

  test("statuses that share a priority, or have none, still come out in one order, each once", () => {
    const twinA: MonitorStatus = status({
      id: "10000000-0000-4000-8000-0000000000a1",
      name: "Twin A",
      priority: 2,
    });
    const twinB: MonitorStatus = status({
      id: "10000000-0000-4000-8000-0000000000a0",
      name: "Twin B",
      priority: 2,
    });
    const unordered: MonitorStatus = status({
      id: "10000000-0000-4000-8000-0000000000ff",
      name: "No priority",
    });

    const ranked: Array<string> =
      MonitorGroupUptimeDailyAggregateUtil.getRankedMonitorStatusIds({
        monitorStatuses: [twinA, OPERATIONAL, twinB, unordered, twinA],
        downtimeMonitorStatusIds: [],
      });

    expect(ranked).toEqual(idsOf([unordered, OPERATIONAL, twinB, twinA]));

    // whatever order they come in.
    expect(
      MonitorGroupUptimeDailyAggregateUtil.getRankedMonitorStatusIds({
        monitorStatuses: [unordered, twinB, twinA, OPERATIONAL],
        downtimeMonitorStatusIds: [],
      }),
    ).toEqual(ranked);
  });

  test("a status with no id is left out", () => {
    expect(
      MonitorGroupUptimeDailyAggregateUtil.getRankedMonitorStatusIds({
        monitorStatuses: [new MonitorStatus(), OPERATIONAL],
        downtimeMonitorStatusIds: [],
      }),
    ).toEqual(idsOf([OPERATIONAL]));
  });
});

describe("MonitorGroupUptimeDailyAggregateUtil wire format", () => {
  const aggregate: MonitorGroupUptimeDailyAggregate = {
    monitorGroups: [
      {
        monitorGroupId: new ObjectID(GROUP_A),
        buckets: [
          bucket({
            start: "2026-11-05T16:00:00.000Z",
            end: "2026-11-06T16:00:00.000Z",
            covered: 86400,
            durations: [
              [OPERATIONAL, 68712.789],
              [OFFLINE, 17687.211],
            ],
          }),
          bucket({
            start: "2026-11-06T16:00:00.000Z",
            end: "2026-11-07T03:12:00.000Z",
            covered: 0,
            durations: [],
          }),
        ],
      },
      {
        monitorGroupId: new ObjectID(GROUP_B),
        buckets: [],
      },
    ],
    timezone: "Asia/Shanghai",
  };

  test("round-trips through JSON, as the overview carries it", () => {
    const wire: JSONObject = JSON.parse(
      JSON.stringify(MonitorGroupUptimeDailyAggregateUtil.toJSON(aggregate)),
    ) as JSONObject;

    expect(MonitorGroupUptimeDailyAggregateUtil.fromJSON(wire)).toEqual(
      aggregate,
    );
  });

  test("is plain JSON: ISO strings, numbers and id strings, no typed envelopes", () => {
    const json: string = JSON.stringify(
      MonitorGroupUptimeDailyAggregateUtil.toJSON(aggregate),
    );

    expect(json).not.toContain("_type");
    expect(json).toContain('"bucketStart":"2026-11-05T16:00:00.000Z"');
    expect(json).toContain(`"monitorGroupId":"${GROUP_A}"`);
    expect(json).toContain('"timezone":"Asia/Shanghai"');
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["no monitorGroups", { timezone: "Asia/Tokyo" }],
    ["monitorGroups that are not a list", { monitorGroups: "lots" }],
  ])(
    "reads %s as no groups rather than throwing",
    (_: string, json: unknown) => {
      const parsed: MonitorGroupUptimeDailyAggregate =
        MonitorGroupUptimeDailyAggregateUtil.fromJSON(
          json as JSONObject | null | undefined,
        );

      expect(parsed.monitorGroups).toEqual([]);
    },
  );

  test("skips a group without an id, and a bucket or duration it cannot read", () => {
    const parsed: MonitorGroupUptimeDailyAggregate =
      MonitorGroupUptimeDailyAggregateUtil.fromJSON({
        monitorGroups: [
          null,
          { buckets: [] },
          {
            monitorGroupId: GROUP_A,
            buckets: [
              null,
              {
                bucketStart: "not a date",
                bucketEnd: "2026-11-06T16:00:00.000Z",
              },
              {
                bucketStart: "2026-11-05T16:00:00.000Z",
                bucketEnd: "2026-11-06T16:00:00.000Z",
                daySeconds: 86400,
                coveredSeconds: 3600,
                statusDurations: [
                  null,
                  { seconds: 10 },
                  { monitorStatusId: OFFLINE.id!.toString(), seconds: "3600" },
                ],
              },
            ],
          },
        ],
        timezone: "Asia/Shanghai",
      } as unknown as JSONObject);

    expect(parsed.monitorGroups).toHaveLength(1);
    expect(parsed.monitorGroups[0]!.buckets).toEqual([
      bucket({
        start: "2026-11-05T16:00:00.000Z",
        end: "2026-11-06T16:00:00.000Z",
        covered: 3600,
        durations: [[OFFLINE, 3600]],
      }),
    ]);
  });

  test("a zone it does not know, or none, reads as UTC - what the days were cut in when nobody said", () => {
    expect(
      MonitorGroupUptimeDailyAggregateUtil.fromJSON({
        monitorGroups: [],
        timezone: "Mars/Olympus_Mons",
      }).timezone,
    ).toBe("UTC");
    expect(
      MonitorGroupUptimeDailyAggregateUtil.fromJSON({ monitorGroups: [] })
        .timezone,
    ).toBe("UTC");
    expect(
      MonitorGroupUptimeDailyAggregateUtil.toJSON({ monitorGroups: [] })[
        "timezone"
      ],
    ).toBe("UTC");
  });
});

describe("MonitorGroupUptimeDailyAggregateUtil.getBucketsForMonitorGroup", () => {
  const aggregate: MonitorGroupUptimeDailyAggregate = {
    monitorGroups: [
      {
        monitorGroupId: new ObjectID(GROUP_A),
        buckets: [
          bucket({
            start: "2026-11-06T00:00:00.000Z",
            end: "2026-11-07T00:00:00.000Z",
            covered: 86400,
            durations: [[OPERATIONAL, 86400]],
          }),
        ],
      },
      { monitorGroupId: new ObjectID(GROUP_B), buckets: [] },
    ],
    timezone: "UTC",
  };

  test("a group's buckets, by id however it is given", () => {
    expect(
      MonitorGroupUptimeDailyAggregateUtil.getBucketsForMonitorGroup(
        aggregate,
        new ObjectID(GROUP_A),
      ),
    ).toHaveLength(1);
    expect(
      MonitorGroupUptimeDailyAggregateUtil.getBucketsForMonitorGroup(
        aggregate,
        GROUP_A,
      ),
    ).toHaveLength(1);
  });

  test("tells a group with no reading (undefined) from one with empty days ([])", () => {
    expect(
      MonitorGroupUptimeDailyAggregateUtil.getBucketsForMonitorGroup(
        aggregate,
        GROUP_B,
      ),
    ).toEqual([]);
    expect(
      MonitorGroupUptimeDailyAggregateUtil.getBucketsForMonitorGroup(
        aggregate,
        "20000000-0000-4000-8000-0000000000ff",
      ),
    ).toBeUndefined();
    expect(
      MonitorGroupUptimeDailyAggregateUtil.getBucketsForMonitorGroup(
        null,
        GROUP_A,
      ),
    ).toBeUndefined();
  });

  test("the window every group's buckets cover together, or null without any", () => {
    expect(MonitorGroupUptimeDailyAggregateUtil.getWindow(aggregate)).toEqual({
      startDate: new Date("2026-11-06T00:00:00.000Z"),
      endDate: new Date("2026-11-07T00:00:00.000Z"),
    });
    expect(
      MonitorGroupUptimeDailyAggregateUtil.getWindow({
        monitorGroups: [{ monitorGroupId: new ObjectID(GROUP_B), buckets: [] }],
      }),
    ).toBeNull();
    expect(
      MonitorGroupUptimeDailyAggregateUtil.getWindow(undefined),
    ).toBeNull();
  });
});
