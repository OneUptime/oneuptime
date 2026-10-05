import type DatabaseService from "../../Services/DatabaseService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import PartialEntity from "../../../Types/Database/PartialEntity";
import ObjectID from "../../../Types/ObjectID";

/*
 * A project uses exactly one of some kinds of row by default: its LLM
 * provider, its AI agent, its saved log, trace and metric view, its Twilio
 * config. Making one row the default takes the default from the project's
 * other rows of that kind.
 *
 * That is done here, from a service's onCreateSuccess or onUpdateSuccess:
 * once the row has been saved as the default, so after the caller has passed
 * every permission check and nothing else can refuse the write - a create or
 * update that is refused, or that fails for any other reason, leaves the
 * project's default where it was. Only the saved rows' own projects are
 * touched, and the rows that were just made the default keep it.
 *
 * The other rows are changed as root, because the caller may not be able to
 * see them all, and through the normal update path, so their own hooks and
 * workflows run as for any other change of the column.
 */

export default class ProjectDefaultRow {
  /*
   * For onCreateSuccess: when the row was created as its project's default,
   * no other row of that project stays the default.
   */
  public static async afterCreate<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    defaultColumn: string;
    createdItem: TBaseModel;
  }): Promise<void> {
    if (data.createdItem.getColumnValue(data.defaultColumn) !== true) {
      return;
    }

    const id: ObjectID | null = data.createdItem.id;
    const projectId: unknown = data.createdItem.getColumnValue("projectId");

    if (!id || !projectId) {
      return;
    }

    await ProjectDefaultRow.takeDefaultFromOtherRows({
      service: data.service,
      defaultColumn: data.defaultColumn,
      projectId: new ObjectID(projectId.toString()),
      keepIds: [id],
    });
  }

  /*
   * For onUpdateSuccess: when the update made rows the default, no other row
   * of their projects stays the default. Only the rows the update actually
   * wrote count, which DatabaseService hands onUpdateSuccess.
   */
  public static async afterUpdate<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    defaultColumn: string;
    updatedData: PartialEntity<TBaseModel>;
    updatedItemIds: Array<ObjectID>;
  }): Promise<void> {
    if (
      (data.updatedData as Record<string, unknown>)[data.defaultColumn] !==
        true ||
      data.updatedItemIds.length === 0
    ) {
      return;
    }

    const updatedRows: Array<TBaseModel> = await data.service.findBy({
      query: {
        _id: QueryHelper.any(data.updatedItemIds),
      } as Query<TBaseModel>,
      select: {
        _id: true,
        projectId: true,
      } as Select<TBaseModel>,
      limit: data.updatedItemIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const idsByProject: Map<string, Array<ObjectID>> = new Map();

    for (const row of updatedRows) {
      const projectId: unknown = row.getColumnValue("projectId");

      if (!row.id || !projectId) {
        continue;
      }

      const ids: Array<ObjectID> = idsByProject.get(projectId.toString()) || [];
      ids.push(row.id);
      idsByProject.set(projectId.toString(), ids);
    }

    for (const [projectId, keepIds] of idsByProject) {
      await ProjectDefaultRow.takeDefaultFromOtherRows({
        service: data.service,
        defaultColumn: data.defaultColumn,
        projectId: new ObjectID(projectId),
        keepIds: keepIds,
      });
    }
  }

  private static async takeDefaultFromOtherRows<
    TBaseModel extends BaseModel,
  >(data: {
    service: DatabaseService<TBaseModel>;
    defaultColumn: string;
    projectId: ObjectID;
    keepIds: Array<ObjectID>;
  }): Promise<void> {
    await data.service.updateBy({
      query: {
        projectId: data.projectId,
        [data.defaultColumn]: true,
        _id: QueryHelper.notInOrNull(data.keepIds),
      } as Query<TBaseModel>,
      data: {
        [data.defaultColumn]: false,
      } as unknown as PartialEntity<TBaseModel>,
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });
  }
}
