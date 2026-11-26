import XcpNgPool from "../../../Models/DatabaseModels/XcpNgPool";
import PartialEntity from "../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  XCP_NG_PATCH_CHECK_INTERVAL_MS,
  XcpNgBackupWatermark,
  XcpNgEventsJobState,
  XcpNgEventsReport,
  XcpNgPoolEventsJobState,
  XcpNgPoolEventsReport,
} from "../../../Types/XcpNg/XcpNgPoolEvents";
import {
  XcpNgEventSource,
  XcpNgPoolEventState,
  readXcpNgPoolEventState,
} from "../../../Types/XcpNg/XcpNgPoolEventState";
import {
  XcpNgPoolMessage,
  XcpNgPoolState,
} from "../../../Types/XcpNg/XcpNgProbeCollection";
import { XcpNgTelemetryUtil } from "../../../Types/XcpNg/XcpNgTelemetry";
import QueryHelper from "../../Types/Database/QueryHelper";
import XcpNgPoolFeedService from "../../Services/XcpNgPoolFeedService";
import XcpNgPoolService from "../../Services/XcpNgPoolService";
import XcpNgResourceService from "../../Services/XcpNgResourceService";
import logger from "../Logger";
import {
  XcpNgEventResource,
  buildXcpNgDerivedResourceMetrics,
  buildXcpNgEventResourceLogs,
} from "./XcpNgEventRecords";
import {
  XcpNgFeedLine,
  XcpNgPoolEventColumns,
  XcpNgPoolEventsOutput,
  XcpNgStoredPool,
  XcpNgStoredResource,
  XcpNgVmBackupUpdate,
  processXcpNgPoolEvents,
} from "./XcpNgPoolEventsProcessing";

/*
 * ------------------------------------------------------------------
 * A collection's alarms, HA, master, patches and backups, taken in (#10997)
 * ------------------------------------------------------------------
 *
 * The probe-ingest route for XCP-ng collections calls this with what one
 * collection reported, for the pools the connection may write (a pool
 * another connection reads, or one switched back to the agent, is never
 * passed). Two steps, so a crash between them loses nothing:
 *
 *   1. prepare(): read each pool's stored state and inventory, work out
 *      what changes (XcpNgPoolEventsProcessing), and build the log records
 *      and derived series as OTLP - which the route queues for the logs and
 *      metrics ingest;
 *   2. commit(): only then write the watermarks, the open messages, the
 *      pool's columns, its VMs' backups, its hosts' patches and the feed.
 *
 * Queued but not committed (a crash in between) means the next collection
 * reads the same messages again: nothing is lost, and the worst repeat is a
 * second log record of an alert already open. A probe that restarts starts
 * from the committed watermark, so it neither loses nor repeats a message.
 *
 * And getJobState(): what the next collection of a Xen Orchestra starts
 * from, for its job.
 * ------------------------------------------------------------------
 */

export interface XcpNgPoolEventsIngestPool {
  xcpNgPoolId: ObjectID;
  // The pool's XAPI UUID.
  poolIdentifier: string;
}

export interface XcpNgPoolEventsIngestInput {
  projectId: ObjectID;
  source: XcpNgEventSource;
  // The pools this collection may write.
  pools: Array<XcpNgPoolEventsIngestPool>;
  // Through Xen Orchestra.
  events?: XcpNgEventsReport | undefined;
  // Straight from XAPI.
  xapiMessages?: Array<XcpNgPoolMessage> | undefined;
  // Whether XAPI's messages were read (the report carries a watermark).
  xapiMessagesRead?: boolean | undefined;
  xapiPoolStates?: Array<XcpNgPoolState> | undefined;
  // The name the connection gives its Xen Orchestra, for the records.
  xenOrchestraName?: string | null | undefined;
  now?: Date | undefined;
}

export interface XcpNgPoolEventsPreparation {
  // For the logs ingest (TelemetryQueueService.addLogIngestJob).
  resourceLogs: Array<JSONObject>;
  // For the metrics ingest.
  resourceMetrics: Array<JSONObject>;
  // Writes what was worked out; call once the payloads are queued.
  commit: () => Promise<void>;
}

// What the ingest reads and writes; the default is the services.
export interface XcpNgPoolEventsStore {
  readPools: (data: {
    projectId: ObjectID;
    xcpNgPoolIds: Array<ObjectID>;
  }) => Promise<Array<XcpNgStoredPool>>;
  readInventory: (data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
  }) => Promise<Array<XcpNgStoredResource>>;
  writePool: (data: {
    xcpNgPoolId: ObjectID;
    columns: XcpNgPoolEventColumns;
  }) => Promise<void>;
  writeVmBackups: (data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    updates: Array<XcpNgVmBackupUpdate>;
  }) => Promise<void>;
  writeVmIntervals: (data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    updates: Array<{ vmId: string; intervalSeconds: number | null }>;
  }) => Promise<void>;
  writeHostPatches: (data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    hosts: XcpNgPoolEventsOutput["hostPatchUpdates"];
  }) => Promise<void>;
  writeFeed: (data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    lines: Array<XcpNgFeedLine>;
  }) => Promise<void>;
}

function toStoredPool(pool: XcpNgPool): XcpNgStoredPool | null {
  if (!pool._id || !pool.poolIdentifier) {
    return null;
  }
  return {
    xcpNgPoolId: pool._id.toString(),
    poolIdentifier: XcpNgTelemetryUtil.normalizePoolIdentifier(
      pool.poolIdentifier,
    ),
    name: pool.name || pool.poolIdentifier,
    reportedName: pool.reportedName || null,
    xenOrchestraName: pool.xenOrchestraName || null,
    isHaEnabled:
      pool.isHaEnabled === undefined || pool.isHaEnabled === null
        ? null
        : Boolean(pool.isHaEnabled),
    haHostFailuresToTolerate: pool.haHostFailuresToTolerate ?? null,
    haPlanExistsFor: pool.haPlanExistsFor ?? null,
    isHaOvercommitted:
      pool.isHaOvercommitted === undefined || pool.isHaOvercommitted === null
        ? null
        : Boolean(pool.isHaOvercommitted),
    masterHostExternalId: pool.masterHostExternalId || null,
    backupJobs: Array.isArray(pool.backupJobs) ? pool.backupJobs : null,
    eventState: pool.eventState ?? null,
    patchesCheckedAt: pool.patchesCheckedAt || null,
  };
}

export const DEFAULT_XCP_NG_POOL_EVENTS_STORE: XcpNgPoolEventsStore = {
  readPools: async (data: {
    projectId: ObjectID;
    xcpNgPoolIds: Array<ObjectID>;
  }): Promise<Array<XcpNgStoredPool>> => {
    if (data.xcpNgPoolIds.length === 0) {
      return [];
    }
    const pools: Array<XcpNgPool> = await XcpNgPoolService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(data.xcpNgPoolIds),
      },
      select: {
        _id: true,
        poolIdentifier: true,
        name: true,
        reportedName: true,
        xenOrchestraName: true,
        isHaEnabled: true,
        haHostFailuresToTolerate: true,
        haPlanExistsFor: true,
        isHaOvercommitted: true,
        masterHostExternalId: true,
        backupJobs: true,
        eventState: true,
        patchesCheckedAt: true,
      },
      skip: 0,
      limit: data.xcpNgPoolIds.length,
      props: {
        isRoot: true,
      },
    });
    return pools
      .map(toStoredPool)
      .filter((pool: XcpNgStoredPool | null): pool is XcpNgStoredPool => {
        return pool !== null;
      });
  },
  readInventory: async (data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
  }): Promise<Array<XcpNgStoredResource>> => {
    return await XcpNgResourceService.findForEvents(data);
  },
  writePool: async (data: {
    xcpNgPoolId: ObjectID;
    columns: XcpNgPoolEventColumns;
  }): Promise<void> => {
    /*
     * Round the service's hooks: these columns change every minute and
     * are OneUptime's own (nobody may write them), and an update through
     * the hooks would post "pool updated" to the feed each time.
     */
    // Only what this collection worked out: an absent key is left as it is.
    const written: JSONObject = {};
    for (const [key, value] of Object.entries(data.columns)) {
      if (value !== undefined) {
        written[key] = value as JSONObject[string];
      }
    }
    await XcpNgPoolService.updateColumnsByIdWithoutHooks({
      id: data.xcpNgPoolId,
      data: written as unknown as PartialEntity<XcpNgPool>,
      skipUpdateDateColumn: true,
    });
  },
  writeVmBackups: async (data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    updates: Array<XcpNgVmBackupUpdate>;
  }): Promise<void> => {
    await XcpNgResourceService.applyVmBackups(data);
  },
  writeVmIntervals: async (data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    updates: Array<{ vmId: string; intervalSeconds: number | null }>;
  }): Promise<void> => {
    await XcpNgResourceService.applyVmBackupIntervals(data);
  },
  writeHostPatches: async (data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    hosts: XcpNgPoolEventsOutput["hostPatchUpdates"];
  }): Promise<void> => {
    await XcpNgResourceService.applyHostPatches(data);
  },
  writeFeed: async (data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    lines: Array<XcpNgFeedLine>;
  }): Promise<void> => {
    for (const line of data.lines) {
      // Never fails what it describes: the service swallows its own errors.
      await XcpNgPoolFeedService.createXcpNgPoolFeedItem({
        xcpNgPoolId: data.xcpNgPoolId,
        projectId: data.projectId,
        xcpNgPoolFeedEventType: line.type,
        feedInfoInMarkdown: line.markdown,
        displayColor: line.color,
        postedAt: line.postedAt,
      });
    }
  },
};

function findPoolReport(
  events: XcpNgEventsReport | undefined,
  poolIdentifier: string,
): XcpNgPoolEventsReport | undefined {
  return events?.pools.find((pool: XcpNgPoolEventsReport): boolean => {
    return (
      XcpNgTelemetryUtil.normalizePoolIdentifier(pool.poolId) === poolIdentifier
    );
  });
}

export default class XcpNgPoolEventsIngest {
  /*
   * What the next collection of a Xen Orchestra starts from: each pool's
   * message watermark and open messages, the backup watermark (the most
   * advanced of its pools': they read the same logs), and whether the
   * hosts' patches are due.
   */
  public static async getJobState(data: {
    projectId: ObjectID;
    pools: Array<XcpNgPoolEventsIngestPool>;
    now?: Date | undefined;
    store?: XcpNgPoolEventsStore | undefined;
  }): Promise<XcpNgEventsJobState> {
    const store: XcpNgPoolEventsStore =
      data.store || DEFAULT_XCP_NG_POOL_EVENTS_STORE;
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    const stored: Array<XcpNgStoredPool> = await store.readPools({
      projectId: data.projectId,
      xcpNgPoolIds: data.pools.map(
        (pool: XcpNgPoolEventsIngestPool): ObjectID => {
          return pool.xcpNgPoolId;
        },
      ),
    });

    const pools: Array<XcpNgPoolEventsJobState> = [];
    let backupWatermark: XcpNgBackupWatermark | undefined = undefined;
    let checkPatches: boolean = stored.length === 0;

    for (const pool of stored) {
      const state: XcpNgPoolEventState = readXcpNgPoolEventState(
        pool.eventState,
      );
      const entry: XcpNgPoolEventsJobState = {
        poolId: pool.poolIdentifier,
        openMessageIds: state.openMessages.map(
          (open: { id: string }): string => {
            return open.id;
          },
        ),
      };
      if (state.messageWatermark) {
        entry.messageWatermark = state.messageWatermark;
      }
      pools.push(entry);

      if (
        state.backupWatermark &&
        (!backupWatermark ||
          state.backupWatermark.readSince > backupWatermark.readSince)
      ) {
        backupWatermark = state.backupWatermark;
      }

      const checkedAt: Date | null | undefined = pool.patchesCheckedAt;
      if (
        !checkedAt ||
        now.getTime() - new Date(checkedAt).getTime() >=
          XCP_NG_PATCH_CHECK_INTERVAL_MS
      ) {
        checkPatches = true;
      }
    }

    const job: XcpNgEventsJobState = {
      pools: pools,
      checkPatches: checkPatches,
    };
    if (backupWatermark) {
      job.backupWatermark = backupWatermark;
    }
    return job;
  }

  public static async prepare(
    input: XcpNgPoolEventsIngestInput,
    store: XcpNgPoolEventsStore = DEFAULT_XCP_NG_POOL_EVENTS_STORE,
  ): Promise<XcpNgPoolEventsPreparation> {
    const now: Date = input.now || OneUptimeDate.getCurrentDate();
    const isXenOrchestra: boolean =
      input.source === XcpNgEventSource.XenOrchestra;

    const allowed: Map<string, ObjectID> = new Map();
    for (const pool of input.pools) {
      allowed.set(
        XcpNgTelemetryUtil.normalizePoolIdentifier(pool.poolIdentifier),
        pool.xcpNgPoolId,
      );
    }

    const storedPools: Array<XcpNgStoredPool> = await store.readPools({
      projectId: input.projectId,
      xcpNgPoolIds: Array.from(allowed.values()),
    });

    const resourceLogs: Array<JSONObject> = [];
    const resourceMetrics: Array<JSONObject> = [];
    const writes: Array<() => Promise<void>> = [];

    for (const pool of storedPools) {
      if (!allowed.has(pool.poolIdentifier)) {
        continue;
      }

      const poolReport: XcpNgPoolEventsReport | undefined = findPoolReport(
        input.events,
        pool.poolIdentifier,
      );

      // A pool Xen Orchestra did not report this time is left as it was.
      if (isXenOrchestra && !poolReport && !input.events?.backupRuns) {
        continue;
      }

      const xcpNgPoolId: ObjectID = new ObjectID(pool.xcpNgPoolId);
      const inventory: Array<XcpNgStoredResource> = await store.readInventory({
        projectId: input.projectId,
        xcpNgPoolId: xcpNgPoolId,
      });

      const poolState: XcpNgPoolState | undefined = isXenOrchestra
        ? poolReport?.poolState
        : input.xapiPoolStates?.find((state: XcpNgPoolState): boolean => {
            return (
              XcpNgTelemetryUtil.normalizePoolIdentifier(state.poolId) ===
              pool.poolIdentifier
            );
          });

      const messages: Array<XcpNgPoolMessage> = isXenOrchestra
        ? poolReport?.messages || []
        : (input.xapiMessages || []).filter(
            (message: XcpNgPoolMessage): boolean => {
              return (
                XcpNgTelemetryUtil.normalizePoolIdentifier(message.poolId) ===
                pool.poolIdentifier
              );
            },
          );

      const output: XcpNgPoolEventsOutput = processXcpNgPoolEvents({
        now: now,
        source: input.source,
        pool: pool,
        inventory: inventory,
        poolState: poolState,
        messagesRead: isXenOrchestra
          ? Boolean(poolReport) && !input.events?.problems.messages
          : Boolean(input.xapiMessagesRead),
        messages: messages,
        messageWatermark: poolReport?.messageWatermark,
        clearedMessageIds: poolReport?.clearedMessageIds || [],
        backupRuns: isXenOrchestra ? input.events?.backupRuns : undefined,
        backupJobs: isXenOrchestra ? input.events?.backupJobs : undefined,
        backupWatermark: isXenOrchestra
          ? input.events?.backupWatermark
          : undefined,
        hostPatches: isXenOrchestra ? input.events?.hostPatches : undefined,
        patchesChecked:
          isXenOrchestra &&
          (input.events?.hostPatches !== undefined ||
            Boolean(input.events?.problems.patches)),
        problems: input.events?.problems || {},
      });

      const resource: XcpNgEventResource = {
        poolIdentifier: pool.poolIdentifier,
        reportedName: pool.reportedName,
        xenOrchestraName: input.xenOrchestraName || pool.xenOrchestraName,
      };

      if (output.records.length > 0) {
        resourceLogs.push(
          buildXcpNgEventResourceLogs({
            resource: resource,
            records: output.records,
          }),
        );
      }

      const metrics: JSONObject | null = buildXcpNgDerivedResourceMetrics({
        resource: resource,
        readings: output.derived,
      });
      if (metrics) {
        resourceMetrics.push(metrics);
      }

      writes.push(async (): Promise<void> => {
        await store.writePool({
          xcpNgPoolId: xcpNgPoolId,
          columns: output.columns,
        });
        if (output.vmBackupUpdates.length > 0) {
          await store.writeVmBackups({
            projectId: input.projectId,
            xcpNgPoolId: xcpNgPoolId,
            updates: output.vmBackupUpdates,
          });
        }
        if (output.vmIntervalUpdates.length > 0) {
          await store.writeVmIntervals({
            projectId: input.projectId,
            xcpNgPoolId: xcpNgPoolId,
            updates: output.vmIntervalUpdates,
          });
        }
        if (output.hostPatchUpdates.length > 0) {
          await store.writeHostPatches({
            projectId: input.projectId,
            xcpNgPoolId: xcpNgPoolId,
            hosts: output.hostPatchUpdates,
          });
        }
        if (output.feed.length > 0) {
          await store.writeFeed({
            projectId: input.projectId,
            xcpNgPoolId: xcpNgPoolId,
            lines: output.feed,
          });
        }
      });
    }

    return {
      resourceLogs: resourceLogs,
      resourceMetrics: resourceMetrics,
      commit: async (): Promise<void> => {
        for (const write of writes) {
          try {
            await write();
          } catch (err) {
            /*
             * One pool's failed write leaves its watermark where it was:
             * its events are read and taken in again next time.
             */
            logger.error(
              `Writing the events of an XCP-ng pool failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      },
    };
  }
}
