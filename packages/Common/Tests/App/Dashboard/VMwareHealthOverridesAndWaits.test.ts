import { describe, expect, test } from "@jest/globals";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import { VMwareResourceKind } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import {
  VMwareHealthRuleBook,
  VMwareHealthRuleOverrideEntry,
  VMwareHealthRuleScope,
  getVMwareHealthRuleBook,
} from "../../../Types/VMware/VMwareHealthRuleOverrides";
import { VMwareHealthReading } from "../../../Types/VMware/VMwareHealthReadings";
import {
  DEFAULT_VMWARE_HEALTH_RULES,
  VMwareHealthRules,
} from "../../../Types/VMware/VMwareHealthRules";
import {
  SINCE_RULE_BEGAN,
  VMwareAssessment,
  assessVMwareDatastore,
  assessVMwareHost,
  assessVMwareResourcePool,
  assessVMwareVirtualMachine,
  getVMwareAttentionItems,
  getVMwareRulesOf,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareHealth";
import {
  getVMwareAttentionConditions,
  getVMwareStrictestVirtualMachineRules,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareResourceUtils";
import {
  VMwareListContext,
  getVMwareCpuReadyTone,
  getVMwareResourcePoolMemoryTone,
  toVMwareListResource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareResourceColumns";
import { InfrastructureResource } from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import Route from "../../../Types/API/Route";

/*
 * Every judgement of a VMware part reads the part's own rules (#11469): a
 * vCenter's, a cluster's, an ESXi host's or a VM's override over the
 * project's, the most specific winning; and a group of rules that waits
 * marks a part only once its readings held past the line for that long,
 * saying since when. The rule book here is what VMware > Settings > Health
 * Rules keeps; the rows are as the pages read them.
 */

const NOW: Date = new Date("2026-11-27T12:00:00.000Z");
const FRESH: Date = new Date(NOW.getTime() - 60 * 1000);
const NOW_SECONDS: number = NOW.getTime() / 1000;
const KIB: number = 1024;
const MIB: number = 1024 * 1024;

const PROD: string = "11111111-1111-4111-8111-111111111111";
const LAB: string = "22222222-2222-4222-8222-222222222222";

type RowFields = {
  [Key in keyof VMwareResource]?: VMwareResource[Key] | undefined | unknown;
};

function row(fields: RowFields): VMwareResource {
  return Object.assign(new VMwareResource(), {
    vmwareVCenterId: PROD,
    datacenterName: "DC-NORTH",
    metricsUpdatedAt: FRESH,
    ...fields,
  });
}

function host(fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.Host,
    externalId: "host/DC-NORTH/esx-07",
    name: "esx-07",
    clusterName: "cluster-a",
    latestCpuPercent: 95,
    latestMemoryPercent: 40,
    isPoweredOn: true,
    ...fields,
  });
}

function vm(fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.VirtualMachine,
    externalId: "vm/web-01",
    name: "web-01",
    clusterName: "cluster-a",
    hostName: "esx-07",
    isTemplate: false,
    isPoweredOn: true,
    memorySwappedBytes: 0,
    memorySwapOutBytesPerSecond: 0,
    memorySwapInBytesPerSecond: 0,
    memoryBalloonedBytes: 0,
    cpuReadinessPercent: 15,
    ...fields,
  });
}

function datastore(fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.Datastore,
    externalId: "datastore/DC-NORTH/vsan-a",
    name: "vsan-a",
    latestDiskPercent: 75,
    ...fields,
  });
}

function pool(fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.ResourcePool,
    externalId: "pool/DC-NORTH/cluster-a/batch",
    name: "batch",
    clusterName: "cluster-a",
    memorySwapOutBytesPerSecond: 512 * KIB,
    ...fields,
  });
}

function override(
  data: Partial<VMwareHealthRuleOverrideEntry> & {
    scope: VMwareHealthRuleScope;
  },
): VMwareHealthRuleOverrideEntry {
  return {
    vmwareVCenterId: PROD,
    resourceExternalId: null,
    datacenterName: "DC-NORTH",
    clusterName: null,
    hostName: null,
    rules: {},
    ...data,
  };
}

function book(
  overrides: Array<VMwareHealthRuleOverrideEntry>,
  project: Partial<VMwareHealthRules> = {},
): VMwareHealthRuleBook {
  return getVMwareHealthRuleBook(
    { ...DEFAULT_VMWARE_HEALTH_RULES, ...project },
    overrides,
  );
}

// A reading every two minutes for `minutes`, the newest now.
function readings(
  minutes: number,
  values: Partial<VMwareHealthReading>,
): Array<VMwareHealthReading> {
  const list: Array<VMwareHealthReading> = [];
  for (let t: number = minutes * 60; t >= 0; t -= 120) {
    list.push({ t: NOW_SECONDS - t, ...values });
  }
  return list;
}

describe("a part's own rules", () => {
  test("a host with an override of its own is judged by it; its neighbour by the project's", () => {
    const rules: VMwareHealthRuleBook = book([
      override({
        scope: VMwareHealthRuleScope.Host,
        resourceExternalId: "host/DC-NORTH/esx-07",
        hostName: "esx-07",
        clusterName: "cluster-a",
        rules: { hostCpuWarningPercent: 99 },
      }),
    ]);
    expect(
      assessVMwareHost({ host: host(), datacenter: null, now: NOW, rules })
        .severity,
    ).toBeNull();
    expect(
      assessVMwareHost({
        host: host({ externalId: "host/DC-NORTH/esx-08", name: "esx-08" }),
        datacenter: null,
        now: NOW,
        rules,
      }).severity,
    ).toBe(ResourceAttentionSeverity.Warning);
  });

  test("a lab vCenter's override reaches all of its parts, and none of production's", () => {
    const rules: VMwareHealthRuleBook = book([
      override({
        vmwareVCenterId: LAB,
        scope: VMwareHealthRuleScope.VCenter,
        rules: {
          hostCpuWarningPercent: null,
          datastoreWarningPercent: null,
          datastoreCriticalPercent: null,
          vmCpuReadyWarningPercent: null,
        },
      }),
    ]);
    const lab: { vmwareVCenterId: string } = { vmwareVCenterId: LAB };
    expect(
      assessVMwareHost({ host: host(lab), datacenter: null, now: NOW, rules })
        .severity,
    ).toBeNull();
    expect(
      assessVMwareDatastore({
        datastore: datastore({ ...lab, latestDiskPercent: 99 }),
        now: NOW,
        rules,
      }).severity,
    ).toBeNull();
    expect(
      assessVMwareVirtualMachine({ vm: vm(lab), now: NOW, rules }).severity,
    ).toBeNull();

    expect(
      assessVMwareHost({ host: host(), datacenter: null, now: NOW, rules })
        .severity,
    ).toBe(ResourceAttentionSeverity.Warning);
    expect(
      assessVMwareVirtualMachine({ vm: vm(), now: NOW, rules }).severity,
    ).toBe(ResourceAttentionSeverity.Warning);
  });

  test("a VM: its own over its host's over its cluster's over the project's", () => {
    const cluster: VMwareHealthRuleOverrideEntry = override({
      scope: VMwareHealthRuleScope.Cluster,
      resourceExternalId: "cluster/DC-NORTH/cluster-a",
      clusterName: "cluster-a",
      rules: { vmCpuReadyWarningPercent: 12 },
    });
    const onHost: VMwareHealthRuleOverrideEntry = override({
      scope: VMwareHealthRuleScope.Host,
      resourceExternalId: "host/DC-NORTH/esx-07",
      hostName: "esx-07",
      clusterName: "cluster-a",
      rules: { vmCpuReadyWarningPercent: 20 },
    });
    const own: VMwareHealthRuleOverrideEntry = override({
      scope: VMwareHealthRuleScope.VirtualMachine,
      resourceExternalId: "vm/web-01",
      rules: { vmCpuReadyWarningPercent: 14 },
    });

    // CPU ready 15%: the project's 10% marks it.
    expect(
      assessVMwareVirtualMachine({ vm: vm(), now: NOW, rules: book([]) })
        .severity,
    ).toBe(ResourceAttentionSeverity.Warning);
    // The cluster's 12% too.
    expect(
      assessVMwareVirtualMachine({ vm: vm(), now: NOW, rules: book([cluster]) })
        .severity,
    ).toBe(ResourceAttentionSeverity.Warning);
    // The host's 20% does not.
    expect(
      assessVMwareVirtualMachine({
        vm: vm(),
        now: NOW,
        rules: book([cluster, onHost]),
      }).severity,
    ).toBeNull();
    // Its own 14% does again, whatever its host says.
    expect(
      assessVMwareVirtualMachine({
        vm: vm(),
        now: NOW,
        rules: book([own, onHost, cluster]),
      }).severity,
    ).toBe(ResourceAttentionSeverity.Warning);
  });

  test("a resource pool is its cluster's, and a datastore its vCenter's", () => {
    const rules: VMwareHealthRuleBook = book([
      override({
        scope: VMwareHealthRuleScope.Cluster,
        resourceExternalId: "cluster/DC-NORTH/cluster-a",
        clusterName: "cluster-a",
        rules: { resourcePoolSwapOutWarningKibPerSecond: 1024 },
      }),
      override({
        scope: VMwareHealthRuleScope.VCenter,
        rules: { datastoreWarningPercent: 70 },
      }),
    ]);
    // 512 KiB/s: the project would warn at any rate; the cluster at 1 MiB/s.
    expect(
      assessVMwareResourcePool({ pool: pool(), now: NOW, rules }).severity,
    ).toBeNull();
    expect(
      assessVMwareResourcePool({
        pool: pool({ clusterName: "cluster-b" }),
        now: NOW,
        rules,
      }).severity,
    ).toBe(ResourceAttentionSeverity.Warning);
    // 75% full: the vCenter warns from 70%.
    expect(
      assessVMwareDatastore({ datastore: datastore(), now: NOW, rules })
        .severity,
    ).toBe(ResourceAttentionSeverity.Warning);
    expect(
      assessVMwareDatastore({
        datastore: datastore(),
        now: NOW,
        rules: book([]),
      }).severity,
    ).toBeNull();
  });

  test("the rules handed in already resolved are used as they are", () => {
    const resolved: VMwareHealthRules = {
      ...DEFAULT_VMWARE_HEALTH_RULES,
      hostCpuWarningPercent: 99,
    };
    expect(getVMwareRulesOf(resolved, host())).toBe(resolved);
    expect(
      assessVMwareHost({
        host: host(),
        datacenter: null,
        now: NOW,
        rules: resolved,
      }).severity,
    ).toBeNull();
  });
});

describe("for at least N minutes", () => {
  test("a host busy for less than its wait is not marked; once it held, it is, since the run began", () => {
    const rules: VMwareHealthRuleBook = book([], { hostEvaluationMinutes: 10 });
    expect(
      assessVMwareHost({
        host: host({ healthReadings: readings(4, { cpu: 95, mem: 40 }) }),
        datacenter: null,
        now: NOW,
        rules,
      }).severity,
    ).toBeNull();

    const held: VMwareAssessment = assessVMwareHost({
      host: host({ healthReadings: readings(12, { cpu: 95, mem: 40 }) }),
      datacenter: null,
      now: NOW,
      rules,
    });
    expect(held.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(held.since).toEqual(new Date((NOW_SECONDS - 12 * 60) * 1000));
  });

  test("a part with no readings kept (a row from before #11469) waits until it has them", () => {
    expect(
      assessVMwareHost({
        host: host(),
        datacenter: null,
        now: NOW,
        rules: book([], { hostEvaluationMinutes: 5 }),
      }).severity,
    ).toBeNull();
  });

  test("no wait judges the latest report, as before, and says no since", () => {
    const assessment: VMwareAssessment = assessVMwareHost({
      host: host(),
      datacenter: null,
      now: NOW,
      rules: book([]),
    });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.since).toBeUndefined();
  });

  test("a wait set on one host's override applies to that host alone", () => {
    const rules: VMwareHealthRuleBook = book([
      override({
        scope: VMwareHealthRuleScope.Host,
        resourceExternalId: "host/DC-NORTH/esx-07",
        hostName: "esx-07",
        rules: { hostEvaluationMinutes: 30 },
      }),
    ]);
    const shortRun: Array<VMwareHealthReading> = readings(6, {
      cpu: 95,
      mem: 40,
    });
    expect(
      assessVMwareHost({
        host: host({ healthReadings: shortRun }),
        datacenter: null,
        now: NOW,
        rules,
      }).severity,
    ).toBeNull();
    expect(
      assessVMwareHost({
        host: host({
          externalId: "host/DC-NORTH/esx-08",
          name: "esx-08",
          healthReadings: shortRun,
        }),
        datacenter: null,
        now: NOW,
        rules,
      }).severity,
    ).toBe(ResourceAttentionSeverity.Warning);
  });

  test("a VM swapping out for its wait is critical; swapping for a moment is not", () => {
    const rules: VMwareHealthRuleBook = book([], {
      vmSwapEvaluationMinutes: 5,
    });
    const swappingNow: RowFields = {
      memorySwappedBytes: 64 * MIB,
      memorySwapOutBytesPerSecond: 256 * KIB,
      cpuReadinessPercent: 1,
    };
    expect(
      assessVMwareVirtualMachine({
        vm: vm({
          ...swappingNow,
          healthReadings: [
            { t: NOW_SECONDS - 300, so: 0, sw: 64 * MIB },
            { t: NOW_SECONDS - 120, so: 0, sw: 64 * MIB },
            { t: NOW_SECONDS, so: 256 * KIB, sw: 64 * MIB },
          ],
        }),
        now: NOW,
        rules,
      }).severity,
    ).toBeNull();
    expect(
      assessVMwareVirtualMachine({
        vm: vm({
          ...swappingNow,
          healthReadings: readings(6, { so: 256 * KIB, sw: 64 * MIB }),
        }),
        now: NOW,
        rules,
      }).severity,
    ).toBe(ResourceAttentionSeverity.Critical);
  });

  test("Needs attention says since when a waited rule held", () => {
    const items: Array<ResourceAttentionItem> = getVMwareAttentionItems({
      rows: [
        host({ healthReadings: readings(12, { cpu: 95, mem: 40 }) }),
        datastore({ latestDiskPercent: 85 }),
      ],
      now: NOW,
      routeFor: (): Route => {
        return new Route("/x");
      },
      rules: book([], { hostEvaluationMinutes: 10 }),
    });
    const hostItem: ResourceAttentionItem = items.find(
      (item: ResourceAttentionItem): boolean => {
        return item.name === "esx-07";
      },
    )!;
    expect(hostItem.since).toEqual({
      at: new Date((NOW_SECONDS - 12 * 60) * 1000),
      template: SINCE_RULE_BEGAN,
    });
    // The datastore's rules do not wait: no since.
    const storeItem: ResourceAttentionItem = items.find(
      (item: ResourceAttentionItem): boolean => {
        return item.name === "vsan-a";
      },
    )!;
    expect(storeItem.since).toBeUndefined();
    expect(SINCE_RULE_BEGAN).toBe("Began {{time}}");
  });
});

describe("reading the VMs that may need attention, by the strictest rules of the vCenter", () => {
  test("a VM override stricter than the project's lowers the read's line, so its VM is read", () => {
    const rules: VMwareHealthRuleBook = book([
      override({
        scope: VMwareHealthRuleScope.VirtualMachine,
        resourceExternalId: "vm/web-01",
        rules: { vmCpuReadyWarningPercent: 3, vmBalloonedWarningMebibytes: 64 },
      }),
    ]);
    const strictest: VMwareHealthRules = getVMwareStrictestVirtualMachineRules(
      rules,
      PROD,
    );
    expect(strictest.vmCpuReadyWarningPercent).toBe(3);
    // The project's 0 MiB is stricter than the VM's 64.
    expect(strictest.vmBalloonedWarningMebibytes).toBe(0);
    expect(getVMwareAttentionConditions(rules, PROD)).toContainEqual({
      cpuReadinessPercent: new GreaterThan<number>(3),
    });
  });

  test("another vCenter's overrides do not change this vCenter's read", () => {
    const rules: VMwareHealthRuleBook = book([
      override({
        vmwareVCenterId: LAB,
        scope: VMwareHealthRuleScope.VCenter,
        rules: { vmCpuReadyWarningPercent: 1 },
      }),
    ]);
    expect(
      getVMwareStrictestVirtualMachineRules(rules, PROD)
        .vmCpuReadyWarningPercent,
    ).toBe(10);
    expect(
      getVMwareStrictestVirtualMachineRules(rules, LAB)
        .vmCpuReadyWarningPercent,
    ).toBe(1);
  });

  test("a rule is left unread only where it is off everywhere", () => {
    const rules: VMwareHealthRuleBook = book(
      [
        override({
          scope: VMwareHealthRuleScope.Host,
          resourceExternalId: "host/DC-NORTH/esx-07",
          hostName: "esx-07",
          rules: { vmBalloonedWarningMebibytes: 512 },
        }),
      ],
      { vmBalloonedWarningMebibytes: null },
    );
    expect(getVMwareAttentionConditions(rules, PROD)).toContainEqual({
      memoryBalloonedBytes: new GreaterThan<number>(512 * MIB),
    });
    // An override turning a rule off never stops the read the project's needs.
    const off: VMwareHealthRuleBook = book([
      override({
        scope: VMwareHealthRuleScope.VCenter,
        rules: { vmCpuReadyWarningPercent: null },
      }),
    ]);
    expect(
      getVMwareStrictestVirtualMachineRules(off, PROD).vmCpuReadyWarningPercent,
    ).toBe(10);
  });

  test("the project's rules alone are read as they are", () => {
    const resolved: VMwareHealthRules = {
      ...DEFAULT_VMWARE_HEALTH_RULES,
      vmCpuReadyWarningPercent: 25,
    };
    expect(getVMwareStrictestVirtualMachineRules(resolved, PROD)).toBe(
      resolved,
    );
  });
});

describe("the lists: each row's status, bars and cells by its own rules", () => {
  const hotHost: VMwareHealthRuleOverrideEntry = override({
    scope: VMwareHealthRuleScope.Host,
    resourceExternalId: "host/DC-NORTH/esx-07",
    hostName: "esx-07",
    clusterName: "cluster-a",
    rules: { hostCpuWarningPercent: 99, vmCpuReadyWarningPercent: null },
  });
  const context: VMwareListContext = {
    datacenters: [],
    hosts: [],
    now: NOW,
    rules: book([hotHost]),
  };

  test("a host with rules of its own draws its bars at its own line, and is not marked", () => {
    const own: InfrastructureResource = toVMwareListResource(host(), context);
    expect(own.metricThresholds).toEqual({
      cpu: { warning: 99 },
      memory: { warning: 90 },
    });
    expect(own.statusReasons).toEqual([]);

    // Its neighbour keeps the project's line, and its CPU at 95% is a reason.
    const neighbour: InfrastructureResource = toVMwareListResource(
      host({ externalId: "host/DC-NORTH/esx-08", name: "esx-08" }),
      context,
    );
    expect(neighbour.metricThresholds).toEqual({
      cpu: { warning: 90 },
      memory: { warning: 90 },
    });
    expect(neighbour.statusReasons!.length).toBeGreaterThan(0);
  });

  test("a VM on that host: its CPU Ready cell follows the host's rule, off; a VM elsewhere the project's", () => {
    const onHost: InfrastructureResource = toVMwareListResource(vm(), context);
    expect(getVMwareCpuReadyTone(onHost, context.rules)).toBeUndefined();
    expect(onHost.statusReasons).toEqual([]);

    const elsewhere: InfrastructureResource = toVMwareListResource(
      vm({ externalId: "vm/web-09", name: "web-09", hostName: "esx-09" }),
      context,
    );
    expect(getVMwareCpuReadyTone(elsewhere, context.rules)).toBe("warning");
    expect(elsewhere.statusReasons!.length).toBeGreaterThan(0);
  });

  test("a cluster's row draws its bars at its own cluster's line", () => {
    const rules: VMwareHealthRuleBook = book([
      override({
        scope: VMwareHealthRuleScope.Cluster,
        resourceExternalId: "cluster/DC-NORTH/cluster-a",
        clusterName: "cluster-a",
        rules: { hostCpuWarningPercent: 75, hostMemoryWarningPercent: 80 },
      }),
    ]);
    const cluster: InfrastructureResource = toVMwareListResource(
      row({
        kind: VMwareResourceKind.Cluster,
        externalId: "cluster/DC-NORTH/cluster-a",
        name: "cluster-a",
      }),
      { ...context, rules },
    );
    expect(cluster.metricThresholds).toEqual({
      cpu: { warning: 75 },
      memory: { warning: 80 },
    });
    const other: InfrastructureResource = toVMwareListResource(
      row({
        kind: VMwareResourceKind.Cluster,
        externalId: "cluster/DC-NORTH/cluster-b",
        name: "cluster-b",
      }),
      { ...context, rules },
    );
    expect(other.metricThresholds).toEqual({
      cpu: { warning: 90 },
      memory: { warning: 90 },
    });
  });

  test("a resource pool's swap cell follows its cluster's rule", () => {
    const rules: VMwareHealthRuleBook = book([
      override({
        scope: VMwareHealthRuleScope.Cluster,
        resourceExternalId: "cluster/DC-NORTH/cluster-a",
        clusterName: "cluster-a",
        rules: { resourcePoolSwapOutWarningKibPerSecond: 1024 },
      }),
    ]);
    const listed: InfrastructureResource = toVMwareListResource(pool(), {
      ...context,
      rules,
    });
    // 512 KiB/s, under the cluster's 1 MiB/s: no amber, no reason.
    expect(getVMwareResourcePoolMemoryTone(listed, rules)).toBeUndefined();
    expect(listed.statusReasons).toEqual([]);
    // The project's rule would warn at any rate.
    expect(getVMwareResourcePoolMemoryTone(listed, book([]))).toBe("warning");
  });

  test("handed no rules, every row draws the defaults", () => {
    const bare: InfrastructureResource = toVMwareListResource(host(), {
      datacenters: [],
      hosts: [],
      now: NOW,
    });
    expect(bare.metricThresholds).toEqual({
      cpu: { warning: 90 },
      memory: { warning: 90 },
    });
  });
});
