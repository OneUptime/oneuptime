import { describe, expect, test } from "@jest/globals";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import { VMwareSwapRateSource } from "../../../Types/VMware/VMwareSwapRates";
import { VMwareResourceKind } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import {
  DEFAULT_VMWARE_HEALTH_RULES,
  VMwareHealthRules,
} from "../../../Types/VMware/VMwareHealthRules";
import {
  VMwareAssessment,
  assessVMwareDatastore,
  assessVMwareHost,
  assessVMwareResourcePool,
  assessVMwareSwappedMemory,
  assessVMwareVirtualMachine,
  formatVMwareReasonRate,
  getVMwareAttentionItems,
  getVMwareDatastoreStatus,
  getVMwareDatastoreUsageThresholds,
  getVMwareHostStatus,
  getVMwareSwapActivity,
  getVMwareThresholdLine,
  getVMwareVirtualMachineStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareHealth";
import { getVMwareAttentionConditions } from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareResourceUtils";
import {
  getVMwareCpuReadyPercentTone,
  getVMwareDatastoreFullTone,
  getVMwareHostLoadTone,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwarePartFacts";
import {
  getVMwareResourcePoolMemoryTone,
  getVMwareUsageBarThresholds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareResourceColumns";
import { InfrastructureResource } from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable";
import { ResourceAttentionSeverity } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import Route from "../../../Types/API/Route";

/*
 * THE BUILT-IN VMWARE HEALTH RULES AT EACH THRESHOLD (#11157).
 *
 * A VM showed as critical for "4.0 MiB of memory swapped by the host" -
 * 4,172 KB vCenter itself reported - because any swapped memory was
 * critical. ESXi leaves swapped pages in its swap file until the guest
 * touches them, so a VM keeps a few MiB long after the memory pressure that
 * put them there has gone. Now only the host swapping memory out now is
 * critical; reading swapped memory back is a warning above its rate;
 * memory left from earlier is a warning only above its amount. Every rule
 * is the project's to set (VMware > Settings > Health Rules), or to turn
 * off, and each is pinned here below, at and above its line, with the
 * defaults and with the project's own.
 */

const NOW: Date = new Date("2026-11-27T12:00:00.000Z");
const FRESH: Date = new Date(NOW.getTime() - 2 * 60 * 1000);
const KIB: number = 1024;
const MIB: number = 1024 * 1024;
const GIB: number = 1024 * 1024 * 1024;

type RowFields = {
  [Key in keyof VMwareResource]?: VMwareResource[Key] | undefined | unknown;
};

function row(fields: RowFields): VMwareResource {
  return Object.assign(new VMwareResource(), fields);
}

function vm(fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.VirtualMachine,
    externalId: "vm/4a1c9e72-5b3f-4c11-9d2e-7f1a2b3c4d5e",
    name: "web-frontend-03",
    hostName: "esx-node-07.acme.lan",
    datacenterName: "DC-NORTH",
    isTemplate: false,
    isPoweredOn: true,
    metricsUpdatedAt: FRESH,
    memorySwappedBytes: 0,
    memoryBalloonedBytes: 0,
    cpuReadinessPercent: 1,
    ...fields,
  });
}

function host(fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.Host,
    externalId: "host/DC-NORTH/esx-node-07.acme.lan",
    name: "esx-node-07.acme.lan",
    hostName: "esx-node-07.acme.lan",
    datacenterName: "DC-NORTH",
    metricsUpdatedAt: FRESH,
    latestCpuPercent: 40,
    latestCpuMhz: 9000,
    latestMemoryPercent: 50,
    latestMemoryBytes: 64 * GIB,
    ...fields,
  });
}

function datastore(percent: number): VMwareResource {
  return row({
    kind: VMwareResourceKind.Datastore,
    externalId: "datastore/DC-NORTH/DS_SSD_01",
    name: "DS_SSD_01",
    datacenterName: "DC-NORTH",
    metricsUpdatedAt: FRESH,
    latestDiskPercent: percent,
  });
}

function pool(fields: RowFields = {}): VMwareResource {
  return row({
    kind: VMwareResourceKind.ResourcePool,
    externalId: "resourcepool//DC-NORTH/host/cluster-alpha/Resources/Batch",
    name: "Batch",
    clusterName: "cluster-alpha",
    metricsUpdatedAt: FRESH,
    ...fields,
  });
}

function rules(overrides: Partial<VMwareHealthRules> = {}): VMwareHealthRules {
  return { ...DEFAULT_VMWARE_HEALTH_RULES, ...overrides };
}

function severity(
  assessment: VMwareAssessment,
): ResourceAttentionSeverity | null {
  return assessment.severity;
}

function texts(assessment: VMwareAssessment): Array<string> {
  return assessment.reasons.map((reason: { text: string }): string => {
    return reason.text;
  });
}

function vmAssessment(
  fields: RowFields,
  projectRules?: VMwareHealthRules | undefined,
): VMwareAssessment {
  return assessVMwareVirtualMachine({
    vm: vm(fields),
    now: NOW,
    rules: projectRules,
  });
}

describe("the issue's VM: 4.0 MiB swapped, nothing swapping now (#11157)", () => {
  // vCenter reported 4,172 KB; the receiver sends whole MiB.
  const residual: RowFields = {
    memorySwappedBytes: 4 * MIB,
    memorySwapOutBytesPerSecond: 0,
    memorySwapInBytesPerSecond: 0,
  };

  test("needs nothing: not critical, not even a warning", () => {
    expect(vmAssessment(residual)).toEqual({ severity: null, reasons: [] });
  });

  test("reads Running, in the calm tone of a VM that is fine", () => {
    expect(
      getVMwareVirtualMachineStatus({ vm: vm(residual), now: NOW }),
    ).toEqual({ label: "Running", tone: "positive" });
  });

  test("is not on the Overview's Needs attention list", () => {
    expect(
      getVMwareAttentionItems({
        rows: [vm(residual)],
        now: NOW,
        routeFor: (): Route => {
          return new Route("/vm");
        },
      }),
    ).toEqual([]);
  });

  test("would have been critical by the old rule: any swapped memory", () => {
    // The amount alone, as the old rule read it, still says 4.0 MiB.
    expect(getVMwareSwapActivity(vm(residual))).toEqual({
      swappedBytes: 4 * MIB,
      swapOutBytesPerSecond: 0,
      swapInBytesPerSecond: 0,
      isKnownIdle: true,
      // A row from before #11468 does not say where its rates came from.
      source: null,
    });
  });

  test("says where its rates came from: vSphere's counters, or worked out (#11468)", () => {
    for (const source of [
      VMwareSwapRateSource.VSphere,
      VMwareSwapRateSource.Derived,
    ]) {
      expect(
        getVMwareSwapActivity(vm({ ...residual, memorySwapRateSource: source }))
          .source,
      ).toBe(source);
    }
    // Not known while no rate is.
    expect(
      getVMwareSwapActivity(
        vm({
          memorySwappedBytes: 4 * MIB,
          memorySwapOutBytesPerSecond: null,
          memorySwapInBytesPerSecond: null,
          memorySwapRateSource: VMwareSwapRateSource.VSphere,
        }),
      ).source,
    ).toBeNull();
    expect(
      getVMwareSwapActivity(
        vm({ ...residual, memorySwapRateSource: "guessed" }),
      ).source,
    ).toBeNull();
  });

  test("the same VM while the host swaps it out again is critical", () => {
    const assessment: VMwareAssessment = vmAssessment({
      ...residual,
      memorySwappedBytes: 12 * MIB,
      memorySwapOutBytesPerSecond: (8 * MIB) / 120,
    });
    expect(severity(assessment)).toBe(ResourceAttentionSeverity.Critical);
    expect(assessment.reasons).toEqual([
      {
        text: "Host swapping memory out at {{rate}}",
        values: { rate: "68.3 KiB/s" },
      },
    ]);
  });
});

describe("swapping out now: critical above its rate (default any)", () => {
  test("just above 0 B/s is critical; exactly 0 is nothing", () => {
    expect(
      severity(
        vmAssessment({
          memorySwappedBytes: MIB,
          memorySwapOutBytesPerSecond: 0.01,
          memorySwapInBytesPerSecond: 0,
        }),
      ),
    ).toBe(ResourceAttentionSeverity.Critical);
    expect(
      severity(
        vmAssessment({
          memorySwappedBytes: MIB,
          memorySwapOutBytesPerSecond: 0,
          memorySwapInBytesPerSecond: 0,
        }),
      ),
    ).toBeNull();
  });

  test("a project's own rate: at the line is not past it, above it is", () => {
    const projectRules: VMwareHealthRules = rules({
      vmSwapOutCriticalKibPerSecond: 512,
    });
    expect(
      severity(
        vmAssessment(
          { memorySwappedBytes: GIB, memorySwapOutBytesPerSecond: 512 * KIB },
          projectRules,
        ),
      ),
    ).not.toBe(ResourceAttentionSeverity.Critical);
    expect(
      severity(
        vmAssessment(
          {
            memorySwappedBytes: GIB,
            memorySwapOutBytesPerSecond: 512 * KIB + 1,
          },
          projectRules,
        ),
      ),
    ).toBe(ResourceAttentionSeverity.Critical);
  });

  test("below a raised rate, a lot swapped still needs a look, said as swapped (it moves)", () => {
    const assessment: VMwareAssessment = vmAssessment(
      {
        memorySwappedBytes: 2 * GIB,
        memorySwapOutBytesPerSecond: 100 * KIB,
        memorySwapInBytesPerSecond: 0,
      },
      rules({ vmSwapOutCriticalKibPerSecond: 1024 }),
    );
    expect(severity(assessment)).toBe(ResourceAttentionSeverity.Warning);
    expect(texts(assessment)).toEqual([
      "{{amount}} of memory swapped by the host",
    ]);
  });

  test("turned off, swapping out is no finding of its own", () => {
    expect(
      severity(
        vmAssessment(
          {
            memorySwappedBytes: 512 * MIB,
            memorySwapOutBytesPerSecond: 10 * MIB,
          },
          rules({ vmSwapOutCriticalKibPerSecond: null }),
        ),
      ),
    ).toBeNull();
  });
});

describe("reading swapped memory back: a warning above its rate (default 1 MiB/s)", () => {
  test("just above 1024 KiB/s needs a look; at it, or below, is nothing", () => {
    const base: RowFields = {
      memorySwappedBytes: 64 * MIB,
      memorySwapOutBytesPerSecond: 0,
    };
    const above: VMwareAssessment = vmAssessment({
      ...base,
      memorySwapInBytesPerSecond: 1024 * KIB + 1,
    });
    expect(severity(above)).toBe(ResourceAttentionSeverity.Warning);
    expect(above.reasons).toEqual([
      {
        text: "Reading swapped memory back at {{rate}}",
        values: { rate: "1.0 MiB/s" },
      },
    ]);
    expect(
      severity(vmAssessment({ ...base, memorySwapInBytesPerSecond: MIB })),
    ).toBeNull();
    expect(
      severity(vmAssessment({ ...base, memorySwapInBytesPerSecond: 4 * KIB })),
    ).toBeNull();
  });

  test("a VM that has read every page back holds none, and is still found reading", () => {
    expect(
      severity(
        vmAssessment({
          memorySwappedBytes: 0,
          memorySwapOutBytesPerSecond: 0,
          memorySwapInBytesPerSecond: 3 * MIB,
        }),
      ),
    ).toBe(ResourceAttentionSeverity.Warning);
  });

  test("swapping out wins over reading back: one finding, the critical one", () => {
    const assessment: VMwareAssessment = assessVMwareSwappedMemory({
      activity: {
        swappedBytes: GIB,
        swapOutBytesPerSecond: MIB,
        swapInBytesPerSecond: 5 * MIB,
        isKnownIdle: false,
      },
      rules: rules(),
    });
    expect(severity(assessment)).toBe(ResourceAttentionSeverity.Critical);
    expect(texts(assessment)).toEqual(["Host swapping memory out at {{rate}}"]);
  });

  test("a project's own rate, and off", () => {
    expect(
      severity(
        vmAssessment(
          {
            memorySwappedBytes: 64 * MIB,
            memorySwapOutBytesPerSecond: 0,
            memorySwapInBytesPerSecond: 100 * KIB,
          },
          rules({ vmSwapInWarningKibPerSecond: 64 }),
        ),
      ),
    ).toBe(ResourceAttentionSeverity.Warning);
    expect(
      severity(
        vmAssessment(
          {
            memorySwappedBytes: 64 * MIB,
            memorySwapOutBytesPerSecond: 0,
            memorySwapInBytesPerSecond: 100 * MIB,
          },
          rules({ vmSwapInWarningKibPerSecond: null }),
        ),
      ),
    ).toBeNull();
  });
});

describe("memory left in the swap file from earlier: a warning above its amount (default 1 GiB)", () => {
  const idle: RowFields = {
    memorySwapOutBytesPerSecond: 0,
    memorySwapInBytesPerSecond: 0,
  };

  test("just above 1 GiB needs a look, said as swapped earlier; at 1 GiB or below it is nothing", () => {
    const above: VMwareAssessment = vmAssessment({
      ...idle,
      memorySwappedBytes: GIB + 1,
    });
    expect(severity(above)).toBe(ResourceAttentionSeverity.Warning);
    expect(above.reasons).toEqual([
      {
        text: "{{amount}} swapped earlier, none swapping now",
        values: { amount: "1.0 GiB" },
      },
    ]);
    expect(
      severity(vmAssessment({ ...idle, memorySwappedBytes: GIB })),
    ).toBeNull();
    expect(
      severity(vmAssessment({ ...idle, memorySwappedBytes: 900 * MIB })),
    ).toBeNull();
  });

  test("before two reports could be compared, the amount is said as swapped, not as earlier", () => {
    const unknown: VMwareAssessment = vmAssessment({
      memorySwappedBytes: 3 * GIB,
    });
    expect(severity(unknown)).toBe(ResourceAttentionSeverity.Warning);
    expect(texts(unknown)).toEqual([
      "{{amount}} of memory swapped by the host",
    ]);
  });

  test("never critical, whatever the amount", () => {
    expect(
      severity(vmAssessment({ ...idle, memorySwappedBytes: 500 * GIB })),
    ).toBe(ResourceAttentionSeverity.Warning);
  });

  test("a project's own amount, and off", () => {
    expect(
      severity(
        vmAssessment(
          { ...idle, memorySwappedBytes: 300 * MIB },
          rules({ vmSwappedWarningMebibytes: 256 }),
        ),
      ),
    ).toBe(ResourceAttentionSeverity.Warning);
    expect(
      severity(
        vmAssessment(
          { ...idle, memorySwappedBytes: 100 * GIB },
          rules({ vmSwappedWarningMebibytes: null }),
        ),
      ),
    ).toBeNull();
  });
});

describe("ballooning: a warning above its amount (default any)", () => {
  test("any ballooned memory needs a look; none is nothing", () => {
    expect(texts(vmAssessment({ memoryBalloonedBytes: 1 }))).toEqual([
      "{{amount}} of memory ballooned",
    ]);
    expect(severity(vmAssessment({ memoryBalloonedBytes: 0 }))).toBeNull();
  });

  test("a project's own amount: at the line is not past it", () => {
    const projectRules: VMwareHealthRules = rules({
      vmBalloonedWarningMebibytes: 512,
    });
    expect(
      severity(vmAssessment({ memoryBalloonedBytes: 512 * MIB }, projectRules)),
    ).toBeNull();
    expect(
      severity(
        vmAssessment({ memoryBalloonedBytes: 512 * MIB + 1 }, projectRules),
      ),
    ).toBe(ResourceAttentionSeverity.Warning);
    expect(
      severity(
        vmAssessment(
          { memoryBalloonedBytes: 8 * GIB },
          rules({ vmBalloonedWarningMebibytes: null }),
        ),
      ),
    ).toBeNull();
  });
});

describe("CPU ready: a warning above its share (default 10%)", () => {
  test("10.1% needs a look, 10% does not", () => {
    expect(severity(vmAssessment({ cpuReadinessPercent: 10.1 }))).toBe(
      ResourceAttentionSeverity.Warning,
    );
    expect(severity(vmAssessment({ cpuReadinessPercent: 10 }))).toBeNull();
  });

  test("a project's own share, and off", () => {
    expect(
      severity(
        vmAssessment(
          { cpuReadinessPercent: 6 },
          rules({ vmCpuReadyWarningPercent: 5 }),
        ),
      ),
    ).toBe(ResourceAttentionSeverity.Warning);
    expect(
      severity(
        vmAssessment(
          { cpuReadinessPercent: 80 },
          rules({ vmCpuReadyWarningPercent: null }),
        ),
      ),
    ).toBeNull();
    expect(
      getVMwareCpuReadyPercentTone(6, rules({ vmCpuReadyWarningPercent: 5 })),
    ).toBe("warning");
    expect(getVMwareCpuReadyPercentTone(6)).toBe("positive");
  });
});

describe("a busy ESXi host: a warning above its CPU and memory lines (default 90%)", () => {
  function hostAssessment(
    fields: RowFields,
    projectRules?: VMwareHealthRules | undefined,
  ): VMwareAssessment {
    return assessVMwareHost({
      host: host(fields),
      datacenter: null,
      now: NOW,
      rules: projectRules,
    });
  }

  test("90.1% needs a look, 90% does not, for CPU and memory each", () => {
    expect(texts(hostAssessment({ latestCpuPercent: 90.1 }))).toEqual([
      "CPU at {{percent}}",
    ]);
    expect(severity(hostAssessment({ latestCpuPercent: 90 }))).toBeNull();
    expect(texts(hostAssessment({ latestMemoryPercent: 90.1 }))).toEqual([
      "Memory at {{percent}}",
    ]);
    expect(severity(hostAssessment({ latestMemoryPercent: 90 }))).toBeNull();
  });

  test("CPU and memory have lines of their own", () => {
    const projectRules: VMwareHealthRules = rules({
      hostCpuWarningPercent: 95,
      hostMemoryWarningPercent: 80,
    });
    expect(
      texts(
        hostAssessment(
          { latestCpuPercent: 93, latestMemoryPercent: 85 },
          projectRules,
        ),
      ),
    ).toEqual(["Memory at {{percent}}"]);
    expect(getVMwareHostLoadTone(93, projectRules.hostCpuWarningPercent)).toBe(
      "positive",
    );
    expect(
      getVMwareHostLoadTone(85, projectRules.hostMemoryWarningPercent),
    ).toBe("warning");
  });

  test("off, a saturated host is no finding, and its status stays Connected and calm", () => {
    const projectRules: VMwareHealthRules = rules({
      hostCpuWarningPercent: null,
      hostMemoryWarningPercent: null,
    });
    expect(
      severity(
        hostAssessment(
          { latestCpuPercent: 99, latestMemoryPercent: 99 },
          projectRules,
        ),
      ),
    ).toBeNull();
    expect(
      getVMwareHostStatus({
        host: host({ latestCpuPercent: 99 }),
        datacenter: null,
        now: NOW,
        rules: projectRules,
      }),
    ).toEqual({ label: "Connected", tone: "positive" });
    expect(getVMwareHostLoadTone(99, null)).toBe("positive");
  });

  test("a host vCenter cannot reach is critical whatever the project's lines", () => {
    // Not responding is a state, not a threshold: no rule turns it off.
    const lost: VMwareResource = host({
      latestCpuPercent: 0,
      latestMemoryBytes: 0,
      latestCpuMhz: 0,
    });
    const datacenter: VMwareResource = row({
      kind: VMwareResourceKind.Datacenter,
      externalId: "datacenter/DC-NORTH",
      name: "DC-NORTH",
      metricsUpdatedAt: FRESH,
      hostCount: 2,
      poweredOnHostCount: 1,
      notRespondingHostCount: 1,
      standbyHostCount: 0,
    });
    expect(
      assessVMwareHost({
        host: lost,
        datacenter,
        now: NOW,
        rules: rules({
          hostCpuWarningPercent: null,
          hostMemoryWarningPercent: null,
        }),
      }).severity,
    ).toBe(ResourceAttentionSeverity.Critical);
  });
});

describe("a full datastore: a warning above 80%, critical above 90% (the defaults)", () => {
  function datastoreSeverity(
    percent: number,
    projectRules?: VMwareHealthRules | undefined,
  ): ResourceAttentionSeverity | null {
    return assessVMwareDatastore({
      datastore: datastore(percent),
      now: NOW,
      rules: projectRules,
    }).severity;
  }

  test("at and past each line", () => {
    expect(datastoreSeverity(80)).toBeNull();
    expect(datastoreSeverity(80.1)).toBe(ResourceAttentionSeverity.Warning);
    expect(datastoreSeverity(90)).toBe(ResourceAttentionSeverity.Warning);
    expect(datastoreSeverity(90.1)).toBe(ResourceAttentionSeverity.Critical);
  });

  test("a project's own lines, its bar and its status follow them", () => {
    const projectRules: VMwareHealthRules = rules({
      datastoreWarningPercent: 70,
      datastoreCriticalPercent: 85,
    });
    expect(datastoreSeverity(75, projectRules)).toBe(
      ResourceAttentionSeverity.Warning,
    );
    expect(datastoreSeverity(86, projectRules)).toBe(
      ResourceAttentionSeverity.Critical,
    );
    expect(getVMwareDatastoreFullTone(86, projectRules)).toBe("danger");
    expect(getVMwareDatastoreFullTone(86)).toBe("warning");
    expect(getVMwareDatastoreUsageThresholds(projectRules)).toEqual({
      warningPercent: 70,
      criticalPercent: 85,
      isPastLineOnly: true,
    });
    expect(
      getVMwareDatastoreStatus({
        datastore: datastore(86),
        now: NOW,
        rules: projectRules,
      }).tone,
    ).toBe("danger");
  });

  test("critical off keeps the warning; both off, a full datastore is no finding and draws no line", () => {
    expect(
      datastoreSeverity(99, rules({ datastoreCriticalPercent: null })),
    ).toBe(ResourceAttentionSeverity.Warning);
    const off: VMwareHealthRules = rules({
      datastoreWarningPercent: null,
      datastoreCriticalPercent: null,
    });
    expect(datastoreSeverity(99, off)).toBeNull();
    expect(getVMwareDatastoreUsageThresholds(off)).toEqual({
      warningPercent: Number.POSITIVE_INFINITY,
      criticalPercent: Number.POSITIVE_INFINITY,
      isPastLineOnly: true,
    });
  });
});

describe("a resource pool: a warning while the host swaps its memory out (default any)", () => {
  function poolAssessment(
    fields: RowFields,
    projectRules?: VMwareHealthRules | undefined,
  ): VMwareAssessment {
    return assessVMwareResourcePool({
      pool: pool(fields),
      now: NOW,
      rules: projectRules,
    });
  }

  test("swapping out now needs a look; memory left from earlier, or not known to move, does not", () => {
    expect(
      texts(
        poolAssessment({
          memorySwappedBytes: GIB,
          memorySwapOutBytesPerSecond: 1,
        }),
      ),
    ).toEqual(["Host swapping memory out at {{rate}}"]);
    expect(
      severity(
        poolAssessment({
          memorySwappedBytes: 64 * GIB,
          memorySwapOutBytesPerSecond: 0,
          memorySwapInBytesPerSecond: 0,
        }),
      ),
    ).toBeNull();
    expect(
      severity(poolAssessment({ memorySwappedBytes: 64 * GIB })),
    ).toBeNull();
  });

  test("its list cell turns amber only while it swaps out", () => {
    const resource: (swapOut: string | undefined) => InfrastructureResource = (
      swapOut: string | undefined,
    ): InfrastructureResource => {
      return {
        additionalAttributes: {
          memorySwappedBytes: String(GIB),
          ...(swapOut !== undefined
            ? { memorySwapOutBytesPerSecond: swapOut }
            : {}),
        },
      } as unknown as InfrastructureResource;
    };
    expect(getVMwareResourcePoolMemoryTone(resource("2048"))).toBe("warning");
    expect(getVMwareResourcePoolMemoryTone(resource("0"))).toBeUndefined();
    expect(
      getVMwareResourcePoolMemoryTone(resource(undefined)),
    ).toBeUndefined();
    expect(
      getVMwareResourcePoolMemoryTone(
        resource("2048"),
        rules({ resourcePoolSwapOutWarningKibPerSecond: 4 }),
      ),
    ).toBeUndefined();
  });

  test("a project's own rate, and off", () => {
    expect(
      severity(
        poolAssessment(
          { memorySwapOutBytesPerSecond: 100 * KIB },
          rules({ resourcePoolSwapOutWarningKibPerSecond: 64 }),
        ),
      ),
    ).toBe(ResourceAttentionSeverity.Warning);
    expect(
      severity(
        poolAssessment(
          { memorySwapOutBytesPerSecond: 100 * MIB },
          rules({ resourcePoolSwapOutWarningKibPerSecond: null }),
        ),
      ),
    ).toBeNull();
  });
});

describe("Needs attention reads the project's rules", () => {
  test("the same rows, with the defaults and with a project's own", () => {
    const rows: Array<VMwareResource> = [
      vm({
        memorySwappedBytes: 2 * GIB,
        memorySwapOutBytesPerSecond: 0,
        memorySwapInBytesPerSecond: 0,
      }),
      datastore(85),
    ];
    const at: (
      projectRules?: VMwareHealthRules | undefined,
    ) => Array<string> = (
      projectRules?: VMwareHealthRules | undefined,
    ): Array<string> => {
      return getVMwareAttentionItems({
        rows,
        now: NOW,
        routeFor: (): Route => {
          return new Route("/part");
        },
        rules: projectRules,
      }).map((item: { severity: string; name: string }): string => {
        return `${item.severity}:${item.name}`;
      });
    };
    expect(at()).toEqual(["warning:DS_SSD_01", "warning:web-frontend-03"]);
    expect(
      at(
        rules({
          vmSwappedWarningMebibytes: null,
          datastoreCriticalPercent: 84,
        }),
      ),
    ).toEqual(["critical:DS_SSD_01"]);
  });
});

describe("what a page reads to judge: the VMs that may need attention", () => {
  test("with the defaults: swapped, swapping out, reading back past 1 MiB/s, ballooned, CPU ready past 10%", () => {
    expect(getVMwareAttentionConditions(rules())).toEqual([
      { memorySwappedBytes: new GreaterThan<number>(0) },
      // vSphere's own rate can say a VM swaps out with nothing left swapped (#11468).
      { memorySwapOutBytesPerSecond: new GreaterThan<number>(0) },
      { memorySwapInBytesPerSecond: new GreaterThan<number>(1024 * KIB) },
      { memoryBalloonedBytes: new GreaterThan<number>(0) },
      { cpuReadinessPercent: new GreaterThan<number>(10) },
    ]);
  });

  test("a project's lines, and no read for a rule turned off", () => {
    expect(
      getVMwareAttentionConditions(
        rules({
          vmSwapOutCriticalKibPerSecond: null,
          vmSwappedWarningMebibytes: null,
          vmSwapInWarningKibPerSecond: null,
          vmBalloonedWarningMebibytes: 256,
          vmCpuReadyWarningPercent: 5,
        }),
      ),
    ).toEqual([
      { memoryBalloonedBytes: new GreaterThan<number>(256 * MIB) },
      { cpuReadinessPercent: new GreaterThan<number>(5) },
    ]);
  });

  test("swapped memory is read while either swap rule that reads the amount is on", () => {
    expect(
      getVMwareAttentionConditions(
        rules({ vmSwappedWarningMebibytes: null }),
      )[0],
    ).toEqual({ memorySwappedBytes: new GreaterThan<number>(0) });
    expect(
      getVMwareAttentionConditions(
        rules({ vmSwapOutCriticalKibPerSecond: null }),
      )[0],
    ).toEqual({ memorySwappedBytes: new GreaterThan<number>(0) });
  });
});

describe("lines a bar or a tile draws", () => {
  test("a rule's level, none at all for a rule turned off", () => {
    expect(getVMwareThresholdLine(90)).toBe(90);
    expect(getVMwareThresholdLine(0)).toBe(0);
    expect(getVMwareThresholdLine(null)).toBe(Number.POSITIVE_INFINITY);
  });

  test("CPU and memory bars at their own lines", () => {
    expect(
      getVMwareUsageBarThresholds(
        rules({ hostCpuWarningPercent: 95, hostMemoryWarningPercent: null }),
      ),
    ).toEqual({
      cpu: { warning: 95 },
      memory: { warning: Number.POSITIVE_INFINITY },
    });
    expect(getVMwareUsageBarThresholds(undefined)).toEqual({
      cpu: { warning: 90 },
      memory: { warning: 90 },
    });
  });

  test("a rate as a reason writes it", () => {
    expect(formatVMwareReasonRate(512)).toBe("512 B/s");
    expect(formatVMwareReasonRate(3 * MIB)).toBe("3.0 MiB/s");
  });
});
