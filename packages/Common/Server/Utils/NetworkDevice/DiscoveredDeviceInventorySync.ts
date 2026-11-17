import {
  DiscoveredDeviceListReading,
  NETWORK_DEVICE_DISCOVERED_LIST_FIELDS,
  NetworkDeviceDiscoveredDetails,
  NetworkDeviceDiscoveredField,
  NetworkDeviceDiscoveredValue,
  buildDiscoveredListEntries,
  getDiscoveredTime,
  readNetworkDeviceDiscoveredDetails,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import ObjectID from "../../../Types/ObjectID";
import NetworkDeviceService, {
  DiscoveredDetailsMerge,
} from "../../Services/NetworkDeviceService";
import NetworkEndpointService from "../../Services/NetworkEndpointService";
import logger from "../Logger";
import DiscoveredDevices, {
  ClassifiedDiscoveredDevice,
} from "./DiscoveredDevices";
import {
  DiscoveredDeviceStatement,
  StatementParams,
  buildClassifiedRows,
} from "./DiscoveredDeviceQuery";

/*
 * KEEPING A MONITORED DEVICE'S INVENTORY IN STEP WITH THE DISCOVERED DEVICES
 * LIST (OneUptime issue #9305).
 *
 * The Discovered Devices list knows who made a device - its MAC address's
 * prefix names the maker - and what its network controller calls it. A
 * device that is monitored, whether it was added from the list, imported
 * from a scan or typed in by hand, used to know neither: its Vendor / Model
 * read empty although the list's row for the very same box named its maker.
 *
 * This copies what the list's row says onto the device it is matched to - by
 * MAC, or by address in the same site while the sighting is current, the
 * list's own "Monitored" match (DiscoveredDeviceQuery) - as discovered
 * details (Types/NetworkDevice/NetworkDeviceDiscoveredDetails), each with the
 * row as its source and when it was read:
 *
 *   - A field the device has no entry for is filled in.
 *   - A field the list now says differently is updated: the entry is the
 *     list's, so the list's newer word replaces it. Likewise when the row
 *     the device is matched to changed, or the row's name did.
 *   - A field the list no longer has a value for is dropped.
 *   - Nothing saved on the device is ever touched: these are entries of its
 *     discovered details, never its columns, and the device's asset facts
 *     take them only when nothing the device reports or holds says the same
 *     thing (NetworkDeviceAssetFacts). A Vendor someone typed stays.
 *   - A device no row matches any more keeps what it last learned.
 *
 * An entry is written again only when one of those changes, or once it is a
 * day old, so the source line ("Discovered device X, 2 hours ago") stays
 * true without rewriting every device every hour.
 *
 * HOW MUCH, HOW OFTEN. Hourly, from the Workers job
 * NetworkDeviceDiscovery:SyncDiscoveredDeviceInventory. Its first run after
 * an upgrade is the backfill of devices imported before this: every matched
 * device has no entry yet, so every one is filled. The matched devices of a
 * project are read a page at a time, in id order; a run stops starting work
 * once its time budget is spent and the next run carries on from where it
 * stopped, so a large installation is filled over a few runs and no project
 * waits behind another for good. Each page is merged in batched statements
 * that leave a device another writer holds for the next run
 * (NetworkDeviceService.mergeDiscoveredDetails with skipLockedDevices).
 */

export type DiscoveredDeviceInventorySyncQueryRunner = (
  sql: string,
  params: Array<unknown>,
) => Promise<Array<Record<string, unknown>>>;

export interface DiscoveredDeviceInventorySyncSummary {
  // Projects worked on.
  projects: number;
  // Projects whose work failed: logged, and tried again next run.
  failedProjects: number;
  // Devices whose discovered details were written.
  updatedDevices: number;
  // The time budget ran out; the next run carries on from here.
  isCutShort: boolean;
}

// Where an interrupted run carries on.
export interface DiscoveredDeviceInventorySyncCursor {
  projectId: string;
  afterDeviceId?: string | undefined;
}

// One monitored device and the list's row it is matched to.
export interface MatchedDiscoveredDevice {
  deviceId: string;
  row: ClassifiedDiscoveredDevice;
  // The device's discovered details as stored: only the list's keys are read.
  storedDetails: unknown;
}

const DAY_MS: number = 24 * 60 * 60 * 1000;

// An entry the list still says the same about is written again after this.
export const DISCOVERED_LIST_ENTRY_REFRESH_MS: number = DAY_MS;

// Matched devices read at a time.
export const INVENTORY_SYNC_PAGE_SIZE: number = 1000;

// Projects read at a time.
export const INVENTORY_SYNC_PROJECTS_PER_PAGE: number = 100;

/*
 * What a run may spend starting work; the job's own timeout is longer, so a
 * statement already running finishes.
 */
export const INVENTORY_SYNC_TIME_BUDGET_MS: number = 8 * 60 * 1000;

function sameText(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return (left || "") === (right || "");
}

/**
 * What one matched device's discovered details need, to say what its row on
 * the list says - or null when they already do. Pure: the planning is tested
 * on its own.
 */
export function planDiscoveredListPatch(data: {
  match: MatchedDiscoveredDevice;
  now: Date;
}): DiscoveredDetailsMerge | null {
  const row: ClassifiedDiscoveredDevice = data.match.row;

  if (!row.id || !ObjectID.isValidUUID(data.match.deviceId)) {
    return null;
  }

  const reading: DiscoveredDeviceListReading = {
    endpointId: row.id,
    name: row.name,
    vendor: row.vendor,
    clientName: row.hostname,
  };

  const wanted: Partial<
    Record<NetworkDeviceDiscoveredField, NetworkDeviceDiscoveredValue>
  > = buildDiscoveredListEntries({ reading: reading, readAt: data.now });
  const stored: NetworkDeviceDiscoveredDetails =
    readNetworkDeviceDiscoveredDetails(data.match.storedDetails);

  const set: Record<string, unknown> = {};
  const unset: Array<string> = [];
  const now: number = data.now.getTime();

  for (const field of NETWORK_DEVICE_DISCOVERED_LIST_FIELDS) {
    const want: NetworkDeviceDiscoveredValue | undefined = wanted[field];
    const have: NetworkDeviceDiscoveredValue | undefined = stored.values[field];

    if (!want) {
      if (have) {
        unset.push(field);
      }
      continue;
    }

    const haveAt: number | undefined = getDiscoveredTime(have);
    const isCurrent: boolean = Boolean(
      have &&
        have.value === want.value &&
        have.readBy.type === want.readBy.type &&
        have.readBy.id.toLowerCase() === want.readBy.id.toLowerCase() &&
        sameText(have.readBy.name, want.readBy.name) &&
        haveAt !== undefined &&
        haveAt <= now &&
        now - haveAt < DISCOVERED_LIST_ENTRY_REFRESH_MS,
    );

    if (!isCurrent) {
      set[field] = want;
    }
  }

  if (Object.keys(set).length === 0 && unset.length === 0) {
    return null;
  }

  return {
    deviceId: data.match.deviceId,
    ...(Object.keys(set).length > 0 ? { set: set } : {}),
    ...(unset.length > 0 ? { unset: unset } : {}),
  };
}

/*
 * The projects that hold both a discovered device and a monitored one, after
 * `afterProjectId`, in id order. Each EXISTS is one probe of an index that
 * leads with the project.
 */
export function buildSyncProjectsStatement(data: {
  afterProjectId?: string | undefined;
  limit: number;
}): DiscoveredDeviceStatement {
  const params: StatementParams = new StatementParams();
  const filters: Array<string> = [`p."deletedAt" IS NULL`];

  if (data.afterProjectId) {
    filters.push(`p."_id" > ${params.add(data.afterProjectId)}::uuid`);
  }

  const limit: string = params.add(Math.max(1, Math.floor(data.limit)));

  return {
    sql: `SELECT p."_id"::text AS "projectId"
FROM "Project" p
WHERE ${filters.join("\n  AND ")}
  AND EXISTS (
    SELECT 1 FROM "NetworkEndpoint" e
    WHERE e."projectId" = p."_id" AND e."deletedAt" IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM "NetworkDevice" d
    WHERE d."projectId" = p."_id" AND d."deletedAt" IS NULL
  )
ORDER BY p."_id" ASC
LIMIT ${limit}`,
    params: params.values,
  };
}

/*
 * One page of a project's monitored devices, each with the list's row it is
 * matched to and its discovered details as stored. A device several rows
 * match takes the one matched by MAC - it names the box wherever it is -
 * else the one seen last.
 */
export function buildMatchedDevicesStatement(data: {
  projectId: ObjectID;
  afterDeviceId?: string | undefined;
  limit: number;
}): DiscoveredDeviceStatement {
  const params: StatementParams = new StatementParams();
  const classified: string = buildClassifiedRows(
    DiscoveredDevices.getScope({ projectId: data.projectId }),
    params,
  );
  const filters: Array<string> = [`c."monitoredDeviceId" IS NOT NULL`];

  if (data.afterDeviceId) {
    filters.push(
      `c."monitoredDeviceId" > ${params.add(data.afterDeviceId)}::uuid`,
    );
  }

  const limit: string = params.add(Math.max(1, Math.floor(data.limit)));

  return {
    sql: `${classified},
matched AS (
  SELECT DISTINCT ON (c."monitoredDeviceId")
    c."id", c."macAddress", c."ipAddress", c."hostname", c."vendor",
    c."classification", c."monitoredDeviceId", c."monitoredBy"
  FROM classified c
  WHERE ${filters.join("\n    AND ")}
  ORDER BY c."monitoredDeviceId",
    (c."monitoredBy" = 'macAddress') DESC,
    c."lastSeenAt" DESC NULLS LAST,
    c."id" ASC
)
SELECT m.*, d."discoveredDetails" AS "storedDetails"
FROM matched m
JOIN "NetworkDevice" d ON d."_id" = m."monitoredDeviceId"
ORDER BY m."monitoredDeviceId" ASC
LIMIT ${limit}`,
    params: params.values,
  };
}

export default class DiscoveredDeviceInventorySync {
  // Seams for tests: the statement runner, the writer and the clock.
  public static runQuery: DiscoveredDeviceInventorySyncQueryRunner = async (
    sql: string,
    params: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> => {
    return (await NetworkEndpointService.getRepository().manager.query(
      sql,
      params,
    )) as Array<Record<string, unknown>>;
  };

  public static mergeDetails: (data: {
    projectId: ObjectID;
    patches: Array<DiscoveredDetailsMerge>;
  }) => Promise<number> = async (data: {
    projectId: ObjectID;
    patches: Array<DiscoveredDetailsMerge>;
  }): Promise<number> => {
    return await NetworkDeviceService.mergeDiscoveredDetails({
      projectId: data.projectId,
      patches: data.patches,
      skipLockedDevices: true,
    });
  };

  public static now: () => Date = (): Date => {
    return new Date();
  };

  /*
   * Where the last run stopped, when its time ran out: this process carries
   * on from there. Lost on a restart, which only means starting over.
   */
  public static cursor: DiscoveredDeviceInventorySyncCursor | undefined =
    undefined;

  /*
   * Every project, as far as the time budget goes. One project's failure is
   * logged and the rest go on: it is tried again next run.
   */
  public static async run(options?: {
    timeBudgetMs?: number | undefined;
  }): Promise<DiscoveredDeviceInventorySyncSummary> {
    const budgetMs: number =
      options?.timeBudgetMs ?? INVENTORY_SYNC_TIME_BUDGET_MS;
    const startedAt: number = this.now().getTime();
    const isOutOfTime: () => boolean = (): boolean => {
      return this.now().getTime() - startedAt >= budgetMs;
    };

    const summary: DiscoveredDeviceInventorySyncSummary = {
      projects: 0,
      failedProjects: 0,
      updatedDevices: 0,
      isCutShort: false,
    };

    const resume: DiscoveredDeviceInventorySyncCursor | undefined = this.cursor;
    this.cursor = undefined;

    /*
     * The project the last run stopped in comes first, from the device it
     * stopped at; then the projects after it.
     */
    let afterProjectId: string | undefined = undefined;

    if (resume && ObjectID.isValidUUID(resume.projectId)) {
      const stoppedAt: string | undefined = await this.syncOneProject({
        projectId: resume.projectId,
        afterDeviceId: resume.afterDeviceId,
        isOutOfTime: isOutOfTime,
        summary: summary,
      });

      if (stoppedAt !== undefined) {
        this.cursor = { projectId: resume.projectId, afterDeviceId: stoppedAt };
        summary.isCutShort = true;
        return summary;
      }

      afterProjectId = resume.projectId;
    }

    for (;;) {
      const statement: DiscoveredDeviceStatement = buildSyncProjectsStatement({
        afterProjectId: afterProjectId,
        limit: INVENTORY_SYNC_PROJECTS_PER_PAGE,
      });
      const rows: Array<Record<string, unknown>> = await this.runQuery(
        statement.sql,
        statement.params,
      );

      for (const row of rows) {
        const projectId: string = String(row["projectId"] || "");

        if (!ObjectID.isValidUUID(projectId)) {
          continue;
        }

        if (isOutOfTime()) {
          this.cursor = { projectId: projectId };
          summary.isCutShort = true;
          return summary;
        }

        const stoppedAt: string | undefined = await this.syncOneProject({
          projectId: projectId,
          isOutOfTime: isOutOfTime,
          summary: summary,
        });

        if (stoppedAt !== undefined) {
          this.cursor = { projectId: projectId, afterDeviceId: stoppedAt };
          summary.isCutShort = true;
          return summary;
        }
      }

      if (rows.length < INVENTORY_SYNC_PROJECTS_PER_PAGE) {
        return summary;
      }

      afterProjectId = String(rows[rows.length - 1]?.["projectId"] || "");
    }
  }

  /*
   * One project, logged and counted. Returns the device to carry on after
   * when its time ran out, else undefined.
   */
  private static async syncOneProject(data: {
    projectId: string;
    afterDeviceId?: string | undefined;
    isOutOfTime: () => boolean;
    summary: DiscoveredDeviceInventorySyncSummary;
  }): Promise<string | undefined> {
    data.summary.projects += 1;

    try {
      const result: { updatedDevices: number; stoppedAfter?: string } =
        await this.syncProject({
          projectId: new ObjectID(data.projectId),
          afterDeviceId: data.afterDeviceId,
          isOutOfTime: data.isOutOfTime,
        });

      data.summary.updatedDevices += result.updatedDevices;
      return result.stoppedAfter;
    } catch (error) {
      data.summary.failedProjects += 1;
      logger.error(
        `Discovered devices: copying what the list knows onto the monitored devices of project ${data.projectId} failed. It is tried again next run.`,
      );
      logger.error(error);
      return undefined;
    }
  }

  /*
   * One project's matched devices, a page at a time. `stoppedAfter` is the
   * last device done when the time ran out before the project was.
   */
  public static async syncProject(data: {
    projectId: ObjectID;
    afterDeviceId?: string | undefined;
    isOutOfTime?: (() => boolean) | undefined;
  }): Promise<{ updatedDevices: number; stoppedAfter?: string }> {
    let afterDeviceId: string | undefined = data.afterDeviceId;
    let updatedDevices: number = 0;

    for (;;) {
      const statement: DiscoveredDeviceStatement = buildMatchedDevicesStatement(
        {
          projectId: data.projectId,
          afterDeviceId: afterDeviceId,
          limit: INVENTORY_SYNC_PAGE_SIZE,
        },
      );
      const rows: Array<Record<string, unknown>> = await this.runQuery(
        statement.sql,
        statement.params,
      );
      const now: Date = this.now();
      const patches: Array<DiscoveredDetailsMerge> = [];

      for (const raw of rows) {
        const row: ClassifiedDiscoveredDevice = DiscoveredDevices.toRow(raw);
        const deviceId: string | undefined = row.monitoredDevice?.id;

        if (!deviceId) {
          continue;
        }

        const patch: DiscoveredDetailsMerge | null = planDiscoveredListPatch({
          match: {
            deviceId: deviceId,
            row: row,
            storedDetails: raw["storedDetails"],
          },
          now: now,
        });

        if (patch) {
          patches.push(patch);
        }
      }

      if (patches.length > 0) {
        updatedDevices += await this.mergeDetails({
          projectId: data.projectId,
          patches: patches,
        });
      }

      if (rows.length < INVENTORY_SYNC_PAGE_SIZE) {
        return { updatedDevices: updatedDevices };
      }

      afterDeviceId = String(
        rows[rows.length - 1]?.["monitoredDeviceId"] || "",
      );

      if (data.isOutOfTime?.()) {
        return { updatedDevices: updatedDevices, stoppedAfter: afterDeviceId };
      }
    }
  }
}
