import {
  DataBiSource,
  readDataBiSource,
} from "../../../../Types/DataObservability/DataBiLineage";
import { JSONObject } from "../../../../Types/JSON";
import { BiTableRef } from "./BiTables";
import {
  PowerBiDataflowDefinition,
  readDataflowDefinitions,
} from "./PowerBiDataflows";
import {
  PowerBiDataflowRead,
  PowerBiDatasetRead,
  PowerBiItem,
  PowerBiWorkspaceRead,
} from "./PowerBiScan";
import { MAX_WORKSPACES_PER_SCAN, PowerBiPendingScan } from "./PowerBiScanner";
import { PowerQueryDataflowEntity } from "./PowerQuery";

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
 * what it was. One whose scan failed is scanned again next time.
 *
 * A scan still running when the read stopped waiting is kept by its id
 * (#9697), and the next read picks it up rather than scanning its
 * workspaces again (PowerBiScanner) - as long as Power BI keeps its result,
 * 24 hours from its start; one older is not asked about, and its
 * workspaces are scanned anew. A workspace a kept scan was to give that
 * changed again since is scanned anew, so no change slips by: the next
 * read's list of changes reaches back to before the scan started. A
 * workspace has one newest scan, and what it says - a result, a failure, a
 * scan still running - is what the next read goes on from.
 *
 * It keeps the definitions of the dataflows its datasets read too, and the
 * exports of the last hour (PowerBiDataflows, #9551), so a dataflow is
 * exported again only when it changes, within Power BI's hourly limit.
 *
 * Kept as JSON on the tool (DataBiConnection.readState) and read back
 * strictly: a state of another version, or that does not fit, is no state,
 * and the read scans whole. One past MAX_POWER_BI_READ_STATE_LENGTH lets
 * its dataflows' definitions go first, then is not kept at all: such a
 * tenant is scanned whole each time, as before.
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

/*
 * Power BI keeps a scan's result for 24 hours. A kept scan started longer
 * ago than this is not asked about, so its result is never read as it goes:
 * an hour is kept to spare for the read's own wait.
 */
export const MAX_POWER_BI_PICK_UP_AGE_IN_MS: number = 23 * 60 * 60 * 1000;

// The most kept scans: as many as Power BI starts in an hour (500 getInfo calls).
export const MAX_POWER_BI_PENDING_SCANS: number = 500;

// A scan's id, as Power BI gives it (a GUID): anything else is no id kept.
const SCAN_ID: RegExp = /^[0-9a-z-]{1,100}$/i;

export interface PowerBiReadState {
  version: number;
  // When the read whose listing this holds began (ISO).
  scannedFrom: string;
  // When the whole tenant was last listed and scanned (ISO).
  fullScanAt: string;
  // Workspaces that changed but could not be scanned: the next read scans them.
  pendingWorkspaceIds: Array<string>;
  // Scans still running when the read stopped waiting: the next read picks them up (#9697).
  pendingScans: Array<PowerBiPendingScan>;
  // Every workspace as its last scan read it, in the order they are listed.
  workspaces: Array<PowerBiWorkspaceRead>;
  // The dataflows' definitions read, by id (PowerBiDataflows, #9551).
  dataflows: Map<string, PowerBiDataflowDefinition>;
  // When each dataflow export of the last hour was asked for (ISO): Power BI allows 200 an hour.
  dataflowExports: Array<string>;
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
 * The kept scans the next read picks up: those Power BI still keeps the
 * result of; the workspaces of one started too long ago are scanned anew.
 */
export function getPowerBiPickUps(data: {
  state: PowerBiReadState | null;
  now: Date;
}): {
  pickUp: Array<PowerBiPendingScan>;
  expiredWorkspaceIds: Array<string>;
} {
  const pickUp: Array<PowerBiPendingScan> = [];
  const expired: Set<string> = new Set();

  for (const scan of data.state?.pendingScans || []) {
    if (
      data.now.getTime() - new Date(scan.startedAt).getTime() <
      MAX_POWER_BI_PICK_UP_AGE_IN_MS
    ) {
      pickUp.push(scan);
      continue;
    }

    for (const id of scan.workspaceIds) {
      expired.add(id);
    }
  }

  return { pickUp, expiredWorkspaceIds: Array.from(expired) };
}

/*
 * One of a read's scans, as the workspaces after it are worked out from:
 * the workspaces it was to give, and what its result holds, when it worked
 * - a workspace it was to give and does not hold is gone - or the scan
 * itself, when it was still running. Neither: it failed or never started.
 */
export interface PowerBiScanMerge {
  workspaceIds: Array<string>;
  read?: Array<PowerBiWorkspaceRead> | undefined;
  pending?: PowerBiPendingScan | undefined;
}

/*
 * The workspaces after a read's scans, which are in the order they started
 * (PowerBiScanner): of two that name a workspace, the later is the newer.
 * A workspace takes what the newest scan that worked read of it - gone,
 * when that scan did not return it (deleted, or no longer the tenant's) -
 * and keeps what it was when none worked. A whole scan keeps the
 * workspaces it listed, in its order; one of what changed keeps every
 * workspace kept, with those its scans read replaced, and adds those new
 * since. What the newest scan of a workspace left says what the next read
 * does with it: scanned anew when that scan failed, its scan picked up
 * when it was still running.
 */
export function mergePowerBiWorkspaces(data: {
  kept: Array<PowerBiWorkspaceRead>;
  isFull: boolean;
  // The workspaces the read listed: every one of a whole scan's, in Power BI's order.
  listedIds: Array<string>;
  scans: Array<PowerBiScanMerge>;
}): {
  workspaces: Array<PowerBiWorkspaceRead>;
  pendingWorkspaceIds: Array<string>;
  pendingScans: Array<PowerBiPendingScan>;
} {
  const keptById: Map<string, PowerBiWorkspaceRead> = new Map(
    data.kept.map(
      (workspace: PowerBiWorkspaceRead): [string, PowerBiWorkspaceRead] => {
        return [workspace.id, workspace];
      },
    ),
  );
  // Each workspace's newest scan, and what the newest scan that worked read of it (null: gone).
  const newest: Map<string, PowerBiScanMerge> = new Map();
  const read: Map<string, PowerBiWorkspaceRead | null> = new Map();

  for (const scan of data.scans) {
    const returned: Map<string, PowerBiWorkspaceRead> | null = scan.read
      ? new Map(
          scan.read.map(
            (
              workspace: PowerBiWorkspaceRead,
            ): [string, PowerBiWorkspaceRead] => {
              return [workspace.id, workspace];
            },
          ),
        )
      : null;

    for (const id of scan.workspaceIds) {
      newest.set(id, scan);

      if (returned) {
        read.set(id, returned.get(id) || null);
      }
    }
  }

  // A workspace as this read leaves it: read, kept while no scan of it worked, or gone.
  const after: (id: string) => PowerBiWorkspaceRead | undefined = (
    id: string,
  ): PowerBiWorkspaceRead | undefined => {
    return read.has(id) ? read.get(id) || undefined : keptById.get(id);
  };
  const workspaces: Array<PowerBiWorkspaceRead> = [];

  if (data.isFull) {
    for (const id of new Set(data.listedIds)) {
      const workspace: PowerBiWorkspaceRead | undefined = after(id);

      if (workspace) {
        workspaces.push(workspace);
      }
    }
  } else {
    for (const workspace of data.kept) {
      const kept: PowerBiWorkspaceRead | undefined = after(workspace.id);

      if (kept) {
        workspaces.push(kept);
      }
    }

    // Workspaces new since the last read, in the order their scans name them.
    const added: Set<string> = new Set();

    for (const scan of data.scans) {
      for (const id of scan.workspaceIds) {
        const workspace: PowerBiWorkspaceRead | null | undefined = read.get(id);

        if (!keptById.has(id) && !added.has(id) && workspace) {
          added.add(id);
          workspaces.push(workspace);
        }
      }
    }
  }

  const pendingWorkspaceIds: Set<string> = new Set();
  const pendingScans: Array<PowerBiPendingScan> = [];

  for (const scan of data.scans) {
    const own: Array<string> = Array.from(new Set(scan.workspaceIds)).filter(
      (id: string): boolean => {
        return newest.get(id) === scan;
      },
    );

    if (scan.pending && own.length > 0) {
      pendingScans.push({ ...scan.pending, workspaceIds: own });
    } else if (!scan.read && !scan.pending) {
      for (const id of own) {
        pendingWorkspaceIds.add(id);
      }
    }
  }

  return {
    workspaces,
    pendingWorkspaceIds: Array.from(pendingWorkspaceIds),
    pendingScans,
  };
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
    dataflowEntities: readArray(dataset["dataflowEntities"])
      .map(readDataflowEntity)
      .filter(isPresent),
  };
}

function readDataflowEntity(value: unknown): PowerQueryDataflowEntity | null {
  const entity: Record<string, unknown> | null = readObject(value);
  const name: string | null = readText(entity?.["entity"]);

  if (!entity || !name) {
    return null;
  }

  return {
    workspaceId: readText(entity["workspaceId"]),
    workspaceName: readText(entity["workspaceName"]),
    dataflowId: readText(entity["dataflowId"]),
    dataflowName: readText(entity["dataflowName"]),
    entity: name,
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

// A kept scan: its id as Power BI gave it, the workspaces it is to give, and when it started.
function readPendingScan(value: unknown): PowerBiPendingScan | null {
  const scan: Record<string, unknown> | null = readObject(value);
  const scanId: string | null = readText(scan?.["scanId"]);
  const startedAt: string | null = readTime(scan?.["startedAt"]);
  const workspaceIds: Array<string> = Array.from(
    new Set(readIds(scan?.["workspaceIds"])),
  ).slice(0, MAX_WORKSPACES_PER_SCAN);

  if (!scanId || !SCAN_ID.test(scanId) || !startedAt || !workspaceIds.length) {
    return null;
  }

  return { scanId, workspaceIds, startedAt };
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
    pendingScans: readArray(state["pendingScans"])
      .map(readPendingScan)
      .filter(isPresent)
      .slice(0, MAX_POWER_BI_PENDING_SCANS),
    workspaces: readArray(state["workspaces"])
      .map(readWorkspace)
      .filter(isPresent),
    dataflows: readDataflowDefinitions(state["dataflows"]),
    dataflowExports: readArray(state["dataflowExports"])
      .map(readTime)
      .filter(isPresent),
  };
}

/*
 * The state as its column keeps it: null when it is too big to keep. Its
 * dataflows' definitions alone are let go first: they are read again,
 * within Power BI's limit, while the workspaces' scans are kept.
 */
export function writePowerBiReadState(
  state: PowerBiReadState,
): JSONObject | null {
  const asJson: (
    dataflows: Map<string, PowerBiDataflowDefinition>,
  ) => string = (dataflows: Map<string, PowerBiDataflowDefinition>): string => {
    // As JSON holds it: each date as its ISO text, the definitions by id.
    return JSON.stringify({
      ...state,
      dataflows: Object.fromEntries(dataflows),
    });
  };
  let text: string = asJson(state.dataflows);

  if (text.length > MAX_POWER_BI_READ_STATE_LENGTH) {
    text = asJson(new Map());
  }

  return text.length <= MAX_POWER_BI_READ_STATE_LENGTH
    ? (JSON.parse(text) as JSONObject)
    : null;
}
