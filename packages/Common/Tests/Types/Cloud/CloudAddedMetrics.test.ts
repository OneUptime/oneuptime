import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
  CLOUD_ADDED_METRIC_REFUSALS,
  CLOUD_MAX_ADDED_METRICS_PER_CONNECTION,
  CLOUD_MAX_ADDED_METRICS_PER_RESOURCE,
  CloudAddedMetric,
  CloudAddedMetricScope,
  addCloudAddedMetric,
  getCloudAddedMetricKey,
  getCloudAddedMetricSplitAttribute,
  getCloudAddedMetricStoredName,
  getCloudAddedMetricsOfResource,
  getCloudAddedMetricsOfType,
  isCloudAddedMetricSplit,
  keepCloudAddedMetricFor,
  readCloudAddedMetrics,
  removeCloudAddedMetric,
  toStoredCloudAddedMetrics,
  validateCloudAddedMetric,
} from "../../../Types/Cloud/CloudAddedMetrics";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * The metrics people add to what a cloud connection reads (#9563): their
 * key, the name each is stored under (as the cloud's receivers name it),
 * which apply to a resource, how they are read back from the connection,
 * what may be quoted into a cloud call, and the caps that bound the reads
 * they add.
 */

const ROW_A: string = "0a0a0a0a-0000-4000-8000-00000000000a";
const ROW_B: string = "0b0b0b0b-0000-4000-8000-00000000000b";
const APP_SERVICE: string = "Microsoft.Web/sites";
const SITE_A: string =
  "/subscriptions/d0cfe6b2-9ac0-4464-9919-dccaee2e48c0/resourceGroups/rg/providers/Microsoft.Web/sites/shop";

function azure(overrides: Partial<CloudAddedMetric> = {}): CloudAddedMetric {
  const metric: CloudAddedMetric = {
    key: "",
    provider: CloudProvider.Azure,
    scope: CloudAddedMetricScope.Type,
    resourceType: APP_SERVICE,
    name: "AverageMemoryWorkingSet",
    aggregation: "Average",
    grain: "PT1M",
    unit: "Bytes",
    addedAt: "2026-11-19T10:00:00.000Z",
    ...overrides,
  };

  return { ...metric, key: getCloudAddedMetricKey(metric) };
}

function own(overrides: Partial<CloudAddedMetric> = {}): CloudAddedMetric {
  return azure({
    scope: CloudAddedMetricScope.Resource,
    cloudResourceId: ROW_A,
    azureResourceId: SITE_A,
    ...overrides,
  });
}

function aws(overrides: Partial<CloudAddedMetric> = {}): CloudAddedMetric {
  return azure({
    provider: CloudProvider.AWS,
    resourceType: "AWS::RDS::DBInstance",
    namespace: "AWS/RDS",
    name: "SwapUsage",
    aggregation: "Average",
    grain: undefined,
    unit: "",
    ...overrides,
  });
}

function gcp(overrides: Partial<CloudAddedMetric> = {}): CloudAddedMetric {
  return azure({
    provider: CloudProvider.GCP,
    resourceType: "cloudsql_database",
    name: "cloudsql.googleapis.com/database/postgresql/num_backends",
    aggregation: "ALIGN_MEAN",
    grain: undefined,
    unit: "1",
    ...overrides,
  });
}

function refusal(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected a refusal.");
}

describe("what tells two additions apart", () => {
  test("the scope, the type, the resource of an own one, the namespace and the name, whatever their case", () => {
    expect(azure().key).toBe(
      "type|microsoft.web/sites|||averagememoryworkingset",
    );
    expect(own().key).toBe(
      `resource|microsoft.web/sites|${ROW_A}||averagememoryworkingset`,
    );
    expect(aws().key).toBe("type|aws::rds::dbinstance||aws/rds|swapusage");
    expect(azure({ name: "AVERAGEMEMORYWORKINGSET" }).key).toBe(azure().key);
    // A type's addition names no resource, whatever it was given.
    expect(
      getCloudAddedMetricKey({
        scope: CloudAddedMetricScope.Type,
        resourceType: APP_SERVICE,
        cloudResourceId: ROW_A,
        name: "AverageMemoryWorkingSet",
      }),
    ).toBe(azure().key);
  });
});

describe("the name an addition is stored under", () => {
  test("as each cloud's receiver names it, in lower case as ingest stores it", () => {
    expect(getCloudAddedMetricStoredName(azure())).toBe(
      "azure_averagememoryworkingset_average",
    );
    expect(
      getCloudAddedMetricStoredName(
        azure({ name: "Data Disk Read Bytes/sec", aggregation: "Total" }),
      ),
    ).toBe("azure_data_disk_read_bytes/sec_total");
    expect(getCloudAddedMetricStoredName(aws())).toBe(
      "amazonaws.com/aws/rds/swapusage",
    );
    expect(getCloudAddedMetricStoredName(gcp())).toBe(
      "cloudsql.googleapis.com/database/postgresql/num_backends",
    );
  });
});

describe("which additions apply to a resource", () => {
  const added: Array<CloudAddedMetric> = [
    azure(),
    own(),
    own({ cloudResourceId: ROW_B, name: "Http3xx" }),
    azure({ resourceType: "Microsoft.Web/serverfarms", name: "CpuPercentage" }),
  ];

  test("its type's, and its own, in the order they were added", () => {
    expect(
      getCloudAddedMetricsOfResource({
        added,
        resourceType: "microsoft.web/SITES",
        cloudResourceId: ROW_A.toUpperCase(),
      }).map((metric: CloudAddedMetric): string => {
        return metric.key;
      }),
    ).toEqual([added[0]!.key, added[1]!.key]);
  });

  test("without a resource, its type's alone", () => {
    expect(
      getCloudAddedMetricsOfResource({ added, resourceType: APP_SERVICE }),
    ).toEqual([added[0]]);
    expect(
      getCloudAddedMetricsOfType({ added, resourceType: APP_SERVICE }),
    ).toEqual([added[0]]);
  });
});

describe("reading a connection's additions", () => {
  test("as stored, or as a bare list", () => {
    const stored: { metrics: Array<CloudAddedMetric> } =
      toStoredCloudAddedMetrics([azure(), own()]);

    expect(readCloudAddedMetrics(stored)).toEqual([azure(), own()]);
    expect(readCloudAddedMetrics([azure()])).toEqual([azure()]);
    expect(readCloudAddedMetrics(JSON.parse(JSON.stringify(stored)))).toEqual([
      azure(),
      own(),
    ]);
  });

  test("nothing from nothing, and what is not an addition is dropped", () => {
    expect(readCloudAddedMetrics(undefined)).toEqual([]);
    expect(readCloudAddedMetrics(null)).toEqual([]);
    expect(readCloudAddedMetrics("metrics")).toEqual([]);
    expect(readCloudAddedMetrics({ metrics: "no" })).toEqual([]);
    expect(
      readCloudAddedMetrics([
        null,
        7,
        { ...azure(), provider: "oracle" },
        { ...azure(), scope: "everything" },
        { ...azure(), name: "" },
        { ...azure(), aggregation: 3 },
        // A resource's own addition that names no resource.
        { ...own(), cloudResourceId: "" },
        azure(),
      ]),
    ).toEqual([azure()]);
  });

  test("a second of the same key is dropped, and the key is worked out again", () => {
    expect(
      readCloudAddedMetrics([
        { ...azure(), key: "forged" },
        { ...azure(), name: "AVERAGEMEMORYWORKINGSET" },
      ]),
    ).toEqual([azure()]);
  });

  test("at most a connection's worth", () => {
    const many: Array<CloudAddedMetric> = Array.from(
      { length: CLOUD_MAX_ADDED_METRICS_PER_CONNECTION + 5 },
      (_: unknown, index: number): CloudAddedMetric => {
        return azure({ name: `Metric ${index}` });
      },
    );

    expect(readCloudAddedMetrics(many)).toHaveLength(
      CLOUD_MAX_ADDED_METRICS_PER_CONNECTION,
    );
  });

  test("an AWS resource's dimensions and a Google Cloud resource's labels are kept", () => {
    const read: Array<CloudAddedMetric> = readCloudAddedMetrics([
      aws({
        scope: CloudAddedMetricScope.Resource,
        cloudResourceId: ROW_A,
        accountId: "123456789012",
        region: "us-east-1",
        dimensions: [
          { name: "DBInstanceIdentifier", value: "orders" },
          { name: "", value: "dropped" },
        ],
      }),
      gcp({
        scope: CloudAddedMetricScope.Resource,
        cloudResourceId: ROW_B,
        accountId: "acme-prod",
        resourceLabels: { database_id: "acme-prod:orders", count: 3 as never },
      }),
    ]);

    expect(read[0]!.dimensions).toEqual([
      { name: "DBInstanceIdentifier", value: "orders" },
    ]);
    expect(read[1]!.resourceLabels).toEqual({
      database_id: "acme-prod:orders",
    });
  });
});

describe("what may be quoted into a cloud's call", () => {
  test("each cloud's own, as listed", () => {
    expect(() => {
      validateCloudAddedMetric(azure());
    }).not.toThrow();
    expect(() => {
      validateCloudAddedMetric(own());
    }).not.toThrow();
    expect(() => {
      validateCloudAddedMetric(aws());
    }).not.toThrow();
    expect(() => {
      validateCloudAddedMetric(gcp());
    }).not.toThrow();
  });

  test("an Azure name with a comma, an aggregation or grain Azure does not take, an own one with no ARM id", () => {
    for (const metric of [
      azure({ name: "a,b" }),
      azure({ aggregation: "Median" }),
      azure({ grain: "P1D" }),
      azure({ grain: undefined }),
      own({ azureResourceId: undefined }),
    ]) {
      expect(
        refusal(() => {
          validateCloudAddedMetric(metric);
        }),
      ).toBe(CLOUD_ADDED_METRIC_REFUSALS["invalid"]);
    }
  });

  test("an AWS metric with no namespace or another statistic, an own one without where it is", () => {
    for (const metric of [
      aws({ namespace: undefined }),
      aws({ aggregation: "p99" }),
      aws({ aggregation: "SampleCount" }),
      aws({ scope: CloudAddedMetricScope.Resource, cloudResourceId: ROW_A }),
      aws({
        scope: CloudAddedMetricScope.Resource,
        cloudResourceId: ROW_A,
        accountId: "123456789012",
        region: "us-east-1",
        dimensions: [],
      }),
    ]) {
      expect(() => {
        validateCloudAddedMetric(metric);
      }).toThrow(BadDataException);
    }
  });

  test("a Google Cloud type or label that would break out of the filter's quotes", () => {
    for (const metric of [
      gcp({ name: 'cloudsql.googleapis.com/x" OR metric.type="y' }),
      gcp({ resourceType: 'gce_instance" OR' }),
      gcp({ aggregation: "ALIGN_DELTA" }),
      gcp({
        scope: CloudAddedMetricScope.Resource,
        cloudResourceId: ROW_A,
        accountId: "acme-prod",
        resourceLabels: { database_id: 'a" OR resource.type="b' },
      }),
      gcp({
        scope: CloudAddedMetricScope.Resource,
        cloudResourceId: ROW_A,
        accountId: "acme-prod",
        resourceLabels: { "bad key": "x" },
      }),
      gcp({
        scope: CloudAddedMetricScope.Resource,
        cloudResourceId: ROW_A,
        accountId: "acme-prod",
        resourceLabels: {},
      }),
    ]) {
      expect(() => {
        validateCloudAddedMetric(metric);
      }).toThrow(BadDataException);
    }
  });

  test("a name too long for any cloud", () => {
    expect(() => {
      validateCloudAddedMetric(azure({ name: "x".repeat(300) }));
    }).toThrow(BadDataException);
  });
});

describe("adding one", () => {
  test("adds it with its key worked out", () => {
    const next: Array<CloudAddedMetric> = addCloudAddedMetric({
      added: [],
      metric: { ...azure(), key: "" },
      cloudResourceIds: [ROW_A, ROW_B],
    });

    expect(next).toEqual([azure()]);
  });

  test("the same metric again, or for a resource whose type reads it already, is read already", () => {
    expect(
      refusal(() => {
        addCloudAddedMetric({
          added: [azure()],
          metric: azure(),
          cloudResourceIds: [ROW_A],
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["alreadyRead"]);
    expect(
      refusal(() => {
        addCloudAddedMetric({
          added: [azure()],
          metric: own(),
          cloudResourceIds: [],
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["alreadyRead"]);
    expect(
      refusal(() => {
        addCloudAddedMetric({
          added: [own()],
          metric: own(),
          cloudResourceIds: [],
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["alreadyRead"]);
  });

  test("a type's addition takes the place of the resources' own of the same metric", () => {
    const next: Array<CloudAddedMetric> = addCloudAddedMetric({
      added: [own(), own({ cloudResourceId: ROW_B }), own({ name: "Http3xx" })],
      metric: azure(),
      cloudResourceIds: [ROW_A, ROW_B],
    });

    expect(
      next.map((metric: CloudAddedMetric): string => {
        return metric.key;
      }),
    ).toEqual([own({ name: "Http3xx" }).key, azure().key]);
  });

  test("a resource with the most additions takes no more, of its own or its type's", () => {
    const full: Array<CloudAddedMetric> = Array.from(
      { length: CLOUD_MAX_ADDED_METRICS_PER_RESOURCE },
      (_: unknown, index: number): CloudAddedMetric => {
        return index % 2 === 0
          ? own({ name: `Own ${index}` })
          : azure({ name: `Type ${index}` });
      },
    );

    expect(
      refusal(() => {
        addCloudAddedMetric({
          added: full,
          metric: own({ name: "One more" }),
          cloudResourceIds: [],
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["resourceFull"]);
    // Every resource of the type: ROW_A is full.
    expect(
      refusal(() => {
        addCloudAddedMetric({
          added: full,
          metric: azure({ name: "One more" }),
          cloudResourceIds: [ROW_B, ROW_A],
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["resourceFull"]);
    // Another resource has room for its own.
    expect(
      addCloudAddedMetric({
        added: full,
        metric: own({ cloudResourceId: ROW_B, name: "One more" }),
        cloudResourceIds: [],
      }),
    ).toHaveLength(CLOUD_MAX_ADDED_METRICS_PER_RESOURCE + 1);
  });

  test("a type with the most additions takes no more, even before any resource of it", () => {
    const full: Array<CloudAddedMetric> = Array.from(
      { length: CLOUD_MAX_ADDED_METRICS_PER_RESOURCE },
      (_: unknown, index: number): CloudAddedMetric => {
        return azure({ name: `Type ${index}` });
      },
    );

    expect(
      refusal(() => {
        addCloudAddedMetric({
          added: full,
          metric: azure({ name: "One more" }),
          cloudResourceIds: [],
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["resourceFull"]);
  });

  test("a connection with the most additions takes no more", () => {
    const full: Array<CloudAddedMetric> = Array.from(
      { length: CLOUD_MAX_ADDED_METRICS_PER_CONNECTION },
      (_: unknown, index: number): CloudAddedMetric => {
        return own({ cloudResourceId: `row-${index}`, name: `Own ${index}` });
      },
    );

    expect(
      refusal(() => {
        addCloudAddedMetric({
          added: full,
          metric: own({ cloudResourceId: "another-row" }),
          cloudResourceIds: [],
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["connectionFull"]);
  });

  test("what is not valid is refused before it is kept", () => {
    expect(
      refusal(() => {
        addCloudAddedMetric({
          added: [],
          metric: azure({ name: "a,b" }),
          cloudResourceIds: [],
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["invalid"]);
  });
});

describe("removing one", () => {
  test("by its key, leaving the others", () => {
    expect(
      removeCloudAddedMetric({ added: [azure(), own()], key: azure().key }),
    ).toEqual([own()]);
    expect(
      removeCloudAddedMetric({ added: [azure()], key: "not-there" }),
    ).toEqual([azure()]);
  });
});

/*
 * #10078: a metric added for every resource of its type, kept for the
 * resources its readers read it of alone - each read by an addition of its
 * own, read the same way - so the rest stop costing anything.
 */
describe("keeping a type's addition for some of its resources alone", () => {
  const ROW_C: string = "0c0c0c0c-0000-4000-8000-00000000000c";
  const SITE_B: string = SITE_A.replace("/shop", "/cart");

  test("each resource gets its own addition, read the same way, and the type's goes; the others stay", () => {
    const typeWide: CloudAddedMetric = azure({ addedByUserId: "user-1" });
    const other: CloudAddedMetric = azure({ name: "Http5xx" });
    const kept: Array<CloudAddedMetric> = keepCloudAddedMetricFor({
      added: [typeWide, other],
      key: typeWide.key,
      resources: [
        { cloudResourceId: ROW_A, azureResourceId: SITE_A },
        { cloudResourceId: ROW_B, azureResourceId: SITE_B },
      ],
    });

    expect(kept).toEqual([
      other,
      own({ addedByUserId: "user-1" }),
      own({
        cloudResourceId: ROW_B,
        azureResourceId: SITE_B,
        addedByUserId: "user-1",
      }),
    ]);
    // Each resource keeps as many additions as it had.
    expect(
      getCloudAddedMetricsOfResource({
        added: kept,
        resourceType: APP_SERVICE,
        cloudResourceId: ROW_A,
      }),
    ).toHaveLength(2);
    // One of its type it is not kept for has the other alone.
    expect(
      getCloudAddedMetricsOfResource({
        added: kept,
        resourceType: APP_SERVICE,
        cloudResourceId: ROW_C,
      }),
    ).toEqual([other]);
  });

  test("an AWS one by its account, Region and dimensions, with the unit the reads learned; a Google Cloud split by its labels, still split", () => {
    const awsWide: CloudAddedMetric = aws({ unit: "" });

    expect(
      keepCloudAddedMetricFor({
        added: [awsWide],
        key: awsWide.key,
        resources: [
          {
            cloudResourceId: ROW_A,
            accountId: "123456789012",
            region: "us-east-1",
            dimensions: [{ name: "DBInstanceIdentifier", value: "orders" }],
          },
        ],
        unit: "Bytes",
      }),
    ).toEqual([
      aws({
        scope: CloudAddedMetricScope.Resource,
        cloudResourceId: ROW_A,
        accountId: "123456789012",
        region: "us-east-1",
        dimensions: [{ name: "DBInstanceIdentifier", value: "orders" }],
        unit: "Bytes",
      }),
    ]);

    const gcpWide: CloudAddedMetric = gcp({
      splitBy: "database",
      resourceLabelKeys: ["database_id", "project_id", "region"],
    });
    const labels: Record<string, string> = {
      project_id: "acme-prod",
      database_id: "acme-prod:orders",
      region: "us-central1",
    };
    const [kept] = keepCloudAddedMetricFor({
      added: [gcpWide],
      key: gcpWide.key,
      resources: [
        {
          cloudResourceId: ROW_A,
          accountId: "acme-prod",
          resourceLabels: labels,
        },
      ],
    });

    expect(kept).toEqual(
      gcp({
        scope: CloudAddedMetricScope.Resource,
        cloudResourceId: ROW_A,
        accountId: "acme-prod",
        resourceLabels: labels,
        splitBy: "database",
        resourceLabelKeys: ["database_id", "project_id", "region"],
      }),
    );
  });

  test("a resource named twice is kept once", () => {
    const typeWide: CloudAddedMetric = azure();

    expect(
      keepCloudAddedMetricFor({
        added: [typeWide],
        key: typeWide.key,
        resources: [
          { cloudResourceId: ROW_A, azureResourceId: SITE_A },
          { cloudResourceId: ROW_A, azureResourceId: SITE_A },
        ],
      }),
    ).toEqual([own()]);
  });

  test("refused, with why: no type's addition, no resource, one its cloud does not know yet, past the connection's cap", () => {
    expect(
      refusal(() => {
        return keepCloudAddedMetricFor({
          added: [own()],
          key: own().key,
          resources: [{ cloudResourceId: ROW_A, azureResourceId: SITE_A }],
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["keepForNotTypeWide"]);
    expect(
      refusal(() => {
        return keepCloudAddedMetricFor({
          added: [azure()],
          key: azure().key,
          resources: [],
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["keepForNone"]);
    // An Azure resource with no ARM id: not one its own addition can read.
    expect(
      refusal(() => {
        return keepCloudAddedMetricFor({
          added: [azure()],
          key: azure().key,
          resources: [{ cloudResourceId: ROW_A }],
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["keepForUnknownResource"]);

    const full: Array<CloudAddedMetric> = [azure()];

    for (
      let index: number = 1;
      index < CLOUD_MAX_ADDED_METRICS_PER_CONNECTION;
      index++
    ) {
      full.push(azure({ name: `Metric${index}` }));
    }

    // 50 now: kept for one, still 50; for two, 51.
    expect(
      keepCloudAddedMetricFor({
        added: full,
        key: azure().key,
        resources: [{ cloudResourceId: ROW_A, azureResourceId: SITE_A }],
      }),
    ).toHaveLength(CLOUD_MAX_ADDED_METRICS_PER_CONNECTION);
    expect(
      refusal(() => {
        return keepCloudAddedMetricFor({
          added: full,
          key: azure().key,
          resources: [
            { cloudResourceId: ROW_A, azureResourceId: SITE_A },
            { cloudResourceId: ROW_B, azureResourceId: SITE_B },
          ],
        });
      }),
    ).toBe(CLOUD_ADDED_METRIC_REFUSALS["keepForConnectionFull"]);
    expect(CLOUD_ADDED_METRIC_REFUSALS["keepForConnectionFull"]).toContain(
      `more than ${CLOUD_MAX_ADDED_METRICS_PER_CONNECTION} added metrics`,
    );
  });
});

/*
 * #9808: an addition split by one of its dimensions - an Azure dimension,
 * a CloudWatch dimension, a Cloud Monitoring label - kept only where a
 * split read can name it, and the attribute its series carry the value in.
 */
describe("an addition split by a dimension", () => {
  test("is kept with its split, read back from the connection as stored", () => {
    const [read] = readCloudAddedMetrics(
      toStoredCloudAddedMetrics([azure({ splitBy: "ApiName" })]),
    );

    expect(read!.splitBy).toBe("ApiName");
    // The split is no part of its key: a metric is read once, split or whole.
    expect(read!.key).toBe(azure().key);
  });

  test("a split no read could name is dropped as it is read back, and refused as it is added", () => {
    const [read] = readCloudAddedMetrics({
      metrics: [{ ...azure(), splitBy: "Api Name' or 1 eq 1" }],
    });

    expect(read!.splitBy).toBeUndefined();
    expect(() => {
      validateCloudAddedMetric(azure({ splitBy: "Api Name" }));
    }).toThrow(CLOUD_ADDED_METRIC_REFUSALS["invalidSplit"]!);
    expect(() => {
      validateCloudAddedMetric(azure({ splitBy: "ApiName" }));
    }).not.toThrow();
    expect(isCloudAddedMetricSplit(CloudProvider.AWS, "AvailabilityZone")).toBe(
      true,
    );
    expect(isCloudAddedMetricSplit(CloudProvider.AWS, " Padded ")).toBe(false);
    expect(isCloudAddedMetricSplit(CloudProvider.AWS, "Tab\there")).toBe(false);
    expect(isCloudAddedMetricSplit(CloudProvider.GCP, "response_code")).toBe(
      true,
    );
    expect(isCloudAddedMetricSplit(CloudProvider.GCP, "response-code")).toBe(
      false,
    );
  });

  test("Google Cloud splits a rate or a level, by the resource's labels it keeps", () => {
    const gcp: (overrides: Partial<CloudAddedMetric>) => CloudAddedMetric = (
      overrides: Partial<CloudAddedMetric>,
    ): CloudAddedMetric => {
      return azure({
        provider: CloudProvider.GCP,
        resourceType: "gce_instance",
        name: "compute.googleapis.com/instance/disk/max_read_ops_count",
        aggregation: "ALIGN_RATE",
        grain: undefined,
        splitBy: "device_name",
        resourceLabelKeys: ["instance_id", "project_id", "zone"],
        ...overrides,
      });
    };

    expect(() => {
      validateCloudAddedMetric(gcp({}));
    }).not.toThrow();
    expect(() => {
      validateCloudAddedMetric(gcp({ aggregation: "ALIGN_PERCENTILE_95" }));
    }).toThrow(CLOUD_ADDED_METRIC_REFUSALS["invalidSplit"]!);
    expect(() => {
      validateCloudAddedMetric(gcp({ resourceLabelKeys: undefined }));
    }).toThrow(CLOUD_ADDED_METRIC_REFUSALS["invalidSplit"]!);
    expect(
      readCloudAddedMetrics(
        toStoredCloudAddedMetrics([
          gcp({ resourceLabelKeys: ["zone", "bad-key", "instance_id"] }),
        ]),
      )[0]!.resourceLabelKeys,
    ).toEqual(["zone", "instance_id"]);
  });

  test("its series carry the value as each cloud's receivers write the dimension", () => {
    expect(
      getCloudAddedMetricSplitAttribute(azure({ splitBy: "ApiName" })),
    ).toBe("metadata_apiname");
    expect(
      getCloudAddedMetricSplitAttribute(aws({ splitBy: "AvailabilityZone" })),
    ).toBe("Dimensions.AvailabilityZone");
    expect(
      getCloudAddedMetricSplitAttribute({
        provider: CloudProvider.GCP,
        splitBy: "response_code_class",
      }),
    ).toBe("response_code_class");
    expect(getCloudAddedMetricSplitAttribute(azure())).toBe("");
    expect(CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES).toBe(10);
  });
});
