import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MetricMonitorResponse, {
  ProxmoxAffectedResource,
  VMwareAffectedResource,
  CephAffectedResource,
  KubernetesAffectedResource,
} from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import {
  getProxmoxAlertTemplateById,
  ProxmoxAlertTemplate,
} from "../../../../Types/Monitor/ProxmoxAlertTemplates";
import {
  getCephAlertTemplateById,
  CephAlertTemplate,
} from "../../../../Types/Monitor/CephAlertTemplates";
import {
  getVMwareAlertTemplateById,
  VMwareAlertTemplate,
} from "../../../../Types/Monitor/VMwareAlertTemplates";
import ObjectID from "../../../../Types/ObjectID";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import FilterCondition from "../../../../Types/Filter/FilterCondition";

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
  buildVMwareRootCauseContext: (input: {
    dataToProcess: unknown;
    monitorStep: MonitorStep;
    monitor: Monitor;
  }) => string | null;
  buildCephRootCauseContext: (input: {
    dataToProcess: unknown;
    monitorStep: MonitorStep;
    monitor: Monitor;
    criteriaInstance?: MonitorCriteriaInstance | undefined;
  }) => string | null;
  buildKubernetesRootCauseAnalysis: (input: {
    breakdown: {
      clusterName: string;
      metricName: string;
      metricFriendlyName: string;
      affectedResources: Array<KubernetesAffectedResource>;
      attributes: Record<string, string>;
    };
    topResource: KubernetesAffectedResource;
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

function vmwareStep(): MonitorStep {
  const template: VMwareAlertTemplate | undefined = getVMwareAlertTemplateById(
    "vmware-host-cpu-saturation",
  );
  if (!template) {
    throw new Error("vmware-host-cpu-saturation template missing");
  }
  return template.getMonitorStep({
    vcenterIdentifier: "vcsa-prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
  });
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
      /*
       * pve_cpu_usage_ratio is a [0, 1] ratio — the catalog says so and
       * pve-exporter reports it that way — so these are 42% and 97% of a
       * node's CPU, and the table is expected to say exactly that.
       */
      {
        resourceId: "qemu/100",
        resourceName: "web-vm",
        resourceType: "qemu",
        scope: "guest",
        nodeName: "pve1",
        metricValue: 0.42,
      },
      {
        resourceId: "qemu/101",
        resourceName: "db-vm",
        resourceType: "qemu",
        scope: "guest",
        nodeName: "pve2",
        metricValue: 0.97,
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
    // Worst (0.97) sorts above 0.42; the zero row is gone entirely.
    const dbIndex: number = context!.indexOf("`db-vm` (`qemu/101`)");
    const webIndex: number = context!.indexOf("`web-vm` (`qemu/100`)");
    expect(dbIndex).toBeGreaterThan(-1);
    expect(webIndex).toBeGreaterThan(dbIndex);
    expect(context).not.toContain("idle-vm");
    expect(context).toContain("**Affected Resources** (2 total)");

    /*
     * The Value column is rendered in the unit the catalog declares for
     * the metric — a "ratio" on a `_ratio`-suffixed metric is a fraction,
     * so the reader gets "97.00%" rather than the bare "0.97" they would
     * otherwise have to recognise as a percentage themselves.
     */
    expect(context).toContain(
      "| `db-vm` (`qemu/101`) | qemu | `pve2` | **97.00%** |",
    );
    expect(context).toContain(
      "| `web-vm` (`qemu/100`) | qemu | `pve1` | **42.00%** |",
    );
  });

  test("renders bytes in the Value column at human scale", () => {
    const context: string | null = Evaluator.buildProxmoxRootCauseContext({
      dataToProcess: metricResponse({
        proxmoxResourceBreakdown: {
          clusterName: "prod-cluster",
          metricName: "pve_memory_usage_bytes",
          metricFriendlyName: "Memory Usage",
          affectedResources: [
            {
              resourceId: "qemu/101",
              resourceName: "db-vm",
              resourceType: "qemu",
              scope: "guest",
              nodeName: "pve2",
              metricValue: 8589934592,
            },
          ],
          attributes: {},
        },
      }),
      monitorStep: proxmoxStep(),
      monitor: new Monitor(),
    });

    /*
     * The whole point of the change: an on-call engineer reading this at
     * 3am should not have to divide by 2^30 in their head.
     */
    expect(context).toContain(
      "| `db-vm` (`qemu/101`) | qemu | `pve2` | **8.59 GB** |",
    );
    expect(context).not.toContain("**8589934592**");
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

    /*
     * A `count` metric, so the rows render as bare integers and this test
     * stays about the cap. It doubles as the backward-compatibility pin
     * for the unitless path: a metric with no dimension to report must
     * still show its exact digits, never an abbreviated "1.2K".
     */
    const context: string | null = Evaluator.buildProxmoxRootCauseContext({
      dataToProcess: metricResponse({
        proxmoxResourceBreakdown: {
          clusterName: "prod-cluster",
          metricName: "pve_replication_failed_syncs",
          metricFriendlyName: "Failed Replication Syncs",
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

describe("MonitorCriteriaEvaluator - VMware root cause breakdown", () => {
  /*
   * VMware twin of the Proxmox block. The differences are deliberate:
   * identity comes from the vcenter receiver's RESOURCE attributes
   * (stored `resource.vcenter.*`), the table is
   * Resource / Kind / Host / Cluster / Value, and utilization metrics
   * are already 0–100 percentages (catalog unit "%") — never [0, 1]
   * ratios — so the Value column must print them as-is and never ×100.
   */
  test("renders the Resource/Kind/Host/Cluster/Value table: zero rows dropped, worst first, % as-is", () => {
    const affectedResources: Array<VMwareAffectedResource> = [
      {
        datacenterName: "DC1",
        clusterName: "prod-cluster",
        hostName: "esx-01",
        metricValue: 42.5,
      },
      {
        datacenterName: "DC1",
        clusterName: "prod-cluster",
        hostName: "esx-02",
        metricValue: 97.25,
      },
      // Zero-value row — must be dropped from the table.
      {
        datacenterName: "DC1",
        clusterName: "prod-cluster",
        hostName: "esx-03",
        metricValue: 0,
      },
    ];

    const context: string | null = Evaluator.buildVMwareRootCauseContext({
      dataToProcess: metricResponse({
        vmwareResourceBreakdown: {
          vcenterName: "vcsa-prod",
          metricName: "vcenter.host.cpu.utilization",
          metricFriendlyName: "Host CPU Utilization",
          affectedResources,
          attributes: {},
        },
      }),
      monitorStep: vmwareStep(),
      monitor: new Monitor(),
    });

    expect(context).not.toBeNull();
    expect(context).toContain("**vCenter Details**");
    expect(context).toContain("- vCenter: vcsa-prod");
    expect(context).toContain(
      "- Metric: Host CPU Utilization (`vcenter.host.cpu.utilization`)",
    );

    expect(context).toContain("| Resource | Kind | Host | Cluster | Value |");
    // Worst (97.25) sorts above 42.5; the zero row is gone entirely.
    const worstIndex: number = context!.indexOf("`esx-02`");
    const mildIndex: number = context!.indexOf("`esx-01`");
    expect(worstIndex).toBeGreaterThan(-1);
    expect(mildIndex).toBeGreaterThan(worstIndex);
    expect(context).not.toContain("esx-03");
    expect(context).toContain("**Affected Resources** (2 total)");

    /*
     * The catalog declares "%" for the receiver's utilization metrics,
     * whose values are already percentages: 97.25 must read "97.25%",
     * never "9725.00%". A host IS the resource, so its Host column is
     * "-" and the Cluster column carries the cluster it belongs to.
     */
    expect(context).toContain(
      "| `esx-02` | Host | - | `prod-cluster` | **97.25%** |",
    );
    expect(context).toContain(
      "| `esx-01` | Host | - | `prod-cluster` | **42.50%** |",
    );
    expect(context).not.toContain("9725");
  });

  test("a sub-1 percentage value is not mistaken for a ratio", () => {
    /*
     * 0.42 on a "%" metric is 0.42% of a host's CPU. Proxmox's
     * `_ratio` metrics would render that as 42.00%; the vcenter
     * receiver never emits ratios, so the same number must stay 0.42%.
     */
    const context: string | null = Evaluator.buildVMwareRootCauseContext({
      dataToProcess: metricResponse({
        vmwareResourceBreakdown: {
          vcenterName: "vcsa-prod",
          metricName: "vcenter.host.cpu.utilization",
          metricFriendlyName: "Host CPU Utilization",
          affectedResources: [
            { datacenterName: "DC1", hostName: "esx-01", metricValue: 0.42 },
          ],
          attributes: {},
        },
      }),
      monitorStep: vmwareStep(),
      monitor: new Monitor(),
    });

    expect(context).toContain("| `esx-01` | Host | - | - | **0.42%** |");
    expect(context).not.toContain("42.00%");
  });

  test("renders VM rows with their parent host and cluster, and bytes at human scale", () => {
    const context: string | null = Evaluator.buildVMwareRootCauseContext({
      dataToProcess: metricResponse({
        vmwareResourceBreakdown: {
          vcenterName: "vcsa-prod",
          metricName: "vcenter.vm.disk.usage",
          metricFriendlyName: "VM Disk Usage",
          affectedResources: [
            {
              datacenterName: "DC1",
              clusterName: "prod-cluster",
              hostName: "esx-02",
              vmName: "db-01",
              vmId: "5029abcd-1111-2222-3333-444455556666",
              resourcePoolName: "Resources",
              resourcePoolPath: "/DC1/host/prod-cluster/Resources",
              metricValue: 8589934592,
            },
            {
              datacenterName: "DC1",
              hostName: "esx-standalone",
              vmName: "lab-01",
              vmId: "5029abcd-aaaa-bbbb-cccc-ddddeeeeffff",
              metricValue: 1073741824,
            },
          ],
          attributes: {},
        },
      }),
      monitorStep: vmwareStep(),
      monitor: new Monitor(),
    });

    /*
     * A VM row carries a resource pool AND a host, but it is still a
     * VM: the Kind column must say so (VM check runs first), the Host
     * column is the ESXi host running it, and the on-call engineer
     * should not have to divide by 2^30 in their head.
     */
    expect(context).toContain(
      "| `db-01` | Virtual Machine | `esx-02` | `prod-cluster` | **8.59 GB** |",
    );
    // A VM on a standalone ESXi host has no cluster.
    expect(context).toContain(
      "| `lab-01` | Virtual Machine | `esx-standalone` | - | **1.07 GB** |",
    );
    expect(context).not.toContain("**8589934592**");
    expect(context).not.toContain("Resource Pool");
  });

  test("renders datastore, cluster, datacenter and resource pool rows by their own identity", () => {
    const context: string | null = Evaluator.buildVMwareRootCauseContext({
      dataToProcess: metricResponse({
        vmwareResourceBreakdown: {
          vcenterName: "vcsa-prod",
          metricName: "vcenter.datacenter.host.count",
          metricFriendlyName: "Datacenter Host Count",
          affectedResources: [
            { datacenterName: "DC1", metricValue: 4 },
            {
              datacenterName: "DC1",
              clusterName: "prod-cluster",
              metricValue: 3,
            },
            {
              datacenterName: "DC1",
              datastoreName: "vsan-ds-01",
              metricValue: 2,
            },
            {
              datacenterName: "DC1",
              clusterName: "prod-cluster",
              resourcePoolName: "batch",
              resourcePoolPath: "/DC1/host/prod-cluster/Resources/batch",
              metricValue: 1,
            },
          ],
          attributes: {},
        },
      }),
      monitorStep: vmwareStep(),
      monitor: new Monitor(),
    });

    /*
     * `{hosts}` is an annotation-only unit, so counts render as bare
     * integers. Each kind resolves by the most specific identity
     * attribute it carries: a datacenter-only row is a Datacenter, a
     * cluster row shows no duplicate Cluster cell, a pool shows its
     * name with the inventory path (pool names are only unique within
     * a parent).
     */
    expect(context).toContain("| `DC1` | Datacenter | - | - | **4** |");
    expect(context).toContain("| `prod-cluster` | Cluster | - | - | **3** |");
    expect(context).toContain("| `vsan-ds-01` | Datastore | - | - | **2** |");
    expect(context).toContain(
      "| `batch` (`/DC1/host/prod-cluster/Resources/batch`) | Resource Pool | - | `prod-cluster` | **1** |",
    );
  });

  test("renders latency in the catalog's unit", () => {
    const context: string | null = Evaluator.buildVMwareRootCauseContext({
      dataToProcess: metricResponse({
        vmwareResourceBreakdown: {
          vcenterName: "vcsa-prod",
          metricName: "vcenter.host.disk.latency.max",
          metricFriendlyName: "Host Disk Latency (Max)",
          affectedResources: [
            { datacenterName: "DC1", hostName: "esx-01", metricValue: 85 },
          ],
          attributes: {},
        },
      }),
      monitorStep: vmwareStep(),
      monitor: new Monitor(),
    });

    // Unit from the catalog ("ms"), not a bare, unit-less 85.
    expect(context).toMatch(
      /\| `esx-01` \| Host \| - \| - \| \*\*85(\.00)? ms\*\* \|/,
    );
  });

  test("caps the table at 10 rows, worst first, with an overflow suffix", () => {
    const affectedResources: Array<VMwareAffectedResource> = [];
    for (let i: number = 1; i <= 12; i++) {
      affectedResources.push({
        datacenterName: "DC1",
        hostName: `esx-${String(i).padStart(2, "0")}`,
        metricValue: i,
      });
    }

    const context: string | null = Evaluator.buildVMwareRootCauseContext({
      dataToProcess: metricResponse({
        vmwareResourceBreakdown: {
          vcenterName: "vcsa-prod",
          metricName: "vcenter.host.network.packet.error.rate",
          metricFriendlyName: "Host Network Packet Error Rate",
          affectedResources,
          attributes: {},
        },
      }),
      monitorStep: vmwareStep(),
      monitor: new Monitor(),
    });

    expect(context).toContain("**Affected Resources** (12 total)");
    expect(context).toContain("*... and 2 more affected resources*");
    // The worst rows survive the cap; the mildest two are cut.
    expect(context).toContain("`esx-12`");
    expect(context).toContain("`esx-03`");
    expect(context).not.toContain("`esx-02`");
    expect(context).not.toContain("`esx-01`");
  });

  test("identity-less breakdowns render no table and fall back to the metric summary", () => {
    const context: string | null = Evaluator.buildVMwareRootCauseContext({
      dataToProcess: metricResponse({
        vmwareResourceBreakdown: {
          vcenterName: "vcsa-prod",
          metricName: "vcenter.datacenter.vm.count",
          metricFriendlyName: "Datacenter VM Count",
          affectedResources: [
            // A value but NO identity attributes.
            { metricValue: 3 },
          ],
          attributes: {},
        },
        metricResult: [{ data: [{}, {}] } as any],
      }),
      monitorStep: vmwareStep(),
      monitor: new Monitor(),
    });

    expect(context).not.toContain(
      "| Resource | Kind | Host | Cluster | Value |",
    );
    expect(context).toContain("**Metric Summary**");
    expect(context).toContain("- 2 metric data point(s) returned");
  });

  test("surfaces the worker's resource-filter mapping (resource.vcenter.*) in the vCenter context", () => {
    const step: MonitorStep = vmwareStep();
    /*
     * The worker maps resourceFilters to `resource.vcenter.*` equality
     * attributes; the evaluator surfaces the same filters so the
     * incident shows WHAT was scoped.
     */
    step.data!.vmwareMonitor!.resourceFilters = {
      datacenterName: "DC1",
      clusterName: "prod-cluster",
      hostName: "esx-01",
      vmName: "db-01",
      datastoreName: "vsan-ds-01",
      resourcePoolPath: "/DC1/host/prod-cluster/Resources/batch",
    };

    const context: string | null = Evaluator.buildVMwareRootCauseContext({
      dataToProcess: metricResponse(),
      monitorStep: step,
      monitor: new Monitor(),
    });

    expect(context).toContain("**vCenter Details**");
    expect(context).toContain("- vCenter: vcsa-prod");
    expect(context).toContain("- Datacenter Filter: DC1");
    expect(context).toContain("- Cluster Filter: prod-cluster");
    expect(context).toContain("- Host Filter: esx-01");
    expect(context).toContain("- Virtual Machine Filter: db-01");
    expect(context).toContain("- Datastore Filter: vsan-ds-01");
    expect(context).toContain(
      "- Resource Pool Filter: /DC1/host/prod-cluster/Resources/batch",
    );
    // No breakdown attached: the metric name comes from the step's query.
    expect(context).toContain("- Metric: `vcenter.host.cpu.utilization`");
    // Nothing Proxmox leaks into a VMware root cause.
    expect(context).not.toContain("Proxmox");
    expect(context).not.toContain("Scope Filter");
  });

  test("returns null when there is neither a step config nor a breakdown", () => {
    const context: string | null = Evaluator.buildVMwareRootCauseContext({
      dataToProcess: metricResponse(),
      monitorStep: new MonitorStep(),
      monitor: new Monitor(),
    });

    expect(context).toBeNull();
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
    /*
     * ceph_osd_apply_latency_ms carries the catalog unit "ms", so the
     * Value column names it. 250 ms stays "250 ms" rather than scaling to
     * seconds — the ladder only moves a value when the magnitude asks
     * for it.
     */
    expect(context).toContain("| `osd.3` | - | `ceph-node-1` | **250 ms** |");
    expect(context).toContain("| - | `rbd` (`2`) | - | **91 ms** |");
    expect(context).not.toContain("osd.5");
    expect(context).toContain("**Affected Resources** (2 total)");

    // Worst-first ordering: the 250 row precedes the 91 row.
    const osdIndex: number = context!.indexOf("`osd.3`");
    const poolIndex: number = context!.indexOf("`rbd` (`2`)");
    expect(osdIndex).toBeGreaterThan(-1);
    expect(poolIndex).toBeGreaterThan(osdIndex);
  });

  /*
   * BACKWARD COMPATIBILITY for the platform tables.
   *
   * A metric whose catalog unit is "count" or absent has no dimension to
   * report, and its Value column must keep every digit — never a chart's
   * abbreviated "1.2K", and never the noise "250 count". ceph_osd_up is
   * `unit: "count"`; ceph_health_status has no unit at all.
   */
  test("a count metric keeps exact bare digits in the Value column", () => {
    const context: string | null = Evaluator.buildCephRootCauseContext({
      dataToProcess: metricResponse({
        cephResourceBreakdown: {
          clusterName: "prod-cluster",
          metricName: "ceph_osd_up",
          metricFriendlyName: "OSD Up",
          affectedResources: [
            { daemon: "osd.3", hostname: "ceph-node-1", metricValue: 5000 },
          ],
          attributes: {},
        },
      }),
      monitorStep: cephStep(),
      monitor: new Monitor(),
    });

    expect(context).toContain("| `osd.3` | - | `ceph-node-1` | **5000** |");
    expect(context).not.toContain("5K");
    expect(context).not.toContain("count");
  });

  /*
   * ORDERING INVARIANT. The table sorts and filters on the RAW numeric
   * metricValue and only formats at render time. If a refactor ever sorted
   * the formatted strings instead, "1.07 GB" would sort below "900 KB" and
   * the worst-first table would silently invert — putting the healthiest
   * daemon at the top of an incident.
   */
  test("rows still sort worst-first on the raw value, not the formatted string", () => {
    const context: string | null = Evaluator.buildCephRootCauseContext({
      dataToProcess: metricResponse({
        cephResourceBreakdown: {
          clusterName: "prod-cluster",
          metricName: "ceph_pool_rd_bytes",
          metricFriendlyName: "Pool Read Throughput",
          affectedResources: [
            { daemon: "osd.smaller", metricValue: 921600 },
            { daemon: "osd.bigger", metricValue: 1073741824 },
          ],
          attributes: {},
        },
      }),
      monitorStep: cephStep(),
      monitor: new Monitor(),
    });

    expect(context).toContain("| `osd.bigger` | - | - | **1.07 GB** |");
    expect(context).toContain("| `osd.smaller` | - | - | **922 KB** |");

    // "1.07 GB" < "922 KB" as strings — the raw numbers must drive this.
    const biggerIndex: number = context!.indexOf("`osd.bigger`");
    const smallerIndex: number = context!.indexOf("`osd.smaller`");
    expect(biggerIndex).toBeGreaterThan(-1);
    expect(smallerIndex).toBeGreaterThan(biggerIndex);
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

/*
 * REGRESSION: the affected-resources filter used to be a hardcoded
 * `metricValue > 0`.
 *
 * ceph_osd_up / ceph_osd_in / ceph_mon_quorum_status are 0/1 gauges and
 * the OSD Down / OSD Out / Quorum Degraded criteria fire on `< 1`, so the
 * ZERO rows are the down daemons — the filter dropped exactly the daemons
 * the incident was about and rendered a table of the HEALTHY ones, under
 * an incident description that ends "Check the root cause for the affected
 * ceph_daemon label."
 *
 * The predicate now mirrors the criteria that matched, but ONLY inverts
 * for a criteria that fires when the metric FALLS. Every upward comparison
 * (`> 0` health checks, PG counts, latency, capacity ratios) and every
 * `= 0` RECOVERY criteria keeps the old `> 0`, worst-highest-first table
 * byte for byte — the recovery case matters because deriving the predicate
 * from an `= 0` criteria would newly render an "Affected Resources" table
 * of every resource sitting at 0 on the all-clear.
 */
describe("MonitorCriteriaEvaluator - Ceph affected-resources breach predicate", () => {
  function cephCriteriaInstance(index: number): MonitorCriteriaInstance {
    const instances: Array<MonitorCriteriaInstance> =
      cephStep().data!.monitorCriteria!.data!.monitorCriteriaInstanceArray;
    const instance: MonitorCriteriaInstance | undefined = instances[index];
    if (!instance) {
      throw new Error(`ceph-osd-down criteria instance ${index} missing`);
    }
    return instance;
  }

  /** The real ceph-osd-down FIRING criteria: ceph_osd_up < 1. */
  function osdDownFiringCriteria(): MonitorCriteriaInstance {
    return cephCriteriaInstance(0);
  }

  /** The real ceph-osd-down RECOVERY criteria (an upward comparison). */
  function osdDownRecoveryCriteria(): MonitorCriteriaInstance {
    const instances: Array<MonitorCriteriaInstance> =
      cephStep().data!.monitorCriteria!.data!.monitorCriteriaInstanceArray;
    return cephCriteriaInstance(instances.length - 1);
  }

  function syntheticCriteria(
    filters: Array<CriteriaFilter>,
  ): MonitorCriteriaInstance {
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    instance.data = {
      monitorStatusId: undefined,
      filterCondition: FilterCondition.Any,
      filters: filters,
      incidents: [],
      alerts: [],
      name: "synthetic",
      description: "synthetic",
      id: ObjectID.generate().toString(),
    };
    return instance;
  }

  function cephContext(input: {
    affectedResources: Array<CephAffectedResource>;
    metricName?: string;
    criteriaInstance?: MonitorCriteriaInstance | undefined;
  }): string | null {
    return Evaluator.buildCephRootCauseContext({
      dataToProcess: metricResponse({
        cephResourceBreakdown: {
          clusterName: "prod-cluster",
          metricName: input.metricName || "ceph_osd_up",
          metricFriendlyName: "OSD Up",
          affectedResources: input.affectedResources,
          attributes: {},
        },
      }),
      monitorStep: cephStep(),
      monitor: new Monitor(),
      criteriaInstance: input.criteriaInstance,
    });
  }

  test("the real ceph-osd-down criteria is a `< 1` comparison on the metric value", () => {
    /*
     * Guards the fixture: if the template stops firing on a fall, the
     * rest of this suite is testing nothing.
     */
    const filters: Array<CriteriaFilter> =
      osdDownFiringCriteria().data?.filters || [];

    expect(filters.length).toBeGreaterThan(0);
    expect(filters[0]!.checkOn).toBe(CheckOn.MetricValue);
    expect(filters[0]!.filterType).toBe(FilterType.LessThan);
    expect(filters[0]!.value).toBe(1);
  });

  test("a `< 1` availability criteria keeps the DOWN daemons and drops the healthy ones", () => {
    const context: string | null = cephContext({
      criteriaInstance: osdDownFiringCriteria(),
      affectedResources: [
        // The down OSD. The old `> 0` filter removed exactly this row.
        { daemon: "osd.3", hostname: "ceph-node-1", metricValue: 0 },
        { daemon: "osd.4", hostname: "ceph-node-2", metricValue: 1 },
        { daemon: "osd.5", hostname: "ceph-node-3", metricValue: 1 },
      ],
    });

    expect(context).toContain("| Daemon | Pool | Host | Value |");
    expect(context).toContain("| `osd.3` | - | `ceph-node-1` | **0** |");
    expect(context).not.toContain("osd.4");
    expect(context).not.toContain("osd.5");
    expect(context).toContain("**Affected Resources** (1 total)");
  });

  test("every down daemon survives the top-10 cap when the criteria fires on a fall", () => {
    const affectedResources: Array<CephAffectedResource> = [
      { daemon: "osd.1", metricValue: 0 },
      { daemon: "osd.2", metricValue: 0 },
    ];

    /*
     * Twelve healthy OSDs — enough to overflow the ten-row slice if the
     * predicate ever stops filtering them out.
     */
    for (let i: number = 10; i < 22; i++) {
      affectedResources.push({ daemon: `osd.${i}`, metricValue: 1 });
    }

    const context: string | null = cephContext({
      criteriaInstance: osdDownFiringCriteria(),
      affectedResources,
    });

    expect(context).toContain("**Affected Resources** (2 total)");
    expect(context).toContain("`osd.1`");
    expect(context).toContain("`osd.2`");
    expect(context).not.toContain("`osd.10`");
    expect(context).not.toContain("*... and");
  });

  test("a fall criteria sorts worst (lowest) first", () => {
    const context: string | null = cephContext({
      metricName: "ceph_osd_apply_latency_ms",
      criteriaInstance: syntheticCriteria([
        {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.LessThanOrEqualTo,
          value: 50,
        },
      ]),
      affectedResources: [
        { daemon: "osd.mild", metricValue: 50 },
        { daemon: "osd.worst", metricValue: 5 },
        { daemon: "osd.fine", metricValue: 500 },
      ],
    });

    expect(context).toContain("**Affected Resources** (2 total)");
    expect(context).not.toContain("osd.fine");

    const worstIndex: number = context!.indexOf("`osd.worst`");
    const mildIndex: number = context!.indexOf("`osd.mild`");
    expect(worstIndex).toBeGreaterThan(-1);
    expect(mildIndex).toBeGreaterThan(worstIndex);
  });

  test("a `> 0` count criteria renders exactly as the hardcoded filter did", () => {
    const context: string | null = cephContext({
      metricName: "ceph_osd_apply_latency_ms",
      criteriaInstance: syntheticCriteria([
        {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.GreaterThan,
          value: 0,
        },
      ]),
      affectedResources: [
        { daemon: "osd.3", hostname: "ceph-node-1", metricValue: 250 },
        { poolId: "2", poolName: "rbd", metricValue: 91 },
        { daemon: "osd.5", hostname: "ceph-node-2", metricValue: 0 },
      ],
    });

    expect(context).toContain("| `osd.3` | - | `ceph-node-1` | **250 ms** |");
    expect(context).toContain("| - | `rbd` (`2`) | - | **91 ms** |");
    expect(context).not.toContain("osd.5");
    expect(context).toContain("**Affected Resources** (2 total)");

    // Still worst-HIGHEST-first for an upward comparison.
    const osdIndex: number = context!.indexOf("`osd.3`");
    const poolIndex: number = context!.indexOf("`rbd` (`2`)");
    expect(poolIndex).toBeGreaterThan(osdIndex);
  });

  test("an `= 0` recovery criteria does NOT turn the all-clear into a table of zeroes", () => {
    const context: string | null = cephContext({
      metricName: "ceph_pg_degraded",
      criteriaInstance: syntheticCriteria([
        {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.EqualTo,
          value: 0,
        },
      ]),
      affectedResources: [
        { poolId: "2", poolName: "rbd", metricValue: 0 },
        { poolId: "3", poolName: "cephfs", metricValue: 0 },
      ],
    });

    expect(context).not.toContain("| Daemon | Pool | Host | Value |");
    expect(context).not.toContain("**Affected Resources**");
  });

  test("the real recovery criteria (an upward comparison) keeps the `> 0` fallback", () => {
    const context: string | null = cephContext({
      criteriaInstance: osdDownRecoveryCriteria(),
      affectedResources: [
        { daemon: "osd.3", metricValue: 0 },
        { daemon: "osd.4", metricValue: 1 },
      ],
    });

    expect(context).toContain("| `osd.4` | - | - | **1** |");
    expect(context).not.toContain("osd.3");
  });

  test("no criteriaInstance falls back to dropping zero rows", () => {
    const context: string | null = cephContext({
      affectedResources: [
        { daemon: "osd.3", metricValue: 0 },
        { daemon: "osd.4", metricValue: 1 },
      ],
    });

    expect(context).toContain("| `osd.4` | - | - | **1** |");
    expect(context).not.toContain("osd.3");
  });

  test("a non-metric-value filter is ignored and keeps the `> 0` fallback", () => {
    const context: string | null = cephContext({
      criteriaInstance: syntheticCriteria([
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.LessThan,
          value: 1,
        },
      ]),
      affectedResources: [
        { daemon: "osd.3", metricValue: 0 },
        { daemon: "osd.4", metricValue: 1 },
      ],
    });

    expect(context).toContain("| `osd.4` | - | - | **1** |");
    expect(context).not.toContain("osd.3");
  });

  test("a mixed fall/rise criteria keeps the `> 0` fallback rather than guessing", () => {
    const context: string | null = cephContext({
      criteriaInstance: syntheticCriteria([
        {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.LessThan,
          value: 1,
        },
        {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.GreaterThan,
          value: 90,
        },
      ]),
      affectedResources: [
        { daemon: "osd.3", metricValue: 0 },
        { daemon: "osd.4", metricValue: 1 },
      ],
    });

    expect(context).toContain("| `osd.4` | - | - | **1** |");
    expect(context).not.toContain("osd.3");
  });
});

/*
 * REGRESSION: buildKubernetesRootCauseAnalysis routed POD-scoped metrics
 * into the NODE branches.
 *
 * The CPU branch matched any name containing both "cpu" and
 * "utilization", so `k8s.pod.cpu.utilization` and
 * `k8s.pod.cpu_limit_utilization` were answered with "Node CPU
 * utilization has exceeded the configured threshold" plus
 * "consider scaling the cluster" — contradicting the pod-limit template's
 * own description and naming a node for a pod-scoped alert. The memory
 * branch did the same for "memory" + "usage".
 *
 * Also: the pod-Pending branch was gated on
 * `breakdown.attributes["k8s.pod.phase"] === "Pending"`, an UNPREFIXED key
 * for an attribute nothing in the agent emits (the phase is the metric's
 * VALUE), so the branch never ran at all.
 */
describe("MonitorCriteriaEvaluator - Kubernetes root cause analysis scoping", () => {
  const NODE_CPU_TEXT: string =
    "Node CPU utilization has exceeded the configured threshold.";
  const NODE_MEMORY_TEXT: string =
    "Node memory utilization has exceeded the configured threshold.";

  function analyse(input: {
    metricName: string;
    attributes?: Record<string, string>;
    topResource?: KubernetesAffectedResource;
  }): string | null {
    const topResource: KubernetesAffectedResource = input.topResource || {
      podName: "web-7d9f",
      nodeName: "node-1",
      metricValue: 93.4,
    };

    return Evaluator.buildKubernetesRootCauseAnalysis({
      breakdown: {
        clusterName: "prod",
        metricName: input.metricName,
        metricFriendlyName: "Friendly Name",
        affectedResources: [topResource],
        attributes: input.attributes || {},
      },
      topResource,
    });
  }

  test("k8s.node.cpu.utilization still gets the node CPU guidance", () => {
    const analysis: string | null = analyse({
      metricName: "k8s.node.cpu.utilization",
    });

    expect(analysis).toContain(NODE_CPU_TEXT);
    expect(analysis).toContain("consider scaling the cluster");
  });

  test("a non-canonical node cpu utilization metric still gets the node branch", () => {
    const analysis: string | null = analyse({
      metricName: "k8s.node.cpu_limit_utilization",
    });

    expect(analysis).toContain(NODE_CPU_TEXT);
  });

  test("k8s.pod.cpu.utilization is NOT answered with node CPU advice", () => {
    const analysis: string | null = analyse({
      metricName: "k8s.pod.cpu.utilization",
    });

    expect(analysis).not.toContain(NODE_CPU_TEXT);
    expect(analysis).not.toContain("consider scaling the cluster");
    expect(analysis).toContain("`k8s.pod.cpu.utilization`");
    expect(analysis).toContain("Most affected pod: `web-7d9f`");
  });

  test("k8s.pod.cpu_limit_utilization is NOT answered with node CPU advice", () => {
    const analysis: string | null = analyse({
      metricName: "k8s.pod.cpu_limit_utilization",
    });

    expect(analysis).not.toContain(NODE_CPU_TEXT);
    expect(analysis).toContain("`k8s.pod.cpu_limit_utilization`");
  });

  test("k8s.node.memory.usage still gets the node memory guidance", () => {
    const analysis: string | null = analyse({
      metricName: "k8s.node.memory.usage",
    });

    expect(analysis).toContain(NODE_MEMORY_TEXT);
  });

  test("k8s.pod.memory_limit_utilization is NOT answered with node memory advice", () => {
    const analysis: string | null = analyse({
      metricName: "k8s.pod.memory_limit_utilization",
    });

    expect(analysis).not.toContain(NODE_MEMORY_TEXT);
    expect(analysis).toContain("`k8s.pod.memory_limit_utilization`");
  });

  test("k8s.pod.memory.usage is NOT answered with node memory advice", () => {
    const analysis: string | null = analyse({
      metricName: "k8s.pod.memory.usage",
    });

    expect(analysis).not.toContain(NODE_MEMORY_TEXT);
    expect(analysis).toContain("`k8s.pod.memory.usage`");
  });

  test("k8s.pod.phase gets the Pending guidance with an EMPTY attribute map", () => {
    /*
     * The old gate required breakdown.attributes["k8s.pod.phase"] to be
     * "Pending". Nothing ever sets it — the breakdown attributes are the
     * query's `resource.`-prefixed map — so this assertion fails on the
     * pre-fix code.
     */
    const analysis: string | null = analyse({
      metricName: "k8s.pod.phase",
      attributes: {},
    });

    expect(analysis).toContain(
      "Pods are stuck in Pending phase and unable to be scheduled.",
    );
    expect(analysis).toContain("kubectl describe pod web-7d9f");
  });

  test("k8s.pod.phase is not swallowed by a resource-prefixed attribute map", () => {
    const analysis: string | null = analyse({
      metricName: "k8s.pod.phase",
      attributes: { "resource.k8s.cluster.name": "prod" },
    });

    expect(analysis).toContain("Pods are stuck in Pending phase");
  });

  /*
   * REGRESSION: three of these sentences hardcoded a "%" suffix onto
   * metrics that are not percentages.
   *
   * k8s.node.memory.usage and k8s.node.filesystem.usage are BYTES, so a
   * node holding 8 GiB was reported as "memory usage is at
   * 8589934592.0%". k8s.node.cpu.utilization is the kubeletstats CORES
   * gauge that four other places in this repo warn is misnamed, so 1.4
   * cores in use read as "1.4% CPU utilization" — a number an on-call
   * engineer would read as "the node is idle".
   *
   * Each sentence now takes its unit from the catalog, which is the same
   * lookup the worker already ran to resolve metricFriendlyName.
   */
  describe("unit rendering in the analysis sentences", () => {
    test("node CPU reports cores, not a percentage", () => {
      const analysis: string | null = analyse({
        metricName: "k8s.node.cpu.utilization",
        topResource: { nodeName: "node-1", metricValue: 1.4 },
      });

      expect(analysis).toContain(
        "Node `node-1` is at **1.4 cores** CPU utilization.",
      );
      expect(analysis).not.toContain("1.4%");
    });

    test("node memory reports bytes at human scale, not a percentage", () => {
      const analysis: string | null = analyse({
        metricName: "k8s.node.memory.usage",
        topResource: { nodeName: "node-1", metricValue: 8589934592 },
      });

      expect(analysis).toContain(
        "Node `node-1` memory usage is at **8.59 GB**.",
      );
      expect(analysis).not.toContain("8589934592");
      expect(analysis).not.toContain("%");
    });

    test("node filesystem reports bytes at human scale, not a percentage", () => {
      const analysis: string | null = analyse({
        metricName: "k8s.node.filesystem.usage",
        topResource: { nodeName: "node-1", metricValue: 1099511627776 },
      });

      expect(analysis).toContain(
        "Node `node-1` filesystem usage is at **1.1 TB**.",
      );
      expect(analysis).not.toContain("%");
    });

    /*
     * Counts keep every digit — and stop reporting the raw float an
     * aggregation hands back, which used to produce "has restarted
     * **2.3333333333333335** times".
     */
    test("restart counts are rounded and carry no unit", () => {
      const analysis: string | null = analyse({
        metricName: "k8s.container.restarts",
        topResource: {
          podName: "web-7d9f",
          containerName: "web",
          metricValue: 2.3333333333333335,
        },
      });

      expect(analysis).toContain("has restarted **2.33** times.");
      expect(analysis).not.toContain("2.3333333333333335");
      expect(analysis).not.toContain("2.33 count");
    });

    test("unavailable replicas stay a bare count", () => {
      const analysis: string | null = analyse({
        metricName: "k8s.deployment.unavailable_replicas",
        topResource: {
          workloadType: "Deployment",
          workloadName: "web",
          metricValue: 3,
        },
      });

      expect(analysis).toContain(
        "Deployment `web` has **3** unavailable replica(s).",
      );
    });
  });
});
