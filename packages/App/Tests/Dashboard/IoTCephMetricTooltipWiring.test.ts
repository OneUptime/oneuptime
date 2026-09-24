import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  IOT_METRIC_DESCRIPTIONS,
  IoTMetric,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/IoTMetricDescriptions";
import {
  CEPH_METRIC_DESCRIPTIONS,
  CephMetric,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/CephMetricDescriptions";

/*
 * Source-level pins for the (i) tooltips on the IoT and Ceph pages: every
 * metric title is paired with its own description reference, the counts of
 * tiles / columns / rate charts match the counts of descriptions, and no
 * (i) - a <button> - is placed inside a link or another button.
 *
 * The rendered behaviour (the tooltip text a customer reads, and the data
 * claims each text makes) is covered in
 * Common/Tests/App/Dashboard/{IoT,Ceph}MetricTooltips.test.tsx. These pins
 * are cheap and catch a refactor that drops a description= prop from one
 * tile while the rest still render.
 *
 * Comments are stripped and whitespace squashed so Prettier can reflow
 * props without making the tests brittle.
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
const IOT_REFERENCE: RegExp = /IOT_METRIC_DESCRIPTIONS\.(\w+)/g;
const CEPH_REFERENCE: RegExp = /CEPH_METRIC_DESCRIPTIONS\.(\w+)/g;
const GOLDEN_TILE: RegExp = /<GoldenMetricTile\b/g;
const RATE_CHART: RegExp = /<CephRateChart\b/g;
const INFO_TOOLTIP: RegExp = /<InfoTooltip\b/g;
const LINK_BLOCK: RegExp = /<(Link|AppLink|a)\b[^>]*>[\s\S]*?<\/\1>/g;
const BUTTON_BLOCK: RegExp = /<button\b[^>]*>[\s\S]*?<\/button>/g;
const REGEXP_SPECIAL: RegExp = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(text: string): string {
  return text.replace(REGEXP_SPECIAL, "\\$&");
}

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

function count(code: string, pattern: RegExp): number {
  return (code.match(pattern) || []).length;
}

function references(code: string, pattern: RegExp): Array<string> {
  return Array.from(code.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

/*
 * The object literal (or JSX) that starts at `marker`, up to the next
 * occurrence of `stop` - enough to find a summary field's or column's own
 * props without a parser.
 */
function segment(code: string, marker: string, stop: string): string {
  const start: number = code.indexOf(marker);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${marker}".`);
  }

  const end: number = code.indexOf(stop, start + marker.length);

  return end >= 0 ? code.slice(start, end) : code.slice(start);
}

/*
 * A detail page's summary fields, from their declaration on - so a chart
 * query config earlier in the file that happens to share a title ("Signal
 * Strength", "Objects") is never mistaken for the field.
 */
function summaryFieldsCode(code: string): string {
  const start: number = code.indexOf(
    "const summaryFields: Array<SummaryField>",
  );

  if (start < 0) {
    throw new Error("Expected the page to declare its summaryFields.");
  }

  return code.slice(start);
}

const PAGES: Record<string, string> = {
  iotOverview: "Pages/IoT/View/Index.tsx",
  iotDeviceDetail: "Pages/IoT/View/DeviceDetail.tsx",
  iotDevices: "Pages/IoT/View/Devices.tsx",
  iotFleets: "Pages/IoT/Fleets.tsx",
  cephOverview: "Pages/Ceph/View/Index.tsx",
  cephOsds: "Pages/Ceph/View/Osds.tsx",
  cephOsdDetail: "Pages/Ceph/View/OsdDetail.tsx",
  cephPools: "Pages/Ceph/View/Pools.tsx",
  cephPoolDetail: "Pages/Ceph/View/PoolDetail.tsx",
  cephDaemons: "Pages/Ceph/View/Daemons.tsx",
  cephInsights: "Pages/Ceph/View/Insights.tsx",
  cephClusters: "Pages/Ceph/Clusters.tsx",
};

const IOT_PAGES: Array<string> = [
  PAGES["iotOverview"]!,
  PAGES["iotDeviceDetail"]!,
  PAGES["iotDevices"]!,
  PAGES["iotFleets"]!,
];

const CEPH_PAGES: Array<string> = [
  PAGES["cephOverview"]!,
  PAGES["cephOsds"]!,
  PAGES["cephOsdDetail"]!,
  PAGES["cephPools"]!,
  PAGES["cephPoolDetail"]!,
  PAGES["cephDaemons"]!,
  PAGES["cephInsights"]!,
  PAGES["cephClusters"]!,
];

describe("every description is used, and every reference exists", () => {
  test("each IoT key is referenced by an IoT page, and each IoT reference names a key", () => {
    const used: Array<string> = IOT_PAGES.flatMap((page: string) => {
      return references(readCode(page), IOT_REFERENCE);
    });

    expect([...new Set(used)].sort()).toEqual(
      Object.keys(IOT_METRIC_DESCRIPTIONS).sort(),
    );
  });

  test("each Ceph key is referenced by a Ceph page, and each Ceph reference names a key", () => {
    const used: Array<string> = CEPH_PAGES.flatMap((page: string) => {
      return references(readCode(page), CEPH_REFERENCE);
    });

    expect([...new Set(used)].sort()).toEqual(
      Object.keys(CEPH_METRIC_DESCRIPTIONS).sort(),
    );
  });

  test.each([...IOT_PAGES, ...CEPH_PAGES])(
    "%s imports the description record it uses from the shared module",
    (page: string) => {
      const code: string = readCode(page);

      if (references(code, IOT_REFERENCE).length > 0) {
        expect(code).toMatch(
          /import \{ IOT_METRIC_DESCRIPTIONS \} from "(\.\.\/)+Components\/MetricDescriptions\/IoTMetricDescriptions";/,
        );
      }
      if (references(code, CEPH_REFERENCE).length > 0) {
        expect(code).toMatch(
          /import \{ CEPH_METRIC_DESCRIPTIONS \} from "(\.\.\/)+Components\/MetricDescriptions\/CephMetricDescriptions";/,
        );
      }
      if (count(code, INFO_TOOLTIP) > 0) {
        expect(code).toContain(
          'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";',
        );
      }
    },
  );
});

describe("no (i) inside a link or a button", () => {
  test.each([...IOT_PAGES, ...CEPH_PAGES])("%s", (page: string) => {
    const code: string = readCode(page);

    for (const block of code.match(LINK_BLOCK) || []) {
      expect(block).not.toContain("InfoTooltip");
      expect(block).not.toContain("CephMetricTitle");
    }
    for (const block of code.match(BUTTON_BLOCK) || []) {
      expect(block).not.toContain("InfoTooltip");
      expect(block).not.toContain("CephMetricTitle");
    }
  });
});

// --------------------------------------------------------------------- IoT

describe("IoT fleet overview", () => {
  const code: string = readCode(PAGES["iotOverview"]!);

  test.each([
    ["Online Devices", "onlineDevices"],
    ["Total Devices", "totalDevices"],
    ["Avg Battery", "avgBattery"],
    ["Avg Signal", "avgSignal"],
  ] as Array<[string, IoTMetric]>)(
    "the %s tile passes its description",
    (title: string, key: IoTMetric) => {
      expect(code).toContain(
        `<GoldenMetricTile title="${title}" description={IOT_METRIC_DESCRIPTIONS.${key}}`,
      );
    },
  );

  test("every golden tile on the page has a description", () => {
    expect(count(code, GOLDEN_TILE)).toBe(4);
    expect(
      count(
        code,
        /<GoldenMetricTile title="[^"]+" description=\{IOT_METRIC_DESCRIPTIONS\.\w+\}/g,
      ),
    ).toBe(4);
  });

  test("the Devices needing attention card title carries its (i)", () => {
    expect(code).toContain(
      'const ATTENTION_TITLE: string = "Devices needing attention";',
    );
    expect(code).toContain(
      "{ATTENTION_TITLE} <InfoTooltip label={ATTENTION_TITLE} text={IOT_METRIC_DESCRIPTIONS.devicesNeedingAttention} />",
    );
  });

  test("the devices-online chip beside the fleet name carries the page's only other (i)", () => {
    const chips: string = segment(
      code,
      "{specChips.length > 0 && (",
      "</div> )}",
    );

    expect(chips).toContain(
      '{hasCountChips && ( <InfoTooltip label="Devices online" text={IOT_METRIC_DESCRIPTIONS.heroDevicesOnline} /> )}',
    );
    // The attention card title and this chip row are the only (i)s here.
    expect(count(code, INFO_TOOLTIP)).toBe(2);
  });

  /*
   * The (i) belongs to the count chip, so it is decided before the agent
   * version chip (metadata) joins the row.
   */
  test("the chip row gets its (i) only when the devices count chip is in it", () => {
    const hero: string = segment(code, "const specChips: Array<{", "return (");

    expect(hero).toMatch(
      /if \(totalDevices > 0\) \{ specChips\.push\(\{ icon: IconProp\.Cube, label: `\$\{onlineDevices\}\/\$\{totalDevices\} device/,
    );
    expect(
      hero.indexOf("const hasCountChips: boolean = specChips.length > 0;"),
    ).toBeGreaterThan(hero.indexOf("if (totalDevices > 0) {"));
    expect(
      hero.indexOf("const hasCountChips: boolean = specChips.length > 0;"),
    ).toBeLessThan(hero.indexOf("if (fleet.agentVersion) {"));
  });

  test("the chip reads the same counts as the Online Devices tile, with the fleet's counts as the fallback its text names", () => {
    expect(code).toContain(
      "const totalDevices: number = goldenStats?.totalDevices ?? fleet.deviceCount ?? 0;",
    );
    expect(code).toContain(
      "const onlineDevices: number = goldenStats?.onlineDevices ?? fleet.onlineDeviceCount ?? 0;",
    );
    expect(code).toContain(
      'value={onlinePct === null ? "—" : `${onlineDevices}/${totalDevices}`}',
    );
    expect(IOT_METRIC_DESCRIPTIONS.heroDevicesOnline).toContain(
      "counted like the Online Devices tile",
    );
    expect(IOT_METRIC_DESCRIPTIONS.heroDevicesOnline).toContain(
      "the fleet's most recent data",
    );
  });
});

describe("IoT device detail", () => {
  const code: string = readCode(PAGES["iotDeviceDetail"]!);
  const fields: string = summaryFieldsCode(code);

  test.each([
    ['title: "Status"', "deviceStatus"],
    ['title: "Uptime"', "uptime"],
    ['title: "Battery"', "battery"],
    ['title: "Signal Strength"', "signalStrength"],
    ['title: "Temperature"', "temperature"],
    ['title: "CPU"', "cpu"],
    ['title: "Memory (Used / Max)"', "memory"],
  ] as Array<[string, IoTMetric]>)(
    "the %s summary field carries its description",
    (marker: string, key: IoTMetric) => {
      expect(segment(fields, marker, "summaryFields.push")).toContain(
        `description: IOT_METRIC_DESCRIPTIONS.${key},`,
      );
    },
  );

  test.each([
    'title: "Device Name"',
    'title: "Fleet"',
    'title: "Kind"',
    'title: "Device Type"',
    'title: "Firmware Version"',
    'title: "External ID"',
    'title: "Last Seen"',
  ])("the %s field is metadata and has no description", (marker: string) => {
    expect(segment(fields, marker, "}")).not.toContain("description:");
  });

  test("the summary fields are the only descriptions from the record", () => {
    expect(references(code, IOT_REFERENCE)).toHaveLength(7);
    expect(references(fields, IOT_REFERENCE)).toHaveLength(7);
  });

  test("the metric charts keep their own visible descriptions (no tooltip there)", () => {
    expect(count(code, INFO_TOOLTIP)).toBe(0);
    expect(code).toContain("<ResourceMetricsTab");
  });
});

describe("IoT Devices table", () => {
  const code: string = readCode(PAGES["iotDevices"]!);

  test.each([
    ["Status", "statusColumn"],
    ["Battery", "batteryColumn"],
    ["Signal", "signalColumn"],
    ["Temperature", "temperatureColumn"],
  ] as Array<[string, IoTMetric]>)(
    "the %s column header carries its tooltip",
    (title: string, key: IoTMetric) => {
      expect(code).toContain(
        `title: "${title}", headerTooltip: IOT_METRIC_DESCRIPTIONS.${key}, type: FieldType.Element,`,
      );
    },
  );

  test("only the four metric columns have a header tooltip", () => {
    expect(count(code, /headerTooltip:/g)).toBe(4);
  });

  test("the red battery threshold the text names is the one the cell uses", () => {
    expect(code).toContain("const isLow: boolean = battery <= 20;");
    expect(IOT_METRIC_DESCRIPTIONS.batteryColumn).toContain(
      "red at 20% or below",
    );
  });
});

describe("IoT Fleets list", () => {
  const code: string = readCode(PAGES["iotFleets"]!);

  test("the Devices column header carries its tooltip, and it is the only one", () => {
    expect(code).toContain(
      'title: "Devices", headerTooltip: IOT_METRIC_DESCRIPTIONS.fleetDevices, type: FieldType.Element,',
    );
    expect(count(code, /headerTooltip:/g)).toBe(1);
  });

  test("the Devices column reads the fleet's snapshot counts, as its text says", () => {
    const devices: string = segment(code, 'title: "Devices"', "title:");

    expect(devices).toContain("const total: number = item.deviceCount || 0;");
    expect(devices).toContain(
      "const online: number = item.onlineDeviceCount || 0;",
    );
    expect(IOT_METRIC_DESCRIPTIONS.fleetDevices).toContain(
      "most recent data the fleet sent",
    );
  });
});

// -------------------------------------------------------------------- Ceph

describe("Ceph cluster overview", () => {
  const code: string = readCode(PAGES["cephOverview"]!);

  test.each([
    ["Capacity Used", "capacityUsed"],
    ["OSDs Up", "osdsUp"],
    ["Mons In Quorum", "monsInQuorum"],
    ["Pools", "pools"],
    ["Problem PGs", "problemPgs"],
  ] as Array<[string, CephMetric]>)(
    "the %s tile passes its description",
    (title: string, key: CephMetric) => {
      expect(code).toContain(
        `<GoldenMetricTile title="${title}" description={CEPH_METRIC_DESCRIPTIONS.${key}}`,
      );
    },
  );

  test("every golden tile on the page has a description", () => {
    expect(count(code, GOLDEN_TILE)).toBe(5);
    expect(
      count(
        code,
        /<GoldenMetricTile title="[^"]+" description=\{CEPH_METRIC_DESCRIPTIONS\.\w+\}/g,
      ),
    ).toBe(5);
  });

  test.each([
    ["Active Health Checks", "activeHealthChecks"],
    ["OSD States", "osdStates"],
    ["Placement Group States", "pgStates"],
  ] as Array<[string, CephMetric]>)(
    "the %s card title is a CephMetricTitle with its description",
    (title: string, key: CephMetric) => {
      expect(code).toContain(
        `<Card title={ <CephMetricTitle title="${title}" description={CEPH_METRIC_DESCRIPTIONS.${key}} /> }`,
      );
    },
  );

  test.each([
    ["Largest Pools", "Top pools by stored bytes.", "largestPools"],
    [
      "Fullest Pools",
      "Top pools by used capacity (stored / (stored + max avail)).",
      "fullestPools",
    ],
  ] as Array<[string, string, CephMetric]>)(
    "the %s list passes its tooltip text",
    (title: string, description: string, key: CephMetric) => {
      expect(code).toContain(
        `renderTopPoolList( "${title}", "${description}", CEPH_METRIC_DESCRIPTIONS.${key},`,
      );
    },
  );

  test("the top pool lists render their title through CephMetricTitle", () => {
    expect(code).toContain(
      "title={<CephMetricTitle title={title} description={tooltip} />}",
    );
    expect(count(code, /renderTopPoolList\(/g)).toBe(2);
  });

  test("the health pill is followed by its (i)", () => {
    expect(code).toContain(
      '{renderHealthPill(health)} <InfoTooltip label="Cluster health" text={CEPH_METRIC_DESCRIPTIONS.health} />',
    );
  });

  test("the count chips beside the cluster name carry one (i) for the row", () => {
    const chips: string = segment(
      code,
      "{specChips.length > 0 && (",
      "</div> )}",
    );

    expect(chips).toContain(
      '{hasCountChips && ( <InfoTooltip label="Cluster inventory counts" text={CEPH_METRIC_DESCRIPTIONS.inventoryCounts} /> )}',
    );
    expect(count(chips, INFO_TOOLTIP)).toBe(1);
  });

  /*
   * The OSD, monitor and pool chips are counts; the Ceph version chip is
   * metadata, so the (i) is decided before it joins the row.
   */
  test("the chip row gets its (i) only when a count chip is in it", () => {
    const hero: string = segment(
      code,
      "const specChips: Array<{",
      "const statusBadgeClass",
    );
    const decided: number = hero.indexOf(
      "const hasCountChips: boolean = specChips.length > 0;",
    );

    expect(decided).toBeGreaterThan(hero.indexOf("if (cluster.poolCount) {"));
    expect(decided).toBeLessThan(hero.indexOf("if (cluster.cephVersion) {"));
  });

  test("the chips read the cluster's latest snapshot and the monitor inventory, as the text says", () => {
    const hero: string = segment(
      code,
      "const specChips: Array<{",
      "const statusBadgeClass",
    );

    expect(hero).toContain(
      "label: `${cluster.osdUpCount || 0}/${cluster.osdCount} OSD",
    );
    expect(hero).toContain(
      'label: `${monsInQuorum || 0}/${monsTotal} mon${monsTotal === 1 ? "" : "s"} in quorum`,',
    );
    expect(hero).toContain(
      'label: `${cluster.monCount} mon${cluster.monCount === 1 ? "" : "s"}`,',
    );
    expect(hero).toContain(
      'label: `${cluster.poolCount} pool${cluster.poolCount === 1 ? "" : "s"}`,',
    );
    // Quorum comes from the Mon inventory rows, not from a time series.
    expect(code).toContain("if (row.inQuorum) { quorum++; }");
    expect(CEPH_METRIC_DESCRIPTIONS.inventoryCounts).toContain(
      "latest data, not a time range",
    );
    expect(CEPH_METRIC_DESCRIPTIONS.inventoryCounts).toContain(
      "only the monitor count when quorum is not reported",
    );
  });

  test.each([
    ["Up + In", "osdUpIn"],
    ["Up + Out", "osdUpOut"],
    ["Down + In", "osdDownIn"],
    ["Down + Out", "osdDownOut"],
  ] as Array<[string, CephMetric]>)(
    "the %s OSD state cell carries its description",
    (label: string, key: CephMetric) => {
      expect(segment(code, `label: "${label}"`, "},")).toContain(
        `description: CEPH_METRIC_DESCRIPTIONS.${key},`,
      );
    },
  );

  test("the OSD state cells render the (i) beside their label, and the matrix uses them", () => {
    const cell: string = segment(
      code,
      "export const OsdStateCellView",
      "const CephClusterOverview",
    );

    expect(cell).toContain(
      "<span>{props.cell.label}</span> <InfoTooltip label={props.cell.label} text={props.cell.description} />",
    );
    expect(code).toContain(
      "const cells: Array<OsdStateCell> = buildOsdStateCells(osdMatrix);",
    );
    expect(code).toContain(
      "return <OsdStateCellView key={cell.label} cell={cell} />;",
    );
  });

  test("each rate chart has a header with its (i)", () => {
    expect(count(code, RATE_CHART)).toBe(2);
    expect(code).toMatch(
      /Client IOPS <InfoTooltip label="Client IOPS" text=\{CEPH_METRIC_DESCRIPTIONS\.clientIops\} \/> <\/div> <CephRateChart clusterName=\{clusterName\} series=\{\[ \{ metricName: "ceph_pool_rd"/,
    );
    expect(code).toMatch(
      /Client Throughput <InfoTooltip label="Client Throughput" text=\{CEPH_METRIC_DESCRIPTIONS\.clientThroughput\} \/> <\/div> <CephRateChart clusterName=\{clusterName\} series=\{\[ \{ metricName: "ceph_pool_rd_bytes"/,
    );
  });

  test("the capacity tile's 85% and 24 hours are the page's own constants", () => {
    expect(code).toContain("const PROJECTION_WINDOW_HOURS: number = 24;");
    expect(code).toContain("const NEARFULL_RATIO: number = 0.85;");
    expect(code).toContain("thresholds={{ warn: 75, danger: 85 }}");
    expect(CEPH_METRIC_DESCRIPTIONS.capacityUsed).toContain("24 hours");
    expect(CEPH_METRIC_DESCRIPTIONS.capacityUsed).toContain("85%");
  });

  test("Problem PGs adds the two states, as its text says", () => {
    expect(code).toContain(
      "(pgStats.degraded || 0) + (pgStats.undersized || 0)",
    );
    expect(CEPH_METRIC_DESCRIPTIONS.problemPgs).toContain("counted twice");
  });

  /*
   * One health text sits behind the overview pill ("Health Warning") and
   * the Clusters list pill ("WARN"), so it has to name the states in the
   * words both pills use.
   */
  test("the health text names every state the overview and Clusters pills show", () => {
    for (const label of ["OK", "Warning", "Error", "Unknown"]) {
      expect(code).toContain(`label: "Health ${label}",`);
      expect(CEPH_METRIC_DESCRIPTIONS.health).toContain(label);
    }

    const clusters: string = readCode(PAGES["cephClusters"]!);

    for (const label of ["OK", "WARN", "ERR", "Unknown"]) {
      expect(clusters).toContain(`label: "${label}",`);
      expect(CEPH_METRIC_DESCRIPTIONS.health).toContain(label);
    }
  });

  test("Active Health Checks keeps each check's latest value in the last 10 minutes, as its text says", () => {
    expect(code).toContain('"ceph_health_detail", "name", 10, );');
    // Rows arrive newest first; only the first row per check is kept.
    expect(code).toContain("sort: { time: SortOrder.Descending, },");
    expect(code).toContain("if (!perKey.has(key)) {");
    expect(code).toContain("if (entry.value >= 1) {");
    expect(CEPH_METRIC_DESCRIPTIONS.activeHealthChecks).toContain(
      "still raised in the latest data Ceph sent in the last 10 minutes",
    );
  });
});

describe("Ceph OSD list", () => {
  const code: string = readCode(PAGES["cephOsds"]!);

  test.each([
    ['title: "In / Out", key: "in"', "osdInOutColumn"],
    ['title: "Used / Total", key: "used"', "osdUsedColumn"],
    ['title: "PGs", key: "pgs"', "osdPgsColumn"],
    ['title: "Apply / Commit Latency", key: "latency"', "osdLatencyColumn"],
  ] as Array<[string, CephMetric]>)(
    "the %s column carries its description",
    (marker: string, key: CephMetric) => {
      expect(code).toContain(
        `${marker}, description: CEPH_METRIC_DESCRIPTIONS.${key},`,
      );
    },
  );

  test("the built-in Status and Age columns are explained, and Class is not a metric", () => {
    expect(code).toContain(
      "builtInColumnDescriptions={{ status: CEPH_METRIC_DESCRIPTIONS.osdStatusColumn, age: CEPH_METRIC_DESCRIPTIONS.osdAgeColumn, }}",
    );
    expect(code).toContain('{ title: "Class", key: "deviceClass" }');
  });

  /*
   * Ceph reports no creation time for an OSD. The Age column is the age of
   * OneUptime's own inventory row, which is what the text has to say.
   */
  test("Age is the inventory row's age, as its text says", () => {
    expect(code).toContain("age: CephResourceUtils.formatAge(row.createdAt),");
    expect(CEPH_METRIC_DESCRIPTIONS.osdAgeColumn).toContain(
      "first saw this OSD",
    );
    expect(CEPH_METRIC_DESCRIPTIONS.osdAgeColumn).toContain(
      "not how old the OSD or its disk is",
    );
  });

  /*
   * "Starts again from zero after about 15 minutes missing": the snapshot
   * upsert never rewrites createdAt, and the cleanup job deletes rows not
   * seen for the stale threshold (15 minutes unless overridden), so the
   * OSD's next appearance inserts a fresh row.
   */
  test("the row's createdAt survives upserts and restarts only after the 15-minute prune", () => {
    const service: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "Common",
          "Server",
          "Services",
          "CephResourceService.ts",
        ),
        "utf8",
      )
      .replace(WHITESPACE, " ");
    const cleanup: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "FeatureSet",
          "Workers",
          "Jobs",
          "Ceph",
          "CleanupStaleResources.ts",
        ),
        "utf8",
      )
      .replace(WHITESPACE, " ");
    const upsertUpdate: string = segment(
      service,
      'ON CONFLICT ("projectId", "cephClusterId", "kind", "externalId") DO UPDATE SET',
      "WHERE EXCLUDED",
    );

    expect(upsertUpdate).toContain('"lastSeenAt" = EXCLUDED."lastSeenAt"');
    expect(upsertUpdate).not.toContain("createdAt");
    expect(service).toContain(
      'DELETE FROM "CephResource" WHERE "cephClusterId" = $1 AND "lastSeenAt" < $2',
    );
    expect(service).toContain("return 15; } }");
    expect(cleanup).toContain("CephResourceService.deleteStaleForCluster({");
    expect(CEPH_METRIC_DESCRIPTIONS.osdAgeColumn).toContain(
      "missing from that data for more than about 15 minutes",
    );
  });

  /*
   * The Used, PGs and latency texts all say a dash stands in for figures
   * older than 15 minutes; each figure has to go through the stale cut-off.
   */
  test.each([
    ["row.statBytes", "osdUsedColumn"],
    ["row.statBytesUsed", "osdUsedColumn"],
    ["row.pgCount", "osdPgsColumn"],
    ["row.applyLatencyMs", "osdLatencyColumn"],
    ["row.commitLatencyMs", "osdLatencyColumn"],
  ] as Array<[string, CephMetric]>)(
    "%s is read through the 15-minute stale cut-off (%s)",
    (field: string, key: CephMetric) => {
      expect(code).toMatch(
        new RegExp(
          `CephResourceUtils\\.freshMetricValue\\( ?row, ${escapeRegExp(field)},? ?\\)`,
        ),
      );
      expect(CEPH_METRIC_DESCRIPTIONS[key]).toContain(
        "has not reported in the last 15 minutes",
      );
    },
  );
});

describe("Ceph pool list", () => {
  const code: string = readCode(PAGES["cephPools"]!);

  test.each([
    ['title: "Stored", key: "stored"', "poolStoredColumn"],
    ['title: "Max Avail", key: "maxAvail"', "poolMaxAvailColumn"],
    ['title: "Used", key: "usedPercent"', "poolUsedColumn"],
    ['title: "Objects", key: "objects"', "poolObjectsColumn"],
    ['title: "Read IOPS", key: "readIops"', "poolReadIopsColumn"],
    ['title: "Write IOPS", key: "writeIops"', "poolWriteIopsColumn"],
  ] as Array<[string, CephMetric]>)(
    "the %s column carries its description",
    (marker: string, key: CephMetric) => {
      expect(code).toContain(
        `${marker}, description: CEPH_METRIC_DESCRIPTIONS.${key},`,
      );
    },
  );

  test("the IOPS window its text names is the one the page uses", () => {
    expect(code).toContain("const IOPS_WINDOW_MINUTES: number = 15;");
    expect(CEPH_METRIC_DESCRIPTIONS.poolReadIopsColumn).toContain(
      "last 15 minutes",
    );
  });
});

describe("Ceph OSD detail", () => {
  const fields: string = summaryFieldsCode(readCode(PAGES["cephOsdDetail"]!));

  test.each([
    ['title: "Status"', "osdStatus"],
    ['title: "Placement",', "osdPlacement"],
    ['title: "Used / Total"', "osdUsed"],
    ['title: "Placement Groups"', "osdPlacementGroups"],
    ['title: "Apply / Commit Latency"', "osdLatency"],
  ] as Array<[string, CephMetric]>)(
    "the %s summary field carries its description",
    (marker: string, key: CephMetric) => {
      expect(segment(fields, marker, "title:")).toContain(
        `description: CEPH_METRIC_DESCRIPTIONS.${key},`,
      );
    },
  );

  test("identity fields carry none", () => {
    for (const marker of [
      'title: "OSD"',
      'title: "Cluster"',
      'title: "Host"',
      'title: "Device Class"',
      'title: "Version"',
      'title: "Last Seen"',
    ]) {
      expect(segment(fields, marker, "}")).not.toContain("description:");
    }
  });

  test.each([
    ['title: "Used / Total"', "resource.statBytesUsed", "osdUsed"],
    ['title: "Used / Total"', "resource.statBytes)", "osdUsed"],
    ['title: "Placement Groups"', "resource.pgCount", "osdPlacementGroups"],
    [
      'title: "Apply / Commit Latency"',
      "resource.applyLatencyMs",
      "osdLatency",
    ],
    [
      'title: "Apply / Commit Latency"',
      "resource.commitLatencyMs",
      "osdLatency",
    ],
  ] as Array<[string, string, CephMetric]>)(
    "the %s field reads %s through the 15-minute stale cut-off",
    (marker: string, field: string, key: CephMetric) => {
      expect(segment(fields, marker, 'title: "')).toMatch(
        new RegExp(
          `CephResourceUtils\\.freshMetricValue\\( ?resource, ${escapeRegExp(field)}`,
        ),
      );
      expect(CEPH_METRIC_DESCRIPTIONS[key]).toContain(
        "has not reported in the last 15 minutes",
      );
    },
  );
});

describe("Ceph pool detail", () => {
  const code: string = readCode(PAGES["cephPoolDetail"]!);
  const fields: string = summaryFieldsCode(code);

  test.each([
    ['title: "Stored", value:', "poolStored"],
    ['title: "Max Available", value:', "poolMaxAvail"],
    ['title: "Used", value:', "poolUsed"],
    ['title: "Growth"', "poolGrowth"],
    ['title: "Objects", description:', "poolObjects"],
  ] as Array<[string, CephMetric]>)(
    "the %s summary field carries its description",
    (marker: string, key: CephMetric) => {
      expect(segment(fields, marker, "title:")).toContain(
        `description: CEPH_METRIC_DESCRIPTIONS.${key}`,
      );
    },
  );

  test("each rate chart has a header with the pool's own (i)", () => {
    expect(count(code, RATE_CHART)).toBe(2);
    expect(code).toContain(
      'Client IOPS <InfoTooltip label="Client IOPS" text={CEPH_METRIC_DESCRIPTIONS.poolClientIops} />',
    );
    expect(code).toContain(
      'Client Throughput <InfoTooltip label="Client Throughput" text={CEPH_METRIC_DESCRIPTIONS.poolClientThroughput} />',
    );
  });

  test("the Stored Bytes chart no longer says STORED is after replication", () => {
    const stored: string = segment(code, 'variable: "pool_stored"', "}),");

    expect(stored).not.toContain("after replication");
    expect(stored).toContain("before replication copies");
  });

  test("the growth window and confidence cut-off its text names are the page's own", () => {
    expect(code).toContain("const PROJECTION_WINDOW_HOURS: number = 24;");
    expect(code).toContain(
      "const MIN_CONFIDENT_FIT_SPAN_MS: number = 2 * 60 * 60 * 1000;",
    );
    expect(CEPH_METRIC_DESCRIPTIONS.poolGrowth).toContain("24 hours");
    expect(CEPH_METRIC_DESCRIPTIONS.poolGrowth).toContain("2 hours");
  });
});

describe("Ceph daemons, Insights and Clusters list", () => {
  test("the Daemons Status header carries its tooltip", () => {
    const code: string = readCode(PAGES["cephDaemons"]!);

    expect(code).toContain(
      'title: "Status", type: FieldType.Element, key: "status", headerTooltip: CEPH_METRIC_DESCRIPTIONS.daemonStatus,',
    );
    expect(count(code, /headerTooltip:/g)).toBe(1);
  });

  test("the Insights rate chart headers carry the cluster-wide texts, and only they", () => {
    const code: string = readCode(PAGES["cephInsights"]!);

    expect(count(code, RATE_CHART)).toBe(2);
    expect(count(code, INFO_TOOLTIP)).toBe(2);
    expect(code).toContain(
      'Client IOPS <InfoTooltip label="Client IOPS" text={CEPH_METRIC_DESCRIPTIONS.clientIops} />',
    );
    expect(code).toContain(
      'Client Throughput <InfoTooltip label="Client Throughput" text={CEPH_METRIC_DESCRIPTIONS.clientThroughput} />',
    );
  });

  test.each([
    ["Health", "health"],
    ["OSDs", "clusterOsds"],
    ["Mons", "clusterMons"],
    ["Pools", "pools"],
    ["Capacity", "clusterCapacity"],
  ] as Array<[string, CephMetric]>)(
    "the Clusters list %s header carries its tooltip",
    (title: string, key: CephMetric) => {
      expect(readCode(PAGES["cephClusters"]!)).toContain(
        `title: "${title}", headerTooltip: CEPH_METRIC_DESCRIPTIONS.${key}, type: FieldType.Element,`,
      );
    },
  );

  test("the Clusters list capacity thresholds are the ones its text names", () => {
    const code: string = readCode(PAGES["cephClusters"]!);

    expect(code).toContain(
      'pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500"',
    );
    expect(CEPH_METRIC_DESCRIPTIONS.clusterCapacity).toContain(
      "amber at 75% and red at 90%",
    );
    expect(count(code, /headerTooltip:/g)).toBe(5);
  });
});
