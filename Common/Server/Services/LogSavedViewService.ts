import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/LogSavedView";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import LIMIT_MAX from "../../Types/Database/LimitMax";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (createBy.data.isDefault === undefined && createBy.data.projectId) {
      const existingDefaultView: Model | null = await this.findOneBy({
        query: {
          projectId: createBy.data.projectId,
          isDefault: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

      createBy.data.isDefault = !existingDefaultView;
    }

    await this.unsetOtherDefaultsIfNeeded({
      projectId: createBy.data.projectId,
      isDefault: createBy.data.isDefault,
    });

    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.data.isDefault !== true) {
      return { updateBy, carryForward: null };
    }

    const itemsToUpdate: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });

    for (const item of itemsToUpdate) {
      await this.unsetOtherDefaultsIfNeeded({
        projectId: item.projectId,
        isDefault: true,
        excludeIds: item._id ? [item._id] : [],
      });
    }

    return { updateBy, carryForward: null };
  }

  private async unsetOtherDefaultsIfNeeded(data: {
    projectId?: ObjectID;
    isDefault?: boolean;
    excludeIds?: Array<string>;
  }): Promise<void> {
    if (!data.projectId || !data.isDefault) {
      return;
    }

    await this.updateBy({
      query: {
        projectId: data.projectId,
        isDefault: true,
        ...(data.excludeIds && data.excludeIds.length > 0
          ? {
              _id: QueryHelper.notInOrNull(data.excludeIds),
            }
          : {}),
      },
      data: {
        isDefault: false,
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });
  }
}

export default new Service();
