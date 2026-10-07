import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";

/*
 * WHO HEARS ABOUT A RECORD.
 *
 * A live update says that a record was created, changed or deleted, and
 * names it by id. It goes only to the people who may read that record, as
 * the record's own read decides it: the service's read hooks (private
 * incidents, alerts and episodes; a person's own AI conversations) and the
 * permission check that read runs (labels, owners, blocks with labels, the
 * labels of the records a label-less row names). Realtime asks; the service
 * that wrote the record answers (DatabaseService and AnalyticsDatabaseService
 * .getRealtimeReadAccess), so the answer is the read itself rather than a
 * copy of its rules.
 */

// One person listening in one project, as their reads see them.
export interface RealtimeReader {
  // The person in the project (RealtimeReaders.getKey).
  key: string;
  // Their props in the project, built as a request's are.
  props: DatabaseCommonInteractionProps;
  /*
   * A value worked out once for this reader while their entry lives
   * (RealtimeReaders.ENTRY_TTL_IN_MS, or until their permissions change):
   * whether they read every record of a model, the telemetry they may read.
   * A lookup that fails is not kept.
   */
  remember<T>(key: string, work: () => Promise<T>): Promise<T>;
}

export interface RealtimeReadAccess {
  /*
   * True when getReadableIds answers from what is already known - a
   * decision taken earlier, rows held in memory - without reading the
   * database. Such an answer takes no slot of the read limits
   * (RealtimeAudience.READ_LIMITS), so it is never refused for want of one.
   */
  answersWithoutReading?: boolean | undefined;
  /*
   * Whether the reader reads every record of the model in their project:
   * their read adds no condition beyond the project. Such a reader hears
   * about every record, as before, with no read per record.
   */
  readsEveryRecord(reader: RealtimeReader): Promise<boolean>;
  /*
   * Of `modelIds` - records of the reader's project - the ones the reader
   * may read now. `ownerIds`, when given, names the resource each record
   * belongs to (by normalizeRealtimeId), as the writer queued it with the
   * event: telemetry rows, which are not looked up by id.
   */
  getReadableIds(
    reader: RealtimeReader,
    modelIds: Array<ObjectID>,
    ownerIds?: ReadonlyMap<string, string> | undefined,
  ): Promise<Array<string>>;
}

// Reads nothing: for an event whose audience could not be worked out.
export const NO_READER_ACCESS: RealtimeReadAccess = {
  answersWithoutReading: true,
  readsEveryRecord: async (): Promise<boolean> => {
    return false;
  },
  getReadableIds: async (): Promise<Array<string>> => {
    return [];
  },
};

/*
 * A record either access lets the reader read. For an update that may take
 * a record away from someone: they hear about it if they could read it
 * before the write (`before`, decided then) or can read it now (`now`).
 */
export function readableByEither(
  now: RealtimeReadAccess,
  before: RealtimeReadAccess,
): RealtimeReadAccess {
  return {
    answersWithoutReading: Boolean(
      now.answersWithoutReading && before.answersWithoutReading,
    ),
    readsEveryRecord: async (reader: RealtimeReader): Promise<boolean> => {
      return (
        (await now.readsEveryRecord(reader)) ||
        (await before.readsEveryRecord(reader))
      );
    },
    getReadableIds: async (
      reader: RealtimeReader,
      modelIds: Array<ObjectID>,
      ownerIds?: ReadonlyMap<string, string> | undefined,
    ): Promise<Array<string>> => {
      const [readableNow, readableBefore]: [Array<string>, Array<string>] =
        await Promise.all([
          now.getReadableIds(reader, modelIds, ownerIds),
          before.getReadableIds(reader, modelIds, ownerIds),
        ]);

      return Array.from(
        new Set<string>(
          [...readableNow, ...readableBefore].map(normalizeRealtimeId),
        ),
      );
    },
  };
}

// A record id as every comparison here reads it.
export function normalizeRealtimeId(id: ObjectID | string): string {
  return id.toString().trim().toLowerCase();
}
