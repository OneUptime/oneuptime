import type DatabaseService from "../../Services/DatabaseService";
import type AuditLogServiceType from "../../Services/AuditLogService";
import ModelPermission from "../../Types/Database/Permissions/Index";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";
import RuleSetCache from "../Rules/RuleSetCache";
import StatusPageOverviewCache from "../StatusPage/StatusPageOverviewCache";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import MoveInListUtil, {
  ListPlace,
  MoveInListChanges,
} from "../../../Types/Database/MoveInList";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { EntityManager } from "typeorm";

/*
 * LISTS NUMBERED BY A COLUMN, KEPT BY PEOPLE AND BY TERRAFORM ALIKE (issues
 * #9573, #9609).
 *
 * Two kinds of list are numbered by a column, top first:
 *
 *   - five lists numbered by `order`, whose services keep them with the
 *     helpers below: the escalation rules of an on-call policy, the layers
 *     of a schedule, the people of a layer, the groups of a status page and
 *     the resources of a status page (or of one of its groups);
 *   - every list people put in order by dragging, marked @ListOrderColumn
 *     (Types/Database/ListOrderColumn), which DatabaseService keeps for
 *     every model alike (ListOrderMaintainer): severities, states, monitor
 *     statuses, custom fields, a status page's links, pipelines, filters
 *     and rules. Their column is `order`, `sortOrder` or `priority`, and two
 *     of them count down: the top is the highest number.
 *
 * Rows that share a number are read by id - DatabaseService breaks every tie
 * of a read by the primary key - so twins always come the same way round.
 *
 * A WRITE PLACES ITS OWN ROW, AND MOVES NO OTHER. A row created at a number,
 * a row given another number, a row deleted: each write changes that one row.
 * A row created without a number goes after the last row of its list
 * (getAppendOrder, ListOrderMaintainer). Terraform - and anything else that
 * keeps a whole list's numbering - writes each row's number on its own, the
 * changed rows all at once, in no set order, and every row must end at the
 * number written. When a write of a number moved the rows it passed, each
 * write renumbered rows another had just placed: the apply succeeded and the
 * next plan never came back empty (#9573, #9609), and a create that made
 * room (#12 of the provider) or a delete that closed its gap did the same to
 * the rows renumbered with it. Writes that each change one row cannot undo
 * each other, whatever order they land in. A list written this way may have
 * gaps, or twins until every write has landed; everything that reads these
 * lists goes by the order rows come in, or compares their numbers, never by
 * "the row numbered one more".
 *
 * A MOVE IS ITS OWN REQUEST (move, POST <list>/:id/move,
 * Types/Database/MoveInList). The Dashboard sends it when someone drags a
 * row or moves it up or down: the row takes the place of the row named, the
 * rows between step one place towards where it was, and the list is
 * numbered from scratch in its new order (1..n from the top, n..1 for a list
 * that counts down) - in a list numbered that way already, the rows between
 * the two places and no other, as moves always did. It reads and writes the
 * list in ONE transaction that first locks every row of the list, so two
 * moves at once run one after the other, each on the list as the other left
 * it, and a write of one row waits for a move holding it; nothing can leave
 * the list half moved, or two rows at one number.
 */

// What a statement read or wrote, however the driver handed it over.
type RawRow = Record<string, unknown>;

// TypeORM hands back an UPDATE as [rows, count], and other statements as their rows.
const getReturnedRows: (result: unknown) => Array<RawRow> = (
  result: unknown,
): Array<RawRow> => {
  if (!Array.isArray(result)) {
    return [];
  }

  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === "number"
  ) {
    return result[0] as Array<RawRow>;
  }

  return result as Array<RawRow>;
};

// A table or column name the statements below may name: letters and digits only.
const SAFE_NAME: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

const assertSafeName: (name: string) => void = (name: string): void => {
  if (!SAFE_NAME.test(name)) {
    throw new BadDataException(`"${name}" is not a column of a list.`);
  }
};

// The column the five lists are numbered by.
const DEFAULT_ORDER_COLUMN: string = "order";

// One column naming a row's list, and the value the row holds in it.
export interface ListColumnValue {
  column: string;
  value: string | null;
  /*
   * Whether the column holds an id, compared as one. A list may also be
   * named by a short text - a public note approval step's event type - which
   * is compared as it is. An id unless said otherwise.
   */
  isId?: boolean | undefined;
}

// The rows a move is about to give another number, before it writes them.
export interface ListMoveAboutToWrite {
  // Every row of the list as the lock handed it over, with its number.
  rows: Array<ListPlace>;
  // The rows given another number, the moved row among them.
  changedRows: Array<{ id: string; order: number }>;
}

/*
 * A check of a move before it writes, run in its transaction once the
 * list's rows are held: a list whose rows mean something in their order (a
 * project's states) refuses one that would break it, and nothing is
 * written.
 */
export type ListMoveCheck = (move: ListMoveAboutToWrite) => Promise<void>;

/*
 * A move a service is asked about before it writes (DatabaseService's
 * onBeforeMoveInList): the row moved, as read before it moved, the list as
 * the lock handed it over, the numbers the move gives, and who moves it.
 */
export interface ListMoveToCheck<TBaseModel extends BaseModel>
  extends ListMoveAboutToWrite {
  row: TBaseModel;
  props: DatabaseCommonInteractionProps;
}

export interface ContiguousOrderMoved<TBaseModel extends BaseModel> {
  // The moved row as read before it moved: its list, and what alsoSelect asked for.
  row: TBaseModel;
  // The rows given another number, the moved row among them.
  changedRows: Array<{ id: string; order: number }>;
}

export default class ContiguousOrder {
  /*
   * The number a row created without one takes: one past the last numbered
   * row of its list - so it goes at the end even when the list has gaps -
   * or 1 for the first. Read as root, within `list`, which names the list
   * and the project.
   */
  public static async getAppendOrder<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    list: Query<TBaseModel>;
  }): Promise<number> {
    const last: TBaseModel | null = await data.service.findOneBy({
      query: {
        ...data.list,
        order: QueryHelper.notNull(),
      } as Query<TBaseModel>,
      select: {
        _id: true,
        order: true,
      } as Select<TBaseModel>,
      sort: {
        order: SortOrder.Descending,
      } as Sort<TBaseModel>,
      props: {
        isRoot: true,
      },
    });

    const lastOrder: number = Number(
      (last as unknown as { order?: unknown } | null)?.order,
    );

    if (!last || !Number.isFinite(lastOrder) || lastOrder < 1) {
      return 1;
    }

    return Math.floor(lastOrder) + 1;
  }

  /*
   * The values a row holds in the columns that name its list, as a move's
   * statements hold it to that list: an id column as an id, a text column
   * as it is.
   */
  public static getListColumnValues<TBaseModel extends BaseModel>(data: {
    model: TBaseModel;
    row: TBaseModel;
    listColumns: Array<string>;
  }): Array<ListColumnValue> {
    return data.listColumns.map((column: string): ListColumnValue => {
      const value: unknown = (data.row as unknown as Record<string, unknown>)[
        column
      ];

      return {
        column: column,
        value: value === null || value === undefined ? null : value.toString(),
        isId:
          data.model.getTableColumnMetadata(column)?.type ===
          TableColumnType.ObjectID,
      };
    });
  }

  /*
   * Moves a row to the place another row of its list holds
   * (Types/Database/MoveInList): the caller must be allowed to give the row
   * another number, as a write of its number asks; the rows that step aside
   * are the move's own bookkeeping. `listColumns` are the columns that name
   * the row's list - its project among them - `orderColumn` the column that
   * numbers it (`order` unless said otherwise), `sortOrder` which end of the
   * numbers is the top, and `alsoSelect` the other columns of the moved row
   * its service needs afterwards. `check` may refuse the move once the list
   * is held, before anything is written.
   */
  public static async move<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    rowId: ObjectID;
    placeOfId: ObjectID;
    listColumns: Array<string>;
    orderColumn?: string | undefined;
    sortOrder?: SortOrder | undefined;
    alsoSelect?: Array<string> | undefined;
    check?:
      | ((move: ListMoveAboutToWrite & { row: TBaseModel }) => Promise<void>)
      | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<ContiguousOrderMoved<TBaseModel>> {
    const model: TBaseModel = data.service.getModel();
    const name: string = (model.singularName || "row").toLowerCase();
    const tableName: string = model.tableName || "";
    const tenantColumn: string | null = model.getTenantColumn();
    const projectId: ObjectID | undefined = data.props.tenantId;
    const orderColumn: string = data.orderColumn || DEFAULT_ORDER_COLUMN;

    if (!projectId || !tenantColumn) {
      throw new BadDataException("Project ID is required.");
    }

    if (!data.listColumns.includes(tenantColumn)) {
      throw new BadDataException(
        `A list of ${name}s is named by its project too (${tenantColumn}).`,
      );
    }

    assertSafeName(tableName);
    assertSafeName(orderColumn);

    for (const column of data.listColumns) {
      assertSafeName(column);
    }

    // The row, as the caller may give it another number.
    const permitted: Query<TBaseModel> =
      await ModelPermission.checkUpdateQueryPermissions(
        data.service.modelType,
        {
          _id: data.rowId,
          [tenantColumn]: projectId,
        } as Query<TBaseModel>,
        { [orderColumn]: 1 } as never,
        data.props,
      );

    const select: Record<string, boolean> = { _id: true, [orderColumn]: true };

    for (const column of [...data.listColumns, ...(data.alsoSelect || [])]) {
      select[column] = true;
    }

    const row: TBaseModel | null = await data.service.findOneBy({
      query: permitted,
      select: select as Select<TBaseModel>,
      props: {
        isRoot: true,
      },
    });

    if (!row || !row.id) {
      throw await data.service.getUnwrittenByIdError({
        id: data.rowId,
        props: data.props,
        type: DatabaseRequestType.Update,
      });
    }

    const check: ListMoveCheck | undefined = data.check
      ? async (move: ListMoveAboutToWrite): Promise<void> => {
          await data.check!({ ...move, row: row });
        }
      : undefined;

    const written: {
      changedRows: Array<{ id: string; order: number }>;
      previousOrders: Map<string, number | null>;
    } = await ContiguousOrder.moveRowOfList({
      service: data.service,
      list: ContiguousOrder.getListColumnValues({
        model: model,
        row: row,
        listColumns: data.listColumns,
      }),
      rowId: data.rowId,
      placeOfId: data.placeOfId,
      orderColumn: orderColumn,
      sortOrder: data.sortOrder,
      check: check,
    });

    await ContiguousOrder.recordInAuditLog({
      service: data.service,
      orderColumn: orderColumn,
      changedRows: written.changedRows,
      previousOrders: written.previousOrders,
      props: data.props,
    });

    return { row: row, changedRows: written.changedRows };
  }

  /*
   * The move of a row of the list `list` names, as OneUptime makes it: in
   * one transaction holding the list (moveWithinTransaction), and then
   * every process told the list changed - a status page shows its links,
   * groups and resources in their new order at once, and a project's rules
   * are tried in theirs (StatusPageOverviewCache, RuleSetCache, which a
   * write through the service tells too). No permission is asked: move
   * asks it for a caller, and OneUptime places rows of its own (a new state
   * just above the resolved one) through here.
   */
  public static async moveRowOfList<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    list: Array<ListColumnValue>;
    rowId: ObjectID;
    placeOfId: ObjectID;
    orderColumn?: string | undefined;
    sortOrder?: SortOrder | undefined;
    check?: ListMoveCheck | undefined;
  }): Promise<{
    changedRows: Array<{ id: string; order: number }>;
    previousOrders: Map<string, number | null>;
  }> {
    const model: TBaseModel = data.service.getModel();
    const name: string = (model.singularName || "row").toLowerCase();
    const tableName: string = model.tableName || "";
    const orderColumn: string = data.orderColumn || DEFAULT_ORDER_COLUMN;

    const written: {
      changedRows: Array<{ id: string; order: number }>;
      previousOrders: Map<string, number | null>;
    } = await data.service.executeTransaction(
      async (
        manager: EntityManager,
      ): Promise<{
        changedRows: Array<{ id: string; order: number }>;
        previousOrders: Map<string, number | null>;
      }> => {
        return await ContiguousOrder.moveWithinTransaction({
          manager: manager,
          tableName: tableName,
          list: data.list,
          rowId: data.rowId,
          placeOfId: data.placeOfId,
          name: name,
          orderColumn: orderColumn,
          sortOrder: data.sortOrder,
          check: data.check,
        });
      },
    );

    if (written.changedRows.length > 0) {
      const tenantColumn: string | null = model.getTenantColumn();
      const projectId: string | null =
        data.list.find((entry: ListColumnValue): boolean => {
          return entry.column === tenantColumn;
        })?.value || null;

      // Each changed row, as the caches read a written row: by its project.
      const rows: Array<JSONObject> = written.changedRows.map(
        (changed: { id: string }): JSONObject => {
          return { _id: changed.id, projectId: projectId };
        },
      );
      const writtenColumns: JSONObject = {
        [orderColumn]: written.changedRows[0]!.order,
      };

      await StatusPageOverviewCache.afterUpdate({
        tableName: tableName,
        rows: rows,
        written: writtenColumns,
      });

      await RuleSetCache.afterUpdate({
        tableName: tableName,
        rows: rows,
        written: writtenColumns,
      });
    }

    return written;
  }

  /*
   * The move itself, in the transaction it is handed: every row of the list
   * locked (in id order, as the schedule's save of its layers locks them,
   * so the two never wait for each other in a circle), read as they are
   * once the lock is had, checked (`check`), and the rows given another
   * number written in one statement.
   */
  public static async moveWithinTransaction(data: {
    manager: EntityManager;
    tableName: string;
    list: Array<ListColumnValue>;
    rowId: ObjectID;
    placeOfId: ObjectID;
    name: string;
    orderColumn?: string | undefined;
    sortOrder?: SortOrder | undefined;
    check?: ListMoveCheck | undefined;
  }): Promise<{
    changedRows: Array<{ id: string; order: number }>;
    previousOrders: Map<string, number | null>;
  }> {
    const orderColumn: string = data.orderColumn || DEFAULT_ORDER_COLUMN;

    assertSafeName(data.tableName);
    assertSafeName(orderColumn);

    const parameters: Array<unknown> = [];
    const where: Array<string> = ContiguousOrder.getListConditions(
      data.list,
      parameters,
    );

    const locked: Array<RawRow> = getReturnedRows(
      await data.manager.query(
        `SELECT "_id", "${orderColumn}" FROM "${data.tableName}" WHERE ${where.join(" AND ")} AND "deletedAt" IS NULL ORDER BY "_id" ASC FOR UPDATE`,
        parameters,
      ),
    );

    const places: Array<ListPlace> = locked.map((row: RawRow): ListPlace => {
      const order: unknown = row[orderColumn];

      return {
        id: String(row["_id"]),
        order: order === null || order === undefined ? null : Number(order),
      };
    });

    const changes: MoveInListChanges = MoveInListUtil.getChanges({
      rows: places,
      rowId: data.rowId.toString(),
      placeOfId: data.placeOfId.toString(),
      sortOrder: data.sortOrder,
    });

    if (changes.kind === "rowNotInList") {
      throw new NotFoundException(
        `This ${data.name} is no longer in its list. Reload to see the list as it is now.`,
      );
    }

    if (changes.kind === "placeNotInList") {
      throw new BadDataException(
        `The ${data.name} to move it to is not in the same list. Reload to see the list as it is now, and move it to the place of a ${data.name} in its list.`,
      );
    }

    const previousOrders: Map<string, number | null> = new Map<
      string,
      number | null
    >();

    for (const place of places) {
      previousOrders.set(
        place.id.toLowerCase(),
        typeof place.order === "number" ? place.order : null,
      );
    }

    if (changes.changedRows.length > 0 && data.check) {
      await data.check({ rows: places, changedRows: changes.changedRows });
    }

    if (changes.changedRows.length > 0) {
      const updateParameters: Array<unknown> = [];
      const updateWhere: Array<string> = ContiguousOrder.getListConditions(
        data.list,
        updateParameters,
      );
      const values: Array<string> = [];

      for (const changed of changes.changedRows) {
        updateParameters.push(changed.id, changed.order);
        values.push(
          `($${updateParameters.length - 1}::uuid, $${updateParameters.length}::integer)`,
        );
      }

      await data.manager.query(
        `UPDATE "${data.tableName}" AS "row" SET "${orderColumn}" = "moved"."order", "updatedAt" = now(), "version" = "row"."version" + 1 FROM (VALUES ${values.join(", ")}) AS "moved"("_id", "order") WHERE "row"."_id" = "moved"."_id" AND ${updateWhere
          .map((condition: string): string => {
            return `"row".${condition}`;
          })
          .join(" AND ")}`,
        updateParameters,
      );
    }

    return {
      changedRows: changes.changedRows,
      previousOrders: previousOrders,
    };
  }

  // The conditions that hold a statement to one list, its values as parameters.
  private static getListConditions(
    list: Array<ListColumnValue>,
    parameters: Array<unknown>,
  ): Array<string> {
    return list.map((entry: ListColumnValue): string => {
      assertSafeName(entry.column);

      if (entry.value === null) {
        return `"${entry.column}" IS NULL`;
      }

      parameters.push(entry.value);

      return entry.isId === false
        ? `"${entry.column}" = $${parameters.length}`
        : `"${entry.column}" = $${parameters.length}::uuid`;
    });
  }

  /*
   * The audit log's record of a move: each row given another number, by the
   * person who moved it, with its number before and after - as the save of
   * a schedule's layers records the rows it renumbers. Like every audit
   * write, it never fails the move (AuditLogService).
   */
  private static async recordInAuditLog<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    orderColumn: string;
    changedRows: Array<{ id: string; order: number }>;
    previousOrders: Map<string, number | null>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const model: TBaseModel = data.service.getModel();

    if (!model.enableAuditLogOn?.update || data.changedRows.length === 0) {
      return;
    }

    /*
     * Required here, not imported: DatabaseService moves the rows of every
     * drag-ordered list through this file, and AuditLogService reaches
     * services that extend DatabaseService - a top-level import would leave
     * DatabaseService undefined when they extend it (as DatabaseService
     * itself requires AuditLogService).
     */
    const AuditLogService: typeof AuditLogServiceType =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../../Services/AuditLogService").default;

    const select: Record<string, boolean> = {};

    for (const column of model.getTableColumns().columns) {
      select[column] = true;
    }

    const rows: Array<TBaseModel> = await data.service.findBy({
      query: {
        _id: QueryHelper.any(
          data.changedRows.map((changed: { id: string }): ObjectID => {
            return new ObjectID(changed.id);
          }),
        ),
      } as Query<TBaseModel>,
      select: select as Select<TBaseModel>,
      limit: data.changedRows.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const row of rows) {
      if (!row.id) {
        continue;
      }

      const id: string = row.id.toString().toLowerCase();
      const changed: { id: string; order: number } | undefined =
        data.changedRows.find((item: { id: string }): boolean => {
          return item.id.toLowerCase() === id;
        });

      if (!changed) {
        continue;
      }

      // The row as it was before the move: its number then.
      (row as unknown as Record<string, unknown>)[data.orderColumn] =
        data.previousOrders.get(id) ?? null;

      await AuditLogService.recordUpdate({
        model: model,
        before: row,
        updatedFields: { [data.orderColumn]: changed.order } as JSONObject,
        itemId: row.id,
        props: data.props,
      });
    }
  }
}
