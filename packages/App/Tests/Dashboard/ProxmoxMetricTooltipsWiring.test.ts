import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  PROXMOX_METRIC_DESCRIPTIONS,
  ProxmoxMetric,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/ProxmoxMetricDescriptions";
import { escapeRegExp } from "Common/Utils/RegExpEscape";

/*
 * Every metric on the Proxmox pages carries an (i) that explains it. The
 * App suite runs in plain Node with no renderer, so this pins the JSX wiring
 * by reading the sources - the cluster's pages and the parts they are built
 * from (a node's, guest's and storage's Overview, their hero, the Backups
 * card and the list columns): each title is paired with its own
 * description, no tile, chart card, stat, row or column that shows a reading
 * is left without one, and the metadata (names, IDs, timestamps) is left
 * alone. Comments are stripped and whitespace squashed so Prettier reflows
 * and rationale comments cannot make a test pass or fail. The Common suite
 * renders the same pages for real (ProxmoxOverviewTooltips /
 * ProxmoxResourcePageTooltips / ProxmoxPartPages).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);
const PROXMOX_VIEW: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "Proxmox",
  "View",
);
const PROXMOX_COMPONENTS: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "Proxmox",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;
const DESCRIPTION_REFERENCE: RegExp = /PROXMOX_METRIC_DESCRIPTIONS\.(\w+)/g;
const COLUMN_HEADING: RegExp = /heading: "([^"]+)"/;
const RECORD_IMPORT: string =
  'import { PROXMOX_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/ProxmoxMetricDescriptions";';
const COMPONENT_RECORD_IMPORT: RegExp =
  /import \{ PROXMOX_METRIC_DESCRIPTIONS \} from "(\.\.\/)+MetricDescriptions\/ProxmoxMetricDescriptions";/;
const TOOLTIP_IMPORT: string =
  'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";';

/*
 * A tile as the parts and the Overview write it: its English title, which
 * the tile translates, then its description.
 */
const DESCRIBED_TILE: RegExp =
  /<GoldenMetricTile title="([^"]+)"(?:(?!<GoldenMetricTile ).)*?description=\{PROXMOX_METRIC_DESCRIPTIONS\.(\w+)\}/g;
// A details row with a description, before the next row's label.
const DESCRIBED_ROW: RegExp =
  /label: "([^"]+)",(?:(?!label: ").)*?description: PROXMOX_METRIC_DESCRIPTIONS\.(\w+),/g;
const ROW_LABEL: RegExp =
  /detailRows\.push\(\{ key: "[^"]+", label: "([^"]+)",/g;

function readCode(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

function view(file: string): string {
  return readCode(path.join(PROXMOX_VIEW, file));
}

function component(file: string): string {
  return readCode(path.join(PROXMOX_COMPONENTS, file));
}

function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = source.indexOf(to, start + from.length);

  return end >= 0 ? source.slice(start, end) : source.slice(start);
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/*
 * `<InfoTooltip label="X" text={PROXMOX_METRIC_DESCRIPTIONS.key} />`, with
 * `before` right in front of it and `after` right behind it. Prettier puts
 * spaces inside the braces once a line gets long, so those are optional.
 */
function tooltipPattern(
  label: string,
  key: ProxmoxMetric,
  before: string = "",
  after: string = "",
): RegExp {
  return new RegExp(
    `${escapeRegExp(before)}<InfoTooltip label="${escapeRegExp(label)}" text=\\{ ?PROXMOX_METRIC_DESCRIPTIONS\\.${key} ?\\} />${escapeRegExp(after)}`,
  );
}

/*
 * A heading as the page draws it: its English text, looked up in the
 * reader's language. The (i) beside it keeps the English text as its label,
 * which InfoTooltip translates for the screen reader itself.
 */
function shown(text: string): string {
  return `{translator.translateText("${text}")}`;
}

function referencedKeys(source: string): Array<string> {
  return Array.from(source.matchAll(DESCRIPTION_REFERENCE)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

// Each tile's title and the description it carries, in page order.
function describedTiles(source: string): Array<[string, string]> {
  return Array.from(source.matchAll(DESCRIBED_TILE)).map(
    (match: RegExpMatchArray): [string, string] => {
      return [match[1]!, match[2]!];
    },
  );
}

// Each details row that carries a description, and which one.
function describedRows(source: string): Array<[string, string]> {
  return Array.from(source.matchAll(DESCRIBED_ROW)).map(
    (match: RegExpMatchArray): [string, string] => {
      return [match[1]!, match[2]!];
    },
  );
}

function rowLabels(source: string): Array<string> {
  return Array.from(source.matchAll(ROW_LABEL)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

const OVERVIEW: string = view("Index.tsx");
const NODE_DETAIL: string = view("NodeDetail.tsx");
const GUEST_DETAIL: string = view("GuestDetail.tsx");
const STORAGE_DETAIL: string = view("StorageDetail.tsx");
const NODES: string = view("Nodes.tsx");
const GUESTS: string = view("Guests.tsx");
const STORAGE: string = view("Storage.tsx");
const INSIGHTS: string = view("Insights.tsx");

const BACKUPS_CARD: string = component("ProxmoxBackupsCard.tsx");
const COLUMNS: string = component("ProxmoxResourceColumns.ts");
const PART_HERO: string = component(path.join("Part", "ProxmoxPartHero.tsx"));
const NODE_OVERVIEW: string = component(
  path.join("Part", "ProxmoxNodeOverview.tsx"),
);
const GUEST_OVERVIEW: string = component(
  path.join("Part", "ProxmoxGuestOverview.tsx"),
);
const STORAGE_OVERVIEW: string = component(
  path.join("Part", "ProxmoxStorageOverview.tsx"),
);

const PAGES: Record<string, string> = {
  "Index.tsx": OVERVIEW,
  "NodeDetail.tsx": NODE_DETAIL,
  "GuestDetail.tsx": GUEST_DETAIL,
  "Nodes.tsx": NODES,
  "Guests.tsx": GUESTS,
  "Storage.tsx": STORAGE,
  "Insights.tsx": INSIGHTS,
};

const COMPONENTS: Record<string, string> = {
  "ProxmoxBackupsCard.tsx": BACKUPS_CARD,
  "ProxmoxResourceColumns.ts": COLUMNS,
  "Part/ProxmoxPartHero.tsx": PART_HERO,
  "Part/ProxmoxNodeOverview.tsx": NODE_OVERVIEW,
  "Part/ProxmoxGuestOverview.tsx": GUEST_OVERVIEW,
  "Part/ProxmoxStorageOverview.tsx": STORAGE_OVERVIEW,
};

const ALL_SOURCES: Record<string, string> = {
  ...PAGES,
  "StorageDetail.tsx": STORAGE_DETAIL,
  ...COMPONENTS,
};

/*
 * The overview's replication columns by heading: each `{ ... }` record of
 * the REPLICATION_COLUMNS list its header row maps over. A record also
 * names its column for resizing (id) and how far its values may give way
 * (kind).
 */
function replicationColumns(): Map<string, string> {
  const list: string = between(
    OVERVIEW,
    "const REPLICATION_COLUMNS: Array<ReplicationColumn> = [",
    "];",
  );
  const columns: Map<string, string> = new Map<string, string>();

  for (const record of list.match(/\{[^{}]*\}/g) || []) {
    const heading: string | undefined = COLUMN_HEADING.exec(record)?.[1];

    if (heading) {
      columns.set(heading, record);
    }
  }

  return columns;
}

describe("the Proxmox pages read their words from one record", () => {
  test.each(Object.keys(PAGES))(
    "%s imports PROXMOX_METRIC_DESCRIPTIONS",
    (file: string) => {
      expect(PAGES[file]).toContain(RECORD_IMPORT);
    },
  );

  test.each(Object.keys(COMPONENTS))(
    "%s imports PROXMOX_METRIC_DESCRIPTIONS",
    (file: string) => {
      expect(COMPONENTS[file]).toMatch(COMPONENT_RECORD_IMPORT);
    },
  );

  test("every description in the record is shown on a Proxmox page or part", () => {
    const shownKeys: Set<string> = new Set(
      Object.values(ALL_SOURCES).flatMap(referencedKeys),
    );

    expect(
      Object.keys(PROXMOX_METRIC_DESCRIPTIONS).filter((key: string) => {
        return !shownKeys.has(key);
      }),
    ).toEqual([]);
  });

  test("no page or part points at a description the record does not have", () => {
    const known: Set<string> = new Set(
      Object.keys(PROXMOX_METRIC_DESCRIPTIONS),
    );

    for (const [file, source] of Object.entries(ALL_SOURCES)) {
      expect({
        file,
        unknown: referencedKeys(source).filter((key: string) => {
          return !known.has(key);
        }),
      }).toEqual({ file, unknown: [] });
    }
  });

  test("no page or part writes its explanation inline instead of using the record", () => {
    for (const [file, source] of Object.entries(ALL_SOURCES)) {
      const inlineTooltip: RegExp = /<InfoTooltip[^>]*text="/;
      const inlineCardTooltip: RegExp = /tooltip="/;

      expect({ file, inline: inlineTooltip.test(source) }).toEqual({
        file,
        inline: false,
      });
      expect({ file, inline: inlineCardTooltip.test(source) }).toEqual({
        file,
        inline: false,
      });
    }
  });
});

describe("cluster overview: golden tiles", () => {
  test("every tile carries its own description", () => {
    expect(describedTiles(OVERVIEW)).toEqual([
      ["Node Availability", "nodeAvailability"],
      ["CPU", "clusterCpu"],
      ["Memory", "clusterMemory"],
      ["Storage", "fullestStorage"],
      ["Guests", "guestsRunning"],
    ]);
    expect(count(OVERVIEW, "<GoldenMetricTile ")).toBe(5);
  });
});

describe("cluster overview: chart cards", () => {
  const CHARTS: Array<[string, ProxmoxMetric]> = [
    ["CPU", "cpuChart"],
    ["Memory", "memoryChart"],
    ["Storage", "storageChart"],
    ["Network", "networkChart"],
  ];

  const definition: string = between(
    OVERVIEW,
    "const renderChartCard:",
    "const renderGoldenCharts:",
  );

  test("the local chart card takes a description", () => {
    expect(count(definition, "description?: string | undefined;")).toBe(2);
  });

  test("its (i) sits in one header, beside the title", () => {
    expect(definition).toContain(
      "<InfoTooltip label={params.title} text={params.description} />",
    );
    /*
     * The title is rendered once, in the header, in the reader's language,
     * and nowhere else. The (i) is named after the English title, which it
     * translates itself.
     */
    expect(
      count(
        definition,
        "> {translator.translateText(params.title) || params.title} <",
      ),
    ).toBe(1);
    expect(count(definition, "> {params.title} <")).toBe(0);
    expect(count(definition, "{params.title}")).toBe(1);
    expect(count(definition, "label={params.title}")).toBe(1);
  });

  test("the skeleton and the loaded card both render that header", () => {
    const skeleton: string = between(
      definition,
      "if (!chartWindow) {",
      "const xAxis:",
    );
    const loaded: string = definition.slice(definition.indexOf("const xAxis:"));

    expect(skeleton).toContain("{header}");
    expect(loaded).toContain("{header}");
    expect(count(definition, "{header}")).toBe(2);
  });

  test("every renderChartCard call passes a description", () => {
    const calls: Array<string> = OVERVIEW.split("{renderChartCard({").slice(1);

    expect(calls).toHaveLength(CHARTS.length);

    for (const call of calls) {
      expect(call.slice(0, call.indexOf("})}"))).toMatch(
        /description: PROXMOX_METRIC_DESCRIPTIONS\.\w+/,
      );
    }
  });

  test.each(CHARTS)(
    "the %s chart carries %s",
    (title: string, key: ProxmoxMetric) => {
      const call: string = between(
        OVERVIEW,
        `{renderChartCard({ title: "${title}",`,
        "})}",
      );

      expect(call).toContain(
        `description: PROXMOX_METRIC_DESCRIPTIONS.${key},`,
      );
    },
  );
});

describe("cluster overview: hero, cards and tables", () => {
  test("the page imports the (i)", () => {
    expect(OVERVIEW).toContain(TOOLTIP_IMPORT);
  });

  test("the hero's Connected pill says when it turns Disconnected, and its health pill why", () => {
    const connection: string = between(
      OVERVIEW,
      'data-testid="proxmox-hero-connection"',
      'data-testid="proxmox-hero-health"',
    );

    expect(connection).toMatch(tooltipPattern("Agent Status", "agentStatus"));
    expect(count(connection, "<InfoTooltip")).toBe(1);

    const health: string = between(
      OVERVIEW,
      'data-testid="proxmox-hero-health"',
      "<ResourceHeroDescription",
    );

    expect(health).toMatch(tooltipPattern("Cluster Health", "clusterHealth"));
    expect(count(health, "<InfoTooltip")).toBe(1);
  });

  test("the hero's count chips carry one (i), and only when a count chip is shown", () => {
    const chips: string = between(
      OVERVIEW,
      "{(specChips.length > 0 || Boolean(cluster.agentVersion)) && (",
      "</div> )}",
    );

    // The agent's chip is AgentVersion's own, after the spec chips and before the (i).
    const agentChip: number = chips.indexOf(
      '<AgentVersion kind={AgentKind.ProxmoxAgent} version={cluster.agentVersion} variant="chip" />',
    );
    expect(agentChip).toBeGreaterThan(chips.indexOf("{specChips.map("));
    expect(agentChip).toBeLessThan(chips.indexOf("{hasCountChips && ("));

    expect(chips).toMatch(
      tooltipPattern(
        "Cluster inventory counts",
        "clusterInventoryCounts",
        "{hasCountChips && ( ",
        " )}",
      ),
    );
    expect(count(chips, "<InfoTooltip")).toBe(1);

    /*
     * hasCountChips is taken after the node / guest / storage chips and
     * before the version chips, so a row of versions alone has no (i).
     */
    const hero: string = between(
      OVERVIEW,
      "const specChips:",
      "const haChips:",
    );
    const flag: number = hero.indexOf(
      "const hasCountChips: boolean = specChips.length > 0;",
    );

    expect(flag).toBeGreaterThan(hero.indexOf("storage volume"));
    expect(flag).toBeLessThan(hero.indexOf("if (cluster.pveVersion)"));
  });

  test("the HA state chips carry one (i) explaining high availability", () => {
    const chips: string = between(
      OVERVIEW,
      "{haChips.length > 0 && (",
      "</div> )}",
    );

    expect(chips).toMatch(
      tooltipPattern("High-availability states", "haStates"),
    );
  });

  test("the Backups card's stats each carry their own description", () => {
    expect(describedRows(BACKUPS_CARD)).toEqual([
      ["Last backup OK", "backupsLastOk"],
      ["Last backup failed", "backupsLastFailed"],
      ["In no backup job", "backupsNotInJob"],
      ["Newest backup", "backupsNewest"],
    ]);
  });

  /*
   * After the label's last word, inside the label's own line of text (issue
   * #7348): a label that wraps keeps its (i) after the word it ends on.
   */
  test("the Backups card draws each stat's (i) after its label's last word", () => {
    expect(BACKUPS_CARD).toContain(
      'import WordsWithInfoTooltip from "Common/UI/Components/Tooltip/WordsWithInfoTooltip";',
    );
    expect(BACKUPS_CARD).toContain(
      '<dt className="text-xs font-medium text-gray-500"> <WordsWithInfoTooltip text={tx(stat.label)} label={stat.label} description={stat.description} /> </dt>',
    );
    expect(BACKUPS_CARD).not.toContain("<InfoTooltip");
  });

  test.each([
    ["Last Sync", "replicationLastSync"],
    ["Duration", "replicationDuration"],
    ["Failed Syncs", "replicationFailedSyncs"],
  ] as Array<[string, ProxmoxMetric]>)(
    "the replication column %s carries %s",
    (heading: string, key: ProxmoxMetric) => {
      const column: string | undefined = replicationColumns().get(heading);

      expect(column).toContain(
        `description: PROXMOX_METRIC_DESCRIPTIONS.${key},`,
      );
      // Its own description, and no other.
      expect(count(column!, "description:")).toBe(1);
    },
  );

  test("replication identity columns have no (i)", () => {
    const columns: Map<string, string> = replicationColumns();

    for (const heading of ["Job", "Guest", "Source → Target"]) {
      const column: string | undefined = columns.get(heading);

      expect({
        heading,
        isColumn: column !== undefined,
        hasDescription: Boolean(column?.includes("description")),
      }).toEqual({ heading, isColumn: true, hasDescription: false });
    }
  });

  test("each replication header renders its own (i), which renders nothing without text", () => {
    const header: string = between(OVERVIEW, "<thead>", "</thead>");

    // The header row draws the records the tests above read.
    expect(header).toContain("{REPLICATION_COLUMNS.map(");
    expect(header).toContain(
      "<InfoTooltip label={column.heading} text={column.description}",
    );
  });

  test("the Ceph card explains its capacity figure", () => {
    const ceph: string = between(
      OVERVIEW,
      "const renderCephStorage:",
      "const renderTopGuestList:",
    );

    expect(ceph).toMatch(
      tooltipPattern(
        "Capacity used",
        "cephCapacityUsed",
        `${shown("Capacity used")} `,
      ),
    );
  });

  test.each([
    ["CPU Usage", "topGuestsByCpu"],
    ["Memory Usage", "topGuestsByMemory"],
  ] as Array<[string, ProxmoxMetric]>)(
    "the top consumers heading %s carries %s",
    (heading: string, key: ProxmoxMetric) => {
      expect(OVERVIEW).toMatch(
        tooltipPattern(heading, key, `${shown(heading)} </h4> `),
      );
    },
  );
});

/*
 * Each rate chart's heading ends with the drag-to-zoom hint (issue #4105),
 * after its (i).
 */
const RATE_CHART_HINT: string =
  '<TimeRangeZoomHint revealOnHover={true} className="ml-auto font-normal" />';

function expectThroughputHeaders(
  source: string,
  headers: Array<[string, ProxmoxMetric]>,
): void {
  const extra: string = between(source, "renderExtraCharts={", "</div> ); }}");

  expect(count(extra, "<ProxmoxRateChart")).toBe(headers.length);
  expect(count(extra, "<InfoTooltip")).toBe(headers.length);

  for (const [header, key] of headers) {
    expect(extra).toMatch(
      tooltipPattern(
        header,
        key,
        `${shown(header)} `,
        ` ${RATE_CHART_HINT} </div> <ProxmoxRateChart`,
      ),
    );
  }
}

describe("a part's hero", () => {
  test("its status pill says what each status means, for a node, a guest and a storage", () => {
    expect(PART_HERO).toContain(
      "const STATUS_DESCRIPTIONS: Record<ProxmoxPartKind, string> = { Node: PROXMOX_METRIC_DESCRIPTIONS.nodeStatus, Guest: PROXMOX_METRIC_DESCRIPTIONS.guestStatus, Storage: PROXMOX_METRIC_DESCRIPTIONS.storageStatus, };",
    );
    expect(PART_HERO).toContain("description: STATUS_DESCRIPTIONS[props.kind]");
  });
});

describe("a node's page", () => {
  test("its tiles each carry their own description", () => {
    expect(describedTiles(NODE_OVERVIEW)).toEqual([
      ["CPU", "nodeCpu"],
      ["Memory", "nodeMemory"],
      ["Root Disk", "nodeRootDisk"],
      ["Guests", "nodeGuests"],
    ]);
    expect(count(NODE_OVERVIEW, "<GoldenMetricTile ")).toBe(4);
  });

  test("its details explain the readings, and leave the metadata alone", () => {
    expect(describedRows(NODE_OVERVIEW)).toEqual([
      ["Uptime", "nodeUptime"],
      ["HA state", "nodeHaState"],
    ]);
    expect(rowLabels(NODE_OVERVIEW)).toEqual(
      expect.arrayContaining(["Uptime", "CPU cores", "Memory", "HA state"]),
    );
  });

  test("each throughput chart has an (i) on its header", () => {
    expectThroughputHeaders(NODE_DETAIL, [
      ["Network Throughput", "nodeNetworkThroughput"],
      ["Disk Throughput", "nodeDiskThroughput"],
    ]);
    expect(NODE_DETAIL).toContain(TOOLTIP_IMPORT);
  });

  test("its Guests and Storage tabs explain their columns as the lists do", () => {
    expect(NODE_DETAIL).toContain(
      "builtInColumnDescriptions={{ status: PROXMOX_METRIC_DESCRIPTIONS.guestsTableStatus, cpu: PROXMOX_METRIC_DESCRIPTIONS.guestsTableCpu, memory: PROXMOX_METRIC_DESCRIPTIONS.guestsTableMemory, age: PROXMOX_METRIC_DESCRIPTIONS.guestsTableUptime, }}",
    );
    // A storage reports no uptime: no Age column to explain.
    expect(NODE_DETAIL).toContain(
      "showAge={false} builtInColumnDescriptions={{ status: PROXMOX_METRIC_DESCRIPTIONS.storageTableStatus, }}",
    );
  });
});

describe("a guest's page", () => {
  test("its tiles each carry their own description", () => {
    expect(describedTiles(GUEST_OVERVIEW)).toEqual([
      ["CPU", "guestCpu"],
      ["Memory", "guestMemory"],
      ["Disk", "guestDisk"],
      ["Last Backup", "guestLastBackup"],
    ]);
    expect(count(GUEST_OVERVIEW, "<GoldenMetricTile ")).toBe(4);
  });

  test("its details explain the readings, and leave the metadata alone", () => {
    expect(describedRows(GUEST_OVERVIEW)).toEqual([
      ["Start on boot", "guestStartOnBoot"],
      ["HA state", "guestHaState"],
      ["Backup job", "guestBackupCoverage"],
      ["Uptime", "guestUptime"],
    ]);
  });

  test("each throughput chart has an (i) on its header", () => {
    expectThroughputHeaders(GUEST_DETAIL, [
      ["Network Throughput", "guestNetworkThroughput"],
      ["Disk Throughput", "guestDiskThroughput"],
    ]);
    expect(GUEST_DETAIL).toContain(TOOLTIP_IMPORT);
  });
});

describe("a storage's page", () => {
  test("its tiles each carry their own description", () => {
    expect(describedTiles(STORAGE_OVERVIEW)).toEqual([
      ["Used", "storageUsedPercent"],
      ["Free", "storageFree"],
      ["Growth Forecast", "storageGrowthForecast"],
    ]);
    expect(count(STORAGE_OVERVIEW, "<GoldenMetricTile ")).toBe(3);
  });

  test("its details explain whether it is shared, and leave the metadata alone", () => {
    expect(describedRows(STORAGE_OVERVIEW)).toEqual([
      ["Shared", "storageShared"],
    ]);
  });
});

describe("list pages", () => {
  test("Nodes explains its built-in Status, CPU, Memory and Age columns, and its Guests column", () => {
    expect(NODES).toContain(
      "builtInColumnDescriptions={{ status: PROXMOX_METRIC_DESCRIPTIONS.nodesTableStatus, cpu: PROXMOX_METRIC_DESCRIPTIONS.nodesTableCpu, memory: PROXMOX_METRIC_DESCRIPTIONS.nodesTableMemory, age: PROXMOX_METRIC_DESCRIPTIONS.nodesTableUptime, }}",
    );
    expect(COLUMNS).toContain(
      'title: "Guests", key: "guests", description: PROXMOX_METRIC_DESCRIPTIONS.nodesTableGuests,',
    );
  });

  test("Guests explains its built-in columns", () => {
    expect(GUESTS).toContain(
      "builtInColumnDescriptions={{ status: PROXMOX_METRIC_DESCRIPTIONS.guestsTableStatus, cpu: PROXMOX_METRIC_DESCRIPTIONS.guestsTableCpu, memory: PROXMOX_METRIC_DESCRIPTIONS.guestsTableMemory, age: PROXMOX_METRIC_DESCRIPTIONS.guestsTableUptime, }}",
    );
  });

  test.each([
    ["HA State", "haState", "guestsTableHaState"],
    ["Backup", "backup", "guestsTableBackup"],
  ] as Array<[string, string, ProxmoxMetric]>)(
    "the Guests column %s carries %s",
    (title: string, columnKey: string, key: ProxmoxMetric) => {
      expect(COLUMNS).toContain(
        `title: "${title}", key: "${columnKey}", description: PROXMOX_METRIC_DESCRIPTIONS.${key},`,
      );
    },
  );

  test("the Guests identity columns have no (i)", () => {
    expect(COLUMNS).toContain('{ title: "VMID", key: "vmid", }');
    expect(
      between(COLUMNS, '{ title: "Type", key: "guestKind",', "}, }"),
    ).not.toContain("description:");
  });

  test("Storage explains its Status column, whether a storage is shared, and its usage - and has no Age column", () => {
    expect(STORAGE).toContain(
      "builtInColumnDescriptions={{ status: PROXMOX_METRIC_DESCRIPTIONS.storageTableStatus, }}",
    );
    // A storage reports no uptime: no column of dashes.
    expect(STORAGE).toContain("showAge={false}");
    expect(COLUMNS).toContain(
      'title: "Shared", key: "shared", description: PROXMOX_METRIC_DESCRIPTIONS.storageShared,',
    );
    expect(COLUMNS).toContain(
      'title: "Used / Total", key: "diskBytes", description: PROXMOX_METRIC_DESCRIPTIONS.storageTableUsage,',
    );
    // Storage has no CPU or memory columns, so it must not describe them.
    expect(STORAGE).toContain("showResourceMetrics={false}");
    expect(STORAGE).not.toMatch(/\b(cpu|memory): PROXMOX_METRIC/);
  });
});

describe("insights", () => {
  test("the Disk Throughput header above its rate chart has an (i)", () => {
    const extra: string = between(
      INSIGHTS,
      "renderExtraCharts={",
      "</div> ); }}",
    );

    expect(extra).toMatch(
      tooltipPattern(
        "Disk Throughput",
        "insightsDiskThroughput",
        `${shown("Disk Throughput")} `,
        ` ${RATE_CHART_HINT} </div> <ProxmoxRateChart`,
      ),
    );
    expect(INSIGHTS).toContain(TOOLTIP_IMPORT);
  });

  test("the network rate chart is explained by its card's visible description instead", () => {
    const network: string = between(
      INSIGHTS,
      'getSectionTitle(IconProp.Signal, "Network")',
      "</EmbeddedMetricCard>",
    );

    expect(network).toContain(
      'description="Per-second inbound and outbound network throughput summed across all guests."',
    );
    expect(network).toContain("<ProxmoxRateChart");
  });
});
