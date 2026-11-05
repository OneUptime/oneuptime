import { describe, expect, test } from "@jest/globals";
import {
  OpenStackCapacityFlavor,
  OpenStackCapacityForecastRow,
  OpenStackCapacitySnapshot,
  buildOpenStackCapacitySnapshot,
} from "../../../Types/OpenStack/OpenStackCapacitySnapshot";
import {
  formatOpenStackCapacityAmount,
  formatOpenStackRatio,
  formatOpenStackRatioRange,
  getOpenStackCapacityCsv,
  getOpenStackCapacityResourceTitle,
  getOpenStackCapacityView,
  sortOpenStackCapacityForecasts,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackCapacityView";

/*
 * What the Capacity page says of a snapshot, and what goes in its CSV. The sums are
 * OpenStackCapacity.test.ts's. This is the narrowing, the wording and what a spreadsheet does.
 */

const NOW: Date = new Date("2026-11-04T12:00:00Z");

function flavorOf(
  name: string,
  regionName: string,
  extra?: Partial<OpenStackCapacityFlavor>,
): OpenStackCapacityFlavor {
  return {
    id: name,
    name,
    regionName,
    request: {
      resources: { VCPU: 1, MEMORY_MB: 2048 },
      requiredTraits: [],
      forbiddenTraits: [],
    },
    isPublic: true,
    isDisabled: false,
    instanceCount: 0,
    placementAnswer: null,
    ...extra,
  };
}

function forecastOf(
  name: string,
  forecast: OpenStackCapacityForecastRow["forecast"],
): OpenStackCapacityForecastRow {
  return {
    scope: "zone",
    name,
    id: "",
    regionName: "RegionOne",
    resourceClass: "VCPU",
    forecast,
  };
}

const SNAPSHOT: OpenStackCapacitySnapshot = buildOpenStackCapacitySnapshot({
  hosts: [
    {
      name: "a",
      regionName: "RegionOne",
      zone: "nova",
      aggregates: ["rack"],
      state: "up",
      instanceCount: 3,
      inventories: {
        VCPU: { total: 4, reserved: 0, allocationRatio: 4, used: 3 },
        MEMORY_MB: { total: 16384, reserved: 512, allocationRatio: 1, used: 0 },
      },
    },
    {
      name: "b",
      regionName: "RegionTwo",
      zone: "nova",
      aggregates: [],
      state: "up",
      instanceCount: 0,
      inventories: {
        VCPU: { total: 8, reserved: 0, allocationRatio: 1, used: 0 },
        MEMORY_MB: { total: 8192, reserved: 0, allocationRatio: 1, used: 0 },
      },
    },
  ],
  flavors: [flavorOf("m1.small", "RegionOne"), flavorOf("m1.small", "RegionTwo")],
  pools: [],
  forecasts: [
    forecastOf("nova", { state: "days", days: 3 }),
    {
      ...forecastOf("nova", { state: "full" }),
      regionName: "RegionTwo",
    },
  ],
  now: NOW,
});

describe("what a region reads", () => {
  test("the whole cloud with none chosen", () => {
    const view: ReturnType<typeof getOpenStackCapacityView> =
      getOpenStackCapacityView({ snapshot: SNAPSHOT, region: null });

    expect(view.overall?.scope).toBe("cloud");
    expect(view.overall?.hostCount).toBe(2);
    expect(view.zones).toHaveLength(2);
    expect(view.flavors).toHaveLength(2);
    expect(view.forecasts).toHaveLength(2);
  });

  test("only what's in it with one chosen", () => {
    const view: ReturnType<typeof getOpenStackCapacityView> =
      getOpenStackCapacityView({ snapshot: SNAPSHOT, region: "RegionTwo" });

    expect(view.overall?.regionName).toBe("RegionTwo");
    expect(view.zones).toHaveLength(1);
    expect(view.flavors).toHaveLength(1);
    expect(view.flavors[0]!.fits).toBe(4);
    expect(view.forecasts).toHaveLength(1);
    expect(view.aggregates).toEqual([]);
  });

  test("a region nothing says anything of has nothing to show", () => {
    expect(
      getOpenStackCapacityView({ snapshot: SNAPSHOT, region: "Elsewhere" })
        .overall,
    ).toBe(null);
  });
});

describe("what fills up", () => {
  test("soonest first, and what can't be told last", () => {
    expect(
      sortOpenStackCapacityForecasts([
        forecastOf("new", { state: "not-enough-history" }),
        forecastOf("flat", { state: "not-growing" }),
        forecastOf("later", { state: "days", days: 20 }),
        forecastOf("full", { state: "full" }),
        forecastOf("soon", { state: "days", days: 2 }),
      ]).map((row: OpenStackCapacityForecastRow): string => {
        return row.name;
      }),
    ).toEqual(["full", "soon", "later", "flat", "new"]);
  });
});

describe("how an amount reads", () => {
  test.each([
    ["VCPU", 1200, "1,200"],
    ["PCPU", 8, "8"],
    ["CUSTOM_BAREMETAL_GOLD", 3, "3"],
    ["IPV4_ADDRESS", 253, "253"],
  ])("%s %d is %s", (resourceClass: string, amount: number, text: string) => {
    expect(formatOpenStackCapacityAmount(resourceClass, amount)).toBe(text);
  });

  test("Placement counts memory in MB and disk in GB", () => {
    expect(formatOpenStackCapacityAmount("MEMORY_MB", 1024)).toContain("1");
    expect(formatOpenStackCapacityAmount("MEMORY_MB", 1024)).toContain("G");
    expect(formatOpenStackCapacityAmount("DISK_GB", 1024)).toContain("T");
  });

  test("a class it doesn't know is called what Placement calls it", () => {
    expect(getOpenStackCapacityResourceTitle("VCPU")).toBe("vCPUs");
    expect(getOpenStackCapacityResourceTitle("CUSTOM_BAREMETAL_GOLD")).toBe(
      "CUSTOM_BAREMETAL_GOLD",
    );
  });

  test("a ratio reads as an operator writes it", () => {
    expect(formatOpenStackRatio(16)).toBe("16:1");
    expect(formatOpenStackRatio(1.5)).toBe("1.5:1");
    expect(formatOpenStackRatio(null)).toBe("");
    expect(
      formatOpenStackRatioRange({ lowestRatio: 4, highestRatio: 4 }),
    ).toBe("4:1");
    expect(
      formatOpenStackRatioRange({ lowestRatio: 1, highestRatio: 16 }),
    ).toBe("1:1 to 16:1");
    expect(
      formatOpenStackRatioRange({ lowestRatio: null, highestRatio: null }),
    ).toBe("");
  });
});

describe("the CSV", () => {
  test("holds each table under a line that says what it is", () => {
    const csv: string = getOpenStackCapacityCsv({
      snapshot: SNAPSHOT,
      region: "RegionOne",
    });

    expect(csv).toContain(`Generated at,${NOW.toISOString()}`);
    expect(csv).toContain("\nFlavors\n");
    expect(csv).toContain("\nFlavors by zone and aggregate\n");
    expect(csv).toContain("\nAllocated, by zone and aggregate\n");
    expect(csv).toContain("\nWhen things fill up\n");
    // (16384 - 512) / 2048 = 7, and 13 vCPUs free: seven, the one count this row is about.
    expect(csv).toContain(
      "RegionOne,m1.small,MEMORY_MB:2048 VCPU:1,7,false,1,7,false,0,inventories,",
    );
    expect(csv).toContain("RegionOne,m1.small,nova,7");
    expect(csv).toContain("RegionOne,m1.small,rack,7");
    expect(csv).toContain("RegionOne,zone,nova,1,0,0,VCPU,3,16,18.8,0,4,4");
    expect(csv).toContain("RegionOne,aggregate,rack,1,0,0,VCPU,3,16,18.8,0,4,4");
    expect(csv).toContain("RegionOne,zone,nova,VCPU,3 days");
  });

  test("reads only the region chosen", () => {
    const csv: string = getOpenStackCapacityCsv({
      snapshot: SNAPSHOT,
      region: "RegionOne",
    });

    expect(csv).not.toContain("RegionTwo");
  });

  test("says what a forecast says in words, when it can't say a number", () => {
    const snapshot: OpenStackCapacitySnapshot = {
      ...SNAPSHOT,
      forecasts: [
        forecastOf("new", { state: "not-enough-history" }),
        forecastOf("flat", { state: "not-growing" }),
        forecastOf("full", { state: "full" }),
      ],
    };
    const csv: string = getOpenStackCapacityCsv({ snapshot, region: null });

    expect(csv).toContain("RegionOne,zone,new,VCPU,Not enough history");
    expect(csv).toContain("RegionOne,zone,flat,VCPU,Not growing");
    expect(csv).toContain("RegionOne,zone,full,VCPU,Full now");
  });

  test("a name someone typed can't run in a spreadsheet, or break a row", () => {
    const snapshot: OpenStackCapacitySnapshot = {
      ...SNAPSHOT,
      flavors: [
        {
          ...SNAPSHOT.flavors[0]!,
          name: '=HYPERLINK("https://evil.example")',
        },
        { ...SNAPSHOT.flavors[0]!, name: "with,comma" },
      ],
    };
    const csv: string = getOpenStackCapacityCsv({ snapshot, region: null });

    expect(csv).toContain(`"'=HYPERLINK(""https://evil.example"")"`);
    expect(csv).not.toContain("\n=HYPERLINK");
    expect(csv).toContain('"with,comma"');
  });

  test("a negative number is left alone: it's no formula", () => {
    const snapshot: OpenStackCapacitySnapshot = {
      ...SNAPSHOT,
      zones: [],
      aggregates: [],
      forecasts: [],
      flavors: [{ ...SNAPSHOT.flavors[0]!, fits: -1 }],
    };

    expect(getOpenStackCapacityCsv({ snapshot, region: null })).toContain(",-1,");
  });
});
