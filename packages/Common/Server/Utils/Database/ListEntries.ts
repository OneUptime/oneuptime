import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../../Types/Exception/BadDataException";
import ListChangesUtil, {
  ListChange,
} from "../../../Types/Database/ListChanges";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import {
  DeleteQueryBuilder,
  EntityManager,
  EntityMetadata,
  InsertQueryBuilder,
  ObjectLiteral,
} from "typeorm";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";

/*
 * THE ENTRIES AN UPDATE ADDS TO A RECORD'S LISTS AND TAKES OFF THEM, AND THE
 * STATEMENTS THAT WRITE ONLY THOSE (#10135).
 *
 * An update that names entries to add and take off (Types/Database/
 * ListChanges) is made into an ordinary update first: each list it changes
 * is put in its `data` whole - the record's entries, without the ones taken
 * off, with the ones added - so every check and hook reads it as it reads a
 * write of the whole list: the caller's permission to change the list, the
 * records it adds being the project's, the labels a permission keeps to,
 * the audit log, the workflows, the live updates.
 *
 * The row's write is where it differs. A list written whole is saved
 * whole: TypeORM's save() takes off every entry the list it is given does
 * not have, one added since the record was read included. A list changed
 * entry by entry has only its entries written, in the junction table that
 * holds the list: an INSERT of each entry added that the table does not
 * already have, a DELETE of each entry taken off. An entry added at the same
 * moment - a label rule's, another person's - is never taken off, and one
 * taken off at the same moment is never put back.
 */

// What a row's write does to one of its lists, worked out from a ListChange.
export interface ListEntryWrite {
  // The IDs the write adds: ones the record did not have when it was read.
  add: Array<string>;
  // The IDs it takes off: ones the record had.
  remove: Array<string>;
  // The list as the update's `data` holds it, for every check and hook.
  list: Array<string>;
}

// By the list's field.
export type ListEntryWrites = Record<string, ListEntryWrite>;

export default class ListEntries {
  // The fields of a model's lists of related records (EntityArray).
  public static getListColumns(model: BaseModel): Array<string> {
    return model.getTableColumns().columns.filter((column: string): boolean => {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(column);

      return metadata?.type === TableColumnType.EntityArray;
    });
  }

  /*
   * What a write does to a list the record holds `current` of: the whole
   * list after the change, and the entries that change.
   */
  public static getWrite(data: {
    current: Array<string>;
    change: ListChange;
  }): ListEntryWrite {
    return {
      add: data.change.add.filter((id: string): boolean => {
        return !ListChangesUtil.includes(data.current, id);
      }),
      remove: data.change.remove.filter((id: string): boolean => {
        return ListChangesUtil.includes(data.current, id);
      }),
      list: ListChangesUtil.apply([...data.current], data.change),
    };
  }

  // The IDs of a list as a record or a write holds it: models, {_id} objects or IDs.
  public static getIds(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const ids: Array<string> = [];

    for (const item of value) {
      const id: string | null =
        item instanceof BaseModel
          ? ListChangesUtil.getEntryId(item._id)
          : ListChangesUtil.getEntryId(item);

      if (id && !ListChangesUtil.includes(ids, id)) {
        ids.push(id);
      }
    }

    return ids;
  }

  // Whether a write still holds the list `write` made: no hook changed it.
  public static isListAsWorkedOut(
    value: unknown,
    write: ListEntryWrite,
  ): boolean {
    const ids: Array<string> = ListEntries.getIds(value);

    return (
      ids.length === write.list.length &&
      write.list.every((id: string): boolean => {
        return ListChangesUtil.includes(ids, id);
      })
    );
  }

  /*
   * The INSERT of the entries `ids` into the row's list `column`, which
   * leaves an entry the table already has as it is (ON CONFLICT DO
   * NOTHING), or null for no entry. As TypeORM's own add() writes it
   * (RelationUpdater), with each side of the junction table.
   */
  public static getInsert(data: {
    manager: EntityManager;
    modelType: { new (): BaseModel };
    column: string;
    rowId: string;
    ids: Array<string>;
  }): InsertQueryBuilder<ObjectLiteral> | null {
    if (data.ids.length === 0) {
      return null;
    }

    const junction: JunctionSides = ListEntries.getJunctionSides(data);

    return data.manager
      .createQueryBuilder()
      .insert()
      .into(junction.tableName)
      .values(
        data.ids.map((id: string): ObjectLiteral => {
          return {
            [junction.rowColumn.databaseName]: data.rowId,
            [junction.entryColumn.databaseName]: id,
          };
        }),
      )
      .orIgnore();
  }

  /*
   * The DELETE of the entries `ids` from the row's list `column`, or null
   * for no entry. Every other entry of the row, and every other row's, stays.
   */
  public static getDelete(data: {
    manager: EntityManager;
    modelType: { new (): BaseModel };
    column: string;
    rowId: string;
    ids: Array<string>;
  }): DeleteQueryBuilder<ObjectLiteral> | null {
    if (data.ids.length === 0) {
      return null;
    }

    const junction: JunctionSides = ListEntries.getJunctionSides(data);
    const escape: (name: string) => string = (name: string): string => {
      return data.manager.connection.driver.escape(name);
    };

    return data.manager
      .createQueryBuilder()
      .delete()
      .from(junction.tableName)
      .where(`${escape(junction.rowColumn.databaseName)} = :listRowId`, {
        listRowId: data.rowId,
      })
      .andWhere(
        `${escape(junction.entryColumn.databaseName)} IN (:...listEntryIds)`,
        { listEntryIds: data.ids },
      );
  }

  // Writes what `writes` adds and takes off, list by list, with `manager`.
  public static async write(data: {
    manager: EntityManager;
    modelType: { new (): BaseModel };
    rowId: string;
    writes: ListEntryWrites;
  }): Promise<void> {
    for (const [column, write] of Object.entries(data.writes)) {
      const remove: DeleteQueryBuilder<ObjectLiteral> | null =
        ListEntries.getDelete({ ...data, column, ids: write.remove });

      if (remove) {
        await remove.execute();
      }

      const add: InsertQueryBuilder<ObjectLiteral> | null =
        ListEntries.getInsert({ ...data, column, ids: write.add });

      if (add) {
        await add.execute();
      }
    }
  }

  /*
   * The junction table that holds a row's list, and its two columns: the
   * one naming the row and the one naming the entry. The model's side of a
   * many-to-many relation decides which is which, as it does for TypeORM
   * (RelationUpdater): the owner's columns name the side with @JoinTable.
   */
  private static getJunctionSides(data: {
    manager: EntityManager;
    modelType: { new (): BaseModel };
    column: string;
  }): JunctionSides {
    const metadata: EntityMetadata = data.manager.connection.getMetadata(
      data.modelType,
    );
    const relation: RelationMetadata | undefined =
      metadata.findRelationWithPropertyPath(data.column);
    const junction: EntityMetadata | undefined =
      relation?.junctionEntityMetadata;

    if (!relation || !relation.isManyToMany || !junction) {
      throw new BadDataException(
        `${data.column} is not a list of related records of ${metadata.name}.`,
      );
    }

    const ownerColumns: Array<ColumnMetadata> = junction.ownerColumns;
    const inverseColumns: Array<ColumnMetadata> = junction.inverseColumns;

    if (ownerColumns.length !== 1 || inverseColumns.length !== 1) {
      throw new BadDataException(
        `${data.column} of ${metadata.name} is kept with more than one column on a side, so its entries are written with the whole list.`,
      );
    }

    return relation.isManyToManyOwner
      ? {
          tableName: junction.tableName,
          rowColumn: ownerColumns[0]!,
          entryColumn: inverseColumns[0]!,
        }
      : {
          tableName: junction.tableName,
          rowColumn: inverseColumns[0]!,
          entryColumn: ownerColumns[0]!,
        };
  }
}

interface JunctionSides {
  tableName: string;
  rowColumn: ColumnMetadata;
  entryColumn: ColumnMetadata;
}
