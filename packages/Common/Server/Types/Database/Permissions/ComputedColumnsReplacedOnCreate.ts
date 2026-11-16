/*
 * THE SERVER-SET COLUMNS WHOSE VALUE ON A CREATE IS REPLACED, WHOEVER SENDS
 * IT.
 *
 * On a create, a value a write gives a computed column - one OneUptime fills
 * in - is held to the column's create list, as every other column's is
 * (ColumnPermission.checkComputedColumnsSentOnCreate). A value the caller may
 * not create is dropped when the caller may read the column, as a record read
 * and sent back whole carries it, and refused when they may not.
 *
 * The columns below are dropped whoever sends them, by name. Each one's own
 * declaration has always said that a value a create sends is replaced, and
 * its service fills it in on every create; refusing it would break the
 * creates that send it, some from callers who cannot read it. The value is
 * dropped before the hooks run, so the create goes on as if it had not been
 * sent, and the service fills the column in as it always did. Nothing a
 * caller sends reaches the record either way.
 *
 * ComputedColumnsFollowTheirCreateList.test.ts holds every computed column of
 * every model to the rule, and each name here to being a computed column
 * nobody may create.
 */

export interface ComputedColumnReplacedOnCreate {
  tableName: string;
  column: string;
  // Who sends it, and what fills it in instead.
  why: string;
}

export const COMPUTED_COLUMNS_REPLACED_ON_CREATE: ReadonlyArray<ComputedColumnReplacedOnCreate> =
  [
    {
      tableName: "File",
      column: "projectId",
      why: "The project a file is uploaded in, which no caller may read. A client sends a project ID with every create, as every other model takes one, and FileService stamps the request's project over it on every upload.",
    },
    {
      tableName: "Form",
      column: "shareKey",
      why: "The key in a form's link. FormService mints a fresh one on every create, whatever the create sends, so nobody chooses the key a form starts with; the product's own browser tests send one to prove it.",
    },
    {
      tableName: "PacketCapture",
      column: "name",
      why: "What the audit log and the lists name a capture by. PacketCaptureService writes it from the interface and the filter on every create.",
    },
    {
      tableName: "LlmProvider",
      column: "hasAdditionalParams",
      why: "Whether a provider has Additional Parameters, which Postgres works out on every read and never stores, so nothing a create sends is ever written to it.",
    },
  ];

export default class ComputedColumnsReplacedOnCreate {
  // Whether a create's value for `column` of `tableName` is replaced whoever sends it.
  public static isReplaced(
    tableName: string | null | undefined,
    column: string,
  ): boolean {
    return COMPUTED_COLUMNS_REPLACED_ON_CREATE.some(
      (entry: ComputedColumnReplacedOnCreate): boolean => {
        return entry.tableName === tableName && entry.column === column;
      },
    );
  }
}
