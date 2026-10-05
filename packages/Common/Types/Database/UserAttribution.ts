import { ColumnAccessControl } from "../BaseDatabase/AccessControl";

/*
 * WHO DID SOMETHING TO A RECORD IS FOR ONEUPTIME TO SAY.
 *
 * A model records each act a person can do to one of its records in a column
 * named for the act: who created it (`createdByUserId`), archived it
 * (`archivedByUserId`), acknowledged it, triggered it, pinned it, marked it as
 * resolved. The ID column ends in `ByUserId`, and the relation over it, when
 * the model has one, has the same name without the `Id`: `createdByUser`.
 *
 * None of them is a choice a write makes. OneUptime decides each one:
 *
 *  - DatabaseService takes them out of every write it did not make itself -
 *    a request through the API (a person's, an API key's, Terraform's), a
 *    workflow, the admin dashboard - under both names, before the services'
 *    hooks read the write. A create is then stamped with the person making
 *    it as its creator, and with nobody when there is no person: an API key
 *    or a workflow creates a record no person created. The services stamp
 *    the person into the columns about the request itself (who triggered an
 *    on-call policy, who pinned a recording), and an archive or a resolve
 *    stamps who did it.
 *  - OneUptime's own server code - a job, an engine, a Slack action acting
 *    for the person who clicked - names the person it acts for, and that is
 *    what is saved.
 *  - So the API offers them for reading only: every such column is computed
 *    and closed to every write here, the way File.isPublic is, which is what
 *    the API reference and the Terraform provider are generated from. A value
 *    a request still sends is dropped, never refused, so a client that sends
 *    one keeps working.
 *
 * The rule follows the name, so a new model's columns are covered as soon as
 * they are declared; UserAttributionColumns.test.ts holds every model to it.
 */

// `createdByUserId`, `archivedByUser`, `markedAsResolvedByUserId`.
const USER_ATTRIBUTION_COLUMN_NAME: RegExp = /^[a-z][A-Za-z0-9]*ByUser(Id)?$/;

export const CREATED_BY_USER_ID_COLUMN: string = "createdByUserId";
export const CREATED_BY_USER_COLUMN: string = "createdByUser";

/*
 * The parts of a model this needs. Structural, so this file imports no model
 * and the decorators that call it can stay at the bottom of the import graph.
 */
export interface ModelWithUserAttribution {
  getTableColumns(): { columns: Array<string> };
  getTableColumnMetadata(
    columnName: string,
  ): { manyToOneRelationColumn?: string | undefined } | undefined;
}

export default class UserAttribution {
  // Whether a column records who did something to its record.
  public static isColumn(columnName: string | symbol | undefined): boolean {
    return (
      typeof columnName === "string" &&
      USER_ATTRIBUTION_COLUMN_NAME.test(columnName)
    );
  }

  /*
   * The access a model declares for one of its columns, as it applies: who
   * did something to a record is read as the model says, and written by no
   * request. Other columns are returned as they are.
   */
  public static getAccessControl(
    columnName: string | symbol | undefined,
    accessControl: ColumnAccessControl,
  ): ColumnAccessControl {
    if (!UserAttribution.isColumn(columnName)) {
      return accessControl;
    }

    return {
      ...accessControl,
      create: [],
      update: [],
    };
  }

  /*
   * A column's metadata, as it applies: who did something to a record is
   * computed - OneUptime fills it in - so the create's column check skips it,
   * and the API reference and the Terraform provider offer it for reading
   * only. Other columns are returned as they are.
   */
  public static getColumnMetadata<T extends { computed?: boolean | undefined }>(
    columnName: string | symbol | undefined,
    metadata: T,
  ): T {
    if (!UserAttribution.isColumn(columnName)) {
      return metadata;
    }

    return {
      ...metadata,
      computed: true,
    };
  }

  /*
   * Every column of a model that records who did something to its records,
   * under both of their names: the ID columns and the relations named for an
   * act, and any relation over one of those ID columns whatever it is called.
   */
  public static getColumns(model: ModelWithUserAttribution): Array<string> {
    const columns: Array<string> = model.getTableColumns().columns;

    const idColumns: Set<string> = new Set<string>(
      columns.filter((columnName: string): boolean => {
        return UserAttribution.isColumn(columnName);
      }),
    );

    return columns.filter((columnName: string): boolean => {
      if (idColumns.has(columnName)) {
        return true;
      }

      const relationColumn: string | undefined =
        model.getTableColumnMetadata(columnName)?.manyToOneRelationColumn;

      return Boolean(relationColumn && idColumns.has(relationColumn));
    });
  }
}
