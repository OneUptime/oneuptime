import type DatabaseService from "../../Services/DatabaseService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ListOrderSettings } from "../../../Types/Database/ListOrderColumn";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import {
  ListOrderChange,
  ListOrderItem,
  getListOrderAppendValue,
  getListOrderChanges,
  needsListOrderNormalization,
  sortListOrderItems,
  toListOrderNumber,
} from "../../../Utils/ListOrder";

/*
 * Keeps the number column of a drag-ordered list (a model with
 * @ListOrderColumn) for every caller. DatabaseService calls into this
 * around its create and update; the arithmetic itself is
 * Common/Utils/ListOrder.ts, which the dashboard's tables use as well.
 *
 * A write places its own row and moves no other (issue #9609): a row created
 * or given a number keeps it, whoever else holds it. What is kept here is
 * where a row goes that has no number of its own - created without one,
 * cleared, or moved to another list without one: after the last row of its
 * list. Moving a row past others is a request of its own
 * (DatabaseService.moveInList, Server/Utils/Database/ContiguousOrder).
 *
 * Those writes go through updateColumnsByIdWithoutHooks: putting a row at
 * the end is bookkeeping, not an edit of it, so it must not fire its
 * workflows, audit entries or service hooks a second time. The write the
 * caller made goes through the normal path and fires all of those as usual.
 */

export interface ListOrderScope<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  // Identifies the list, so rows of the same list can be grouped together.
  key: string;
}

export interface ListOrderCreatePlan {
  // The number the new row is saved with.
  value: number;
}

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

  /*
   * The rows of one list, with what placing them needs, in the list's order
   * (rows that share a number by id: DatabaseService breaks every tie of a
   * read by the primary key).
   */
  public static async loadList<TBaseModel extends BaseModel>(data: {
    service: ServiceOf<TBaseModel>;
    settings: ListOrderSettings;
    scope: ListOrderScope<TBaseModel>;
  }): Promise<Array<ListOrderItem>> {
    const rows: Array<TBaseModel> = await data.service.findAllBy({
      query: data.scope.query,
      select: {
        _id: true,
        [data.settings.column]: true,
      } as Select<TBaseModel>,
      sort: {
        [data.settings.column]: data.settings.sortOrder,
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
   * Where a row about to be created goes: to the number it was given,
   * whoever else holds it - no other row moves - or to the end of its list
   * when it has none. Null when the row does not say which list it is in;
   * the list is read only for a row without a number.
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

    if (requested !== null) {
      return { value: requested };
    }

    const siblings: Array<ListOrderItem> = await ListOrderMaintainer.loadList({
      service: data.service,
      settings: data.settings,
      scope: scope,
    });

    return {
      value: getListOrderAppendValue({
        siblings: siblings,
        sortOrder: data.settings.sortOrder,
      }),
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
