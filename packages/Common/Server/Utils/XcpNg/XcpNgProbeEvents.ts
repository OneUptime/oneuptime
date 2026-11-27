import XcpNgPoolService from "../../Services/XcpNgPoolService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import XcpNgPoolEventsIngest, {
  XcpNgPoolEventsIngestPool,
  XcpNgPoolEventsPreparation,
  XcpNgPoolEventsStore,
} from "./XcpNgPoolEventsIngest";
import XcpNgPool from "../../../Models/DatabaseModels/XcpNgPool";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import XcpNgCollectionMethod from "../../../Types/XcpNg/XcpNgCollectionMethod";
import XcpNgConnectionType from "../../../Types/XcpNg/XcpNgConnectionType";
import { XcpNgEventSource } from "../../../Types/XcpNg/XcpNgPoolEventState";
import {
  XcpNgCollectionJob,
  XcpNgCollectionReport,
} from "../../../Types/XcpNg/XcpNgProbeCollection";
import { XcpNgTelemetryUtil } from "../../../Types/XcpNg/XcpNgTelemetry";

/*
 * ------------------------------------------------------------------
 * A pool's alarms, HA and backups on the probe's path (#10997)
 * ------------------------------------------------------------------
 *
 * The two ends of an XCP-ng connection's collection (#10996, #10999)
 * where alarms and backups ride along with the metrics:
 *
 *   - the claim hands each job where reading stands (attachEventsJobs):
 *     for each pool the connection reads, the message watermark and the
 *     messages whose alerts are open, the backup watermark, whether the
 *     patches are due - all kept by the server, so a probe restart, or
 *     another probe, neither loses nor repeats one;
 *   - the report's events go through the ingest (ingest): prepared, the
 *     records queued for the logs ingest and the derived series for the
 *     metrics ingest, and only then the watermarks written - a server that
 *     dies in between reads them again next time, it never loses one.
 *
 * Only the pools the connection reads now are touched (poolIdsToKeep,
 * XcpNgPoolService.assignPoolsToConnection), as for its metrics.
 * ------------------------------------------------------------------
 */

export interface XcpNgProbeEventsQueue {
  queueLogs: (data: {
    projectId: ObjectID;
    resourceLogs: Array<JSONObject>;
  }) => Promise<void>;
  queueMetrics: (data: {
    projectId: ObjectID;
    resourceMetrics: Array<JSONObject>;
  }) => Promise<void>;
}

export interface XcpNgProbeEventsOutcome {
  // Log records queued: a message, a message cleared, a backup run.
  recordCount: number;
  // Pools whose derived series (HA, overdue backups, patches) were queued.
  derivedPoolCount: number;
}

export interface XcpNgProbeEventsPools {
  /*
   * The pools a connection reads, with their row ids: by the connection
   * for the claim, by UUID for a report.
   */
  findForConnection: (data: {
    projectId: ObjectID;
    xcpNgConnectionId: ObjectID;
  }) => Promise<Array<XcpNgPoolEventsIngestPool>>;
  findByIdentifiers: (data: {
    projectId: ObjectID;
    poolIdentifiers: Array<string>;
  }) => Promise<Array<XcpNgPoolEventsIngestPool>>;
}

function toIngestPools(
  pools: Array<XcpNgPool>,
): Array<XcpNgPoolEventsIngestPool> {
  const read: Array<XcpNgPoolEventsIngestPool> = [];
  for (const pool of pools) {
    if (pool.id && pool.poolIdentifier) {
      read.push({
        xcpNgPoolId: pool.id,
        poolIdentifier: XcpNgTelemetryUtil.normalizePoolIdentifier(
          pool.poolIdentifier,
        ),
      });
    }
  }
  return read;
}

export const DEFAULT_XCP_NG_PROBE_EVENTS_POOLS: XcpNgProbeEventsPools = {
  findForConnection: async (data: {
    projectId: ObjectID;
    xcpNgConnectionId: ObjectID;
  }): Promise<Array<XcpNgPoolEventsIngestPool>> => {
    return toIngestPools(
      await XcpNgPoolService.findBy({
        query: {
          projectId: data.projectId,
          xcpNgConnectionId: data.xcpNgConnectionId,
          collectionMethod: XcpNgCollectionMethod.Probe,
        },
        select: { _id: true, poolIdentifier: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      }),
    );
  },
  findByIdentifiers: async (data: {
    projectId: ObjectID;
    poolIdentifiers: Array<string>;
  }): Promise<Array<XcpNgPoolEventsIngestPool>> => {
    if (data.poolIdentifiers.length === 0) {
      return [];
    }
    return toIngestPools(
      await XcpNgPoolService.findBy({
        query: {
          projectId: data.projectId,
          poolIdentifier: QueryHelper.any(data.poolIdentifiers),
        },
        select: { _id: true, poolIdentifier: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      }),
    );
  },
};

export default class XcpNgProbeEvents {
  /*
   * Each claimed job with where reading its pools' events stands. A job
   * whose state cannot be read goes without it: its probe reads the
   * metrics, and the events the next time.
   */
  public static async attachEventsJobs(data: {
    jobs: Array<XcpNgCollectionJob>;
    // Each claimed connection's project, by connection id.
    projectIdByConnectionId: Map<string, ObjectID>;
    now?: Date | undefined;
    pools?: XcpNgProbeEventsPools | undefined;
    store?: XcpNgPoolEventsStore | undefined;
  }): Promise<void> {
    const pools: XcpNgProbeEventsPools =
      data.pools || DEFAULT_XCP_NG_PROBE_EVENTS_POOLS;

    for (const job of data.jobs) {
      const projectId: ObjectID | undefined = data.projectIdByConnectionId.get(
        job.xcpNgConnectionId,
      );

      /*
       * Xen Orchestra's events need its API token; XAPI's messages come
       * with the metrics, and only the open ones are checked.
       */
      if (
        !projectId ||
        (job.connectionType === XcpNgConnectionType.XenOrchestra &&
          !job.apiToken)
      ) {
        continue;
      }

      try {
        job.events = await XcpNgPoolEventsIngest.getJobState({
          projectId: projectId,
          pools: await pools.findForConnection({
            projectId: projectId,
            xcpNgConnectionId: new ObjectID(job.xcpNgConnectionId),
          }),
          now: data.now,
          store: data.store,
        });
      } catch (err) {
        logger.error(
          `Reading where an XCP-ng connection's events stand failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /*
   * A succeeded collection's events into the ingest, for the pools the
   * connection reads now: queued first, committed after.
   */
  public static async ingest(data: {
    projectId: ObjectID;
    connectionType: XcpNgConnectionType;
    // The connection's name: the Xen Orchestra its pools are read from.
    connectionName?: string | undefined;
    report: XcpNgCollectionReport;
    poolIdsToKeep: ReadonlySet<string>;
    queue: XcpNgProbeEventsQueue;
    now?: Date | undefined;
    pools?: XcpNgProbeEventsPools | undefined;
    store?: XcpNgPoolEventsStore | undefined;
  }): Promise<XcpNgProbeEventsOutcome> {
    const outcome: XcpNgProbeEventsOutcome = {
      recordCount: 0,
      derivedPoolCount: 0,
    };

    const isXenOrchestra: boolean =
      data.connectionType === XcpNgConnectionType.XenOrchestra;

    // Xen Orchestra without a token reads metrics only: nothing to take in.
    if (isXenOrchestra && !data.report.events) {
      return outcome;
    }

    const pools: Array<XcpNgPoolEventsIngestPool> = await (
      data.pools || DEFAULT_XCP_NG_PROBE_EVENTS_POOLS
    ).findByIdentifiers({
      projectId: data.projectId,
      poolIdentifiers: Array.from(data.poolIdsToKeep),
    });

    if (pools.length === 0) {
      return outcome;
    }

    const preparation: XcpNgPoolEventsPreparation =
      await XcpNgPoolEventsIngest.prepare(
        {
          projectId: data.projectId,
          source: isXenOrchestra
            ? XcpNgEventSource.XenOrchestra
            : XcpNgEventSource.Xapi,
          pools: pools,
          events: isXenOrchestra ? data.report.events : undefined,
          xapiMessages: isXenOrchestra ? undefined : data.report.messages,
          // A succeeded XAPI read read the messages, or said it could not.
          xapiMessagesRead:
            !isXenOrchestra && Array.isArray(data.report.messages),
          xapiPoolStates: isXenOrchestra ? undefined : data.report.poolStates,
          xapiClearedMessageIds: isXenOrchestra
            ? undefined
            : data.report.xapiClearedMessageIds,
          xenOrchestraName: isXenOrchestra ? data.connectionName : undefined,
          now: data.now,
        },
        data.store,
      );

    for (const logs of preparation.resourceLogs) {
      for (const scope of (logs["scopeLogs"] || []) as Array<JSONObject>) {
        outcome.recordCount += (
          (scope["logRecords"] || []) as Array<JSONObject>
        ).length;
      }
    }
    outcome.derivedPoolCount = preparation.resourceMetrics.length;

    if (preparation.resourceLogs.length > 0) {
      await data.queue.queueLogs({
        projectId: data.projectId,
        resourceLogs: preparation.resourceLogs,
      });
    }

    if (preparation.resourceMetrics.length > 0) {
      await data.queue.queueMetrics({
        projectId: data.projectId,
        resourceMetrics: preparation.resourceMetrics,
      });
    }

    // Queued: now where reading stands moves on.
    await preparation.commit();

    return outcome;
  }
}
