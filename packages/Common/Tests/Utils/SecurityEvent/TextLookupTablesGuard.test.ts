import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listSourceFiles, toRelativePath } from "../../ForeignHiddenRuleGuard";
import {
  findPlainTableReads,
  PlainTableRead,
} from "../../Helpers/TextLookupTableScan";
import lookupTable, { readOwnValue } from "../../../Utils/LookupTable";
import { INHERITED_PROPERTY_NAME_SPELLINGS } from "../../Helpers/InheritedNames";

/*
 * TABLES READ BY TEXT FROM OUTSIDE ONEUPTIME ANSWER ONLY FOR THEIR OWN KEYS.
 *
 * Security Events reads what other products write - a severity, a tactic's
 * name, a status, a risk type, a Windows provider - and the search boxes
 * read what somebody typed before a colon. Each looks the words up in a
 * table. A table kept as a plain object answered for names it never
 * listed: "constructor", "toString", "__proto__" and the rest every object
 * inherits. A tactic named "constructor" went into an event's tactics as a
 * function, a severity named "__proto__" as an object, and `constructor:`
 * in a search box broke the explorer.
 *
 * Those tables are Maps now (Common/Utils/LookupTable), and this guard
 * keeps the code that reads outside text from gaining another plain one:
 * no table typed by any string (Record<string, T> and the like) is read
 * there with a key the code does not write itself, nor any table with a
 * cast key, nor with `in` - unless the same condition checks the table's
 * own keys first. A table read only by keys OneUptime knows - its own ids,
 * or a value checked against a list first - is listed below with what keys
 * it.
 */

// packages/Common/Tests/Utils/SecurityEvent -> packages/Common.
const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..");
const PACKAGES_ROOT: string = path.resolve(COMMON_ROOT, "..");

// The code that reads text from outside OneUptime, by directory or file.
const SCANNED: ReadonlyArray<string> = [
  "Common/Utils/SecurityEvent",
  "Common/Server/Utils/SecurityEvent",
  "Common/Types/SecurityEvent",
  "Common/Types/Telemetry/TelemetrySearchQuery.ts",
  "Common/UI/Components/LogsViewer/components/LogSearchBar.tsx",
  "Common/UI/Components/TelemetryViewer/components/TelemetrySearchBar.tsx",
  "App/FeatureSet/Dashboard/src/Utils/ExceptionsSearchQuery.ts",
];

interface ReadByKnownKeys {
  // packages-relative, with "/".
  file: string;
  table: string;
  // What its keys are: never text from outside OneUptime as it came.
  keyedBy: string;
}

export const TABLES_READ_BY_KNOWN_KEYS: ReadonlyArray<ReadByKnownKeys> = [
  {
    file: "Common/Types/SecurityEvent/MitreAttack.ts",
    table: "MITRE_TACTIC_TECHNIQUES",
    keyedBy:
      "the ids of MITRE_TACTICS, the matrix OneUptime ships, while it builds MITRE_TECHNIQUES",
  },
  {
    file: "Common/Types/SecurityEvent/SecurityWatchlist.ts",
    table: "SECURITY_WATCHLIST_FEED_INDICATOR_TYPES",
    keyedBy:
      "a kind canSecurityWatchlistFollowFeed has first found among SECURITY_WATCHLIST_FEED_ENTITY_TYPES (getSecurityWatchlistFeedIndicatorTypes returns before the read otherwise)",
  },
];

function scannedFiles(): Array<string> {
  const files: Array<string> = [];

  for (const entry of SCANNED) {
    const full: string = path.join(PACKAGES_ROOT, entry);

    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      files.push(full);
      continue;
    }

    files.push(...listSourceFiles(full));
  }

  return files;
}

interface FoundRead extends PlainTableRead {
  file: string;
}

function findReads(): Array<FoundRead> {
  const found: Array<FoundRead> = [];

  for (const file of scannedFiles()) {
    const relative: string = toRelativePath(PACKAGES_ROOT, file);

    for (const read of findPlainTableReads({
      fileName: file,
      text: fs.readFileSync(file, "utf8"),
    })) {
      found.push({ ...read, file: relative });
    }
  }

  return found;
}

function isReadByKnownKeys(read: FoundRead): boolean {
  return TABLES_READ_BY_KNOWN_KEYS.some((entry: ReadByKnownKeys): boolean => {
    return entry.file === read.file && entry.table === read.table;
  });
}

describe("the scan for plain tables read by text", () => {
  function reads(text: string): Array<string> {
    return findPlainTableReads({ fileName: "example.ts", text }).map(
      (read: PlainTableRead): string => {
        return `${read.line}: ${read.code}`;
      },
    );
  }

  test("a table typed by any string, read by a key the code does not write, is found", () => {
    expect(
      reads(`const SEVERITIES: Record<string, number> = { high: 1 };
export function read(word: string): number | undefined {
  return SEVERITIES[word.toLowerCase()];
}`),
    ).toEqual(["3: SEVERITIES[word.toLowerCase()]"]);

    expect(
      reads(`const NAMES: Readonly<Record<string, string>> = { a: "A" };
const OTHER: Dictionary<string> = { b: "B" };
const LITERAL: { [key: string]: string } = { c: "C" };
export const all = (k: string): Array<string | undefined> => [NAMES[k], OTHER[k], LITERAL[k]];`),
    ).toEqual(["4: NAMES[k]", "4: OTHER[k]", "4: LITERAL[k]"]);
  });

  test("a table checked with `in` by such a key is found, whatever its type", () => {
    expect(
      reads(`const UNITS = { weekly: 1 };
export const unit = (f: string): boolean => f in UNITS;`),
    ).toEqual(["2: f in UNITS"]);
  });

  test("a table typed by its own keys is found only where a read casts its key", () => {
    expect(
      reads(`enum Kind { A = "a" }
const BY_KIND: Record<Kind, number> = { [Kind.A]: 1 };
export const typed = (kind: Kind): number => BY_KIND[kind];
export const cast = (text: string): number => BY_KIND[text as Kind];`),
    ).toEqual(["4: BY_KIND[text as Kind]"]);
  });

  test("keys the code writes, writes, Maps, and reads that check the table's own keys first are not found", () => {
    expect(
      reads(`enum Kind { A = "a" }
const TABLE: Record<string, string> = { a: "A", b: "B" };
const MAP: ReadonlyMap<string, string> = new Map([["a", "A"]]);
export function ok(key: string): Array<string | undefined> {
  TABLE[key] = "written";
  const guarded: string | undefined = Object.prototype.hasOwnProperty.call(TABLE, key) ? TABLE[key] : undefined;
  const alsoGuarded: string | undefined = Object.hasOwn(TABLE, key) && TABLE[key] || undefined;
  if (Object.prototype.hasOwnProperty.call(TABLE, key)) {
    return [TABLE[key]];
  }
  return [TABLE["a"], TABLE[\`b\`], TABLE[Kind.A], MAP.get(key), guarded, alsoGuarded];
}`),
    ).toEqual([]);
  });
});

describe("Security Events' ingest and the search boxes read outside text through tables that answer only for their own keys", () => {
  test("the scanned code is where it was: each directory and file still exists and holds code", () => {
    for (const entry of SCANNED) {
      expect({
        entry,
        exists: fs.existsSync(path.join(PACKAGES_ROOT, entry)),
      }).toEqual({ entry, exists: true });
    }

    expect(scannedFiles().length).toBeGreaterThan(100);
  });

  test("no table there answers for a name it never listed", () => {
    const unguarded: Array<string> = findReads()
      .filter((read: FoundRead): boolean => {
        return !isReadByKnownKeys(read);
      })
      .map((read: FoundRead): string => {
        return `${read.file}:${read.line}: ${read.code}`;
      });

    // Each read here: make the table a lookupTable(...) Map, or read it with readOwnValue.
    expect(unguarded).toEqual([]);
  });

  test("every table listed as read by known keys is still read that way, so the list never outlives its table", () => {
    const reads: Array<FoundRead> = findReads();

    for (const entry of TABLES_READ_BY_KNOWN_KEYS) {
      expect({
        entry,
        isStillRead: reads.some((read: FoundRead): boolean => {
          return read.file === entry.file && read.table === entry.table;
        }),
      }).toEqual({ entry, isStillRead: true });
    }
  });
});

describe("Common/Utils/LookupTable", () => {
  const TABLE: Readonly<Record<string, number>> = {
    low: 1,
    high: 3,
  };

  test("lookupTable answers for the keys it was given, in their order, with their values", () => {
    const map: ReadonlyMap<string, number> = lookupTable(TABLE);

    expect([...map.entries()]).toEqual([
      ["low", 1],
      ["high", 3],
    ]);
    expect(map.get("high")).toBe(3);
    expect(map.get("HIGH")).toBeUndefined();
  });

  test("lookupTable and readOwnValue answer nothing for what every object inherits, in any case", () => {
    const map: ReadonlyMap<string, number> = lookupTable(TABLE);

    for (const name of INHERITED_PROPERTY_NAME_SPELLINGS) {
      expect({
        name,
        fromMap: map.get(name),
        hasInMap: map.has(name),
        fromRecord: readOwnValue(TABLE, name),
      }).toEqual({
        name,
        fromMap: undefined,
        hasInMap: false,
        fromRecord: undefined,
      });
    }
  });

  test("readOwnValue reads a record's own keys - a zero and an empty value included - and nothing of no record", () => {
    const record: Record<string, number | string> = {
      zero: 0,
      empty: "",
      word: "x",
    };

    expect(readOwnValue(record, "zero")).toBe(0);
    expect(readOwnValue(record, "empty")).toBe("");
    expect(readOwnValue(record, "word")).toBe("x");
    expect(readOwnValue(record, "missing")).toBeUndefined();
    expect(readOwnValue(undefined, "word")).toBeUndefined();
    expect(readOwnValue(null, "word")).toBeUndefined();

    // A key set on the record itself is its own, even an inherited name's.
    const own: Record<string, string> = JSON.parse('{"constructor":"mine"}');
    expect(readOwnValue(own, "constructor")).toBe("mine");
  });

  test("a source's table read through a Map keeps the value of a key named like an inherited one when the table lists it", () => {
    const map: ReadonlyMap<string, string> = lookupTable(
      JSON.parse('{"toString":"listed","__proto__":"also listed"}') as Record<
        string,
        string
      >,
    );

    expect(map.get("toString")).toBe("listed");
    expect(map.get("__proto__")).toBe("also listed");
    expect(map.get("valueOf")).toBeUndefined();
  });
});
