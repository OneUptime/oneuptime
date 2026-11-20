import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { toRelativePath } from "../../ForeignHiddenRuleGuard";
import {
  CopiedKeyWrite,
  findCopiedKeyWrites,
} from "../../Helpers/CopiedKeyWriteScan";
import {
  OUTSIDE_TEXT_CODE,
  listOutsideTextFiles,
} from "../../Helpers/OutsideTextCode";

/*
 * A SOURCE'S KEYS, COPIED ONTO ANOTHER OBJECT, ARE WRITTEN AS ITS OWN
 * (issue #8486).
 *
 * The code that reads text from outside OneUptime (Helpers/OutsideTextCode)
 * copies maps keyed by what a sender wrote: a log's fields into a security
 * event's attributes, a stored row's attribute map into a SIEM record, an
 * entity's descriptions into a merged one, a Sigma rule's names into its
 * aliases. An assignment, `target[key] = value`, drops a key named
 * "__proto__" (every object inherits it as a setter: a string under it is
 * ignored, an object under it becomes the target's prototype), so a key a
 * sender used was silently lost. TextLookupTablesGuard keeps tables *read*
 * by such text answering only for their own keys; this keeps the keys
 * *copied* from one object to another written with writeOwnValue
 * (Common/Utils/LookupTable). A copy whose keys OneUptime chose - its own
 * columns, the names it writes itself - is listed below with what keys it.
 *
 * Since #8485 a spread on the servers keeps "__proto__" (they compile for
 * ES2018), so only an assignment is looked for.
 */

// packages/Common/Tests/Utils/SecurityEvent -> packages.
const PACKAGES_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

interface CopiedFromKnownKeys {
  // packages-relative, with "/".
  file: string;
  // The object written, as the code writes it.
  target: string;
  // Whose keys they are: never a sender's as it wrote them.
  keyedBy: string;
}

export const COPIES_OF_KNOWN_KEYS: ReadonlyArray<CopiedFromKnownKeys> = [
  {
    file: "Common/Utils/SecurityEvent/Destinations/SiemEventMappers.ts",
    target: "result",
    keyedBy:
      "compact() drops the empty fields of the mappers' own object literals: the keys are written in the code",
  },
  {
    file: "Common/Utils/SecurityEvent/SecurityEventSearch.ts",
    target: "query",
    keyedBy:
      "the table's columns the search resolved each field to (COLUMN_BY_FIELD_ALIAS, a Map): never a field as typed",
  },
  {
    file: "Common/Utils/SecurityEvent/LogParsers/CloudAuditResources.ts",
    target: "dimensions",
    keyedBy:
      "the ARN dimensions a CloudTrail field's companions name, written in CLOUDTRAIL_RESOURCE_FIELDS: never a key of the record",
  },
  {
    file: "Common/Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder.ts",
    target: "record",
    keyedBy: "the columns of the update the recorder writes, an object literal",
  },
  {
    file: "Common/Server/Utils/SecurityEvent/LogScan/SecurityLogScanner.ts",
    target: "lastFoundAtByFormat",
    keyedBy:
      "the SecurityLogFormat ids the scanner itself stored on its previous run",
  },
  {
    file: "Common/Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistQueryBinder.ts",
    target: "bound",
    keyedBy:
      "the columns of a query OneUptime built; the attributes inside one are written as own keys",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Utils/ExceptionsSearchQuery.ts",
    target: "literals",
    keyedBy:
      "the exception columns the search resolved each field to (COLUMN_BY_FIELD_ALIAS, a Map)",
  },
  {
    file: "App/FeatureSet/Dashboard/src/Utils/ExceptionsSearchQuery.ts",
    target: "operators",
    keyedBy:
      "the exception columns the search resolved each field to (COLUMN_BY_FIELD_ALIAS, a Map)",
  },
  {
    file: "Common/Server/Utils/Telemetry/InventoryEntityRegistry.ts",
    target: "out",
    keyedBy:
      "compactAttributes is handed the object literals each entity type's describe() writes",
  },
  {
    file: "Common/Server/Utils/Telemetry/OpenStackSnapshotScan.ts",
    target: "entry",
    keyedBy:
      "setIdentity's fields, the buffer entry's own typed columns (name, regionName ...)",
  },
  {
    file: "Common/Server/Utils/Telemetry/OpenStackSnapshotScan.ts",
    target: "entry.facts",
    keyedBy:
      "quota fact keys, each OPENSTACK_QUOTA_FACT_PREFIX + resource + region (getOpenStackQuotaFactKey)",
  },
  {
    file: "Common/Server/Utils/Telemetry/StorageArraySnapshotScan.ts",
    target: "existing.details",
    keyedBy:
      "the detail names the scan writes itself (protocol, slot, speedBytesPerSec ...)",
  },
  {
    file: "Common/Server/Utils/Telemetry/Telemetry.ts",
    target: "flattenedFields",
    keyedBy:
      "a kvlist's flattened keys, each its own key's path and a dot first (`${prefix}.${key}`), so never a bare name",
  },
  {
    file: "Common/Server/Utils/Telemetry/TelemetryContext.ts",
    target: "target",
    keyedBy:
      "the telemetry context's own attribute names, which OneUptime's code sets (requestId, projectId ...)",
  },
];

interface FoundWrite extends CopiedKeyWrite {
  file: string;
}

function findWrites(): Array<FoundWrite> {
  const found: Array<FoundWrite> = [];

  for (const file of listOutsideTextFiles(PACKAGES_ROOT)) {
    const relative: string = toRelativePath(PACKAGES_ROOT, file);

    for (const write of findCopiedKeyWrites({
      fileName: file,
      text: fs.readFileSync(file, "utf8"),
    })) {
      found.push({ ...write, file: relative });
    }
  }

  return found;
}

function isCopyOfKnownKeys(write: FoundWrite): boolean {
  return COPIES_OF_KNOWN_KEYS.some((entry: CopiedFromKnownKeys): boolean => {
    return entry.file === write.file && entry.target === write.target;
  });
}

describe("the scan for a source's keys copied onto another object with an assignment", () => {
  function writes(text: string): Array<string> {
    return findCopiedKeyWrites({ fileName: "example.ts", text }).map(
      (write: CopiedKeyWrite): string => {
        return `${write.line}: ${write.target}: ${write.code}`;
      },
    );
  }

  test("a key of Object.keys, of Object.entries and of for...in, written onto another object, is found", () => {
    expect(
      writes(`export function copy(source: Record<string, string>): Array<Record<string, string>> {
  const a: Record<string, string> = {};
  const b: Record<string, string> = {};
  const c: Record<string, string> = {};
  for (const key of Object.keys(source)) {
    a[key] = source[key]!;
  }
  for (const [name, value] of Object.entries(source)) {
    b[name] = value;
  }
  for (const field in source) {
    c[field] ??= source[field]!;
  }
  return [a, b, c];
}`),
    ).toEqual([
      "6: a: a[key] = source[key]!",
      "9: b: b[name] = value",
      "12: c: c[field] ??= source[field]!",
    ]);
  });

  test("a key a per-item callback of Object.keys or Object.entries takes is found, and so is a nested target", () => {
    expect(
      writes(`export function copy(source: Record<string, string>, entry: { facts: Record<string, string> }): void {
  const out: Record<string, string> = {};
  Object.keys(source).forEach((key: string) => {
    out[key] = source[key]!;
  });
  Object.entries(source).map(([key, value]: [string, string]) => {
    entry.facts[key] = value;
  });
}`),
    ).toEqual([
      "4: out: out[key] = source[key]!",
      "7: entry.facts: entry.facts[key] = value",
    ]);
  });

  test("a key walked through a sorted or filtered list of the keys, or through a variable holding one, is found", () => {
    expect(
      writes(`export function copy(source: Record<string, string>): Array<Record<string, string>> {
  const a: Record<string, string> = {};
  const b: Record<string, string> = {};
  const c: Record<string, string> = {};
  const d: Record<string, string> = {};
  for (const key of Object.keys(source).sort()) {
    a[key] = source[key]!;
  }
  const keys: Array<string> = Object.keys(source);
  for (const key of keys) {
    b[key] = source[key]!;
  }
  const pairs: Array<[string, string]> = Object.entries(source).slice(0, 10);
  pairs.forEach(([name, value]: [string, string]) => {
    c[name] = value;
  });
  for (const key of keys.filter((key: string) => key.length > 0)) {
    d[key] = source[key]!;
  }
  return [a, b, c, d];
}`),
    ).toEqual([
      "7: a: a[key] = source[key]!",
      "11: b: b[key] = source[key]!",
      "15: c: c[name] = value",
      "18: d: d[key] = source[key]!",
    ]);
  });

  test("a list of anything but a source's keys binds no key", () => {
    expect(
      writes(`export function copy(source: Record<string, string>, names: Array<string>): Record<string, string> {
  const out: Record<string, string> = {};
  const values: Array<string> = Object.values(source).sort();
  for (const value of values) {
    out[value] = "a value, not a key of source";
  }
  for (const name of names.sort()) {
    out[name] = "the caller's names";
  }
  return out;
}`),
    ).toEqual([]);
  });

  test("writing back into the object walked, writeOwnValue, a key of the code's own and a derived key are not found", () => {
    expect(
      writes(`import { writeOwnValue } from "../LookupTable";
const PREFIX_KEY: string = "x";
export function copy(node: Record<string, string>, source: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(node)) {
    node[key] = node[key]!.trim();
  }
  for (const [key, value] of Object.entries(source)) {
    writeOwnValue(out, key, value);
    out["fixed"] = value;
    out[PREFIX_KEY] = value;
    out[\`resource.\${key}\`] = value;
    out[key.toLowerCase()] = value;
  }
  for (const key of Object.values(source)) {
    out[key] = "a value, not a key of source";
  }
  return out;
}`),
    ).toEqual([]);
  });

  test("a key is bound only inside its loop", () => {
    expect(
      writes(`export function copy(source: Record<string, string>, key: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(source)) {
    out[key] = source[key]!;
  }
  out[key] = "the parameter, after the loop";
  return out;
}`),
    ).toEqual(["4: out: out[key] = source[key]!"]);
  });
});

describe("the code that reads outside text copies a source's keys as the target's own", () => {
  test("the scanned code is where it was, and holds code", () => {
    for (const entry of OUTSIDE_TEXT_CODE) {
      expect({
        entry,
        exists: fs.existsSync(path.join(PACKAGES_ROOT, entry)),
      }).toEqual({ entry, exists: true });
    }

    expect(listOutsideTextFiles(PACKAGES_ROOT).length).toBeGreaterThan(100);
  });

  test("no source's key is copied onto another object with an assignment", () => {
    const unguarded: Array<string> = findWrites()
      .filter((write: FoundWrite): boolean => {
        return !isCopyOfKnownKeys(write);
      })
      .map((write: FoundWrite): string => {
        return `${write.file}:${write.line}: ${write.code}`;
      });

    // Each copy here: write the key with writeOwnValue, or list the copy with whose keys it are.
    expect(unguarded).toEqual([]);
  });

  test("every copy listed as of known keys is still made, so the list never outlives its code", () => {
    const writes: Array<FoundWrite> = findWrites();

    for (const entry of COPIES_OF_KNOWN_KEYS) {
      expect({
        entry,
        isStillMade: writes.some((write: FoundWrite): boolean => {
          return write.file === entry.file && write.target === entry.target;
        }),
      }).toEqual({ entry, isStillMade: true });
    }
  });
});
