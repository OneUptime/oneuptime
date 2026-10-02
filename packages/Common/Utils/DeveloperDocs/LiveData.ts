import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dictionary from "../../Types/Dictionary";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import { getNameColumn } from "./TerraformSchema";

/*
 * What the Developer pages know about the project they are shown in, so the
 * examples are the project's own rather than placeholders:
 *
 *   - a few records of the resources the examples point at (its incident
 *     severities and states, its monitor statuses, monitors, labels, teams),
 *     so "declare an incident" uses one of its severities and "acknowledge
 *     it" its acknowledged state;
 *   - the names of the records a resource's ids point at, so its
 *     configuration can say which record each id is;
 *   - who is looking, for the examples that need a user;
 *   - when the page was rendered, for the dates in examples.
 *
 * The page fetches these itself (DeveloperDocsPage), each lookup on its own:
 * one the viewer may not read, or that fails, only means the examples fall
 * back to a placeholder there. Nothing here is ever a secret: a lookup asks
 * for ids, names and a few yes/no flags.
 */

export interface DeveloperDocsLiveRecord {
  id: string;
  name: string | null;
  // The yes/no columns the lookup asked for (isResolvedState, ...).
  flags: Dictionary<boolean>;
}

export interface DeveloperDocsLiveData {
  /*
   * Records by table name, in the order the table is usually read in
   * (severities by order, monitor statuses by priority, the rest by name).
   * A table that is not here was not looked up, or could not be.
   */
  records: Dictionary<Array<DeveloperDocsLiveRecord>>;
  // Names of records, by id.
  namesById: Dictionary<string>;
  // The viewer's own user id.
  currentUserId?: string | undefined;
  // When the page was rendered. Dates in examples are worked out from it.
  now: Date;
}

export function getEmptyDeveloperDocsLiveData(
  now: Date,
): DeveloperDocsLiveData {
  return { records: {}, namesById: {}, now };
}

// How a table is read: its order, and the flags its examples choose by.
export interface DeveloperDocsLookupSpec {
  sortColumn: string;
  sortOrder: "ASC" | "DESC";
  flagColumns: Array<string>;
}

const STATE_FLAGS: Array<string> = [
  "isCreatedState",
  "isAcknowledgedState",
  "isResolvedState",
];

/*
 * Tables whose records have an order of their own, and the flags that say
 * which record plays which part (the "resolved" state, the "operational"
 * status). Any other table is read by name.
 */
export const DEVELOPER_DOCS_LOOKUP_SPECS: Readonly<
  Dictionary<Partial<DeveloperDocsLookupSpec>>
> = {
  IncidentSeverity: { sortColumn: "order" },
  AlertSeverity: { sortColumn: "order" },
  IncidentState: { sortColumn: "order", flagColumns: STATE_FLAGS },
  AlertState: { sortColumn: "order", flagColumns: STATE_FLAGS },
  ScheduledMaintenanceState: {
    sortColumn: "order",
    flagColumns: [
      "isScheduledState",
      "isOngoingState",
      "isEndedState",
      "isResolvedState",
    ],
  },
  MonitorStatus: {
    sortColumn: "priority",
    flagColumns: ["isOperationalState", "isOfflineState"],
  },
};

export function getDeveloperDocsLookupSpec(
  modelType: DatabaseBaseModelType,
): DeveloperDocsLookupSpec {
  const model: DatabaseBaseModel = new modelType();
  const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
  const declared: Partial<DeveloperDocsLookupSpec> =
    DEVELOPER_DOCS_LOOKUP_SPECS[model.tableName || ""] || {};
  const nameColumn: string | null = getNameColumn(modelType);

  return {
    sortColumn: declared.sortColumn || nameColumn || "createdAt",
    sortOrder: declared.sortOrder || "ASC",
    flagColumns: (declared.flagColumns || []).filter(
      (column: string): boolean => {
        return Boolean(columns[column]);
      },
    ),
  };
}

// How many records a page looks at to fill its examples.
export const DEVELOPER_DOCS_SAMPLE_SIZE: number = 10;

/*
 * One request a page makes for its examples: the first records of a table,
 * or (with ids) the records a resource points at, to name them.
 */
export interface DeveloperDocsLookup {
  modelType: DatabaseBaseModelType;
  tableName: string;
  ids?: Array<string> | undefined;
  limit: number;
  // Never more than the id, the name and the flags.
  select: Dictionary<boolean>;
  sort: Dictionary<"ASC" | "DESC">;
}

export function getDeveloperDocsLookup(
  modelType: DatabaseBaseModelType,
  ids?: Array<string> | undefined,
): DeveloperDocsLookup {
  const spec: DeveloperDocsLookupSpec = getDeveloperDocsLookupSpec(modelType);
  const nameColumn: string | null = getNameColumn(modelType);
  const select: Dictionary<boolean> = { _id: true };

  if (nameColumn) {
    select[nameColumn] = true;
  }

  for (const flag of spec.flagColumns) {
    select[flag] = true;
  }

  const uniqueIds: Array<string> | undefined = ids
    ? Array.from(new Set<string>(ids)).sort()
    : undefined;

  return {
    modelType,
    tableName: new modelType().tableName || "",
    ids: uniqueIds,
    limit: uniqueIds ? uniqueIds.length : DEVELOPER_DOCS_SAMPLE_SIZE,
    select,
    sort: { [spec.sortColumn]: spec.sortOrder },
  };
}

// The same lookups once each: a table asked for twice is fetched once.
export function dedupeDeveloperDocsLookups(
  lookups: Array<DeveloperDocsLookup>,
): Array<DeveloperDocsLookup> {
  const seen: Set<string> = new Set<string>();

  return lookups.filter((lookup: DeveloperDocsLookup): boolean => {
    const key: string = `${lookup.tableName}:${(lookup.ids || []).join(",")}`;

    if (seen.has(key) || (lookup.ids && lookup.ids.length === 0)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

// A record from a lookup, as the examples use it.
export function toDeveloperDocsLiveRecord(data: {
  modelType: DatabaseBaseModelType;
  // The record's API JSON (BaseModel.toJSON).
  json: Dictionary<unknown>;
}): DeveloperDocsLiveRecord | null {
  const id: unknown = data.json["_id"];

  if (typeof id !== "string" || !id) {
    return null;
  }

  const nameColumn: string | null = getNameColumn(data.modelType);
  const name: unknown = nameColumn ? data.json[nameColumn] : undefined;
  const flags: Dictionary<boolean> = {};

  for (const flag of getDeveloperDocsLookupSpec(data.modelType).flagColumns) {
    flags[flag] = data.json[flag] === true;
  }

  return {
    id,
    name: typeof name === "string" && name.trim() ? name.trim() : null,
    flags,
  };
}

/*
 * Adds what a lookup found: the records of a sample, and the names of every
 * record either kind of lookup found.
 */
export function addDeveloperDocsLookupResult(
  live: DeveloperDocsLiveData,
  lookup: DeveloperDocsLookup,
  records: Array<DeveloperDocsLiveRecord>,
): DeveloperDocsLiveData {
  const namesById: Dictionary<string> = { ...live.namesById };

  for (const record of records) {
    if (record.name) {
      namesById[record.id] = record.name;
    }
  }

  return {
    ...live,
    records: lookup.ids
      ? live.records
      : { ...live.records, [lookup.tableName]: records },
    namesById,
  };
}

// Which of a table's records an example uses.
export interface DeveloperDocsLivePick {
  // One with this flag set ("isResolvedState").
  flag?: string | undefined;
  // One with none of these set: "Degraded" is neither operational nor offline.
  withoutFlags?: Array<string> | undefined;
  // Not this record (another severity than the incident has now).
  notId?: string | undefined;
  // The n-th of the records left, counting from 0.
  index?: number | undefined;
}

/*
 * The record an example uses, or null when the page could not look the
 * table up or the project has none that fit.
 */
export function pickDeveloperDocsLiveRecord(
  live: DeveloperDocsLiveData,
  tableName: string,
  pick?: DeveloperDocsLivePick | undefined,
): DeveloperDocsLiveRecord | null {
  const records: Array<DeveloperDocsLiveRecord> =
    live.records[tableName] || [];

  const candidates: Array<DeveloperDocsLiveRecord> = records.filter(
    (record: DeveloperDocsLiveRecord): boolean => {
      if (pick?.flag && !record.flags[pick.flag]) {
        return false;
      }

      if (
        pick?.withoutFlags &&
        pick.withoutFlags.some((flag: string): boolean => {
          return Boolean(record.flags[flag]);
        })
      ) {
        return false;
      }

      return !(pick?.notId && record.id === pick.notId);
    },
  );

  const index: number = Math.min(
    pick?.index || 0,
    Math.max(candidates.length - 1, 0),
  );

  return candidates[index] || null;
}

// Whether the page looked a table up (whatever it found).
export function hasDeveloperDocsLiveTable(
  live: DeveloperDocsLiveData,
  tableName: string,
): boolean {
  return Boolean(live.records[tableName]);
}
