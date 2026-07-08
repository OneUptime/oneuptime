import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Recurring from "../../Types/Events/Recurring";
import UpdateBy from "../Types/Database/UpdateBy";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A rotation interval count of 0 / NaN / negative breaks the handoff math
   * (division by zero, Invalid Date), so reject it at the persistence boundary.
   * The client also guards this, and the engine defensively clamps, but a raw
   * API write must not be able to store an invalid rotation.
   */
  private validateRotationInterval(rotation: unknown): void {
    if (!rotation || typeof rotation === "function") {
      return;
    }

    let count: number;
    try {
      const recurring: Recurring =
        rotation instanceof Recurring
          ? rotation
          : Recurring.fromJSON(rotation as any);
      count = recurring.intervalCount.toNumber();
    } catch {
      throw new BadDataException("Invalid rotation configuration.");
    }

    if (!Number.isFinite(count) || isNaN(count) || count < 1) {
      throw new BadDataException(
        "Rotation interval must be a whole number greater than or equal to 1.",
      );
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.onCallDutyPolicyScheduleId) {
      throw new BadDataException("onCallDutyPolicyScheduleId is required");
    }

    this.validateRotationInterval(createBy.data.rotation);

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

  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const resource: Model | null = await this.findOneById({
      id: createdItem.id!,
      select: {
        onCallDutyPolicyScheduleId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!resource || !resource.onCallDutyPolicyScheduleId) {
      return createdItem;
    }

    await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
      resource.onCallDutyPolicyScheduleId,
    );

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    this.validateRotationInterval(updateBy.data.rotation);

    return {
      updateBy,
      carryForward: null,
    };
  }

  protected override async onUpdateSuccess(
    _onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    for (const item of updatedItemIds) {
      const resource: Model | null = await this.findOneById({
        id: item,
        select: {
          onCallDutyPolicyScheduleId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!resource || !resource.onCallDutyPolicyScheduleId) {
        continue;
      }

      await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
        resource.onCallDutyPolicyScheduleId,
      );
    }

    return {
      updateBy: _onUpdate.updateBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
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

        await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
          resource.onCallDutyPolicyScheduleId,
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
