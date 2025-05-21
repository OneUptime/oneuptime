import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<ScheduledMaintenanceState> {
  public constructor() {
    super(ScheduledMaintenanceState);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<ScheduledMaintenanceState>,
  ): Promise<OnCreate<ScheduledMaintenanceState>> {
    if (!createBy.data.order) {
      throw new BadDataException(
        "ScheduledMaintenance State order is required",
      );
    }

    if (!createBy.data.projectId) {
      throw new BadDataException(
        "ScheduledMaintenance State projectId is required",
      );
    }

    await this.rearrangeOrder(
      createBy.data.order,
      createBy.data.projectId,
      true,
    );

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<ScheduledMaintenanceState>,
  ): Promise<OnDelete<ScheduledMaintenanceState>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting scheduled maintenance states. Please try the delete with objectId",
      );
    }

    let scheduledMaintenanceState: ScheduledMaintenanceState | null = null;

    if (!deleteBy.props.isRoot) {
      scheduledMaintenanceState = await this.findOneBy({
        query: deleteBy.query,
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          projectId: true,
        },
      });
    }

    return {
      deleteBy,
      carryForward: scheduledMaintenanceState,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<ScheduledMaintenanceState>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<ScheduledMaintenanceState>> {
    const deleteBy: DeleteBy<ScheduledMaintenanceState> = onDelete.deleteBy;
    const scheduledMaintenanceState: ScheduledMaintenanceState | null =
      onDelete.carryForward;

    if (!deleteBy.props.isRoot && scheduledMaintenanceState) {
      if (
        scheduledMaintenanceState &&
        scheduledMaintenanceState.order &&
        scheduledMaintenanceState.projectId
      ) {
        await this.rearrangeOrder(
          scheduledMaintenanceState.order,
          scheduledMaintenanceState.projectId,
          false,
        );
      }
    }

    return {
      deleteBy: deleteBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<ScheduledMaintenanceState>,
  ): Promise<OnUpdate<ScheduledMaintenanceState>> {
    if (updateBy.data.order && !updateBy.props.isRoot) {
      throw new BadDataException(
        "Scheduled Maintenance State order should not be updated. Delete this scheduled maintenance state and create a new state with the right order.",
      );
    }

    return { updateBy, carryForward: null };
  }

  private async rearrangeOrder(
    currentOrder: number,
    projectId: ObjectID,
    increaseOrder: boolean = true,
  ): Promise<void> {
    // get scheduledMaintenance with this order.
    const scheduledMaintenanceStates: Array<ScheduledMaintenanceState> =
      await this.findBy({
        query: {
          order: QueryHelper.greaterThanEqualTo(currentOrder),
          projectId: projectId,
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

    for (const scheduledMaintenanceState of scheduledMaintenanceStates) {
      if (increaseOrder) {
        newOrder = scheduledMaintenanceState.order! + 1;
      } else {
        newOrder = scheduledMaintenanceState.order! - 1;
      }

      await this.updateOneBy({
        query: {
          _id: scheduledMaintenanceState._id!,
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

  @CaptureSpan()
  public async getCompletedScheduledMaintenanceState(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ScheduledMaintenanceState> {
    const scheduledMaintenanceStates: Array<ScheduledMaintenanceState> =
      await this.getAllScheduledMaintenanceStates({
        projectId: data.projectId,
        props: data.props,
      });

    const resolvedScheduledMaintenanceState:
      | ScheduledMaintenanceState
      | undefined = scheduledMaintenanceStates.find(
      (scheduledMaintenanceState: ScheduledMaintenanceState) => {
        return scheduledMaintenanceState?.isResolvedState;
      },
    );

    if (!resolvedScheduledMaintenanceState) {
      throw new BadDataException(
        "Completed ScheduledMaintenance State not found for this project",
      );
    }

    return resolvedScheduledMaintenanceState;
  }

  @CaptureSpan()
  public async getAllScheduledMaintenanceStates(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<ScheduledMaintenanceState>> {
    const scheduledMaintenanceStates: Array<ScheduledMaintenanceState> =
      await this.findBy({
        query: {
          projectId: data.projectId,
        },
        skip: 0,
        limit: LIMIT_MAX,
        sort: {
          order: SortOrder.Ascending,
        },
        select: {
          _id: true,
          isResolvedState: true,
          isOngoingState: true,
          isScheduledState: true,
          order: true,
          name: true,
        },
        props: data.props,
      });

    return scheduledMaintenanceStates;
  }

  @CaptureSpan()
  public async getOngoingScheduledMaintenanceState(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ScheduledMaintenanceState> {
    const scheduledMaintenanceStates: Array<ScheduledMaintenanceState> =
      await this.getAllScheduledMaintenanceStates({
        projectId: data.projectId,
        props: data.props,
      });

    const ackScheduledMaintenanceState: ScheduledMaintenanceState | undefined =
      scheduledMaintenanceStates.find(
        (scheduledMaintenanceState: ScheduledMaintenanceState) => {
          return scheduledMaintenanceState?.isOngoingState;
        },
      );

    if (!ackScheduledMaintenanceState) {
      throw new BadDataException(
        "Ongoing ScheduledMaintenance State not found for this project",
      );
    }

    return ackScheduledMaintenanceState;
  }
}
export default new Service();
