import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Model from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.onCallDutyPolicyScheduleId) {
      throw new BadDataException("onCallDutyPolicyScheduleId is required");
    }

    if (!createBy.data.order) {
      // count number of users in this layer.

      const count: PositiveNumber = await this.countBy({
        query: {
          onCallDutyPolicyScheduleId: createBy.data.onCallDutyPolicyScheduleId!,
        },
        props: {
          isRoot: true,
        },
      });

      createBy.data.order = count.toNumber() + 1;
    }

    await this.rearrangeOrder(
      createBy.data.order,
      createBy.data.onCallDutyPolicyScheduleId!,
      true,
    );

    return {
      createBy,
      carryForward: null,
    };
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
    const resource: Model | null = onDelete.carryForward;

    if (!deleteBy.props.isRoot && resource) {
      if (resource && resource.order && resource.onCallDutyPolicyScheduleId) {
        await this.rearrangeOrder(
          resource.order,
          resource.onCallDutyPolicyScheduleId,
          false,
        );
      }
    }

    return {
      deleteBy: deleteBy,
      carryForward: null,
    };
  }

  private async rearrangeOrder(
    currentOrder: number,
    onCallDutyPolicyScheduleId: ObjectID,
    increaseOrder: boolean = true,
  ): Promise<void> {
    // get status page resource with this order.
    const resources: Array<Model> = await this.findBy({
      query: {
        order: QueryHelper.greaterThanEqualTo(currentOrder),
        onCallDutyPolicyScheduleId: onCallDutyPolicyScheduleId,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        order: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
    });

    let newOrder: number = currentOrder;

    for (const resource of resources) {
      if (increaseOrder) {
        newOrder = resource.order! + 1;
      } else {
        newOrder = resource.order! - 1;
      }

      await this.updateOneBy({
        query: {
          _id: resource._id!,
        },
        data: {
          order: newOrder,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }
}

export default new Service();
