import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  PROXMOX_METRIC_DESCRIPTIONS,
  ProxmoxMetric,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/ProxmoxMetricDescriptions";

/*
 * Every metric on the Proxmox pages carries an (i) that explains it. The
 * App suite runs in plain Node with no renderer, so this pins the JSX wiring
 * by reading the sources: each title is paired with its own description, no
 * tile, chart card, summary field or column is left without one, and the
 * metadata fields (names, IDs, timestamps) are left alone. Comments are
 * stripped and whitespace squashed so Prettier reflows and rationale
 * comments cannot make a test pass or fail. The Common suite renders the
 * same pages for real (ProxmoxOverviewTooltips / ProxmoxResourcePageTooltips).
 */

const PROXMOX_VIEW: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Proxmox",
  "View",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;
const DESCRIPTION_REFERENCE: RegExp = /PROXMOX_METRIC_DESCRIPTIONS\.(\w+)/g;
const RECORD_IMPORT: string =
  'import { PROXMOX_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/ProxmoxMetricDescriptions";';
const TOOLTIP_IMPORT: string =
  'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";';

function readCode(file: string): string {
  return fs
    .readFileSync(path.join(PROXMOX_VIEW, file), "utf8")
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

  return end >= 0 ? source.slice(start, end) : source.slice(start);
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const REGEX_SPECIALS: RegExp = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(text: string): string {
  return text.replace(REGEX_SPECIALS, "\\$&");
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

function referencedKeys(source: string): Array<string> {
  return Array.from(source.matchAll(DESCRIPTION_REFERENCE)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

const OVERVIEW: string = readCode("Index.tsx");
const NODE_DETAIL: string = readCode("NodeDetail.tsx");
const GUEST_DETAIL: string = readCode("GuestDetail.tsx");
const STORAGE_DETAIL: string = readCode("StorageDetail.tsx");
const NODES: string = readCode("Nodes.tsx");
const GUESTS: string = readCode("Guests.tsx");
const STORAGE: string = readCode("Storage.tsx");
const INSIGHTS: string = readCode("Insights.tsx");

const ALL_PAGES: Record<string, string> = {
  "Index.tsx": OVERVIEW,
  "NodeDetail.tsx": NODE_DETAIL,
  "GuestDetail.tsx": GUEST_DETAIL,
  "StorageDetail.tsx": STORAGE_DETAIL,
  "Nodes.tsx": NODES,
  "Guests.tsx": GUESTS,
  "Storage.tsx": STORAGE,
  "Insights.tsx": INSIGHTS,
};

describe("the Proxmox pages read their words from one record", () => {
  test.each(Object.keys(ALL_PAGES))(
    "%s imports PROXMOX_METRIC_DESCRIPTIONS",
    (file: string) => {
      expect(ALL_PAGES[file]).toContain(RECORD_IMPORT);
    },
  );

  test("every description in the record is shown on a Proxmox page", () => {
    const shown: Set<string> = new Set(
      Object.values(ALL_PAGES).flatMap(referencedKeys),
    );

    expect(
      Object.keys(PROXMOX_METRIC_DESCRIPTIONS).filter((key: string) => {
        return !shown.has(key);
      }),
    ).toEqual([]);
  });

  test("no page points at a description the record does not have", () => {
    const known: Set<string> = new Set(
      Object.keys(PROXMOX_METRIC_DESCRIPTIONS),
    );

    for (const [file, source] of Object.entries(ALL_PAGES)) {
      expect({
        file,
        unknown: referencedKeys(source).filter((key: string) => {
          return !known.has(key);
        }),
      }).toEqual({ file, unknown: [] });
    }
  });

  test("no page writes its explanation inline instead of using the record", () => {
    for (const [file, source] of Object.entries(ALL_PAGES)) {
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
  const TILES: Array<[string, ProxmoxMetric]> = [
    ["Node Availability", "nodeAvailability"],
    ["CPU", "clusterCpu"],
    ["Memory", "clusterMemory"],
    ["Storage", "fullestStorage"],
    ["Guests", "guestsRunning"],
    ["Backup Coverage", "backupCoverage"],
  ];

  test("every GoldenMetricTile on the page has a description", () => {
    const tiles: Array<string> = OVERVIEW.split("<GoldenMetricTile ").slice(1);

    expect(tiles).toHaveLength(TILES.length);

    for (const tile of tiles) {
      const props: string = tile.slice(0, tile.indexOf("/>"));

      expect(props).toMatch(/description=\{PROXMOX_METRIC_DESCRIPTIONS\.\w+\}/);
    }
  });

  test.each(TILES)(
    "the %s tile carries %s",
    (title: string, key: ProxmoxMetric) => {
      const tile: string = between(
        OVERVIEW,
        `<GoldenMetricTile title="${title}"`,
        "/>",
      );

      expect(tile).toContain(
        `description={PROXMOX_METRIC_DESCRIPTIONS.${key}}`,
      );
    },
  );
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
    // The title is rendered once, in the header, and nowhere else.
    expect(count(definition, "> {params.title} <")).toBe(1);
    expect(count(definition, "{params.title}")).toBe(2);
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

  test("the hero's count chips carry one (i), and only when a count chip is shown", () => {
    const chips: string = between(
      OVERVIEW,
      "{specChips.length > 0 && (",
      "</div> )}",
    );

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

  test.each([
    ["Last Sync", "replicationLastSync"],
    ["Duration", "replicationDuration"],
    ["Failed Syncs", "replicationFailedSyncs"],
  ] as Array<[string, ProxmoxMetric]>)(
    "the replication column %s carries %s",
    (heading: string, key: ProxmoxMetric) => {
      expect(OVERVIEW).toContain(
        `heading: "${heading}", description: PROXMOX_METRIC_DESCRIPTIONS.${key}, }`,
      );
    },
  );

  test("replication identity columns have no (i)", () => {
    expect(OVERVIEW).toContain('{ heading: "Job" }');
    expect(OVERVIEW).toContain('{ heading: "Guest" }');
    expect(OVERVIEW).toContain('{ heading: "Source → Target" }');
  });

  test("each replication header renders its own (i), which renders nothing without text", () => {
    const header: string = between(OVERVIEW, "<thead>", "</thead>");

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
      tooltipPattern("Capacity used", "cephCapacityUsed", "Capacity used "),
    );
  });

  test.each([
    ["CPU Usage", "topGuestsByCpu"],
    ["Memory Usage", "topGuestsByMemory"],
  ] as Array<[string, ProxmoxMetric]>)(
    "the top consumers heading %s carries %s",
    (heading: string, key: ProxmoxMetric) => {
      expect(OVERVIEW).toMatch(
        tooltipPattern(heading, key, `${heading} </h4> `),
      );
    },
  );
});

describe("cluster overview: summary strip", () => {
  const strip: string = between(
    OVERVIEW,
    '<InfoCard title="Cluster Health"',
    "<ResourceActivityCards",
  );

  test.each([
    ["Cluster Health", "clusterHealth"],
    ["Quorum", "quorum"],
    ["Agent Status", "agentStatus"],
  ] as Array<[string, ProxmoxMetric]>)(
    "the %s card carries %s",
    (title: string, key: ProxmoxMetric) => {
      expect(strip).toContain(
        `<InfoCard title="${title}" tooltip={PROXMOX_METRIC_DESCRIPTIONS.${key}}`,
      );
    },
  );

  test.each([
    ["Nodes", "nodeCount", "nodesRoute", "Open the node list"],
    ["Guests", "guestCount", "guestsRoute", "Open the guest list"],
    ["Storage", "storageCount", "storageRoute", "Open the storage list"],
  ] as Array<[string, ProxmoxMetric, string, string]>)(
    "the linked %s card carries %s and still opens its list",
    (title: string, key: ProxmoxMetric, route: string, label: string) => {
      expect(strip).toContain(
        `{renderLinkedSummaryCard({ title: "${title}", description: PROXMOX_METRIC_DESCRIPTIONS.${key}, route: ${route}, linkLabel: "${label}",`,
      );
    },
  );

  test("every InfoCard on the page has a tooltip", () => {
    const cards: Array<string> = OVERVIEW.split("<InfoCard ").slice(1);

    expect(cards.length).toBeGreaterThanOrEqual(4);

    for (const card of cards) {
      expect(card.slice(0, card.indexOf("value="))).toMatch(/tooltip=\{/);
    }
  });

  test("no summary card is itself a button around its (i)", () => {
    /*
     * The summary cards that open a list are navigation, so they use an
     * overlay link with a real href instead of InfoCard's onClick.
     */
    const cards: Array<string> = OVERVIEW.split("<InfoCard ").slice(1);

    for (const card of cards) {
      expect(card.slice(0, card.indexOf("/>"))).not.toContain("onClick=");
    }
  });

  test("the linked card lays a real link over a plain card and lifts the (i) above it", () => {
    const helper: string = between(
      OVERVIEW,
      "const renderLinkedSummaryCard:",
      "return ( <Fragment>",
    );

    expect(helper).toContain('<div className="group relative">');
    expect(helper).toContain("<Link to={params.route}");
    expect(helper).toContain("absolute inset-0");
    expect(helper).toContain(
      '<span className="sr-only">{params.linkLabel}</span>',
    );
    expect(helper).toContain("tooltip={params.description}");
    expect(helper).toContain("[&_button]:relative [&_button]:z-10");
    // The link is closed before the card opens: the (i) is not inside it.
    expect(helper.indexOf("</Link>")).toBeLessThan(helper.indexOf("<InfoCard"));
    expect(OVERVIEW).toContain(
      'import Link from "Common/UI/Components/Link/Link";',
    );
  });

  test("the Quorum value no longer carries a second, native tooltip", () => {
    const quorum: string = between(
      strip,
      '<InfoCard title="Quorum"',
      "{renderLinkedSummaryCard(",
    );

    const value: string = between(quorum, "value={renderSummaryValue(", "/>");

    expect(value).not.toContain("title=");
    expect(OVERVIEW).not.toContain("Derived from node visibility");
  });
});

/*
 * Detail pages build their summary fields as { title, value, description }.
 * Pairs a field title with the description it must carry.
 */
function expectField(source: string, title: string, key: ProxmoxMetric): void {
  const field: string = between(source, `title: "${title}",`, "});");

  expect({ title, field }).toEqual({
    title,
    field: expect.stringContaining(
      `description: PROXMOX_METRIC_DESCRIPTIONS.${key},`,
    ),
  });
}

function expectPlainField(source: string, title: string): void {
  const field: string = between(source, `title: "${title}",`, "}");

  expect({ title, hasDescription: field.includes("description:") }).toEqual({
    title,
    hasDescription: false,
  });
}

function expectThroughputHeaders(
  source: string,
  headers: Array<[string, ProxmoxMetric]>,
): void {
  const extra: string = between(source, "renderExtraCharts={", "</div> ); }}");

  expect(count(extra, "<ProxmoxRateChart")).toBe(headers.length);
  expect(count(extra, "<InfoTooltip")).toBe(headers.length);

  for (const [header, key] of headers) {
    expect(extra).toMatch(
      tooltipPattern(header, key, `${header} `, " </div> <ProxmoxRateChart"),
    );
  }
}

describe("node detail", () => {
  test.each([
    ["Status", "nodeStatus"],
    ["Uptime", "nodeUptime"],
    ["CPU", "nodeCpu"],
    ["Memory (Used / Total)", "nodeMemory"],
    ["HA State", "nodeHaState"],
  ] as Array<[string, ProxmoxMetric]>)(
    "the %s field carries %s",
    (title: string, key: ProxmoxMetric) => {
      expectField(NODE_DETAIL, title, key);
    },
  );

  test.each(["Node Name", "Cluster", "External ID", "Last Seen"])(
    "the %s field is metadata and has no (i)",
    (title: string) => {
      expectPlainField(NODE_DETAIL, title);
    },
  );

  test("each throughput chart has an (i) on its header", () => {
    expectThroughputHeaders(NODE_DETAIL, [
      ["Network Throughput", "nodeNetworkThroughput"],
      ["Disk Throughput", "nodeDiskThroughput"],
    ]);
    expect(NODE_DETAIL).toContain(TOOLTIP_IMPORT);
  });
});

describe("guest detail", () => {
  test.each([
    ["Status", "guestStatus"],
    ["HA State", "guestHaState"],
    ["Start on Boot", "guestStartOnBoot"],
    ["Backup Job Coverage", "guestBackupCoverage"],
    ["Uptime", "guestUptime"],
    ["CPU", "guestCpu"],
    ["Memory (Used / Max)", "guestMemory"],
    ["Disk (Used / Max)", "guestDisk"],
  ] as Array<[string, ProxmoxMetric]>)(
    "the %s field carries %s",
    (title: string, key: ProxmoxMetric) => {
      expectField(GUEST_DETAIL, title, key);
    },
  );

  test("both Disk branches - measured and 'install the guest agent' - carry the (i)", () => {
    expect(count(GUEST_DETAIL, 'title: "Disk (Used / Max)",')).toBe(2);
    expect(
      count(
        GUEST_DETAIL,
        "description: PROXMOX_METRIC_DESCRIPTIONS.guestDisk,",
      ),
    ).toBe(2);
  });

  test.each([
    "Guest Name",
    "Cluster",
    "VMID",
    "Type",
    "Node",
    "External ID",
    "Last Seen",
  ])("the %s field is metadata and has no (i)", (title: string) => {
    expectPlainField(GUEST_DETAIL, title);
  });

  test("each throughput chart has an (i) on its header", () => {
    expectThroughputHeaders(GUEST_DETAIL, [
      ["Network Throughput", "guestNetworkThroughput"],
      ["Disk Throughput", "guestDiskThroughput"],
    ]);
    expect(GUEST_DETAIL).toContain(TOOLTIP_IMPORT);
  });
});

describe("storage detail", () => {
  test.each([
    ["Status", "storageStatus"],
    ["Used", "storageUsed"],
    ["Total", "storageTotal"],
    ["Used %", "storageUsedPercent"],
    ["Growth Forecast", "storageGrowthForecast"],
  ] as Array<[string, ProxmoxMetric]>)(
    "the %s field carries %s",
    (title: string, key: ProxmoxMetric) => {
      expectField(STORAGE_DETAIL, title, key);
    },
  );

  test.each(["Storage Name", "Cluster", "Node", "External ID", "Last Seen"])(
    "the %s field is metadata and has no (i)",
    (title: string) => {
      expectPlainField(STORAGE_DETAIL, title);
    },
  );
});

describe("list pages", () => {
  test("Nodes explains its built-in Status, CPU, Memory and Age columns", () => {
    expect(NODES).toContain(
      "builtInColumnDescriptions={{ status: PROXMOX_METRIC_DESCRIPTIONS.nodesTableStatus, cpu: PROXMOX_METRIC_DESCRIPTIONS.nodesTableCpu, memory: PROXMOX_METRIC_DESCRIPTIONS.nodesTableMemory, age: PROXMOX_METRIC_DESCRIPTIONS.nodesTableUptime, }}",
    );
  });

  test("Guests explains its built-in columns", () => {
    expect(GUESTS).toContain(
      "builtInColumnDescriptions={{ status: PROXMOX_METRIC_DESCRIPTIONS.guestsTableStatus, cpu: PROXMOX_METRIC_DESCRIPTIONS.guestsTableCpu, memory: PROXMOX_METRIC_DESCRIPTIONS.guestsTableMemory, age: PROXMOX_METRIC_DESCRIPTIONS.guestsTableUptime, }}",
    );
  });

  test.each([
    ["HA State", "haState", "guestsTableHaState"],
    ["Backup", "backedUp", "guestsTableBackup"],
  ] as Array<[string, string, ProxmoxMetric]>)(
    "the Guests column %s carries %s",
    (title: string, columnKey: string, key: ProxmoxMetric) => {
      expect(GUESTS).toContain(
        `title: "${title}", key: "${columnKey}", description: PROXMOX_METRIC_DESCRIPTIONS.${key},`,
      );
    },
  );

  test("the Guests identity columns have no (i)", () => {
    expect(GUESTS).toContain('{ title: "VMID", key: "vmid", }');
    expect(GUESTS).toContain('{ title: "Type", key: "guestType", }');
  });

  test("Storage explains its Status and Age columns, and the usage column", () => {
    expect(STORAGE).toContain(
      "builtInColumnDescriptions={{ status: PROXMOX_METRIC_DESCRIPTIONS.storageTableStatus, age: PROXMOX_METRIC_DESCRIPTIONS.storageTableAge, }}",
    );
    expect(STORAGE).toContain(
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
        "Disk Throughput ",
        " </div> <ProxmoxRateChart",
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
