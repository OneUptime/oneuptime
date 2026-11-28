/*
 * WHAT A RECORD'S PAGE NEEDS BESIDE ITS ID (#11020).
 *
 * A form's warning that a name is another record's links that record
 * (Common/UI/Components/Forms/DuplicateNameNotice), and Project Settings
 * links each record of a name the project holds twice (GET
 * /unique-names/duplicates). Most kinds open on a page of their own, by
 * their id, or on their list. A few open under a record or a page their own
 * columns name:
 *
 *   - an OpenStack budget, on its OpenStack cloud's Spend page - the
 *     cloud's id, openStackCloudId;
 *   - a workspace notification summary, on the Incidents or Alerts page of
 *     its workspace - Slack, Microsoft Teams or Mattermost - which its
 *     workspaceType and summaryType say.
 *
 * The server reads each record it names anyway, so it sends those columns'
 * values beside the record (pageFields), and the Dashboard builds the
 * address (App/FeatureSet/Dashboard/src/Components/UniqueNames/RecordPages).
 *
 * A value is sent only to a reader who may read it: the record's own
 * column, read with the reader's permissions, and a parent's id only when
 * the reader may read that parent too, since the page it opens is the
 * parent's. A record whose fields are not all there gets none, and is named
 * without a link: a link to a page that cannot open says nothing.
 *
 * React-free and server-safe: the server reads the declaration below, the
 * Dashboard reads what it sends.
 */

// A record's page fields, by column: values as the API writes them.
export type RecordPageFields = Record<string, string>;

export interface RecordPageField {
  // The record's column whose value the page's address needs.
  column: string;
  /*
   * The kind of record the column holds the id of, by its table: the page
   * opens under that record, so its id is sent only to a reader who may
   * read it.
   */
  parentTableName?: string | undefined;
}

// The kinds whose page needs more than their id, and what.
export const RECORD_PAGE_FIELDS: Readonly<
  Record<string, ReadonlyArray<RecordPageField>>
> = {
  OpenStackBudget: [
    { column: "openStackCloudId", parentTableName: "OpenStackCloud" },
  ],
  WorkspaceNotificationSummary: [
    { column: "workspaceType" },
    { column: "summaryType" },
  ],
};

// What a kind's page needs beside its id: nothing for most kinds.
export const getRecordPageFieldsOfKind: (
  tableName: string | null | undefined,
) => ReadonlyArray<RecordPageField> = (
  tableName: string | null | undefined,
): ReadonlyArray<RecordPageField> => {
  if (
    !tableName ||
    !Object.prototype.hasOwnProperty.call(RECORD_PAGE_FIELDS, tableName)
  ) {
    return [];
  }

  return RECORD_PAGE_FIELDS[tableName] || [];
};

/*
 * Reads a record's page fields back: text values by column. Anything that
 * is not that reads as none.
 */
export const readRecordPageFields: (
  value: unknown,
) => RecordPageFields | undefined = (
  value: unknown,
): RecordPageFields | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const fields: RecordPageFields = {};

  for (const [column, fieldValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (column && typeof fieldValue === "string" && fieldValue) {
      fields[column] = fieldValue;
    }
  }

  return Object.keys(fields).length > 0 ? fields : undefined;
};
