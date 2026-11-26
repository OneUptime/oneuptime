import { RECORD_ACTOR_COLUMNS } from "../Database/RecordActor";

/*
 * Columns OneUptime fills in itself, which a workflow builder never types.
 *
 * The record editor's "Add a field" list is built from /model-schema, and that
 * endpoint gates columns on their permission lists. The record's own ID and
 * timestamps borrow the model's record-level permissions
 * (DatabaseBaseModel.getColumnAccessControlForAllColumns), so Create One
 * Incident offered "Created At" and "Updated At" next to the incident's real
 * fields - each one a value the server stamps on its own.
 *
 * Most such columns are already marked on the model: `computed: true` covers
 * the ID, the timestamps, every slug, numbering and notification status, and
 * every "who did it" column - createdByUserId, archivedByUserId and the rest
 * (UserAttribution) - while forceGetDefaultValueOnCreate overwrites whatever
 * is sent. This list is the backstop for the ones no flag describes, and the
 * one place both the endpoint and the editor read, so they cannot disagree.
 */

/**
 * Columns every model inherits from DatabaseBaseModel, plus the "who did it"
 * columns OneUptime decides itself (DatabaseService sets createdByUserId on
 * create and archivedAt/archivedByUserId when a record is archived; a
 * workflow never sets them - see UserAttribution). Those are computed now,
 * which the endpoint reports, and stay named here for the editor's fallback
 * (ColumnUse.isSystemColumn), which reads this list when a response carries
 * no flag.
 */
const SYSTEM_COLUMN_IDS: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
  "createdByUserId",
  "createdByUser",
  "archivedAt",
  "archivedByUserId",
  "archivedByUser",
  // What created the record and who last modified it (#10290).
  ...RECORD_ACTOR_COLUMNS,
];

/*
 * Columns that hold nothing on any record a workflow can find. Records are
 * deleted outright (DatabaseService.deleteBy hard-deletes), so "Deleted At"
 * is empty on every row there is, and the version counter is internal.
 * Offering them as a filter or a field to read back offers a question with
 * one answer. ("Deleted by User", empty for the same reason, is no column
 * any more: #10469.)
 */
const ALWAYS_EMPTY_COLUMN_IDS: Array<string> = ["deletedAt", "version"];

export type IsSystemColumnIdFunction = (columnId: string) => boolean;

export const isSystemColumnId: IsSystemColumnIdFunction = (
  columnId: string,
): boolean => {
  return SYSTEM_COLUMN_IDS.includes(columnId);
};

export type IsAlwaysEmptyColumnIdFunction = (columnId: string) => boolean;

export const isAlwaysEmptyColumnId: IsAlwaysEmptyColumnIdFunction = (
  columnId: string,
): boolean => {
  return ALWAYS_EMPTY_COLUMN_IDS.includes(columnId);
};

export type GetSystemColumnIdsFunction = () => Array<string>;

// A copy, so a caller cannot edit the list everyone else reads.
export const getSystemColumnIds: GetSystemColumnIdsFunction =
  (): Array<string> => {
    return [...SYSTEM_COLUMN_IDS];
  };

export type GetAlwaysEmptyColumnIdsFunction = () => Array<string>;

export const getAlwaysEmptyColumnIds: GetAlwaysEmptyColumnIdsFunction =
  (): Array<string> => {
    return [...ALWAYS_EMPTY_COLUMN_IDS];
  };
