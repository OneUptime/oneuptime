import type DatabaseService from "../../Services/DatabaseService";
import type AuditLogServiceType from "../../Services/AuditLogService";
import RuleSetCache from "../Rules/RuleSetCache";
import StatusPageOverviewCache from "../StatusPage/StatusPageOverviewCache";
import ModelPermission from "../../Types/Database/Permissions/Index";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import TableColumnType from "../../../Types/Database/TableColumnType";
import MoveInListUtil, {
  ListPlace,
  MoveInListChanges,
} from "../../../Types/Database/MoveInList";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { EntityManager } from "typeorm";

/*
 * LISTS NUMBERED BY AN `order` COLUMN, KEPT BY PEOPLE AND BY TERRAFORM ALIKE
 * (issue #9573).
 *
 * Five lists are numbered by `order`, lowest first: the escalation rules of
 * an on-call policy, the layers of a schedule, the people of a layer, the
 * groups of a status page and the resources of a status page (or of one of
 * its groups). Rows that share a number are read by id - DatabaseService
 * breaks every tie of a read by the primary key - so twins always come the
 * same way round. (Drag-ordered lists keep their numbers through
 * @ListOrderColumn instead.)
 *
 * A WRITE PLACES ITS OWN ROW, AND MOVES NO OTHER. A row created at a number,
 * a row given another number, a row deleted: each write changes that one row.
 * A row created without a number goes after the last row of its list
 * (getAppendOrder). Terraform - and anything else that keeps a whole list's
 * numbering - writes each row's number on its own, the changed rows all at
 * once, in no set order, and every row must end at the number written. When
 * a write of `order` moved the rows it passed, each write renumbered rows
 * another had just placed: the apply succeeded and the next plan never came
 * back empty (#9573), and a create that made room (#12 of the provider)
 * or a delete that closed its gap did the same to the rows renumbered with
 * it. Writes that each change one row cannot undo each other, whatever order
 * they land in. A list written this way may have gaps, or twins until every
 * write has landed; everything that reads these lists goes by the order rows
 * come in, never by "the row numbered one more".
 *
 * A MOVE IS ITS OWN REQUEST (move, POST <list>/:id/move,
 * Types/Database/MoveInList). The Dashboard sends it when someone drags a
 * row or moves it up or down: the row takes the place of the row named, the
 * rows between step one place towards where it was, and the list is
 * numbered 1..n in its new order - in a list numbered 1..n, the rows between
 * the two places and no other, as moves always did. It reads and writes the
 * list in ONE transaction that first locks every row of the list, so two
 * moves at once run one after the other, each on the list as the other left
 * it, and a write of one row waits for a move holding it; nothing can leave
 * the list half moved, or two rows at one number.
 *
 * The drag-ordered lists (@ListOrderColumn: severities, states, custom
 * fields, rules, pipelines, status page links...) are moved here too, by
 * ListOrderMaintainer (issue #9609): numbered by a column of their own
 * (orderColumn), their rows put in order and moved as Common/Utils/ListOrder
 * puts them (getChanges: the older of two rows at one number first, and a
 * list may count down), a list named by a kind as well as by ids (a public
 * note approval step's event type), and a move a list's own rules may
 * refuse (beforeWrite).
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

// One column naming a row's list, and the value the row holds in it.
export interface ListColumnValue {
  column: string;
  value: string | null;
  /*
   * What the column holds: an id (the default), or a short text naming a
   * kind of row - a public note approval step's event type.
   */
  isText?: boolean | undefined;
}

export interface ContiguousOrderMoved<TBaseModel extends BaseModel> {
  // The moved row as read before it moved: its list, and what alsoSelect asked for.
  row: TBaseModel;
  // The rows given another number, the moved row among them.
  changedRows: Array<{ id: string; order: number }>;
}

/*
 * How a list's rows are put in order and moved: from the rows as the move's
 * lock hands them over, the moved row's id and the id of the row whose place
 * it takes. MoveInListUtil.getChanges by default - by number, then id.
 */
export type ListMoveChangesFunction = (data: {
  places: Array<ListPlace>;
  rowId: string;
  placeOfId: string;
}) => MoveInListChanges;

/*
 * Asked inside a move's transaction, the list held, with the rows the move
 * would give another number, before any is written. A refusal it throws
 * undoes the move.
 */
export type ListMoveCheckFunction = (
  changedRows: Array<{ id: string; order: number }>,
) => Promise<void>;

// The column the five numbered lists are numbered by.
const DEFAULT_ORDER_COLUMN: string = "order";

const getDefaultChanges: ListMoveChangesFunction = (data: {
  places: Array<ListPlace>;
  rowId: string;
  placeOfId: string;
}): MoveInListChanges => {
  return MoveInListUtil.getChanges({
    rows: data.places,
    rowId: data.rowId,
    placeOfId: data.placeOfId,
  });
};

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
   * Moves a row to the place another row of its list holds
   * (Types/Database/MoveInList): the caller must be allowed to give the row
   * another number, as a write of its number column asks; the rows that step
   * aside are the move's own bookkeeping. `listColumns` are the columns that
   * name the row's list - its project among them - and `alsoSelect` the
   * other columns of the moved row its service needs afterwards.
   * `orderColumn`, `getChanges` and `beforeWrite` are a drag-ordered list's
   * (ListOrderMaintainer.move); the five numbered lists leave them out.
   */
  public static async move<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    rowId: ObjectID;
    placeOfId: ObjectID;
    listColumns: Array<string>;
    alsoSelect?: Array<string> | undefined;
    props: DatabaseCommonInteractionProps;
    // The column the list is numbered by: `order` when left out.
    orderColumn?: string | undefined;
    getChanges?: ListMoveChangesFunction | undefined;
    beforeWrite?: ListMoveCheckFunction | undefined;
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

    const list: Array<ListColumnValue> = data.listColumns.map(
      (column: string): ListColumnValue => {
        const value: unknown = (row as unknown as Record<string, unknown>)[
          column
        ];

        return {
          column: column,
          value:
            value === null || value === undefined ? null : value.toString(),
          isText:
            column !== tenantColumn &&
            model.getTableColumnMetadata(column)?.type !==
              TableColumnType.ObjectID,
        };
      },
    );

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
          list: list,
          rowId: data.rowId,
          placeOfId: data.placeOfId,
          name: name,
          orderColumn: orderColumn,
          getChanges: data.getChanges,
          beforeWrite: data.beforeWrite,
        });
      },
    );

    await ContiguousOrder.recordInAuditLog({
      service: data.service,
      orderColumn: orderColumn,
      changedRows: written.changedRows,
      previousOrders: written.previousOrders,
      props: data.props,
    });

    await ContiguousOrder.refreshCachesOfList({
      tableName: tableName,
      projectId: projectId,
      orderColumn: orderColumn,
      changedRows: written.changedRows,
    });

    return { row: row, changedRows: written.changedRows };
  }

  /*
   * What a write of the rows' numbers would have every process read again,
   * as DatabaseService refreshes after an update: a project's rules, in the
   * order they are evaluated (RuleSetCache: grouping rules, alert-to-
   * incident rules), and what its status pages show (StatusPageOverviewCache:
   * groups, resources, header and footer links). Neither ever fails the
   * move, which is written.
   */
  private static async refreshCachesOfList(data: {
    tableName: string;
    projectId: ObjectID;
    orderColumn: string;
    changedRows: Array<{ id: string; order: number }>;
  }): Promise<void> {
    if (data.changedRows.length === 0) {
      return;
    }

    const rows: Array<Record<string, unknown>> = [
      { projectId: data.projectId.toString() },
    ];
    const written: Record<string, unknown> = {
      [data.orderColumn]: data.changedRows[0]!.order,
    };

    await RuleSetCache.afterUpdate({
      tableName: data.tableName,
      rows: rows,
      written: written,
    });

    await StatusPageOverviewCache.afterUpdate({
      tableName: data.tableName,
      rows: rows,
      written: written,
    });
  }

  /*
   * The move itself, in the transaction it is handed: every row of the list
   * locked (in id order, as the schedule's save of its layers locks them,
   * so the two never wait for each other in a circle), read as they are
   * once the lock is had - its number (under `orderColumn`, `order` when
   * left out) and when it was created - and the rows given another number
   * written in one statement, once `beforeWrite` lets them be.
   */
  public static async moveWithinTransaction(data: {
    manager: EntityManager;
    tableName: string;
    list: Array<ListColumnValue>;
    rowId: ObjectID;
    placeOfId: ObjectID;
    name: string;
    orderColumn?: string | undefined;
    getChanges?: ListMoveChangesFunction | undefined;
    beforeWrite?: ListMoveCheckFunction | undefined;
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
        `SELECT "_id", "${orderColumn}" AS "order", "createdAt" FROM "${data.tableName}" WHERE ${where.join(" AND ")} AND "deletedAt" IS NULL ORDER BY "_id" ASC FOR UPDATE`,
        parameters,
      ),
    );

    const places: Array<ListPlace> = locked.map((row: RawRow): ListPlace => {
      const order: unknown = row["order"];
      const createdAt: unknown = row["createdAt"];

      return {
        id: String(row["_id"]),
        order: order === null || order === undefined ? null : Number(order),
        createdAt:
          createdAt instanceof Date || typeof createdAt === "string"
            ? createdAt
            : null,
      };
    });

    const changes: MoveInListChanges = (data.getChanges || getDefaultChanges)(
      {
        places: places,
        rowId: data.rowId.toString(),
        placeOfId: data.placeOfId.toString(),
      },
    );

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

    if (changes.changedRows.length > 0 && data.beforeWrite) {
      await data.beforeWrite(changes.changedRows);
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

      // A kind is compared as the column holds it, an id as a uuid.
      return entry.isText
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
     * Lazy require, as DatabaseService requires it: DatabaseService moves
     * the drag-ordered lists through here (ListOrderMaintainer), and
     * AuditLogService depends on services that extend DatabaseService, so
     * a top-level import would leave DatabaseService undefined at
     * class-extension time for them.
     */
    const auditLogService: typeof AuditLogServiceType =
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

      await auditLogService.recordUpdate({
        model: model,
        before: row,
        updatedFields: { [data.orderColumn]: changed.order } as JSONObject,
        itemId: row.id,
        props: data.props,
      });
    }
  }
}
