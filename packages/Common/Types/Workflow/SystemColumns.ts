/*
 * Columns OneUptime fills in itself, which a workflow builder never types.
 *
 * The record editor's "Add a field" list is built from /model-schema, and that
 * endpoint gates columns on their permission lists. The record's own ID and
 * timestamps borrow the model's record-level permissions
 * (DatabaseBaseModel.getColumnAccessControlForAllColumns), and createdByUserId
 * carries a create list on almost every model, so Create One Incident offered
 * "Created At", "Updated At" and "Created by User ID" next to the incident's
 * real fields - each one a value the server stamps on its own.
 *
 * Most such columns are already marked on the model: `computed: true` covers
 * the ID, the timestamps, every slug, numbering and notification status, and
 * forceGetDefaultValueOnCreate overwrites whatever is sent. This list is the
 * backstop for the ones no flag describes, and the one place both the
 * endpoint and the editor read, so they cannot disagree.
 */

/**
 * Columns every model inherits from DatabaseBaseModel, plus the "who did it"
 * columns the write path stamps from the request (DatabaseService sets
 * createdByUserId on create and archivedAt/archivedByUserId when a record is
 * archived).
 */
const SYSTEM_COLUMN_IDS: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
  "createdByUserId",
  "createdByUser",
  "deletedByUserId",
  "deletedByUser",
  "archivedAt",
  "archivedByUserId",
  "archivedByUser",
];

/*
 * Columns that hold nothing on any record a workflow can find. Records are
 * deleted outright (DatabaseService.deleteBy hard-deletes, and its write of
 * deletedByUserId is commented out for exactly that reason), so "Deleted At"
 * and "Deleted by User" are empty on every row there is, and the version
 * counter is internal. Offering them as a filter or a field to read back
 * offers a question with one answer.
 */
const ALWAYS_EMPTY_COLUMN_IDS: Array<string> = [
  "deletedAt",
  "deletedByUserId",
  "deletedByUser",
  "version",
];

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
