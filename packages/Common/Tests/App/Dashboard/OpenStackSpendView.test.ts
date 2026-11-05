import { describe, expect, test } from "@jest/globals";
import { getOpenStackSpendTiles } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Spend";
import {
  OPENSTACK_SPEND_NOT_BILLING_TEXT,
  OPENSTACK_SPEND_SOURCE_TEXT,
  formatOpenStackSpendMoney,
  formatOpenStackUsageNumber,
  getOpenStackCoverageNote,
  getOpenStackDailyVcpuHours,
  getOpenStackSpendCsv,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackSpendView";
import {
  getOpenStackPriceListFormValues,
  getOpenStackPriceListFromForm,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackPriceListModal";
import OpenStackProjectUsage from "../../../Models/DatabaseModels/OpenStackProjectUsage";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import { readOpenStackPriceList } from "../../../Types/OpenStack/OpenStackPriceList";
import {
  addOpenStackUsage,
  getEmptyOpenStackUsageQuantities,
} from "../../../Types/OpenStack/OpenStackProjectUsage";
import { OpenStackSpendSnapshot } from "../../../Types/OpenStack/OpenStackSpendSnapshot";
import { Translator } from "../../../UI/Utils/TranslateTemplate";

const translator: Translator = {
  translateText: (text: string): string => {
    return text;
  },
  translateTemplate: (text: string, values?: Record<string, unknown>) => {
    return Object.keys(values || {}).reduce(
      (out: string, name: string): string => {
        return out.split(`{{${name}}}`).join(String(values![name]));
      },
      text,
    );
  },
  formatNumber: (value: number): string => {
    return String(value);
  },
  language: "en",
} as unknown as Translator;

const SNAPSHOT: OpenStackSpendSnapshot = {
  readAt: "2026-11-10T00:00:00.000Z",
  month: "2026-11",
  currency: null,
  source: "usage-only",
  projectCount: 1,
  projectsRatedByCloudKitty: 0,
  cloudKittyReadAt: null,
  projectsPartlyPriced: 0,
  thisMonth: null,
  lastMonth: null,
  onCourseFor: null,
  usage: {
    instanceHours: 10,
    shutOffInstanceHours: 0,
    unknownFlavorHours: 0,
    vcpuHours: 1234.5,
    memoryGbHours: 20,
    volumeGbHours: 30,
    floatingIpHours: 40,
    imageGbHours: 0,
    snapshotGbHours: 0,
  },
  lastMonthUsage: null,
  comparison: null,
  coverage: { firstReadAt: null, countedHours: 1, notCountedHours: 0 },
  lastMonthCoverage: null,
  byFlavor: [],
  flavorCount: 0,
  byVolumeType: [],
  volumeTypeCount: 0,
  domains: [],
  domainCount: 0,
  growers: [],
  days: [],
  months: [],
  monthAtLastMidnight: null,
  waste: null,
  wasteReadAt: null,
};

const ROUTE: Route = new Route("/recommendations");

describe("what a page says about money", () => {
  test("no figure is no figure, never nothing", () => {
    expect(
      formatOpenStackSpendMoney({
        amount: null,
        currency: "USD",
        translator,
      }),
    ).toBe("–");
    expect(formatOpenStackUsageNumber(null, translator)).toBe("–");
  });

  test("a currency that's set is said, and none that isn't", () => {
    expect(
      formatOpenStackSpendMoney({ amount: 12.345, currency: "EUR", translator }),
    ).toContain("12.35");
    expect(
      formatOpenStackSpendMoney({ amount: 12.345, currency: "EUR", translator }),
    ).toContain("€");

    const plain: string = formatOpenStackSpendMoney({
      amount: 12.5,
      currency: null,
      translator,
    });

    expect(plain).toContain("12.50");
    expect(plain).not.toContain("$");
  });

  test("a currency nobody's heard of still reads", () => {
    expect(
      formatOpenStackSpendMoney({
        amount: 1,
        currency: "not a currency",
        translator,
      }),
    ).toBe("not a currency 1.00");
  });

  test.each(Object.entries(OPENSTACK_SPEND_SOURCE_TEXT))(
    "the words for %s don't read as an invoice",
    (_source: string, words: string) => {
      expect(words).not.toMatch(/\b(invoice|bill|billed|due|charged)\b/i);
    },
  );

  test("the page says outright that it isn't billing", () => {
    expect(OPENSTACK_SPEND_NOT_BILLING_TEXT).toContain("doesn't invoice");
  });
});

describe("the tiles", () => {
  test("with nothing priced, what was used, and no money", () => {
    const tiles: ReturnType<typeof getOpenStackSpendTiles> =
      getOpenStackSpendTiles({
        snapshot: SNAPSHOT,
        recommendationsRoute: ROUTE,
        translator,
      });

    expect(
      tiles.map((tile: { key: string }): string => {
        return tile.key;
      }),
    ).toEqual(["vcpu", "memory", "volume", "reclaim"]);
    expect(tiles[0]!.value).toContain("1,234.5");
  });

  test("priced, this month against the same days last month", () => {
    const tiles: ReturnType<typeof getOpenStackSpendTiles> =
      getOpenStackSpendTiles({
        snapshot: {
          ...SNAPSHOT,
          currency: "USD",
          thisMonth: 110,
          lastMonth: 300,
          onCourseFor: 330,
          comparison: {
            throughDay: "2026-11-09",
            lastMonthThroughDay: "2026-10-09",
            thisMonth: 110,
            lastMonth: 100,
            thisMonthVcpuHours: 1,
            lastMonthVcpuHours: 1,
            priceListKey: "",
          },
        },
        recommendationsRoute: ROUTE,
        translator,
      });

    expect(tiles[0]!.value).toContain("110");
    expect(tiles[0]!.sublabel).toBe("Up 10% on the same days last month");
    expect(tiles[1]!.value).toContain("330");
    expect(tiles[2]!.value).toContain("300");
  });

  test("a new cloud says it hasn't the history, rather than nothing last month", () => {
    const tiles: ReturnType<typeof getOpenStackSpendTiles> =
      getOpenStackSpendTiles({
        snapshot: { ...SNAPSHOT, currency: "USD", thisMonth: 110 },
        recommendationsRoute: ROUTE,
        translator,
      });

    expect(tiles[2]!.value).toBe("–");
    expect(tiles[2]!.sublabel).toBe("Not enough history yet");
    expect(tiles[0]!.sublabel).toBeUndefined();
  });

  test("a last month read for only part of it says from when", () => {
    const tiles: ReturnType<typeof getOpenStackSpendTiles> =
      getOpenStackSpendTiles({
        snapshot: {
          ...SNAPSHOT,
          currency: "USD",
          thisMonth: 110,
          lastMonth: 20,
          lastMonthCoverage: {
            firstReadAt: "2026-10-20T00:00:00.000Z",
            countedHours: 288,
            notCountedHours: 0,
          },
        },
        recommendationsRoute: ROUTE,
        translator,
      });

    expect(tiles[2]!.sublabel).toContain("Only counted from");
  });

  test("what could be reclaimed adds up across the rules, and leads to them", () => {
    const tiles: ReturnType<typeof getOpenStackSpendTiles> =
      getOpenStackSpendTiles({
        snapshot: {
          ...SNAPSHOT,
          waste: [{ count: 2 }, { count: 3 }] as never,
        },
        recommendationsRoute: ROUTE,
        translator,
      });

    expect(tiles[3]!.value).toBe("5");
    expect(tiles[3]!.to).toBe(ROUTE);
  });
});

describe("hours nobody was reading", () => {
  test("are said once they add up to anything, and not before", () => {
    expect(
      getOpenStackCoverageNote({
        snapshot: {
          ...SNAPSHOT,
          coverage: { firstReadAt: null, countedHours: 1, notCountedHours: 42 },
        },
        translator,
      }),
    ).toContain("42 hours");
    expect(
      getOpenStackCoverageNote({
        snapshot: {
          ...SNAPSHOT,
          coverage: {
            firstReadAt: null,
            countedHours: 1,
            notCountedHours: 0.5,
          },
        },
        translator,
      }),
    ).toBeNull();
  });
});

describe("the CSV", () => {
  function row(data: Partial<OpenStackProjectUsage>): OpenStackProjectUsage {
    const usage: OpenStackProjectUsage = new OpenStackProjectUsage();
    usage.openStackProjectId = "p1";
    usage.name = "Payments";
    usage.domainName = "Default";
    usage.quantities = addOpenStackUsage({
      quantities: getEmptyOpenStackUsageQuantities(),
      holding: {
        openStackProjectId: "p1",
        flavors: [
          {
            regionName: "R",
            flavorId: "1",
            name: "m1.small",
            vcpus: 2,
            ramMib: 2048,
            running: 1,
            shutOff: 0,
          },
        ],
        volumeGbByType: { ssd: 10 },
        floatingIps: 1,
        imageGb: 0,
        snapshotGb: 0,
      },
      hours: 10,
    }) as unknown as JSONObject;
    Object.assign(usage, data);
    return usage;
  }

  test("one line per project and thing used, each with its unit and estimate", () => {
    const csv: string = getOpenStackSpendCsv({
      rows: [row({})],
      month: "2026-11",
      priceList: readOpenStackPriceList({
        currency: "EUR",
        vcpuHour: 0.5,
        volumeGbHour: 0.01,
      }),
      currency: "EUR",
    });
    const lines: Array<string> = csv.split("\n");

    expect(lines[0]).toContain("Estimated cost (EUR)");
    expect(lines).toContain(
      "2026-11,Payments,p1,Default,vCPUs,m1.small,R,20,vCPU-hours,0.5,10,Your prices",
    );
    expect(lines).toContain(
      "2026-11,Payments,p1,Default,Memory,m1.small,R,20,GB-hours,,,",
    );
    expect(lines).toContain(
      "2026-11,Payments,p1,Default,Volumes,ssd,,100,GB-hours,0.01,1,Your prices",
    );
    expect(lines).toContain(
      "2026-11,Payments,p1,Default,Floating IPs,,,10,IP-hours,,,",
    );
  });

  test("with no prices, it's still everything used", () => {
    const csv: string = getOpenStackSpendCsv({
      rows: [row({})],
      month: "2026-11",
      priceList: null,
      currency: null,
    });

    expect(csv.split("\n")[0]).toContain("Estimated cost,Source");
    expect(csv).toContain("vCPU-hours");
    expect(csv).not.toContain("Your prices");
  });

  test("CloudKitty's figure is its own line, and the usage lines beside it have no amount", () => {
    const csv: string = getOpenStackSpendCsv({
      rows: [row({ costSource: "cloudkitty", estimatedCost: 12.5 })],
      month: "2026-11",
      priceList: readOpenStackPriceList({ vcpuHour: 1 }),
      currency: "USD",
    });

    expect(csv).toContain(
      "2026-11,Payments,p1,Default,CloudKitty rating,,,,,,12.5,CloudKitty",
    );
    expect(csv).not.toContain("Your prices");
  });

  test("a name from outside can't become a spreadsheet formula", () => {
    const csv: string = getOpenStackSpendCsv({
      rows: [row({ name: "=HYPERLINK(evil)" })],
      month: "2026-11",
      priceList: null,
      currency: null,
    });

    expect(csv).not.toContain(",=HYPERLINK");
  });
});

describe("one project's days", () => {
  function day(period: string, vcpuHours: number): OpenStackProjectUsage {
    const usage: OpenStackProjectUsage = new OpenStackProjectUsage();
    usage.period = period;
    usage.vcpuHours = vcpuHours;
    return usage;
  }

  test("each is its row less the one before it, and a month starts over", () => {
    expect(
      getOpenStackDailyVcpuHours([
        day("2026-11-02", 30),
        day("2026-11", 40),
        day("2026-10-31", 100),
        day("2026-11-01", 10),
        day("2026-10-30", 90),
      ]),
    ).toEqual([
      { day: "2026-10-30", vcpuHours: 90 },
      { day: "2026-10-31", vcpuHours: 10 },
      { day: "2026-11-01", vcpuHours: 10 },
      { day: "2026-11-02", vcpuHours: 20 },
    ]);
  });

  test("a month's rows aren't days, and nothing reads below nothing", () => {
    expect(getOpenStackDailyVcpuHours([day("2026-11", 40)])).toEqual([]);
    expect(
      getOpenStackDailyVcpuHours([day("2026-11-01", 10), day("2026-11-02", 5)])[1],
    ).toEqual({ day: "2026-11-02", vcpuHours: 0 });
  });
});

describe("the price form", () => {
  const flavorNames: Array<string> = ["m1.small"];
  const volumeTypes: Array<string> = ["ssd"];

  test("empty is no price, and zero the same", () => {
    const list: JSONObject = getOpenStackPriceListFromForm({
      values: {
        currency: "eur",
        vcpuHour: "0.02",
        memoryGbHour: "",
        volumeGbHour: "0",
      },
      flavorNames,
      volumeTypes,
    });

    expect(list).toMatchObject({
      currency: "EUR",
      vcpuHour: 0.02,
      memoryGbHour: 0,
      volumeGbHour: 0,
      flavorHour: {},
      volumeTypeGbHour: {},
      leaveOutShutOff: false,
    });
  });

  test("a flavor's and a type's own price, by name", () => {
    const list: JSONObject = getOpenStackPriceListFromForm({
      values: {
        currency: "USD",
        "flavor:m1.small": "0.05",
        "type:ssd": "0.001",
        leaveOutShutOff: true,
      },
      flavorNames,
      volumeTypes,
    });

    expect(list["flavorHour"]).toEqual({ "m1.small": 0.05 });
    expect(list["volumeTypeGbHour"]).toEqual({ ssd: 0.001 });
    expect(list["leaveOutShutOff"]).toBe(true);
  });

  test("saved values come back as typed, and a price of nothing comes back empty", () => {
    expect(
      getOpenStackPriceListFormValues({
        stored: {
          currency: "EUR",
          vcpuHour: 0.02,
          memoryGbHour: 0,
          flavorHour: { "m1.small": 0.05 },
          volumeTypeGbHour: {},
          leaveOutShutOff: true,
        },
        flavorNames,
        volumeTypes,
      }),
    ).toMatchObject({
      currency: "EUR",
      vcpuHour: "0.02",
      memoryGbHour: "",
      "flavor:m1.small": "0.05",
      "type:ssd": "",
      leaveOutShutOff: true,
    });
  });

  test("a form with nothing saved opens on the default currency", () => {
    expect(
      getOpenStackPriceListFormValues({
        stored: null,
        flavorNames: [],
        volumeTypes: [],
      })["currency"],
    ).toBe("USD");
  });

  test("whatever it saves reads back the same way the worker reads it", () => {
    const list: JSONObject = getOpenStackPriceListFromForm({
      values: { currency: "EUR", vcpuHour: "0.02" },
      flavorNames,
      volumeTypes,
    });

    expect(readOpenStackPriceList(list)).toMatchObject({
      currency: "EUR",
      vcpuHour: 0.02,
    });
    expect(
      readOpenStackPriceList(
        getOpenStackPriceListFromForm({
          values: { currency: "EUR" },
          flavorNames,
          volumeTypes,
        }),
      ),
    ).toBeNull();
  });
});
