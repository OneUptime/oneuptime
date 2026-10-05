import type DatabaseService from "../../Services/DatabaseService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import PartialEntity from "../../../Types/Database/PartialEntity";
import ObjectID from "../../../Types/ObjectID";

/*
 * Some lists are numbered 1..n by an `order` column, and their services keep
 * the numbers contiguous themselves: the escalation rules of an on-call
 * policy, the layers of a schedule, the users of a layer, the groups of a
 * status page and the resources of a status page (or of one of its groups).
 * Adding a row at a place moves the rows from there on one place down,
 * moving a row moves the rows it passes, and deleting one closes its gap.
 * (Drag-ordered lists keep their numbers through @ListOrderColumn instead.)
 *
 * The services call these from their success hooks: once the row they make
 * room for has been created, moved or deleted, so after the caller has passed
 * every permission check and nothing else can refuse the write. A write that
 * is refused, or fails, leaves its list as it was. The rows that step aside
 * are always looked up within `list`, which names the list and the project
 * of the row that was written, and never include that row itself.
 *
 * The rows step aside as root, through the normal update path, as they
 * always have.
 */

export interface ContiguousOrderList<TBaseModel extends BaseModel> {
  service: DatabaseService<TBaseModel>;
  // The rows of the list, in the written row's own project.
  list: Query<TBaseModel>;
}

export default class ContiguousOrder {
  /*
   * A row was created at `order`: every other row of its list at that place
   * or after it moves one place down.
   */
  public static async afterCreate<TBaseModel extends BaseModel>(
    data: ContiguousOrderList<TBaseModel> & {
      createdItemId: ObjectID;
      order: number;
    },
  ): Promise<void> {
    await ContiguousOrder.shift({
      ...data,
      excludeId: data.createdItemId,
      from: data.order,
      to: null,
      by: 1,
    });
  }

  /*
   * A row moved from `previousOrder` to `newOrder`: the rows it passed step
   * one place towards where it was.
   */
  public static async afterMove<TBaseModel extends BaseModel>(
    data: ContiguousOrderList<TBaseModel> & {
      movedItemId: ObjectID;
      previousOrder: number;
      newOrder: number;
    },
  ): Promise<void> {
    if (data.newOrder < data.previousOrder) {
      // Moved up: the rows from its new place to its old one step down.
      await ContiguousOrder.shift({
        ...data,
        excludeId: data.movedItemId,
        from: data.newOrder,
        to: data.previousOrder - 1,
        by: 1,
      });
    }

    if (data.newOrder > data.previousOrder) {
      // Moved down: the rows after its old place, up to its new one, step up.
      await ContiguousOrder.shift({
        ...data,
        excludeId: data.movedItemId,
        from: data.previousOrder + 1,
        to: data.newOrder,
        by: -1,
      });
    }
  }

  // A row at `order` was deleted: the rows after it close the gap.
  public static async afterDelete<TBaseModel extends BaseModel>(
    data: ContiguousOrderList<TBaseModel> & {
      order: number;
    },
  ): Promise<void> {
    await ContiguousOrder.shift({
      ...data,
      excludeId: null,
      from: data.order + 1,
      to: null,
      by: -1,
    });
  }

  private static async shift<TBaseModel extends BaseModel>(
    data: ContiguousOrderList<TBaseModel> & {
      excludeId: ObjectID | null;
      from: number;
      to: number | null;
      by: 1 | -1;
    },
  ): Promise<void> {
    const rows: Array<TBaseModel> = await data.service.findBy({
      query: {
        ...data.list,
        order: QueryHelper.greaterThanEqualTo(data.from),
      } as Query<TBaseModel>,
      select: {
        _id: true,
        order: true,
      } as Select<TBaseModel>,
      sort: {
        order: SortOrder.Ascending,
      } as never,
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const row of rows) {
      const order: number = Number(
        (row as unknown as { order?: number | null }).order,
      );

      if (
        !row.id ||
        isNaN(order) ||
        order < data.from ||
        (data.to !== null && order > data.to) ||
        (data.excludeId && row.id.toString() === data.excludeId.toString())
      ) {
        continue;
      }

      await data.service.updateOneBy({
        query: {
          _id: row.id.toString(),
        } as Query<TBaseModel>,
        data: {
          order: order + data.by,
        } as unknown as PartialEntity<TBaseModel>,
        props: {
          isRoot: true,
        },
      });
    }
  }
}
