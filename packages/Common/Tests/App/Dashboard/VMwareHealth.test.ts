import { describe, expect, test } from "@jest/globals";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import { VMwareResourceKind } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../Types/ObjectID";
import {
  VMWARE_HOST_NOT_RESPONDING_TEMPLATE_ID,
  VMwareAlertTemplate,
  getVMwareAlertTemplateById,
} from "../../../Types/Monitor/VMwareAlertTemplates";
import {
  VMWARE_ATTENTION_KIND_ORDER,
  VMWARE_CPU_READY_WARNING_PERCENT,
  VMWARE_DATASTORE_CRITICAL_PERCENT,
  VMWARE_DATASTORE_WARNING_PERCENT,
  VMWARE_HOST_SATURATION_PERCENT,
  VMWARE_READINGS_STALE_MS,
  VMwareAssessment,
  VMwareClusterHeadroom,
  VMwareDatacenterFinding,
  VMwareHostState,
  assessVMwareCluster,
  assessVMwareClusterWithHosts,
  assessVMwareDatastore,
  assessVMwareHost,
  assessVMwareResourcePool,
  assessVMwareVirtualMachine,
  findVMwareDatacenter,
  findVMwareHostOfVirtualMachine,
  formatVMwareReasonBytes,
  formatVMwareReasonPercent,
  getVMwareAttentionItems,
  getVMwareAttentionKey,
  getVMwareClusterHeadroom,
  getVMwareClusterName,
  getVMwareClusterStatus,
  getVMwareClusterUnexplainedNotEffective,
  getVMwareDatacenterFindings,
  getVMwareDatastorePercent,
  getVMwareDatastoreStatus,
  getVMwareDisplayName,
  getVMwareHealth,
  getVMwareHostName,
  getVMwareHostState,
  getVMwareHostStatus,
  getVMwareHostsOfCluster,
  getVMwareKindIcon,
  getVMwareVirtualMachineStatus,
  hasFreshVMwareReadings,
  isVMwareHostRunning,
  isVMwareIssueAbout,
  isVMwareVirtualMachineDisconnected,
  knowsVMwareHostVirtualMachineStates,
  mergeVMwareSeverities,
  reportsNoVMwareHostLoad,
  reportsNoVMwareHostUsage,
  toVMwareDate,
  toVMwareNumber,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareHealth";
import { VMWARE_METRIC_STALE_MS } from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareHostData";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import { ResourcePartStatus } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartTypes";
import { OpenIssueRecord } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssues";

/*
 * What in a vCenter needs someone, and how bad it is: the one set of rules
 * the vCenter's health pill and Needs attention card, every part's page, the
 * lists' Status column and the Topology read (Pages/VMware/Utils/
 * VMwareHealth). Each rule fails quietly when it is wrong - a down host
 * read as an idle one, a VM on a lost host called slow, a datastore at 85%
 * called broken - so every rule, both severities and the order Needs
 * attention lists them in are pinned here, against the levels the alert
 * templates fire at.
 */

const NOW: Date = new Date("2026-11-02T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const GIB: number = 1024 * 1024 * 1024;

type RowFields = {
  [Key in keyof VMwareResource]?: VMwareResource[Key] | undefined | unknown;
};

function row(fields: RowFields): VMwareResource {
  return Object.assign(new VMwareResource(), fields);
}

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

const FRESH: Date = minutesAgo(2);
const STALE: Date = minutesAgo(16);

function datacenter(name: string, fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.Datacenter,
    externalId: `datacenter/${name}`,
    name: name,
    datacenterName: name,
    metricsUpdatedAt: FRESH,
    hostCount: 4,
    poweredOnHostCount: 4,
    notRespondingHostCount: 0,
    standbyHostCount: 0,
    criticalHostCount: 0,
    warningHostCount: 0,
    criticalVmCount: 0,
    criticalClusterCount: 0,
    ...fields,
  });
}

function host(name: string, fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.Host,
    externalId: `host/dc-east/${name}`,
    name: name,
    hostName: name,
    clusterName: "prod-cluster",
    datacenterName: "dc-east",
    metricsUpdatedAt: FRESH,
    latestCpuMhz: 20000,
    latestCpuPercent: 40,
    latestMemoryBytes: 200 * GIB,
    latestMemoryPercent: 50,
    maxMemoryBytes: 512 * GIB,
    ...fields,
  });
}

// A host vCenter reports no usage for: not connected, or not running.
function silentHost(name: string, fields: RowFields = {}): VMwareResource {
  return host(name, {
    latestCpuMhz: 0,
    latestCpuPercent: 0,
    latestMemoryBytes: 0,
    latestMemoryPercent: 0,
    ...fields,
  });
}

function vm(name: string, fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.VirtualMachine,
    externalId: `vm/${name}-uuid`,
    name: name,
    vmInstanceUuid: `${name}-uuid`,
    hostName: "esx01",
    clusterName: "prod-cluster",
    datacenterName: "dc-east",
    metricsUpdatedAt: FRESH,
    isPoweredOn: true,
    isTemplate: false,
    memorySwappedBytes: 0,
    memoryBalloonedBytes: 0,
    cpuReadinessPercent: 1,
    ...fields,
  });
}

function datastore(name: string, fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.Datastore,
    externalId: `datastore/dc-east/${name}`,
    name: name,
    datacenterName: "dc-east",
    metricsUpdatedAt: FRESH,
    latestDiskPercent: 50,
    ...fields,
  });
}

function cluster(name: string, fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.Cluster,
    externalId: `cluster/dc-east/${name}`,
    name: name,
    clusterName: name,
    datacenterName: "dc-east",
    metricsUpdatedAt: FRESH,
    hostCount: 2,
    effectiveHostCount: 2,
    ...fields,
  });
}

function pool(name: string, fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.ResourcePool,
    externalId: `resourcepool//dc-east/host/prod-cluster/Resources/${name}`,
    name: name,
    clusterName: "prod-cluster",
    datacenterName: "dc-east",
    metricsUpdatedAt: FRESH,
    memorySwappedBytes: 0,
    ...fields,
  });
}

function reasonTexts(assessment: VMwareAssessment): Array<string> {
  return assessment.reasons.map((reason: ResourceAttentionText): string => {
    return reason.text;
  });
}

function stateOf(
  hostRow: VMwareResource,
  datacenterRow: VMwareResource | null,
): VMwareHostState {
  return getVMwareHostState({
    host: hostRow,
    datacenter: datacenterRow,
    now: NOW,
  });
}

// The value a template's fire criteria compares against, with its filter.
function fireFilters(
  id: string,
): Array<{ filterType: FilterType; value: number }> {
  const template: VMwareAlertTemplate | undefined =
    getVMwareAlertTemplateById(id);
  if (!template) {
    throw new Error(`no template ${id}`);
  }
  const step: MonitorStep = template.getMonitorStep({
    vcenterIdentifier: "vcenter-prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
  });
  const instances: Array<MonitorCriteriaInstance> =
    step.data?.monitorCriteria.data?.monitorCriteriaInstanceArray || [];
  const filters: Array<{ filterType: FilterType; value: number }> = [];
  for (const instance of instances) {
    for (const filter of (instance.data?.filters || []) as Array<{
      filterType?: FilterType;
      value?: unknown;
    }>) {
      if (filter.filterType) {
        filters.push({
          filterType: filter.filterType,
          value: Number(filter.value),
        });
      }
    }
  }
  return filters;
}

describe("the levels are the alert templates' levels", () => {
  test("a datastore needs a look past the warning template's line, and is broken past the critical one's", () => {
    expect(fireFilters("vmware-datastore-capacity-warning")).toContainEqual({
      filterType: FilterType.GreaterThan,
      value: VMWARE_DATASTORE_WARNING_PERCENT,
    });
    expect(fireFilters("vmware-datastore-capacity-critical")).toContainEqual({
      filterType: FilterType.GreaterThan,
      value: VMWARE_DATASTORE_CRITICAL_PERCENT,
    });
    expect([
      VMWARE_DATASTORE_WARNING_PERCENT,
      VMWARE_DATASTORE_CRITICAL_PERCENT,
    ]).toEqual([80, 90]);
  });

  test("a host is busy past its CPU and memory saturation templates' line", () => {
    expect(VMWARE_HOST_SATURATION_PERCENT).toBe(90);
    for (const id of [
      "vmware-host-cpu-saturation",
      "vmware-host-memory-saturation",
    ]) {
      expect(fireFilters(id)).toContainEqual({
        filterType: FilterType.GreaterThan,
        value: VMWARE_HOST_SATURATION_PERCENT,
      });
    }
  });

  test("a VM waits for a CPU past the CPU Ready contention template's line", () => {
    expect(VMWARE_CPU_READY_WARNING_PERCENT).toBe(10);
    expect(fireFilters("vmware-vm-cpu-ready-contention")).toContainEqual({
      filterType: FilterType.GreaterThan,
      value: VMWARE_CPU_READY_WARNING_PERCENT,
    });
  });

  test("a host reporting no memory in use is what Host Not Responding fires on", () => {
    expect(fireFilters(VMWARE_HOST_NOT_RESPONDING_TEMPLATE_ID)).toContainEqual({
      filterType: FilterType.LessThanOrEqualTo,
      value: 0,
    });
  });

  test("a part is judged on readings no older than the lists' 15 minutes", () => {
    expect(VMWARE_READINGS_STALE_MS).toBe(15 * MINUTE);
    expect(VMWARE_READINGS_STALE_MS).toBe(VMWARE_METRIC_STALE_MS);
  });
});

describe("reading a row", () => {
  test("numbers arrive as numbers, numeric strings (bigints) or nothing", () => {
    expect(toVMwareNumber(12.5)).toBe(12.5);
    expect(toVMwareNumber("549755813888")).toBe(549755813888);
    expect(toVMwareNumber(0)).toBe(0);
    expect(toVMwareNumber(null)).toBeNull();
    expect(toVMwareNumber(undefined)).toBeNull();
    expect(toVMwareNumber("")).toBeNull();
    expect(toVMwareNumber("abc")).toBeNull();
    expect(toVMwareNumber(Infinity)).toBeNull();
  });

  test("dates arrive as dates or ISO strings; anything else is no date", () => {
    expect(toVMwareDate(FRESH)).toBe(FRESH);
    expect(toVMwareDate("2026-11-02T11:58:00.000Z")).toEqual(FRESH);
    expect(toVMwareDate("not a date")).toBeNull();
    expect(toVMwareDate(null)).toBeNull();
    expect(toVMwareDate("")).toBeNull();
  });

  test("a reading is judged while it is at most 15 minutes old", () => {
    expect(hasFreshVMwareReadings(host("a", {}), NOW)).toBe(true);
    expect(
      hasFreshVMwareReadings(
        host("a", { metricsUpdatedAt: minutesAgo(15) }),
        NOW,
      ),
    ).toBe(true);
    expect(
      hasFreshVMwareReadings(
        host("a", { metricsUpdatedAt: new Date(minutesAgo(15).getTime() - 1) }),
        NOW,
      ),
    ).toBe(false);
    expect(
      hasFreshVMwareReadings(host("a", { metricsUpdatedAt: undefined }), NOW),
    ).toBe(false);
  });

  test("a part is named as vCenter names it, else by its id's last part", () => {
    expect(
      getVMwareDisplayName(row({ name: "db-primary", externalId: "vm/1" })),
    ).toBe("db-primary");
    expect(
      getVMwareDisplayName(row({ externalId: "datastore/dc-east/ds-prod-01" })),
    ).toBe("ds-prod-01");
    expect(getVMwareDisplayName(row({}))).toBe("");
    // A host and a cluster as their metrics name them.
    expect(
      getVMwareHostName(row({ hostName: "esx01.acme.example", name: "esx01" })),
    ).toBe("esx01.acme.example");
    expect(getVMwareHostName(row({ name: "esx01" }))).toBe("esx01");
    expect(
      getVMwareClusterName(row({ clusterName: "prod", name: "prod-x" })),
    ).toBe("prod");
  });

  test("a datastore's share is what vCenter reported, else used over capacity", () => {
    expect(
      getVMwareDatastorePercent(datastore("a", { latestDiskPercent: 93 })),
    ).toBe(93);
    expect(
      getVMwareDatastorePercent(
        datastore("a", {
          latestDiskPercent: undefined,
          latestDiskBytes: 750 * GIB,
          maxDiskBytes: 1000 * GIB,
        }),
      ),
    ).toBe(75);
    expect(
      getVMwareDatastorePercent(
        datastore("a", {
          latestDiskPercent: undefined,
          latestDiskBytes: 1,
          maxDiskBytes: 0,
        }),
      ),
    ).toBeNull();
    expect(
      getVMwareDatastorePercent(
        datastore("a", { latestDiskPercent: undefined }),
      ),
    ).toBeNull();
  });

  test("a reason writes a share as a whole percent and an amount in binary units", () => {
    expect(formatVMwareReasonPercent(93.6)).toBe("94%");
    expect(formatVMwareReasonPercent(90.4)).toBe("90%");
    expect(formatVMwareReasonBytes(512)).toBe("512 B");
    expect(formatVMwareReasonBytes(768 * 1024 * 1024)).toBe("768 MiB");
    expect(formatVMwareReasonBytes(1.5 * GIB)).toBe("1.5 GiB");
    expect(formatVMwareReasonBytes(2048 * GIB)).toBe("2.0 TiB");
  });

  test("the datacenter of a part is found by its name, without regard to case", () => {
    const east: VMwareResource = datacenter("dc-east");
    const west: VMwareResource = datacenter("dc-west");
    expect(findVMwareDatacenter([west, east], "DC-East ")).toBe(east);
    expect(findVMwareDatacenter([west, east], "dc-north")).toBeNull();
    expect(findVMwareDatacenter([west, east], null)).toBeNull();
    // A row of another kind that shares the name is not a datacenter.
    expect(
      findVMwareDatacenter([host("dc-east", { name: "dc-east" })], "dc-east"),
    ).toBeNull();
  });
});

describe("an ESXi host's state", () => {
  test("a host whose CPU and memory vCenter reports is Connected", () => {
    expect(stateOf(host("esx01"), datacenter("dc-east"))).toBe(
      VMwareHostState.Connected,
    );
    expect(isVMwareHostRunning(VMwareHostState.Connected)).toBe(true);
    expect(reportsNoVMwareHostLoad(VMwareHostState.Connected)).toBe(false);
  });

  test("a host is idle, never down, while it uses any memory", () => {
    expect(
      reportsNoVMwareHostUsage(
        host("a", { latestCpuMhz: 0, latestMemoryBytes: 1 }),
      ),
    ).toBe(false);
    expect(
      reportsNoVMwareHostUsage(
        host("a", { latestCpuMhz: undefined, latestMemoryBytes: 0 }),
      ),
    ).toBe(true);
    expect(
      reportsNoVMwareHostUsage(
        host("a", { latestCpuMhz: 50, latestMemoryBytes: 0 }),
      ),
    ).toBe(false);
    // No memory reading at all says nothing.
    expect(
      reportsNoVMwareHostUsage(
        host("a", { latestCpuMhz: 0, latestMemoryBytes: undefined }),
      ),
    ).toBe(false);
  });

  test("no usage, in a datacenter that lost contact with a host and has none off: Not responding", () => {
    const dc: VMwareResource = datacenter("dc-east", {
      hostCount: 4,
      poweredOnHostCount: 3,
      notRespondingHostCount: 1,
      standbyHostCount: 0,
    });
    expect(stateOf(silentHost("esx03"), dc)).toBe(
      VMwareHostState.NotResponding,
    );
  });

  test("no usage, in a datacenter with hosts off but none lost: Powered off, In standby, or either", () => {
    const off: VMwareResource = datacenter("dc-east", {
      hostCount: 4,
      poweredOnHostCount: 3,
      notRespondingHostCount: 0,
      standbyHostCount: 0,
    });
    const standby: VMwareResource = datacenter("dc-east", {
      hostCount: 4,
      poweredOnHostCount: 3,
      notRespondingHostCount: 0,
      standbyHostCount: 1,
    });
    const both: VMwareResource = datacenter("dc-east", {
      hostCount: 5,
      poweredOnHostCount: 3,
      notRespondingHostCount: 0,
      standbyHostCount: 1,
    });
    expect(stateOf(silentHost("esx04"), off)).toBe(VMwareHostState.PoweredOff);
    expect(stateOf(silentHost("esx04"), standby)).toBe(VMwareHostState.Standby);
    expect(stateOf(silentHost("esx04"), both)).toBe(
      VMwareHostState.PoweredOffOrStandby,
    );
  });

  test("no usage that the datacenter's counts cannot explain is No usage reported", () => {
    // Lost hosts and hosts off at once: which is this one?
    const mixed: VMwareResource = datacenter("dc-east", {
      hostCount: 5,
      poweredOnHostCount: 3,
      notRespondingHostCount: 1,
      standbyHostCount: 0,
    });
    // Every host on and answering: the counts say nothing about this one.
    const calm: VMwareResource = datacenter("dc-east");
    const staleCounts: VMwareResource = datacenter("dc-east", {
      notRespondingHostCount: 1,
      poweredOnHostCount: 3,
      metricsUpdatedAt: STALE,
    });
    const noCounts: VMwareResource = datacenter("dc-east", {
      notRespondingHostCount: undefined,
    });
    for (const dc of [mixed, calm, staleCounts, noCounts, null]) {
      expect(stateOf(silentHost("esx05"), dc)).toBe(VMwareHostState.NoUsage);
    }
  });

  test("a host whose readings are older than 15 minutes is Not reporting; one never read, No data yet", () => {
    expect(
      stateOf(
        host("esx01", { metricsUpdatedAt: STALE }),
        datacenter("dc-east"),
      ),
    ).toBe(VMwareHostState.NotReporting);
    expect(
      stateOf(
        silentHost("esx01", { metricsUpdatedAt: STALE }),
        datacenter("dc-east", {
          notRespondingHostCount: 1,
          poweredOnHostCount: 3,
        }),
      ),
    ).toBe(VMwareHostState.NotReporting);
    expect(stateOf(host("esx01", { metricsUpdatedAt: undefined }), null)).toBe(
      VMwareHostState.NoDataYet,
    );
  });

  test("only a connected host runs workloads; the others' zero is no reading", () => {
    for (const state of [
      VMwareHostState.NotResponding,
      VMwareHostState.PoweredOff,
      VMwareHostState.Standby,
      VMwareHostState.PoweredOffOrStandby,
      VMwareHostState.NoUsage,
    ]) {
      expect(isVMwareHostRunning(state)).toBe(false);
      expect(reportsNoVMwareHostLoad(state)).toBe(true);
    }
    // What a quiet host last sent is still what it last used.
    for (const state of [
      VMwareHostState.NotReporting,
      VMwareHostState.NoDataYet,
    ]) {
      expect(isVMwareHostRunning(state)).toBe(false);
      expect(reportsNoVMwareHostLoad(state)).toBe(false);
    }
  });

  /*
   * vCenter repeats the last power state of the VMs on a host it lost: how
   * many run there is not known. On a host off or in standby they are off.
   */
  test("which of a host's VMs run is known, except on a host vCenter cannot place or reach", () => {
    for (const state of [
      VMwareHostState.NotResponding,
      VMwareHostState.NoUsage,
    ]) {
      expect(knowsVMwareHostVirtualMachineStates(state)).toBe(false);
    }
    for (const state of [
      VMwareHostState.Connected,
      VMwareHostState.PoweredOff,
      VMwareHostState.Standby,
      VMwareHostState.PoweredOffOrStandby,
      VMwareHostState.NotReporting,
      VMwareHostState.NoDataYet,
    ]) {
      expect(knowsVMwareHostVirtualMachineStates(state)).toBe(true);
    }
  });
});

describe("what on an ESXi host needs attention", () => {
  const lost: VMwareResource = datacenter("dc-east", {
    poweredOnHostCount: 3,
    notRespondingHostCount: 1,
  });

  test("a host vCenter cannot reach is critical, and says so in one word", () => {
    const assessment: VMwareAssessment = assessVMwareHost({
      host: silentHost("esx03"),
      datacenter: lost,
      now: NOW,
    });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(reasonTexts(assessment)).toEqual(["Not responding"]);
  });

  test("a host with no usage the counts cannot explain needs a look", () => {
    const assessment: VMwareAssessment = assessVMwareHost({
      host: silentHost("esx05"),
      datacenter: null,
      now: NOW,
    });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(reasonTexts(assessment)).toEqual(["No CPU or memory use reported"]);
  });

  test("a host powered off or in standby needs nothing: someone, or DPM, did it", () => {
    const standby: VMwareResource = datacenter("dc-east", {
      poweredOnHostCount: 3,
      standbyHostCount: 1,
    });
    expect(
      assessVMwareHost({
        host: silentHost("esx04"),
        datacenter: standby,
        now: NOW,
      }),
    ).toEqual({ severity: null, reasons: [] });
  });

  test("a busy host needs a look past 90%, CPU and memory each with its share", () => {
    const busy: VMwareAssessment = assessVMwareHost({
      host: host("esx02", { latestCpuPercent: 93.6, latestMemoryPercent: 91 }),
      datacenter: datacenter("dc-east"),
      now: NOW,
    });
    expect(busy.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(busy.reasons).toEqual([
      { text: "CPU at {{percent}}", values: { percent: "94%" } },
      { text: "Memory at {{percent}}", values: { percent: "91%" } },
    ]);
    // Exactly at the line is not past it.
    expect(
      assessVMwareHost({
        host: host("esx02", { latestCpuPercent: 90, latestMemoryPercent: 90 }),
        datacenter: datacenter("dc-east"),
        now: NOW,
      }).severity,
    ).toBeNull();
  });

  test("a busy host is never critical: a host at 99% is one to look at", () => {
    expect(
      assessVMwareHost({
        host: host("esx02", { latestCpuPercent: 99.9 }),
        datacenter: datacenter("dc-east"),
        now: NOW,
      }).severity,
    ).toBe(ResourceAttentionSeverity.Warning);
  });

  test("a host gone quiet, or never read, is not judged on what it last sent", () => {
    for (const quiet of [
      host("esx01", { metricsUpdatedAt: STALE, latestCpuPercent: 99 }),
      host("esx01", { metricsUpdatedAt: undefined, latestCpuPercent: 99 }),
    ]) {
      expect(
        assessVMwareHost({ host: quiet, datacenter: null, now: NOW }),
      ).toEqual({ severity: null, reasons: [] });
    }
  });
});

describe("a virtual machine", () => {
  const lost: VMwareResource = datacenter("dc-east", {
    poweredOnHostCount: 3,
    notRespondingHostCount: 1,
  });

  test("runs on the host its row names, in its datacenter", () => {
    const esx01: VMwareResource = host("esx01");
    const other: VMwareResource = host("esx01", {
      externalId: "host/dc-west/esx01",
      datacenterName: "dc-west",
    });
    expect(findVMwareHostOfVirtualMachine([other, esx01], vm("web"))).toBe(
      esx01,
    );
    expect(
      findVMwareHostOfVirtualMachine([esx01], vm("web", { hostName: "esx09" })),
    ).toBeNull();
    expect(
      findVMwareHostOfVirtualMachine(
        [esx01],
        vm("web", { hostName: undefined }),
      ),
    ).toBeNull();
  });

  test("on a host vCenter lost, a VM is Disconnected and not judged", () => {
    const data: {
      vm: VMwareResource;
      now: Date;
      hosts: Array<VMwareResource>;
      datacenters: Array<VMwareResource>;
    } = {
      vm: vm("cache-01", {
        hostName: "esx03",
        memorySwappedBytes: 4 * GIB,
        cpuReadinessPercent: 40,
      }),
      now: NOW,
      hosts: [silentHost("esx03")],
      datacenters: [lost],
    };
    expect(isVMwareVirtualMachineDisconnected(data)).toBe(true);
    expect(assessVMwareVirtualMachine(data)).toEqual({
      severity: null,
      reasons: [],
    });
    const status: ResourcePartStatus = getVMwareVirtualMachineStatus(data);
    expect(status.label).toBe("Disconnected");
    expect(status.tone).toBe("neutral");
    expect(status.description).toBe(
      "vCenter cannot reach the ESXi host this VM runs on, so it does not know what the VM is doing.",
    );
  });

  test("without its host's row, a VM is judged on its own", () => {
    expect(
      isVMwareVirtualMachineDisconnected({ vm: vm("web"), now: NOW }),
    ).toBe(false);
  });

  test("a VM the host swaps to disk is critical, with how much", () => {
    const assessment: VMwareAssessment = assessVMwareVirtualMachine({
      vm: vm("db-primary", { memorySwappedBytes: 1.5 * GIB }),
      now: NOW,
    });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(assessment.reasons).toEqual([
      {
        text: "{{amount}} of memory swapped by the host",
        values: { amount: "1.5 GiB" },
      },
    ]);
  });

  test("a VM ballooned, or waiting for a CPU past 10%, needs a look", () => {
    expect(
      assessVMwareVirtualMachine({
        vm: vm("app-03", { memoryBalloonedBytes: 768 * 1024 * 1024 }),
        now: NOW,
      }),
    ).toEqual({
      severity: ResourceAttentionSeverity.Warning,
      reasons: [
        {
          text: "{{amount}} of memory ballooned",
          values: { amount: "768 MiB" },
        },
      ],
    });
    expect(
      assessVMwareVirtualMachine({
        vm: vm("ci-runner-01", { cpuReadinessPercent: 14.2 }),
        now: NOW,
      }),
    ).toEqual({
      severity: ResourceAttentionSeverity.Warning,
      reasons: [{ text: "CPU ready {{percent}}", values: { percent: "14%" } }],
    });
    // At the line is not past it.
    expect(
      assessVMwareVirtualMachine({
        vm: vm("ci-runner-01", { cpuReadinessPercent: 10 }),
        now: NOW,
      }).severity,
    ).toBeNull();
  });

  test("every reason is listed, the worst severity wins", () => {
    const assessment: VMwareAssessment = assessVMwareVirtualMachine({
      vm: vm("db-primary", {
        memorySwappedBytes: GIB,
        memoryBalloonedBytes: GIB,
        cpuReadinessPercent: 20,
      }),
      now: NOW,
    });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(reasonTexts(assessment)).toEqual([
      "{{amount}} of memory swapped by the host",
      "{{amount}} of memory ballooned",
      "CPU ready {{percent}}",
    ]);
  });

  test("a template, a VM that is off and one whose readings are old are never judged", () => {
    for (const quiet of [
      vm("tmpl", { isTemplate: true, memorySwappedBytes: GIB }),
      vm("off", { isPoweredOn: false, memorySwappedBytes: GIB }),
      vm("old", { metricsUpdatedAt: STALE, memorySwappedBytes: GIB }),
    ]) {
      expect(assessVMwareVirtualMachine({ vm: quiet, now: NOW })).toEqual({
        severity: null,
        reasons: [],
      });
    }
  });

  test("its status: Template, No data yet, Not reporting, Powered off, Running in the tone of what needs a look", () => {
    const status: (fields: RowFields) => ResourcePartStatus = (
      fields: RowFields,
    ): ResourcePartStatus => {
      return getVMwareVirtualMachineStatus({ vm: vm("x", fields), now: NOW });
    };
    expect(status({ isTemplate: true })).toEqual({
      label: "Template",
      tone: "neutral",
    });
    expect(status({ metricsUpdatedAt: undefined }).label).toBe("No data yet");
    expect(status({ metricsUpdatedAt: STALE })).toEqual({
      label: "Not reporting",
      tone: "neutral",
      description: "vCenter has not reported this for more than 15 minutes.",
    });
    expect(status({ isPoweredOn: false })).toEqual({
      label: "Powered off",
      tone: "neutral",
    });
    expect(status({ isPoweredOn: undefined }).label).toBe("No data yet");
    expect(status({})).toEqual({ label: "Running", tone: "positive" });
    expect(status({ cpuReadinessPercent: 30 })).toEqual({
      label: "Running",
      tone: "warning",
    });
    expect(status({ memorySwappedBytes: 1 })).toEqual({
      label: "Running",
      tone: "danger",
    });
  });
});

describe("a datastore", () => {
  test("more than 90% full is critical, more than 80% needs a look", () => {
    expect(
      assessVMwareDatastore({
        datastore: datastore("ds-prod-01", { latestDiskPercent: 93 }),
        now: NOW,
      }),
    ).toEqual({
      severity: ResourceAttentionSeverity.Critical,
      reasons: [{ text: "{{percent}} full", values: { percent: "93%" } }],
    });
    expect(
      assessVMwareDatastore({
        datastore: datastore("ds-prod-02", { latestDiskPercent: 84 }),
        now: NOW,
      }).severity,
    ).toBe(ResourceAttentionSeverity.Warning);
    // Exactly at each line is not past it.
    expect(
      assessVMwareDatastore({
        datastore: datastore("a", { latestDiskPercent: 90 }),
        now: NOW,
      }).severity,
    ).toBe(ResourceAttentionSeverity.Warning);
    expect(
      assessVMwareDatastore({
        datastore: datastore("a", { latestDiskPercent: 80 }),
        now: NOW,
      }).severity,
    ).toBeNull();
  });

  test("an old reading, or no size at all, is not judged", () => {
    expect(
      assessVMwareDatastore({
        datastore: datastore("a", {
          latestDiskPercent: 99,
          metricsUpdatedAt: STALE,
        }),
        now: NOW,
      }).severity,
    ).toBeNull();
    expect(
      assessVMwareDatastore({
        datastore: datastore("a", { latestDiskPercent: undefined }),
        now: NOW,
      }).severity,
    ).toBeNull();
  });

  test("its status is how full it is, in the tone of its alerts", () => {
    expect(
      getVMwareDatastoreStatus({
        datastore: datastore("a", { latestDiskPercent: 93.4 }),
        now: NOW,
      }),
    ).toEqual({
      label: "{{percent}} used",
      values: { percent: "93%" },
      tone: "danger",
    });
    expect(
      getVMwareDatastoreStatus({
        datastore: datastore("a", { latestDiskPercent: 40 }),
        now: NOW,
      }).tone,
    ).toBe("positive");
    expect(
      getVMwareDatastoreStatus({
        datastore: datastore("a", { metricsUpdatedAt: STALE }),
        now: NOW,
      }).label,
    ).toBe("Not reporting");
    expect(
      getVMwareDatastoreStatus({
        datastore: datastore("a", { latestDiskPercent: undefined }),
        now: NOW,
      }).label,
    ).toBe("No data yet");
  });
});

describe("a resource pool", () => {
  test("whose memory the host swaps needs a look", () => {
    expect(
      assessVMwareResourcePool({
        pool: pool("Web", { memorySwappedBytes: 8 * 1024 * 1024 }),
        now: NOW,
      }),
    ).toEqual({
      severity: ResourceAttentionSeverity.Warning,
      reasons: [
        {
          text: "{{amount}} of memory swapped by the host",
          values: { amount: "8.0 MiB" },
        },
      ],
    });
    expect(
      assessVMwareResourcePool({ pool: pool("Web"), now: NOW }).severity,
    ).toBeNull();
    expect(
      assessVMwareResourcePool({
        pool: pool("Web", { memorySwappedBytes: GIB, metricsUpdatedAt: STALE }),
        now: NOW,
      }).severity,
    ).toBeNull();
  });
});

describe("a cluster", () => {
  const dc: VMwareResource = datacenter("dc-east");

  test("holds the hosts of its name in its datacenter", () => {
    const prod: VMwareResource = cluster("prod-cluster");
    const mine: VMwareResource = host("esx01");
    const otherCluster: VMwareResource = host("esx05", {
      clusterName: "dev-cluster",
    });
    const otherDatacenter: VMwareResource = host("esx-w1", {
      datacenterName: "dc-west",
    });
    expect(
      getVMwareHostsOfCluster([mine, otherCluster, otherDatacenter], prod),
    ).toEqual([mine]);
  });

  test("could lose its largest host while the others have room for its memory", () => {
    const headroom: VMwareClusterHeadroom | null = getVMwareClusterHeadroom({
      cluster: cluster("prod-cluster", { hostCount: 3, effectiveHostCount: 3 }),
      hosts: [
        host("esx01", {
          latestMemoryBytes: 100 * GIB,
          maxMemoryBytes: 512 * GIB,
        }),
        host("esx02", {
          latestMemoryBytes: 100 * GIB,
          maxMemoryBytes: 512 * GIB,
        }),
        host("esx03", {
          latestMemoryBytes: 100 * GIB,
          maxMemoryBytes: 256 * GIB,
        }),
      ],
      datacenters: [dc],
      now: NOW,
    });
    expect(headroom).toEqual({
      runningHostCount: 3,
      usedMemoryBytes: 300 * GIB,
      capacityMemoryBytes: 1280 * GIB,
      largestHostMemoryBytes: 512 * GIB,
      remainingMemoryBytes: 768 * GIB,
      canLoseAHost: true,
    });
  });

  test("could not, once its hosts use more than the others would have", () => {
    const hosts: Array<VMwareResource> = [
      host("esx-w1", {
        latestMemoryBytes: 200 * GIB,
        maxMemoryBytes: 256 * GIB,
      }),
      host("esx-w2", {
        latestMemoryBytes: 200 * GIB,
        maxMemoryBytes: 256 * GIB,
      }),
    ];
    const westCluster: VMwareResource = cluster("prod-cluster");
    const headroom: VMwareClusterHeadroom | null = getVMwareClusterHeadroom({
      cluster: westCluster,
      hosts: hosts,
      datacenters: [dc],
      now: NOW,
    });
    expect(headroom?.canLoseAHost).toBe(false);
    expect(
      assessVMwareCluster({
        cluster: westCluster,
        hosts: hosts,
        datacenters: [dc],
        now: NOW,
      }),
    ).toEqual({
      severity: ResourceAttentionSeverity.Warning,
      reasons: [{ text: "Not enough memory to lose a host" }],
    });
  });

  test("has nothing to work headroom out from with one running host, an unsized one or hosts not effective", () => {
    const single: VMwareClusterHeadroom | null = getVMwareClusterHeadroom({
      cluster: cluster("c"),
      hosts: [host("esx01")],
      datacenters: [dc],
      now: NOW,
    });
    const unsized: VMwareClusterHeadroom | null = getVMwareClusterHeadroom({
      cluster: cluster("c"),
      hosts: [host("esx01"), host("esx02", { maxMemoryBytes: undefined })],
      datacenters: [dc],
      now: NOW,
    });
    // A host in maintenance mode still reports its memory but runs no VMs.
    const maintenance: VMwareClusterHeadroom | null = getVMwareClusterHeadroom({
      cluster: cluster("c", { hostCount: 3, effectiveHostCount: 2 }),
      hosts: [host("esx01"), host("esx02"), host("esx03")],
      datacenters: [dc],
      now: NOW,
    });
    expect([single, unsized, maintenance]).toEqual([null, null, null]);
  });

  test("a host not effective for no reason its own row says is counted: maintenance mode", () => {
    const lostDc: VMwareResource = datacenter("dc-east", {
      hostCount: 4,
      poweredOnHostCount: 3,
      notRespondingHostCount: 1,
    });
    const hosts: Array<VMwareResource> = [
      host("esx01"),
      host("esx02"),
      host("esx04"),
      silentHost("esx03"),
    ];
    // Two not effective: the lost esx03 (its own row says it), and one more.
    expect(
      getVMwareClusterUnexplainedNotEffective({
        cluster: cluster("prod-cluster", {
          hostCount: 4,
          effectiveHostCount: 2,
        }),
        hosts: hosts,
        datacenters: [lostDc],
        now: NOW,
      }),
    ).toBe(1);
    expect(
      getVMwareClusterUnexplainedNotEffective({
        cluster: cluster("prod-cluster", {
          hostCount: 4,
          effectiveHostCount: 3,
        }),
        hosts: hosts,
        datacenters: [lostDc],
        now: NOW,
      }),
    ).toBe(0);
  });

  test("hosts not effective need a look, counted in the reader's plural", () => {
    const assessment: VMwareAssessment = assessVMwareCluster({
      cluster: cluster("dev-cluster", { hostCount: 3, effectiveHostCount: 1 }),
      hosts: [],
      datacenters: [dc],
      now: NOW,
    });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.reasons).toEqual([
      {
        text: "{{count}} hosts not effective",
        values: { count: "2" },
        plural: { one: "{{count}} host not effective", count: 2 },
      },
    ]);
  });

  test("a host its vCenter cannot reach makes the cluster Unhealthy, said first", () => {
    const lostDc: VMwareResource = datacenter("dc-east", {
      hostCount: 4,
      poweredOnHostCount: 3,
      notRespondingHostCount: 1,
    });
    const prod: VMwareResource = cluster("prod-cluster", {
      hostCount: 4,
      effectiveHostCount: 2,
    });
    const hosts: Array<VMwareResource> = [
      host("esx01"),
      host("esx02"),
      host("esx04"),
      silentHost("esx03"),
    ];
    const assessment: VMwareAssessment = assessVMwareClusterWithHosts({
      cluster: prod,
      hosts: hosts,
      datacenters: [lostDc],
      now: NOW,
    });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(reasonTexts(assessment)).toEqual([
      "{{count}} hosts not responding",
      "{{count}} hosts not effective",
    ]);
    expect(
      getVMwareClusterStatus({
        cluster: prod,
        hosts: hosts,
        datacenters: [lostDc],
        now: NOW,
      }),
    ).toEqual({ label: "Unhealthy", tone: "danger" });
    // Needs attention lists the host for it, not the cluster.
    expect(
      assessVMwareCluster({
        cluster: prod,
        hosts: hosts,
        datacenters: [lostDc],
        now: NOW,
      }).severity,
    ).toBe(ResourceAttentionSeverity.Warning);
  });

  test("a busy host is its own to say, never its cluster's", () => {
    expect(
      getVMwareClusterStatus({
        cluster: cluster("prod-cluster"),
        hosts: [host("esx01", { latestCpuPercent: 99 }), host("esx02")],
        datacenters: [dc],
        now: NOW,
      }),
    ).toEqual({ label: "Healthy", tone: "positive" });
  });

  test("its status: Degraded for hosts not effective, Not reporting or No data yet when it has nothing to judge", () => {
    expect(
      getVMwareClusterStatus({
        cluster: cluster("c", { hostCount: 3, effectiveHostCount: 2 }),
        hosts: [],
        datacenters: [dc],
        now: NOW,
      }),
    ).toEqual({ label: "Degraded", tone: "warning" });
    expect(
      getVMwareClusterStatus({
        cluster: cluster("c", { metricsUpdatedAt: STALE }),
        hosts: [],
        datacenters: [dc],
        now: NOW,
      }).label,
    ).toBe("Not reporting");
    expect(
      getVMwareClusterStatus({
        cluster: cluster("c", { metricsUpdatedAt: undefined }),
        hosts: [],
        datacenters: [dc],
        now: NOW,
      }).label,
    ).toBe("No data yet");
  });
});

describe("what a datacenter's own counts say", () => {
  function findings(
    dc: VMwareResource,
    hosts: Array<VMwareResource> = [],
  ): Array<VMwareDatacenterFinding> {
    return getVMwareDatacenterFindings({ datacenter: dc, hosts, now: NOW });
  }

  test("a calm datacenter says nothing", () => {
    expect(findings(datacenter("dc-east"))).toEqual([]);
  });

  test("a lost host no host row names, red and yellow hosts: one row for its hosts, critical", () => {
    const result: Array<VMwareDatacenterFinding> = findings(
      datacenter("dc-east", {
        hostCount: 8,
        poweredOnHostCount: 6,
        notRespondingHostCount: 1,
        criticalHostCount: 2,
        warningHostCount: 1,
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.group).toBe("hosts");
    expect(result[0]!.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(result[0]!.reasons).toEqual([
      {
        text: "{{count}} hosts not responding",
        values: { count: "1" },
        plural: { one: "{{count}} host not responding", count: 1 },
      },
      // A lost host is red for its connection: the other red one is counted apart.
      {
        text: "{{count}} hosts with a critical alarm",
        values: { count: "1" },
        plural: { one: "{{count}} host with a critical alarm", count: 1 },
      },
      {
        text: "{{count}} hosts with a warning alarm",
        values: { count: "1" },
        plural: { one: "{{count}} host with a warning alarm", count: 1 },
      },
    ]);
  });

  test("a lost host whose own row says so is not said again by its datacenter", () => {
    const dc: VMwareResource = datacenter("dc-east", {
      hostCount: 4,
      poweredOnHostCount: 3,
      notRespondingHostCount: 1,
      criticalHostCount: 1,
    });
    expect(findings(dc, [silentHost("esx03"), host("esx01")])).toEqual([]);
  });

  test("only yellow hosts: the hosts' row needs a look", () => {
    const result: Array<VMwareDatacenterFinding> = findings(
      datacenter("dc-east", { warningHostCount: 2 }),
    );
    expect(
      result.map((finding: VMwareDatacenterFinding) => {
        return [finding.group, finding.severity];
      }),
    ).toEqual([["hosts", ResourceAttentionSeverity.Warning]]);
  });

  test("red VMs need a look; red clusters are critical, each a row of its own", () => {
    const result: Array<VMwareDatacenterFinding> = findings(
      datacenter("dc-east", { criticalVmCount: 3, criticalClusterCount: 1 }),
    );
    expect(
      result.map((finding: VMwareDatacenterFinding) => {
        return [finding.group, finding.severity, finding.reasons[0]!.text];
      }),
    ).toEqual([
      [
        "virtual-machines",
        ResourceAttentionSeverity.Warning,
        "{{count}} VMs with a critical alarm",
      ],
      [
        "clusters",
        ResourceAttentionSeverity.Critical,
        "{{count}} clusters with a critical alarm",
      ],
    ]);
  });

  test("counts from a collection older than 15 minutes say nothing", () => {
    expect(
      findings(
        datacenter("dc-east", {
          criticalVmCount: 3,
          notRespondingHostCount: 1,
          metricsUpdatedAt: STALE,
        }),
      ),
    ).toEqual([]);
  });
});

describe("each part's status", () => {
  const dc: VMwareResource = datacenter("dc-east", {
    poweredOnHostCount: 3,
    notRespondingHostCount: 1,
  });

  test("an ESXi host in vCenter's words, coloured by what needs attention on it", () => {
    const status: (
      hostRow: VMwareResource,
      datacenterRow: VMwareResource | null,
    ) => ResourcePartStatus = (
      hostRow: VMwareResource,
      datacenterRow: VMwareResource | null,
    ): ResourcePartStatus => {
      return getVMwareHostStatus({
        host: hostRow,
        datacenter: datacenterRow,
        now: NOW,
      });
    };

    expect(status(silentHost("esx03"), dc)).toEqual({
      label: "Not responding",
      tone: "danger",
      description:
        "vCenter has lost contact with this host: it crashed, lost power or its management network, or was disconnected.",
    });
    expect(
      status(
        silentHost("esx04"),
        datacenter("dc-east", { poweredOnHostCount: 3 }),
      ),
    ).toEqual({
      label: "Powered off",
      tone: "neutral",
      description: "Someone powered this host off through vCenter.",
    });
    expect(
      status(
        silentHost("esx04"),
        datacenter("dc-east", { poweredOnHostCount: 3, standbyHostCount: 1 }),
      ),
    ).toEqual({
      label: "In standby",
      tone: "neutral",
      description:
        "vSphere DPM put this host in standby to save power. It wakes when the cluster needs it.",
    });
    expect(
      status(
        silentHost("esx04"),
        datacenter("dc-east", {
          hostCount: 5,
          poweredOnHostCount: 3,
          standbyHostCount: 1,
        }),
      ).label,
    ).toBe("Powered off or in standby");
    expect(status(silentHost("esx05"), null)).toEqual({
      label: "No usage reported",
      tone: "warning",
      description:
        "vCenter reports no CPU or memory use on this host: it is not responding, powered off or in standby.",
    });
    expect(status(host("esx01"), dc)).toEqual({
      label: "Connected",
      tone: "positive",
    });
    expect(status(host("esx02", { latestCpuPercent: 94 }), dc)).toEqual({
      label: "Connected",
      tone: "warning",
    });
    expect(status(host("esx01", { metricsUpdatedAt: STALE }), dc).label).toBe(
      "Not reporting",
    );
    expect(
      status(host("esx01", { metricsUpdatedAt: undefined }), dc).label,
    ).toBe("No data yet");
  });
});

describe("Needs attention for a whole vCenter", () => {
  const routeFor: (kind: VMwareResourceKind, externalId: string) => Route = (
    kind: VMwareResourceKind,
    externalId: string,
  ): Route => {
    return new Route(`/part/${kind}/${externalId}`);
  };
  const listRouteFor: (kind: VMwareResourceKind) => Route = (
    kind: VMwareResourceKind,
  ): Route => {
    return new Route(`/list/${kind}`);
  };

  function items(
    rows: Array<VMwareResource>,
    contextRows?: Array<VMwareResource>,
  ): Array<ResourceAttentionItem> {
    return getVMwareAttentionItems({
      rows: rows,
      contextRows: contextRows,
      now: NOW,
      routeFor: routeFor,
      listRouteFor: listRouteFor,
    });
  }

  const busyRows: Array<VMwareResource> = [
    datacenter("dc-east", {
      hostCount: 5,
      poweredOnHostCount: 4,
      notRespondingHostCount: 1,
      criticalHostCount: 1,
      criticalVmCount: 1,
    }),
    cluster("prod-cluster", { hostCount: 3, effectiveHostCount: 1 }),
    host("esx01"),
    host("esx02", { latestCpuPercent: 94 }),
    silentHost("esx03"),
    datastore("ds-prod-01", { latestDiskPercent: 93 }),
    datastore("ds-prod-02", { latestDiskPercent: 84 }),
    vm("db-primary", { memorySwappedBytes: 1.5 * GIB }),
    vm("app-03", { memoryBalloonedBytes: GIB }),
    pool("Batch", { memorySwappedBytes: GIB }),
  ];

  test("critical first, then what needs a look, each in the order of the vCenter's kinds", () => {
    expect(
      items(busyRows).map((item: ResourceAttentionItem): Array<string> => {
        return [item.severity, item.kind, item.name];
      }),
    ).toEqual([
      ["critical", "ESXi host", "esx03"],
      ["critical", "Datastore", "ds-prod-01"],
      ["critical", "VM", "db-primary"],
      ["warning", "Datacenter", "dc-east"],
      ["warning", "Cluster", "prod-cluster"],
      ["warning", "ESXi host", "esx02"],
      ["warning", "Datastore", "ds-prod-02"],
      ["warning", "VM", "app-03"],
      ["warning", "Resource pool", "Batch"],
    ]);
    expect(VMWARE_ATTENTION_KIND_ORDER).toEqual([
      "Datacenter",
      "Cluster",
      "ESXi host",
      "Datastore",
      "VM",
      "Resource pool",
    ]);
  });

  test("each part opens its own page; a pool and a datacenter's counts open the list they count", () => {
    const byName: Map<string, ResourceAttentionItem> = new Map(
      items(busyRows).map((item: ResourceAttentionItem) => {
        return [item.name, item];
      }),
    );
    expect(byName.get("esx03")!.route?.toString()).toBe(
      "/part/Host/host/dc-east/esx03",
    );
    expect(byName.get("db-primary")!.route?.toString()).toBe(
      "/part/VirtualMachine/vm/db-primary-uuid",
    );
    expect(byName.get("Batch")!.route?.toString()).toBe("/list/ResourcePool");
    // The datacenter's red VM opens the VMs list.
    expect(byName.get("dc-east")!.route?.toString()).toBe(
      "/list/VirtualMachine",
    );
  });

  test("a row's key names its kind and id, a datacenter's the group it counts", () => {
    const keys: Array<string> = items(busyRows).map(
      (item: ResourceAttentionItem): string => {
        return item.key;
      },
    );
    expect(keys).toContain("Host:host/dc-east/esx03");
    expect(keys).toContain("Datacenter:datacenter/dc-east:virtual-machines");
    expect(getVMwareAttentionKey(VMwareResourceKind.Datastore, "x")).toBe(
      "Datastore:x",
    );
    // The datacenter's own lost host is esx03, whose row says it: no hosts row.
    expect(keys).not.toContain("Datacenter:datacenter/dc-east:hosts");
  });

  test("under its name, where a part sits: a VM its host, a host its cluster, a cluster and a datastore their datacenter", () => {
    const detail: Map<string, string | undefined> = new Map(
      items(busyRows).map((item: ResourceAttentionItem) => {
        return [item.name, item.detail];
      }),
    );
    expect(detail.get("db-primary")).toBe("esx01");
    expect(detail.get("esx02")).toBe("prod-cluster");
    expect(detail.get("prod-cluster")).toBe("dc-east");
    expect(detail.get("ds-prod-01")).toBe("dc-east");
    expect(detail.get("Batch")).toBe("prod-cluster");
  });

  test("each kind has its icon", () => {
    expect(
      [
        VMwareResourceKind.Datacenter,
        VMwareResourceKind.Cluster,
        VMwareResourceKind.Host,
        VMwareResourceKind.Datastore,
        VMwareResourceKind.ResourcePool,
        VMwareResourceKind.VirtualMachine,
      ].map(getVMwareKindIcon),
    ).toEqual([
      IconProp.Folder,
      IconProp.SquareStack,
      IconProp.ServerStack,
      IconProp.Database,
      IconProp.Layers,
      IconProp.Cube,
    ]);
  });

  test("context rows judge the listed ones without being listed: a host page's datacenter", () => {
    const dc: VMwareResource = datacenter("dc-east", {
      poweredOnHostCount: 3,
      notRespondingHostCount: 1,
      criticalVmCount: 4,
    });
    const listed: Array<ResourceAttentionItem> = items(
      [silentHost("esx03")],
      [dc],
    );
    expect(
      listed.map((item: ResourceAttentionItem): string => {
        return `${item.kind}:${item.name}:${item.reasons[0]!.text}`;
      }),
    ).toEqual(["ESXi host:esx03:Not responding"]);
  });

  test("the vCenter's health is the worst of what is listed", () => {
    expect(getVMwareHealth(items(busyRows))).toBe("Unhealthy");
    expect(
      getVMwareHealth(items([datastore("ds", { latestDiskPercent: 85 })])),
    ).toBe("Degraded");
    expect(getVMwareHealth(items([host("esx01"), datastore("ds")]))).toBe(
      "Healthy",
    );
    expect(getVMwareHealth([])).toBe("Healthy");
  });

  test("severities merge to the worst, none counting as nothing", () => {
    expect(mergeVMwareSeverities([])).toBeNull();
    expect(mergeVMwareSeverities([null, null])).toBeNull();
    expect(
      mergeVMwareSeverities([null, ResourceAttentionSeverity.Warning]),
    ).toBe(ResourceAttentionSeverity.Warning);
    expect(
      mergeVMwareSeverities([
        ResourceAttentionSeverity.Warning,
        ResourceAttentionSeverity.Critical,
      ]),
    ).toBe(ResourceAttentionSeverity.Critical);
  });
});

describe("which part an open incident or alert is about", () => {
  function record(seriesLabels: OpenIssueRecord["seriesLabels"]): {
    seriesLabels: OpenIssueRecord["seriesLabels"];
  } {
    return { seriesLabels: seriesLabels };
  }

  const esx01: VMwareResource = host("esx01.acme.example");

  test("the templates' resource key and the bare key both name a host", () => {
    expect(
      isVMwareIssueAbout(
        record({ "resource.vcenter.host.name": "esx01.acme.example" }),
        esx01,
      ),
    ).toBe(true);
    expect(
      isVMwareIssueAbout(
        record({ "vcenter.host.name": "esx01.acme.example" }),
        esx01,
      ),
    ).toBe(true);
  });

  test("case and surrounding spaces do not matter", () => {
    expect(
      isVMwareIssueAbout(
        record({ "resource.vcenter.host.name": " ESX01.Acme.Example " }),
        esx01,
      ),
    ).toBe(true);
  });

  test("another host, another key, no labels or a prefix of another host's name is not this host", () => {
    for (const labels of [
      { "resource.vcenter.host.name": "esx02.acme.example" },
      { "resource.vcenter.vm.name": "esx01.acme.example" },
      { "resource.vcenter.host.name": 42 },
      { "resource.vcenter.host.name": "esx01.acme.example.lab" },
      null,
    ]) {
      expect(isVMwareIssueAbout(record(labels), esx01)).toBe(false);
    }
  });

  test("a record about a host in another datacenter is not about this one", () => {
    expect(
      isVMwareIssueAbout(
        record({
          "resource.vcenter.host.name": "esx01.acme.example",
          "resource.vcenter.datacenter.name": "dc-west",
        }),
        esx01,
      ),
    ).toBe(false);
  });

  test("a VM is matched by its instance UUID, else its name; a template by its own keys", () => {
    const web: VMwareResource = vm("web-01");
    expect(
      isVMwareIssueAbout(
        record({ "resource.vcenter.vm.id": "web-01-uuid" }),
        web,
      ),
    ).toBe(true);
    // A renamed VM keeps its UUID: the id wins over a stale name.
    expect(
      isVMwareIssueAbout(
        record({
          "resource.vcenter.vm.id": "other-uuid",
          "resource.vcenter.vm.name": "web-01",
        }),
        web,
      ),
    ).toBe(false);
    expect(
      isVMwareIssueAbout(
        record({ "resource.vcenter.vm.name": "web-01" }),
        vm("web-01", { vmInstanceUuid: undefined }),
      ),
    ).toBe(true);
    expect(
      isVMwareIssueAbout(
        record({ "resource.vcenter.vm_template.id": "tmpl-uuid" }),
        vm("tmpl", { vmInstanceUuid: "tmpl-uuid", isTemplate: true }),
      ),
    ).toBe(true);
  });

  test("a datastore and a cluster by their names", () => {
    expect(
      isVMwareIssueAbout(
        record({ "resource.vcenter.datastore.name": "ds-prod-01" }),
        datastore("ds-prod-01"),
      ),
    ).toBe(true);
    expect(
      isVMwareIssueAbout(
        record({ "resource.vcenter.cluster.name": "prod-cluster" }),
        cluster("prod-cluster"),
      ),
    ).toBe(true);
    // A datacenter or a pool has no page of open records of its own.
    expect(
      isVMwareIssueAbout(
        record({ "resource.vcenter.datacenter.name": "dc-east" }),
        datacenter("dc-east"),
      ),
    ).toBe(false);
  });

  test("a record about a part inside this one counts: a host's VMs, a cluster's hosts and VMs", () => {
    const cacheVm: VMwareResource = vm("cache-01", {
      hostName: "esx01.acme.example",
    });
    const about: { seriesLabels: OpenIssueRecord["seriesLabels"] } = record({
      "resource.vcenter.vm.id": "cache-01-uuid",
    });
    expect(isVMwareIssueAbout(about, esx01)).toBe(false);
    expect(isVMwareIssueAbout(about, esx01, [cacheVm])).toBe(true);
    const prod: VMwareResource = cluster("prod-cluster");
    expect(
      isVMwareIssueAbout(
        record({ "resource.vcenter.host.name": "esx01.acme.example" }),
        prod,
        [esx01, cacheVm],
      ),
    ).toBe(true);
    expect(
      isVMwareIssueAbout(
        record({ "resource.vcenter.host.name": "esx09.acme.example" }),
        prod,
        [esx01, cacheVm],
      ),
    ).toBe(false);
  });
});
