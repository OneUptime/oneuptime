import { VMwareResourceKind } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import {
  VMWARE_HEALTH_RULE_SCOPES,
  VMWARE_HEALTH_RULE_SCOPE_KIND,
  VMWARE_HEALTH_RULE_SCOPE_RULES,
  VMWARE_HEALTH_RULE_VCENTER_PART_KIND,
  VMwareHealthRuleBook,
  VMwareHealthRuleOrigin,
  VMwareHealthRuleOverrideEntry,
  VMwareHealthRulePart,
  VMwareHealthRuleScope,
  cleanVMwareHealthRuleOverrideRules,
  doesVMwareHealthRuleOverrideCover,
  explainVMwareHealthRules,
  getVMwareHealthRuleBook,
  getVMwareHealthRuleOverrideRulesRefusal,
  getVMwareHealthRuleOverridesFor,
  getVMwareHealthRulesForPart,
  isVMwareHealthRuleBook,
  readVMwareHealthRuleOverrideValue,
  resolveVMwareHealthRules,
} from "../../../Types/VMware/VMwareHealthRuleOverrides";
import {
  DEFAULT_VMWARE_HEALTH_RULES,
  VMWARE_HEALTH_PERIOD_RULE_KEYS,
  VMWARE_HEALTH_RULE_KEYS,
  VMwareHealthRuleKey,
  VMwareHealthRules,
} from "../../../Types/VMware/VMwareHealthRules";
import { describe, expect, test } from "@jest/globals";

/*
 * A vCenter's, a cluster's, an ESXi host's or a VM's own health rules
 * (#11469), resolved for each part the way every page that judges it
 * resolves them: rule by rule, the most specific override that sets a rule
 * wins - a VM's over its host's over its cluster's over its vCenter's over
 * the project's - and a rule nothing sets is the project's.
 *
 * The estate below is one vCenter (VC_PROD) with two datacenters that each
 * hold a cluster called "cluster-a" (vSphere names a cluster within its
 * datacenter), a host in each, a standalone host, VMs, a resource pool, a
 * datastore; and a second vCenter (VC_LAB) whose parts share every name.
 */

const VC_PROD: string = "11111111-1111-4111-8111-111111111111";
const VC_LAB: string = "22222222-2222-4222-8222-222222222222";

const PROJECT_RULES: VMwareHealthRules = {
  ...DEFAULT_VMWARE_HEALTH_RULES,
  hostCpuWarningPercent: 85,
};

const CLUSTER_NORTH: VMwareHealthRulePart = {
  vmwareVCenterId: VC_PROD,
  kind: VMwareResourceKind.Cluster,
  externalId: "cluster/DC-NORTH/cluster-a",
  name: "cluster-a",
  datacenterName: "DC-NORTH",
  clusterName: null,
  hostName: null,
};

const CLUSTER_SOUTH: VMwareHealthRulePart = {
  ...CLUSTER_NORTH,
  externalId: "cluster/DC-SOUTH/cluster-a",
  datacenterName: "DC-SOUTH",
};

const HOST_NORTH: VMwareHealthRulePart = {
  vmwareVCenterId: VC_PROD,
  kind: VMwareResourceKind.Host,
  externalId: "host/DC-NORTH/esx-07.acme.lan",
  name: "esx-07.acme.lan",
  datacenterName: "DC-NORTH",
  clusterName: "cluster-a",
  hostName: null,
};

const HOST_SOUTH: VMwareHealthRulePart = {
  ...HOST_NORTH,
  externalId: "host/DC-SOUTH/esx-21.acme.lan",
  name: "esx-21.acme.lan",
  datacenterName: "DC-SOUTH",
};

const STANDALONE_HOST: VMwareHealthRulePart = {
  vmwareVCenterId: VC_PROD,
  kind: VMwareResourceKind.Host,
  externalId: "host/DC-NORTH/esx-solo.acme.lan",
  name: "esx-solo.acme.lan",
  datacenterName: "DC-NORTH",
  clusterName: null,
  hostName: null,
};

const VM_NORTH: VMwareHealthRulePart = {
  vmwareVCenterId: VC_PROD,
  kind: VMwareResourceKind.VirtualMachine,
  externalId: "vm/4a1c9e72-0000-4000-8000-000000000001",
  name: "web-01",
  datacenterName: "DC-NORTH",
  clusterName: "cluster-a",
  hostName: "esx-07.acme.lan",
};

const VM_NORTH_NEIGHBOUR: VMwareHealthRulePart = {
  ...VM_NORTH,
  externalId: "vm/4a1c9e72-0000-4000-8000-000000000002",
  name: "web-02",
};

const VM_SOUTH: VMwareHealthRulePart = {
  ...VM_NORTH,
  externalId: "vm/4a1c9e72-0000-4000-8000-000000000003",
  datacenterName: "DC-SOUTH",
  hostName: "esx-21.acme.lan",
};

const VM_ON_STANDALONE: VMwareHealthRulePart = {
  vmwareVCenterId: VC_PROD,
  kind: VMwareResourceKind.VirtualMachine,
  externalId: "vm/4a1c9e72-0000-4000-8000-000000000004",
  name: "db-01",
  datacenterName: "DC-NORTH",
  clusterName: null,
  hostName: "esx-solo.acme.lan",
};

const POOL_NORTH: VMwareHealthRulePart = {
  vmwareVCenterId: VC_PROD,
  kind: VMwareResourceKind.ResourcePool,
  externalId: "pool/DC-NORTH/cluster-a/batch",
  name: "batch",
  datacenterName: "DC-NORTH",
  clusterName: "cluster-a",
  hostName: null,
};

const DATASTORE_NORTH: VMwareHealthRulePart = {
  vmwareVCenterId: VC_PROD,
  kind: VMwareResourceKind.Datastore,
  externalId: "datastore/DC-NORTH/vsan-a",
  name: "vsan-a",
  datacenterName: "DC-NORTH",
  clusterName: null,
  hostName: null,
};

const VCENTER_TOTAL: VMwareHealthRulePart = {
  vmwareVCenterId: VC_PROD,
  kind: VMWARE_HEALTH_RULE_VCENTER_PART_KIND,
};

const LAB_VM: VMwareHealthRulePart = { ...VM_NORTH, vmwareVCenterId: VC_LAB };

function override(
  data: Partial<VMwareHealthRuleOverrideEntry> & {
    scope: VMwareHealthRuleScope;
  },
): VMwareHealthRuleOverrideEntry {
  return {
    vmwareVCenterId: VC_PROD,
    resourceExternalId: null,
    datacenterName: null,
    clusterName: null,
    hostName: null,
    rules: {},
    ...data,
  };
}

const PROD_VCENTER: VMwareHealthRuleOverrideEntry = override({
  id: "o-vcenter",
  scope: VMwareHealthRuleScope.VCenter,
  rules: {
    hostCpuWarningPercent: 95,
    datastoreWarningPercent: 70,
    vmCpuReadyWarningPercent: 20,
  },
});

const NORTH_CLUSTER: VMwareHealthRuleOverrideEntry = override({
  id: "o-cluster",
  scope: VMwareHealthRuleScope.Cluster,
  resourceExternalId: CLUSTER_NORTH.externalId!,
  resourceName: "cluster-a",
  datacenterName: "DC-NORTH",
  clusterName: "cluster-a",
  rules: { hostCpuWarningPercent: 99, hostEvaluationMinutes: 10 },
});

const NORTH_HOST: VMwareHealthRuleOverrideEntry = override({
  id: "o-host",
  scope: VMwareHealthRuleScope.Host,
  resourceExternalId: HOST_NORTH.externalId!,
  resourceName: "esx-07.acme.lan",
  datacenterName: "DC-NORTH",
  clusterName: "cluster-a",
  hostName: "esx-07.acme.lan",
  rules: { hostMemoryWarningPercent: 97, vmCpuReadyWarningPercent: 30 },
});

const NORTH_VM: VMwareHealthRuleOverrideEntry = override({
  id: "o-vm",
  scope: VMwareHealthRuleScope.VirtualMachine,
  resourceExternalId: VM_NORTH.externalId!,
  resourceName: "web-01",
  datacenterName: "DC-NORTH",
  clusterName: "cluster-a",
  hostName: "esx-07.acme.lan",
  rules: { vmCpuReadyWarningPercent: null, vmSwapEvaluationMinutes: 5 },
});

const BOOK: VMwareHealthRuleBook = getVMwareHealthRuleBook(PROJECT_RULES, [
  // Made most specific first: the order applied is by scope, not by age.
  NORTH_VM,
  NORTH_HOST,
  NORTH_CLUSTER,
  PROD_VCENTER,
]);

describe("the scopes", () => {
  test("are applied least specific first, a vCenter's to a VM's", () => {
    expect(VMWARE_HEALTH_RULE_SCOPES).toEqual([
      VMwareHealthRuleScope.VCenter,
      VMwareHealthRuleScope.Cluster,
      VMwareHealthRuleScope.Host,
      VMwareHealthRuleScope.VirtualMachine,
    ]);
  });

  test("name the kind of part an override of each is about, none for a vCenter", () => {
    expect(VMWARE_HEALTH_RULE_SCOPE_KIND).toEqual({
      VCenter: null,
      Cluster: VMwareResourceKind.Cluster,
      Host: VMwareResourceKind.Host,
      VirtualMachine: VMwareResourceKind.VirtualMachine,
    });
  });

  test("a vCenter's override may set every rule, a VM's only the VM rules", () => {
    expect([...VMWARE_HEALTH_RULE_SCOPE_RULES.VCenter].sort()).toEqual(
      [...VMWARE_HEALTH_RULE_KEYS].sort(),
    );
    expect(VMWARE_HEALTH_RULE_SCOPE_RULES.VirtualMachine).toEqual([
      "vmSwapOutCriticalKibPerSecond",
      "vmSwapInWarningKibPerSecond",
      "vmSwappedWarningMebibytes",
      "vmSwapEvaluationMinutes",
      "vmBalloonedWarningMebibytes",
      "vmCpuReadyWarningPercent",
      "vmMemoryCpuEvaluationMinutes",
    ]);
  });

  test("a datastore belongs to no cluster or host: only a vCenter's override reaches its rules", () => {
    for (const scope of [
      VMwareHealthRuleScope.Cluster,
      VMwareHealthRuleScope.Host,
      VMwareHealthRuleScope.VirtualMachine,
    ]) {
      for (const key of [
        "datastoreWarningPercent",
        "datastoreCriticalPercent",
        "datastoreEvaluationMinutes",
      ] as Array<VMwareHealthRuleKey>) {
        expect({ scope, key, allowed: false }).toEqual({
          scope,
          key,
          allowed: VMWARE_HEALTH_RULE_SCOPE_RULES[scope].includes(key),
        });
      }
    }
  });

  test("a cluster's and a host's override reach their hosts, VMs and pools", () => {
    for (const scope of [
      VMwareHealthRuleScope.Cluster,
      VMwareHealthRuleScope.Host,
    ]) {
      expect(VMWARE_HEALTH_RULE_SCOPE_RULES[scope]).toEqual(
        expect.arrayContaining([
          "hostCpuWarningPercent",
          "hostMemoryWarningPercent",
          "hostEvaluationMinutes",
          "vmSwapOutCriticalKibPerSecond",
          "vmCpuReadyWarningPercent",
          "resourcePoolSwapOutWarningKibPerSecond",
          "resourcePoolEvaluationMinutes",
        ]),
      );
    }
  });
});

describe("the rule book", () => {
  test("is the defaults and no overrides when nothing is known", () => {
    const book: VMwareHealthRuleBook = getVMwareHealthRuleBook();
    expect(book).toEqual({
      project: { ...DEFAULT_VMWARE_HEALTH_RULES },
      overrides: [],
    });
    // A copy: changing a book never changes the defaults.
    book.project.hostCpuWarningPercent = 1;
    expect(DEFAULT_VMWARE_HEALTH_RULES.hostCpuWarningPercent).toBe(90);
  });

  test("is told from a project's rules alone", () => {
    expect(isVMwareHealthRuleBook(BOOK)).toBe(true);
    expect(isVMwareHealthRuleBook(PROJECT_RULES)).toBe(false);
    expect(isVMwareHealthRuleBook(null)).toBe(false);
    expect(isVMwareHealthRuleBook(undefined)).toBe(false);
    expect(isVMwareHealthRuleBook({ overrides: [] })).toBe(false);
    expect(isVMwareHealthRuleBook({ project: {}, overrides: {} })).toBe(false);
  });
});

describe("what an override covers", () => {
  test("a vCenter's: everything in its vCenter, and nothing in another", () => {
    for (const part of [
      CLUSTER_NORTH,
      CLUSTER_SOUTH,
      HOST_NORTH,
      STANDALONE_HOST,
      VM_NORTH,
      VM_ON_STANDALONE,
      POOL_NORTH,
      DATASTORE_NORTH,
      VCENTER_TOTAL,
    ]) {
      expect({
        part: part.externalId || part.kind,
        covered: doesVMwareHealthRuleOverrideCover(PROD_VCENTER, part),
      }).toEqual({ part: part.externalId || part.kind, covered: true });
    }
    expect(doesVMwareHealthRuleOverrideCover(PROD_VCENTER, LAB_VM)).toBe(false);
  });

  test("a vCenter's override knows its vCenter by id, as a string or an ObjectID", () => {
    expect(
      doesVMwareHealthRuleOverrideCover(PROD_VCENTER, {
        ...VM_NORTH,
        vmwareVCenterId: {
          toString: (): string => {
            return VC_PROD;
          },
        },
      }),
    ).toBe(true);
    expect(
      doesVMwareHealthRuleOverrideCover(PROD_VCENTER, {
        ...VM_NORTH,
        vmwareVCenterId: null,
      }),
    ).toBe(false);
    expect(
      doesVMwareHealthRuleOverrideCover(
        { ...PROD_VCENTER, vmwareVCenterId: "" },
        { ...VM_NORTH, vmwareVCenterId: "" },
      ),
    ).toBe(false);
  });

  test("a cluster's: the cluster, its hosts, their VMs and its pools", () => {
    for (const part of [CLUSTER_NORTH, HOST_NORTH, VM_NORTH, POOL_NORTH]) {
      expect({
        part: part.externalId,
        covered: doesVMwareHealthRuleOverrideCover(NORTH_CLUSTER, part),
      }).toEqual({ part: part.externalId, covered: true });
    }
  });

  test("a cluster's does not reach the same-named cluster of another datacenter, or its parts", () => {
    for (const part of [CLUSTER_SOUTH, HOST_SOUTH, VM_SOUTH]) {
      expect({
        part: part.externalId,
        covered: doesVMwareHealthRuleOverrideCover(NORTH_CLUSTER, part),
      }).toEqual({ part: part.externalId, covered: false });
    }
  });

  test("a cluster's does not reach a standalone host, its VMs, a datastore or the vCenter's total", () => {
    for (const part of [
      STANDALONE_HOST,
      VM_ON_STANDALONE,
      DATASTORE_NORTH,
      VCENTER_TOTAL,
    ]) {
      expect(doesVMwareHealthRuleOverrideCover(NORTH_CLUSTER, part)).toBe(
        false,
      );
    }
  });

  test("a cluster's reads names as vSphere does: case and spaces aside", () => {
    expect(
      doesVMwareHealthRuleOverrideCover(NORTH_CLUSTER, {
        ...VM_NORTH,
        clusterName: "  CLUSTER-A ",
        datacenterName: "dc-north",
      }),
    ).toBe(true);
  });

  test("a part that does not say its datacenter is still the cluster's, by name", () => {
    expect(
      doesVMwareHealthRuleOverrideCover(NORTH_CLUSTER, {
        ...VM_NORTH,
        datacenterName: null,
      }),
    ).toBe(true);
  });

  test("a cluster renamed since the override still has its rules, by its id", () => {
    expect(
      doesVMwareHealthRuleOverrideCover(NORTH_CLUSTER, {
        ...CLUSTER_NORTH,
        name: "cluster-a-renamed",
      }),
    ).toBe(true);
  });

  test("a host's: the host and the VMs on it, and no other host", () => {
    expect(doesVMwareHealthRuleOverrideCover(NORTH_HOST, HOST_NORTH)).toBe(
      true,
    );
    expect(doesVMwareHealthRuleOverrideCover(NORTH_HOST, VM_NORTH)).toBe(true);
    expect(
      doesVMwareHealthRuleOverrideCover(NORTH_HOST, VM_NORTH_NEIGHBOUR),
    ).toBe(true);
    for (const part of [
      HOST_SOUTH,
      VM_SOUTH,
      STANDALONE_HOST,
      VM_ON_STANDALONE,
      CLUSTER_NORTH,
      DATASTORE_NORTH,
      VCENTER_TOTAL,
    ]) {
      expect({
        part: part.externalId || part.kind,
        covered: doesVMwareHealthRuleOverrideCover(NORTH_HOST, part),
      }).toEqual({ part: part.externalId || part.kind, covered: false });
    }
  });

  test("a standalone host's reaches its VMs and the pools it holds", () => {
    const solo: VMwareHealthRuleOverrideEntry = override({
      scope: VMwareHealthRuleScope.Host,
      resourceExternalId: STANDALONE_HOST.externalId!,
      datacenterName: "DC-NORTH",
      hostName: "esx-solo.acme.lan",
      rules: { resourcePoolSwapOutWarningKibPerSecond: 512 },
    });
    const soloPool: VMwareHealthRulePart = {
      vmwareVCenterId: VC_PROD,
      kind: VMwareResourceKind.ResourcePool,
      externalId: "pool/DC-NORTH/esx-solo/Resources",
      name: "Resources",
      datacenterName: "DC-NORTH",
      clusterName: null,
      hostName: "esx-solo.acme.lan",
    };
    expect(doesVMwareHealthRuleOverrideCover(solo, STANDALONE_HOST)).toBe(true);
    expect(doesVMwareHealthRuleOverrideCover(solo, VM_ON_STANDALONE)).toBe(
      true,
    );
    expect(doesVMwareHealthRuleOverrideCover(solo, soloPool)).toBe(true);
    expect(doesVMwareHealthRuleOverrideCover(solo, VM_NORTH)).toBe(false);
  });

  test("a VM's: that VM alone, by its id - never another VM of its name", () => {
    expect(doesVMwareHealthRuleOverrideCover(NORTH_VM, VM_NORTH)).toBe(true);
    expect(
      doesVMwareHealthRuleOverrideCover(NORTH_VM, {
        ...VM_NORTH_NEIGHBOUR,
        name: "web-01",
      }),
    ).toBe(false);
    expect(doesVMwareHealthRuleOverrideCover(NORTH_VM, HOST_NORTH)).toBe(false);
    expect(doesVMwareHealthRuleOverrideCover(NORTH_VM, LAB_VM)).toBe(false);
    expect(
      doesVMwareHealthRuleOverrideCover(
        { ...NORTH_VM, resourceExternalId: null },
        VM_NORTH,
      ),
    ).toBe(false);
  });

  test("an override of no scope this build knows covers nothing", () => {
    expect(
      doesVMwareHealthRuleOverrideCover(
        override({ scope: "Datacenter" as VMwareHealthRuleScope }),
        VM_NORTH,
      ),
    ).toBe(false);
  });
});

describe("which overrides apply to a part, and in which order", () => {
  test("least specific first, whatever order they were made in", () => {
    expect(
      getVMwareHealthRuleOverridesFor(BOOK, VM_NORTH).map(
        (entry: VMwareHealthRuleOverrideEntry): string | undefined => {
          return entry.id;
        },
      ),
    ).toEqual(["o-vcenter", "o-cluster", "o-host", "o-vm"]);
  });

  test("a part covered by none has none", () => {
    expect(getVMwareHealthRuleOverridesFor(BOOK, LAB_VM)).toEqual([]);
  });

  test("two of one scope apply in the order they were made", () => {
    const first: VMwareHealthRuleOverrideEntry = override({
      id: "first",
      scope: VMwareHealthRuleScope.Cluster,
      clusterName: "cluster-a",
      rules: { hostCpuWarningPercent: 91 },
    });
    const second: VMwareHealthRuleOverrideEntry = override({
      id: "second",
      scope: VMwareHealthRuleScope.Cluster,
      clusterName: "CLUSTER-A",
      rules: { hostCpuWarningPercent: 92 },
    });
    const book: VMwareHealthRuleBook = getVMwareHealthRuleBook(PROJECT_RULES, [
      first,
      second,
    ]);
    expect(
      resolveVMwareHealthRules(book, HOST_NORTH).hostCpuWarningPercent,
    ).toBe(92);
  });
});

describe("the rules each part is judged by", () => {
  test("a VM: its own over its host's over its cluster's over its vCenter's over the project's", () => {
    const rules: VMwareHealthRules = resolveVMwareHealthRules(BOOK, VM_NORTH);
    expect(rules).toEqual({
      ...PROJECT_RULES,
      // The vCenter's, the cluster's, then the host's: the host's wins.
      hostCpuWarningPercent: 99,
      hostMemoryWarningPercent: 97,
      datastoreWarningPercent: 70,
      hostEvaluationMinutes: 10,
      // The host said 30, the VM turned the rule off.
      vmCpuReadyWarningPercent: null,
      vmSwapEvaluationMinutes: 5,
    });
  });

  test("its neighbour on the same host: the host's, not the VM's", () => {
    expect(
      resolveVMwareHealthRules(BOOK, VM_NORTH_NEIGHBOUR)
        .vmCpuReadyWarningPercent,
    ).toBe(30);
    expect(
      resolveVMwareHealthRules(BOOK, VM_NORTH_NEIGHBOUR)
        .vmSwapEvaluationMinutes,
    ).toBe(0);
  });

  test("a host: its own and its cluster's over the vCenter's", () => {
    const rules: VMwareHealthRules = resolveVMwareHealthRules(BOOK, HOST_NORTH);
    expect(rules.hostCpuWarningPercent).toBe(99);
    expect(rules.hostMemoryWarningPercent).toBe(97);
    expect(rules.hostEvaluationMinutes).toBe(10);
  });

  test("a host of the same-named cluster in another datacenter: the vCenter's", () => {
    const rules: VMwareHealthRules = resolveVMwareHealthRules(BOOK, HOST_SOUTH);
    expect(rules.hostCpuWarningPercent).toBe(95);
    expect(rules.hostMemoryWarningPercent).toBe(
      PROJECT_RULES.hostMemoryWarningPercent,
    );
    expect(rules.hostEvaluationMinutes).toBe(0);
  });

  test("a datastore and the vCenter's storage total: the vCenter's", () => {
    expect(
      resolveVMwareHealthRules(BOOK, DATASTORE_NORTH).datastoreWarningPercent,
    ).toBe(70);
    expect(
      resolveVMwareHealthRules(BOOK, VCENTER_TOTAL).datastoreWarningPercent,
    ).toBe(70);
  });

  test("a part of another vCenter: the project's, every rule", () => {
    expect(resolveVMwareHealthRules(BOOK, LAB_VM)).toEqual(PROJECT_RULES);
  });

  test("a book with no overrides judges every part by the project's rules", () => {
    const book: VMwareHealthRuleBook = getVMwareHealthRuleBook(PROJECT_RULES);
    for (const part of [VM_NORTH, HOST_NORTH, DATASTORE_NORTH, VCENTER_TOTAL]) {
      expect(resolveVMwareHealthRules(book, part)).toEqual(PROJECT_RULES);
    }
  });

  test("a rule turned off by the project is turned back on by an override", () => {
    const book: VMwareHealthRuleBook = getVMwareHealthRuleBook(
      { ...PROJECT_RULES, vmBalloonedWarningMebibytes: null },
      [
        override({
          scope: VMwareHealthRuleScope.VCenter,
          rules: { vmBalloonedWarningMebibytes: 256 },
        }),
      ],
    );
    expect(
      resolveVMwareHealthRules(book, VM_NORTH).vmBalloonedWarningMebibytes,
    ).toBe(256);
    expect(
      resolveVMwareHealthRules(book, LAB_VM).vmBalloonedWarningMebibytes,
    ).toBeNull();
  });

  test("an override cannot turn a wait off: a period is the latest report at least", () => {
    const book: VMwareHealthRuleBook = getVMwareHealthRuleBook(
      { ...PROJECT_RULES, hostEvaluationMinutes: 15 },
      [
        override({
          scope: VMwareHealthRuleScope.VCenter,
          rules: { hostEvaluationMinutes: null },
        }),
      ],
    );
    // A null period is no value: the project's 15 minutes stay.
    expect(
      resolveVMwareHealthRules(book, HOST_NORTH).hostEvaluationMinutes,
    ).toBe(15);
  });

  test("a project period of nothing is read as the latest report", () => {
    const book: VMwareHealthRuleBook = getVMwareHealthRuleBook({
      ...PROJECT_RULES,
      hostEvaluationMinutes: null,
    });
    expect(
      resolveVMwareHealthRules(book, HOST_NORTH).hostEvaluationMinutes,
    ).toBe(0);
  });

  test("a rule an override's scope does not judge is not applied, even if stored", () => {
    const book: VMwareHealthRuleBook = getVMwareHealthRuleBook(PROJECT_RULES, [
      override({
        scope: VMwareHealthRuleScope.VirtualMachine,
        resourceExternalId: VM_NORTH.externalId!,
        rules: {
          hostCpuWarningPercent: 1,
          datastoreWarningPercent: 1,
        },
      }),
    ]);
    const rules: VMwareHealthRules = resolveVMwareHealthRules(book, VM_NORTH);
    expect(rules.hostCpuWarningPercent).toBe(85);
    expect(rules.datastoreWarningPercent).toBe(80);
  });

  test("a value no rule can be is inherited, never applied", () => {
    const book: VMwareHealthRuleBook = getVMwareHealthRuleBook(PROJECT_RULES, [
      override({
        scope: VMwareHealthRuleScope.VCenter,
        rules: {
          hostCpuWarningPercent: 140,
          hostMemoryWarningPercent: -5,
          datastoreWarningPercent: Number.NaN,
          hostEvaluationMinutes: 45,
          vmSwappedWarningMebibytes: "2048" as unknown as number,
        },
      }),
    ]);
    const rules: VMwareHealthRules = resolveVMwareHealthRules(book, HOST_NORTH);
    expect(rules.hostCpuWarningPercent).toBe(85);
    expect(rules.hostMemoryWarningPercent).toBe(90);
    expect(rules.datastoreWarningPercent).toBe(80);
    expect(rules.hostEvaluationMinutes).toBe(0);
    // A number sent as text is still the number.
    expect(rules.vmSwappedWarningMebibytes).toBe(2048);
  });

  test("an override with no rules object changes nothing", () => {
    const book: VMwareHealthRuleBook = getVMwareHealthRuleBook(PROJECT_RULES, [
      override({
        scope: VMwareHealthRuleScope.VCenter,
        rules: undefined as unknown as Record<string, number>,
      }),
    ]);
    expect(resolveVMwareHealthRules(book, HOST_NORTH)).toEqual(PROJECT_RULES);
  });

  test("resolving never changes the book", () => {
    const before: string = JSON.stringify(BOOK);
    resolveVMwareHealthRules(BOOK, VM_NORTH);
    explainVMwareHealthRules(BOOK, VM_NORTH);
    expect(JSON.stringify(BOOK)).toBe(before);
  });
});

describe("where each rule came from", () => {
  test("names the override that set it, or none for the project's", () => {
    const origins: Record<VMwareHealthRuleKey, VMwareHealthRuleOrigin> =
      explainVMwareHealthRules(BOOK, VM_NORTH);
    expect(origins.hostCpuWarningPercent.override?.id).toBe("o-cluster");
    expect(origins.hostMemoryWarningPercent.override?.id).toBe("o-host");
    expect(origins.datastoreWarningPercent.override?.id).toBe("o-vcenter");
    expect(origins.vmCpuReadyWarningPercent).toEqual({
      value: null,
      override: NORTH_VM,
    });
    expect(origins.vmSwapOutCriticalKibPerSecond).toEqual({
      value: PROJECT_RULES.vmSwapOutCriticalKibPerSecond,
      override: null,
    });
  });

  test("lists every rule", () => {
    expect(
      Object.keys(explainVMwareHealthRules(BOOK, VM_NORTH)).sort(),
    ).toEqual([...VMWARE_HEALTH_RULE_KEYS].sort());
  });
});

describe("the rules a page hands a judgement", () => {
  test("a book is resolved for the part", () => {
    expect(getVMwareHealthRulesForPart(BOOK, VM_NORTH)).toEqual(
      resolveVMwareHealthRules(BOOK, VM_NORTH),
    );
  });

  test("the project's rules alone are used as they are", () => {
    expect(getVMwareHealthRulesForPart(PROJECT_RULES, VM_NORTH)).toBe(
      PROJECT_RULES,
    );
  });

  test("nothing is the defaults, as a copy", () => {
    const rules: VMwareHealthRules = getVMwareHealthRulesForPart(
      undefined,
      VM_NORTH,
    );
    expect(rules).toEqual(DEFAULT_VMWARE_HEALTH_RULES);
    expect(rules).not.toBe(DEFAULT_VMWARE_HEALTH_RULES);
    expect(getVMwareHealthRulesForPart(null, VM_NORTH)).toEqual(
      DEFAULT_VMWARE_HEALTH_RULES,
    );
  });
});

describe("reading an override's value for a rule", () => {
  test("a number in range is set", () => {
    expect(
      readVMwareHealthRuleOverrideValue("hostCpuWarningPercent", 70),
    ).toEqual({ isSet: true, value: 70 });
    expect(
      readVMwareHealthRuleOverrideValue("hostEvaluationMinutes", 30),
    ).toEqual({ isSet: true, value: 30 });
    expect(
      readVMwareHealthRuleOverrideValue("vmSwapInWarningKibPerSecond", 0),
    ).toEqual({ isSet: true, value: 0 });
  });

  test("null turns a threshold off, and is no value for a period", () => {
    expect(
      readVMwareHealthRuleOverrideValue("hostCpuWarningPercent", null),
    ).toEqual({ isSet: true, value: null });
    expect(
      readVMwareHealthRuleOverrideValue("hostEvaluationMinutes", null),
    ).toEqual({ isSet: false, value: null });
  });

  test("absent, out of range or not a number is no value", () => {
    for (const [key, value] of [
      ["hostCpuWarningPercent", undefined],
      ["hostCpuWarningPercent", 101],
      ["hostCpuWarningPercent", -1],
      ["hostCpuWarningPercent", "lots"],
      ["hostEvaluationMinutes", 31],
      ["vmSwappedWarningMebibytes", Number.POSITIVE_INFINITY],
    ] as Array<[VMwareHealthRuleKey, unknown]>) {
      expect({
        key,
        value,
        read: readVMwareHealthRuleOverrideValue(key, value),
      }).toEqual({ key, value, read: { isSet: false, value: null } });
    }
  });
});

describe("what the server keeps of an override's rules", () => {
  test("the rules its scope judges, as sent", () => {
    expect(
      cleanVMwareHealthRuleOverrideRules(VMwareHealthRuleScope.Host, {
        hostCpuWarningPercent: 95,
        vmCpuReadyWarningPercent: null,
        hostEvaluationMinutes: 10,
      }),
    ).toEqual({
      hostCpuWarningPercent: 95,
      vmCpuReadyWarningPercent: null,
      hostEvaluationMinutes: 10,
    });
  });

  test("drops a rule its scope does not judge, an unknown key and a value no rule can be", () => {
    expect(
      cleanVMwareHealthRuleOverrideRules(VMwareHealthRuleScope.VirtualMachine, {
        hostCpuWarningPercent: 95,
        datastoreWarningPercent: 50,
        somethingElse: 3,
        vmCpuReadyWarningPercent: 140,
        vmSwapEvaluationMinutes: null,
        vmBalloonedWarningMebibytes: 512,
      }),
    ).toEqual({ vmBalloonedWarningMebibytes: 512 });
  });

  test("anything but an object is no rules", () => {
    for (const rules of [null, undefined, "x", 3, [1, 2]]) {
      expect(
        cleanVMwareHealthRuleOverrideRules(
          VMwareHealthRuleScope.VCenter,
          rules,
        ),
      ).toEqual({});
    }
  });
});

describe("why an override's rules are refused", () => {
  test("nothing to refuse in rules that every rule can take", () => {
    expect(
      getVMwareHealthRuleOverrideRulesRefusal(VMwareHealthRuleScope.VCenter, {
        hostCpuWarningPercent: 100,
        datastoreCriticalPercent: null,
        datastoreEvaluationMinutes: 0,
        vmSwapOutCriticalKibPerSecond: 4096,
        resourcePoolEvaluationMinutes: 30,
      }),
    ).toBeNull();
    expect(
      getVMwareHealthRuleOverrideRulesRefusal(
        VMwareHealthRuleScope.VCenter,
        undefined,
      ),
    ).toBeNull();
    expect(
      getVMwareHealthRuleOverrideRulesRefusal(
        VMwareHealthRuleScope.VCenter,
        null,
      ),
    ).toBeNull();
    // A key sent as undefined is a rule not sent.
    expect(
      getVMwareHealthRuleOverrideRulesRefusal(VMwareHealthRuleScope.VCenter, {
        hostCpuWarningPercent: undefined,
      }),
    ).toBeNull();
  });

  test("rules that are not a list of rules", () => {
    for (const rules of ["x", 3, [1]]) {
      expect(
        getVMwareHealthRuleOverrideRulesRefusal(
          VMwareHealthRuleScope.VCenter,
          rules,
        ),
      ).toBe("An override's rules are a list of rules and their values.");
    }
  });

  test("a key that is no rule names it", () => {
    expect(
      getVMwareHealthRuleOverrideRulesRefusal(VMwareHealthRuleScope.VCenter, {
        hostCpuWarning: 90,
      }),
    ).toBe('"hostCpuWarning" is not a VMware health rule.');
  });

  test("a rule the scope does not judge says where to set it", () => {
    expect(
      getVMwareHealthRuleOverrideRulesRefusal(
        VMwareHealthRuleScope.VirtualMachine,
        { hostCpuWarningPercent: 90 },
      ),
    ).toBe(
      "That rule judges nothing an override of this kind covers. Set it on a vCenter, a cluster or a host that holds what it judges.",
    );
    expect(
      getVMwareHealthRuleOverrideRulesRefusal(VMwareHealthRuleScope.Cluster, {
        datastoreWarningPercent: 90,
      }),
    ).not.toBeNull();
  });

  test("a wait that is not 0 to 30 whole minutes, or is off", () => {
    for (const value of [31, -1, 2.5, null, "soon"]) {
      expect({
        value,
        refusal: getVMwareHealthRuleOverrideRulesRefusal(
          VMwareHealthRuleScope.Host,
          { hostEvaluationMinutes: value },
        ),
      }).toEqual({
        value,
        refusal: "A wait is a whole number of minutes from 0 to 30.",
      });
    }
  });

  test("a threshold that is not a whole number in range", () => {
    for (const [key, value] of [
      ["hostCpuWarningPercent", 101],
      ["hostCpuWarningPercent", -1],
      ["vmSwapOutCriticalKibPerSecond", 0.5],
      ["vmSwappedWarningMebibytes", "much"],
    ] as Array<[VMwareHealthRuleKey, unknown]>) {
      expect({
        key,
        value,
        refusal: getVMwareHealthRuleOverrideRulesRefusal(
          VMwareHealthRuleScope.VCenter,
          { [key]: value },
        ),
      }).toEqual({
        key,
        value,
        refusal:
          "A threshold is a whole number from 0 (a percent up to 100), or Off to turn its rule off.",
      });
    }
  });

  test("every period rule is one a vCenter's override may wait on", () => {
    for (const key of VMWARE_HEALTH_PERIOD_RULE_KEYS) {
      expect(
        getVMwareHealthRuleOverrideRulesRefusal(VMwareHealthRuleScope.VCenter, {
          [key]: 30,
        }),
      ).toBeNull();
    }
  });
});
