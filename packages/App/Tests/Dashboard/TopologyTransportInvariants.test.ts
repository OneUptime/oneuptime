import { activeSql } from "Common/Server/Utils/Topology/TopologySql";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import { TopologyApiPath } from "Common/Types/Topology/TopologyApi";
import {
  ActivityFields,
  isEntityActive,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyActivity";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3973: the Topology page used to download the whole inventory —
 * ModelAPI.getList of up to LIMIT_PER_PROJECT InventoryItem rows and as many
 * InventoryItemRelationship rows — and build both maps in the browser. The
 * relationships ran out first, so counts, search and connections covered a
 * random subset and the page said "Partial inventory loaded".
 *
 * The fix moves the graph work into Postgres behind the Topology API. These
 * invariants keep it moved: the page, its data hook and the views it renders
 * read the inventory only through TopologyApiPath routes, never through the
 * generic list API again, and the server's SQL activity predicate stays the
 * exact twin of the browser's isEntityActive (the browser judges activity
 * on rows the server chose by that predicate, so a drift between the two
 * would show a resource as inactive in a container the server picked as the
 * active one).
 *
 * The App suite has no renderer (App/jest.config.json runs in "node"), so the
 * wiring is pinned against the sources, comments stripped — the technique
 * AddNeighborToMonitoringWiring and DatabaseServerBaseAPIRegistration use.
 * The request shapes and decoders are exercised directly in
 * TopologyApiDecoding, EntityDetailApiDecoding and
 * InfrastructureCollectionApiDecoding.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(APP_ROOT, "FeatureSet/Dashboard/src");
const TOPOLOGY_DIR: string = path.join(DASHBOARD_SRC, "Components/Topology");
const SERVER_TOPOLOGY_DIR: string = path.join(
  APP_ROOT,
  "../Common/Server/Utils/Topology",
);

/*
 * Block comments and whole-line `//` comments are dropped: these files
 * explain the old design in prose ("used to download the whole inventory"),
 * and an assertion about the code has to read the code.
 */
function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

function readCode(absolutePath: string): string {
  return stripComments(fs.readFileSync(absolutePath, "utf8")).replace(
    /\s+/g,
    " ",
  );
}

function importSpecifiers(code: string): Array<string> {
  return Array.from(code.matchAll(/\bfrom "([^"]+)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

function callsOf(code: string, pattern: RegExp): Array<string> {
  return Array.from(code.matchAll(pattern))
    .map((match: RegExpMatchArray): string => {
      return match[1]!;
    })
    .sort();
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/*
 * Regex literals used with .test() are hoisted, so they are never the object
 * of a member expression (wrap-regex and Prettier cannot agree on those).
 */
const SOURCE_FILE: RegExp = /\.(ts|tsx|json)$/;
const DISCOVERED_LITERAL: RegExp = /["']discovered["']/;
const DIGIT: RegExp = /\d/;

function listSourceFiles(root: string): Array<string> {
  const files: Array<string> = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full: string = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

interface ViewFile {
  name: string;
  path: string;
}

/* The page, its data hook, and every view the page hands topology data to. */
const HOOK: ViewFile = {
  name: "UseTopologyData.ts",
  path: path.join(TOPOLOGY_DIR, "UseTopologyData.ts"),
};
const PAGE: ViewFile = {
  name: "TopologyPage.tsx",
  path: path.join(DASHBOARD_SRC, "Pages/Topology/TopologyPage.tsx"),
};
const SERVICE_MAP: ViewFile = {
  name: "ServiceMapGraph.tsx",
  path: path.join(TOPOLOGY_DIR, "ServiceMapGraph.tsx"),
};
const INFRASTRUCTURE: ViewFile = {
  name: "InfrastructureExplorer.tsx",
  path: path.join(TOPOLOGY_DIR, "InfrastructureExplorer.tsx"),
};
const DRAWER: ViewFile = {
  name: "EntityDetailPanel.tsx",
  path: path.join(TOPOLOGY_DIR, "EntityDetailPanel.tsx"),
};

const PAGE_FILES: Array<ViewFile> = [
  HOOK,
  PAGE,
  SERVICE_MAP,
  INFRASTRUCTURE,
  DRAWER,
];

/* Files that must not talk to the generic model API at all. */
const MODEL_API_FREE_FILES: Array<ViewFile> = [
  HOOK,
  PAGE,
  SERVICE_MAP,
  INFRASTRUCTURE,
];

/*
 * What the old whole-inventory load was made of. None of it may come back
 * into the page, the hook or the views.
 */
const OLD_TRANSPORT_TOKENS: Array<string> = [
  "LIMIT_PER_PROJECT",
  "LIMIT_MAX",
  "InventoryItemRelationship",
  "TopologyInventoryData",
  "buildTopologyInventoryItemQuery",
  "GreaterThanOrEqual",
  "isTruncated",
];

describe("the Topology page no longer lists the inventory through the generic API", () => {
  test.each(PAGE_FILES)(
    "$name carries none of the old whole-inventory transport",
    (file: ViewFile) => {
      const code: string = readCode(file.path);
      const found: Array<string> = OLD_TRANSPORT_TOKENS.filter(
        (token: string): boolean => {
          return code.includes(token);
        },
      );

      expect(found).toEqual([]);
      expect(importSpecifiers(code)).not.toContain(
        "Common/Types/Database/LimitMax",
      );
      expect(importSpecifiers(code)).not.toContain(
        "Common/Models/DatabaseModels/InventoryItemRelationship",
      );
      /* No list of inventory items by any spelling. */
      expect(code).not.toMatch(/modelType: ?InventoryItem\b/);
      expect(code).not.toMatch(/ModelAPI\.\w+<InventoryItem\b/);
    },
  );

  test.each(MODEL_API_FREE_FILES)(
    "$name does not use the generic model API or post on its own",
    (file: ViewFile) => {
      const code: string = readCode(file.path);

      expect(importSpecifiers(code)).not.toContain(
        "Common/UI/Utils/ModelAPI/ModelAPI",
      );
      expect(importSpecifiers(code)).not.toContain(
        "Common/Models/DatabaseModels/InventoryItem",
      );
      expect(code).not.toMatch(/\bModelAPI\./);
      expect(code).not.toMatch(/\bAPI\.(post|get|put|delete|fetch)\b/);
      expect(code).not.toMatch(/\bfetch\(/);
      expect(code).not.toMatch(/\baxios\b/);
    },
  );

  test("the drawer uses the model API only for its best-effort Service and network-device links", () => {
    const code: string = readCode(DRAWER.path);

    expect(callsOf(code, /\bModelAPI\.(\w+)/g)).toEqual(["getList", "getList"]);
    expect(callsOf(code, /\bModelAPI\.getList<(\w+)>/g)).toEqual([
      "NetworkDevice",
      "Service",
    ]);
    expect(code).not.toMatch(/\bAPI\.(post|get|put|delete)\b/);
    /* Its inventory row comes from the Topology API, not from a list. */
    expect(callsOf(code, /\b(fetchEntity\w*)\(/g)).toEqual([
      "fetchEntityConnections",
      "fetchEntityDetail",
    ]);
  });

  test("the hook loads each tab through the Topology API client and nothing else", () => {
    const code: string = readCode(HOOK.path);

    expect(importSpecifiers(code)).toContain("./TopologyApi");
    expect(code).toMatch(
      /serviceMap: fetchServiceMapData, infrastructure: fetchInfrastructureData,? \}/,
    );
    /* API is imported only to phrase an error. */
    expect(callsOf(code, /\bAPI\.(\w+)/g)).toEqual(["getFriendlyMessage"]);
    /* The abort signal and the explicit-refresh flag reach the request. */
    expect(code).toContain("{ signal: controller.signal, fresh: fresh }");
  });

  /*
   * Only the user's own refresh may bypass the server's response cache:
   * every other new generation (range, project, a drifted pin) is an
   * ordinary load. TopologyDataLoading checks the behaviour; this pins that
   * no second caller starts a fresh generation.
   */
  test("only reload() starts a generation that bypasses the server's cache", () => {
    const code: string = readCode(HOOK.path);

    expect(callsOf(code, /\brestart\([^()]*, (true|false)\)/g)).toEqual([
      "false",
      "false",
      "true",
    ]);
    expect(code).toMatch(
      /const reload: \(\) => void = useCallback\(\(\): void => \{ restart\(latestRef\.current\.activeView, true\); \}/,
    );
  });

  test("the views fetch only through their Topology API clients", () => {
    expect(callsOf(readCode(PAGE.path), /\b(fetch\w*)\(/g)).toEqual([]);
    /* The operational overlay is the status route, not an inventory read. */
    expect(callsOf(readCode(SERVICE_MAP.path), /\b(fetch\w*)\(/g)).toEqual([
      "fetchServiceOperationalStatuses",
    ]);
    expect(callsOf(readCode(INFRASTRUCTURE.path), /\b(fetch\w*)\(/g)).toEqual([
      "fetchCollectionPage",
      "fetchCollectionSearchCounts",
    ]);
    expect(importSpecifiers(readCode(INFRASTRUCTURE.path))).toContain(
      "./InfrastructureCollectionApi",
    );
    expect(importSpecifiers(readCode(DRAWER.path))).toContain(
      "./EntityDetailApi",
    );
  });

  test("the page hands each view the server's echoed range start, never the pinned request value", () => {
    const code: string = readCode(PAGE.path);

    expect(code).not.toContain("pinnedRangeStart");
    expect(countOccurrences(code, "rangeStart={tab.data.rangeStart}")).toBe(2);
  });

  test("the old inventory loader and its test are gone", () => {
    expect(
      fs.existsSync(path.join(TOPOLOGY_DIR, "TopologyInventoryData.ts")),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(APP_ROOT, "Tests/Dashboard/TopologyInventoryData.test.ts"),
      ),
    ).toBe(false);
  });
});

/* Which client module owns each Topology route. */
const ROUTE_OWNERS: Record<keyof typeof TopologyApiPath, string> = {
  ServiceMap: "TopologyApi.ts",
  Infrastructure: "TopologyApi.ts",
  InfrastructureCollection: "InfrastructureCollectionApi.ts",
  InfrastructureCollectionSearch: "InfrastructureCollectionApi.ts",
  Entity: "EntityDetailApi.ts",
  EntityConnections: "EntityDetailApi.ts",
  EntityAllTime: "EntityDetailApi.ts",
  EntityAllTimeConnections: "EntityDetailApi.ts",
};

const CLIENT_MODULES: Array<string> = [
  "TopologyApi.ts",
  "InfrastructureCollectionApi.ts",
  "EntityDetailApi.ts",
];

describe("every Topology request goes through a TopologyApiPath route", () => {
  test("TopologyApi.ts holds the one API.post, built from APP_API_URL and a TopologyApiPath", () => {
    const code: string = readCode(path.join(TOPOLOGY_DIR, "TopologyApi.ts"));

    expect(countOccurrences(code, "API.post")).toBe(1);
    expect(code).toContain(
      "export async function postTopologyApi( path: TopologyApiPath,",
    );
    expect(code).toContain(
      "URL.fromString(APP_API_URL.toString()).addRoute(path)",
    );
    expect(code).toContain("headers: { ...ModelAPI.getCommonHeaders() }");
    expect(code).toContain("options: { signal: options?.signal }");
  });

  test.each(["InfrastructureCollectionApi.ts", "EntityDetailApi.ts"])(
    "%s posts only through postTopologyApi",
    (file: string) => {
      const code: string = readCode(path.join(TOPOLOGY_DIR, file));

      expect(code).not.toMatch(/\bAPI\.(post|get|put|delete)\b/);
      expect(code).not.toMatch(/\bModelAPI\./);
      expect(code).not.toMatch(/\bfetch\(/);
      expect(code).toContain('from "./TopologyApi"');
      expect(code).toMatch(/\bpostTopologyApi\(/);
    },
  );

  test("each route is requested by exactly the client module that owns it", () => {
    const codeByModule: Map<string, string> = new Map<string, string>(
      CLIENT_MODULES.map((file: string): [string, string] => {
        return [file, readCode(path.join(TOPOLOGY_DIR, file))];
      }),
    );

    for (const member of Object.keys(TopologyApiPath) as Array<
      keyof typeof TopologyApiPath
    >) {
      const users: Array<string> = CLIENT_MODULES.filter(
        (file: string): boolean => {
          return new RegExp(`\\bTopologyApiPath\\.${member}\\b`).test(
            codeByModule.get(file)!,
          );
        },
      );
      expect({ member, users }).toEqual({
        member,
        users: [ROUTE_OWNERS[member]],
      });
    }
  });

  test("no Dashboard source spells a Topology path; they all come from the contract", () => {
    const spelled: Array<string> = listSourceFiles(DASHBOARD_SRC)
      .filter((file: string): boolean => {
        /* Cheap raw pre-filter; only a hit is re-read without comments. */
        return (
          fs.readFileSync(file, "utf8").includes("/telemetry/topology") &&
          readCode(file).includes("/telemetry/topology")
        );
      })
      .map((file: string): string => {
        return path.relative(DASHBOARD_SRC, file);
      });

    expect(spelled).toEqual([]);
  });
});

describe('the "Partial inventory loaded" banner is gone', () => {
  const OLD_COPY: Array<string> = [
    "Partial inventory loaded",
    "exceeds the map loading limit",
    "cover the loaded resources only",
  ];

  test("no Dashboard source or translation carries the old copy", () => {
    const offenders: Array<string> = [];
    for (const file of listSourceFiles(DASHBOARD_SRC)) {
      /* Raw text: translations and JSX strings, comments included. */
      const raw: string = fs.readFileSync(file, "utf8");
      for (const copy of OLD_COPY) {
        if (raw.includes(copy)) {
          offenders.push(`${path.relative(DASHBOARD_SRC, file)}: ${copy}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /*
   * One banner, worded per cap and per tab from translated fragments whose
   * keys hold no numbers. "Counts are exact" is only true on Infrastructure,
   * whose summary switches to the server's totals; the Service Map's counts
   * come from what was shipped.
   */
  test("the page's only truncation banner words each cap for what it limited", () => {
    const code: string = readCode(PAGE.path);

    expect(countOccurrences(code, 'data-testid="topology-truncation"')).toBe(1);
    expect(code).toContain('translateString("of")');
    expect(code).toContain('translateString("resources shown.")');
    expect(code).toContain('translateString("connections shown.")');
    expect(
      countOccurrences(
        code,
        '"Counts are exact; the map and search cover the resources shown."',
      ),
    ).toBe(1);
    expect(code).toContain('"The map, counts and search cover what is shown."');
    expect(code).toMatch(
      /activeTabName === "Infrastructure" \? translateString\( "Counts are exact; the map and search cover the resources shown\.", \)/,
    );
    const keys: Array<string> = callsOf(code, /translateString\("([^"]*)"\)/g);
    expect(
      keys.filter((key: string): boolean => {
        return DIGIT.test(key);
      }),
    ).toEqual([]);
  });
});

/*
 * The activity predicate, both sides.
 *
 * The SQL text is pinned EXACTLY to the one the design fixed (semantics 1 in
 * the build spec), and the browser predicate is evaluated over a truth table
 * against a direct transcription of that SQL's three-valued CASE. With the
 * text pinned, the transcription is the SQL; TopologyActivityParityPostgres
 * (Common, opt-in) runs the same table through a real Postgres.
 */
const RANGE_START_MS: number = Date.parse("2026-09-20T10:00:00.000Z");

const EXPECTED_ACTIVE_SQL: string =
  `CASE WHEN i."source" IS NOT NULL AND i."source" <> '' AND i."source" <> 'discovered' THEN TRUE ` +
  `WHEN i."lastSeenAt" IS NULL THEN TRUE ` +
  `ELSE i."lastSeenAt" >= $7 END`;

interface ActivityCase {
  label: string;
  source: string | null;
  /* Offset from the range start in ms; null = never reported. */
  lastSeenOffsetMs: number | null;
  active: boolean;
}

const ACTIVITY_CASES: Array<ActivityCase> = [
  {
    label: "discovered, reported in range",
    source: EntitySource.Discovered,
    lastSeenOffsetMs: 60_000,
    active: true,
  },
  {
    label: "discovered, reported exactly at the range start",
    source: EntitySource.Discovered,
    lastSeenOffsetMs: 0,
    active: true,
  },
  {
    label: "discovered, 1 ms before the range start",
    source: EntitySource.Discovered,
    lastSeenOffsetMs: -1,
    active: false,
  },
  {
    label: "discovered, a day before the range start",
    source: EntitySource.Discovered,
    lastSeenOffsetMs: -86_400_000,
    active: false,
  },
  {
    label: "discovered, never reported",
    source: EntitySource.Discovered,
    lastSeenOffsetMs: null,
    active: true,
  },
  {
    label: "no source, stale",
    source: null,
    lastSeenOffsetMs: -86_400_000,
    active: false,
  },
  {
    label: "no source, never reported",
    source: null,
    lastSeenOffsetMs: null,
    active: true,
  },
  {
    label: "blank source, stale",
    source: "",
    lastSeenOffsetMs: -86_400_000,
    active: false,
  },
  {
    label: "blank source, in range",
    source: "",
    lastSeenOffsetMs: 1,
    active: true,
  },
  {
    label: "manual, stale",
    source: EntitySource.Manual,
    lastSeenOffsetMs: -86_400_000 * 365,
    active: true,
  },
  {
    label: "inventory-mirrored, stale",
    source: EntitySource.Inventory,
    lastSeenOffsetMs: -86_400_000,
    active: true,
  },
  {
    label: "manual, never reported",
    source: EntitySource.Manual,
    lastSeenOffsetMs: null,
    active: true,
  },
  {
    label: "a source that is not exactly 'discovered' (case), stale",
    source: "Discovered",
    lastSeenOffsetMs: -86_400_000,
    active: true,
  },
  {
    label: "a whitespace source, stale",
    source: " ",
    lastSeenOffsetMs: -86_400_000,
    active: true,
  },
];

/* The pinned SQL CASE, transcribed with SQL's NULL semantics. */
function sqlCase(
  source: string | null,
  lastSeenAtMs: number | null,
  rangeStartMs: number,
): boolean {
  if (source !== null && source !== "" && source !== "discovered") {
    return true;
  }
  if (lastSeenAtMs === null) {
    return true;
  }
  return lastSeenAtMs >= rangeStartMs;
}

function browserFields(testCase: ActivityCase): ActivityFields {
  /* Decoded rows carry undefined, never null, for absent values. */
  const fields: ActivityFields = {};
  if (testCase.source !== null) {
    fields.source = testCase.source;
  }
  if (testCase.lastSeenOffsetMs !== null) {
    fields.lastSeenAt = new Date(RANGE_START_MS + testCase.lastSeenOffsetMs);
  }
  return fields;
}

describe("the SQL activity predicate and isEntityActive agree", () => {
  test("the SQL predicate is exactly the one the design fixed", () => {
    expect(EntitySource.Discovered).toBe("discovered");
    expect(activeSql("i", "$7")).toBe(EXPECTED_ACTIVE_SQL);
  });

  test("the alias and the placeholder are the only moving parts", () => {
    expect(activeSql("n", "$2")).toBe(
      EXPECTED_ACTIVE_SQL.replace(/\bi\./g, "n.").replace("$7", "$2"),
    );
  });

  test.each(ACTIVITY_CASES)("$label", (testCase: ActivityCase) => {
    const rangeStart: Date = new Date(RANGE_START_MS);
    const lastSeenAtMs: number | null =
      testCase.lastSeenOffsetMs === null
        ? null
        : RANGE_START_MS + testCase.lastSeenOffsetMs;

    expect(sqlCase(testCase.source, lastSeenAtMs, RANGE_START_MS)).toBe(
      testCase.active,
    );
    expect(isEntityActive(browserFields(testCase), rangeStart)).toBe(
      testCase.active,
    );
  });

  test("the browser also agrees when a decoder hands it null instead of undefined", () => {
    const rangeStart: Date = new Date(RANGE_START_MS);
    for (const testCase of ACTIVITY_CASES) {
      const fields: { source: string | null; lastSeenAt: Date | null } = {
        source: testCase.source,
        lastSeenAt:
          testCase.lastSeenOffsetMs === null
            ? null
            : new Date(RANGE_START_MS + testCase.lastSeenOffsetMs),
      };
      expect({
        label: testCase.label,
        active: isEntityActive(fields as unknown as ActivityFields, rangeStart),
      }).toEqual({ label: testCase.label, active: testCase.active });
    }
  });

  test("every server-side activity decision goes through activeSql", () => {
    const serverFiles: Array<string> = fs
      .readdirSync(SERVER_TOPOLOGY_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".ts");
      });
    expect(serverFiles).toEqual(
      expect.arrayContaining(["TopologySql.ts", "TopologyQueries.ts"]),
    );

    const discoveredSites: Array<string> = [];
    const lastSeenComparisons: Array<string> = [];
    for (const file of serverFiles) {
      const code: string = readCode(path.join(SERVER_TOPOLOGY_DIR, file));
      const discovered: number =
        countOccurrences(code, "EntitySource.Discovered") +
        countOccurrences(code, "'discovered'") +
        countOccurrences(code, '"discovered"');
      for (let index: number = 0; index < discovered; index++) {
        discoveredSites.push(file);
      }
      for (const match of code.matchAll(/([\w${}]+)\."lastSeenAt" >= /g)) {
        lastSeenComparisons.push(`${file}:${match[1]}`);
      }
    }

    /* The one CASE in activeSql... */
    expect(discoveredSites).toEqual(["TopologySql.ts"]);
    /*
     * ...and the range filter on relationships (inRangeRelationshipSql),
     * both written against an alias parameter.
     */
    expect(lastSeenComparisons.sort()).toEqual([
      "TopologySql.ts:${alias}",
      "TopologySql.ts:${alias}",
    ]);
  });

  test("the browser has one activity predicate too", () => {
    const sites: Array<string> = [];
    for (const file of listSourceFiles(TOPOLOGY_DIR)) {
      const code: string = readCode(file);
      if (
        code.includes("EntitySource.Discovered") ||
        DISCOVERED_LITERAL.test(code)
      ) {
        sites.push(path.basename(file));
      }
    }

    expect(sites).toEqual(["TopologyActivity.ts"]);
  });
});
