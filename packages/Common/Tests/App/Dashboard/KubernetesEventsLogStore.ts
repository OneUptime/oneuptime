import Log from "../../../Models/AnalyticsModels/Log";
import ObjectID from "../../../Types/ObjectID";
import {
  KubernetesEventFields,
  StoredKubernetesEventLog,
  WatchType,
  storedKubernetesEventLog,
} from "../../Helpers/KubernetesEventRecords";

/*
 * A store of Kubernetes Event logs that answers the logs list endpoint the
 * way the server does, for the render tests of the Kubernetes Events views:
 * it filters on the attributes asked for (an exact value, an Includes, a
 * StartsWith), on the time range and on ids, leaves the body out unless it
 * is selected, sorts newest first and stops at the limit, saying when there
 * was more. Every request is recorded.
 *
 * A test file mocks AnalyticsModelAPI with `getList` from here (through
 * jest.requireActual, so the test and the mock share this one store). Not a
 * test file itself (no .test. in the name).
 */

export interface RecordedListRequest {
  attributes: Record<string, unknown>;
  select: Record<string, boolean>;
  ids?: Array<string> | undefined;
  limit: number;
}

export const eventLogStore: {
  logs: Array<StoredKubernetesEventLog>;
  requests: Array<RecordedListRequest>;
  // The message the next read fails with, once.
  failNextRead: string | null;
  nextId: number;
} = {
  logs: [],
  requests: [],
  failNextRead: null,
  nextId: 1,
};

export function resetEventLogStore(): void {
  eventLogStore.logs = [];
  eventLogStore.requests = [];
  eventLogStore.failNextRead = null;
  eventLogStore.nextId = 1;
}

export function putEvent(
  fields: KubernetesEventFields,
  options: {
    clusterName: string;
    watchType?: WatchType | undefined;
    stamped?: boolean | undefined;
  },
): void {
  eventLogStore.logs.push(
    storedKubernetesEventLog({
      fields: fields,
      clusterName: options.clusterName,
      watchType: options.watchType,
      stamped: options.stamped,
      id: `00000000-0000-4000-8000-${String(eventLogStore.nextId++).padStart(12, "0")}`,
    }),
  );
}

function matchesAttribute(value: unknown, wanted: unknown): boolean {
  const text: string = value === undefined ? "" : String(value);

  if (wanted && typeof wanted === "object") {
    const operator: { values?: Array<unknown>; value?: unknown } = wanted as {
      values?: Array<unknown>;
      value?: unknown;
    };

    if (Array.isArray(operator.values)) {
      return operator.values.map(String).includes(text);
    }

    // StartsWith, matched as the server does: without regard to case.
    return text.toLowerCase().startsWith(String(operator.value).toLowerCase());
  }

  return text === String(wanted);
}

export async function eventLogStoreGetList(options: {
  query: {
    time: { startValue: Date; endValue: Date };
    attributes: Record<string, unknown>;
    _id?: { values: Array<unknown> } | undefined;
  };
  select: Record<string, boolean>;
  limit: number;
}): Promise<{ data: Array<Log>; hasMore: boolean }> {
  if (eventLogStore.failNextRead) {
    const message: string = eventLogStore.failNextRead;
    eventLogStore.failNextRead = null;
    throw new Error(message);
  }

  const ids: Array<string> | undefined = options.query._id?.values.map(String);

  eventLogStore.requests.push({
    attributes: options.query.attributes,
    select: options.select,
    ids: ids,
    limit: options.limit,
  });

  const matching: Array<StoredKubernetesEventLog> = eventLogStore.logs
    .filter((log: StoredKubernetesEventLog): boolean => {
      return (
        log.time >= options.query.time.startValue &&
        log.time <= options.query.time.endValue &&
        (!ids || ids.includes(log._id)) &&
        Object.keys(options.query.attributes).every((key: string): boolean => {
          return matchesAttribute(
            log.attributes[key],
            options.query.attributes[key],
          );
        })
      );
    })
    .sort((a: StoredKubernetesEventLog, b: StoredKubernetesEventLog) => {
      return b.time.getTime() - a.time.getTime();
    });

  return {
    data: matching
      .slice(0, options.limit)
      .map((stored: StoredKubernetesEventLog): Log => {
        const log: Log = new Log();
        log._id = new ObjectID(stored._id);
        log.time = stored.time;
        log.attributes = stored.attributes;
        if (options.select["body"]) {
          log.body = stored.body;
        }
        return log;
      }),
    hasMore: matching.length > options.limit,
  };
}
