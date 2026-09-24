import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  VMWARE_METRIC_DESCRIPTIONS,
  VMwareMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/VMwareMetricDescriptions";
import {
  expectReadableDescriptionRecord,
  expectTitleExplained,
  metricDescriptionProblems,
} from "./MetricDescriptionRules";

/*
 * The (i) texts on the VMware (vCenter) pages. The shared rules keep them
 * short and finished; the anchors below keep them TRUE. Each anchor reads
 * the constant or the line of code a sentence depends on - the tile window,
 * the staleness cut-off, the datastore and CPU Ready thresholds, the
 * forecast window - so changing the computation without changing the words
 * fails here instead of quietly misleading a customer.
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

const COMMON_ROOT: string = path.join(__dirname, "..", "..", "..");

function readDashboard(relativePath: string): string {
  return fs.readFileSync(
    path.join(DASHBOARD_SRC, ...relativePath.split("/")),
    "utf8",
  );
}

const OVERVIEW: string = readDashboard("Pages/VMware/View/Index.tsx");
const DATASTORE_DETAIL: string = readDashboard(
  "Pages/VMware/View/DatastoreDetail.tsx",
);
const VM_DETAIL: string = readDashboard(
  "Pages/VMware/View/VirtualMachineDetail.tsx",
);
const RESOURCE_POOLS: string = readDashboard(
  "Pages/VMware/View/ResourcePools.tsx",
);
const UTILS: string = readDashboard(
  "Pages/VMware/Utils/VMwareResourceUtils.ts",
);
const INVENTORY_SERVICE: string = fs.readFileSync(
  path.join(COMMON_ROOT, "Server", "Services", "VMwareResourceService.ts"),
  "utf8",
);

const WHITESPACE: RegExp = /\s+/g;

function squash(source: string): string {
  return source.replace(WHITESPACE, " ");
}

/*
 * A `const NAME: number = <expr>;` in a page, evaluated. The expressions are
 * whole numbers or products of them (`15 * 60 * 1000`); anything else fails
 * the test rather than being guessed at.
 */
const PRODUCT_OF_INTEGERS: RegExp = /^\d+(\s*\*\s*\d+)*$/;

function numericConstant(source: string, name: string): number {
  const declaration: RegExp = new RegExp(`const ${name}: number =\\s*([^;]+);`);
  const match: RegExpMatchArray | null = source.match(declaration);

  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

  const expression: string = (match as RegExpMatchArray)[1]!.trim();

  expect(expression).toMatch(PRODUCT_OF_INTEGERS);

  return expression.split("*").reduce((product: number, factor: string) => {
    return product * Number(factor.trim());
  }, 1);
}

const D: Record<VMwareMetric, string> = VMWARE_METRIC_DESCRIPTIONS;

/*
 * The visible title beside each (i), as the page renders it. Used to check a
 * title that names jargon gets a text that explains it.
 */
const TITLES: Record<VMwareMetric, string> = {
  overviewInventoryCounts: "vCenter inventory counts",
  overviewHostEffectiveness: "Host Effectiveness",
  overviewHostCpu: "Host CPU",
  overviewHostMemory: "Host Memory",
  overviewDatastores: "Datastores",
  overviewVmCpuReady: "VM CPU Ready",
  overviewVirtualMachines: "Virtual Machines",
  overviewHostCpuChart: "Host CPU",
  overviewHostMemoryChart: "Host Memory",
  overviewDatastoreUsedChart: "Datastore Used",
  overviewVmCpuReadyChart: "VM CPU Ready",
  overviewVCenterHealth: "vCenter Health",
  overviewDatacenterCount: "Datacenters",
  overviewClusterCount: "Clusters",
  overviewHostCount: "Hosts",
  overviewVirtualMachineCount: "Virtual Machines",
  overviewDatastoreCount: "Datastores",
  overviewResourcePoolCount: "Resource Pools",
  overviewAgentStatus: "Agent Status",
  topHostsByCpu: "Host CPU",
  topHostsByMemory: "Host Memory",
  topDatastoresByUtilization: "Datastore Utilization",
  topVmsByCpuReady: "VM CPU Ready",
  hostCpu: "CPU",
  hostCpuCapacity: "CPU Capacity",
  hostMemory: "Memory (Used / Capacity)",
  vmPowerState: "Power State",
  vmCpu: "CPU",
  vmCpuReady: "CPU Ready",
  vmMemory: "Memory (Used / Configured)",
  vmMemoryBallooned: "Memory Ballooned",
  vmMemorySwapped: "Memory Swapped",
  vmDisk: "Disk (Used / Provisioned)",
  datastoreUsed: "Used",
  datastoreCapacity: "Capacity",
  datastoreFree: "Free",
  datastoreUsedPercent: "Used %",
  datastoreGrowthForecast: "Growth Forecast",
  clusterHosts: "Hosts",
  clusterVirtualMachines: "Virtual Machines",
  clusterTemplates: "VM Templates",
  clusterCpu: "CPU (Effective / Total)",
  clusterMemory: "Memory (Effective / Total)",
  hostListCpu: "CPU",
  hostListMemory: "Memory",
  hostListCpuCapacity: "CPU Capacity",
  vmListStatus: "Status",
  vmListPowerState: "Power State",
  vmListCpuReady: "CPU Ready",
  vmListCpu: "CPU",
  vmListMemory: "Memory",
  vmListAge: "Age",
  datastoreListUsedCapacity: "Used / Capacity",
  clusterListHosts: "Hosts (effective / total)",
  clusterListVirtualMachines: "VMs (powered on / total)",
  clusterListTemplates: "Templates",
  clusterListEffectiveCpu: "Effective CPU",
  clusterListEffectiveMemory: "Effective Memory",
  resourcePoolListCpu: "CPU Usage",
  resourcePoolListMemory: "Memory Usage",
  resourcePoolListBalloonedSwapped: "Ballooned / Swapped",
};

const ALL_KEYS: Array<VMwareMetric> = Object.keys(D) as Array<VMwareMetric>;

const SENTENCE_BREAK: RegExp = /[.!?]\s+(?=[A-Z0-9])/g;
// A raw receiver metric name such as vcenter.vm.cpu.readiness.
const RAW_METRIC_NAME: RegExp = /\bvcenter\.[a-z_]+\.[a-z_.]+/i;
const MARKETING_WORDS: RegExp =
  /\b(powerful|seamless|blazing|world-class|best-in-class|effortless)\b/i;
const LIVE_CLAIM: RegExp = /\b(right now|real[- ]time|live)\b/i;

function sentenceCount(text: string): number {
  return (text.match(SENTENCE_BREAK) || []).length + 1;
}

describe("VMware metric descriptions: shape", () => {
  test("every description passes the shared rules and none repeats another", () => {
    expectReadableDescriptionRecord(D, "VMWARE_METRIC_DESCRIPTIONS");
  });

  test("the record and the title table cover the same metrics", () => {
    expect(Object.keys(TITLES).sort()).toEqual([...ALL_KEYS].sort());
  });

  test.each(ALL_KEYS)("%s is one or two sentences", (key: VMwareMetric) => {
    expect({ key, sentences: sentenceCount(D[key]) <= 2 }).toEqual({
      key,
      sentences: true,
    });
  });

  test.each(ALL_KEYS)(
    "%s fits a small tooltip (at most 300 characters)",
    (key: VMwareMetric) => {
      expect(D[key].length).toBeLessThanOrEqual(300);
      expect(metricDescriptionProblems(D[key])).toEqual([]);
    },
  );

  test.each(ALL_KEYS)(
    "%s explains any percentile its title names",
    (key: VMwareMetric) => {
      expectTitleExplained(TITLES[key], D[key]);
    },
  );

  test.each(ALL_KEYS)(
    "%s uses plain words, not raw receiver metric names or marketing",
    (key: VMwareMetric) => {
      expect(D[key]).not.toMatch(RAW_METRIC_NAME);
      expect(D[key]).not.toMatch(MARKETING_WORDS);
      expect(D[key]).not.toContain("DRS");
      expect(D[key]).not.toContain("QuickStats");
    },
  );

  test("a title shown more than once on the overview gets a different text each time", () => {
    // Host CPU is a tile, a chart and a top-5 list - three different numbers.
    expect(
      new Set([D.overviewHostCpu, D.overviewHostCpuChart, D.topHostsByCpu])
        .size,
    ).toBe(3);
    expect(
      new Set([
        D.overviewHostMemory,
        D.overviewHostMemoryChart,
        D.topHostsByMemory,
      ]).size,
    ).toBe(3);
    expect(
      new Set([
        D.overviewVmCpuReady,
        D.overviewVmCpuReadyChart,
        D.topVmsByCpuReady,
      ]).size,
    ).toBe(3);
    expect(D.overviewDatastores).not.toBe(D.overviewDatastoreCount);
    expect(D.overviewVirtualMachines).not.toBe(D.overviewVirtualMachineCount);
  });
});

describe("VMware metric descriptions: the time window each number covers", () => {
  const tileWindowMinutes: number = numericConstant(
    OVERVIEW,
    "TILE_WINDOW_MINUTES",
  );

  test("the overview still averages its tiles over a 5-minute window", () => {
    expect(tileWindowMinutes).toBe(5);
    expect(OVERVIEW).toContain("-TILE_WINDOW_MINUTES,");
  });

  test.each([
    "overviewHostCpu",
    "overviewHostMemory",
    "overviewVmCpuReady",
  ] as Array<VMwareMetric>)(
    "%s says it averages only the last minutes of the selected range",
    (key: VMwareMetric) => {
      expect(D[key]).toContain(
        `last ${tileWindowMinutes} minutes of the selected range`,
      );
    },
  );

  test.each([
    "overviewHostCpu",
    "overviewHostMemory",
    "overviewVmCpuReady",
  ] as Array<VMwareMetric>)(
    "%s names the whole-range fallback the code takes",
    (key: VMwareMetric) => {
      // meanInRecentWindow falls back to every point when the window is empty.
      expect(OVERVIEW).toContain("if (count === 0) {");
      expect(D[key]).toContain("the whole range if those minutes have no data");
    },
  );

  test("every recent-window tile really goes through meanInRecentWindow", () => {
    for (const stat of [
      "hostCpuPercent: meanInRecentWindow(cpuPoints)",
      "hostMemoryPercent: meanInRecentWindow(memoryPercentPoints)",
      "vmCpuReadyAvgPercent: meanInRecentWindow(cpuReadyAvgPoints)",
      "vmCpuReadyMaxPercent: meanInRecentWindow(cpuReadyMaxPoints)",
      "datastoreWorstPercent: meanInRecentWindow(datastoreWorstPoints)",
    ]) {
      expect({ stat, found: OVERVIEW.includes(stat) }).toEqual({
        stat,
        found: true,
      });
    }
  });

  test("the VM CPU Ready sublabel is the busiest VM, not a second average", () => {
    // Max per point across VMs, then the recent-window mean of those maxima.
    expect(OVERVIEW).toContain("max = Math.max(max, v);");
    expect(OVERVIEW).toContain(
      "`max ${formatPercent(s.vmCpuReadyMaxPercent)} across",
    );
    expect(D.overviewVmCpuReady).toContain("busiest VM below");
    expect(D.overviewVmCpuReady).not.toContain("highest single VM");
  });

  test("the Datastores tile names its metric fallback window", () => {
    expect(OVERVIEW).toContain(
      "inventory?.worstDatastorePercent ?? s.datastoreWorstPercent",
    );
    expect(D.overviewDatastores).toContain(
      `until the inventory loads, the fullest over the last ${tileWindowMinutes} minutes of the range`,
    );
  });

  test("the Datastores tile reads every datastore's last report, fresh or not", () => {
    // The Datastore branch of loadInventory never consults `fresh`.
    const branch: string = OVERVIEW.slice(
      OVERVIEW.indexOf(
        "} else if (row.kind === VMwareResourceKind.Datastore) {",
      ),
      OVERVIEW.indexOf(
        "} else if (row.kind === VMwareResourceKind.ResourcePool) {",
      ),
    );

    expect(branch).toContain("toNumber(row.latestDiskBytes)");
    expect(branch).not.toContain("fresh");
    expect(D.overviewDatastores).toContain("latest report, however old");
  });

  test.each([
    "overviewHostCpuChart",
    "overviewHostMemoryChart",
    "overviewDatastoreUsedChart",
    "overviewVmCpuReadyChart",
  ] as Array<VMwareMetric>)(
    "%s covers the whole selected range, not the tile window",
    (key: VMwareMetric) => {
      expect(D[key]).toContain("selected range");
      expect(D[key]).not.toContain("minutes");
    },
  );

  test.each([
    "overviewInventoryCounts",
    "overviewHostEffectiveness",
    "overviewVirtualMachines",
    "overviewDatacenterCount",
    "overviewHostCount",
    "overviewVirtualMachineCount",
    "topHostsByCpu",
    "topHostsByMemory",
    "topVmsByCpuReady",
  ] as Array<VMwareMetric>)(
    "%s is read from the latest inventory, not the time picker",
    (key: VMwareMetric) => {
      expect(D[key]).toContain("latest inventory");
      expect(D[key]).not.toContain(`last ${tileWindowMinutes} minutes`);
    },
  );

  test("the inventory tiles that sit beside time-ranged ones say they ignore the range", () => {
    expect(D.overviewInventoryCounts).toContain(
      "rather than the selected range",
    );
    expect(D.overviewHostEffectiveness).toContain(
      "rather than the selected range",
    );
    expect(D.topHostsByCpu).toContain("rather than the selected range");
    expect(D.topDatastoresByUtilization).toContain("not the selected range");
  });

  test.each(ALL_KEYS)(
    "%s does not promise a live value: every number is a stored report",
    (key: VMwareMetric) => {
      /*
       * Nothing on these pages is read live from vCenter; inventory values
       * can be old (the cluster columns are never staleness-checked), so
       * "right now" would overstate them.
       */
      expect(D[key]).not.toMatch(LIVE_CLAIM);
    },
  );
});

describe("VMware metric descriptions: stale data", () => {
  const staleMs: number = numericConstant(UTILS, "METRIC_STALE_MS");
  const staleMinutes: number = staleMs / 60000;

  test("the inventory cut-off is still 15 minutes", () => {
    expect(staleMinutes).toBe(15);
  });

  test("the tables gate CPU and memory - and only those - on fresh metrics", () => {
    const mapping: string = UTILS.slice(
      UTILS.indexOf("export function toInfrastructureResource"),
    );

    expect(mapping).toContain("if (hasFreshMetrics(row)) {");
    expect(mapping).toContain("cpu = toNumberOrNull(row.latestCpuPercent);");
    expect(mapping).toContain("mem = toNumberOrNull(row.latestMemoryBytes);");
    // The rest ride additionalAttributes verbatim, however old.
    expect(mapping).toContain('additionalAttributes["cpuReadinessPercent"]');
    expect(mapping).toContain('additionalAttributes["diskBytes"]');
    expect(mapping).toContain('additionalAttributes["cpuMhz"]');
  });

  test.each([
    "hostListCpu",
    "hostListMemory",
    "vmListCpu",
    "vmListMemory",
    "resourcePoolListMemory",
    "topHostsByCpu",
    "topHostsByMemory",
    "topVmsByCpuReady",
  ] as Array<VMwareMetric>)(
    "%s says values older than the cut-off are hidden",
    (key: VMwareMetric) => {
      expect(D[key]).toContain(`last ${staleMinutes} minutes`);
    },
  );

  test.each([
    "vmListCpuReady",
    "datastoreListUsedCapacity",
    "resourcePoolListCpu",
    "topDatastoresByUtilization",
    "hostCpu",
  ] as Array<VMwareMetric>)(
    "%s shows the last value however old, and says so",
    (key: VMwareMetric) => {
      expect(D[key]).toContain("however old");
      expect(D[key]).not.toContain(`${staleMinutes} minutes`);
    },
  );

  test("the ballooned / swapped column is not staleness-checked either", () => {
    expect(squash(RESOURCE_POOLS)).toContain(
      'readNumber( resource, "memoryBalloonedBytes", )',
    );
    expect(D.resourcePoolListBalloonedSwapped).toContain("last report");
    expect(D.resourcePoolListBalloonedSwapped).not.toContain("15 minutes");
  });

  test("a powered-off VM keeps its last CPU reading, and the texts say so", () => {
    // The inventory mirror keeps the previous value when a batch has no CPU.
    expect(INVENTORY_SERVICE).toContain(
      '"latestCpuPercent" = COALESCE(v."cpu", p."latestCpuPercent")',
    );
    expect(INVENTORY_SERVICE).toContain(
      '"cpuReadinessPercent" = COALESCE(v."cpuReady", p."cpuReadinessPercent")',
    );

    for (const key of [
      "vmCpu",
      "vmCpuReady",
      "vmListCpu",
      "vmListCpuReady",
    ] as Array<VMwareMetric>) {
      expect({ key, says: D[key].includes("last reading") }).toEqual({
        key,
        says: true,
      });
    }
  });
});

describe("VMware metric descriptions: thresholds match the code", () => {
  const warn: number = numericConstant(OVERVIEW, "DATASTORE_WARN_PERCENT");
  const critical: number = numericConstant(
    OVERVIEW,
    "DATASTORE_CRITICAL_PERCENT",
  );
  const cpuReady: number = numericConstant(
    OVERVIEW,
    "VM_CPU_READY_WARN_PERCENT",
  );

  test("the datastore detail page flags at the same levels as the overview", () => {
    expect(numericConstant(DATASTORE_DETAIL, "DATASTORE_WARN_PERCENT")).toBe(
      warn,
    );
    expect(
      numericConstant(DATASTORE_DETAIL, "DATASTORE_CRITICAL_PERCENT"),
    ).toBe(critical);
  });

  test.each([
    "overviewDatastores",
    "overviewDatastoreCount",
    "overviewVCenterHealth",
    "datastoreUsedPercent",
  ] as Array<VMwareMetric>)(
    "%s names the datastore warning and critical levels",
    (key: VMwareMetric) => {
      expect(D[key]).toContain(`${warn}%`);
      expect(D[key]).toContain(`${critical}%`);
    },
  );

  test.each([
    "overviewVmCpuReady",
    "overviewVmCpuReadyChart",
    "overviewVCenterHealth",
    "topVmsByCpuReady",
    "vmCpuReady",
    "vmListCpuReady",
  ] as Array<VMwareMetric>)(
    "%s names the CPU Ready level that counts as contention",
    (key: VMwareMetric) => {
      expect(D[key]).toContain(`${cpuReady}%`);
    },
  );

  test("the VM detail page flags CPU Ready at the same level", () => {
    expect(VM_DETAIL).toContain(`readiness > ${cpuReady} ?`);
  });

  test("the VM CPU Ready tile turns amber where its text says", () => {
    expect(OVERVIEW).toContain(
      "thresholds={{ warn: 5, danger: VM_CPU_READY_WARN_PERCENT }}",
    );
    expect(D.overviewVmCpuReady).toContain("amber from 5%");
    expect(D.overviewVmCpuReady).toContain(`red from ${cpuReady}%`);
  });

  test("the datastore tile turns amber and red where its text says", () => {
    expect(OVERVIEW).toContain("warn: DATASTORE_WARN_PERCENT,");
    expect(OVERVIEW).toContain("danger: DATASTORE_CRITICAL_PERCENT,");
    expect(D.overviewDatastores).toContain(`Amber from ${warn}%`);
    expect(D.overviewDatastores).toContain(`red from ${critical}%`);
  });

  test("the growth forecast names its window and cut-off", () => {
    const hours: number = numericConstant(
      DATASTORE_DETAIL,
      "PROJECTION_WINDOW_HOURS",
    );

    expect(D.datastoreGrowthForecast).toContain(`last ${hours} hours`);
    expect(DATASTORE_DETAIL).toContain("daysToFull <= 365");
    expect(D.datastoreGrowthForecast).toContain("within a year");
    expect(DATASTORE_DETAIL).toContain('"Full now"');
    expect(D.datastoreGrowthForecast).toContain("Full now");
    expect(D.datastoreGrowthForecast).toContain("straight-line");
  });
});

describe("VMware metric descriptions: what each number is made of", () => {
  test("Host CPU is capacity-weighted, and the text says bigger hosts count for more", () => {
    expect(OVERVIEW).toContain("weightedSum += utilization * capacity;");
    expect(D.overviewHostCpu).toContain("bigger hosts counting for more");
    expect(D.overviewHostCpuChart).toContain(
      "Hosts with more CPU count for more",
    );
  });

  test("the Host Memory chart is a percentage, the Datastore Used chart is summed bytes", () => {
    expect(OVERVIEW).toContain('seriesName: "Host Memory %"');
    expect(D.overviewHostMemoryChart).toContain(
      "as a share of their combined RAM",
    );
    expect(OVERVIEW).toContain('seriesName: "Datastore Used"');
    expect(D.overviewDatastoreUsedChart).toContain("added up");
    expect(D.overviewDatastoreUsedChart).toContain("bytes");
  });

  test("the VM CPU Ready chart names both of its lines", () => {
    expect(OVERVIEW).toContain('seriesName: "Avg"');
    expect(OVERVIEW).toContain('seriesName: "Max"');
    expect(D.overviewVmCpuReadyChart).toContain("Avg is the average");
    expect(D.overviewVmCpuReadyChart).toContain("Max the highest single VM");
  });

  test.each([
    "overviewVmCpuReady",
    "overviewVmCpuReadyChart",
    "topVmsByCpuReady",
    "vmCpuReady",
    "vmListCpuReady",
  ] as Array<VMwareMetric>)(
    "%s explains what CPU Ready is",
    (key: VMwareMetric) => {
      expect(D[key]).toContain("physical CPU");
    },
  );

  test.each([
    "overviewVirtualMachines",
    "vmPowerState",
    "vmListPowerState",
  ] as Array<VMwareMetric>)(
    "%s says power state is inferred and a suspended VM reads as off",
    (key: VMwareMetric) => {
      expect(D[key]).toContain("CPU data");
      expect(D[key]).toContain("suspended");
    },
  );

  test("the power-state inference the texts describe is the one the code does", () => {
    expect(UTILS).toContain('return "Powered off";');
    expect(OVERVIEW).toContain("if (row.isTemplate) {");
    expect(D.overviewVirtualMachines).toContain("templates excluded");
  });

  test("the VM Age column is empty because the page never fills it", () => {
    expect(UTILS).toContain('age: "",');
    expect(D.vmListAge).toContain("empty for every virtual machine");
  });

  test.each([
    "overviewHostEffectiveness",
    "clusterHosts",
    "clusterCpu",
    "clusterMemory",
    "clusterListHosts",
    "clusterListEffectiveCpu",
    "clusterListEffectiveMemory",
    "overviewClusterCount",
  ] as Array<VMwareMetric>)(
    "%s explains what makes a host not effective",
    (key: VMwareMetric) => {
      expect(D[key]).toContain("maintenance mode");
      expect(D[key]).toContain("not responding");
    },
  );

  test("Host Effectiveness leaves standalone hosts out, as the code does", () => {
    // Only Cluster rows feed clusterHostsTotal.
    expect(OVERVIEW).toContain("clusterHostsTotal += total;");
    expect(D.overviewHostEffectiveness).toContain(
      "standalone hosts are not counted",
    );
  });

  test("vCenter Health lists what makes it Unhealthy, Degraded and Unknown", () => {
    for (const phrase of [
      "Unhealthy",
      "Degraded",
      "Unknown",
      "maintenance mode",
      "swapped",
      "ballooned",
      "CPU Ready",
      "powered off",
      "disconnected",
    ]) {
      expect({
        phrase,
        found: D.overviewVCenterHealth.includes(phrase),
      }).toEqual({ phrase, found: true });
    }
    expect(OVERVIEW).toContain('["connected", "active"].includes(');
  });

  test.each([
    "vmMemoryBallooned",
    "resourcePoolListBalloonedSwapped",
  ] as Array<VMwareMetric>)(
    "%s explains ballooning in plain words",
    (key: VMwareMetric) => {
      expect(D[key]).toContain("balloon driver");
      expect(D[key]).toContain("short of RAM");
    },
  );

  test.each([
    "hostCpu",
    "hostCpuCapacity",
    "hostListCpuCapacity",
    "vmCpu",
    "clusterCpu",
    "clusterListEffectiveCpu",
    "resourcePoolListCpu",
  ] as Array<VMwareMetric>)(
    "%s names the MHz / GHz unit the value is shown in",
    (key: VMwareMetric) => {
      expect(D[key]).toContain("MHz or GHz");
    },
  );

  test("the unit switch the texts mention is the one formatMhz makes", () => {
    expect(UTILS).toContain("if (Math.abs(value) >= 1000) {");
    expect(UTILS).toContain("GHz");
    expect(UTILS).toContain("MHz");
  });

  test("the datastore summary card sums every datastore", () => {
    expect(OVERVIEW).toContain(
      "datastoreUsedBytes = (datastoreUsedBytes ?? 0) + used;",
    );
    expect(D.overviewDatastoreCount).toContain("added up across all of them");
  });

  test("the Host Memory top-5 bar falls back to usage against the top host's usage", () => {
    // maxMemory is the largest USED amount among hosts, not a host's size.
    expect(OVERVIEW).toContain("return Math.max(max, h.memoryBytes ?? 0);");
    expect(OVERVIEW).toContain("((h.memoryBytes ?? 0) / maxMemory) * 100");
    expect(D.topHostsByMemory).toContain(
      "its usage compared with the top host's",
    );
    expect(D.topHostsByMemory).not.toContain("its size");
  });

  test("the hero count chips are the kinds the inventory-counts text lists", () => {
    const hero: string = OVERVIEW.slice(
      OVERVIEW.indexOf("const specChips:"),
      OVERVIEW.indexOf("const hasCountChips"),
    );

    for (const [chip, words] of [
      ["datacenter${", "datacenters"],
      ["cluster${", "clusters"],
      ["ESXi host${", "ESXi hosts"],
      ["powered on`", "VMs (powered on out of all, templates excluded)"],
      ["datastore${", "datastores"],
    ] as Array<[string, string]>) {
      expect({ chip, inHero: hero.includes(chip) }).toEqual({
        chip,
        inHero: true,
      });
      expect({
        words,
        inText: D.overviewInventoryCounts.includes(words),
      }).toEqual({ words, inText: true });
    }
    // A zero count hides its chip, which the text says.
    expect(hero).toContain("if (datastoreCount > 0) {");
    expect(D.overviewInventoryCounts).toContain("A kind with none is left out");
    // The agent version chip comes after the cut, so it is not a count.
    expect(hero).not.toContain("agentVersion");
  });

  test("the fullest-datastore tile is a maximum, not an average", () => {
    expect(OVERVIEW).toContain(
      "if (worstDatastorePercent === null || pct > worstDatastorePercent) {",
    );
    expect(D.overviewDatastores).toContain("fullest datastore");
  });
});
