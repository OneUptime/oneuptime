import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../../Types/Permission";

/*
 * The words a refusal of one column says, for the five things a request does
 * with a column: give a new record a value in it (create), change it
 * (update), read it back (select), filter by it (query) and order a list by
 * it (sort) - in the database's permission checks (ColumnPermission,
 * SelectPermission, QueryPermission, SortValidator) and the analytics
 * database's (AnalyticsDatabase ModelPermission) alike, so the same refusal
 * reads the same wherever it comes from.
 *
 * A refusal is two sentences. The first names what was refused, in the
 * words it always had: clients read them. The generated Terraform provider
 * and the MCP server take the column out of "You do not have permissions to
 * select on - <column>" and retry without it
 * (SelectRejectionMessageContract), and the API reference quotes "User is
 * not allowed to create on <column> column of <Model>". The second says who
 * may - the column's own list - or, when the list is empty, that no
 * permission allows it: a column OneUptime alone writes or reads, where
 * asking an admin for a permission would get nobody anywhere. A refusal used
 * to end "You need any one of these permissions:" with nothing after it.
 */

export type ColumnOperation = "create" | "update" | "select" | "query" | "sort";

// Why nobody may: the column is the server's, for each operation.
export const NO_PERMISSION_ALLOWS: Record<ColumnOperation, string> = {
  create:
    "No permission allows it: the column is set by the server, not by a request.",
  update:
    "No permission allows it: the column is changed by the server, not by a request.",
  select:
    "No permission allows it: the column is not readable through the API.",
  query:
    "No permission allows it: the column cannot be filtered on through the API.",
  sort: "No permission allows it: a list cannot be sorted by the column through the API.",
};

/*
 * Grants OneUptime gives by itself - to any signed-in request, to a member
 * who has not signed in through the project's SSO yet - which nobody is
 * given, so a refusal does not name them. They have no title.
 */
// The same, of several columns one write is refused for.
export const NO_PERMISSION_ALLOWS_ANY_OF: Record<"create" | "update", string> =
  {
    create:
      "No permission allows it: these columns are set by the server, not by a request.",
    update:
      "No permission allows it: these columns are changed by the server, not by a request.",
  };

export const UNNAMED_GRANTS: ReadonlyArray<Permission> = [
  Permission.AuthenticatedRequest,
  Permission.UnAuthorizedSsoUser,
];

export default class ColumnRefusalMessage {
  /*
   * The second sentence: who may, from the column's list for the
   * operation, or that no permission does.
   */
  public static getWhoMay(
    operation: ColumnOperation,
    permissions: Array<Permission>,
  ): string {
    const list: Array<Permission> = permissions || [];

    // Decided by the list, never by the titles: an untitled permission still allows it.
    if (list.length === 0) {
      return NO_PERMISSION_ALLOWS[operation];
    }

    const named: Array<Permission> = list.filter(
      (permission: Permission): boolean => {
        return !UNNAMED_GRANTS.includes(permission);
      },
    );

    const known: Array<PermissionProps> =
      PermissionHelper.getAllPermissionProps();

    // A permission the catalogue has no title for is named by its key, never dropped.
    const titles: Array<string> = (named.length > 0 ? named : list).map(
      (permission: Permission): string => {
        return (
          known.find((item: PermissionProps): boolean => {
            return item.permission === permission;
          })?.title || permission
        );
      },
    );

    return `You need one of these permissions: ${titles.join(", ")}.`;
  }

  // A column a select clause names that the caller may not read.
  public static getSelectRefusal(data: {
    column: string;
    permissions: Array<Permission>;
  }): string {
    return `You do not have permissions to select on - ${data.column}. ${ColumnRefusalMessage.getWhoMay("select", data.permissions)}`;
  }

  // A column a query filters on that the caller may not read.
  public static getQueryRefusal(data: {
    column: string;
    permissions: Array<Permission>;
  }): string {
    return `You do not have permissions to query on - ${data.column}. ${ColumnRefusalMessage.getWhoMay("query", data.permissions)}`;
  }

  /*
   * A column a sort orders a list by that the caller may not read: where
   * each record falls in the order says what it holds (#8839).
   */
  public static getSortRefusal(data: {
    column: string;
    permissions: Array<Permission>;
  }): string {
    return `You do not have permissions to sort on - ${data.column}. ${ColumnRefusalMessage.getWhoMay("sort", data.permissions)}`;
  }

  /*
   * A column of a related record a sort orders a list by through a
   * relation - `{ probe: { key: "ASC" } }` - that the caller may not read.
   */
  public static getRelationSortRefusal(data: {
    column: string;
    relatedModelName: string;
    relationColumn: string;
    permissions: Array<Permission>;
  }): string {
    return `You do not have permissions to sort on - ${data.column} of ${data.relatedModelName} through ${data.relationColumn}. ${ColumnRefusalMessage.getWhoMay("sort", data.permissions)}`;
  }

  /*
   * A column of a related record a select reads through a relation that
   * only those who may read it on the related record read that way
   * (RelationReaders.ColumnReaders) - `{ dataStore: { sensitivity: true } }`
   * on a data asset - and the caller may not (#10281). Worded as the
   * owner-only refusal through a relation is
   * (OwnerOnlyColumnPermission.checkRelationSelect), never "select on -
   * <column>": the Terraform provider and the MCP server drop a column of
   * the select's own so named and retry (SelectRejectionMessageContract),
   * and this one is a related record's.
   */
  public static getRelationSelectRefusal(data: {
    column: string;
    relatedModelName: string;
    relationColumn: string;
    modelName: string;
    permissions: Array<Permission>;
  }): string {
    return `You do not have permissions to read ${data.column} of ${data.relatedModelName} through ${data.relationColumn} on ${data.modelName}. ${ColumnRefusalMessage.getWhoMay("select", data.permissions)}`;
  }

  /*
   * A column of a related record a query filters on through a relation -
   * `{ smtpConfig: { password: ... } }` - that the caller may not read.
   */
  public static getRelationQueryRefusal(data: {
    column: string;
    relatedModelName: string;
    relationColumn: string;
    permissions: Array<Permission>;
  }): string {
    return `You do not have permissions to query on - ${data.column} of ${data.relatedModelName} through ${data.relationColumn}. ${ColumnRefusalMessage.getWhoMay("query", data.permissions)}`;
  }

  /*
   * A column a create or an update writes that the caller may not write.
   * With no list, the first sentence alone: a refusal that is not about
   * permissions (IncidentService's second template).
   */
  public static getWriteRefusal(data: {
    // "create" or "update".
    requestType: string;
    column: string;
    modelName: string | null;
    permissions?: Array<Permission> | undefined;
    /*
     * Every column refused, when one write is refused for several - the
     * columns only OneUptime writes that an update names (#10053). `column`
     * is the first of them.
     */
    columns?: Array<string> | undefined;
  }): string {
    const columns: Array<string> =
      data.columns && data.columns.length > 1 ? data.columns : [data.column];

    const refusal: string = `User is not allowed to ${data.requestType} on ${columns.join(", ")} ${
      columns.length === 1 ? "column" : "columns"
    } of ${data.modelName}`;

    if (!data.permissions) {
      return refusal;
    }

    const operation: "create" | "update" =
      data.requestType === "update" ? "update" : "create";

    // Several columns nobody may write: said of them all.
    if (columns.length > 1 && data.permissions.length === 0) {
      return `${refusal}. ${NO_PERMISSION_ALLOWS_ANY_OF[operation]}`;
    }

    return `${refusal}. ${ColumnRefusalMessage.getWhoMay(operation, data.permissions)}`;
  }
}
