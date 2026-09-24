import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every number on the VMware (vCenter) pages carries an (i) that says what
 * it means. The texts live in
 * Components/MetricDescriptions/VMwareMetricDescriptions.ts; this file pins
 * that each tile, chart card, summary card, top-5 section, detail-page
 * summary field and table column is handed the RIGHT text - a tile wired to
 * its neighbour's description would read fine and be wrong.
 *
 * The App suite runs in plain Node with no renderer, so this reads the page
 * sources (comments stripped, whitespace squashed, so Prettier reflows and
 * rationale comments cannot make it pass or fail), the way
 * CloudResourcePages.test.ts and RumOverviewWiring.test.ts do. The rendered
 * behaviour is covered by the jsdom tests in
 * Common/Tests/App/Dashboard/VMware*Tooltips.test.tsx.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const WHITESPACE: RegExp = /\s+/g;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const REFERENCE: RegExp = /VMWARE_METRIC_DESCRIPTIONS\.(\w+)/g;
const TILE_TITLE: RegExp = /title="([^"]+)"/;
const TILE_DESCRIPTION: RegExp =
  /description=\{VMWARE_METRIC_DESCRIPTIONS\.(\w+)\}/;
const CARD_TOOLTIP: RegExp = /tooltip=\{VMWARE_METRIC_DESCRIPTIONS\.(\w+)\}/;
const CALL_TITLE: RegExp = /title: "([^"]+)"/;
const CALL_DESCRIPTION: RegExp =
  /description: VMWARE_METRIC_DESCRIPTIONS\.(\w+)/;
const FIELD_TITLE: RegExp = /title: (.+?), (?:value|description):/;
const COLUMN_TITLE: RegExp = /^"([^"]+)"/;
const BUILT_IN_ENTRY: RegExp = /(\w+): VMWARE_METRIC_DESCRIPTIONS\.(\w+)/g;

function readSource(relativePath: string): string {
  return fs.readFileSync(
    path.join(DASHBOARD_SRC, ...relativePath.split("/")),
    "utf8",
  );
}

function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = source.indexOf(to, start + from.length);

  if (end < 0) {
    throw new Error(`Expected "${to}" after "${from}".`);
  }

  return source.slice(start, end);
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function firstMatch(source: string, pattern: RegExp): string | null {
  const match: RegExpMatchArray | null = source.match(pattern);

  return match ? match[1]! : null;
}

/*
 * The pieces of `source` that follow each `marker`, each cut at `end`.
 * `<GoldenMetricTile ... />`, `renderChartCard({ ... })`, and so on.
 */
function piecesAfter(
  source: string,
  marker: string,
  end: string,
): Array<string> {
  return source
    .split(marker)
    .slice(1)
    .map((piece: string): string => {
      const stop: number = piece.indexOf(end);

      return stop >= 0 ? piece.slice(0, stop) : piece;
    });
}

type Pairs = Array<[string, string | null]>;

const PAGES: Record<string, string> = {
  overview: "Pages/VMware/View/Index.tsx",
  hostDetail: "Pages/VMware/View/HostDetail.tsx",
  vmDetail: "Pages/VMware/View/VirtualMachineDetail.tsx",
  datastoreDetail: "Pages/VMware/View/DatastoreDetail.tsx",
  clusterDetail: "Pages/VMware/View/ClusterDetail.tsx",
  hosts: "Pages/VMware/View/Hosts.tsx",
  vms: "Pages/VMware/View/VirtualMachines.tsx",
  datastores: "Pages/VMware/View/Datastores.tsx",
  clusters: "Pages/VMware/View/Clusters.tsx",
  resourcePools: "Pages/VMware/View/ResourcePools.tsx",
};

const IMPORT_LINE: string =
  'import { VMWARE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/VMwareMetricDescriptions";';

type DescriptionsModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/MetricDescriptions/VMwareMetricDescriptions");

let descriptions: Record<string, string>;

beforeAll(async () => {
  const module: DescriptionsModule = await import(
    "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/VMwareMetricDescriptions"
  );

  descriptions = module.VMWARE_METRIC_DESCRIPTIONS;
});

describe("the VMware pages and the description record agree", () => {
  test.each(Object.entries(PAGES))(
    "%s imports the VMware descriptions",
    (_: string, page: string) => {
      expect(readSource(page)).toContain(IMPORT_LINE);
    },
  );

  test("every key a page references exists in the record", () => {
    const missing: Array<string> = [];

    for (const page of Object.values(PAGES)) {
      for (const match of readCode(page).matchAll(REFERENCE)) {
        if (!(match[1]! in descriptions)) {
          missing.push(`${page}: ${match[1]}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("every description in the record is shown on a VMware page", () => {
    const referenced: Set<string> = new Set<string>();

    for (const page of Object.values(PAGES)) {
      for (const match of readCode(page).matchAll(REFERENCE)) {
        referenced.add(match[1]!);
      }
    }

    expect(
      Object.keys(descriptions).filter((key: string): boolean => {
        return !referenced.has(key);
      }),
    ).toEqual([]);
  });

  test("no description is wired to two different places by mistake", () => {
    /*
     * The one intentional reuse: the VM detail page's CPU row has two
     * branches (a reading, or N/A while powered off) that explain the same
     * thing.
     */
    const uses: Map<string, number> = new Map<string, number>();

    for (const page of Object.values(PAGES)) {
      for (const match of readCode(page).matchAll(REFERENCE)) {
        uses.set(match[1]!, (uses.get(match[1]!) || 0) + 1);
      }
    }

    const reused: Array<string> = Array.from(uses.entries())
      .filter(([, count]: [string, number]): boolean => {
        return count > 1;
      })
      .map(([key]: [string, number]): string => {
        return key;
      });

    expect(reused).toEqual(["vmCpu"]);
    expect(uses.get("vmCpu")).toBe(2);
  });
});

describe("VMware overview (Index.tsx)", () => {
  const code: string = readCode(PAGES["overview"]!);

  test("imports the (i) component", () => {
    expect(code).toContain(
      'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";',
    );
  });

  test("the hero count chips carry one (i), shown only when a count chip is", () => {
    const hero: string = between(
      code,
      "const renderHero:",
      "const renderGoldenMetrics:",
    );

    expect(countOf(hero, "<InfoTooltip")).toBe(1);
    expect(hero).toContain(
      '{hasCountChips && ( <InfoTooltip label="vCenter inventory counts" text={VMWARE_METRIC_DESCRIPTIONS.overviewInventoryCounts} /> )}',
    );

    /*
     * Measured after the last count chip and before the agent version chip,
     * so a row holding only the version gets no (i).
     */
    const flag: number = hero.indexOf(
      "const hasCountChips: boolean = specChips.length > 0;",
    );

    expect(flag).toBeGreaterThan(hero.indexOf("if (datastoreCount > 0) {"));
    expect(flag).toBeLessThan(hero.indexOf("if (vcenter.agentVersion) {"));

    // The (i) sits in the chip row, after the chips, not inside one.
    const row: string = between(
      hero,
      "{specChips.length > 0 && (",
      "{hasCountChips && (",
    );

    expect(row).toContain("{specChips.map(");
  });

  test("every golden tile explains itself with its own text", () => {
    const golden: string = between(
      code,
      "const renderGoldenMetrics:",
      "const renderChartCard:",
    );
    const tiles: Array<string> = piecesAfter(golden, "<GoldenMetricTile", "/>");
    const pairs: Pairs = tiles.map((tile: string): [string, string | null] => {
      return [
        firstMatch(tile, TILE_TITLE) || "",
        firstMatch(tile, TILE_DESCRIPTION),
      ];
    });

    expect(pairs).toEqual([
      ["Host Effectiveness", "overviewHostEffectiveness"],
      ["Host CPU", "overviewHostCpu"],
      ["Host Memory", "overviewHostMemory"],
      ["Datastores", "overviewDatastores"],
      ["VM CPU Ready", "overviewVmCpuReady"],
      ["Virtual Machines", "overviewVirtualMachines"],
    ]);
    // No tile outside the golden row.
    expect(countOf(code, "<GoldenMetricTile")).toBe(tiles.length);
  });

  test("every golden chart card passes a description", () => {
    const charts: string = between(
      code,
      "const renderGoldenCharts:",
      "const renderWhyDegraded:",
    );
    const calls: Array<string> = piecesAfter(charts, "renderChartCard({", "})");
    const pairs: Pairs = calls.map((call: string): [string, string | null] => {
      return [
        firstMatch(call, CALL_TITLE) || "",
        firstMatch(call, CALL_DESCRIPTION),
      ];
    });

    expect(pairs).toEqual([
      ["Host CPU", "overviewHostCpuChart"],
      ["Host Memory", "overviewHostMemoryChart"],
      ["Datastore Used", "overviewDatastoreUsedChart"],
      ["VM CPU Ready", "overviewVmCpuReadyChart"],
    ]);
    expect(countOf(code, "renderChartCard({")).toBe(calls.length);
  });

  test("the chart card shows its (i) in the skeleton and in the loaded card", () => {
    const card: string = between(
      code,
      "const renderChartCard:",
      "const renderGoldenCharts:",
    );

    expect(card).toContain("description?: string | undefined;");
    expect(
      countOf(
        card,
        "<InfoTooltip label={params.title} text={params.description} />",
      ),
    ).toBe(1);
    // One shared header, rendered by both branches.
    expect(card).toContain("const header: ReactElement = (");
    expect(countOf(card, "return (")).toBe(2);
    expect(countOf(card, "{header}")).toBe(2);
    /*
     * ...and the title is drawn nowhere else (once as text, once as the
     * (i)'s label), so no branch can lose the (i).
     */
    expect(countOf(card, "{params.title}")).toBe(2);
    expect(countOf(card, "{params.title} </span>")).toBe(1);

    const skeleton: string = between(
      card,
      "if (!chartWindow) {",
      "const xAxis",
    );

    expect(skeleton).toContain("{header}");
    expect(skeleton).toContain("animate-pulse");
  });

  test("every Top Resource Consumers section explains its ranking", () => {
    const top: string = between(
      code,
      "const renderTopConsumers:",
      "const renderResourceLinks:",
    );
    const calls: Array<string> = piecesAfter(
      top,
      "renderTopSection({",
      "children:",
    );
    const pairs: Pairs = calls.map((call: string): [string, string | null] => {
      return [
        firstMatch(call, CALL_TITLE) || "",
        firstMatch(call, CALL_DESCRIPTION),
      ];
    });

    expect(pairs).toEqual([
      ["Host CPU", "topHostsByCpu"],
      ["Host Memory", "topHostsByMemory"],
      ["Datastore Utilization", "topDatastoresByUtilization"],
      ["VM CPU Ready", "topVmsByCpuReady"],
    ]);
    expect(countOf(code, "renderTopSection({")).toBe(calls.length);

    const section: string = between(
      code,
      "const renderTopSection:",
      "const renderTopConsumers:",
    );

    expect(section).toContain(
      "<InfoTooltip label={params.title} text={params.description} />",
    );
  });

  test("every summary card explains itself, clickable ones included", () => {
    const strip: string = between(
      code,
      '<InfoCard title="vCenter Health"',
      "<ResourceActivityCards",
    );
    const cards: Array<string> = strip.split("<InfoCard").slice(1);
    const pairs: Array<[string, string | null, boolean]> = cards.map(
      (card: string): [string, string | null, boolean] => {
        return [
          firstMatch(card, TILE_TITLE) || "",
          firstMatch(card, CARD_TOOLTIP),
          card.includes("onClick="),
        ];
      },
    );

    expect(pairs).toEqual([
      ["vCenter Health", "overviewVCenterHealth", false],
      ["Datacenters", "overviewDatacenterCount", false],
      ["Clusters", "overviewClusterCount", true],
      ["Hosts", "overviewHostCount", true],
      ["Virtual Machines", "overviewVirtualMachineCount", true],
      ["Datastores", "overviewDatastoreCount", true],
      ["Resource Pools", "overviewResourcePoolCount", true],
      ["Agent Status", "overviewAgentStatus", false],
    ]);
    expect(countOf(code, "<InfoCard")).toBe(cards.length);
  });

  test("no (i) sits inside a link or a button on the page", () => {
    /*
     * The clickable summary cards are InfoCards, which lay their own click
     * target beside the (i) rather than around it (the jsdom test checks
     * that); nothing on the page itself wraps content in an anchor or a
     * button.
     */
    expect(code).not.toContain("<button");
    expect(code).not.toContain("<a ");
    expect(code).not.toContain("<Link");
    expect(code).not.toContain("<AppLink");
  });
});

/*
 * The summary fields of a detail page, in order: each pushed field's title
 * and the description it carries (null for identity fields and timestamps).
 */
function summaryFieldPairs(code: string): Pairs {
  return piecesAfter(code, "summaryFields.push({", "});").map(
    (field: string): [string, string | null] => {
      return [
        firstMatch(field, FIELD_TITLE) || "",
        firstMatch(field, CALL_DESCRIPTION),
      ];
    },
  );
}

function initialFieldsCarryNoDescription(code: string): void {
  const initial: string = between(
    code,
    "const summaryFields: Array<SummaryField> = [",
    "];",
  );

  // Name and vCenter: identity, nothing to explain.
  expect(initial).not.toContain("description:");
}

describe("VMware detail pages: summary fields", () => {
  test("ESXi host detail", () => {
    const code: string = readCode(PAGES["hostDetail"]!);

    initialFieldsCarryNoDescription(code);
    expect(summaryFieldPairs(code)).toEqual([
      ['"Datacenter"', null],
      ['"Cluster"', null],
      ['"CPU"', "hostCpu"],
      ['"CPU Capacity"', "hostCpuCapacity"],
      ['"Memory (Used / Capacity)"', "hostMemory"],
      ['"External ID"', null],
      ['"Metrics Updated"', null],
      ['"Last Seen"', null],
    ]);
  });

  test("virtual machine detail", () => {
    const code: string = readCode(PAGES["vmDetail"]!);

    initialFieldsCarryNoDescription(code);
    expect(summaryFieldPairs(code)).toEqual([
      ['isTemplate ? "Type" : "Power State"', "vmPowerState"],
      ['"Instance UUID"', null],
      ['"Host"', null],
      ['"Cluster"', null],
      ['"Datacenter"', null],
      ['"vApp"', null],
      ['"Resource Pool"', null],
      // A reading, or N/A while powered off - both explained.
      ['"CPU"', "vmCpu"],
      ['"CPU"', "vmCpu"],
      ['"CPU Ready"', "vmCpuReady"],
      ['"Memory (Used / Configured)"', "vmMemory"],
      ['"Memory Ballooned"', "vmMemoryBallooned"],
      ['"Memory Swapped"', "vmMemorySwapped"],
      ['"Disk (Used / Provisioned)"', "vmDisk"],
      ['"External ID"', null],
      ['"Metrics Updated"', null],
      ['"Last Seen"', null],
    ]);
  });

  test("datastore detail", () => {
    const code: string = readCode(PAGES["datastoreDetail"]!);

    initialFieldsCarryNoDescription(code);
    expect(summaryFieldPairs(code)).toEqual([
      ['"Datacenter"', null],
      ['"Used"', "datastoreUsed"],
      ['"Capacity"', "datastoreCapacity"],
      ['"Free"', "datastoreFree"],
      ['"Used %"', "datastoreUsedPercent"],
      ['"Growth Forecast"', "datastoreGrowthForecast"],
      ['"External ID"', null],
      ['"Metrics Updated"', null],
      ['"Last Seen"', null],
    ]);
  });

  test("cluster detail", () => {
    const code: string = readCode(PAGES["clusterDetail"]!);

    initialFieldsCarryNoDescription(code);
    expect(summaryFieldPairs(code)).toEqual([
      ['"Datacenter"', null],
      ['"Hosts"', "clusterHosts"],
      ['"Virtual Machines"', "clusterVirtualMachines"],
      ['"VM Templates"', "clusterTemplates"],
      ['"CPU (Effective / Total)"', "clusterCpu"],
      ['"Memory (Effective / Total)"', "clusterMemory"],
      ['"External ID"', null],
      ['"Metrics Updated"', null],
      ['"Last Seen"', null],
    ]);
  });

  test("the summary grid still forwards a field's description to its card", () => {
    const grid: string = readCode(
      "Components/Infrastructure/ResourceOverviewTab.tsx",
    );

    expect(grid).toContain("tooltip={field.description}");
  });
});

/*
 * The custom columns of a list page, in order: title and the description
 * it carries.
 */
function columnPairs(code: string): Pairs {
  const start: number = code.indexOf("columns={[");
  const endCandidates: Array<number> = ["]} getViewRoute", "]} />"]
    .map((end: string): number => {
      return code.indexOf(end, start);
    })
    .filter((index: number): boolean => {
      return index > start;
    });

  expect(start).toBeGreaterThan(-1);
  expect(endCandidates.length).toBeGreaterThan(0);

  const columns: string = code.slice(start, Math.min(...endCandidates));

  return columns
    .split("{ title: ")
    .slice(1)
    .map((column: string): [string, string | null] => {
      const head: string = column.slice(0, column.indexOf("getValue"));

      return [
        firstMatch(column, COLUMN_TITLE) || "",
        firstMatch(head, CALL_DESCRIPTION),
      ];
    });
}

function builtInDescriptions(code: string): Record<string, string> {
  if (!code.includes("builtInColumnDescriptions={{")) {
    return {};
  }

  const block: string = between(code, "builtInColumnDescriptions={{", "}}");
  const result: Record<string, string> = {};

  for (const match of block.matchAll(BUILT_IN_ENTRY)) {
    result[match[1]!] = match[2]!;
  }

  return result;
}

describe("VMware list pages: column headers", () => {
  test("Hosts", () => {
    const code: string = readCode(PAGES["hosts"]!);

    expect(columnPairs(code)).toEqual([
      ["Cluster", null],
      ["CPU Capacity", "hostListCpuCapacity"],
    ]);
    // Status and Age are hidden, so only CPU and Memory need a text.
    expect(code).toContain("showStatus={false}");
    expect(builtInDescriptions(code)).toEqual({
      cpu: "hostListCpu",
      memory: "hostListMemory",
    });
  });

  test("Virtual Machines", () => {
    const code: string = readCode(PAGES["vms"]!);

    expect(columnPairs(code)).toEqual([
      ["Power State", "vmListPowerState"],
      ["Cluster", null],
      ["Resource Pool", null],
      ["CPU Ready", "vmListCpuReady"],
    ]);
    // Every built-in column is on (status, CPU, memory and age).
    expect(code).not.toContain("showStatus={false}");
    expect(code).not.toContain("showResourceMetrics={false}");
    expect(builtInDescriptions(code)).toEqual({
      status: "vmListStatus",
      cpu: "vmListCpu",
      memory: "vmListMemory",
      age: "vmListAge",
    });
  });

  test("Datastores", () => {
    const code: string = readCode(PAGES["datastores"]!);

    expect(columnPairs(code)).toEqual([
      ["Used / Capacity", "datastoreListUsedCapacity"],
    ]);
    expect(code).toContain("showStatus={false}");
    expect(code).toContain("showResourceMetrics={false}");
    expect(builtInDescriptions(code)).toEqual({});
  });

  test("Clusters", () => {
    const code: string = readCode(PAGES["clusters"]!);

    expect(columnPairs(code)).toEqual([
      ["Hosts (effective / total)", "clusterListHosts"],
      ["VMs (powered on / total)", "clusterListVirtualMachines"],
      ["Templates", "clusterListTemplates"],
      ["Effective CPU", "clusterListEffectiveCpu"],
      ["Effective Memory", "clusterListEffectiveMemory"],
    ]);
    expect(code).toContain("showStatus={false}");
    expect(code).toContain("showResourceMetrics={false}");
    expect(builtInDescriptions(code)).toEqual({});
  });

  test("Resource Pools", () => {
    const code: string = readCode(PAGES["resourcePools"]!);

    expect(columnPairs(code)).toEqual([
      ["Inventory Path", null],
      ["CPU Usage", "resourcePoolListCpu"],
      ["Memory Usage", "resourcePoolListMemory"],
      ["Ballooned / Swapped", "resourcePoolListBalloonedSwapped"],
    ]);
    expect(code).toContain("showStatus={false}");
    expect(code).toContain("showResourceMetrics={false}");
    expect(builtInDescriptions(code)).toEqual({});
  });

  test("the shared table still turns column descriptions into header tooltips", () => {
    const table: string = readCode(
      "Components/Infrastructure/ResourceTable.tsx",
    );

    expect(table).toContain("headerTooltip: col.description,");
    expect(table).toContain(
      "headerTooltip: props.builtInColumnDescriptions?.status,",
    );
    expect(table).toContain(
      "headerTooltip: props.builtInColumnDescriptions?.cpu,",
    );
    expect(table).toContain(
      "headerTooltip: props.builtInColumnDescriptions?.memory,",
    );
    expect(table).toContain(
      "headerTooltip: props.builtInColumnDescriptions?.age,",
    );
  });
});
