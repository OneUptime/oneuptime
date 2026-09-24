import { describe, expect, test } from "@jest/globals";
import {
  DATABASE_RUNTIME_METRICS,
  DATABASE_SERVER_LIVE_WINDOW_MINUTES,
  DatabaseEngineMetricsStatus,
  DatabaseOption,
  DatabaseRuntimePlatform,
  formatDatabaseBytes,
  formatDatabaseCount,
  formatDatabaseMetricUnitValue,
  formatDatabaseMetricValue,
  formatDatabaseRuntimeValue,
  formatDatabaseSeconds,
  getCollectorReceiverTypes,
  getDatabaseDiscoverySourceOptions,
  getDatabaseEndpointLabel,
  getDatabaseEngineLabel,
  getDatabaseEngineMetricsStatus,
  getDatabaseEngineMetricsStatusLabel,
  getDatabaseEngineMetricsStatusOptions,
  getDatabaseEngineMetricsStatusQueryKind,
  getDatabaseEngineOptions,
  getDatabaseRunsOnLabel,
  getDatabaseRuntimePlatform,
  getDatabaseWorkloadLabel,
  hasCollectorReceiver,
  isDatabaseServerLive,
  normalizeEngine,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import DatabaseServerDiscoverySource, {
  DATABASE_SERVER_DISCOVERY_SOURCES,
} from "../../../Types/DatabaseServer/DatabaseServerDiscoverySource";
import { DATABASE_SYSTEMS } from "../../../Types/DatabaseServer/DatabaseSystem";
import ObjectID from "../../../Types/ObjectID";

describe("engine and discovery-source options", () => {
  test("offer every registered engine once, sorted, with its semconv value in the label", () => {
    const options: Array<DatabaseOption> = getDatabaseEngineOptions();

    expect(options).toHaveLength(DATABASE_SYSTEMS.length);
    expect(
      new Set(
        options.map((option: DatabaseOption): string => {
          return option.value;
        }),
      ).size,
    ).toBe(DATABASE_SYSTEMS.length);

    const labels: Array<string> = options.map(
      (option: DatabaseOption): string => {
        return option.label;
      },
    );
    expect(labels).toEqual(
      [...labels].sort((a: string, b: string): number => {
        return a.localeCompare(b);
      }),
    );

    expect(options).toContainEqual({
      label: "PostgreSQL (postgresql)",
      value: "postgresql",
    });
    expect(options).toContainEqual({
      label: "SQL Server (microsoft.sql_server)",
      value: "microsoft.sql_server",
    });
  });

  test("offer every discovery source in the shared order with its label", () => {
    const options: Array<DatabaseOption> = getDatabaseDiscoverySourceOptions();

    expect(
      options.map((option: DatabaseOption): string => {
        return option.value;
      }),
    ).toEqual([...DATABASE_SERVER_DISCOVERY_SOURCES]);
    expect(options[1]).toEqual({
      value: DatabaseServerDiscoverySource.ClientSpans,
      label: "Application traces",
    });
  });

  test("engine labels accept aliases and keep unknown values", () => {
    expect(getDatabaseEngineLabel("postgres")).toBe("PostgreSQL");
    expect(getDatabaseEngineLabel("mssql")).toBe("SQL Server");
    expect(getDatabaseEngineLabel("  somedb ")).toBe("somedb");
    expect(getDatabaseEngineLabel(undefined)).toBe("Database");
    expect(normalizeEngine("Postgres")).toBe("postgresql");
    expect(normalizeEngine(null)).toBe("");
  });
});

describe("getDatabaseEngineMetricsStatus", () => {
  test("connected only when the collector path says so", () => {
    expect(
      getDatabaseEngineMetricsStatus({ otelCollectorStatus: "connected" }),
    ).toBe(DatabaseEngineMetricsStatus.Connected);
    expect(
      getDatabaseEngineMetricsStatus({ otelCollectorStatus: " Connected " }),
    ).toBe(DatabaseEngineMetricsStatus.Connected);
  });

  test("disconnected only when a collector reported once and stopped", () => {
    expect(
      getDatabaseEngineMetricsStatus({
        otelCollectorStatus: "disconnected",
        collectorLastSeenAt: new Date("2026-09-20T00:00:00.000Z"),
      }),
    ).toBe(DatabaseEngineMetricsStatus.Disconnected);
    expect(
      getDatabaseEngineMetricsStatus({
        collectorLastSeenAt: "2026-09-20T00:00:00.000Z",
      }),
    ).toBe(DatabaseEngineMetricsStatus.Disconnected);
  });

  /*
   * The audit's scenario: every row created from client spans, Kubernetes,
   * Docker, Podman or by hand stores otelCollectorStatus "disconnected" —
   * the column default — with no collectorLastSeenAt. It never had an
   * agent, so it is NOT CONNECTED, never a red "Disconnected".
   */
  test("the stored 'disconnected' default with no collector sighting is NOT CONNECTED", () => {
    for (const row of [
      { otelCollectorStatus: "disconnected", collectorLastSeenAt: null },
      { otelCollectorStatus: "disconnected", collectorLastSeenAt: undefined },
      { otelCollectorStatus: "disconnected" },
      { otelCollectorStatus: " Disconnected ", collectorLastSeenAt: "" },
      { otelCollectorStatus: "disconnected", collectorLastSeenAt: "garbage" },
    ]) {
      expect(getDatabaseEngineMetricsStatus(row)).toBe(
        DatabaseEngineMetricsStatus.NotConnected,
      );
    }
  });

  test("a database only seen from traces or containers is NOT CONNECTED, not disconnected", () => {
    expect(getDatabaseEngineMetricsStatus({})).toBe(
      DatabaseEngineMetricsStatus.NotConnected,
    );
    expect(getDatabaseEngineMetricsStatus(null)).toBe(
      DatabaseEngineMetricsStatus.NotConnected,
    );
    expect(
      getDatabaseEngineMetricsStatus({ otelCollectorStatus: undefined }),
    ).toBe(DatabaseEngineMetricsStatus.NotConnected);
  });

  test("the list filter offers all three, values from the enum", () => {
    expect(getDatabaseEngineMetricsStatusOptions()).toEqual([
      { value: "connected", label: "Connected" },
      { value: "disconnected", label: "Disconnected" },
      { value: "not-connected", label: "Not connected" },
    ]);
  });

  test("each filter value maps to the rows its status covers", () => {
    expect(getDatabaseEngineMetricsStatusQueryKind("connected")).toBe(
      "connected",
    );
    expect(getDatabaseEngineMetricsStatusQueryKind(" Disconnected ")).toBe(
      "reported-and-stopped",
    );
    expect(getDatabaseEngineMetricsStatusQueryKind("not-connected")).toBe(
      "never-reported",
    );
    expect(getDatabaseEngineMetricsStatusQueryKind("nope")).toBeNull();
    expect(getDatabaseEngineMetricsStatusQueryKind(null)).toBeNull();
  });

  test("labels", () => {
    expect(
      getDatabaseEngineMetricsStatusLabel(
        DatabaseEngineMetricsStatus.Connected,
      ),
    ).toBe("Connected");
    expect(
      getDatabaseEngineMetricsStatusLabel(
        DatabaseEngineMetricsStatus.Disconnected,
      ),
    ).toBe("Disconnected");
    expect(
      getDatabaseEngineMetricsStatusLabel(
        DatabaseEngineMetricsStatus.NotConnected,
      ),
    ).toBe("Not connected");
  });
});

describe("isDatabaseServerLive", () => {
  const NOW: Date = new Date("2026-09-24T12:00:00.000Z");

  test("inside the window (inclusive) is live, outside is not", () => {
    const edge: Date = new Date(
      NOW.getTime() - DATABASE_SERVER_LIVE_WINDOW_MINUTES * 60 * 1000,
    );
    expect(isDatabaseServerLive(edge, NOW)).toBe(true);
    expect(isDatabaseServerLive(new Date(edge.getTime() - 1), NOW)).toBe(false);
    expect(isDatabaseServerLive(NOW.toISOString(), NOW)).toBe(true);
  });

  test("the window covers three runs of the 10-minute trace discovery", () => {
    expect(DATABASE_SERVER_LIVE_WINDOW_MINUTES).toBeGreaterThanOrEqual(30);
  });

  test("missing or invalid timestamps are not live", () => {
    expect(isDatabaseServerLive(null, NOW)).toBe(false);
    expect(isDatabaseServerLive(undefined, NOW)).toBe(false);
    expect(isDatabaseServerLive("not a date", NOW)).toBe(false);
  });
});

describe("runtime platform and runs-on labels", () => {
  test("parent columns win over the discovery source", () => {
    expect(
      getDatabaseRuntimePlatform({
        discoverySource: "client-spans",
        kubernetesClusterId: ObjectID.generate(),
      }),
    ).toBe(DatabaseRuntimePlatform.Kubernetes);
    expect(
      getDatabaseRuntimePlatform({
        discoverySource: "collector",
        dockerHost: { name: "build-1" },
      }),
    ).toBe(DatabaseRuntimePlatform.Docker);
    expect(
      getDatabaseRuntimePlatform({ podmanHostId: ObjectID.generate() }),
    ).toBe(DatabaseRuntimePlatform.Podman);
  });

  test("falls back to the discovery source, and is null for outside-only databases", () => {
    expect(getDatabaseRuntimePlatform({ discoverySource: "kubernetes" })).toBe(
      DatabaseRuntimePlatform.Kubernetes,
    );
    expect(getDatabaseRuntimePlatform({ discoverySource: "Docker" })).toBe(
      DatabaseRuntimePlatform.Docker,
    );
    expect(getDatabaseRuntimePlatform({ discoverySource: "podman" })).toBe(
      DatabaseRuntimePlatform.Podman,
    );
    expect(
      getDatabaseRuntimePlatform({ discoverySource: "client-spans" }),
    ).toBeNull();
    expect(
      getDatabaseRuntimePlatform({ discoverySource: "manual" }),
    ).toBeNull();
    expect(getDatabaseRuntimePlatform(null)).toBeNull();
  });

  test("runs-on names the platform and, when loaded, its parent", () => {
    expect(
      getDatabaseRunsOnLabel({
        kubernetesCluster: { name: "prod-cluster" },
      }),
    ).toBe("Kubernetes · prod-cluster");
    expect(getDatabaseRunsOnLabel({ dockerHost: { name: " build-1 " } })).toBe(
      "Docker · build-1",
    );
    expect(getDatabaseRunsOnLabel({ discoverySource: "podman" })).toBe(
      "Podman",
    );
    expect(getDatabaseRunsOnLabel({ discoverySource: "client-spans" })).toBe(
      "—",
    );
  });

  test("the workload label joins what is known", () => {
    expect(
      getDatabaseWorkloadLabel({
        kubernetesNamespace: "payments",
        workloadKind: "StatefulSet",
        workloadName: "postgres",
      }),
    ).toBe("payments/StatefulSet/postgres");
    expect(getDatabaseWorkloadLabel({ workloadName: "redis" })).toBe("redis");
    expect(getDatabaseWorkloadLabel(null)).toBe("");
  });

  test("the endpoint label prefers the address, brackets IPv6 and falls back to the workload", () => {
    expect(
      getDatabaseEndpointLabel({
        serverAddress: "db.prod.internal",
        serverPort: 5432,
      }),
    ).toBe("db.prod.internal:5432");
    expect(
      getDatabaseEndpointLabel({
        serverAddress: "2001:db8::1",
        serverPort: 5432,
      }),
    ).toBe("[2001:db8::1]:5432");
    expect(
      getDatabaseEndpointLabel({ serverAddress: "db.prod.internal" }),
    ).toBe("db.prod.internal");
    expect(
      getDatabaseEndpointLabel({
        serverAddress: "db.prod.internal",
        serverPort: 0,
      }),
    ).toBe("db.prod.internal");
    expect(
      getDatabaseEndpointLabel({
        kubernetesNamespace: "payments",
        workloadName: "postgres",
      }),
    ).toBe("payments/postgres");
    expect(getDatabaseEndpointLabel(undefined)).toBe("");
  });

  test("each platform charts the metric names its own agent reports", () => {
    expect(DATABASE_RUNTIME_METRICS.kubernetes.cpu.metricName).toBe(
      "k8s.pod.cpu.utilization",
    );
    expect(DATABASE_RUNTIME_METRICS.kubernetes.memory.metricName).toBe(
      "k8s.pod.memory.usage",
    );
    for (const platform of [
      DatabaseRuntimePlatform.Docker,
      DatabaseRuntimePlatform.Podman,
    ]) {
      expect(DATABASE_RUNTIME_METRICS[platform].cpu.metricName).toBe(
        "container.cpu.utilization",
      );
      expect(DATABASE_RUNTIME_METRICS[platform].memory.metricName).toBe(
        "container.memory.usage.total",
      );
    }
    for (const platform of Object.values(DatabaseRuntimePlatform)) {
      // Averaged per bucket so the chart reads "per instance".
      expect(DATABASE_RUNTIME_METRICS[platform].cpu.aggregation).toBe(
        AggregationType.Avg,
      );
      expect(DATABASE_RUNTIME_METRICS[platform].memory.aggregation).toBe(
        AggregationType.Avg,
      );
    }
  });
});

describe("formatting", () => {
  test("counts", () => {
    expect(formatDatabaseCount(null)).toBe("—");
    expect(formatDatabaseCount(Number.NaN)).toBe("—");
    expect(formatDatabaseCount(0)).toBe("0");
    expect(formatDatabaseCount(0.25)).toBe("0.25");
    expect(formatDatabaseCount(999)).toBe("999");
    expect(formatDatabaseCount(1500)).toBe("1.5k");
    expect(formatDatabaseCount(2_000_000)).toBe("2M");
    expect(formatDatabaseCount(3_400_000_000)).toBe("3.4B");
  });

  test("bytes", () => {
    expect(formatDatabaseBytes(undefined)).toBe("—");
    expect(formatDatabaseBytes(512)).toBe("512 B");
    expect(formatDatabaseBytes(1536)).toBe("1.5 KiB");
    expect(formatDatabaseBytes(5 * 1024 * 1024 * 1024)).toBe("5.0 GiB");
  });

  test("seconds", () => {
    expect(formatDatabaseSeconds(null)).toBe("—");
    expect(formatDatabaseSeconds(4.25)).toBe("4.3 s");
    expect(formatDatabaseSeconds(42)).toBe("42 s");
    expect(formatDatabaseSeconds(90)).toBe("1.5 min");
    expect(formatDatabaseSeconds(7200)).toBe("2 h");
    expect(formatDatabaseSeconds(3 * 86400)).toBe("3 d");
  });

  test("catalog metric values by unit and kind", () => {
    expect(formatDatabaseMetricValue(null, "bytes", "gauge")).toBe("—");
    expect(formatDatabaseMetricValue(2048, "bytes", "gauge")).toBe("2.0 KiB");
    expect(formatDatabaseMetricValue(90, "s", "gauge")).toBe("1.5 min");
    expect(formatDatabaseMetricValue(12, "connections", "gauge")).toBe(
      "12 connections",
    );
    expect(formatDatabaseMetricValue(12, "", "gauge")).toBe("12");
    // Counters are rates.
    expect(formatDatabaseMetricValue(12.5, "commits", "counter")).toBe(
      "12.5 commits/s",
    );
    expect(formatDatabaseMetricValue(0.5, "commits", "counter")).toBe(
      "0.5 commits/s",
    );
    expect(formatDatabaseMetricValue(0, "commits", "counter")).toBe(
      "0 commits/s",
    );
    expect(formatDatabaseMetricValue(4096, "bytes", "counter")).toBe(
      "4.0 KiB/s",
    );
    expect(formatDatabaseMetricValue(3, "", "counter")).toBe("3/s");
  });

  test("non-catalog metric values keep the metric's own unit", () => {
    expect(formatDatabaseMetricUnitValue(null, "s")).toBe("—");
    expect(formatDatabaseMetricUnitValue(Number.NaN, "s")).toBe("—");
    // A 4 ms latency reported in seconds must not read "0" (the audit's bug).
    expect(formatDatabaseMetricUnitValue(0.004, "s")).toBe("4 ms");
    expect(formatDatabaseMetricUnitValue(1_500_000, "By")).toBe("1.5 MB");
    expect(formatDatabaseMetricUnitValue(12, "{connections}")).toBe(
      "12 connections",
    );
    expect(formatDatabaseMetricUnitValue(1500, "{rows}")).toBe("1.5k rows");
    expect(formatDatabaseMetricUnitValue(3.5, "1")).toBe("3.5");
    expect(formatDatabaseMetricUnitValue(3.5, "")).toBe("3.5");
    expect(formatDatabaseMetricUnitValue(3.5, null)).toBe("3.5");
    // Rates read per second.
    expect(
      formatDatabaseMetricUnitValue(2.5, "{deadlocks}", { isRate: true }),
    ).toBe("2.5 deadlocks/s");
    expect(formatDatabaseMetricUnitValue(2, "1", { isRate: true })).toBe("2/s");
    expect(formatDatabaseMetricUnitValue(2_000, "By", { isRate: true })).toBe(
      "2 KB/s",
    );
  });

  test("runtime values", () => {
    expect(formatDatabaseRuntimeValue(null, "cores")).toBe("—");
    expect(formatDatabaseRuntimeValue(0.125, "cores")).toBe("0.125 cores");
    expect(formatDatabaseRuntimeValue(2.5, "cores")).toBe("2.50 cores");
    expect(formatDatabaseRuntimeValue(42.123, "percent")).toBe("42.1%");
    expect(formatDatabaseRuntimeValue(1024 * 1024, "bytes")).toBe("1.0 MiB");
  });
});

describe("collector support", () => {
  test("engines with a contrib receiver", () => {
    expect(hasCollectorReceiver("postgres")).toBe(true);
    expect(getCollectorReceiverTypes("postgresql")).toEqual(["postgresql"]);
    expect(hasCollectorReceiver("unknown-engine")).toBe(false);
    expect(getCollectorReceiverTypes("unknown-engine")).toEqual([]);
  });
});
