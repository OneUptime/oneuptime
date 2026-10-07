import {
  RealtimeReadAccess,
  RealtimeReader,
  normalizeRealtimeId,
} from "./RealtimeReadAccess";
import RealtimeReaders, { RealtimeReaderIdentity } from "./RealtimeReaders";
import {
  TopologyConcurrencyLimiter,
  TopologyRequestAbandonedError,
} from "../Topology/TopologyConcurrencyLimiter";
import logger, { LogAttributes } from "../Logger";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import ArrayUtil from "../../../Utils/Array";

/*
 * WHICH OF SOME RECORDS EACH LISTENER MAY READ, by the records' own read
 * (RealtimeReadAccess).
 *
 * The work is bounded, because it runs for writes in busy projects:
 *
 *   - one answer per person, however many sockets (tabs) they have open;
 *   - a person who reads every record of the model (a grant over the whole
 *     project, no block with labels, nothing their read narrows) costs no
 *     read at all: that is decided once and kept with them
 *     (RealtimeReaders);
 *   - anyone else costs one read per batch of records - the record ids of
 *     all the events that arrived together - not one per record;
 *   - at most READERS_AT_A_TIME of a batch's people are worked out at once,
 *     and the reads themselves take a slot of READ_LIMITS: a few per server
 *     and per project, with a bounded queue. A read that finds the queue
 *     full or waits too long is not made, and that person does not hear
 *     about the batch: nobody hears about a record nobody checked. An
 *     access that answers from what it already knows takes no slot.
 */
export default class RealtimeAudience {
  // People of one batch worked out at the same time.
  public static readonly READERS_AT_A_TIME: number = 4;

  // The reads made to decide who hears about records, per server.
  public static readonly READ_LIMITS: {
    maxRunning: number;
    maxRunningPerProject: number;
    maxWaiting: number;
    maxWaitingPerProject: number;
    maxWaitMs: number;
  } = {
    maxRunning: 8,
    maxRunningPerProject: 4,
    maxWaiting: 2000,
    maxWaitingPerProject: 200,
    maxWaitMs: 15_000,
  };

  private static limiter: TopologyConcurrencyLimiter =
    new TopologyConcurrencyLimiter(RealtimeAudience.READ_LIMITS);

  /*
   * For each listener (by RealtimeReaders.getKey), the ids of `modelIds`
   * they may read, lower case. Never throws: a listener whose answer cannot
   * be worked out reads none of them.
   *
   * `onlyFor`, when given, picks the readers worth asking; the others read
   * none of the records here. `deadlineMs` (a time, as Date.now() counts)
   * is when the answer stops being wanted: a person not worked out by then
   * reads none of them, no read starts after it, and a read still waiting
   * for a slot gives its place up at once. `ownerIds` is handed to the
   * access with the records (RealtimeReadAccess.getReadableIds).
   */
  public static async getReadableIds(data: {
    tenantId: string;
    access: RealtimeReadAccess;
    readers: Array<RealtimeReaderIdentity>;
    modelIds: Array<string>;
    ownerIds?: ReadonlyMap<string, string> | undefined;
    onlyFor?: ((reader: RealtimeReader) => Promise<boolean>) | undefined;
    deadlineMs?: number | undefined;
  }): Promise<Map<string, Set<string>>> {
    const readable: Map<string, Set<string>> = new Map<string, Set<string>>();
    const distinctIds: Array<string> = Array.from(
      new Set<string>(data.modelIds.map(normalizeRealtimeId)),
    );

    // One answer per person in the project.
    const people: Map<string, RealtimeReaderIdentity> = new Map<
      string,
      RealtimeReaderIdentity
    >();

    for (const identity of data.readers) {
      people.set(RealtimeReaders.getKey(identity, data.tenantId), identity);
    }

    // At the deadline, reads still waiting for a slot leave the queue.
    const deadline: AbortController | null =
      data.deadlineMs !== undefined ? new AbortController() : null;
    const deadlineTimer: ReturnType<typeof setTimeout> | null = deadline
      ? setTimeout(
          (): void => {
            deadline.abort();
          },
          Math.max(0, data.deadlineMs! - Date.now()),
        )
      : null;

    try {
      await ArrayUtil.forEachWithConcurrency(
        Array.from(people.entries()),
        RealtimeAudience.READERS_AT_A_TIME,
        async ([key, identity]: [
          string,
          RealtimeReaderIdentity,
        ]): Promise<void> => {
          if (RealtimeAudience.isPast(data.deadlineMs)) {
            return;
          }

          readable.set(
            key,
            await RealtimeAudience.getReadableIdsOf({
              identity: identity,
              tenantId: data.tenantId,
              access: data.access,
              modelIds: distinctIds,
              ownerIds: data.ownerIds,
              onlyFor: data.onlyFor,
              deadlineMs: data.deadlineMs,
              signal: deadline?.signal,
            }),
          );
        },
      );
    } finally {
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
      }
    }

    return readable;
  }

  private static isPast(deadlineMs: number | undefined): boolean {
    return deadlineMs !== undefined && Date.now() >= deadlineMs;
  }

  private static async getReadableIdsOf(data: {
    identity: RealtimeReaderIdentity;
    tenantId: string;
    access: RealtimeReadAccess;
    modelIds: Array<string>;
    ownerIds?: ReadonlyMap<string, string> | undefined;
    onlyFor?: ((reader: RealtimeReader) => Promise<boolean>) | undefined;
    deadlineMs?: number | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<Set<string>> {
    const logAttributes: LogAttributes = {
      projectId: data.tenantId,
      userId: data.identity.userId,
    };

    if (data.modelIds.length === 0) {
      return new Set<string>();
    }

    let reader: RealtimeReader | null = null;

    try {
      reader = await RealtimeReaders.getReader(data.identity, data.tenantId);
    } catch (err) {
      logger.error(
        "Realtime: could not read a listener's permissions; they do not hear about this change.",
        logAttributes,
      );
      logger.error(err, logAttributes);
      return new Set<string>();
    }

    // No longer a member of the project: nothing to hear about there.
    if (!reader) {
      return new Set<string>();
    }

    if (data.onlyFor) {
      let asked: boolean = false;

      try {
        asked = await data.onlyFor(reader);
      } catch (err) {
        logger.debug(err, logAttributes);
        asked = false;
      }

      if (!asked) {
        return new Set<string>();
      }
    }

    let readsEveryRecord: boolean = false;

    try {
      readsEveryRecord = await data.access.readsEveryRecord(reader);
    } catch (err) {
      // Read record by record instead.
      logger.debug(err, logAttributes);
      readsEveryRecord = false;
    }

    if (readsEveryRecord) {
      return new Set<string>(data.modelIds);
    }

    const readerOfBatch: RealtimeReader = reader;

    const read: () => Promise<Array<string>> = (): Promise<Array<string>> => {
      // Not wanted any more: no read starts past the deadline.
      if (RealtimeAudience.isPast(data.deadlineMs)) {
        return Promise.resolve([]);
      }

      return data.access.getReadableIds(
        readerOfBatch,
        data.modelIds.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
        data.ownerIds,
      );
    };

    try {
      // An answer from what the access already knows needs no read slot.
      const ids: Array<string> = data.access.answersWithoutReading
        ? await read()
        : await RealtimeAudience.limiter.run(data.tenantId, read, data.signal);

      const asked: Set<string> = new Set<string>(data.modelIds);

      // Only ever the records asked about.
      return new Set<string>(
        ids.map(normalizeRealtimeId).filter((id: string): boolean => {
          return asked.has(id);
        }),
      );
    } catch (err) {
      if (err instanceof TooManyRequestsException) {
        logger.warn(
          "Realtime: too many live update checks are waiting on this server; a listener does not hear about this change.",
          logAttributes,
        );
      } else if (err instanceof TopologyRequestAbandonedError) {
        // Its time ran out while it waited: the answer is no longer wanted.
        logger.debug(
          "Realtime: a live update check was not reached in time; a listener does not hear about this change.",
          logAttributes,
        );
      } else if (
        err instanceof NotAuthorizedException ||
        err instanceof NotAuthenticatedException ||
        err instanceof PaymentRequiredException
      ) {
        // Their read is refused: they may read none of these records.
        logger.debug(err, logAttributes);
      } else {
        logger.error(
          "Realtime: could not check what a listener may read; they do not hear about this change.",
          logAttributes,
        );
        logger.error(err, logAttributes);
      }

      return new Set<string>();
    }
  }
}
