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
   * Whether the reader reads every record of the model in their project:
   * their read adds no condition beyond the project. Such a reader hears
   * about every record, as before, with no read per record.
   */
  readsEveryRecord(reader: RealtimeReader): Promise<boolean>;
  /*
   * Of `modelIds` - records of the reader's project - the ones the reader
   * may read now.
   */
  getReadableIds(
    reader: RealtimeReader,
    modelIds: Array<ObjectID>,
  ): Promise<Array<string>>;
}

// Reads nothing: for an event whose audience could not be worked out.
export const NO_READER_ACCESS: RealtimeReadAccess = {
  readsEveryRecord: async (): Promise<boolean> => {
    return false;
  },
  getReadableIds: async (): Promise<Array<string>> => {
    return [];
  },
};

// A record id as every comparison here reads it.
export function normalizeRealtimeId(id: ObjectID | string): string {
  return id.toString().trim().toLowerCase();
}
