import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4730: a UniFi access point's Wi-Fi tab listed five SSIDs for one
 * network on two bands - its VAP table also holds the networks UniFi runs
 * for itself (the wireless mesh link, the device adoption network). A walk
 * no longer stores those rows in an SSID table (SnmpTableListUtil.isListedRow),
 * but a device keeps the snapshot an earlier walk stored until its next
 * successful walk - or for as long as its walks fail, or its probe is too
 * old to walk tables. So every view that reads the STORED snapshot reads it
 * the way a walk stores it now: through SnmpTableListUtil.withListedRows (or
 * listedRows, under WifiRadioUtil.getSummary).
 *
 * What no behaviour test can see is the NEXT view someone adds that reads
 * the column on its own. So this reads the sources:
 *
 * - every file that mentions a device's stored table snapshot is one this
 *   guard knows, with what it does with it;
 * - each view reads it through the rows a walk would store now;
 * - the Wi-Fi view's summary takes its SSIDs from listedRows.
 *
 * Comments are stripped and whitespace removed before matching, as
 * DashboardStoredConfigReaders does: prettier may wrap a call anywhere.
 */

const PACKAGES_ROOT: string = path.join(__dirname, "..", "..", "..");
const REPO_ROOT: string = path.join(PACKAGES_ROOT, "..");

const SCAN_ROOTS: Array<string> = [
  path.join(PACKAGES_ROOT, "App", "FeatureSet"),
  path.join(PACKAGES_ROOT, "Common", "Server"),
  path.join(PACKAGES_ROOT, "Common", "Utils"),
  path.join(PACKAGES_ROOT, "Common", "UI"),
  path.join(PACKAGES_ROOT, "Common", "Types"),
  path.join(PACKAGES_ROOT, "Common", "Models"),
  // App Test runs without ee/ (CI removes it): scanned when it is there.
  path.join(REPO_ROOT, "ee"),
];

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "public",
];

const SOURCE_FILE: RegExp = /\.(ts|tsx)$/;
const TEST_FILE: RegExp = /\.(test|spec)\.(ts|tsx)$/;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:"'`])\/\/.*$/gm;
const WHITESPACE: RegExp = /\s+/g;
const MENTION: string = "snmpTableSnapshot";

type Role =
  // Shows or offers stored rows: reads them as a walk stores them now.
  | "view"
  // Merges a walk over the stored snapshot, or writes it.
  | "store"
  // Mentions it without reading stored rows.
  | "other";

interface KnownFile {
  role: Role;
  why: string;
}

const TABLES_TAB: string =
  "App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/Tables.tsx";
const WIFI_TAB: string =
  "App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/WiFi.tsx";
const MONITOR_STEP: string =
  "App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorStep.tsx";
const WIFI_RADIO_UTIL: string = "Common/Utils/NetworkDevice/WifiRadioUtil.ts";
const TABLE_LIST_UTIL: string =
  "Common/Types/Monitor/SnmpMonitor/SnmpTableListUtil.ts";

const KNOWN_FILES: Record<string, KnownFile> = {
  [TABLES_TAB]: {
    role: "view",
    why: "the device's SNMP Tables tab draws every stored table",
  },
  [WIFI_TAB]: {
    role: "view",
    why: "the device's Wi-Fi tab, through WifiRadioUtil.getSummary",
  },
  [MONITOR_STEP]: {
    role: "view",
    why: "a Network Device monitor's row picker offers the stored rows' names",
  },
  "Common/Server/Utils/Monitor/NetworkDeviceWalkUtil.ts": {
    role: "store",
    why: "merges this walk's tables over the stored ones",
  },
  "Common/Server/Utils/Monitor/NetworkInventoryUtil.ts": {
    role: "store",
    why: "writes the snapshot the walk hands it",
  },
  "Common/Models/DatabaseModels/NetworkDevice.ts": {
    role: "other",
    why: "the column itself",
  },
  "Common/Server/Infrastructure/Postgres/SchemaMigrations/1799660000000-AddSnmpTablesToNetworkDevices.ts":
    {
      role: "other",
      why: "the migration that created the column",
    },
};

function toKey(absolutePath: string): string {
  return path.relative(PACKAGES_ROOT, absolutePath).split(path.sep).join("/");
}

function walk(directory: string, found: Array<string>): void {
  if (!fs.existsSync(directory)) {
    return;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        walk(path.join(directory, entry.name), found);
      }
      continue;
    }

    if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      found.push(path.join(directory, entry.name));
    }
  }
}

function filesMentioningTheSnapshot(): Array<string> {
  const files: Array<string> = [];

  for (const root of SCAN_ROOTS) {
    walk(root, files);
  }

  return files
    .filter((file: string): boolean => {
      return fs.readFileSync(file, "utf8").includes(MENTION);
    })
    .map(toKey)
    .sort();
}

// The code of a file with no comments and no whitespace at all.
function codeOf(key: string): string {
  return fs
    .readFileSync(path.join(PACKAGES_ROOT, key), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, "");
}

function filesWithRole(role: Role): Array<string> {
  return Object.keys(KNOWN_FILES).filter((key: string): boolean => {
    return KNOWN_FILES[key]!.role === role;
  });
}

describe("every view of a device's stored SNMP tables reads them as a walk stores them now (#4730)", () => {
  test("every file that mentions the stored snapshot is one this guard knows", () => {
    const found: Array<string> = filesMentioningTheSnapshot();

    // The walk reached the files at all, so this is not vacuous.
    expect(found).toEqual(expect.arrayContaining([TABLES_TAB, WIFI_TAB]));

    const unknown: Array<string> = found.filter((key: string): boolean => {
      return !KNOWN_FILES[key];
    });

    /*
     * A file here reads `snmpTableSnapshot` and this guard does not know
     * what it does with it. If it shows or offers the stored rows, read them
     * with SnmpTableListUtil.withListedRows - then add it to KNOWN_FILES
     * with its role and why.
     */
    expect(unknown).toEqual([]);
  });

  test("every file this guard knows still mentions the snapshot: the list has nothing stale", () => {
    const found: Set<string> = new Set(filesMentioningTheSnapshot());

    for (const key of Object.keys(KNOWN_FILES)) {
      expect({ key, mentioned: found.has(key) }).toEqual({
        key,
        mentioned: true,
      });
      expect(KNOWN_FILES[key]!.why.length).toBeGreaterThan(0);
    }
  });

  test("each view reads the stored rows a walk would store now", () => {
    const expected: Record<string, Array<string>> = {
      [TABLES_TAB]: [
        "SnmpTableListUtil.withListedRows(device?.snmpTableSnapshot",
      ],
      [MONITOR_STEP]: [
        "SnmpTableListUtil.withListedRows(device?.snmpTableSnapshot",
      ],
      [WIFI_TAB]: [
        "constsnapshots:Array<SnmpTableSnapshot>=device?.snmpTableSnapshot||[];",
        "WifiRadioUtil.getSummary(snapshots)",
      ],
    };

    expect(Object.keys(expected).sort()).toEqual(filesWithRole("view").sort());

    for (const [key, calls] of Object.entries(expected)) {
      const code: string = codeOf(key);

      for (const call of calls) {
        expect({ key, call, found: code.includes(call) }).toEqual({
          key,
          call,
          found: true,
        });
      }
    }
  });

  test("the Wi-Fi tab draws only what the summary listed, and the summary lists only listedRows", () => {
    const wifiTab: string = codeOf(WIFI_TAB);

    // The tab hands the stored snapshot on, and never reads its rows itself.
    for (const reading of [
      "snapshots.map(",
      "snapshots.flatMap(",
      "snapshots.filter(",
      "snapshot.rows",
      "snmpTableSnapshot.",
      "snmpTableSnapshot?.",
    ]) {
      expect({ reading, found: wifiTab.includes(reading) }).toEqual({
        reading,
        found: false,
      });
    }

    expect(
      codeOf(WIFI_RADIO_UTIL).includes(
        "SnmpTableListUtil.listedRows(snapshot)",
      ),
    ).toBe(true);
  });

  test("listedRows reads the same rule a walk stores rows by", () => {
    const code: string = codeOf(TABLE_LIST_UTIL);

    // At ingest ...
    expect(code.includes("SnmpTableListUtil.isListedRow(table,row)")).toBe(
      true,
    );
    // ... and on read, both through WifiInternalNetworkUtil.isJoinableNetwork.
    expect(
      code.split("WifiInternalNetworkUtil.isJoinableNetwork(").length - 1,
    ).toBe(2);
  });
});
