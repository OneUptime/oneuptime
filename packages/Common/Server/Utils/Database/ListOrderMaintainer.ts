import type DatabaseService from "../../Services/DatabaseService";
import ContiguousOrder, {
  ContiguousOrderMoved,
  ListMoveCheckFunction,
} from "./ContiguousOrder";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ListOrderSettings } from "../../../Types/Database/ListOrderColumn";
import {
  ListPlace,
  MoveInListChanges,
} from "../../../Types/Database/MoveInList";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import {
  ListOrderChange,
  ListOrderItem,
  ListOrderMove,
  getListOrderAppendValue,
  getListOrderChanges,
  getListOrderCollisionChanges,
  getListOrderMoveChanges,
  needsListOrderNormalization,
  sortListOrderItems,
  toListOrderNumber,
} from "../../../Utils/ListOrder";

/*
 * Keeps the number column of a drag-ordered list (a model with
 * @ListOrderColumn) true for every caller. DatabaseService calls into this
 * around its create and update, and for a move (moveInList); the arithmetic
 * itself is Common/Utils/ListOrder.ts, which the dashboard's tables use as
 * well.
 *
 * A write places its own row and moves no other (issue #9609): a row
 * created or given a number keeps it, even one another row holds, so
 * Terraform's writes - every changed row's number, all at once, in no set
 * order - land exactly as written. What this keeps is the numbers nobody
 * wrote: a row created without one goes to the end of its list (or where
 * its list's rules put a new one: StateOrderGuard places a new state just
 * above the resolved state, and the rows from there down step aside for
 * it), and a row whose number is cleared, or that moves to another list
 * without one, goes to the end there. Moving a row past others is a request
 * of its own (move), which renumbers its list in one transaction holding
 * the list's rows (ContiguousOrder).
 *
 * Writes made here go through updateColumnsByIdWithoutHooks: putting a row
 * at the end of its list, or stepping rows aside for a new one, is
 * bookkeeping, not an edit of those rows, so it must not fire their
 * workflows, audit entries or service hooks one by one. The row the caller
 * actually created or changed goes through the normal path and fires all of
 * those as usual.
 */

export interface ListOrderScope<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  // Identifies the list, so rows of the same list can be grouped together.
  key: string;
}

export interface ListOrderCreatePlan {
  // The number the new row is saved with.
  value: number;
  /*
   * The rows that step aside to make room for it - only for a row whose
   * place the server picked (placeOnCreate). Written once it is saved.
   */
  siblingChanges: Array<ListOrderChange>;
}

// Stands in for the id of a row that does not exist yet.
const NEW_ROW_ID: string = "__new-list-order-row__";

type ServiceOf<TBaseModel extends BaseModel> = DatabaseService<TBaseModel>;

/*
 * The rows about to be created at a place the server picked for them,
 * because their caller named none (placeOnCreate). Held weakly: a row is
 * forgotten with the create that made it.
 */
const placedByServer: WeakSet<object> = new WeakSet<object>();

export default class ListOrderMaintainer {
  /*
   * Gives a row about to be created, whose caller named no place for it,
   * the place its list wants a new row at: `value`, the number of the row it
   * goes just above - a new state just above the resolved state
   * (StateOrderGuard). Unlike a number a caller wrote, which the row only
   * shares with the row holding it, the row takes this place: once it is
   * saved, the row holding the number, and any run of rows behind it, step
   * one place aside (planCreate).
   */
  public static placeOnCreate<TBaseModel extends BaseModel>(data: {
    row: TBaseModel;
    settings: ListOrderSettings;
    value: number;
  }): void {
    data.row.setColumnValue(data.settings.column, data.value);
    placedByServer.add(data.row);
  }

  // Whether the server picked the place of a row about to be created.
  public static isPlacedByServer(row: object): boolean {
    return placedByServer.has(row);
  }

  public static getSettings<TBaseModel extends BaseModel>(
    model: TBaseModel,
  ): ListOrderSettings | null {
    const settings: ListOrderSettings | null = model.getListOrder();

    if (!settings || !settings.column) {
      return null;
    }

    return settings;
  }

  /*
   * A scope column's value on a row, payload or model alike. A payload may
   * carry a many-to-one reference as the relation object (`{ statusPage:
   * { _id } }`, the dashboard's spelling) instead of the foreign key
   * (`statusPageId`), so the relation is read when the key is absent.
   * `undefined` means the row does not say; `null` means "no parent", which
   * is a list of its own.
   */
  public static readScopeValue<TBaseModel extends BaseModel>(data: {
    model: TBaseModel;
    row: Record<string, unknown>;
    column: string;
  }): unknown {
    const direct: unknown = data.row[data.column];

    if (direct !== undefined) {
      return ListOrderMaintainer.isIdColumn(data.model, data.column)
        ? ListOrderMaintainer.toScopeValue(direct)
        : direct;
    }

    for (const relationColumn of data.model.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        data.model.getTableColumnMetadata(relationColumn);

      if (metadata?.manyToOneRelationColumn !== data.column) {
        continue;
      }

      const relation: unknown = data.row[relationColumn];

      if (relation === undefined) {
        continue;
      }

      if (relation === null) {
        return null;
      }

      if (typeof relation === "object") {
        const relationRecord: Record<string, unknown> = relation as Record<
          string,
          unknown
        >;
        const id: unknown = relationRecord["_id"] ?? relationRecord["id"];

        if (id !== undefined) {
          return ListOrderMaintainer.toScopeValue(id);
        }
      }
    }

    return undefined;
  }

  /*
   * Whether a scope column holds an id: the parent whose rows the list is.
   * The only other kind is a short text of a few allowed values that splits
   * a project's rows into lists of their own - a public note approval
   * step's event type - and is read as it is (Tests/Models/
   * ListOrderColumnModels pins both).
   */
  private static isIdColumn<TBaseModel extends BaseModel>(
    model: TBaseModel,
    column: string,
  ): boolean {
    return (
      model.getTableColumnMetadata(column)?.type === TableColumnType.ObjectID
    );
  }

  /*
   * An id scope column's value: an id that arrives as a plain string - a
   * relation object's `_id`, a deserialized payload - is read as the
   * ObjectID the foreign key would hold, and both spellings query the list
   * the same way.
   */
  private static toScopeValue(value: unknown): unknown {
    if (value === null) {
      return null;
    }

    if (value instanceof ObjectID) {
      return value;
    }

    if (typeof value === "string") {
      return new ObjectID(value);
    }

    if (typeof value === "object" && value !== null) {
      const record: Record<string, unknown> = value as Record<string, unknown>;
      const id: unknown = record["_id"] ?? record["id"];

      if (typeof id === "string") {
        return new ObjectID(id);
      }

      if (id instanceof ObjectID) {
        return id;
      }
    }

    return value;
  }

  /*
   * The columns that name a row's list: the model's scope columns, and its
   * project. A list is a parent's rows in the parent's own project - a
   * status page's header links, a pipeline's processors - so a row that
   * names another project's parent is never numbered against that
   * project's rows, nor steps them aside.
   */
  public static getScopeColumns<TBaseModel extends BaseModel>(data: {
    model: TBaseModel;
    settings: ListOrderSettings;
  }): Array<string> {
    const tenantColumn: string | null = data.model.getTenantColumn();

    if (!tenantColumn || data.settings.scopeColumns.includes(tenantColumn)) {
      return [...data.settings.scopeColumns];
    }

    return [...data.settings.scopeColumns, tenantColumn];
  }

  /*
   * Which list a row belongs to, as a query and as a key. Null when the row
   * does not say which list it is in, or which project - then there is
   * nothing to place it in, and it is left as the caller wrote it.
   */
  public static getScope<TBaseModel extends BaseModel>(data: {
    model: TBaseModel;
    settings: ListOrderSettings;
    row: Record<string, unknown>;
  }): ListOrderScope<TBaseModel> | null {
    const query: Dictionary<unknown> = {};
    const keyParts: Array<string> = [];
    const tenantColumn: string | null = data.model.getTenantColumn();

    for (const column of ListOrderMaintainer.getScopeColumns(data)) {
      const value: unknown = ListOrderMaintainer.readScopeValue({
        model: data.model,
        row: data.row,
        column: column,
      });

      if (value === undefined) {
        return null;
      }

      // A row of no project belongs to no list.
      if (value === null && column === tenantColumn) {
        return null;
      }

      if (value === null) {
        query[column] = QueryHelper.isNull();
        keyParts.push(`${column}=`);
        continue;
      }

      query[column] = value;
      keyParts.push(`${column}=${String(value)}`);
    }

    return {
      query: query as Query<TBaseModel>,
      key: keyParts.join("&"),
    };
  }

  // The rows of one list, with what placing them needs.
  public static async loadList<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    settings: ListOrderSettings;
    scope: ListOrderScope<TBaseModel>;
  }): Promise<Array<ListOrderItem>> {
    const rows: Array<TBaseModel> = await data.service.findAllBy({
      query: data.scope.query,
      select: {
        _id: true,
        createdAt: true,
        [data.settings.column]: true,
      } as Select<TBaseModel>,
      sort: {
        [data.settings.column]: data.settings.sortOrder,
        createdAt: SortOrder.Ascending,
      } as Sort<TBaseModel>,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    return rows
      .filter((row: TBaseModel) => {
        return Boolean(row._id);
      })
      .map((row: TBaseModel) => {
        return ListOrderMaintainer.toItem(row, data.settings);
      });
  }

  public static toItem<TBaseModel extends BaseModel>(
    row: TBaseModel,
    settings: ListOrderSettings,
  ): ListOrderItem {
    const record: Record<string, unknown> = row as unknown as Record<
      string,
      unknown
    >;

    return {
      id: row._id!.toString(),
      value: record[settings.column] as number | null | undefined,
      createdAt: row.createdAt,
    };
  }

  public static async writeChanges<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    settings: ListOrderSettings;
    changes: Array<ListOrderChange>;
  }): Promise<void> {
    for (const change of data.changes) {
      await data.service.updateColumnsByIdWithoutHooks({
        id: new ObjectID(change.id),
        data: {
          [data.settings.column]: change.value,
        } as any,
      });
    }
  }

  /*
   * Where a row about to be created goes: to the end of its list when it has
   * no number, or to the number it was given - which it keeps, moving no
   * other row, even when another row holds it. A row whose place the server
   * picked (placeOnCreate) takes that place, the rows in the way stepping
   * aside. Null when the row does not say which list it is in.
   */
  public static async planCreate<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    settings: ListOrderSettings;
    row: TBaseModel;
  }): Promise<ListOrderCreatePlan | null> {
    const record: Record<string, unknown> = data.row as unknown as Record<
      string,
      unknown
    >;

    const scope: ListOrderScope<TBaseModel> | null =
      ListOrderMaintainer.getScope({
        model: data.service.getModel(),
        settings: data.settings,
        row: record,
      });

    if (!scope) {
      return null;
    }

    const requested: number | null = toListOrderNumber(
      record[data.settings.column],
    );

    const isPlacedByServer: boolean = ListOrderMaintainer.isPlacedByServer(
      data.row,
    );

    // A number the caller wrote is kept as written: no list to read.
    if (requested !== null && !isPlacedByServer) {
      return { value: requested, siblingChanges: [] };
    }

    const siblings: Array<ListOrderItem> = await ListOrderMaintainer.loadList({
      service: data.service,
      settings: data.settings,
      scope: scope,
    });

    if (requested === null) {
      return {
        value: getListOrderAppendValue({
          siblings: siblings,
          sortOrder: data.settings.sortOrder,
        }),
        siblingChanges: [],
      };
    }

    return {
      value: requested,
      siblingChanges: getListOrderCollisionChanges({
        siblings: siblings,
        itemId: NEW_ROW_ID,
        previousValue: null,
        requestedValue: requested,
        sortOrder: data.settings.sortOrder,
      }),
    };
  }

  /*
   * Moves a row of a drag-ordered list to the place of another row of its
   * list (POST <list>/:id/move, Types/Database/MoveInList): the rows between
   * step one place towards where it was, and the list is numbered 1..n (n..1
   * for a list that counts down) in its new order - in one transaction that
   * locks the list's rows first (ContiguousOrder.move), its rows put in
   * order as the list shows them (getListOrderMoveChanges: the older of two
   * rows at one number first). The caller must be allowed to give the row
   * another number. `beforeWrite` may refuse the move before it is written
   * (a project's built-in states keep their order).
   */
  public static async move<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    settings: ListOrderSettings;
    rowId: ObjectID;
    placeOfId: ObjectID;
    props: DatabaseCommonInteractionProps;
    beforeWrite?: ListMoveCheckFunction | undefined;
  }): Promise<ContiguousOrderMoved<TBaseModel>> {
    return await ContiguousOrder.move({
      service: data.service,
      rowId: data.rowId,
      placeOfId: data.placeOfId,
      listColumns: ListOrderMaintainer.getScopeColumns({
        model: data.service.getModel(),
        settings: data.settings,
      }),
      orderColumn: data.settings.column,
      getChanges: (move: {
        places: Array<ListPlace>;
        rowId: string;
        placeOfId: string;
      }): MoveInListChanges => {
        return ListOrderMaintainer.getMoveChanges({
          settings: data.settings,
          places: move.places,
          rowId: move.rowId,
          placeOfId: move.placeOfId,
        });
      },
      beforeWrite: data.beforeWrite,
      props: data.props,
    });
  }

  /*
   * A move of a drag-ordered list's rows as the move in its transaction
   * writes it: the list's rows as its lock hands them over, put in order and
   * moved by Common/Utils/ListOrder.
   */
  public static getMoveChanges(data: {
    settings: ListOrderSettings;
    places: Array<ListPlace>;
    rowId: string;
    placeOfId: string;
  }): MoveInListChanges {
    const move: ListOrderMove = getListOrderMoveChanges({
      items: data.places.map((place: ListPlace): ListOrderItem => {
        return {
          id: place.id,
          value: place.order,
          createdAt: place.createdAt,
        };
      }),
      itemId: data.rowId,
      placeOfId: data.placeOfId,
      sortOrder: data.settings.sortOrder,
    });

    if (move.kind !== "moved") {
      return move;
    }

    return {
      kind: "moved",
      changedRows: move.changes.map(
        (change: ListOrderChange): { id: string; order: number } => {
          return { id: change.id, order: change.value };
        },
      ),
    };
  }

  /*
   * A row that moved to another list without a number of its own for it:
   * it goes to the end there.
   */
  public static async appendRow<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    settings: ListOrderSettings;
    scope: ListOrderScope<TBaseModel>;
    id: ObjectID;
  }): Promise<void> {
    const rows: Array<ListOrderItem> = await ListOrderMaintainer.loadList({
      service: data.service,
      settings: data.settings,
      scope: data.scope,
    });

    const id: string = data.id.toString();

    await ListOrderMaintainer.writeChanges({
      service: data.service,
      settings: data.settings,
      changes: [
        {
          id: id,
          value: getListOrderAppendValue({
            siblings: rows.filter((row: ListOrderItem) => {
              return row.id !== id;
            }),
            sortOrder: data.settings.sortOrder,
          }),
        },
      ],
    });
  }

  /*
   * Numbers every list of a model that has rows without a number, or two rows
   * with the same one, 1..n in the order it is shown in today. Lists whose
   * numbers are already unique are left exactly as they are. For the one-off
   * data migration that heals lists saved before the server kept the numbers
   * (every log pipeline saved as 1, custom fields with no order at all), so
   * that the first drop on them lands where it was dropped.
   */
  public static async normalizeEveryList<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    settings: ListOrderSettings;
  }): Promise<{ lists: number; rowsChanged: number }> {
    const select: Dictionary<boolean> = {
      _id: true,
      createdAt: true,
      [data.settings.column]: true,
    };

    for (const column of ListOrderMaintainer.getScopeColumns({
      model: data.service.getModel(),
      settings: data.settings,
    })) {
      select[column] = true;
    }

    const rows: Array<TBaseModel> = await data.service.findAllBy({
      query: {},
      select: select as Select<TBaseModel>,
      sort: {
        _id: SortOrder.Ascending,
      } as Sort<TBaseModel>,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    const lists: Map<string, Array<ListOrderItem>> = new Map();

    for (const row of rows) {
      if (!row._id) {
        continue;
      }

      const scope: ListOrderScope<TBaseModel> | null =
        ListOrderMaintainer.getScope({
          model: data.service.getModel(),
          settings: data.settings,
          row: row as unknown as Record<string, unknown>,
        });

      if (!scope) {
        continue;
      }

      const list: Array<ListOrderItem> = lists.get(scope.key) || [];
      list.push(ListOrderMaintainer.toItem(row, data.settings));
      lists.set(scope.key, list);
    }

    let listsChanged: number = 0;
    let rowsChanged: number = 0;

    for (const list of lists.values()) {
      if (!needsListOrderNormalization(list)) {
        continue;
      }

      const changes: Array<ListOrderChange> = getListOrderChanges({
        orderedItems: sortListOrderItems(list, data.settings.sortOrder),
        sortOrder: data.settings.sortOrder,
      });

      await ListOrderMaintainer.writeChanges({
        service: data.service,
        settings: data.settings,
        changes: changes,
      });

      listsChanged++;
      rowsChanged += changes.length;
    }

    return { lists: listsChanged, rowsChanged: rowsChanged };
  }
}
