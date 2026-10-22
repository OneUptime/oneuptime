import {
  KubernetesEventLogLike,
  KubernetesEventRow,
  KubernetesEventsFilters,
  KubernetesEventsScope,
  buildKubernetesEventsAttributes,
  groupKubernetesEvents,
  isUnstampedKubernetesEventLog,
  keepRowsOfScope,
} from "./KubernetesEventsModel";
import Log from "Common/Models/AnalyticsModels/Log";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * The Kubernetes Events views read Events through the logs' own list
 * endpoint - no endpoint of their own, and the same access rules as every
 * other log. KubernetesEventsModel says what is asked for and how the
 * answers are read.
 *
 * Two reads at most. The first asks for the newest records of the scope,
 * WITHOUT their bodies: everything a view shows of an Event is in the
 * attributes ingest stamps, and the body - the whole Event object, its
 * managed fields and all - is most of a record's weight. Only a record
 * stored before ingest stamped them has to be read from its body, so the
 * second read, by id, fetches the bodies of exactly those, and only when
 * the first one returned any.
 */

// The most Event records a view reads for a range: the newest ones.
export const KUBERNETES_EVENTS_FETCH_LIMIT: number = 1000;

export interface KubernetesEventsPage {
  // One row per Event, newest first.
  rows: Array<KubernetesEventRow>;
  // True when the range holds more records than were read.
  hasMore: boolean;
}

async function listEventLogs(data: {
  window: InBetween<Date>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attributes: Record<string, any>;
  limit: number;
  ids?: Array<string> | undefined;
  withBody: boolean;
}): Promise<ListResult<Log>> {
  /*
   * `any`: an inline attributes map makes Query<Log> too deep for the
   * compiler (TS2589), as on the other pages that read logs.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: any = {
    modelType: Log,
    query: {
      projectId: ProjectUtil.getCurrentProjectId()!.toString(),
      time: data.window,
      attributes: data.attributes,
      ...(data.ids ? { _id: new Includes(data.ids) } : {}),
    },
    limit: data.limit,
    skip: 0,
    select: {
      _id: true,
      time: true,
      attributes: true,
      ...(data.withBody ? { body: true } : {}),
    },
    sort: {
      time: SortOrder.Descending,
    },
    requestOptions: {},
  };

  return await AnalyticsModelAPI.getList<Log>(options);
}

function idOf(log: Log): string {
  const id: unknown = (log as unknown as { _id?: unknown })._id;
  return id ? String(id) : "";
}

/*
 * The Events of a scope in a time range, filtered on the server by type,
 * namespace, reason and kind.
 */
export async function fetchKubernetesEvents(data: {
  clusterIdentifier: string;
  scope: KubernetesEventsScope;
  filters: KubernetesEventsFilters;
  window: InBetween<Date>;
  limit?: number | undefined;
}): Promise<KubernetesEventsPage> {
  const limit: number = data.limit || KUBERNETES_EVENTS_FETCH_LIMIT;
  const attributes: Record<string, unknown> = buildKubernetesEventsAttributes({
    clusterIdentifier: data.clusterIdentifier,
    scope: data.scope,
    filters: data.filters,
  });

  const result: ListResult<Log> = await listEventLogs({
    window: data.window,
    attributes: attributes,
    limit: limit,
    withBody: false,
  });

  const logs: Array<KubernetesEventLogLike> = result.data.map(
    (log: Log): KubernetesEventLogLike => {
      return {
        _id: idOf(log),
        time: log.time,
        attributes: log.attributes,
      };
    },
  );

  const unstampedIds: Array<string> = logs
    .filter((log: KubernetesEventLogLike): boolean => {
      return isUnstampedKubernetesEventLog(log) && Boolean(log._id);
    })
    .map((log: KubernetesEventLogLike): string => {
      return String(log._id);
    });

  if (unstampedIds.length > 0) {
    const withBodies: ListResult<Log> = await listEventLogs({
      window: data.window,
      attributes: attributes,
      limit: unstampedIds.length,
      ids: unstampedIds,
      withBody: true,
    });
    const bodyById: Map<string, unknown> = new Map();

    for (const log of withBodies.data) {
      bodyById.set(idOf(log), log.body);
    }

    for (const log of logs) {
      if (log._id && bodyById.has(String(log._id))) {
        log.body = bodyById.get(String(log._id));
      }
    }
  }

  return {
    rows: keepRowsOfScope(groupKubernetesEvents(logs), data.scope),
    hasMore: result.hasMore === true,
  };
}
