import {
  DataBiSource,
  readDataBiSource,
} from "../../../../Types/DataObservability/DataBiLineage";
import { JSONObject } from "../../../../Types/JSON";
import { BiTableRef } from "./BiTables";
import {
  PowerBiDataflowRead,
  PowerBiDatasetRead,
  PowerBiItem,
  PowerBiWorkspaceRead,
} from "./PowerBiScan";

/*
 * WHAT A POWER BI READ KEEPS SO THE NEXT ONE SCANS ONLY WHAT CHANGED (#9552).
 *
 * A full scan of a big tenant every hour spent the scanner's limits and the
 * hourly job's time on workspaces that had not changed. So each read keeps
 * every workspace as its scan read it (PowerBiWorkspaceRead), and the next:
 *
 *  - asks Power BI only for the workspaces changed since a half hour before
 *    the last read began (Microsoft's guide sets modifiedSince to the start
 *    of the last scan; a change takes up to 30 minutes to be noted, so a
 *    change just after that start would otherwise slip between two reads),
 *    and Power BI takes a modifiedSince from 30 minutes to 30 days back;
 *  - scans those, and the workspaces a read before could not scan;
 *  - keeps every other workspace as it was.
 *
 * Once a day the hourly read scans the whole tenant again, which also drops
 * the workspaces that are gone. A read someone asked for (Read Now) scans
 * only what changed, so they are not kept waiting, unless there is nothing
 * kept to start from. A workspace whose scan failed or did not finish keeps
 * what it was, and is scanned again next time.
 *
 * Kept as JSON on the tool (DataBiConnection.readState) and read back
 * strictly: a state of another version, or that does not fit, is no state,
 * and the read scans whole. One past MAX_POWER_BI_READ_STATE_LENGTH is not
 * kept: such a tenant is scanned whole each time, as before.
 */

export const POWER_BI_READ_STATE_VERSION: number = 1;

// How often the hourly read scans the whole tenant, which drops what is gone.
export const POWER_BI_FULL_SCAN_EVERY_IN_MS: number = 24 * 60 * 60 * 1000;

// How long Power BI takes to note a workspace's change: the least a modifiedSince is back.
export const POWER_BI_CHANGE_DELAY_IN_MS: number = 30 * 60 * 1000;

// The furthest back Power BI lists changed workspaces is 30 days: a day is kept to spare.
export const POWER_BI_MAX_CHANGES_AGE_IN_MS: number = 29 * 24 * 60 * 60 * 1000;

// The most characters of JSON kept: a tenant past it is scanned whole each time.
export const MAX_POWER_BI_READ_STATE_LENGTH: number = 8_000_000;

export interface PowerBiReadState {
  version: number;
  // When the read whose listing this holds began (ISO).
  scannedFrom: string;
  // When the whole tenant was last listed and scanned (ISO).
  fullScanAt: string;
  // Workspaces that changed but could not be scanned: the next read scans them.
  pendingWorkspaceIds: Array<string>;
  // Every workspace as its last scan read it, in the order they are listed.
  workspaces: Array<PowerBiWorkspaceRead>;
}

export interface PowerBiScanPlan {
  isFull: boolean;
  // The workspaces changed since then are scanned; null lists every one.
  modifiedSince: Date | null;
}

/*
 * Whether this read scans the whole tenant or only what changed, and since
 * when: whole with nothing kept, for the hourly read once a day, and when
 * the last read is older than Power BI lists changes for.
 */
export function planPowerBiScan(data: {
  state: PowerBiReadState | null;
  now: Date;
  isScheduled: boolean;
}): PowerBiScanPlan {
  const state: PowerBiReadState | null = data.state;

  if (!state) {
    return { isFull: true, modifiedSince: null };
  }

  const now: number = data.now.getTime();

  if (
    data.isScheduled &&
    now - new Date(state.fullScanAt).getTime() >= POWER_BI_FULL_SCAN_EVERY_IN_MS
  ) {
    return { isFull: true, modifiedSince: null };
  }

  const since: number = Math.min(
    new Date(state.scannedFrom).getTime() - POWER_BI_CHANGE_DELAY_IN_MS,
    now - POWER_BI_CHANGE_DELAY_IN_MS,
  );

  if (now - since > POWER_BI_MAX_CHANGES_AGE_IN_MS) {
    return { isFull: true, modifiedSince: null };
  }

  return { isFull: false, modifiedSince: new Date(since) };
}

/*
 * The workspaces after a read's scans. A whole scan keeps the workspaces it
 * listed, in its order; one that changed keeps every workspace kept, with
 * those it scanned replaced. Either way a workspace whose scan failed or
 * did not finish keeps what it was and is scanned again next time, and one
 * a scan that worked did not return - deleted, or no longer the tenant's -
 * is gone.
 */
export function mergePowerBiWorkspaces(data: {
  kept: Array<PowerBiWorkspaceRead>;
  isFull: boolean;
  // Every workspace the read set out to scan, in order: all of a whole scan's.
  requestedIds: Array<string>;
  // The workspaces of the scans that worked, and what those scans returned.
  scannedIds: Array<string>;
  scanned: Array<PowerBiWorkspaceRead>;
}): {
  workspaces: Array<PowerBiWorkspaceRead>;
  pendingWorkspaceIds: Array<string>;
} {
  const keptById: Map<string, PowerBiWorkspaceRead> = new Map(
    data.kept.map(
      (workspace: PowerBiWorkspaceRead): [string, PowerBiWorkspaceRead] => {
        return [workspace.id, workspace];
      },
    ),
  );
  const scannedById: Map<string, PowerBiWorkspaceRead> = new Map(
    data.scanned.map(
      (workspace: PowerBiWorkspaceRead): [string, PowerBiWorkspaceRead] => {
        return [workspace.id, workspace];
      },
    ),
  );
  const scannedIds: Set<string> = new Set(data.scannedIds);
  const pendingWorkspaceIds: Array<string> = data.requestedIds.filter(
    (id: string): boolean => {
      return !scannedIds.has(id);
    },
  );
  const pending: Set<string> = new Set(pendingWorkspaceIds);
  // A workspace as this read leaves it: scanned, kept while unscanned, or gone.
  const outcome: (id: string) => PowerBiWorkspaceRead | undefined = (
    id: string,
  ): PowerBiWorkspaceRead | undefined => {
    return (
      scannedById.get(id) || (pending.has(id) ? keptById.get(id) : undefined)
    );
  };

  if (data.isFull) {
    return {
      workspaces: Array.from(new Set(data.requestedIds))
        .map(outcome)
        .filter(
          (
            workspace: PowerBiWorkspaceRead | undefined,
          ): workspace is PowerBiWorkspaceRead => {
            return workspace !== undefined;
          },
        ),
      pendingWorkspaceIds,
    };
  }

  const requested: Set<string> = new Set(data.requestedIds);
  const workspaces: Array<PowerBiWorkspaceRead> = [];

  for (const workspace of data.kept) {
    const after: PowerBiWorkspaceRead | undefined = requested.has(workspace.id)
      ? outcome(workspace.id)
      : workspace;

    if (after) {
      workspaces.push(after);
    }
  }

  // Workspaces new since the last read, in the order Power BI listed them.
  for (const id of new Set(data.requestedIds)) {
    if (!keptById.has(id) && scannedById.has(id)) {
      workspaces.push(scannedById.get(id)!);
    }
  }

  return { workspaces, pendingWorkspaceIds };
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

function readText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readTime(value: unknown): string | null {
  const text: string | null = readText(value);

  return text && !Number.isNaN(new Date(text).getTime()) ? text : null;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function readTable(value: unknown): BiTableRef | null {
  const table: Record<string, unknown> | null = readObject(value);
  const name: string | null = readText(table?.["table"]);

  if (!table || !name) {
    return null;
  }

  const ref: BiTableRef = {
    database: readText(table["database"]),
    schema: readText(table["schema"]),
    table: name,
    engine: readText(table["engine"]),
    host: readText(table["host"]),
  };

  if (table["isDatabaseExact"] === true) {
    ref.isDatabaseExact = true;
  }

  if (table["isEntitySet"] === true) {
    ref.isEntitySet = true;
  }

  return ref;
}

function readSources(value: unknown): Array<DataBiSource> {
  return readArray(value).map(readDataBiSource).filter(isPresent);
}

function readIds(value: unknown): Array<string> {
  return readArray(value)
    .map(readText)
    .filter((id: string | null): id is string => {
      return Boolean(id);
    });
}

function readItem(value: unknown): PowerBiItem | null {
  const item: Record<string, unknown> | null = readObject(value);
  const externalId: string | null = readText(item?.["externalId"]);
  const changedAt: string | null = readTime(item?.["changedAt"]);

  if (!item || !externalId) {
    return null;
  }

  return {
    externalId,
    name: readText(item["name"]) || externalId,
    url: readText(item["url"]) || "",
    folder: readText(item["folder"]),
    owner: readText(item["owner"]),
    changedAt: changedAt ? new Date(changedAt) : null,
    datasetIds: readIds(item["datasetIds"]),
  };
}

function readDataset(value: unknown): PowerBiDatasetRead | null {
  const dataset: Record<string, unknown> | null = readObject(value);
  const datasetId: string | null = readText(dataset?.["datasetId"]);

  if (!dataset || !datasetId) {
    return null;
  }

  return {
    datasetId,
    name: readText(dataset["name"]) || datasetId,
    tables: readArray(dataset["tables"]).map(readTable).filter(isPresent),
    sources: readSources(dataset["sources"]),
    hasTables: dataset["hasTables"] === true,
    hasQueries: dataset["hasQueries"] === true,
    schemaError: readText(dataset["schemaError"]),
    upstreamDatasetIds: readIds(dataset["upstreamDatasetIds"]),
    dataflowIds: readIds(dataset["dataflowIds"]),
  };
}

function readDataflow(value: unknown): PowerBiDataflowRead | null {
  const dataflow: Record<string, unknown> | null = readObject(value);
  const id: string | null = readText(dataflow?.["id"]);

  if (!dataflow || !id) {
    return null;
  }

  return {
    id,
    name: readText(dataflow["name"]) || id,
    modifiedAt: readTime(dataflow["modifiedAt"]),
    sources: readSources(dataflow["sources"]),
  };
}

function readWorkspace(value: unknown): PowerBiWorkspaceRead | null {
  const workspace: Record<string, unknown> | null = readObject(value);
  const id: string | null = readText(workspace?.["id"]);

  if (!workspace || !id) {
    return null;
  }

  return {
    id,
    name: readText(workspace["name"]),
    onCapacity: workspace["onCapacity"] === true,
    items: readArray(workspace["items"]).map(readItem).filter(isPresent),
    datasets: readArray(workspace["datasets"])
      .map(readDataset)
      .filter(isPresent),
    dataflows: readArray(workspace["dataflows"])
      .map(readDataflow)
      .filter(isPresent),
  };
}

// What a read kept, read back: null for none, another version, or a state that does not fit.
export function readPowerBiReadState(value: unknown): PowerBiReadState | null {
  const state: Record<string, unknown> | null = readObject(value);
  const scannedFrom: string | null = readTime(state?.["scannedFrom"]);
  const fullScanAt: string | null = readTime(state?.["fullScanAt"]);

  if (
    !state ||
    state["version"] !== POWER_BI_READ_STATE_VERSION ||
    !scannedFrom ||
    !fullScanAt ||
    !Array.isArray(state["workspaces"])
  ) {
    return null;
  }

  return {
    version: POWER_BI_READ_STATE_VERSION,
    scannedFrom,
    fullScanAt,
    pendingWorkspaceIds: readIds(state["pendingWorkspaceIds"]),
    workspaces: readArray(state["workspaces"])
      .map(readWorkspace)
      .filter(isPresent),
  };
}

// The state as its column keeps it: null when it is too big to keep.
export function writePowerBiReadState(
  state: PowerBiReadState,
): JSONObject | null {
  // As JSON holds it: each date as its ISO text.
  const text: string = JSON.stringify(state);

  return text.length <= MAX_POWER_BI_READ_STATE_LENGTH
    ? (JSON.parse(text) as JSONObject)
    : null;
}
