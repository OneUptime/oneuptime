import type DatabaseService from "../../Services/DatabaseService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ListOrderSettings } from "../../../Types/Database/ListOrderColumn";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import {
  ListOrderChange,
  ListOrderItem,
  getListOrderAppendValue,
  getListOrderChanges,
  getListOrderCollisionChanges,
  needsListOrderNormalization,
  sortListOrderItems,
  toListOrderNumber,
} from "../../../Utils/ListOrder";

/*
 * Keeps the number column of a drag-ordered list (a model with
 * @ListOrderColumn) true for every caller. DatabaseService calls into this
 * around its create and update; the arithmetic itself is
 * Common/Utils/ListOrder.ts, which the dashboard's tables use as well.
 *
 * Writes made here go through updateColumnsByIdWithoutHooks: stepping the
 * rows around a moved one aside is bookkeeping, not an edit of those rows, so
 * it must not fire their workflows, audit entries or service hooks one by
 * one. The row the caller actually created or moved goes through the normal
 * path and fires all of those as usual.
 */

export interface ListOrderScope<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  // Identifies the list, so rows of the same list can be grouped together.
  key: string;
}

export interface ListOrderCreatePlan {
  // The number the new row is saved with.
  value: number;
  // The rows that step aside to make room for it. Written once it is saved.
  siblingChanges: Array<ListOrderChange>;
}

// Stands in for the id of a row that does not exist yet.
const NEW_ROW_ID: string = "__new-list-order-row__";

type ServiceOf<TBaseModel extends BaseModel> = DatabaseService<TBaseModel>;

export default class ListOrderMaintainer {
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
      return ListOrderMaintainer.toScopeValue(direct);
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

  private static toScopeValue(value: unknown): unknown {
    if (value === null) {
      return null;
    }

    if (value instanceof ObjectID) {
      return value;
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
   * Which list a row belongs to, as a query and as a key. Null when the row
   * does not say which list it is in - then there is nothing to place it in,
   * and it is left as the caller wrote it.
   */
  public static getScope<TBaseModel extends BaseModel>(data: {
    model: TBaseModel;
    settings: ListOrderSettings;
    row: Record<string, unknown>;
  }): ListOrderScope<TBaseModel> | null {
    const query: Dictionary<unknown> = {};
    const keyParts: Array<string> = [];

    for (const column of data.settings.scopeColumns) {
      const value: unknown = ListOrderMaintainer.readScopeValue({
        model: data.model,
        row: data.row,
        column: column,
      });

      if (value === undefined) {
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
   * no number, or to the number it was given - with the rows in the way
   * stepping aside. Null when the row does not say which list it is in.
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

    const siblings: Array<ListOrderItem> = await ListOrderMaintainer.loadList(
      {
        service: data.service,
        settings: data.settings,
        scope: scope,
      },
    );

    const requested: number | null = toListOrderNumber(
      record[data.settings.column],
    );

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
   * After a row's number was written: the rows of its list that held that
   * number step aside. `previousValue` is the number the row had (null for a
   * row that just arrived in this list).
   */
  public static async makeRoomForRow<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    settings: ListOrderSettings;
    scope: ListOrderScope<TBaseModel>;
    id: ObjectID;
    previousValue: unknown;
    requestedValue: unknown;
  }): Promise<void> {
    const rows: Array<ListOrderItem> = await ListOrderMaintainer.loadList({
      service: data.service,
      settings: data.settings,
      scope: data.scope,
    });

    await ListOrderMaintainer.writeChanges({
      service: data.service,
      settings: data.settings,
      changes: getListOrderCollisionChanges({
        siblings: rows,
        itemId: data.id.toString(),
        previousValue: data.previousValue,
        requestedValue: data.requestedValue,
        sortOrder: data.settings.sortOrder,
      }),
    });
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

    for (const column of data.settings.scopeColumns) {
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
