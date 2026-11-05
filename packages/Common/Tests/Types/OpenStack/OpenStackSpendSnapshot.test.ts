import { describe, expect, test } from "@jest/globals";
import { readOpenStackPriceList } from "../../../Types/OpenStack/OpenStackPriceList";
import {
  OpenStackProjectHolding,
  OpenStackUsageQuantities,
  OpenStackUsageTotals,
  addOpenStackUsage,
  getEmptyOpenStackUsageQuantities,
  getOpenStackUsageTotals,
} from "../../../Types/OpenStack/OpenStackProjectUsage";
import {
  OPENSTACK_SPEND_DOMAINS_KEPT,
  OPENSTACK_SPEND_GROWERS_KEPT,
  OpenStackCostSource,
  OpenStackProjectCost,
  OpenStackSpendProject,
  addOpenStackSpendCoverage,
  getOpenStackHoursLeftInMonth,
  getOpenStackHoursSoFarInMonth,
  getOpenStackOnCourseFor,
  getOpenStackProjectCost,
  getOpenStackProjectGrowth,
  getOpenStackSameDayLastMonth,
  getOpenStackSpendBreakdown,
  getOpenStackSpendDay,
  getOpenStackSpendDomains,
  getOpenStackSpendGrowers,
  getOpenStackSpendSource,
  getOpenStackVcpuHoursOnCourseFor,
  readOpenStackRatedByPeriod,
  readOpenStackSpendSnapshot,
} from "../../../Types/OpenStack/OpenStackSpendSnapshot";

const NOW: Date = new Date("2026-11-11T00:00:00.000Z");

const HOLDING: OpenStackProjectHolding = {
  openStackProjectId: "a",
  flavors: [
    {
      regionName: "R",
      flavorId: "1",
      name: "m1",
      vcpus: 2,
      ramMib: 2048,
      running: 1,
      shutOff: 1,
    },
  ],
  volumeGbByType: {},
  floatingIps: 0,
  imageGb: 0,
  snapshotGb: 0,
};

const TEN_HOURS: OpenStackUsageQuantities = addOpenStackUsage({
  quantities: getEmptyOpenStackUsageQuantities(),
  holding: HOLDING,
  hours: 10,
});

function project(
  id: string,
  overrides: Partial<OpenStackSpendProject> = {},
): OpenStackSpendProject {
  return {
    openStackProjectId: id,
    name: id,
    domainId: "d",
    domainName: "D",
    thisMonth: null,
    lastMonth: null,
    onCourseFor: null,
    source: null,
    vcpuHours: 0,
    lastMonthVcpuHours: null,
    vcpuHoursOnCourseFor: 0,
    growth: null,
    ...overrides,
  };
}

describe("where a project's cost comes from", () => {
  const prices: ReturnType<typeof readOpenStackPriceList> =
    readOpenStackPriceList({ vcpuHour: 1 });

  test("CloudKitty's rated figure replaces the calculation where there is one", () => {
    const cost: OpenStackProjectCost = getOpenStackProjectCost({
      quantities: TEN_HOURS,
      priceList: prices,
      rated: { total: 123.45, byType: {}, readAt: null },
    });

    expect(cost).toEqual({
      amount: 123.45,
      source: OpenStackCostSource.CloudKitty,
      unpricedLineCount: 0,
    });
  });

  test("a project CloudKitty hasn't rated is worked out from the prices", () => {
    const cost: OpenStackProjectCost = getOpenStackProjectCost({
      quantities: TEN_HOURS,
      priceList: prices,
      rated: null,
    });

    // 2 instances x 2 vCPUs x 10 hours x 1. Its memory has no price.
    expect(cost.amount).toBe(40);
    expect(cost.source).toBe(OpenStackCostSource.PriceList);
    expect(cost.unpricedLineCount).toBe(1);
  });

  test("a rating of nothing is CloudKitty having no rule, not a project that cost nothing", () => {
    expect(
      getOpenStackProjectCost({
        quantities: TEN_HOURS,
        priceList: prices,
        rated: { total: 0, byType: {}, readAt: null },
      }).source,
    ).toBe(OpenStackCostSource.PriceList);
  });

  test("no price and no rating is no figure, and no source", () => {
    expect(
      getOpenStackProjectCost({
        quantities: TEN_HOURS,
        priceList: null,
        rated: null,
      }),
    ).toEqual({ amount: null, source: null, unpricedLineCount: 2 });
  });

  test("CloudKitty without a price list still gives a figure", () => {
    expect(
      getOpenStackProjectCost({
        quantities: TEN_HOURS,
        priceList: null,
        rated: { total: 5, byType: {}, readAt: null },
      }).amount,
    ).toBe(5);
  });

  test("the page's word for a cloud's source follows its projects", () => {
    const source: (sources: Array<OpenStackCostSource | null>) => string = (
      sources: Array<OpenStackCostSource | null>,
    ): string => {
      return getOpenStackSpendSource({
        projects: sources.map((entry: OpenStackCostSource | null) => {
          return { source: entry };
        }),
      });
    };

    expect(source([])).toBe("usage-only");
    expect(source([null, null])).toBe("usage-only");
    expect(source([OpenStackCostSource.PriceList, null])).toBe("price-list");
    expect(source([OpenStackCostSource.CloudKitty])).toBe("cloudkitty");
    expect(
      source([OpenStackCostSource.CloudKitty, OpenStackCostSource.PriceList]),
    ).toBe("cloudkitty-and-price-list");
  });
});

describe("what CloudKitty's figures read as, on a project's row", () => {
  test.each([[null], [undefined], ["x"], [[1]], [{ "2026-11": "x" }]])(
    "%j reads as nothing",
    (value: unknown) => {
      expect(readOpenStackRatedByPeriod(value)).toEqual({});
    },
  );

  test("only what's above zero is a rating, and each type's the same", () => {
    expect(
      readOpenStackRatedByPeriod({
        "2026-11": {
          total: "12.5",
          byType: { "instance.usage": 10, volume: 0, bad: "x", ok: "2.5" },
          readAt: "2026-11-05T00:00:00.000Z",
        },
        "2026-10": { total: 0 },
        "2026-09": { total: -1 },
        "2026-08": { total: "abc" },
      }),
    ).toEqual({
      "2026-11": {
        total: 12.5,
        byType: { "instance.usage": 10, ok: 2.5 },
        readAt: "2026-11-05T00:00:00.000Z",
      },
    });
  });
});

describe("where a month is heading", () => {
  /*
   * On 2026-11-11 at 00:00, ten days of a thirty-day month have gone: 240 hours, with 480 left.
   * This project holds 2 instances of 2 vCPUs, so at 1 per vCPU-hour it adds 4 an hour. So far: 40.
   * On course for 40 + 4 x 480 = 1960.
   */
  test("hours gone and left add up to the month", () => {
    expect(getOpenStackHoursSoFarInMonth(NOW)).toBe(240);
    expect(getOpenStackHoursLeftInMonth(NOW)).toBe(480);
  });

  test("on prices: what it's come to, and what it holds now for every hour left", () => {
    const priceList: ReturnType<typeof readOpenStackPriceList> =
      readOpenStackPriceList({ vcpuHour: 1 });

    expect(
      getOpenStackOnCourseFor({
        cost: {
          amount: 40,
          source: OpenStackCostSource.PriceList,
          unpricedLineCount: 0,
        },
        holding: HOLDING,
        priceList,
        now: NOW,
      }),
    ).toBe(1960);
  });

  test("a project that holds nothing now stays where it got to", () => {
    expect(
      getOpenStackOnCourseFor({
        cost: {
          amount: 40,
          source: OpenStackCostSource.PriceList,
          unpricedLineCount: 0,
        },
        holding: undefined,
        priceList: readOpenStackPriceList({ vcpuHour: 1 }),
        now: NOW,
      }),
    ).toBe(40);
  });

  test("on CloudKitty: straight on from the part of the month gone, once a day of it has", () => {
    const cost: OpenStackProjectCost = {
      amount: 240,
      source: OpenStackCostSource.CloudKitty,
      unpricedLineCount: 0,
    };

    // 240 over 240 hours is 1 an hour, for 720 hours.
    expect(
      getOpenStackOnCourseFor({
        cost,
        holding: HOLDING,
        priceList: null,
        now: NOW,
      }),
    ).toBe(720);
    expect(
      getOpenStackOnCourseFor({
        cost,
        holding: HOLDING,
        priceList: null,
        now: new Date("2026-11-01T06:00:00.000Z"),
      }),
    ).toBeNull();
  });

  test("no figure has nowhere to head", () => {
    expect(
      getOpenStackOnCourseFor({
        cost: { amount: null, source: null, unpricedLineCount: 3 },
        holding: HOLDING,
        priceList: null,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("vCPU-hours head the same way when nothing's priced: 40 + 4 x 480", () => {
    expect(
      getOpenStackVcpuHoursOnCourseFor({
        quantities: TEN_HOURS,
        holding: HOLDING,
        now: NOW,
      }),
    ).toBe(40 + 4 * 480);
    expect(
      getOpenStackVcpuHoursOnCourseFor({
        quantities: TEN_HOURS,
        holding: undefined,
        now: NOW,
      }),
    ).toBe(40);
  });
});

describe("who is growing", () => {
  test("in money where there's a price, in vCPU-hours where there isn't", () => {
    expect(
      getOpenStackProjectGrowth({
        onCourseFor: 150,
        lastMonth: 100,
        vcpuHoursOnCourseFor: 1,
        lastMonthVcpuHours: 1,
        isLastMonthRead: true,
      }),
    ).toBe(50);
    expect(
      getOpenStackProjectGrowth({
        onCourseFor: null,
        lastMonth: null,
        vcpuHoursOnCourseFor: 90,
        lastMonthVcpuHours: 30,
        isLastMonthRead: true,
      }),
    ).toBe(60);
  });

  test("new this month on a cloud that was read last month has grown by all of it", () => {
    expect(
      getOpenStackProjectGrowth({
        onCourseFor: 75,
        lastMonth: null,
        vcpuHoursOnCourseFor: 0,
        lastMonthVcpuHours: 0,
        isLastMonthRead: true,
      }),
    ).toBe(75);
  });

  test("with no last month read, nothing can be said to have grown", () => {
    expect(
      getOpenStackProjectGrowth({
        onCourseFor: 75,
        lastMonth: null,
        vcpuHoursOnCourseFor: 10,
        lastMonthVcpuHours: null,
        isLastMonthRead: false,
      }),
    ).toBeNull();
  });

  test("top growers are the largest first, keep to the count, and leave out what's shrinking", () => {
    const projects: Array<OpenStackSpendProject> = [
      project("shrinking", { growth: -5 }),
      project("flat", { growth: 0 }),
      project("next-to-nothing", { growth: 0.004 }),
      project("unknown", { growth: null }),
      project("small", { growth: 1 }),
      project("big", { growth: 100 }),
    ];

    for (let index: number = 0; index < OPENSTACK_SPEND_GROWERS_KEPT; index++) {
      projects.push(project(`p${index}`, { growth: 2 }));
    }

    const growers: Array<OpenStackSpendProject> =
      getOpenStackSpendGrowers(projects);

    expect(growers.length).toBe(OPENSTACK_SPEND_GROWERS_KEPT);
    expect(growers[0]!.openStackProjectId).toBe("big");
    expect(
      growers.map((entry: OpenStackSpendProject): string => {
        return entry.openStackProjectId;
      }),
    ).not.toEqual(
      expect.arrayContaining([
        "shrinking",
        "flat",
        "unknown",
        "next-to-nothing",
      ]),
    );
  });
});

describe("what's left of a domain's rows", () => {
  const totals: OpenStackUsageTotals = getOpenStackUsageTotals(TEN_HOURS);

  test("projects add up to their domain, and a project in no domain is in none", () => {
    const result: ReturnType<typeof getOpenStackSpendDomains> =
      getOpenStackSpendDomains([
        { project: project("a", { thisMonth: 10, lastMonth: 5 }), totals },
        { project: project("b", { thisMonth: 20, onCourseFor: 40 }), totals },
        {
          project: project("c", {
            domainId: null,
            domainName: null,
            thisMonth: 1,
          }),
          totals,
        },
      ]);

    expect(result.domainCount).toBe(2);
    expect(result.domains[0]).toMatchObject({
      domainId: "d",
      name: "D",
      projectCount: 2,
      thisMonth: 30,
      lastMonth: 5,
      onCourseFor: 40,
      vcpuHours: 80,
    });
    expect(result.domains[1]).toMatchObject({
      domainId: null,
      projectCount: 1,
      thisMonth: 1,
    });
  });

  test("a domain with no figure has none, rather than zero", () => {
    expect(
      getOpenStackSpendDomains([{ project: project("a"), totals }]).domains[0]!
        .thisMonth,
    ).toBeNull();
  });

  test("keeps to the largest, and still says how many there are", () => {
    const rows: Array<{
      project: OpenStackSpendProject;
      totals: OpenStackUsageTotals;
    }> = [];

    for (
      let index: number = 0;
      index < OPENSTACK_SPEND_DOMAINS_KEPT + 3;
      index++
    ) {
      rows.push({
        project: project(`p${index}`, {
          domainId: `d${index}`,
          thisMonth: index,
        }),
        totals,
      });
    }

    const result: ReturnType<typeof getOpenStackSpendDomains> =
      getOpenStackSpendDomains(rows);

    expect(result.domainCount).toBe(OPENSTACK_SPEND_DOMAINS_KEPT + 3);
    expect(result.domains.length).toBe(OPENSTACK_SPEND_DOMAINS_KEPT);
    expect(result.domains[0]!.thisMonth).toBe(OPENSTACK_SPEND_DOMAINS_KEPT + 2);
  });
});

describe("a cloud's usage by flavor and by volume type", () => {
  const quantities: OpenStackUsageQuantities = addOpenStackUsage({
    quantities: TEN_HOURS,
    holding: {
      openStackProjectId: "a",
      flavors: [
        {
          regionName: "R",
          flavorId: "2",
          name: "m2",
          vcpus: 8,
          ramMib: 8192,
          running: 1,
          shutOff: 0,
        },
      ],
      volumeGbByType: { ssd: 10, hdd: 100 },
      floatingIps: 0,
      imageGb: 0,
      snapshotGb: 0,
    },
    hours: 1,
  });

  test("with no prices, the largest usage first and no amounts", () => {
    const breakdown: ReturnType<typeof getOpenStackSpendBreakdown> =
      getOpenStackSpendBreakdown({ quantities, priceList: null });

    expect(
      breakdown.byFlavor.map((row: { name: string | null }) => {
        return row.name;
      }),
    ).toEqual(["m1", "m2"]);
    expect(breakdown.byFlavor[0]).toMatchObject({
      instanceHours: 20,
      shutOffInstanceHours: 10,
      vcpuHours: 40,
      memoryGbHours: 40,
      amount: null,
    });
    expect(breakdown.byVolumeType[0]).toEqual({
      type: "hdd",
      gbHours: 100,
      amount: null,
    });
    expect(breakdown.flavorCount).toBe(2);
    expect(breakdown.volumeTypeCount).toBe(2);
  });

  test("with prices, a flavor's amount adds its lines, and the largest amount leads", () => {
    const breakdown: ReturnType<typeof getOpenStackSpendBreakdown> =
      getOpenStackSpendBreakdown({
        quantities,
        priceList: readOpenStackPriceList({
          vcpuHour: 1,
          memoryGbHour: 0.5,
          volumeTypeGbHour: { ssd: 1 },
        }),
      });

    // m1: 40 vCPU-hours + 40 GB-hours x 0.5 = 60. m2: 8 + 8 x 0.5 = 12.
    expect(breakdown.byFlavor[0]!.amount).toBe(60);
    expect(breakdown.byFlavor[1]!.amount).toBe(12);
    // ssd has its own price and hdd none, so ssd leads though it's smaller.
    expect(breakdown.byVolumeType[0]).toEqual({
      type: "ssd",
      gbHours: 10,
      amount: 10,
    });
    expect(breakdown.byVolumeType[1]!.amount).toBeNull();
  });
});

describe("the same day last month", () => {
  test.each([
    ["2026-11-05", "2026-10-05"],
    ["2026-03-31", "2026-02-28"],
    ["2024-03-31", "2024-02-29"],
    ["2026-01-15", "2025-12-15"],
    ["2026-12-31", "2026-11-30"],
  ])("%s reads %s", (day: string, expected: string) => {
    expect(getOpenStackSameDayLastMonth(day)).toBe(expected);
  });
});

describe("what a day's own figures are", () => {
  const atMidnight: OpenStackUsageTotals = {
    ...getOpenStackUsageTotals(TEN_HOURS),
    vcpuHours: 30,
    memoryGbHours: 10,
    volumeGbHours: 5,
    floatingIpHours: 2,
  };

  test("the month at its midnight less the month at the one before", () => {
    expect(
      getOpenStackSpendDay({
        day: "2026-11-05",
        monthAtMidnight: atMidnight,
        monthAtLastMidnight: { ...atMidnight, vcpuHours: 10 },
      }),
    ).toMatchObject({
      day: "2026-11-05",
      vcpuHours: 20,
      memoryGbHours: 0,
    });
  });

  test("a month's first day is all of it, and it never reads below nothing", () => {
    expect(
      getOpenStackSpendDay({
        day: "2026-11-01",
        monthAtMidnight: atMidnight,
        monthAtLastMidnight: null,
      }).vcpuHours,
    ).toBe(30);
    expect(
      getOpenStackSpendDay({
        day: "2026-11-02",
        monthAtMidnight: atMidnight,
        monthAtLastMidnight: { ...atMidnight, vcpuHours: 99 },
      }).vcpuHours,
    ).toBe(0);
  });
});

describe("how much of a period was counted", () => {
  test("adds up, and remembers when counting began", () => {
    const first: ReturnType<typeof addOpenStackSpendCoverage> =
      addOpenStackSpendCoverage({
        coverage: null,
        countedHours: 0.25,
        notCountedHours: 0,
        countedFrom: new Date("2026-11-03T00:00:00.000Z"),
      });

    expect(first).toEqual({
      firstReadAt: "2026-11-03T00:00:00.000Z",
      countedHours: 0.25,
      notCountedHours: 0,
    });
    expect(
      addOpenStackSpendCoverage({
        coverage: first,
        countedHours: 1,
        notCountedHours: 3,
        countedFrom: new Date("2026-11-09T00:00:00.000Z"),
      }),
    ).toEqual({
      firstReadAt: "2026-11-03T00:00:00.000Z",
      countedHours: 1.25,
      notCountedHours: 3,
    });
  });

  test("nothing counted yet hasn't begun", () => {
    expect(
      addOpenStackSpendCoverage({
        coverage: null,
        countedHours: 0,
        notCountedHours: 0,
        countedFrom: NOW,
      }).firstReadAt,
    ).toBeNull();
  });
});

describe("a stored snapshot", () => {
  test.each([[null], [undefined], ["text"], [[]], [{}], [{ readAt: "x" }]])(
    "%j is none",
    (value: unknown) => {
      expect(readOpenStackSpendSnapshot(value)).toBeNull();
    },
  );

  test("one with a time and a month reads as what it is", () => {
    const stored: { readAt: string; month: string } = {
      readAt: "2026-11-05T00:00:00.000Z",
      month: "2026-11",
    };

    expect(readOpenStackSpendSnapshot(stored)).toBe(stored);
  });
});
