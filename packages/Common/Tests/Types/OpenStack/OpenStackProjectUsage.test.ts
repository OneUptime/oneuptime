import { describe, expect, test } from "@jest/globals";
import {
  OpenStackPriceList,
  OpenStackUsageCost,
  getOpenStackUsageCost,
  readOpenStackPriceList,
} from "../../../Types/OpenStack/OpenStackPriceList";
import {
  OPENSTACK_HOURS_IN_A_MONTH,
  OPENSTACK_USAGE_EVERY_MINUTES,
  OpenStackProjectHolding,
  OpenStackUsageInstanceGroup,
  OpenStackUsageInterval,
  OpenStackUsageQuantities,
  OpenStackUsageRows,
  OpenStackUsageStorageGroup,
  OpenStackUsageTotals,
  addOpenStackUsage,
  applyOpenStackUsageReading,
  getEmptyOpenStackUsageQuantities,
  getOpenStackFlavorUsageKey,
  getOpenStackProjectHoldings,
  getOpenStackUsageInterval,
  getOpenStackUsageTotals,
  readOpenStackUsageFlavorId,
  readOpenStackUsageQuantities,
  sumOpenStackUsageQuantities,
} from "../../../Types/OpenStack/OpenStackProjectUsage";

const GB: number = 1024 * 1024 * 1024;
const MONTH: string = "2026-11";
const START: Date = new Date("2026-11-10T00:00:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;

const FLAVORS: OpenStackUsageRows["flavors"] = [
  {
    regionName: "RegionOne",
    flavorId: "small-id",
    name: "m1.small",
    vcpus: 1,
    memoryBytes: 2048 * 1024 * 1024,
  },
  {
    regionName: "RegionOne",
    flavorId: "medium-id",
    name: "m1.medium",
    vcpus: 2,
    memoryBytes: 4096 * 1024 * 1024,
  },
  {
    regionName: "RegionOne",
    flavorId: "large-id",
    name: "m1.large",
    vcpus: 4,
    memoryBytes: 8192 * 1024 * 1024,
  },
];

function instanceGroup(
  project: string,
  flavorId: string,
  status: string,
): OpenStackUsageInstanceGroup {
  return {
    openStackProjectId: project,
    regionName: "RegionOne",
    flavorId,
    status,
    count: 1,
  };
}

/*
 * THE HAND CALCULATION.
 *
 * One day, 2026-11-10, read every quarter of an hour from 00:00 to 24:00. A reading counts the time
 * since the one before it, at what it sees then. So a change just after 06:00 is first seen by the
 * 06:15 reading, which counts 06:00 to 06:15 at the new size: time up to 06:00 is the old flavor, and
 * time after it the new one. The first reading has no time behind it, so it counts nothing.
 *
 * Project "payments":
 *
 *   web       m1.small  (1 vCPU, 2 GB)  00:00 to 06:00, then RESIZED to
 *             m1.medium (2 vCPU, 4 GB)  06:00 to 24:00                     6 h small, 18 h medium
 *   batch     m1.small                  00:00 to 10:00, then DELETED      10 h small
 *   old       m1.small, SHUTOFF         00:00 to 24:00                    24 h small, shut off
 *   data      10 GB of ssd              00:00 to 24:00                    10 x 24 =  240 GB-hours
 *   scratch   100 GB of hdd             00:00 to 12:00, then DELETED     100 x 12 = 1200 GB-hours
 *   one IP                              00:00 to 24:00                              24 IP-hours
 *   a second                            00:00 to 18:00, then RELEASED               18 IP-hours
 *   an image  2 GB                      00:00 to 24:00                     2 x 24 =   48 GB-hours
 *   a snapshot 5 GB                     12:00 to 24:00                     5 x 12 =   60 GB-hours
 *
 * Instance-hours of m1.small:  running 6 + 10 = 16, shut off 24.    Of m1.medium: running 18.
 *
 *   vCPU-hours    m1.small (16 + 24) x 1 = 40     m1.medium 18 x 2 = 36      total  76
 *   memory GB-h   m1.small (16 + 24) x 2 = 80     m1.medium 18 x 4 = 72      total 152
 *   volume GB-h   240 + 1200                                                 total 1440
 *
 * Project "research":
 *
 *   ml        m1.large (4 vCPU, 8 GB)   20:00 to 24:00                     4 h large
 *
 *   vCPU-hours 4 x 4 = 16     memory GB-h 4 x 8 = 32
 *
 * At these prices per hour: a vCPU 0.01, a GB of memory 0.005, a GB of volume 0.0002 with ssd at
 * 0.0005, a floating IP 0.004, a GB of image 0.0001, a GB of snapshot 0.00015.
 *
 *   payments   vCPUs    76 x 0.01    = 0.76
 *              memory  152 x 0.005   = 0.76
 *              ssd     240 x 0.0005  = 0.12
 *              hdd    1200 x 0.0002  = 0.24
 *              IPs      42 x 0.004   = 0.168
 *              image    48 x 0.0001  = 0.0048
 *              snapshot 60 x 0.00015 = 0.009
 *                                total 2.0618
 *
 *   research   vCPUs    16 x 0.01    = 0.16
 *              memory   32 x 0.005   = 0.16
 *                                total 0.32
 */
function readingAt(hours: number): OpenStackUsageRows {
  const instances: Array<OpenStackUsageInstanceGroup> = [
    instanceGroup(
      "payments",
      hours <= 6 ? "small-id" : "medium-id",
      hours > 6 && hours <= 6.25 ? "VERIFY_RESIZE" : "ACTIVE",
    ),
    instanceGroup("payments", "small-id", "SHUTOFF"),
  ];

  if (hours <= 10) {
    instances.push(instanceGroup("payments", "small-id", "ACTIVE"));
  }

  if (hours > 20) {
    instances.push(instanceGroup("research", "large-id", "ACTIVE"));
  }

  const volumes: Array<OpenStackUsageStorageGroup> = [
    { openStackProjectId: "payments", type: "ssd", bytes: 10 * GB },
  ];

  if (hours <= 12) {
    volumes.push({
      openStackProjectId: "payments",
      type: "hdd",
      bytes: 100 * GB,
    });
  }

  return {
    instances,
    flavors: FLAVORS,
    volumes,
    floatingIps: [
      { openStackProjectId: "payments", count: hours <= 18 ? 2 : 1 },
    ],
    images: [{ openStackProjectId: "payments", bytes: 2 * GB }],
    snapshots:
      hours > 12 ? [{ openStackProjectId: "payments", bytes: 5 * GB }] : [],
  };
}

const PRICES: OpenStackPriceList = {
  currency: "EUR",
  vcpuHour: 0.01,
  memoryGbHour: 0.005,
  volumeGbHour: 0.0002,
  floatingIpHour: 0.004,
  imageGbHour: 0.0001,
  snapshotGbHour: 0.00015,
  flavorHour: {},
  volumeTypeGbHour: { ssd: 0.0005 },
  leaveOutShutOff: false,
};

// The day above, a reading at a time, the way a worker's runs add it up.
function readTheDay(): Map<string, OpenStackUsageQuantities> {
  let months: Map<string, Map<string, OpenStackUsageQuantities>> = new Map();
  let lastReadAt: Date | null = null;

  for (
    let minutes: number = 0;
    minutes <= 24 * 60;
    minutes += OPENSTACK_USAGE_EVERY_MINUTES
  ) {
    const now: Date = new Date(START.getTime() + minutes * 60 * 1000);
    months = applyOpenStackUsageReading({
      months,
      holdings: getOpenStackProjectHoldings(readingAt(minutes / 60)),
      interval: getOpenStackUsageInterval({ lastReadAt, now }),
    }).months;
    lastReadAt = now;
  }

  return months.get(MONTH)!;
}

describe("the hand calculation, across a resize and a deletion mid-period", () => {
  const rows: Map<string, OpenStackUsageQuantities> = readTheDay();
  const payments: OpenStackUsageQuantities = rows.get("payments")!;
  const research: OpenStackUsageQuantities = rows.get("research")!;

  const small: string = getOpenStackFlavorUsageKey({
    regionName: "RegionOne",
    flavorId: "small-id",
  });
  const medium: string = getOpenStackFlavorUsageKey({
    regionName: "RegionOne",
    flavorId: "medium-id",
  });
  const large: string = getOpenStackFlavorUsageKey({
    regionName: "RegionOne",
    flavorId: "large-id",
  });

  test("a resize moves hours from one flavor to the other, and a deletion stops them", () => {
    expect(payments.flavors[small]!.runningHours).toBeCloseTo(6 + 10, 6);
    expect(payments.flavors[small]!.shutOffHours).toBeCloseTo(24, 6);
    expect(payments.flavors[medium]!.runningHours).toBeCloseTo(18, 6);
    expect(payments.flavors[medium]!.shutOffHours).toBe(0);
    expect(payments.flavors[large]).toBeUndefined();
    expect(research.flavors[large]!.runningHours).toBeCloseTo(4, 6);
  });

  test("vCPU-hours and memory-hours by flavor", () => {
    const totals: OpenStackUsageTotals = getOpenStackUsageTotals(payments);

    expect(totals.vcpuHours).toBeCloseTo(40 + 36, 6);
    expect(totals.memoryGbHours).toBeCloseTo(80 + 72, 6);
    expect(totals.instanceHours).toBeCloseTo(16 + 24 + 18, 6);
    expect(totals.shutOffInstanceHours).toBeCloseTo(24, 6);
    expect(totals.unknownFlavorHours).toBe(0);
    expect(getOpenStackUsageTotals(research).vcpuHours).toBeCloseTo(16, 6);
    expect(getOpenStackUsageTotals(research).memoryGbHours).toBeCloseTo(32, 6);
  });

  test("volume GB-hours by type, floating IP-hours, image and snapshot storage", () => {
    expect(payments.volumeGbHoursByType["ssd"]).toBeCloseTo(240, 6);
    expect(payments.volumeGbHoursByType["hdd"]).toBeCloseTo(1200, 6);
    expect(payments.floatingIpHours).toBeCloseTo(24 + 18, 6);
    expect(payments.imageGbHours).toBeCloseTo(48, 6);
    expect(payments.snapshotGbHours).toBeCloseTo(60, 6);
  });

  test("with prices set, each line and the total are as the calculation has them", () => {
    const cost: OpenStackUsageCost = getOpenStackUsageCost({
      quantities: payments,
      priceList: PRICES,
    });

    expect(cost.amount).toBeCloseTo(2.0618, 4);
    expect(cost.unpricedLineCount).toBe(0);
    expect(
      getOpenStackUsageCost({ quantities: research, priceList: PRICES }).amount,
    ).toBeCloseTo(0.32, 4);
  });

  test("leaving out what's shut off takes 24 hours of m1.small off: 0.24 of vCPUs and 0.24 of memory", () => {
    expect(
      getOpenStackUsageCost({
        quantities: payments,
        priceList: { ...PRICES, leaveOutShutOff: true },
      }).amount,
    ).toBeCloseTo(2.0618 - 0.24 - 0.24, 4);
  });

  test("a flavor's own price is the whole of it: 18 h of m1.medium at 0.05 is 0.90, not 0.36 + 0.36", () => {
    expect(
      getOpenStackUsageCost({
        quantities: payments,
        priceList: { ...PRICES, flavorHour: { "m1.medium": 0.05 } },
      }).amount,
    ).toBeCloseTo(2.0618 - 0.36 - 0.36 + 0.9, 4);
  });

  test("a cloud adds up from its projects", () => {
    const totals: OpenStackUsageTotals = getOpenStackUsageTotals(
      sumOpenStackUsageQuantities(rows.values()),
    );

    expect(totals.vcpuHours).toBeCloseTo(76 + 16, 6);
    expect(totals.memoryGbHours).toBeCloseTo(152 + 32, 6);
    expect(totals.volumeGbHours).toBeCloseTo(1440, 6);
    expect(
      getOpenStackUsageCost({
        quantities: sumOpenStackUsageQuantities(rows.values()),
        priceList: PRICES,
      }).amount,
    ).toBeCloseTo(2.0618 + 0.32, 4);
  });
});

describe("what a reading counts", () => {
  const at: (text: string) => Date = (text: string): Date => {
    return new Date(text);
  };

  test("a first reading has no time behind it, so it counts nothing", () => {
    expect(
      getOpenStackUsageInterval({
        lastReadAt: null,
        now: at("2026-11-10T10:00:00.000Z"),
      }),
    ).toEqual({ slices: [], notCountedHours: 0, closesDay: null });
  });

  test.each([
    ["the same moment", "2026-11-10T10:00:00.000Z"],
    ["a clock that went back", "2026-11-10T09:00:00.000Z"],
  ])("%s counts nothing", (_name: string, now: string) => {
    expect(
      getOpenStackUsageInterval({
        lastReadAt: at("2026-11-10T10:00:00.000Z"),
        now: at(now),
      }).slices,
    ).toEqual([]);
  });

  test("an ordinary reading counts the time since the last one", () => {
    const interval: OpenStackUsageInterval = getOpenStackUsageInterval({
      lastReadAt: at("2026-11-10T10:00:00.000Z"),
      now: at("2026-11-10T10:15:00.000Z"),
    });

    expect(interval.slices).toEqual([
      { month: "2026-11", day: "2026-11-10", hours: 0.25, endsDay: false },
    ]);
    expect(interval.notCountedHours).toBe(0);
    expect(interval.closesDay).toBeNull();
  });

  test("a reading across midnight splits at midnight, and finishes the day", () => {
    const interval: OpenStackUsageInterval = getOpenStackUsageInterval({
      lastReadAt: at("2026-11-10T23:50:00.000Z"),
      now: at("2026-11-11T00:05:00.000Z"),
    });

    expect(interval.slices.length).toBe(2);
    expect(interval.slices[0]!.day).toBe("2026-11-10");
    expect(interval.slices[0]!.hours).toBeCloseTo(10 / 60, 8);
    expect(interval.slices[0]!.endsDay).toBe(true);
    expect(interval.slices[1]!.day).toBe("2026-11-11");
    expect(interval.slices[1]!.hours).toBeCloseTo(5 / 60, 8);
    expect(interval.slices[1]!.endsDay).toBe(false);
    expect(interval.closesDay).toBeNull();
  });

  test("a reading exactly at midnight finishes the day and starts nothing", () => {
    const interval: OpenStackUsageInterval = getOpenStackUsageInterval({
      lastReadAt: at("2026-11-10T23:45:00.000Z"),
      now: at("2026-11-11T00:00:00.000Z"),
    });

    expect(interval.slices).toEqual([
      { month: "2026-11", day: "2026-11-10", hours: 0.25, endsDay: true },
    ]);
    expect(interval.closesDay).toBeNull();
  });

  test("a reading across a month's end puts each part in its own month", () => {
    const interval: OpenStackUsageInterval = getOpenStackUsageInterval({
      lastReadAt: at("2026-11-30T23:45:00.000Z"),
      now: at("2026-12-01T00:15:00.000Z"),
    });

    expect(
      interval.slices.map((slice: { month: string; hours: number }) => {
        return [slice.month, slice.hours];
      }),
    ).toEqual([
      ["2026-11", 0.25],
      ["2026-12", 0.25],
    ]);
  });

  test("a gap isn't guessed at: its last hour counts and the rest is said not to have", () => {
    const interval: OpenStackUsageInterval = getOpenStackUsageInterval({
      lastReadAt: at("2026-11-10T06:00:00.000Z"),
      now: at("2026-11-10T10:00:00.000Z"),
    });

    expect(interval.slices).toEqual([
      { month: "2026-11", day: "2026-11-10", hours: 1, endsDay: false },
    ]);
    expect(interval.notCountedHours).toBe(3);
  });

  test("a gap over a whole day still finishes the day the last reading was in, as it stood", () => {
    const interval: OpenStackUsageInterval = getOpenStackUsageInterval({
      lastReadAt: at("2026-11-10T06:00:00.000Z"),
      now: at("2026-11-12T10:00:00.000Z"),
    });

    expect(interval.slices.length).toBe(1);
    expect(interval.slices[0]!.day).toBe("2026-11-12");
    expect(interval.notCountedHours).toBe(51);
    expect(interval.closesDay).toBe("2026-11-10");
  });

  test("a late reading of just under an hour is all counted, and a late one just over loses the rest", () => {
    expect(
      getOpenStackUsageInterval({
        lastReadAt: at("2026-11-10T06:00:00.000Z"),
        now: at("2026-11-10T07:00:00.000Z"),
      }).notCountedHours,
    ).toBe(0);
    expect(
      getOpenStackUsageInterval({
        lastReadAt: at("2026-11-10T06:00:00.000Z"),
        now: at("2026-11-10T07:30:00.000Z"),
      }).notCountedHours,
    ).toBe(0.5);
  });
});

describe("what a reading adds to a month and a finished day", () => {
  const holding: OpenStackProjectHolding = {
    openStackProjectId: "a",
    flavors: [],
    volumeGbByType: {},
    floatingIps: 2,
    imageGb: 0,
    snapshotGb: 0,
  };

  test("a finished day's row holds the month as it stood at midnight, not what came after", () => {
    const applied: ReturnType<typeof applyOpenStackUsageReading> =
      applyOpenStackUsageReading({
        months: new Map(),
        holdings: [holding],
        interval: getOpenStackUsageInterval({
          lastReadAt: new Date("2026-11-10T23:45:00.000Z"),
          now: new Date("2026-11-11T00:15:00.000Z"),
        }),
      });

    expect(
      applied.closedDays.get("2026-11-10")!.get("a")!.floatingIpHours,
    ).toBe(0.5);
    expect(applied.months.get("2026-11")!.get("a")!.floatingIpHours).toBe(1);
  });

  test("a month's last day closes in that month, and the new month starts from nothing", () => {
    const start: Map<string, Map<string, OpenStackUsageQuantities>> = new Map([
      [
        "2026-11",
        new Map([
          [
            "a",
            addOpenStackUsage({
              quantities: getEmptyOpenStackUsageQuantities(),
              holding,
              hours: 100,
            }),
          ],
        ]),
      ],
    ]);
    const applied: ReturnType<typeof applyOpenStackUsageReading> =
      applyOpenStackUsageReading({
        months: start,
        holdings: [holding],
        interval: getOpenStackUsageInterval({
          lastReadAt: new Date("2026-11-30T23:45:00.000Z"),
          now: new Date("2026-12-01T00:15:00.000Z"),
        }),
      });

    expect(applied.months.get("2026-11")!.get("a")!.floatingIpHours).toBe(
      200 + 0.5,
    );
    expect(applied.months.get("2026-12")!.get("a")!.floatingIpHours).toBe(0.5);
    expect(
      applied.closedDays.get("2026-11-30")!.get("a")!.floatingIpHours,
    ).toBe(200 + 0.5);
    // Nothing's been changed in what it was given.
    expect(start.get("2026-11")!.get("a")!.floatingIpHours).toBe(200);
  });

  test("a long gap's day closes as it stood, before anything new", () => {
    const start: Map<string, Map<string, OpenStackUsageQuantities>> = new Map([
      [
        "2026-11",
        new Map([
          [
            "a",
            addOpenStackUsage({
              quantities: getEmptyOpenStackUsageQuantities(),
              holding,
              hours: 10,
            }),
          ],
        ]),
      ],
    ]);
    const applied: ReturnType<typeof applyOpenStackUsageReading> =
      applyOpenStackUsageReading({
        months: start,
        holdings: [holding],
        interval: getOpenStackUsageInterval({
          lastReadAt: new Date("2026-11-10T06:00:00.000Z"),
          now: new Date("2026-11-12T10:00:00.000Z"),
        }),
      });

    expect(
      applied.closedDays.get("2026-11-10")!.get("a")!.floatingIpHours,
    ).toBe(20);
    expect(applied.months.get("2026-11")!.get("a")!.floatingIpHours).toBe(22);
  });

  test("a project that holds nothing now keeps what it used, and gets no new hours", () => {
    const applied: ReturnType<typeof applyOpenStackUsageReading> =
      applyOpenStackUsageReading({
        months: new Map([
          [
            "2026-11",
            new Map([
              [
                "gone",
                addOpenStackUsage({
                  quantities: getEmptyOpenStackUsageQuantities(),
                  holding,
                  hours: 3,
                }),
              ],
            ]),
          ],
        ]),
        holdings: [],
        interval: getOpenStackUsageInterval({
          lastReadAt: new Date("2026-11-10T06:00:00.000Z"),
          now: new Date("2026-11-10T06:15:00.000Z"),
        }),
      });

    expect(applied.months.get("2026-11")!.get("gone")!.floatingIpHours).toBe(6);
  });
});

describe("what each project holds, from the inventory's grouped rows", () => {
  const rows: OpenStackUsageRows = {
    instances: [],
    flavors: FLAVORS,
    volumes: [],
    floatingIps: [],
    images: [],
    snapshots: [],
  };

  test("a row naming no project is nobody's, and a count of nothing isn't a holding", () => {
    expect(
      getOpenStackProjectHoldings({
        ...rows,
        instances: [
          {
            openStackProjectId: null,
            regionName: "RegionOne",
            flavorId: "small-id",
            status: "ACTIVE",
            count: 3,
          },
          {
            openStackProjectId: "a",
            regionName: "RegionOne",
            flavorId: "small-id",
            status: "ACTIVE",
            count: 0,
          },
        ],
        volumes: [{ openStackProjectId: null, type: "ssd", bytes: GB }],
        floatingIps: [{ openStackProjectId: null, count: 1 }],
        images: [{ openStackProjectId: null, bytes: GB }],
        snapshots: [{ openStackProjectId: null, bytes: GB }],
      }),
    ).toEqual([]);
  });

  test("the same flavor in two statuses is one line with both counts", () => {
    const holdings: Array<OpenStackProjectHolding> =
      getOpenStackProjectHoldings({
        ...rows,
        instances: [
          instanceGroup("a", "small-id", "ACTIVE"),
          instanceGroup("a", "small-id", "PAUSED"),
          instanceGroup("a", "small-id", "SHUTOFF"),
        ],
      });

    expect(holdings.length).toBe(1);
    expect(holdings[0]!.flavors).toEqual([
      {
        regionName: "RegionOne",
        flavorId: "small-id",
        name: "m1.small",
        vcpus: 1,
        ramMib: 2048,
        running: 2,
        shutOff: 1,
      },
    ]);
  });

  test("the same flavor id in two regions is two flavors, because each region has its own", () => {
    const holdings: Array<OpenStackProjectHolding> =
      getOpenStackProjectHoldings({
        ...rows,
        flavors: [
          ...FLAVORS,
          {
            regionName: "RegionTwo",
            flavorId: "small-id",
            name: "other",
            vcpus: 8,
            memoryBytes: 8 * GB,
          },
        ],
        instances: [
          instanceGroup("a", "small-id", "ACTIVE"),
          {
            ...instanceGroup("a", "small-id", "ACTIVE"),
            regionName: "RegionTwo",
          },
        ],
      });

    expect(
      holdings[0]!.flavors.map((flavor: { name: string | null }) => {
        return flavor.name;
      }),
    ).toEqual(["m1.small", "other"]);
  });

  test("a flavor the cloud no longer lists keeps its hours and says it can't count their vCPUs", () => {
    const holding: OpenStackProjectHolding = getOpenStackProjectHoldings({
      ...rows,
      instances: [instanceGroup("a", "deleted-flavor", "ACTIVE")],
    })[0]!;
    const quantities: OpenStackUsageQuantities = addOpenStackUsage({
      quantities: getEmptyOpenStackUsageQuantities(),
      holding,
      hours: 10,
    });
    const totals: OpenStackUsageTotals = getOpenStackUsageTotals(quantities);

    expect(totals.instanceHours).toBe(10);
    expect(totals.unknownFlavorHours).toBe(10);
    expect(totals.vcpuHours).toBe(0);
    expect(totals.memoryGbHours).toBe(0);
  });

  test("a flavor deleted after it was counted keeps what it was last known to give", () => {
    const known: OpenStackProjectHolding = getOpenStackProjectHoldings({
      ...rows,
      instances: [instanceGroup("a", "small-id", "ACTIVE")],
    })[0]!;
    const afterDeletion: OpenStackProjectHolding = getOpenStackProjectHoldings({
      ...rows,
      flavors: [],
      instances: [instanceGroup("a", "small-id", "ACTIVE")],
    })[0]!;
    const quantities: OpenStackUsageQuantities = addOpenStackUsage({
      quantities: addOpenStackUsage({
        quantities: getEmptyOpenStackUsageQuantities(),
        holding: known,
        hours: 1,
      }),
      holding: afterDeletion,
      hours: 1,
    });
    const totals: OpenStackUsageTotals = getOpenStackUsageTotals(quantities);

    expect(totals.vcpuHours).toBe(2);
    expect(totals.memoryGbHours).toBe(4);
    expect(totals.unknownFlavorHours).toBe(0);
  });

  test("a volume with no type counts under no type, and each type adds up", () => {
    const holding: OpenStackProjectHolding = getOpenStackProjectHoldings({
      ...rows,
      volumes: [
        { openStackProjectId: "a", type: null, bytes: GB },
        { openStackProjectId: "a", type: "ssd", bytes: GB * 2 },
        { openStackProjectId: "a", type: "ssd", bytes: GB * 3 },
      ],
    })[0]!;

    expect(holding.volumeGbByType).toEqual({ "": 1, ssd: 5 });
  });
});

describe("a flavor's id on its inventory row", () => {
  test.each([
    ["RegionOne/42", "RegionOne", "42"],
    ["42", "RegionOne", "42"],
    ["42", null, "42"],
    ["Region/One/42", "Region/One", "42"],
  ])(
    "%s in %s is %s",
    (externalId: string, regionName: string | null, expected: string) => {
      expect(readOpenStackUsageFlavorId({ externalId, regionName })).toBe(
        expected,
      );
    },
  );
});

describe("what a stored row says, whatever it says", () => {
  test.each([
    [null],
    [undefined],
    ["text"],
    [42],
    [[]],
    [{ flavors: "x", volumeGbHoursByType: [] }],
    [{ flavors: { a: null, b: "x" } }],
  ])("%j reads as nothing used", (value: unknown) => {
    const quantities: OpenStackUsageQuantities =
      readOpenStackUsageQuantities(value);
    expect(getOpenStackUsageTotals(quantities).instanceHours).toBe(0);
    expect(Object.keys(quantities.volumeGbHoursByType)).toEqual([]);
  });

  test("numbers that aren't numbers read as nothing, and the rest comes back as written", () => {
    const quantities: OpenStackUsageQuantities = readOpenStackUsageQuantities({
      flavors: {
        "R/1": {
          regionName: "R",
          flavorId: "1",
          name: "m1",
          vcpus: "2",
          ramMib: 1024,
          runningHours: "bad",
          shutOffHours: 3,
        },
      },
      volumeGbHoursByType: { ssd: "NaN", hdd: 7 },
      floatingIpHours: "5",
    });

    expect(quantities.flavors["R/1"]).toEqual({
      regionName: "R",
      flavorId: "1",
      name: "m1",
      vcpus: 2,
      ramMib: 1024,
      runningHours: 0,
      shutOffHours: 3,
    });
    expect(quantities.volumeGbHoursByType).toEqual({ ssd: 0, hdd: 7 });
    expect(quantities.floatingIpHours).toBe(5);
  });
});

describe("a price of zero is no price, not a free cloud", () => {
  const quantities: OpenStackUsageQuantities = addOpenStackUsage({
    quantities: getEmptyOpenStackUsageQuantities(),
    holding: {
      openStackProjectId: "a",
      flavors: [
        {
          regionName: "R",
          flavorId: "1",
          name: "m1",
          vcpus: 2,
          ramMib: 2048,
          running: 1,
          shutOff: 0,
        },
      ],
      volumeGbByType: { ssd: 10 },
      floatingIps: 1,
      imageGb: 1,
      snapshotGb: 1,
    },
    hours: 10,
  });

  test.each([
    ["no list at all", null],
    [
      "a list of zeros",
      readOpenStackPriceList({ currency: "USD", vcpuHour: 0 }),
    ],
    [
      "a list of nonsense",
      readOpenStackPriceList({
        vcpuHour: -1,
        memoryGbHour: "abc",
        imageGbHour: null,
      }),
    ],
  ])("%s has no amount, and says what it used", (_name: string, list) => {
    expect(list).toBeNull();

    const cost: OpenStackUsageCost = getOpenStackUsageCost({
      quantities,
      priceList: list as null,
    });

    expect(cost.amount).toBeNull();
    expect(cost.lines.length).toBeGreaterThan(0);
    expect(cost.unpricedLineCount).toBe(cost.lines.length);
  });

  test("a list with one price comes to what's priced, and counts what isn't", () => {
    const cost: OpenStackUsageCost = getOpenStackUsageCost({
      quantities,
      priceList: readOpenStackPriceList({ vcpuHour: 0.5, memoryGbHour: 0 }),
    });

    // 10 hours x 2 vCPUs x 0.5. Memory, the volume, the IP, the image and the snapshot have none.
    expect(cost.amount).toBe(10);
    expect(cost.unpricedLineCount).toBe(5);
  });

  test("a list with a price only for what wasn't used says no amount, because nothing used has one", () => {
    const cost: OpenStackUsageCost = getOpenStackUsageCost({
      quantities: {
        ...getEmptyOpenStackUsageQuantities(),
        floatingIpHours: 10,
      },
      priceList: readOpenStackPriceList({ vcpuHour: 1 }),
    });

    expect(cost.amount).toBeNull();
    expect(cost.unpricedLineCount).toBe(1);
  });

  test("nothing used under a list comes to nothing, which is the truth", () => {
    const cost: OpenStackUsageCost = getOpenStackUsageCost({
      quantities: getEmptyOpenStackUsageQuantities(),
      priceList: readOpenStackPriceList({ vcpuHour: 1 }),
    });

    expect(cost.amount).toBe(0);
    expect(cost.lines).toEqual([]);
  });

  test("a flavor's price of zero falls back to its units, and a flavor nobody can size has no price", () => {
    const list: OpenStackPriceList = readOpenStackPriceList({
      vcpuHour: 1,
      flavorHour: { m1: 0, gone: 0 },
    })!;

    expect(list.flavorHour).toEqual({});
    expect(getOpenStackUsageCost({ quantities, priceList: list }).amount).toBe(
      20,
    );

    const unknown: OpenStackUsageCost = getOpenStackUsageCost({
      quantities: {
        ...getEmptyOpenStackUsageQuantities(),
        flavors: {
          "R/x": {
            regionName: "R",
            flavorId: "x",
            name: null,
            vcpus: null,
            ramMib: null,
            runningHours: 5,
            shutOffHours: 0,
          },
        },
      },
      priceList: list,
    });

    expect(unknown.amount).toBeNull();
    expect(unknown.unpricedLineCount).toBe(1);
  });

  test("a currency that isn't one reads as the default, and one that is reads in capitals", () => {
    expect(
      readOpenStackPriceList({ currency: "dollars", vcpuHour: 1 })!.currency,
    ).toBe("USD");
    expect(
      readOpenStackPriceList({ currency: " eur ", vcpuHour: 1 })!.currency,
    ).toBe("EUR");
  });

  test("a month is 730 hours when a price per hour is said per month", () => {
    expect(OPENSTACK_HOURS_IN_A_MONTH).toBe((365 * 24) / 12);
  });
});

describe("time keeps adding exactly", () => {
  test("a month of quarter hours adds to its hours, with no float noise anyone reads", () => {
    let quantities: OpenStackUsageQuantities =
      getEmptyOpenStackUsageQuantities();

    for (let tick: number = 0; tick < 30 * 96; tick++) {
      quantities = addOpenStackUsage({
        quantities,
        holding: {
          openStackProjectId: "a",
          flavors: [],
          volumeGbByType: { ssd: 1 / 3 },
          floatingIps: 1,
          imageGb: 0,
          snapshotGb: 0,
        },
        hours: 0.25,
      });
    }

    expect(quantities.floatingIpHours).toBe(720);
    expect(quantities.volumeGbHoursByType["ssd"]).toBeCloseTo(240, 2);
  });

  test("what's added is added to a copy: the quantities given are left as they were", () => {
    const first: OpenStackUsageQuantities = getEmptyOpenStackUsageQuantities();
    addOpenStackUsage({
      quantities: first,
      holding: {
        openStackProjectId: "a",
        flavors: [],
        volumeGbByType: { ssd: 1 },
        floatingIps: 1,
        imageGb: 1,
        snapshotGb: 1,
      },
      hours: HOUR_MS,
    });
    expect(first).toEqual(getEmptyOpenStackUsageQuantities());
  });
});
