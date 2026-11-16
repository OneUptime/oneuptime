/*
 * THE SERVER-SET COLUMNS WHOSE VALUE ON A CREATE IS REPLACED, NOT REFUSED.
 *
 * On a create, a value a write gives a computed column - one OneUptime fills
 * in - is held to the column's create list, as every other column's is: it
 * is refused for anyone not on it (ColumnPermission
 * .checkComputedColumnsSentOnCreate). The columns below are the exceptions,
 * by name. Each one's own declaration has always said that a value a create
 * sends is replaced, and its service fills it in on every create; refusing it
 * would break the creates that send it. For these the value is dropped
 * before the hooks run, so the create goes on as if it had not been sent, and
 * the service fills the column in as it always did. Nothing a caller sends
 * reaches the record either way.
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
      why: "The project a file is uploaded in. A client sends a project ID with every create, as every other model takes one, and FileService stamps the request's project over it on every upload.",
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
  ];

export default class ComputedColumnsReplacedOnCreate {
  // Whether a create's value for `column` of `tableName` is replaced rather than refused.
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
