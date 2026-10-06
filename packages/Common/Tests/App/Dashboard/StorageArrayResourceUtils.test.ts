import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import StorageArrayResource from "../../../Models/DatabaseModels/StorageArrayResource";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import {
  getStorageArrayMetricById,
  getStorageArrayMetricsForSystem,
  StorageArrayMetricDefinition,
} from "../../../Types/Monitor/StorageArrayMetricCatalog";
import { StorageArrayResourceScope } from "../../../Types/Monitor/MonitorStepStorageArrayMonitor";
import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import { StatusBadgeType } from "../../../UI/Components/StatusBadge/StatusBadge";
import {
  isCriticalComponentStatus,
  isUnhealthyComponentStatus,
} from "../../../Server/Utils/Telemetry/StorageArraySnapshotScan";
import StorageArrayResourceUtils, {
  CRITICAL_RESOURCE_STATUSES,
  METRIC_STALE_MS,
  SLOW_SCRAPE_METRIC_STALE_MS,
  STORAGE_ARRAY_ATTRIBUTE,
  UNHEALTHY_RESOURCE_STATUSES,
  getFileSystemProtocols,
  getFileSystemProvisionedBytes,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayResourceUtils";
import {
  getAlertMetricNames,
  getGoldenChartQueries,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Index";
import {
  FLASHARRAY_INSIGHTS_SECTIONS,
  FLASHBLADE_INSIGHTS_SECTIONS,
  InsightsSection,
  getInsightsQueries,
  getInsightsSections,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Insights";
import {
  INVENTORY_MENU_ITEMS,
  InventoryMenuItem,
  getInventoryMenuItems,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/SideMenu";
import {
  getRecommendedRollingTime,
  getResourceFilterFields,
  ResourceFilterField,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/StorageArrayMonitor/StorageArrayMonitorStepForm";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";

/*
 * The helpers behind every Storage Array page: what a status looks like,
 * how a value is written, when a value is too old to show, how a detail
 * page's address carries an object's name, and which catalog entries the
 * charts are built from. Most of these fail quietly — a stale value shown
 * as current, a failed drive drawn grey, a chart dropped because its
 * catalog id was renamed — so each is pinned here.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const makeRow: (data: {
  kind?: StorageArrayResourceKind;
  minutesAgo?: number | null;
  details?: Record<string, unknown>;
  capacityBytes?: number;
}) => StorageArrayResource = (data: {
  kind?: StorageArrayResourceKind;
  minutesAgo?: number | null;
  details?: Record<string, unknown>;
  capacityBytes?: number;
}): StorageArrayResource => {
  const row: StorageArrayResource = new StorageArrayResource();
  row.kind = data.kind || StorageArrayResourceKind.Volume;
  row.externalId = "vol-1";
  if (data.minutesAgo !== null) {
    row.metricsUpdatedAt = new Date(
      Date.now() - (data.minutesAgo ?? 1) * 60 * 1000,
    );
  }
  if (data.details) {
    row.details = data.details as never;
  }
  if (data.capacityBytes !== undefined) {
    row.capacityBytes = data.capacityBytes;
  }
  return row;
};

/*
 * Every status the arrays (and ingest's FlashBlade mapping) can put in
 * StorageArrayResource.status for the hardware kinds.
 */
const HARDWARE_STATUSES: Array<string> = [
  "ok",
  "healthy",
  "critical",
  "degraded",
  "unknown",
  "failed",
  "missing",
  "unhealthy",
  "unrecognized",
  "not ready",
  "not_installed",
  "device_off",
  "identifying",
  "empty",
  "unused",
  "ready",
  "recovering",
  "updating",
];

describe("the status a pill shows agrees with ingest's health verdict", () => {
  test.each(HARDWARE_STATUSES)(
    "%s is unhealthy on the pages exactly when ingest counts it unhealthy",
    (status: string) => {
      expect(StorageArrayResourceUtils.isUnhealthyResourceStatus(status)).toBe(
        isUnhealthyComponentStatus(status),
      );
      expect(StorageArrayResourceUtils.isCriticalResourceStatus(status)).toBe(
        isCriticalComponentStatus(status),
      );
    },
  );

  test("statuses compare without regard to case or surrounding spaces", () => {
    expect(StorageArrayResourceUtils.isCriticalResourceStatus(" FAILED ")).toBe(
      true,
    );
    expect(
      StorageArrayResourceUtils.isUnhealthyResourceStatus("Degraded"),
    ).toBe(true);
    expect(StorageArrayResourceUtils.isUnhealthyResourceStatus(undefined)).toBe(
      false,
    );
  });

  test("critical statuses are a subset of the unhealthy ones", () => {
    for (const status of CRITICAL_RESOURCE_STATUSES) {
      expect(UNHEALTHY_RESOURCE_STATUSES).toContain(status);
    }
  });

  test("a failed part is red, a degraded one amber, a healthy one green and an expected state grey", () => {
    for (const status of ["critical", "failed", "missing", "unhealthy"]) {
      expect(StorageArrayResourceUtils.getResourceStatusBadgeType(status)).toBe(
        StatusBadgeType.Danger,
      );
    }
    for (const status of ["degraded", "unknown", "unrecognized", "not ready"]) {
      expect(StorageArrayResourceUtils.getResourceStatusBadgeType(status)).toBe(
        StatusBadgeType.Warning,
      );
    }
    for (const status of [
      "ok",
      "healthy",
      "ready",
      "enabled",
      "online",
      "replicating",
    ]) {
      expect(StorageArrayResourceUtils.getResourceStatusBadgeType(status)).toBe(
        StatusBadgeType.Success,
      );
    }
    for (const status of [
      "not_installed",
      "device_off",
      "identifying",
      "empty",
      "unused",
      "disabled",
      "paused",
      "",
    ]) {
      expect(StorageArrayResourceUtils.getResourceStatusBadgeType(status)).toBe(
        StatusBadgeType.Neutral,
      );
    }
  });

  test("statuses read as words", () => {
    expect(StorageArrayResourceUtils.formatStatusLabel("ok")).toBe("OK");
    expect(StorageArrayResourceUtils.formatStatusLabel("not_installed")).toBe(
      "Not Installed",
    );
    expect(StorageArrayResourceUtils.formatStatusLabel("device_off")).toBe(
      "Device Off",
    );
    expect(StorageArrayResourceUtils.formatStatusLabel("not ready")).toBe(
      "Not Ready",
    );
    expect(StorageArrayResourceUtils.formatStatusLabel("CRITICAL")).toBe(
      "Critical",
    );
    expect(StorageArrayResourceUtils.formatStatusLabel(undefined)).toBe("");
  });
});

describe("values are written the way storage admins read them", () => {
  test("bytes in binary units", () => {
    expect(StorageArrayResourceUtils.formatBytes(512)).toBe("512 B");
    expect(StorageArrayResourceUtils.formatBytes(1536)).toBe("1.5 KiB");
    expect(StorageArrayResourceUtils.formatBytes(5 * 1024 ** 4)).toBe(
      "5.0 TiB",
    );
    expect(StorageArrayResourceUtils.formatBytes(200 * 1024 ** 3)).toBe(
      "200 GiB",
    );
    expect(StorageArrayResourceUtils.formatBytes(null)).toBe("—");
    expect(StorageArrayResourceUtils.formatBytes(Number.NaN)).toBe("—");
  });

  test("bandwidth per second", () => {
    expect(StorageArrayResourceUtils.formatBytesPerSec(10 * 1024 ** 2)).toBe(
      "10.0 MiB/s",
    );
    expect(StorageArrayResourceUtils.formatBytesPerSec(undefined)).toBe("—");
  });

  test("latency in microseconds below a millisecond, milliseconds above", () => {
    expect(StorageArrayResourceUtils.formatLatencyUsec(245.4)).toBe("245 µs");
    expect(StorageArrayResourceUtils.formatLatencyUsec(1250)).toBe("1.25 ms");
    expect(StorageArrayResourceUtils.formatLatencyUsec(250000)).toBe("250 ms");
    expect(StorageArrayResourceUtils.formatLatencyUsec(null)).toBe("—");
  });

  test("IOPS compact, keeping a decimal on very quiet objects", () => {
    expect(StorageArrayResourceUtils.formatIops(0.5)).toBe("0.5/s");
    expect(StorageArrayResourceUtils.formatIops(950)).toBe("950/s");
    expect(StorageArrayResourceUtils.formatIops(12500)).toBe("12.5K/s");
    expect(StorageArrayResourceUtils.formatIops(0)).toBe("0/s");
  });

  test("replication lag from milliseconds up to hours", () => {
    expect(StorageArrayResourceUtils.formatDurationMs(450)).toBe("450 ms");
    expect(StorageArrayResourceUtils.formatDurationMs(12000)).toBe("12.0 s");
    expect(StorageArrayResourceUtils.formatDurationMs(90 * 1000)).toBe(
      "1.5 min",
    );
    expect(StorageArrayResourceUtils.formatDurationMs(2 * 3600 * 1000)).toBe(
      "2.0 h",
    );
  });

  test("data reduction as Pure writes it", () => {
    expect(StorageArrayResourceUtils.formatRatio(4.24)).toBe("4.2:1");
    expect(StorageArrayResourceUtils.formatRatio(undefined)).toBe("—");
  });

  test("temperature and percent", () => {
    expect(StorageArrayResourceUtils.formatTemperature(41.6)).toBe("42 °C");
    expect(StorageArrayResourceUtils.formatPercent(83.456)).toBe("83.5%");
  });
});

describe("a detail page's address carries the object's name", () => {
  test.each([
    "vol-db-01",
    "vg1/vol1",
    "pod1::vol1",
    "fs1:root",
    "My Volume 50%",
    "CH0.BAY1",
  ])("%s survives the round trip as one path segment", (name: string) => {
    const param: string =
      StorageArrayResourceUtils.routeParamFromExternalId(name);
    expect(param).not.toContain("/");
    expect(StorageArrayResourceUtils.externalIdFromRouteParam(param)).toBe(
      name,
    );
  });

  test("a malformed param is used as it is rather than crashing the page", () => {
    expect(StorageArrayResourceUtils.externalIdFromRouteParam("%E0%A4%A")).toBe(
      "%E0%A4%A",
    );
  });

  test("an object shows its name, else its externalId", () => {
    const row: StorageArrayResource = makeRow({});
    expect(StorageArrayResourceUtils.displayNameForResource(row)).toBe("vol-1");
    row.name = "Volume One";
    expect(StorageArrayResourceUtils.displayNameForResource(row)).toBe(
      "Volume One",
    );
  });
});

describe("a value older than its scrape's cutoff shows as a dash", () => {
  test("the cutoffs are the cleanup worker's: 15 minutes, 90 for directories", () => {
    expect(METRIC_STALE_MS).toBe(15 * 60 * 1000);
    expect(SLOW_SCRAPE_METRIC_STALE_MS).toBe(90 * 60 * 1000);
    expect(
      StorageArrayResourceUtils.getMetricStaleMs(
        StorageArrayResourceKind.Directory,
      ),
    ).toBe(SLOW_SCRAPE_METRIC_STALE_MS);
    expect(
      StorageArrayResourceUtils.getMetricStaleMs(
        StorageArrayResourceKind.Volume,
      ),
    ).toBe(METRIC_STALE_MS);
  });

  test("a volume's value is shown for 15 minutes", () => {
    expect(
      StorageArrayResourceUtils.freshMetricValue(
        makeRow({ minutesAgo: 10 }),
        250,
      ),
    ).toBe(250);
    expect(
      StorageArrayResourceUtils.freshMetricValue(
        makeRow({ minutesAgo: 20 }),
        250,
      ),
    ).toBe(null);
  });

  test("a directory's value, read every 30 minutes, is shown for 90", () => {
    expect(
      StorageArrayResourceUtils.freshMetricValue(
        makeRow({ kind: StorageArrayResourceKind.Directory, minutesAgo: 45 }),
        1024,
      ),
    ).toBe(1024);
    expect(
      StorageArrayResourceUtils.freshMetricValue(
        makeRow({ kind: StorageArrayResourceKind.Directory, minutesAgo: 100 }),
        1024,
      ),
    ).toBe(null);
  });

  test("a row that never reported metrics shows nothing", () => {
    expect(
      StorageArrayResourceUtils.freshMetricValue(
        makeRow({ minutesAgo: null }),
        250,
      ),
    ).toBe(null);
    expect(
      StorageArrayResourceUtils.freshMetricValue(makeRow({}), undefined),
    ).toBe(null);
  });

  test("bigint columns that arrive as strings still read as numbers", () => {
    expect(
      StorageArrayResourceUtils.freshMetricValue(
        makeRow({}),
        "1099511627776" as unknown as number,
      ),
    ).toBe(1099511627776);
  });
});

describe("vendor extras", () => {
  test("read as numbers and strings, missing as nothing", () => {
    const row: StorageArrayResource = makeRow({
      details: { objectCount: 42, naaId: "624A9370", averageLagMs: "1200" },
    });
    expect(StorageArrayResourceUtils.getDetailNumber(row, "objectCount")).toBe(
      42,
    );
    expect(StorageArrayResourceUtils.getDetailNumber(row, "averageLagMs")).toBe(
      1200,
    );
    expect(StorageArrayResourceUtils.getDetailNumber(row, "missing")).toBe(
      null,
    );
    expect(StorageArrayResourceUtils.getDetailString(row, "naaId")).toBe(
      "624A9370",
    );
    expect(StorageArrayResourceUtils.getDetailString(row, "missing")).toBe("");
  });

  test("a file system lists the protocols it is shared over", () => {
    expect(
      getFileSystemProtocols(
        makeRow({ details: { nfs: "true", smb: "false" } }),
      ),
    ).toEqual(["NFS"]);
    expect(
      getFileSystemProtocols(
        makeRow({ details: { nfs: "v3,v4.1", smb: "true" } }),
      ),
    ).toEqual(["NFS v3,v4.1", "SMB"]);
    expect(getFileSystemProtocols(makeRow({}))).toEqual([]);
  });

  test("a file system's size is total_provisioned, else its configured size", () => {
    expect(
      getFileSystemProvisionedBytes(
        makeRow({
          kind: StorageArrayResourceKind.FileSystem,
          capacityBytes: 2048,
          details: { provisionedBytes: 1024 },
        }),
      ),
    ).toBe(2048);
    expect(
      getFileSystemProvisionedBytes(
        makeRow({
          kind: StorageArrayResourceKind.FileSystem,
          details: { provisionedBytes: 1024 },
        }),
      ),
    ).toBe(1024);
  });
});

describe("charts are built from the metric catalog", () => {
  test("a catalog query keeps the entry's label filters and adds the array and the object", () => {
    const query: MetricQueryConfigData =
      StorageArrayResourceUtils.buildCatalogQuery({
        metricId: "purefa-volume-write-latency",
        arrayName: "fa-prod-01",
        objectFilters: { name: "vg1/vol1" },
        legend: "Write",
        overlayWithPreviousQuery: true,
      })!;

    expect(query.metricQueryData.filterData.metricName).toBe(
      "purefa_volume_performance_latency_usec",
    );
    expect(query.metricQueryData.filterData.attributes).toEqual({
      dimension: "usec_per_write_op",
      [STORAGE_ARRAY_ATTRIBUTE]: "fa-prod-01",
      name: "vg1/vol1",
    });
    expect(STORAGE_ARRAY_ATTRIBUTE).toBe("resource.storage.array.name");
    expect(query.metricAliasData?.legend).toBe("Write");
    expect(query.metricAliasData?.legendUnit).toBe("µs");
    expect(query.overlayWithPreviousQuery).toBe(true);
    expect(query.metricQueryData.groupByAttributeKeys).toBeUndefined();
  });

  test("a grouped query splits by the object label, and ratios and counts carry no unit", () => {
    const query: MetricQueryConfigData =
      StorageArrayResourceUtils.buildCatalogQuery({
        metricId: "purefb-bucket-object-count",
        arrayName: "fb-prod-01",
        groupByAttributeKeys: ["name"],
      })!;
    expect(query.metricQueryData.groupByAttributeKeys).toEqual(["name"]);
    expect(query.metricAliasData?.legendUnit).toBe("");
    expect(query.overlayWithPreviousQuery).toBeUndefined();
    expect(StorageArrayResourceUtils.getChartUnit("ratio")).toBe("");
    expect(StorageArrayResourceUtils.getChartUnit("bytes/s")).toBe("bytes/s");
  });

  test("an unknown catalog id builds no chart rather than a broken one", () => {
    expect(
      StorageArrayResourceUtils.buildCatalogQuery({
        metricId: "no-such-metric",
        arrayName: "fa-prod-01",
      }),
    ).toBeUndefined();
    expect(
      StorageArrayResourceUtils.buildCatalogQueries([
        { metricId: "no-such-metric", arrayName: "fa-prod-01" },
        { metricId: "purefa-array-read-latency", arrayName: "fa-prod-01" },
      ]),
    ).toHaveLength(1);
  });

  test("every catalog id written in the pages exists, so no chart silently disappears", () => {
    const sources: Array<string> = [
      ["Pages", "StorageArray", "View", "VolumeDetail.tsx"],
      ["Pages", "StorageArray", "View", "HostDetail.tsx"],
      ["Pages", "StorageArray", "View", "FileSystemDetail.tsx"],
      ["Pages", "StorageArray", "View", "BucketDetail.tsx"],
      ["Pages", "StorageArray", "View", "Insights.tsx"],
    ].map((segments: Array<string>): string => {
      return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
    });

    const ids: Set<string> = new Set();
    for (const source of sources) {
      for (const match of source.matchAll(/"(pure(?:fa|fb)-[a-z0-9-]+)"/g)) {
        ids.add(match[1]!);
      }
    }

    expect(ids.size).toBeGreaterThan(20);
    for (const id of ids) {
      expect({ id, inCatalog: Boolean(getStorageArrayMetricById(id)) }).toEqual(
        { id, inCatalog: true },
      );
    }
  });

  test.each([
    [StorageSystem.PureStorageFlashArray, "purefa_"],
    [StorageSystem.PureStorageFlashBlade, "purefb_"],
  ])(
    "the %s overview charts latency, IOPS and bandwidth read and write on one panel each, and capacity",
    (storageSystem: StorageSystem, prefix: string) => {
      const queries: Array<MetricQueryConfigData> = getGoldenChartQueries({
        storageSystem: storageSystem,
        arrayName: "array-1",
      });

      expect(queries).toHaveLength(7);
      for (const query of queries) {
        expect(query.metricQueryData.filterData.metricName).toMatch(
          new RegExp(`^${prefix}`),
        );
        expect(query.metricQueryData.filterData.attributes).toMatchObject({
          [STORAGE_ARRAY_ATTRIBUTE]: "array-1",
        });
      }
      // Writes overlay the read panel above them.
      expect(
        queries.map((query: MetricQueryConfigData): boolean => {
          return Boolean(query.overlayWithPreviousQuery);
        }),
      ).toEqual([false, true, false, true, false, true, false]);
      expect(
        queries.map((query: MetricQueryConfigData): string => {
          return (
            query.metricQueryData.filterData.attributes as Record<
              string,
              string
            >
          )["dimension"] as string;
        }),
      ).toEqual([
        "usec_per_read_op",
        "usec_per_write_op",
        "reads_per_sec",
        "writes_per_sec",
        "read_bytes_per_sec",
        "write_bytes_per_sec",
        undefined,
      ]);
    },
  );

  test("an array whose platform is not known yet gets no golden charts", () => {
    expect(
      getGoldenChartQueries({ storageSystem: undefined, arrayName: "a" }),
    ).toEqual([]);
    expect(
      getGoldenChartQueries({ storageSystem: "netapp.ontap", arrayName: "a" }),
    ).toEqual([]);
  });

  test("the open alerts come from the platform's alert series", () => {
    expect(getAlertMetricNames(StorageSystem.PureStorageFlashArray)).toEqual([
      "purefa_alerts_open",
    ]);
    expect(getAlertMetricNames(StorageSystem.PureStorageFlashBlade)).toEqual([
      "purefb_alerts_open",
    ]);
    expect(getAlertMetricNames(undefined)).toEqual([
      "purefa_alerts_open",
      "purefb_alerts_open",
    ]);
  });
});

describe("the Resource Usage page", () => {
  test("each platform gets its own sections, an unknown one none", () => {
    expect(getInsightsSections(StorageSystem.PureStorageFlashArray)).toBe(
      FLASHARRAY_INSIGHTS_SECTIONS,
    );
    expect(getInsightsSections(StorageSystem.PureStorageFlashBlade)).toBe(
      FLASHBLADE_INSIGHTS_SECTIONS,
    );
    expect(getInsightsSections(undefined)).toEqual([]);
  });

  test.each([
    [StorageSystem.PureStorageFlashArray, FLASHARRAY_INSIGHTS_SECTIONS],
    [StorageSystem.PureStorageFlashBlade, FLASHBLADE_INSIGHTS_SECTIONS],
  ])(
    "every %s chart is that platform's catalog metric, and per-object sections split by object",
    (storageSystem: StorageSystem, sections: Array<InsightsSection>) => {
      const platformMetrics: Array<string> = getStorageArrayMetricsForSystem(
        storageSystem,
      ).map((metric: StorageArrayMetricDefinition): string => {
        return metric.id;
      });

      for (const section of sections) {
        const queries: Array<MetricQueryConfigData> = getInsightsQueries({
          section: section,
          arrayName: "array-1",
          storageSystem: storageSystem,
        });
        expect(queries).toHaveLength(section.metricIds.length);
        for (const metricId of section.metricIds) {
          expect(platformMetrics).toContain(metricId);
        }
        for (const query of queries) {
          expect(
            Boolean(query.metricQueryData.groupByAttributeKeys?.length),
          ).toBe(Boolean(section.groupByObject));
        }
      }
    },
  );

  test("replica links split by their local pod, FlashBlade hardware by name", () => {
    const replication: InsightsSection = FLASHARRAY_INSIGHTS_SECTIONS.find(
      (section: InsightsSection): boolean => {
        return section.key === "replication";
      },
    )!;
    const lag: MetricQueryConfigData = getInsightsQueries({
      section: replication,
      arrayName: "array-1",
      storageSystem: StorageSystem.PureStorageFlashArray,
    })[0]!;
    expect(lag.metricQueryData.groupByAttributeKeys).toEqual(["local_pod"]);

    const hardware: InsightsSection = FLASHBLADE_INSIGHTS_SECTIONS.find(
      (section: InsightsSection): boolean => {
        return section.key === "hardware";
      },
    )!;
    expect(
      getInsightsQueries({
        section: hardware,
        arrayName: "array-1",
        storageSystem: StorageSystem.PureStorageFlashBlade,
      })[0]!.metricQueryData.groupByAttributeKeys,
    ).toEqual(["name"]);
  });
});

describe("the array side menu", () => {
  const pagesFor: (system: string | undefined) => Array<PageMap> = (
    system: string | undefined,
  ): Array<PageMap> => {
    return getInventoryMenuItems(system).map(
      (item: InventoryMenuItem): PageMap => {
        return item.pageKey;
      },
    );
  };

  test("a FlashArray lists volumes, hosts, replication, directories and hardware", () => {
    expect(pagesFor(StorageSystem.PureStorageFlashArray)).toEqual([
      PageMap.STORAGE_ARRAY_VIEW_VOLUMES,
      PageMap.STORAGE_ARRAY_VIEW_HOSTS,
      PageMap.STORAGE_ARRAY_VIEW_REPLICATION,
      PageMap.STORAGE_ARRAY_VIEW_DIRECTORIES,
      PageMap.STORAGE_ARRAY_VIEW_HARDWARE,
    ]);
  });

  test("a FlashBlade lists file systems, buckets and hardware", () => {
    expect(pagesFor(StorageSystem.PureStorageFlashBlade)).toEqual([
      PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEMS,
      PageMap.STORAGE_ARRAY_VIEW_BUCKETS,
      PageMap.STORAGE_ARRAY_VIEW_HARDWARE,
    ]);
  });

  test("an array without a known platform lists no inventory page", () => {
    expect(pagesFor(undefined)).toEqual([]);
    expect(pagesFor("")).toEqual([]);
    expect(pagesFor("netapp.ontap")).toEqual([]);
  });

  test("every inventory page appears once", () => {
    const keys: Array<PageMap> = INVENTORY_MENU_ITEMS.map(
      (item: InventoryMenuItem): PageMap => {
        return item.pageKey;
      },
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the monitor form", () => {
  const keysFor: (system: string | undefined) => Array<string> = (
    system: string | undefined,
  ): Array<string> => {
    return getResourceFilterFields(system).map(
      (field: ResourceFilterField): string => {
        return field.key;
      },
    );
  };

  test("a FlashArray monitor narrows to a volume, host, pod or hardware part", () => {
    expect(keysFor(StorageSystem.PureStorageFlashArray)).toEqual([
      "volumeName",
      "hostName",
      "podName",
      "componentName",
    ]);
  });

  test("a FlashBlade monitor narrows to a hardware part, file system or bucket", () => {
    expect(keysFor(StorageSystem.PureStorageFlashBlade)).toEqual([
      "componentName",
      "fileSystemName",
      "bucketName",
    ]);
  });

  test("an array whose platform is not known yet offers every filter", () => {
    expect(keysFor(undefined)).toHaveLength(6);
  });

  test("a custom metric's window always holds a scrape", () => {
    const volumeLatency: StorageArrayMetricDefinition =
      getStorageArrayMetricById("purefa-volume-read-latency")!;
    expect(volumeLatency.defaultResourceScope).toBe(
      StorageArrayResourceScope.Volume,
    );
    expect(getRecommendedRollingTime(volumeLatency)).toBe(
      RollingTime.Past5Minutes,
    );
    // FlashBlade file systems and buckets are read every 5 minutes.
    expect(
      getRecommendedRollingTime(
        getStorageArrayMetricById("purefb-fs-read-latency")!,
      ),
    ).toBe(RollingTime.Past15Minutes);
    expect(
      getRecommendedRollingTime(
        getStorageArrayMetricById("purefb-bucket-object-count")!,
      ),
    ).toBe(RollingTime.Past15Minutes);
  });
});
