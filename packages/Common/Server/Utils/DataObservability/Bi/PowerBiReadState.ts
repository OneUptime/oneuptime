import {
  DataBiSource,
  readDataBiSource,
} from "../../../../Types/DataObservability/DataBiLineage";
import { JSONObject } from "../../../../Types/JSON";
import { BiTableRef } from "./BiTables";
import {
  findDataflowId,
  PowerBiDataflowDefinition,
  PowerBiDataflowIndex,
  readDataflowDefinitions,
} from "./PowerBiDataflows";
import {
  getShownPowerBiItems,
  indexWorkspaceDataflows,
  MAX_ITEMS_PER_WORKSPACE,
  MAX_UPSTREAM_DEPTH,
  PowerBiDataflowRead,
  PowerBiDatasetRead,
  PowerBiItem,
  PowerBiWorkspaceRead,
  PowerBiWorkspaceTrim,
} from "./PowerBiScan";
import { MAX_WORKSPACES_PER_SCAN, PowerBiPendingScan } from "./PowerBiScanner";
import { PowerQueryDataflowEntity } from "./PowerQuery";

/*
 * WHAT A POWER BI READ KEEPS SO THE NEXT ONE SCANS ONLY WHAT CHANGED (#9552).
 *
 * A full scan of a big tenant every hour spent the scanner's limits and the
 * hourly job's time on workspaces that had not changed. So each read keeps
 * every workspace as its scan read it (PowerBiWorkspaceRead), with when
 * that scan started, and the next:
 *
 *  - asks Power BI only for the workspaces changed since a half hour before
 *    the last read began (Microsoft's guide sets modifiedSince to the start
 *    of the last scan; a change takes up to 30 minutes to be noted, so a
 *    change just after that start would otherwise slip between two reads),
 *    and Power BI takes a modifiedSince from 30 minutes to 30 days back;
 *  - scans those, and the workspaces a read before could not scan;
 *  - keeps every other workspace as it was.
 *
 * Once a day the hourly read lists the whole tenant, which drops the
 * workspaces that are gone (#9901). It asks for the changes too, one more
 * listing of Power BI's 30 an hour, and scans only the workspaces that
 * changed or are new, those whose datasets the last scan listed without
 * their tables or queries (the tenant settings may have been turned on
 * since), and the seventh of the rest whose scans are oldest, so each is
 * scanned again within a week and those scans are spread over its days.
 * Every other workspace keeps its last scan. Before #9901 that read scanned
 * every workspace again. A read someone asked for (Read Now) scans only
 * what changed, so they are not kept waiting, unless there is nothing kept
 * to start from. A workspace whose scan failed or did not finish keeps what
 * it was. One whose scan failed is scanned again next time, first.
 *
 * A scan still running when the read stopped waiting is kept by its id
 * (#9697), and the next read picks it up rather than scanning its
 * workspaces again (PowerBiScanner) - as long as Power BI keeps its result,
 * 24 hours from its start; one older is not asked about, and its
 * workspaces are scanned anew. A workspace a kept scan was to give that
 * changed again since is scanned anew, so no change slips by: the next
 * read's list of changes reaches back to before the scan started, the
 * daily read's too. A workspace has one newest scan, and what it says - a
 * result, a failure, a scan still running - is what the next read goes on
 * from.
 *
 * It keeps the definitions of the dataflows its datasets read too, and the
 * exports of the last hour (PowerBiDataflows, #9551), so a dataflow is
 * exported again only when it changes, within Power BI's hourly limit.
 *
 * Kept as JSON on the tool (DataBiConnection.readState), at most
 * MAX_POWER_BI_READ_STATE_LENGTH characters, and read back strictly: a
 * state of another version, or that does not fit, is no state, and the
 * read scans whole. A tenant past that length lets go of what shows least,
 * a step at a time, until what is left fits (writePowerBiReadState, #9901):
 *
 *  1. its dataflows' definitions, which are read again within Power BI's
 *     limit;
 *  2. the reports and datasets of the workspaces that show none of the
 *     2,000 reports and dashboards a read shows, nor hold a dataset they
 *     chart or a dataflow those read: each is kept trimmed, with its
 *     dataflows, how many reports it had and its datasets' ids, and is
 *     scanned again only when it changes, when its scan is a week old, or
 *     when it is needed again - its reports come among those shown, or a
 *     shown report charts one of its datasets;
 *  3. what is left of those workspaces but their ids and scan times;
 *  4. those workspaces altogether: the state no longer holds every
 *     workspace, so the next read lists the tenant whole and scans every
 *     workspace it does not keep, as reads did before #9552, while the
 *     shown dashboards' workspaces stay as they were;
 *  5. every workspace: what is kept is the scans still running, so the
 *     next read still picks them up, and the workspaces still to scan.
 *
 * The scans still running are always kept: at most 500, each of at most
 * 100 workspaces, about 2 MB at most.
 */

// Version 2 (#9901) adds each workspace's scan time, trimmed workspaces and hasEveryWorkspace.
export const POWER_BI_READ_STATE_VERSION: number = 2;

// The versions read back: a state of version 1 holds every workspace whole.
const READ_STATE_VERSIONS: ReadonlyArray<number> = [1, 2];

// How often the hourly read lists the whole tenant, which drops what is gone.
export const POWER_BI_FULL_SCAN_EVERY_IN_MS: number = 24 * 60 * 60 * 1000;

// How long Power BI takes to note a workspace's change: the least a modifiedSince is back.
export const POWER_BI_CHANGE_DELAY_IN_MS: number = 30 * 60 * 1000;

// The furthest back Power BI lists changed workspaces is 30 days: a day is kept to spare.
export const POWER_BI_MAX_CHANGES_AGE_IN_MS: number = 29 * 24 * 60 * 60 * 1000;

/*
 * The oldest a workspace's scan is let get (#9901): Power BI's list of
 * changes may miss one, such as a dataset that lists its tables once it
 * is refreshed after the tenant settings were turned on.
 */
export const POWER_BI_RESCAN_AGE_IN_MS: number = 7 * 24 * 60 * 60 * 1000;

// The daily read scans the oldest of this many parts of the unchanged workspaces: a seventh.
export const POWER_BI_RESCAN_PARTS: number = 7;

// The most characters of JSON kept: a tenant past it lets go of what shows least.
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
  // When the whole tenant was last listed, which drops what is gone (ISO).
  fullScanAt: string;
  // Workspaces that changed but could not be scanned: the next read scans them, first.
  pendingWorkspaceIds: Array<string>;
  // Scans still running when the read stopped waiting: the next read picks them up (#9697).
  pendingScans: Array<PowerBiPendingScan>;
  /*
   * Every workspace as its last scan read it, in the order they are kept:
   * whole, or trimmed when the tenant was too big to keep whole (#9901).
   */
  workspaces: Array<PowerBiWorkspaceRead>;
  /*
   * Whether `workspaces` holds every workspace of the tenant, whole or
   * trimmed. False when the tenant was too big for even that (#9901): the
   * next read lists the tenant whole and scans each workspace it does not
   * keep.
   */
  hasEveryWorkspace: boolean;
  // The dataflows' definitions read, by id (PowerBiDataflows, #9551).
  dataflows: Map<string, PowerBiDataflowDefinition>;
  // When each dataflow export of the last hour was asked for (ISO): Power BI allows 200 an hour.
  dataflowExports: Array<string>;
}

export interface PowerBiScanPlan {
  /*
   * Whether the read lists the whole tenant, which drops what is gone:
   * with nothing kept, with a state that does not hold every workspace,
   * once a day for the hourly read, and when the last read is older than
   * Power BI lists changes for.
   */
  isFull: boolean;
  /*
   * Whether the read is the hourly read's daily one: it also scans again
   * the workspaces whose scans are oldest, and those whose datasets were
   * listed without their tables or queries (#9901).
   */
  isDaily: boolean;
  // The workspaces changed since then are scanned; null when every one is.
  modifiedSince: Date | null;
}

/*
 * Whether this read lists the whole tenant, and since when it scans what
 * changed. A whole read with a kept state asks for the changes too, and
 * scans only those and what it does not keep (#9901), unless the last read
 * is older than Power BI lists changes for.
 */
export function planPowerBiScan(data: {
  state: PowerBiReadState | null;
  now: Date;
  isScheduled: boolean;
}): PowerBiScanPlan {
  const state: PowerBiReadState | null = data.state;

  if (!state) {
    return { isFull: true, isDaily: false, modifiedSince: null };
  }

  const now: number = data.now.getTime();
  const since: number = Math.min(
    new Date(state.scannedFrom).getTime() - POWER_BI_CHANGE_DELAY_IN_MS,
    now - POWER_BI_CHANGE_DELAY_IN_MS,
  );
  const modifiedSince: Date | null =
    now - since > POWER_BI_MAX_CHANGES_AGE_IN_MS ? null : new Date(since);
  const isDaily: boolean =
    data.isScheduled &&
    now - new Date(state.fullScanAt).getTime() >=
      POWER_BI_FULL_SCAN_EVERY_IN_MS;

  return {
    isFull: isDaily || !modifiedSince || !state.hasEveryWorkspace,
    isDaily,
    modifiedSince,
  };
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

// When a kept workspace was scanned: one kept before #9901 was at the last whole read or since.
function scannedAtOf(
  workspace: PowerBiWorkspaceRead,
  state: PowerBiReadState,
): number {
  const at: number = Date.parse(workspace.scannedAt || state.fullScanAt);

  return Number.isNaN(at) ? 0 : at;
}

/*
 * A workspace whose datasets the scan listed without their tables, or
 * without the queries behind them, and with no reason why: the tenant
 * settings that return them were off, or the dataset was not refreshed
 * since they were turned on. The daily read scans it again until they
 * come (#9901). A dataset Power BI cannot describe says why (an Excel
 * workbook's), and is not asked about again.
 */
export function isPowerBiWorkspaceIncomplete(
  workspace: PowerBiWorkspaceRead,
): boolean {
  return workspace.datasets.some((dataset: PowerBiDatasetRead): boolean => {
    return !dataset.schemaError && (!dataset.hasTables || !dataset.hasQueries);
  });
}

/*
 * Of the workspaces a daily read would keep as they are, those it scans
 * again: every one whose scan is a week old or more, and at least the
 * seventh whose scans are oldest, so the week's scans are spread over its
 * days rather than all due on one.
 */
export function getAgedPowerBiWorkspaces(data: {
  workspaces: Array<PowerBiWorkspaceRead>;
  state: PowerBiReadState;
  now: Date;
}): Array<PowerBiWorkspaceRead> {
  const share: number = Math.ceil(
    data.workspaces.length / POWER_BI_RESCAN_PARTS,
  );

  // Oldest first; of two as old, the one kept first.
  return [...data.workspaces]
    .sort((a: PowerBiWorkspaceRead, b: PowerBiWorkspaceRead): number => {
      return scannedAtOf(a, data.state) - scannedAtOf(b, data.state);
    })
    .filter((workspace: PowerBiWorkspaceRead, index: number): boolean => {
      return (
        index < share ||
        data.now.getTime() - scannedAtOf(workspace, data.state) >=
          POWER_BI_RESCAN_AGE_IN_MS
      );
    });
}

/*
 * The workspaces a read scans anew, those an earlier read could not scan
 * first, so a tenant whose scans outlast the wait gets through every
 * workspace in turn.
 *
 * A read of what changed scans those, and those a read before could not
 * scan or whose kept scan is too old to pick up. A whole read scans, of
 * the workspaces Power BI lists (one it does not list is gone), those that
 * changed since `changedIds` was listed - every one when it was not - or
 * are new or not kept, and the daily one those its datasets want again and
 * the oldest (#9901). A workspace a scan picked up gives is not scanned
 * again unless it changed since; every other workspace keeps its last scan.
 */
export function getPowerBiWorkspacesToScan(data: {
  state: PowerBiReadState | null;
  plan: PowerBiScanPlan;
  // What Power BI listed: every workspace for a whole read, those changed for another.
  listedIds: Array<string>;
  // A whole read's workspaces changed since plan.modifiedSince; null when every one counts as changed.
  changedIds: Array<string> | null;
  pickUp: Array<PowerBiPendingScan>;
  expiredWorkspaceIds: Array<string>;
  now: Date;
}): Array<string> {
  const state: PowerBiReadState | null = data.state;
  const overdue: Array<string> = [
    ...(state?.pendingWorkspaceIds || []),
    ...data.expiredWorkspaceIds,
  ];

  if (!data.plan.isFull) {
    return Array.from(new Set([...overdue, ...data.listedIds]));
  }

  const listed: Set<string> = new Set(data.listedIds);
  const changed: Set<string> | null = data.changedIds
    ? new Set(data.changedIds)
    : null;
  const pickedUp: Set<string> = new Set(
    data.pickUp.flatMap((scan: PowerBiPendingScan): Array<string> => {
      return scan.workspaceIds;
    }),
  );
  const kept: Map<string, PowerBiWorkspaceRead> = new Map(
    (state?.workspaces || []).map(
      (workspace: PowerBiWorkspaceRead): [string, PowerBiWorkspaceRead] => {
        return [workspace.id, workspace];
      },
    ),
  );
  const toScan: Set<string> = new Set(
    overdue.filter((id: string): boolean => {
      return listed.has(id);
    }),
  );
  // The workspaces kept as they are, for the daily read to scan the oldest of.
  const unchanged: Array<PowerBiWorkspaceRead> = [];

  for (const id of listed) {
    const workspace: PowerBiWorkspaceRead | undefined = kept.get(id);

    if (toScan.has(id)) {
      continue;
    }

    if (!changed || changed.has(id)) {
      toScan.add(id);
    } else if (pickedUp.has(id)) {
      // The scan picked up gives it: it has not changed since that scan started.
      continue;
    } else if (!workspace) {
      toScan.add(id);
    } else if (data.plan.isDaily && isPowerBiWorkspaceIncomplete(workspace)) {
      toScan.add(id);
    } else {
      unchanged.push(workspace);
    }
  }

  if (data.plan.isDaily && state) {
    for (const workspace of getAgedPowerBiWorkspaces({
      workspaces: unchanged,
      state,
      now: data.now,
    })) {
      toScan.add(workspace.id);
    }
  }

  return Array.from(toScan);
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
 * and keeps what it was when none worked. Every workspace keeps its place,
 * and those new since come after them, in the order they were listed or
 * scanned: so the reports shown, the first 2,000, stay the same whatever
 * order Power BI lists the tenant in (#9901). A whole read keeps only the
 * workspaces it listed: one it does not list is gone. What the newest scan
 * of a workspace left says what the next read does with it: scanned anew
 * when that scan failed, its scan picked up when it was still running.
 */
export function mergePowerBiWorkspaces(data: {
  kept: Array<PowerBiWorkspaceRead>;
  isFull: boolean;
  // The workspaces the read listed: every one of a whole read's, in Power BI's order.
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

  // A whole read's list is every workspace there is: one it does not list is gone, its scan or not.
  const listed: Set<string> = new Set(data.listedIds);
  const isThere: (id: string) => boolean = (id: string): boolean => {
    return !data.isFull || listed.has(id);
  };
  const workspaces: Array<PowerBiWorkspaceRead> = [];
  const placed: Set<string> = new Set();
  // A workspace as this read leaves it: read, kept while no scan of it worked, or gone.
  const place: (id: string) => void = (id: string): void => {
    if (placed.has(id) || !isThere(id)) {
      return;
    }

    placed.add(id);

    const workspace: PowerBiWorkspaceRead | null | undefined = read.has(id)
      ? read.get(id)
      : keptById.get(id);

    if (workspace) {
      workspaces.push(workspace);
    }
  };

  for (const workspace of data.kept) {
    place(workspace.id);
  }

  // Those new since: a whole read's in the order it listed them, then those its scans read.
  for (const id of data.isFull ? data.listedIds : []) {
    place(id);
  }

  for (const scan of data.scans) {
    for (const id of scan.workspaceIds) {
      if (read.get(id)) {
        place(id);
      }
    }
  }

  const pendingWorkspaceIds: Set<string> = new Set();
  const pendingScans: Array<PowerBiPendingScan> = [];

  for (const scan of data.scans) {
    const own: Array<string> = Array.from(new Set(scan.workspaceIds)).filter(
      (id: string): boolean => {
        return newest.get(id) === scan && isThere(id);
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

/*
 * What the reports and dashboards a read shows need kept whole (#9901):
 * the workspaces whose own are among them, those holding the datasets they
 * chart and the datasets those are built on (as composePowerBiScan follows
 * them), and those holding the dataflows those datasets read. A trimmed
 * workspace among them is to be scanned again: what it held was let go.
 */
export function getPowerBiShownNeeds(
  workspaces: Array<PowerBiWorkspaceRead>,
  maxItems: number,
): { whole: Set<string>; rescan: Set<string> } {
  const whole: Set<string> = new Set();
  const rescan: Set<string> = new Set();
  let frontier: Array<string> = [];

  for (const shown of getShownPowerBiItems(workspaces, maxItems)) {
    if (shown.workspace.trimmed) {
      rescan.add(shown.workspace.id);
      continue;
    }

    whole.add(shown.workspace.id);
    frontier.push(
      ...shown.items.flatMap((item: PowerBiItem): Array<string> => {
        return item.datasetIds;
      }),
    );
  }

  // Which workspace holds each dataset: a whole one's own, else a trimmed one's by id.
  const holders: Map<
    string,
    { workspace: PowerBiWorkspaceRead; dataset?: PowerBiDatasetRead }
  > = new Map();

  for (const workspace of workspaces) {
    for (const id of workspace.trimmed?.datasetIds || []) {
      if (!holders.has(id)) {
        holders.set(id, { workspace });
      }
    }
  }

  for (const workspace of workspaces) {
    for (const dataset of workspace.datasets) {
      holders.set(dataset.datasetId.toLowerCase(), { workspace, dataset });
    }
  }

  const index: PowerBiDataflowIndex = indexWorkspaceDataflows(workspaces);
  const dataflowHolders: Map<string, string> = new Map(
    workspaces.flatMap(
      (workspace: PowerBiWorkspaceRead): Array<[string, string]> => {
        return workspace.dataflows.map(
          (dataflow: PowerBiDataflowRead): [string, string] => {
            return [dataflow.id, workspace.id];
          },
        );
      },
    ),
  );
  const visited: Set<string> = new Set();

  // The datasets charted, then those they are built on, as deep as composePowerBiScan follows.
  for (
    let depth: number = 0;
    depth <= MAX_UPSTREAM_DEPTH && frontier.length > 0;
    depth++
  ) {
    const next: Array<string> = [];

    for (const id of frontier) {
      const holder:
        | { workspace: PowerBiWorkspaceRead; dataset?: PowerBiDatasetRead }
        | undefined = holders.get(id);

      if (visited.has(id) || !holder) {
        continue;
      }

      visited.add(id);

      if (!holder.dataset) {
        rescan.add(holder.workspace.id);
        continue;
      }

      whole.add(holder.workspace.id);
      next.push(...holder.dataset.upstreamDatasetIds);

      // The workspaces of the dataflows it reads: their dataflows find its entities.
      for (const dataflowId of [
        ...holder.dataset.dataflowIds,
        ...holder.dataset.dataflowEntities
          .map((entity: PowerQueryDataflowEntity): string | null => {
            return findDataflowId(entity, index);
          })
          .filter((dataflowId: string | null): dataflowId is string => {
            return Boolean(dataflowId);
          }),
      ]) {
        const holderId: string | undefined = dataflowHolders.get(dataflowId);

        if (holderId) {
          whole.add(holderId);
        }
      }
    }

    frontier = next;
  }

  return { whole, rescan };
}

/*
 * A workspace that shows nothing, with what a later read needs of it: its
 * dataflows, which find the entities of datasets in other workspaces, how
 * many reports and dashboards it has, so they keep their place among those
 * shown, and its datasets' ids, so a shown report that charts one has it
 * scanned again (#9901). Bare, it keeps its id and scan time alone.
 */
export function trimPowerBiWorkspace(
  workspace: PowerBiWorkspaceRead,
  options: { isBare?: boolean | undefined } = {},
): PowerBiWorkspaceRead {
  const trim: PowerBiWorkspaceTrim = options.isBare
    ? { itemCount: 0, datasetIds: [] }
    : workspace.trimmed || {
        itemCount: workspace.items.length,
        datasetIds: Array.from(
          new Set(
            workspace.datasets.map((dataset: PowerBiDatasetRead): string => {
              return dataset.datasetId.toLowerCase();
            }),
          ),
        ),
      };

  return {
    id: workspace.id,
    name: options.isBare ? null : workspace.name,
    onCapacity: workspace.onCapacity,
    items: [],
    datasets: [],
    dataflows: options.isBare ? [] : workspace.dataflows,
    ...(workspace.scannedAt ? { scannedAt: workspace.scannedAt } : {}),
    trimmed: trim,
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

// What a trimmed workspace held (#9901); none for a whole one, or one that does not fit.
function readTrim(value: unknown): PowerBiWorkspaceTrim | null {
  const trim: Record<string, unknown> | null = readObject(value);
  const itemCount: unknown = trim?.["itemCount"];

  if (
    !trim ||
    typeof itemCount !== "number" ||
    !Number.isInteger(itemCount) ||
    itemCount < 0
  ) {
    return null;
  }

  return {
    // No more than a scan keeps of one workspace.
    itemCount: Math.min(itemCount, MAX_ITEMS_PER_WORKSPACE),
    datasetIds: Array.from(
      new Set(
        readIds(trim["datasetIds"]).map((id: string): string => {
          return id.toLowerCase();
        }),
      ),
    ),
  };
}

function readWorkspace(value: unknown): PowerBiWorkspaceRead | null {
  const workspace: Record<string, unknown> | null = readObject(value);
  const id: string | null = readText(workspace?.["id"]);

  if (!workspace || !id) {
    return null;
  }

  const scannedAt: string | null = readTime(workspace["scannedAt"]);
  const trimmed: PowerBiWorkspaceTrim | null = readTrim(workspace["trimmed"]);

  return {
    id,
    name: readText(workspace["name"]),
    onCapacity: workspace["onCapacity"] === true,
    // A trimmed workspace shows nothing until it is scanned again.
    items: trimmed
      ? []
      : readArray(workspace["items"]).map(readItem).filter(isPresent),
    datasets: trimmed
      ? []
      : readArray(workspace["datasets"]).map(readDataset).filter(isPresent),
    dataflows: readArray(workspace["dataflows"])
      .map(readDataflow)
      .filter(isPresent),
    ...(scannedAt ? { scannedAt } : {}),
    ...(trimmed ? { trimmed } : {}),
  };
}

// What a read kept, read back: null for none, another version, or a state that does not fit.
export function readPowerBiReadState(value: unknown): PowerBiReadState | null {
  const state: Record<string, unknown> | null = readObject(value);
  const scannedFrom: string | null = readTime(state?.["scannedFrom"]);
  const fullScanAt: string | null = readTime(state?.["fullScanAt"]);

  if (
    !state ||
    !READ_STATE_VERSIONS.includes(state["version"] as number) ||
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
    // Version 1 always held every workspace.
    hasEveryWorkspace: state["hasEveryWorkspace"] !== false,
    dataflows: readDataflowDefinitions(state["dataflows"]),
    dataflowExports: readArray(state["dataflowExports"])
      .map(readTime)
      .filter(isPresent),
  };
}

/*
 * The state as its column keeps it, at most MAX_POWER_BI_READ_STATE_LENGTH
 * characters of JSON (#9901): whole when it fits, else with what shows
 * least let go, a step at a time (see the top of this file). `maxItems` is
 * how many reports and dashboards a read shows: those, and what they need,
 * are let go last. A trimmed workspace those need is scanned again by the
 * next read, at any step.
 */
export function writePowerBiReadState(
  state: PowerBiReadState,
  maxItems: number,
): JSONObject | null {
  const needs: { whole: Set<string>; rescan: Set<string> } =
    getPowerBiShownNeeds(state.workspaces, maxItems);
  const pendingWorkspaceIds: Array<string> = Array.from(
    new Set([...state.pendingWorkspaceIds, ...needs.rescan]),
  );
  const asWritten: PowerBiReadState = {
    ...state,
    version: POWER_BI_READ_STATE_VERSION,
    pendingWorkspaceIds,
  };
  const withoutDefinitions: PowerBiReadState = {
    ...asWritten,
    dataflows: new Map(),
  };
  const trimmed: (isBare: boolean) => PowerBiReadState = (
    isBare: boolean,
  ): PowerBiReadState => {
    return {
      ...withoutDefinitions,
      workspaces: asWritten.workspaces.map(
        (workspace: PowerBiWorkspaceRead): PowerBiWorkspaceRead => {
          return needs.whole.has(workspace.id)
            ? workspace
            : trimPowerBiWorkspace(workspace, { isBare });
        },
      ),
    };
  };
  const partial: (data: {
    keepsShown: boolean;
    keepsPendingIds: boolean;
  }) => PowerBiReadState = (data: {
    keepsShown: boolean;
    keepsPendingIds: boolean;
  }): PowerBiReadState => {
    return {
      ...withoutDefinitions,
      hasEveryWorkspace: false,
      workspaces: data.keepsShown
        ? asWritten.workspaces.filter(
            (workspace: PowerBiWorkspaceRead): boolean => {
              return needs.whole.has(workspace.id) && !workspace.trimmed;
            },
          )
        : [],
      pendingWorkspaceIds: data.keepsPendingIds ? pendingWorkspaceIds : [],
    };
  };
  // Each step lets go of more than the one before: the first that fits is kept.
  const steps: Array<() => PowerBiReadState> = [
    (): PowerBiReadState => {
      return asWritten;
    },
    (): PowerBiReadState => {
      return withoutDefinitions;
    },
    (): PowerBiReadState => {
      return trimmed(false);
    },
    (): PowerBiReadState => {
      return trimmed(true);
    },
    (): PowerBiReadState => {
      return partial({ keepsShown: true, keepsPendingIds: true });
    },
    (): PowerBiReadState => {
      return partial({ keepsShown: true, keepsPendingIds: false });
    },
    (): PowerBiReadState => {
      return partial({ keepsShown: false, keepsPendingIds: true });
    },
    (): PowerBiReadState => {
      return partial({ keepsShown: false, keepsPendingIds: false });
    },
  ];

  for (const step of steps) {
    const kept: PowerBiReadState = step();
    // As JSON holds it: each date as its ISO text, the definitions by id.
    const text: string = JSON.stringify({
      ...kept,
      dataflows: Object.fromEntries(kept.dataflows),
    });

    if (text.length <= MAX_POWER_BI_READ_STATE_LENGTH) {
      return JSON.parse(text) as JSONObject;
    }
  }

  return null;
}
