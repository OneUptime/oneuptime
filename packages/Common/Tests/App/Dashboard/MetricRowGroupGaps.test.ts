import { describe, expect, test } from "@jest/globals";
import {
  GetMetricRowGroup,
  GetMetricRowGroupGaps,
  MetricRowGroup,
  MetricRowGroupGap,
  getMetricPageNamesWithGapSections,
  getMetricRowGroupGapName,
  getMetricRowGroupHeading,
  isMetricRowGroupGapName,
  orderMetricNamesByGroup,
  withMetricRowGroupGaps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricRowScope";
import {
  CLOUD_ADDED_METRICS_GROUP_KEY,
  CLOUD_ADDED_METRICS_GROUP_TITLE,
  getCloudMonitoredResourceRowGroup,
  getCloudMonitoredResourceRowGroupGaps,
  getCloudResourceAddedMetrics,
  getCloudResourceAddedSplitAttributes,
  getCloudResourceAddedStoredNames,
  getCloudResourceReadIntervalInMinutes,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudMonitoredResourceScope";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import {
  CloudAddedMetric,
  CloudAddedMetricScope,
  getCloudAddedMetricKey,
  toStoredCloudAddedMetrics,
} from "../../../Types/Cloud/CloudAddedMetrics";
import {
  CLOUD_KEY_METRIC_GROUP_LABELS,
  CLOUD_KEY_METRIC_GROUP_ORDER,
  CloudKeyMetricGroup,
} from "../../../Types/Cloud/CloudKeyMetricGroup";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudResourceKeyMetric,
  getCloudUnreportedKeyMetrics,
} from "../../../Types/Cloud/CloudUnreportedKeyMetrics";

/*
 * A section's gaps (MetricRowScope, 5.; #9569): where a section none of
 * whose metrics reported is drawn among the list's pages, how its stand-in
 * is filed, and a cloud resource's gaps and added metrics as its pages
 * build them.
 */

function group(key: string, order: number): MetricRowGroup {
  return { key, title: key, order, rank: 0 };
}

// Names "a1", "a2"... in section "a" (order 1), "c1"... in "c" (order 3), others in none.
const SECTIONS: Record<string, MetricRowGroup> = {
  a: group("a", 1),
  b: group("b", 2),
  c: group("c", 3),
  d: group("d", 4),
};

const NAME_IN_A_SECTION: RegExp = /^[a-d]\d+$/;

const BY_LETTER: GetMetricRowGroup = (
  name: string,
): MetricRowGroup | undefined => {
  return NAME_IN_A_SECTION.test(name) ? SECTIONS[name[0]!] : undefined;
};

function gap(key: string, keys: Array<string> = ["x"]): MetricRowGroupGap {
  return { group: SECTIONS[key]!, keys };
}

describe("a section none of whose metrics reported", () => {
  test("is drawn before the first name of a later section", () => {
    expect(
      getMetricPageNamesWithGapSections({
        orderedNames: ["a1", "a2", "c1", "z.other"],
        pageStart: 0,
        pageEnd: 50,
        gaps: [gap("b")],
        getRowGroup: BY_LETTER,
      }),
    ).toEqual(["a1", "a2", getMetricRowGroupGapName("b"), "c1", "z.other"]);
  });

  test("before every name when it comes first, after them all when it comes last", () => {
    expect(
      getMetricPageNamesWithGapSections({
        orderedNames: ["c1"],
        pageStart: 0,
        pageEnd: 50,
        gaps: [gap("a")],
        getRowGroup: BY_LETTER,
      }),
    ).toEqual([getMetricRowGroupGapName("a"), "c1"]);
    expect(
      getMetricPageNamesWithGapSections({
        orderedNames: ["a1", "b1"],
        pageStart: 0,
        pageEnd: 50,
        gaps: [gap("d")],
        getRowGroup: BY_LETTER,
      }),
    ).toEqual(["a1", "b1", getMetricRowGroupGapName("d")]);
  });

  test("before the metrics in no section: a key metric's section comes before Other", () => {
    expect(
      getMetricPageNamesWithGapSections({
        orderedNames: ["a1", "z.app", "z.other"],
        pageStart: 0,
        pageEnd: 50,
        gaps: [gap("c")],
        getRowGroup: BY_LETTER,
      }),
    ).toEqual(["a1", getMetricRowGroupGapName("c"), "z.app", "z.other"]);
  });

  test("several in one place come in their sections' order", () => {
    expect(
      getMetricPageNamesWithGapSections({
        orderedNames: ["a1", "d1"],
        pageStart: 0,
        pageEnd: 50,
        gaps: [gap("c"), gap("b")],
        getRowGroup: BY_LETTER,
      }),
    ).toEqual([
      "a1",
      getMetricRowGroupGapName("b"),
      getMetricRowGroupGapName("c"),
      "d1",
    ]);
  });

  test("is drawn on the page that holds its place, and once", () => {
    const orderedNames: Array<string> = ["a1", "a2", "a3", "c1", "c2"];
    const page: (start: number, end: number) => Array<string> = (
      start: number,
      end: number,
    ): Array<string> => {
      return getMetricPageNamesWithGapSections({
        orderedNames,
        pageStart: start,
        pageEnd: end,
        gaps: [gap("b"), gap("d")],
        getRowGroup: BY_LETTER,
      });
    };

    // Pages of two: b's place is index 3 (page 2), d's after the last name (page 3).
    expect(page(0, 2)).toEqual(["a1", "a2"]);
    expect(page(2, 4)).toEqual(["a3", getMetricRowGroupGapName("b"), "c1"]);
    expect(page(4, 6)).toEqual(["c2", getMetricRowGroupGapName("d")]);
  });

  test("a section a reported metric is in is never drawn twice: its heading carries its count", () => {
    expect(
      getMetricPageNamesWithGapSections({
        orderedNames: ["a1", "c1"],
        pageStart: 0,
        pageEnd: 50,
        gaps: [gap("a"), gap("c")],
        getRowGroup: BY_LETTER,
      }),
    ).toEqual(["a1", "c1"]);
  });

  test("none on a list with no names, and none for a gap with nothing missing", () => {
    expect(
      getMetricPageNamesWithGapSections({
        orderedNames: [],
        pageStart: 0,
        pageEnd: 50,
        gaps: [gap("a")],
        getRowGroup: BY_LETTER,
      }),
    ).toEqual([]);
    expect(
      getMetricPageNamesWithGapSections({
        orderedNames: ["c1"],
        pageStart: 0,
        pageEnd: 50,
        gaps: [gap("a", [])],
        getRowGroup: BY_LETTER,
      }),
    ).toEqual(["c1"]);
  });

  test("its stand-in is in its section, and draws the section's heading", () => {
    const getRowGroup: GetMetricRowGroup = withMetricRowGroupGaps(BY_LETTER, [
      gap("b"),
    ]);
    const names: Array<string> = ["a1", getMetricRowGroupGapName("b"), "c1"];

    expect(isMetricRowGroupGapName(getMetricRowGroupGapName("b"))).toBe(true);
    expect(isMetricRowGroupGapName("b1")).toBe(false);
    expect(getRowGroup(getMetricRowGroupGapName("b"))).toEqual(SECTIONS["b"]);
    expect(getRowGroup("c1")).toEqual(SECTIONS["c"]);
    expect(
      names.map((_name: string, index: number): string | null => {
        return getMetricRowGroupHeading({ names, index, getRowGroup });
      }),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("a cloud resource's gaps", () => {
  const VM: string = "Microsoft.Compute/virtualMachines";
  const getGaps: GetMetricRowGroupGaps = getCloudMonitoredResourceRowGroupGaps({
    cloudProvider: CloudProvider.Azure,
    cloudResourceType: VM,
  })!;

  test("each section's key metrics none of the reported names is, in the section's order", () => {
    const reported: Array<string> = [
      "azure_percentage_cpu_average",
      "azure_available_memory_bytes_average",
    ];
    const gaps: Array<MetricRowGroupGap> = getGaps(reported);
    const unreported: Array<CloudResourceKeyMetric> =
      getCloudUnreportedKeyMetrics({
        provider: "azure",
        type: VM,
        reportedMetricNames: reported,
      });

    expect(
      gaps.flatMap((item: MetricRowGroupGap): Array<string> => {
        return item.keys;
      }),
    ).toEqual(
      unreported.map((metric: CloudResourceKeyMetric): string => {
        return metric.key;
      }),
    );

    const compute: MetricRowGroupGap | undefined = gaps.find(
      (item: MetricRowGroupGap): boolean => {
        return item.group.key === CloudKeyMetricGroup.Compute;
      },
    );

    expect(compute?.group).toEqual({
      key: CloudKeyMetricGroup.Compute,
      title: CLOUD_KEY_METRIC_GROUP_LABELS[CloudKeyMetricGroup.Compute],
      order: CLOUD_KEY_METRIC_GROUP_ORDER.indexOf(CloudKeyMetricGroup.Compute),
      rank: 0,
    });
    expect(compute?.keys).toContain("cpu credits remaining");
    expect(compute?.keys).not.toContain("percentage cpu");
  });

  test("an AWS resource's are its own namespace's, as its attributes name it", () => {
    const getAlbGaps: GetMetricRowGroupGaps =
      getCloudMonitoredResourceRowGroupGaps({
        cloudProvider: CloudProvider.AWS,
        cloudResourceType: "AWS::ElasticLoadBalancingV2::LoadBalancer",
        telemetryAttributes: {
          Namespace: "AWS/NetworkELB",
          "Dimensions.LoadBalancer": "net/edge/1",
        },
      })!;
    const keys: Array<string> = getAlbGaps([]).flatMap(
      (item: MetricRowGroupGap): Array<string> => {
        return item.keys;
      },
    );

    expect(keys.length).toBeGreaterThan(0);
    expect(
      keys.every((key: string): boolean => {
        return key.startsWith("aws/networkelb|");
      }),
    ).toBe(true);
  });

  test("none for a type with no key metrics, or no provider", () => {
    expect(
      getCloudMonitoredResourceRowGroupGaps({
        cloudProvider: CloudProvider.Azure,
        cloudResourceType: "Microsoft.Network/virtualNetworks",
      }),
    ).toBeUndefined();
    expect(getCloudMonitoredResourceRowGroupGaps(null)).toBeUndefined();
  });

  /*
   * #10026: a Storage account's used capacity comes once an hour, 2 to 3
   * hours after its hour, so the last hour holds none of it: it is counted
   * as not reported only in a range that can hold its newest point, as its
   * connection reads it.
   */
  test("an hourly metric is counted only in a range that can hold its newest point, by its connection's interval", () => {
    const HOUR_MS: number = 60 * 60 * 1000;
    const storageGaps: (config: unknown) => GetMetricRowGroupGaps = (
      config: unknown,
    ): GetMetricRowGroupGaps => {
      return getCloudMonitoredResourceRowGroupGaps({
        cloudProvider: CloudProvider.Azure,
        cloudResourceType: "Microsoft.Storage/storageAccounts",
        cloudConnection: { provider: CloudProvider.Azure, config },
      })!;
    };
    const keysIn: (
      gaps: GetMetricRowGroupGaps,
      hours: number,
    ) => Array<string> = (
      gaps: GetMetricRowGroupGaps,
      hours: number,
    ): Array<string> => {
      const end: Date = new Date();

      return gaps(
        [],
        new InBetween<Date>(new Date(end.getTime() - hours * HOUR_MS), end),
      ).flatMap((item: MetricRowGroupGap): Array<string> => {
        return item.keys;
      });
    };

    // Read every 5 minutes (its cloud's default): 3 hours and 5 minutes.
    const everyFive: GetMetricRowGroupGaps = storageGaps({});

    expect(keysIn(everyFive, 1)).not.toContain("usedcapacity");
    expect(keysIn(everyFive, 1)).toContain("transactions");
    expect(keysIn(everyFive, 3.25)).toContain("usedcapacity");

    // Read every hour: up to 4 hours old.
    const hourly: GetMetricRowGroupGaps = storageGaps({
      readIntervalInMinutes: "60",
    });

    expect(keysIn(hourly, 3.25)).not.toContain("usedcapacity");
    expect(keysIn(hourly, 4.25)).toContain("usedcapacity");

    // A row that names no connection: as if read every hour.
    const unknown: GetMetricRowGroupGaps =
      getCloudMonitoredResourceRowGroupGaps({
        cloudProvider: CloudProvider.Azure,
        cloudResourceType: "Microsoft.Storage/storageAccounts",
      })!;

    expect(keysIn(unknown, 3.25)).not.toContain("usedcapacity");
    expect(keysIn(unknown, 6)).toContain("usedcapacity");

    // Without a range, as before: every key metric not reported.
    expect(
      everyFive([]).flatMap((item: MetricRowGroupGap): Array<string> => {
        return item.keys;
      }),
    ).toContain("usedcapacity");
  });

  test("how often a resource's connection reads it, from its connection's settings", () => {
    expect(
      getCloudResourceReadIntervalInMinutes({
        cloudProvider: CloudProvider.Azure,
        cloudConnection: {
          provider: CloudProvider.Azure,
          config: { readIntervalInMinutes: "30" },
        },
      }),
    ).toBe(30);
    // Its cloud's default when it says none, or an interval it does not offer.
    expect(
      getCloudResourceReadIntervalInMinutes({
        cloudConnection: { provider: CloudProvider.AWS, config: {} },
      }),
    ).toBe(10);
    expect(
      getCloudResourceReadIntervalInMinutes({
        cloudConnection: {
          provider: CloudProvider.GCP,
          config: { readIntervalInMinutes: 7 },
        },
      }),
    ).toBe(5);
    // No connection, or a cloud OneUptime does not connect: not known.
    expect(
      getCloudResourceReadIntervalInMinutes({
        cloudProvider: CloudProvider.Azure,
      }),
    ).toBeUndefined();
    expect(
      getCloudResourceReadIntervalInMinutes({
        cloudConnection: { provider: "oracle", config: {} },
      }),
    ).toBeUndefined();
    expect(getCloudResourceReadIntervalInMinutes(null)).toBeUndefined();
  });
});

describe("a cloud resource's added metrics", () => {
  const ROW: string = "5f8b9c1e-2222-4222-8222-222222222222";

  function added(overrides: Partial<CloudAddedMetric> = {}): CloudAddedMetric {
    const metric: CloudAddedMetric = {
      key: "",
      provider: CloudProvider.Azure,
      scope: CloudAddedMetricScope.Type,
      resourceType: "Microsoft.Web/sites",
      name: "AverageMemoryWorkingSet",
      aggregation: "Average",
      grain: "PT1M",
      unit: "Bytes",
      addedAt: "2026-11-19T10:00:00.000Z",
      ...overrides,
    };

    return { ...metric, key: getCloudAddedMetricKey(metric) };
  }

  const SOURCE: {
    _id: string;
    cloudProvider: string;
    cloudResourceType: string;
    cloudConnection: { addedMetrics: unknown };
  } = {
    _id: ROW,
    cloudProvider: CloudProvider.Azure,
    cloudResourceType: "Microsoft.Web/sites",
    cloudConnection: {
      addedMetrics: toStoredCloudAddedMetrics([
        added(),
        added({
          scope: CloudAddedMetricScope.Resource,
          cloudResourceId: ROW,
          azureResourceId: "/subscriptions/x/rg/site",
          name: "Http3xx",
          aggregation: "Total",
        }),
        // Another resource's own, and another type's.
        added({
          scope: CloudAddedMetricScope.Resource,
          cloudResourceId: "another-row",
          azureResourceId: "/subscriptions/x/rg/other",
          name: "Http401",
        }),
        added({ resourceType: "Microsoft.Web/serverfarms", name: "x" }),
      ]),
    },
  };

  test("its type's and its own, by the names they are stored under", () => {
    expect(
      getCloudResourceAddedMetrics(SOURCE).map(
        (metric: CloudAddedMetric): string => {
          return metric.name;
        },
      ),
    ).toEqual(["AverageMemoryWorkingSet", "Http3xx"]);
    expect(getCloudResourceAddedStoredNames(SOURCE)).toEqual([
      "azure_averagememoryworkingset_average",
      "azure_http3xx_total",
    ]);
    expect(getCloudResourceAddedStoredNames(null)).toEqual([]);
    expect(
      getCloudResourceAddedStoredNames({
        ...SOURCE,
        cloudConnection: null,
      }),
    ).toEqual([]);
  });

  /*
   * #9808: an addition split by a dimension opens its chart split by the
   * attribute its series carry the value in, a line per value.
   */
  test("the additions split by a dimension, each by the name it is stored under and the attribute of its value", () => {
    const split: typeof SOURCE = {
      ...SOURCE,
      cloudConnection: {
        addedMetrics: toStoredCloudAddedMetrics([
          added({ splitBy: "Instance" }),
          added({
            scope: CloudAddedMetricScope.Resource,
            cloudResourceId: ROW,
            azureResourceId: "/subscriptions/x/rg/site",
            name: "Http3xx",
            aggregation: "Total",
          }),
          // Another resource's own split: never this one's.
          added({
            scope: CloudAddedMetricScope.Resource,
            cloudResourceId: "another-row",
            azureResourceId: "/subscriptions/x/rg/other",
            name: "Http401",
            splitBy: "Instance",
          }),
        ]),
      },
    };

    expect(
      Array.from(getCloudResourceAddedSplitAttributes(split).entries()),
    ).toEqual([["azure_averagememoryworkingset_average", "metadata_instance"]]);
    expect(getCloudResourceAddedSplitAttributes(SOURCE).size).toBe(0);
    expect(getCloudResourceAddedSplitAttributes(null).size).toBe(0);
  });

  test("read under Added metrics, after every key metric's section and before Other, in the order they were added", () => {
    const getRowGroup: GetMetricRowGroup = getCloudMonitoredResourceRowGroup(
      SOURCE,
      getCloudResourceAddedStoredNames(SOURCE),
    )!;

    expect(getRowGroup("AZURE_HTTP3XX_TOTAL")).toEqual({
      key: CLOUD_ADDED_METRICS_GROUP_KEY,
      title: CLOUD_ADDED_METRICS_GROUP_TITLE,
      order: CLOUD_KEY_METRIC_GROUP_ORDER.length,
      rank: 1,
    });
    expect(getRowGroup("azure_requests_total")?.key).toBe(
      CloudKeyMetricGroup.Traffic,
    );
    expect(getRowGroup("app.metric")).toBeUndefined();
    expect(
      orderMetricNamesByGroup(
        [
          "app.metric",
          "azure_http3xx_total",
          "azure_averagememoryworkingset_average",
          "azure_requests_total",
        ],
        getRowGroup,
      ),
    ).toEqual([
      "azure_requests_total",
      "azure_averagememoryworkingset_average",
      "azure_http3xx_total",
      "app.metric",
    ]);
  });
});
