import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MetricMonitorResponse, {
  ProxmoxAffectedResource,
  CephAffectedResource,
} from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import {
  getProxmoxAlertTemplateById,
  ProxmoxAlertTemplate,
} from "../../../../Types/Monitor/ProxmoxAlertTemplates";
import {
  getCephAlertTemplateById,
  CephAlertTemplate,
} from "../../../../Types/Monitor/CephAlertTemplates";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WI-21 monitor-routing seam: the worker-side monitorProxmox /
 * monitorCeph functions (App/FeatureSet/Workers) attach a
 * proxmoxResourceBreakdown / cephResourceBreakdown to the
 * MetricMonitorResponse; MonitorCriteriaEvaluator renders that into
 * the incident root-cause context. These tests drive the evaluator's
 * Proxmox/Ceph branches directly and lock in the render contract:
 *
 *   - Proxmox table is Resource / Type / Node / Value; Ceph table is
 *     Daemon / Pool / Host / Value,
 *   - zero-value rows are dropped (supplementary context — the
 *     per-series criteria still alert on them), worst value first,
 *     top 10 with an "... and N more" suffix,
 *   - identity-less (cluster-wide) breakdowns render NO table and fall
 *     back to the metric summary,
 *   - the cluster context lines surface the monitor step's
 *     clusterIdentifier and resource filters (the pve.scope / pve.id /
 *     ceph_daemon / pool_id equality filters the worker maps to).
 *
 * The monitor steps come from the REAL alert templates so this also
 * covers the template → evaluator hand-off shape end to end.
 */

type EvaluatorPrivate = {
  buildProxmoxRootCauseContext: (input: {
    dataToProcess: unknown;
    monitorStep: MonitorStep;
    monitor: Monitor;
  }) => string | null;
  buildCephRootCauseContext: (input: {
    dataToProcess: unknown;
    monitorStep: MonitorStep;
    monitor: Monitor;
  }) => string | null;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

function templateArgs(): any {
  return {
    clusterIdentifier: "prod-cluster",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
  };
}

function proxmoxStep(): MonitorStep {
  const template: ProxmoxAlertTemplate | undefined =
    getProxmoxAlertTemplateById("pve-node-offline");
  if (!template) {
    throw new Error("pve-node-offline template missing");
  }
  return template.getMonitorStep(templateArgs());
}

function cephStep(): MonitorStep {
  const template: CephAlertTemplate | undefined =
    getCephAlertTemplateById("ceph-osd-down");
  if (!template) {
    throw new Error("ceph-osd-down template missing");
  }
  return template.getMonitorStep(templateArgs());
}

function metricResponse(
  overrides: Partial<MetricMonitorResponse> = {},
): MetricMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult: [],
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    ...overrides,
  };
}

describe("MonitorCriteriaEvaluator - Proxmox root cause breakdown", () => {
  test("renders the Resource/Type/Node/Value table: zero rows dropped, worst first", () => {
    const affectedResources: Array<ProxmoxAffectedResource> = [
      {
        resourceId: "qemu/100",
        resourceName: "web-vm",
        resourceType: "qemu",
        scope: "guest",
        nodeName: "pve1",
        metricValue: 42,
      },
      {
        resourceId: "qemu/101",
        resourceName: "db-vm",
        resourceType: "qemu",
        scope: "guest",
        nodeName: "pve2",
        metricValue: 97,
      },
      // Zero-value row — must be dropped from the table.
      {
        resourceId: "qemu/102",
        resourceName: "idle-vm",
        resourceType: "qemu",
        scope: "guest",
        nodeName: "pve1",
        metricValue: 0,
      },
    ];

    const context: string | null = Evaluator.buildProxmoxRootCauseContext({
      dataToProcess: metricResponse({
        proxmoxResourceBreakdown: {
          clusterName: "prod-cluster",
          metricName: "pve_cpu_usage_ratio",
          metricFriendlyName: "CPU Usage",
          affectedResources,
          attributes: {},
        },
      }),
      monitorStep: proxmoxStep(),
      monitor: new Monitor(),
    });

    expect(context).not.toBeNull();
    expect(context).toContain("**Proxmox Cluster Details**");
    expect(context).toContain("- Cluster: prod-cluster");
    expect(context).toContain("- Metric: CPU Usage (`pve_cpu_usage_ratio`)");

    expect(context).toContain("| Resource | Type | Node | Value |");
    // Worst (97) sorts above 42; the zero row is gone entirely.
    const dbIndex: number = context!.indexOf("`db-vm` (`qemu/101`)");
    const webIndex: number = context!.indexOf("`web-vm` (`qemu/100`)");
    expect(dbIndex).toBeGreaterThan(-1);
    expect(webIndex).toBeGreaterThan(dbIndex);
    expect(context).not.toContain("idle-vm");
    expect(context).toContain("**Affected Resources** (2 total)");
    expect(context).toContain(
      "| `db-vm` (`qemu/101`) | qemu | `pve2` | **97** |",
    );
  });

  test("caps the table at 10 rows, worst first, with an overflow suffix", () => {
    const affectedResources: Array<ProxmoxAffectedResource> = [];
    for (let i: number = 1; i <= 12; i++) {
      affectedResources.push({
        resourceId: `qemu/${100 + i}`,
        resourceType: "qemu",
        scope: "guest",
        metricValue: i,
      });
    }

    const context: string | null = Evaluator.buildProxmoxRootCauseContext({
      dataToProcess: metricResponse({
        proxmoxResourceBreakdown: {
          clusterName: "prod-cluster",
          metricName: "pve_cpu_usage_ratio",
          metricFriendlyName: "CPU Usage",
          affectedResources,
          attributes: {},
        },
      }),
      monitorStep: proxmoxStep(),
      monitor: new Monitor(),
    });

    expect(context).toContain("**Affected Resources** (12 total)");
    expect(context).toContain("*... and 2 more affected resources*");
    // The worst rows survive the cap; the mildest two are cut.
    expect(context).toContain("**12**");
    expect(context).toContain("**3**");
    expect(context).not.toContain("| `qemu/102` | qemu | - | **2** |");
    expect(context).not.toContain("| `qemu/101` | qemu | - | **1** |");
  });

  test("identity-less (cluster-wide) breakdowns render no table and fall back to the metric summary", () => {
    const context: string | null = Evaluator.buildProxmoxRootCauseContext({
      dataToProcess: metricResponse({
        proxmoxResourceBreakdown: {
          clusterName: "prod-cluster",
          metricName: "pve_not_backed_up_total",
          metricFriendlyName: "Guests Without Backup",
          affectedResources: [
            // WI-24 cluster gauge: a value but NO identity labels.
            { metricValue: 3 },
          ],
          attributes: {},
        },
        metricResult: [{ data: [{}, {}] } as any],
      }),
      monitorStep: proxmoxStep(),
      monitor: new Monitor(),
    });

    expect(context).not.toContain("| Resource | Type | Node | Value |");
    expect(context).toContain("**Metric Summary**");
    expect(context).toContain("- 2 metric data point(s) returned");
  });

  test("surfaces the worker's resource-filter mapping (pve.scope / pve.id) in the cluster context", () => {
    const step: MonitorStep = proxmoxStep();
    /*
     * The worker maps resourceFilters to pve.scope / pve.id equality
     * attributes; the evaluator surfaces the same filters so the
     * incident shows WHAT was scoped.
     */
    step.data!.proxmoxMonitor!.resourceFilters = {
      scope: "guest" as any,
      pveId: "100",
    };

    const context: string | null = Evaluator.buildProxmoxRootCauseContext({
      dataToProcess: metricResponse(),
      monitorStep: step,
      monitor: new Monitor(),
    });

    expect(context).toContain("- Cluster: prod-cluster");
    expect(context).toContain("- Scope Filter: guest");
    expect(context).toContain("- Resource ID Filter: 100");
    // No breakdown attached: the metric name comes from the step's query.
    expect(context).toContain("- Metric: `pve_up`");
  });
});

describe("MonitorCriteriaEvaluator - Ceph root cause breakdown", () => {
  test("renders the Daemon/Pool/Host/Value table with pool name+id cells", () => {
    const affectedResources: Array<CephAffectedResource> = [
      { daemon: "osd.3", hostname: "ceph-node-1", metricValue: 250 },
      { poolId: "2", poolName: "rbd", metricValue: 91 },
      // Zero row dropped.
      { daemon: "osd.5", hostname: "ceph-node-2", metricValue: 0 },
    ];

    const context: string | null = Evaluator.buildCephRootCauseContext({
      dataToProcess: metricResponse({
        cephResourceBreakdown: {
          clusterName: "prod-cluster",
          metricName: "ceph_osd_apply_latency_ms",
          metricFriendlyName: "OSD Apply Latency",
          affectedResources,
          attributes: {},
        },
      }),
      monitorStep: cephStep(),
      monitor: new Monitor(),
    });

    expect(context).toContain("**Ceph Cluster Details**");
    expect(context).toContain("- Cluster: prod-cluster");
    expect(context).toContain(
      "- Metric: OSD Apply Latency (`ceph_osd_apply_latency_ms`)",
    );

    expect(context).toContain("| Daemon | Pool | Host | Value |");
    expect(context).toContain("| `osd.3` | - | `ceph-node-1` | **250** |");
    expect(context).toContain("| - | `rbd` (`2`) | - | **91** |");
    expect(context).not.toContain("osd.5");
    expect(context).toContain("**Affected Resources** (2 total)");

    // Worst-first ordering: the 250 row precedes the 91 row.
    const osdIndex: number = context!.indexOf("`osd.3`");
    const poolIndex: number = context!.indexOf("`rbd` (`2`)");
    expect(osdIndex).toBeGreaterThan(-1);
    expect(poolIndex).toBeGreaterThan(osdIndex);
  });

  test("cluster-wide series (ceph_health_status) render no table", () => {
    const context: string | null = Evaluator.buildCephRootCauseContext({
      dataToProcess: metricResponse({
        cephResourceBreakdown: {
          clusterName: "prod-cluster",
          metricName: "ceph_health_status",
          metricFriendlyName: "Cluster Health",
          affectedResources: [{ metricValue: 2 }],
          attributes: {},
        },
      }),
      monitorStep: cephStep(),
      monitor: new Monitor(),
    });

    expect(context).toContain("- Cluster: prod-cluster");
    expect(context).not.toContain("| Daemon | Pool | Host | Value |");
  });

  test("surfaces the worker's resource-filter mapping (ceph_daemon / pool_id) in the cluster context", () => {
    const step: MonitorStep = cephStep();
    step.data!.cephMonitor!.resourceFilters = {
      osdId: "osd.3",
      poolId: "2",
    };

    const context: string | null = Evaluator.buildCephRootCauseContext({
      dataToProcess: metricResponse(),
      monitorStep: step,
      monitor: new Monitor(),
    });

    expect(context).toContain("- OSD Filter: osd.3");
    expect(context).toContain("- Pool ID Filter: 2");
    expect(context).toContain("- Metric: `ceph_osd_up`");
  });
});
