import { describe, expect, test } from "@jest/globals";
import {
  KUBERNETES_VOLUME_USAGE_GAP_CELL_TEXT,
  KUBERNETES_VOLUME_USAGE_GAP_EXPLANATION,
  KubernetesVolumeClaimUsage,
  KubernetesVolumeUsageGap,
  getKubernetesVolumeClaimKey,
  getKubernetesVolumeClaimStorageCell,
  getKubernetesVolumeClaimUsage,
  getPersistentVolumeStorageCell,
  isVolumeUsageMissingFromCluster,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesVolumeUsage";
import {
  KubernetesVolumeUsageCharts,
  VOLUME_CAPACITY_VARIABLE,
  VOLUME_FREE_INODES_VARIABLE,
  VOLUME_FREE_VARIABLE,
  VOLUME_INODES_VARIABLE,
  getKubernetesVolumeUsageCharts,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesVolumeUsageCharts";
import { StorageUsageLevel } from "../../../Utils/Storage/StorageUsage";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { JSONObject } from "../../../Types/JSON";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import MetricFormulaEvaluator from "../../../Utils/Metrics/MetricFormulaEvaluator";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";

/*
 * A persistent volume claim's usage, read off its inventory row (#9539):
 * what the claims list draws in its Used and Free columns, what a claim's
 * Storage card says, why a claim with no usage has none, and the charts of
 * its usage over time.
 */

const GIB: number = 1024 * 1024 * 1024;
const MEASURED: Date = new Date("2026-11-18T10:00:00.000Z");

function bound(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: { phase: "Bound" } as JSONObject,
    spec: { volumeMode: "Filesystem" } as JSONObject,
    metricsUpdatedAt: MEASURED,
    ...fields,
  };
}

const ENGLISH: Translator = {
  language: "en",
  translateText: (text: string): string => {
    return text;
  },
  translateTemplate: (
    template: string,
    values: Record<string, unknown>,
  ): string => {
    let filled: string = template;
    for (const key of Object.keys(values)) {
      filled = filled.split(`{{${key}}}`).join(String(values[key]));
    }
    return filled;
  },
} as unknown as Translator;

describe("getKubernetesVolumeClaimUsage", () => {
  test("reads used, free and capacity from the latest volume columns", () => {
    const usage: KubernetesVolumeClaimUsage = getKubernetesVolumeClaimUsage(
      bound({
        latestVolumeCapacityBytes: 50 * GIB,
        latestVolumeAvailableBytes: 5 * GIB,
      }),
    );

    expect(usage.space).toMatchObject({
      capacity: 50 * GIB,
      used: 45 * GIB,
      free: 5 * GIB,
      usedPercent: 90,
      level: StorageUsageLevel.Critical,
    });
    expect(usage.gap).toBeNull();
    expect(usage.measuredAt).toEqual(MEASURED);
  });

  test("reads the bigint columns as the API sends them, strings", () => {
    const usage: KubernetesVolumeClaimUsage = getKubernetesVolumeClaimUsage(
      bound({
        latestVolumeCapacityBytes: String(5000 * GIB),
        latestVolumeAvailableBytes: String(1000 * GIB),
        metricsUpdatedAt: MEASURED.toISOString(),
      }),
    );

    expect(usage.space?.usedPercent).toBe(80);
    expect(usage.space?.level).toBe(StorageUsageLevel.Warning);
    expect(usage.measuredAt).toEqual(MEASURED);
  });

  test("reads its inodes when the volume reports them", () => {
    const usage: KubernetesVolumeClaimUsage = getKubernetesVolumeClaimUsage(
      bound({
        latestVolumeCapacityBytes: 50 * GIB,
        latestVolumeAvailableBytes: 40 * GIB,
        latestVolumeInodes: 1000,
        latestVolumeInodesFree: 50,
      }),
    );

    expect(usage.inodes).toMatchObject({
      capacity: 1000,
      used: 950,
      free: 50,
      level: StorageUsageLevel.Critical,
    });
  });

  test("has no inodes for a volume that reports none", () => {
    const usage: KubernetesVolumeClaimUsage = getKubernetesVolumeClaimUsage(
      bound({
        latestVolumeCapacityBytes: 50 * GIB,
        latestVolumeAvailableBytes: 40 * GIB,
      }),
    );

    expect(usage.inodes).toBeNull();
  });

  test("says a claim that is not bound yet has nothing to measure", () => {
    for (const phase of ["Pending", "Lost"]) {
      const usage: KubernetesVolumeClaimUsage = getKubernetesVolumeClaimUsage(
        bound({ status: { phase: phase } }),
      );

      expect(usage.space).toBeNull();
      expect(usage.gap).toBe(KubernetesVolumeUsageGap.NotBound);
      expect(usage.measuredAt).toBeNull();
    }
  });

  test("says a raw block device has no filesystem to measure", () => {
    const usage: KubernetesVolumeClaimUsage = getKubernetesVolumeClaimUsage(
      bound({ spec: { volumeMode: "Block" } }),
    );

    expect(usage.gap).toBe(KubernetesVolumeUsageGap.Block);
  });

  test("says a bound filesystem claim with no reading was not reported", () => {
    expect(getKubernetesVolumeClaimUsage(bound()).gap).toBe(
      KubernetesVolumeUsageGap.NotReported,
    );
    // A claim stored before its spec named a volumeMode is a filesystem.
    expect(
      getKubernetesVolumeClaimUsage(bound({ spec: {} as JSONObject })).gap,
    ).toBe(KubernetesVolumeUsageGap.NotReported);
    // So is one whose row carries no spec or status at all.
    expect(getKubernetesVolumeClaimUsage({}).gap).toBe(
      KubernetesVolumeUsageGap.NotReported,
    );
  });

  test("never reads a capacity without its available bytes as a usage", () => {
    const usage: KubernetesVolumeClaimUsage = getKubernetesVolumeClaimUsage(
      bound({ latestVolumeCapacityBytes: 50 * GIB }),
    );

    expect(usage.space).toBeNull();
    expect(usage.gap).toBe(KubernetesVolumeUsageGap.NotReported);
  });
});

describe("what a claim with no usage says", () => {
  test("a cell says it in a few words, and a page in a sentence", () => {
    for (const gap of Object.values(KubernetesVolumeUsageGap)) {
      expect(KUBERNETES_VOLUME_USAGE_GAP_CELL_TEXT[gap].length).toBeLessThan(
        20,
      );
      expect(KUBERNETES_VOLUME_USAGE_GAP_EXPLANATION[gap]).toMatch(/\.$/);
    }
  });

  test("the not-reported sentence says what to check, and names the agent", () => {
    const sentence: string =
      KUBERNETES_VOLUME_USAGE_GAP_EXPLANATION[
        KubernetesVolumeUsageGap.NotReported
      ];

    expect(sentence).toContain("running pod mounts");
    expect(sentence).toContain("kubernetes-agent Helm chart");
  });

  test("a list's cell gets the bar when there is a reading, the words otherwise", () => {
    const withUsage: KubernetesVolumeClaimUsage = getKubernetesVolumeClaimUsage(
      bound({
        latestVolumeCapacityBytes: 10 * GIB,
        latestVolumeAvailableBytes: 9 * GIB,
      }),
    );
    expect(getKubernetesVolumeClaimStorageCell(withUsage)).toEqual({
      usage: withUsage.space,
    });

    expect(
      getKubernetesVolumeClaimStorageCell(
        getKubernetesVolumeClaimUsage(bound({ status: { phase: "Pending" } })),
      ),
    ).toEqual({ usage: null, noUsageText: "Not bound" });
  });
});

describe("isVolumeUsageMissingFromCluster", () => {
  const reporting: KubernetesVolumeClaimUsage = getKubernetesVolumeClaimUsage(
    bound({
      latestVolumeCapacityBytes: 10 * GIB,
      latestVolumeAvailableBytes: 9 * GIB,
    }),
  );
  const silent: KubernetesVolumeClaimUsage =
    getKubernetesVolumeClaimUsage(bound());
  const pending: KubernetesVolumeClaimUsage = getKubernetesVolumeClaimUsage(
    bound({ status: { phase: "Pending" } }),
  );
  const block: KubernetesVolumeClaimUsage = getKubernetesVolumeClaimUsage(
    bound({ spec: { volumeMode: "Block" } }),
  );

  test("is true when bound claims exist and not one reports usage", () => {
    expect(isVolumeUsageMissingFromCluster([silent, pending, silent])).toBe(
      true,
    );
  });

  test("is false once any claim reports usage: the agent sends it", () => {
    expect(isVolumeUsageMissingFromCluster([silent, reporting])).toBe(false);
  });

  test("is false for a cluster with no claims, or none that could report", () => {
    expect(isVolumeUsageMissingFromCluster([])).toBe(false);
    expect(isVolumeUsageMissingFromCluster([pending, block])).toBe(false);
  });
});

describe("getPersistentVolumeStorageCell", () => {
  const claimUsages: Map<string, KubernetesVolumeClaimUsage> = new Map([
    [
      getKubernetesVolumeClaimKey("data", "data-postgres-0"),
      getKubernetesVolumeClaimUsage(
        bound({
          latestVolumeCapacityBytes: 100 * GIB,
          latestVolumeAvailableBytes: 15 * GIB,
        }),
      ),
    ],
    [
      getKubernetesVolumeClaimKey("other", "data-postgres-0"),
      getKubernetesVolumeClaimUsage(bound()),
    ],
  ]);

  test("is the usage of the claim bound to the volume, in its namespace", () => {
    const cell: ReturnType<typeof getPersistentVolumeStorageCell> =
      getPersistentVolumeStorageCell({
        phase: "Bound",
        claimNamespace: "data",
        claimName: "data-postgres-0",
        claimUsages: claimUsages,
      });

    expect(cell.usage?.usedPercent).toBe(85);
    expect(cell.usage?.level).toBe(StorageUsageLevel.Warning);
  });

  test("never takes a same-named claim's usage from another namespace", () => {
    expect(
      getPersistentVolumeStorageCell({
        phase: "Bound",
        claimNamespace: "other",
        claimName: "data-postgres-0",
        claimUsages: claimUsages,
      }),
    ).toEqual({ usage: null, noUsageText: "Not reported" });
  });

  test("says a volume no claim is bound to is not bound", () => {
    for (const volume of [
      { phase: "Available", claimName: "" },
      { phase: "Released", claimName: "data-postgres-0" },
    ]) {
      expect(
        getPersistentVolumeStorageCell({
          ...volume,
          claimNamespace: "data",
          claimUsages: claimUsages,
        }),
      ).toEqual({ usage: null, noUsageText: "Not bound" });
    }
  });

  test("says a bound volume whose claim the inventory does not hold was not reported", () => {
    expect(
      getPersistentVolumeStorageCell({
        phase: "Bound",
        claimNamespace: "data",
        claimName: "gone",
        claimUsages: claimUsages,
      }),
    ).toEqual({ usage: null, noUsageText: "Not reported" });
  });
});

describe("a claim's usage over time", () => {
  function charts(hasInodes: boolean): KubernetesVolumeUsageCharts {
    return getKubernetesVolumeUsageCharts({
      clusterIdentifier: "prod",
      namespace: "data",
      claimName: "data-postgres-0",
      hasInodes: hasInodes,
      translator: ENGLISH,
    });
  }

  test("reads the claim's own series, in its namespace and cluster", () => {
    for (const query of charts(true).queryConfigs) {
      expect(query.metricQueryData.filterData.attributes).toEqual({
        "resource.k8s.cluster.name": "prod",
        "resource.k8s.namespace.name": "data",
        "resource.k8s.persistentvolumeclaim.name": "data-postgres-0",
      });
      // One series per claim, whatever pods mount it: never split by pod.
      expect(query.metricQueryData.groupBy).toBeUndefined();
    }
  });

  test("charts capacity with the free space on the same chart, never a sum across pods", () => {
    const [capacity, free] = charts(false).queryConfigs;

    expect(capacity!.metricQueryData.filterData.metricName).toBe(
      "k8s.volume.capacity",
    );
    expect(capacity!.metricQueryData.filterData.aggegationType).toBe(
      AggregationType.Max,
    );
    expect(free!.metricQueryData.filterData.metricName).toBe(
      "k8s.volume.available",
    );
    expect(free!.metricQueryData.filterData.aggegationType).toBe(
      AggregationType.Min,
    );
    expect(free!.overlayWithPreviousQuery).toBe(true);
    expect(capacity!.yAxisValueFormatter!(50 * GIB)).toBe("50\u00A0GiB");
  });

  test("works out the used percent from the two, against the bar's lines", () => {
    const built: KubernetesVolumeUsageCharts = charts(false);
    const [usedPercent] = built.formulaConfigs;
    const at: Date = new Date("2026-11-18T10:00:00.000Z");

    expect(usedPercent!.metricAliasData.legendUnit).toBe("%");
    expect(usedPercent!.warningThreshold).toBe(80);
    expect(usedPercent!.criticalThreshold).toBe(90);

    const result: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: usedPercent!.metricFormulaData.metricFormula,
      queryConfigs: built.queryConfigs,
      formulaConfigs: [],
      // Capacity 200, free 30, in the same minute.
      results: [
        { data: [{ timestamp: at, value: 200 }] },
        { data: [{ timestamp: at, value: 30 }] },
      ] as Array<AggregatedResult>,
    });

    expect(result.data).toHaveLength(1);
    expect(Number(result.data[0]!["value"])).toBe(85);
    expect([VOLUME_CAPACITY_VARIABLE, VOLUME_FREE_VARIABLE]).toEqual([
      built.queryConfigs[0]!.metricAliasData!.metricVariable,
      built.queryConfigs[1]!.metricAliasData!.metricVariable,
    ]);
  });

  test("charts inodes only for a claim that reports them", () => {
    expect(charts(false).queryConfigs).toHaveLength(2);
    expect(charts(false).formulaConfigs).toHaveLength(1);

    const withInodes: KubernetesVolumeUsageCharts = charts(true);
    expect(
      withInodes.queryConfigs.map((q: (typeof withInodes.queryConfigs)[0]) => {
        return q.metricQueryData.filterData.metricName;
      }),
    ).toEqual([
      "k8s.volume.capacity",
      "k8s.volume.available",
      "k8s.volume.inodes",
      "k8s.volume.inodes.free",
    ]);
    expect(withInodes.formulaConfigs[1]!.metricFormulaData.metricFormula).toBe(
      `((${VOLUME_INODES_VARIABLE} - ${VOLUME_FREE_INODES_VARIABLE}) / ${VOLUME_INODES_VARIABLE}) * 100`,
    );
  });
});
