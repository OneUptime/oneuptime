import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every number on the VMware (vCenter) pages carries an (i) that says what
 * it means. The texts live in
 * Components/MetricDescriptions/VMwareMetricDescriptions.ts; this file pins
 * that each tile, chart card, status pill, top-5 section, details row and
 * table column is handed the RIGHT text - a tile wired to its neighbour's
 * description would read fine and be wrong.
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
const TILE_DESCRIPTION: RegExp =
  /description=\{VMWARE_METRIC_DESCRIPTIONS\.(\w+)\}/;
const CARD_TOOLTIP: RegExp = /tooltip=\{VMWARE_METRIC_DESCRIPTIONS\.(\w+)\}/;
const CALL_TITLE: RegExp = /title: "([^"]+)"/;
const CALL_DESCRIPTION: RegExp =
  /description: VMWARE_METRIC_DESCRIPTIONS\.(\w+)/;
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

/*
 * The pages and the parts of a page that show a VMware number. A part's
 * page (an ESXi host's, a VM's, a datastore's, a cluster's) is put
 * together from Components/VMware/Host and Components/VMware/Part, and the
 * hosts and VMs lists - a vCenter's, a cluster's, a host's - are one
 * shared pair of tables (VMwareResourceTables): their numbers live there.
 */
const PAGES: Record<string, string> = {
  overview: "Pages/VMware/View/Index.tsx",
  hostOverview: "Components/VMware/Host/VMwareHostOverviewTab.tsx",
  hostBusiestVms: "Components/VMware/Host/VMwareHostBusiestVirtualMachines.tsx",
  hostDevices: "Components/VMware/Host/VMwareHostDeviceTables.tsx",
  hostDetails: "Components/VMware/Host/VMwareHostDetailsCard.tsx",
  partHero: "Components/VMware/Part/VMwarePartHero.tsx",
  vmOverview: "Components/VMware/Part/VMwareVirtualMachineOverview.tsx",
  datastoreOverview: "Components/VMware/Part/VMwareDatastoreOverview.tsx",
  clusterOverview: "Components/VMware/Part/VMwareClusterOverview.tsx",
  resourceTables: "Components/VMware/VMwareResourceTables.tsx",
  datastores: "Pages/VMware/View/Datastores.tsx",
  clusters: "Pages/VMware/View/Clusters.tsx",
  resourcePools: "Pages/VMware/View/ResourcePools.tsx",
};

/*
 * The pages that show VMware numbers only through those parts, and the
 * parts each one draws: a page that drew a number of its own would need
 * its own entry in PAGES.
 */
const DRAWN_BY_PARTS: Array<[string, Array<[string, string]>]> = [
  [
    "Pages/VMware/View/VirtualMachineDetail.tsx",
    [
      ["VMwarePartHero", "../../../Components/VMware/Part/VMwarePartHero"],
      [
        "VMwareVirtualMachineOverview",
        "../../../Components/VMware/Part/VMwareVirtualMachineOverview",
      ],
    ],
  ],
  [
    "Pages/VMware/View/DatastoreDetail.tsx",
    [
      ["VMwarePartHero", "../../../Components/VMware/Part/VMwarePartHero"],
      [
        "VMwareDatastoreOverview",
        "../../../Components/VMware/Part/VMwareDatastoreOverview",
      ],
    ],
  ],
  [
    "Pages/VMware/View/ClusterDetail.tsx",
    [
      ["VMwarePartHero", "../../../Components/VMware/Part/VMwarePartHero"],
      [
        "VMwareClusterOverview",
        "../../../Components/VMware/Part/VMwareClusterOverview",
      ],
      [
        "{ VMwareHostsTable, VMwareVirtualMachinesTable, }",
        "../../../Components/VMware/VMwareResourceTables",
      ],
    ],
  ],
  [
    "Pages/VMware/View/Hosts.tsx",
    [
      [
        "{ VMwareHostsTable }",
        "../../../Components/VMware/VMwareResourceTables",
      ],
    ],
  ],
  [
    "Pages/VMware/View/VirtualMachines.tsx",
    [
      [
        "{ VMwareVirtualMachinesTable }",
        "../../../Components/VMware/VMwareResourceTables",
      ],
    ],
  ],
  [
    "Components/VMware/Host/VMwareHostVirtualMachinesTab.tsx",
    [["{ VMwareVirtualMachinesTable }", "../VMwareResourceTables"]],
  ],
];

// "{ VMwareHostsTable, VMwareVirtualMachinesTable, }" -> each one's tag.
function tagsOf(binding: string): Array<string> {
  return binding
    .replace(/[{}]/g, "")
    .split(",")
    .map((name: string): string => {
      return name.trim();
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });
}

// The import of the description record, relative to the importing file.
function importLineFor(page: string): string {
  const from: string = path.posix.relative(
    path.posix.dirname(page),
    "Components/MetricDescriptions/VMwareMetricDescriptions",
  );

  return `import { VMWARE_METRIC_DESCRIPTIONS } from "${from}";`;
}

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
      expect(readSource(page)).toContain(importLineFor(page));
    },
  );

  test("the import each page is checked for is the one Pages/VMware/View uses", () => {
    expect(importLineFor("Pages/VMware/View/Index.tsx")).toBe(
      'import { VMWARE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/VMwareMetricDescriptions";',
    );
    expect(
      importLineFor("Components/VMware/Host/VMwareHostOverviewTab.tsx"),
    ).toBe(
      'import { VMWARE_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/VMwareMetricDescriptions";',
    );
  });

  test("the host's page shows no VMware number of its own, only through its parts", () => {
    const code: string = readCode("Pages/VMware/View/HostDetail.tsx");

    expect(code).not.toContain("VMWARE_METRIC_DESCRIPTIONS");
    expect(code).not.toContain("summaryFields");

    for (const part of [
      "VMwareHostOverviewTab",
      "VMwareHostVirtualMachinesTab",
    ]) {
      expect(code).toContain(
        `import ${part} from "../../../Components/VMware/Host/${part}";`,
      );
      expect(code).toContain(`<${part}`);
    }

    /*
     * The other parts with numbers are drawn by the Overview tab, so every
     * part listed above is on the host's page.
     */
    const overview: string = readCode(PAGES["hostOverview"]!);

    expect(overview).toContain("<VMwareHostBusiestVirtualMachines");
    expect(overview).toContain("<VMwareHostNetworkAdaptersCard");
    expect(overview).toContain("<VMwareHostStorageDevicesCard");
    expect(overview).toContain("<VMwareHostDetailsCard");
  });

  test.each(DRAWN_BY_PARTS)(
    "%s shows no VMware number of its own, only through its parts",
    (page: string, parts: Array<[string, string]>) => {
      const code: string = readCode(page);

      expect(code).not.toContain("VMWARE_METRIC_DESCRIPTIONS");
      expect(code).not.toContain("summaryFields");

      for (const [binding, from] of parts) {
        expect(code).toContain(`import ${binding} from "${from}";`);

        for (const tag of tagsOf(binding)) {
          expect(code).toContain(`<${tag}`);
        }
      }
    },
  );

  test("every part a page draws its numbers through is checked here", () => {
    const checked: Set<string> = new Set<string>(Object.values(PAGES));

    for (const [, parts] of DRAWN_BY_PARTS) {
      for (const [, from] of parts) {
        const file: string = from.replace(/^(\.\.\/)+/, "");
        const inComponents: string = file.startsWith("Components/")
          ? file
          : `Components/VMware/${file}`;

        expect(checked).toContain(`${inComponents}.tsx`);
      }
    }
  });

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
     * The one intentional reuse: a cluster's CPU and Memory tiles and the
     * Clusters list's CPU and Memory columns are the same measure (what
     * its hosts use of its effective capacity), so they explain themselves
     * with the same text - once on the cluster's page, once in the list.
     * The hosts and VMs lists of a vCenter, a cluster and a host are one
     * shared table each, so their texts are written once.
     */
    const uses: Map<string, Array<string>> = new Map<string, Array<string>>();

    for (const [name, page] of Object.entries(PAGES)) {
      for (const match of readCode(page).matchAll(REFERENCE)) {
        uses.set(match[1]!, [...(uses.get(match[1]!) || []), name]);
      }
    }

    const reused: Array<[string, Array<string>]> = Array.from(
      uses.entries(),
    ).filter(([, where]: [string, Array<string>]): boolean => {
      return where.length > 1;
    });

    expect(Object.fromEntries(reused)).toEqual({
      clusterCpuInUse: ["clusterOverview", "clusters"],
      clusterMemoryInUse: ["clusterOverview", "clusters"],
    });
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

    // Data Status, vCenter Health, and the count chips' one.
    expect(countOf(hero, "<InfoTooltip")).toBe(3);
    expect(hero).toContain(
      '{hasCountChips && ( <InfoTooltip label="vCenter inventory counts" text={VMWARE_METRIC_DESCRIPTIONS.overviewInventoryCounts} /> )}',
    );

    /*
     * Measured after the last count chip. The agent version chip is drawn
     * by AgentVersion after the count chips, never pushed among them, so a
     * row holding only the version gets no (i).
     */
    const flag: number = hero.indexOf(
      "const hasCountChips: boolean = specChips.length > 0;",
    );

    expect(flag).toBeGreaterThan(hero.indexOf("if (datastoreCount > 0) {"));
    expect(
      between(hero, "const specChips:", "const hasCountChips"),
    ).not.toContain("agentVersion");

    /*
     * The (i) sits in the chip row right after the count chips, not inside
     * one, and before the agent version chip: after it, it read as that
     * chip's (i), alone with it where the row wraps.
     */
    const row: string = between(
      hero,
      "{(specChips.length > 0 || Boolean(vcenter.agentVersion)) && (",
      "{hasCountChips && (",
    );

    expect(row).toContain("{specChips.map(");
    expect(row).not.toContain("<AgentVersion");
    expect(between(hero, "{hasCountChips && (", "</div>")).toContain(
      '<AgentVersion kind={AgentKind.VMwareAgent} version={vcenter.agentVersion} variant="chip" />',
    );
  });

  test("every golden tile explains itself with its own text", () => {
    const golden: string = between(
      code,
      "const renderGoldenMetrics:",
      "const renderChartCard:",
    );
    const tiles: Array<string> = piecesAfter(golden, "<GoldenMetricTile", "/>");
    // Titles in the reader's language: a tile draws its title as given.
    const pairs: Pairs = tiles.map((tile: string): [string, string | null] => {
      return [
        firstMatch(tile, TRANSLATED_TITLE) || "",
        firstMatch(tile, TILE_DESCRIPTION),
      ];
    });

    /*
     * How many hosts can run VMs, how busy they are, the fullest datastore
     * and how long VMs wait for a CPU. How many VMs run is the hero's count
     * chip, one step from the list.
     */
    expect(pairs).toEqual([
      ["Effective hosts", "overviewHostEffectiveness"],
      ["Host CPU", "overviewHostCpu"],
      ["Host Memory", "overviewHostMemory"],
      ["Datastores", "overviewDatastores"],
      ["VM CPU Ready", "overviewVmCpuReady"],
    ]);
    // No tile outside the golden row.
    expect(countOf(code, "<GoldenMetricTile")).toBe(tiles.length);
  });

  test("every golden chart card passes a description", () => {
    const charts: string = between(
      code,
      "const renderGoldenCharts:",
      "const renderTopList:",
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
     * ...and the title is drawn nowhere else (once as text, in the reader's
     * language, once as the (i)'s label), so no branch can lose the (i).
     */
    expect(countOf(card, "params.title")).toBe(2);
    expect(countOf(card, "{tx(params.title)} </span>")).toBe(1);
    expect(countOf(card, "label={params.title}")).toBe(1);

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
      "<TimeRangeZoomScope timeRange=",
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

  /*
   * The hero's two pills say how the vCenter's data arrives and how its
   * inventory is, each with its (i) beside it - where a strip of summary
   * cards once repeated the hero's counts.
   */
  test("the hero's pills explain themselves; no summary card repeats the hero", () => {
    const hero: string = between(
      code,
      "const renderHero:",
      "const renderGoldenMetrics:",
    );

    // Prettier may break a long attribute's braces over lines: read it tight.
    const tight: string = hero.replace(/\{ /g, "{").replace(/ \}/g, "}");

    expect(tight).toContain(
      '<InfoTooltip label="Data Status" text={VMWARE_METRIC_DESCRIPTIONS.overviewAgentStatus} />',
    );
    expect(tight).toContain(
      '<InfoTooltip label="vCenter Health" text={VMWARE_METRIC_DESCRIPTIONS.overviewVCenterHealth} />',
    );
    // Each (i) right after its pill, outside it.
    expect(
      between(hero, 'data-testid="vmware-hero-connection"', '"Data Status"'),
    ).toContain("{connectionLabel} </span> <InfoTooltip");
    expect(
      between(hero, 'data-testid="vmware-hero-health"', '"vCenter Health"'),
    ).toContain("{healthLabel} </span> <InfoTooltip");
    expect(code).not.toContain("<InfoCard");
    expect(code).not.toMatch(CARD_TOOLTIP);
  });

  test("no (i) sits inside a link or a button on the page", () => {
    /*
     * The count chips that open a list are links holding only their icon
     * and their words: the chips' (i) sits after them in the row. Nothing
     * on the page wraps content in an anchor or a button.
     */
    const links: Array<string> = piecesAfter(code, "<Link", "</Link>");

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).not.toContain("<InfoTooltip");
    }
    expect(code).not.toContain("<button");
    expect(code).not.toContain("<a ");
    expect(code).not.toContain("<AppLink");
  });
});

// A tile is handed its English title: it draws it in the reader's words.
const TRANSLATED_TITLE: RegExp = /title="([^"]+)"/;
const ROW_LABEL: RegExp = /label: "([^"]+)"/;

// A part page's tiles, in order: each one's title and its text.
function tilePairs(code: string): Pairs {
  return piecesAfter(code, "<GoldenMetricTile", "/>").map(
    (tile: string): [string, string | null] => {
      return [
        firstMatch(tile, TRANSLATED_TITLE) || "",
        firstMatch(tile, TILE_DESCRIPTION),
      ];
    },
  );
}

/*
 * A part page's details rows, in order: each one's label and its text
 * (null for names, ids and times - nothing to explain).
 */
function detailRowPairs(code: string): Pairs {
  return code
    .split(/\{ key: "/)
    .slice(1)
    .map((row: string): [string, string | null] => {
      const end: number = row.indexOf("});");
      const body: string = end >= 0 ? row.slice(0, end) : row;

      return [
        firstMatch(body, ROW_LABEL) || "",
        firstMatch(body, CALL_DESCRIPTION),
      ];
    });
}

describe("VMware ESXi host page", () => {
  test("every tile explains itself with its own text", () => {
    const code: string = readCode(PAGES["hostOverview"]!);
    const tiles: Array<string> = piecesAfter(code, "<GoldenMetricTile", "/>");

    expect(
      tiles.map((tile: string): [string, string | null] => {
        return [
          firstMatch(tile, TRANSLATED_TITLE) || "",
          firstMatch(tile, TILE_DESCRIPTION),
        ];
      }),
    ).toEqual([
      ["CPU", "hostCpu"],
      ["Memory", "hostMemory"],
      ["Disk latency", "hostPageDiskLatency"],
      ["Network", "hostPageNetwork"],
    ]);
  });

  test("every chart card explains itself with its own text", () => {
    const code: string = readCode(PAGES["hostOverview"]!);
    const charts: Array<string> = piecesAfter(code, "<ChartCard", "/>");

    expect(
      charts.map((chart: string): [string, string | null] => {
        return [
          firstMatch(chart, TRANSLATED_TITLE) || "",
          firstMatch(chart, TILE_DESCRIPTION),
        ];
      }),
    ).toEqual([
      ["CPU", "hostPageCpuChart"],
      ["Memory", "hostPageMemoryChart"],
      ["Disk latency", "hostPageDiskLatencyChart"],
      ["Network", "hostPageNetworkChart"],
    ]);
  });

  test("the busiest virtual machines card explains its ranking", () => {
    const code: string = readCode(PAGES["hostBusiestVms"]!);

    expect(code).toContain(
      'const title: string = tx("Busiest virtual machines");',
    );
    expect(countOf(code, "<InfoTooltip")).toBe(1);
    expect(code).toContain(
      "<InfoTooltip label={title} text={VMWARE_METRIC_DESCRIPTIONS.hostPageBusiestVirtualMachines} />",
    );
  });

  test("the device tables explain the first column of each pair", () => {
    /*
     * Received and Sent, Read and Write, Read latency and Write latency
     * are one measure in two directions: the (i) on the first says so for
     * both, so a narrow table does not repeat the same text.
     */
    const code: string = readCode(PAGES["hostDevices"]!);
    // The two tables' columns, past the column type's own declaration.
    const tables: string = code.slice(code.indexOf("columns={["));

    expect(countOf(code, "columns={[")).toBe(2);

    const columns: Pairs = piecesAfter(tables, "{ title: ", "render:").map(
      (column: string): [string, string | null] => {
        return [
          firstMatch(column, COLUMN_TITLE) || "",
          firstMatch(column, CALL_DESCRIPTION),
        ];
      },
    );

    expect(columns).toEqual([
      ["Received", "hostPageAdapterThroughput"],
      ["Sent", null],
      ["Packets", "hostPageAdapterPackets"],
      ["Errors", "hostPageAdapterErrors"],
      ["Drops", "hostPageAdapterDrops"],
      ["Read", "hostPageDeviceThroughput"],
      ["Write", null],
      ["Read latency", "hostPageDeviceLatency"],
      ["Write latency", null],
    ]);
    expect(descriptions["hostPageAdapterThroughput"]).toContain(
      "received and sent",
    );
    expect(descriptions["hostPageDeviceThroughput"]).toContain(
      "read from and written to",
    );
    expect(descriptions["hostPageDeviceLatency"]).toContain(
      "a read or a write",
    );

    // A header (i) is drawn from the column's own text, nothing else.
    expect(code).toContain(
      "<InfoTooltip label={column.title} text={column.description} />",
    );
  });

  test("the Details card explains its capacity, not its names and ids", () => {
    const code: string = readCode(PAGES["hostDetails"]!);
    const initial: string = between(
      code,
      "const rows: Array<DetailRow> = [",
      "];",
    );
    const pushed: Pairs = piecesAfter(code, "rows.push({", "});").map(
      (row: string): [string, string | null] => {
        return [
          firstMatch(row, ROW_LABEL) || "",
          firstMatch(row, CALL_DESCRIPTION),
        ];
      },
    );

    // Host name and vCenter: identity, nothing to explain.
    expect(initial).not.toContain("description:");
    expect(pushed).toEqual([
      ["Datacenter", null],
      ["Cluster", null],
      ["CPU capacity", "hostCpuCapacity"],
      ["Memory", null],
      ["Virtual machines", null],
      ["VM templates", null],
      ["Inventory ID", null],
    ]);
    // The (i) after the label's last word (WordsWithInfoTooltip, #7348).
    expect(code).toContain(
      '<WordsWithInfoTooltip className="min-w-0" text={tx(row.label)} label={row.label} description={row.description} />',
    );
    expect(code).not.toContain("<InfoTooltip");
  });

  /*
   * The tab is the vCenter's Virtual Machines list for one host: the same
   * shared table, so its columns explain themselves with that list's
   * texts, written once (checked under the lists below).
   */
  test("the Virtual machines tab is the VM list's table, for one host", () => {
    const code: string = readCode(
      "Components/VMware/Host/VMwareHostVirtualMachinesTab.tsx",
    );

    expect(code).toContain("<VMwareVirtualMachinesTable");
    expect(code).toContain('scope="host"');
    expect(code).not.toContain("columns=");
    expect(code).not.toContain("builtInColumnDescriptions");
  });
});

describe("VMware part pages: tiles and details", () => {
  test("a virtual machine's tiles and the rows that need an (i)", () => {
    const code: string = readCode(PAGES["vmOverview"]!);

    expect(tilePairs(code)).toEqual([
      ["CPU", "vmCpu"],
      ["CPU Ready", "vmCpuReady"],
      ["Memory", "vmMemory"],
      ["Disk", "vmDisk"],
    ]);
    expect(detailRowPairs(code)).toEqual([
      ["Name", null],
      ["Instance UUID", null],
      ["Host", null],
      ["vApp", null],
      ["Resource Pool", null],
      ["Inventory Path", null],
      ["Memory Ballooned", "vmMemoryBallooned"],
      ["Memory Swapped", "vmMemorySwapped"],
      ["vCenter ID", null],
      ["Last report", null],
    ]);
  });

  test("a datastore's tiles; its details are names, ids and times", () => {
    const code: string = readCode(PAGES["datastoreOverview"]!);

    expect(tilePairs(code)).toEqual([
      ["Used", "datastoreUsedPercent"],
      ["Free", "datastoreFree"],
      ["Growth Forecast", "datastoreGrowthForecast"],
    ]);
    expect(detailRowPairs(code)).toEqual([
      ["Name", null],
      ["Datacenter", null],
      ["vCenter ID", null],
      ["Last report", null],
    ]);
  });

  test("a cluster's tiles, and its effective capacity in its details", () => {
    const code: string = readCode(PAGES["clusterOverview"]!);

    expect(tilePairs(code)).toEqual([
      ["Effective hosts", "clusterHosts"],
      ["CPU", "clusterCpuInUse"],
      ["Memory", "clusterMemoryInUse"],
      ["Host failure", "clusterHostFailure"],
    ]);
    expect(detailRowPairs(code)).toEqual([
      ["Name", null],
      ["Datacenter", null],
      ["CPU (Effective / Total)", "clusterCpu"],
      ["Memory (Effective / Total)", "clusterMemory"],
      ["vCenter ID", null],
      ["Last report", null],
    ]);
  });

  /*
   * A VM's status says what it is doing; what that is read from (which
   * VMs send CPU data) is its (i), unless the status has a sentence of its
   * own (a VM on a host vCenter lost says why it is Disconnected).
   */
  test("a VM's status in the hero says what it is read from", () => {
    const code: string = readCode(PAGES["partHero"]!);

    expect(code).toContain(
      "description: status.description || VMWARE_METRIC_DESCRIPTIONS.vmPowerState,",
    );
    expect(countOf(code, "VMWARE_METRIC_DESCRIPTIONS.")).toBe(1);
  });

  test("the shared tile and details card turn a text into an (i)", () => {
    // The tile's (i) follows its title's last word (WordsWithInfoTooltip, #7348).
    expect(
      readCode("Components/Infrastructure/GoldenMetricTile.tsx"),
    ).toContain("label={props.title} description={props.description} />");
    expect(
      readCode("Components/Infrastructure/GoldenMetricTile.tsx"),
    ).toContain("<WordsWithInfoTooltip");
    expect(
      readCode("Components/ResourcePart/ResourcePartDetailsCard.tsx"),
    ).toContain(
      "{row.description ? ( <InfoTooltip label={row.label} text={row.description} /> ) : ( <></> )}",
    );
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

/*
 * The columns a shared table pushes, in order: each one's title and the
 * description it carries.
 */
function pushedColumnPairs(code: string): Pairs {
  return code
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

describe("VMware list pages: column headers", () => {
  const tables: string = readCode(PAGES["resourceTables"]!);
  const hostsTable: string = between(
    tables,
    "export const VMwareHostsTable:",
    "export interface VirtualMachinesTableProps",
  );
  const vmsTable: string = tables.slice(
    tables.indexOf("export const VMwareVirtualMachinesTable:"),
  );

  /*
   * A host's status is vCenter's word for it (Connected, Not responding,
   * In standby...), so the Status column says how it is read; vCenter
   * reports no uptime, so there is no Age column.
   */
  test("Hosts", () => {
    expect(pushedColumnPairs(hostsTable)).toEqual([
      ["Cluster", null],
      ["CPU Capacity", "hostListCpuCapacity"],
    ]);
    expect(hostsTable).not.toContain("showStatus={false}");
    expect(hostsTable).toContain("showAge={false}");
    expect(builtInDescriptions(hostsTable)).toEqual({
      status: "hostListStatus",
      cpu: "hostListCpu",
      memory: "hostListMemory",
    });
  });

  test("Virtual Machines", () => {
    expect(vmsTable.length).toBeGreaterThan(0);
    expect(pushedColumnPairs(vmsTable)).toEqual([
      ["Cluster", null],
      ["Resource Pool", null],
      ["CPU Ready", "vmListCpuReady"],
    ]);
    // Status, CPU and memory; no Age column (vCenter reports no start time).
    expect(vmsTable).not.toContain("showStatus={false}");
    expect(vmsTable).not.toContain("showResourceMetrics={false}");
    expect(vmsTable).toContain("showAge={false}");
    expect(builtInDescriptions(vmsTable)).toEqual({
      status: "vmListStatus",
      cpu: "vmListCpu",
      memory: "vmListMemory",
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

  /*
   * A cluster's status (Healthy, Degraded, Unhealthy) and how much of its
   * effective capacity its hosts use, as its page's tiles say them.
   */
  test("Clusters", () => {
    const code: string = readCode(PAGES["clusters"]!);

    expect(columnPairs(code)).toEqual([
      ["Hosts", "clusterListHosts"],
      ["VMs", "clusterListVirtualMachines"],
    ]);
    expect(code).not.toContain("showStatus={false}");
    expect(code).not.toContain("showResourceMetrics={false}");
    expect(code).toContain("showAge={false}");
    expect(builtInDescriptions(code)).toEqual({
      status: "clusterListStatus",
      cpu: "clusterCpuInUse",
      memory: "clusterMemoryInUse",
    });
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
