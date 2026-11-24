import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ServerOwned from "../../../Types/Database/ServerOwned";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import ColumnWriteRefusedException from "../../Types/Database/Permissions/ColumnWriteRefusedException";
import ServerSetColumns from "./ServerSetColumns";

/*
 * THE COLUMNS ONLY ONEUPTIME WRITES TAKE NO VALUE FROM A CREATE OR AN
 * UPDATE MADE THROUGH THE API (#10053).
 *
 * A column marked ServerOwned.Always is OneUptime's alone to write: when a
 * telemetry monitor last ran, an agent's last report, an SLA's deadlines,
 * when a SCIM connection's client secret stops working. The API reference
 * has said so since #9985 - read only, and in no create or update schema -
 * and the Terraform and Crossplane providers never send one. The API itself
 * still took a value for one from anyone its permissions let write it, and
 * for a few the value mattered while it lasted: a project owner could set a
 * SCIM client secret's expiry past what rotating the secret gives.
 *
 * Now a write that is not OneUptime's own - a person's request, an API
 * key's, a workflow step's, MCP's - gives none of them a value, checked on
 * what the caller sent, before any hook reads the write:
 *
 *   - a create drops the value, as it drops a computed column's the caller
 *     may read (ColumnPermission.checkComputedColumnsSentOnCreate). A create
 *     that carries one is a copy of a record read before - a status page's
 *     JSON import, `oneuptime <resource> get` then `create`, an agent's copy
 *     through MCP - and goes on as if the value had not been sent: the new
 *     record starts with OneUptime's value;
 *   - an update that names one is refused with the API's 400, naming every
 *     such column it names, as an update of any column the caller may not
 *     change is (ColumnWriteRefusedException): nothing the Dashboard, the
 *     CLI, MCP or the providers send echoes one back, and an update that
 *     sends a whole record back is refused already, for its projectId.
 *
 * What keeps writing them:
 *
 *   - OneUptime's own writers, which run as root: a check, ingest, an
 *     agent's report, a worker, a rule;
 *   - a server admin, as no column check asks one: the admin dashboard sets
 *     a project's seat and monitor limits;
 *   - a value OneUptime's own code filled in for a write it makes as a
 *     person, and marked so (ServerSetColumns): the expiry of a SCIM client
 *     secret the person rotates, the serial number of a device a network
 *     controller adds for them, the Slack message a note they posted came
 *     from, what discovery found for a device they import;
 *   - a service's hook, which runs after this and may fill one in for the
 *     record a person writes.
 */
export default class ColumnsOnlyOneUptimeWrites {
  private static readonly columnsByTable: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();

  /*
   * The columns of `model` only OneUptime writes, under both names of a
   * reference: the column marked ServerOwned.Always, and the relation or
   * the ID column that names the same record (manyToOneRelationColumn).
   */
  public static getColumns(model: BaseModel): Array<string> {
    const key: string = model.tableName || model.constructor.name;
    const cached: Array<string> | undefined =
      ColumnsOnlyOneUptimeWrites.columnsByTable.get(key);

    if (cached) {
      return cached;
    }

    const columns: Array<string> = model.getTableColumns().columns;

    const marked: Set<string> = new Set<string>(
      columns.filter((column: string): boolean => {
        return (
          model.getTableColumnMetadata(column)?.serverOwned ===
          ServerOwned.Always
        );
      }),
    );

    // The ID column of each marked relation.
    const idColumnsOfMarked: Set<string> = new Set<string>();

    for (const column of marked) {
      const idColumn: string | undefined =
        model.getTableColumnMetadata(column)?.manyToOneRelationColumn;

      if (idColumn) {
        idColumnsOfMarked.add(idColumn);
      }
    }

    const withRelations: Array<string> = columns.filter(
      (column: string): boolean => {
        if (marked.has(column) || idColumnsOfMarked.has(column)) {
          return true;
        }

        // The relation of a marked ID column.
        const metadata: TableColumnMetadata | undefined =
          model.getTableColumnMetadata(column);

        return Boolean(
          metadata?.manyToOneRelationColumn &&
            marked.has(metadata.manyToOneRelationColumn),
        );
      },
    );

    ColumnsOnlyOneUptimeWrites.columnsByTable.set(key, withRelations);

    return withRelations;
  }

  /*
   * Whether a write may give these columns a value: OneUptime's own, as
   * root, or a server admin's. A person's request, an API key's, a workflow
   * step's and MCP's may not, whatever they may do otherwise.
   */
  public static mayWrite(props: DatabaseCommonInteractionProps): boolean {
    return Boolean(props.isRoot || props.isMasterAdmin);
  }

  /*
   * The columns only OneUptime writes that `record` gives a value, leaving
   * out the ones OneUptime's own code filled in (ServerSetColumns) - none
   * for a write that may give them one (mayWrite).
   */
  public static getSentByCaller(data: {
    model: BaseModel;
    record: unknown;
    props: DatabaseCommonInteractionProps;
  }): Array<string> {
    if (
      ColumnsOnlyOneUptimeWrites.mayWrite(data.props) ||
      !data.record ||
      typeof data.record !== "object"
    ) {
      return [];
    }

    const record: Record<string, unknown> = data.record as Record<
      string,
      unknown
    >;

    return ColumnsOnlyOneUptimeWrites.getColumns(data.model).filter(
      (column: string): boolean => {
        return (
          record[column] !== undefined &&
          !ServerSetColumns.isMarked(data.record, column)
        );
      },
    );
  }

  /*
   * A create: takes every value the caller gave a column only OneUptime
   * writes out of `record`, and returns the columns it took out. Cleared
   * rather than deleted on a model instance: `record` is the caller's (see
   * BaseAPI.createItem).
   */
  public static takeOut(data: {
    model: BaseModel;
    record: unknown;
    props: DatabaseCommonInteractionProps;
  }): Array<string> {
    const takenOut: Array<string> =
      ColumnsOnlyOneUptimeWrites.getSentByCaller(data);

    const record: Record<string, unknown> = data.record as Record<
      string,
      unknown
    >;

    for (const column of takenOut) {
      if (data.record instanceof BaseModel) {
        record[column] = undefined;
      } else {
        delete record[column];
      }
    }

    return takenOut;
  }

  /*
   * An update: refuses one that gives a column only OneUptime writes a
   * value, naming every such column it names - the API's 400, as for any
   * column the caller may not change.
   */
  public static refuseOnUpdate(data: {
    model: BaseModel;
    record: unknown;
    props: DatabaseCommonInteractionProps;
  }): void {
    const named: Array<string> =
      ColumnsOnlyOneUptimeWrites.getSentByCaller(data);

    if (named.length === 0) {
      return;
    }

    throw new ColumnWriteRefusedException({
      requestType: DatabaseRequestType.Update,
      columnName: named[0]!,
      columnNames: named,
      modelName: data.model.singularName,
      // Nobody: the refusal says the server changes them.
      permissions: [],
    });
  }
}
