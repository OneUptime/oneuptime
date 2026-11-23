import { JSONObject } from "../JSON";
import { getBuiltInDataType } from "./DataTypeCatalog";
import { DataStoreKind, TELEMETRY_DATA_STORE_KINDS } from "./DataStoreKind";

/*
 * WHAT THE TEAM'S DECISIONS SAY OF ITS SCANS (#10372).
 *
 * A data type whose every finding the project marked not sensitive, and a
 * location of a store where every finding was, are noise the scans make
 * again and again. OneUptime AI proposes, for a person to approve in Data
 * Security > AI (each always asks: a scan that stops looking misses the
 * real data that comes later):
 *
 *   - turning a built-in data type off, when people marked every one of its
 *     findings not sensitive - at least MIN_FINDINGS_TO_TURN_OFF of them,
 *     on at least MIN_STORES_TO_TURN_OFF stores - counting only what a
 *     detector found: OneUptime AI's own suggestions turned down say
 *     nothing of the detector;
 *   - leaving a location out of a store's scans, when people marked every
 *     finding there not sensitive, at least MIN_FINDINGS_TO_EXCLUDE of
 *     them - where the store's scanner can leave that one location out (a
 *     database column, a telemetry attribute), in the words it reads.
 *
 * Never Sensitive is never proposed: it holds values, and OneUptime AI
 * never sees one. A project's own data types are never proposed either: a
 * pattern of the team's own is better changed than turned off.
 *
 * Pure: the server decides, and the Dashboard reads the plans.
 */

export const SCAN_TUNING_LIMITS: {
  minFindingsToTurnOff: number;
  minStoresToTurnOff: number;
  minFindingsToExclude: number;
  // The most proposals of each kind one look makes.
  maxTurnOffProposalsPerRun: number;
  maxExclusionProposalsPerRun: number;
} = {
  minFindingsToTurnOff: 3,
  minStoresToTurnOff: 2,
  minFindingsToExclude: 2,
  maxTurnOffProposalsPerRun: 5,
  maxExclusionProposalsPerRun: 10,
};

/*
 * The kinds of store whose scan leaves a column out by name
 * (DatabaseSampler: "schema.table.column", compared without case).
 */
export const COLUMN_EXCLUSION_STORE_KINDS: ReadonlyArray<DataStoreKind> = [
  DataStoreKind.PostgreSql,
  DataStoreKind.MySql,
  DataStoreKind.SqlServer,
];

// What a finding is read as, for the scans' tuning.
export interface TuningFinding {
  id: string;
  dataStoreId: string;
  dataTypeId: string;
  location: string;
  locationKind?: string | undefined;
  isSuppressed: boolean;
  isAiSuggested: boolean;
}

// A built-in type to turn off: what the proposal plans.
export interface TurnOffDataTypePlan {
  dataTypeId: string;
  dataTypeName: string;
  findings: number;
  stores: number;
}

// A location to leave out of a store's scans: what the proposal plans.
export interface AddScanExclusionPlan {
  dataStoreId: string;
  storeName: string;
  location: string;
  // The exclusion as the store's scanner reads it.
  exclusion: string;
  findings: number;
  dataTypeIds: Array<string>;
}

function readText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export function readTurnOffDataTypePlan(
  value: unknown,
): TurnOffDataTypePlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const plan: JSONObject = value as JSONObject;
  const dataTypeId: string = readText(plan["dataTypeId"], 100);

  // Only a built-in type is ever turned off this way.
  if (!getBuiltInDataType(dataTypeId)) {
    return null;
  }

  return {
    dataTypeId,
    dataTypeName: readText(plan["dataTypeName"], 100),
    findings: readCount(plan["findings"]),
    stores: readCount(plan["stores"]),
  };
}

export function readAddScanExclusionPlan(
  value: unknown,
): AddScanExclusionPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const plan: JSONObject = value as JSONObject;
  const dataStoreId: string = readText(plan["dataStoreId"], 64);
  const exclusion: string = readText(plan["exclusion"], 500);

  if (!dataStoreId || !exclusion) {
    return null;
  }

  return {
    dataStoreId,
    storeName: readText(plan["storeName"], 500),
    location: readText(plan["location"], 500),
    exclusion,
    findings: readCount(plan["findings"]),
    dataTypeIds: Array.isArray(plan["dataTypeIds"])
      ? (plan["dataTypeIds"] as Array<unknown>)
          .map((id: unknown): string => {
            return readText(id, 100);
          })
          .filter((id: string): boolean => {
            return id.length > 0;
          })
          .slice(0, 50)
      : [],
  };
}

/*
 * The exclusion that leaves one location of a store out of its scans, as
 * its scanner reads it - or null where its scanner cannot leave out that
 * one place: an object store's exclusions are path prefixes that leave out
 * whole objects, and the other kinds read none.
 */
export function getScanExclusionFor(data: {
  storeKind: string | null | undefined;
  location: string | null | undefined;
  locationKind: string | null | undefined;
}): string | null {
  const location: string = (data.location || "").trim();
  const kind: string = data.storeKind || "";

  if (!location || location.length > 500) {
    return null;
  }

  // A telemetry attribute, named whole (TelemetryDataScanner.isExcludedLocation).
  if (
    (TELEMETRY_DATA_STORE_KINDS as ReadonlyArray<string>).includes(kind) &&
    data.locationKind === "Attribute"
  ) {
    return location;
  }

  // A database column, as schema.table.column (DatabaseSampler).
  if (
    (COLUMN_EXCLUSION_STORE_KINDS as ReadonlyArray<string>).includes(kind) &&
    data.locationKind === "Column" &&
    location.split(".").length >= 2
  ) {
    return location;
  }

  return null;
}

// Whether a store's exclusions leave the location out already.
export function isExcludedAlready(
  exclusions: unknown,
  exclusion: string,
): boolean {
  return (
    Array.isArray(exclusions) &&
    exclusions.some((entry: unknown): boolean => {
      return (
        typeof entry === "string" &&
        entry.trim().toLowerCase() === exclusion.trim().toLowerCase()
      );
    })
  );
}

/*
 * The built-in types to turn off, from every finding of them a detector
 * made in the project: each one marked not sensitive, enough of them, on
 * enough stores, and not turned off already - the most findings first.
 */
export function getDataTypesToTurnOff(data: {
  findings: ReadonlyArray<TuningFinding>;
  disabledDataTypeIds: ReadonlySet<string>;
}): Array<{ dataTypeId: string; findings: number; stores: number }> {
  const byType: Map<
    string,
    { findings: number; dismissed: number; stores: Set<string> }
  > = new Map();

  for (const finding of data.findings) {
    if (finding.isAiSuggested || !getBuiltInDataType(finding.dataTypeId)) {
      continue;
    }

    const entry: { findings: number; dismissed: number; stores: Set<string> } =
      byType.get(finding.dataTypeId) || {
        findings: 0,
        dismissed: 0,
        stores: new Set(),
      };

    entry.findings++;

    if (finding.isSuppressed) {
      entry.dismissed++;
    }

    entry.stores.add(finding.dataStoreId);
    byType.set(finding.dataTypeId, entry);
  }

  const proposed: Array<{
    dataTypeId: string;
    findings: number;
    stores: number;
  }> = [];

  for (const [dataTypeId, entry] of byType) {
    if (
      !data.disabledDataTypeIds.has(dataTypeId) &&
      entry.dismissed === entry.findings &&
      entry.findings >= SCAN_TUNING_LIMITS.minFindingsToTurnOff &&
      entry.stores.size >= SCAN_TUNING_LIMITS.minStoresToTurnOff
    ) {
      proposed.push({
        dataTypeId,
        findings: entry.findings,
        stores: entry.stores.size,
      });
    }
  }

  return proposed.sort(
    (
      a: { dataTypeId: string; findings: number },
      b: { dataTypeId: string; findings: number },
    ): number => {
      return b.findings - a.findings || a.dataTypeId.localeCompare(b.dataTypeId);
    },
  );
}

/*
 * The locations of stores to leave out of their scans, from every finding
 * at them: each one a detector's and marked not sensitive, enough of them,
 * where the store's scanner can leave the place out and does not already -
 * the most findings first.
 */
export function getLocationsToExclude(data: {
  findings: ReadonlyArray<TuningFinding>;
  stores: ReadonlyMap<
    string,
    { kind: string; scanExclusions?: unknown | undefined }
  >;
}): Array<{
  dataStoreId: string;
  location: string;
  exclusion: string;
  findings: number;
  dataTypeIds: Array<string>;
}> {
  const byPlace: Map<
    string,
    {
      dataStoreId: string;
      location: string;
      locationKind: string;
      findings: number;
      dismissed: number;
      dataTypeIds: Set<string>;
    }
  > = new Map();

  for (const finding of data.findings) {
    const key: string = `${finding.dataStoreId}|${finding.location}`;
    const entry: {
      dataStoreId: string;
      location: string;
      locationKind: string;
      findings: number;
      dismissed: number;
      dataTypeIds: Set<string>;
    } = byPlace.get(key) || {
      dataStoreId: finding.dataStoreId,
      location: finding.location,
      locationKind: finding.locationKind || "",
      findings: 0,
      dismissed: 0,
      dataTypeIds: new Set(),
    };

    entry.findings++;

    // A suggestion turned down says nothing of the place: it never counts as dismissed.
    if (finding.isSuppressed && !finding.isAiSuggested) {
      entry.dismissed++;
    }

    entry.dataTypeIds.add(finding.dataTypeId);
    byPlace.set(key, entry);
  }

  const proposed: Array<{
    dataStoreId: string;
    location: string;
    exclusion: string;
    findings: number;
    dataTypeIds: Array<string>;
  }> = [];

  for (const entry of byPlace.values()) {
    const store:
      | { kind: string; scanExclusions?: unknown | undefined }
      | undefined = data.stores.get(entry.dataStoreId);

    if (
      !store ||
      entry.dismissed !== entry.findings ||
      entry.findings < SCAN_TUNING_LIMITS.minFindingsToExclude
    ) {
      continue;
    }

    const exclusion: string | null = getScanExclusionFor({
      storeKind: store.kind,
      location: entry.location,
      locationKind: entry.locationKind,
    });

    if (!exclusion || isExcludedAlready(store.scanExclusions, exclusion)) {
      continue;
    }

    proposed.push({
      dataStoreId: entry.dataStoreId,
      location: entry.location,
      exclusion,
      findings: entry.findings,
      dataTypeIds: [...entry.dataTypeIds].sort(),
    });
  }

  return proposed.sort(
    (
      a: { findings: number; location: string },
      b: { findings: number; location: string },
    ): number => {
      return b.findings - a.findings || a.location.localeCompare(b.location);
    },
  );
}
