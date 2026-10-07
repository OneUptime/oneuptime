import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import StateOrderGuard from "../Utils/Database/StateOrderGuard";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { STATE_LISTS, StateListType } from "../../Utils/StateOrder";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<ScheduledMaintenanceState> {
  public constructor() {
    super(ScheduledMaintenanceState);
  }

  /*
   * A new state with no place goes just above the completed state, and a signed-in
   * create that would put the built-in states out of order is refused
   * (Common/Server/Utils/Database/StateOrderGuard). Where it ends up in the
   * list is then kept by DatabaseService (@ListOrderColumn).
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<ScheduledMaintenanceState>,
  ): Promise<OnCreate<ScheduledMaintenanceState>> {
    await StateOrderGuard.beforeCreate({
      service: this,
      definition: STATE_LISTS[StateListType.ScheduledMaintenanceState],
      createBy: createBy,
    });

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

    // A project always keeps a scheduled, an ongoing, an ended and a completed state.
    await StateOrderGuard.beforeDelete({
      service: this,
      definition: STATE_LISTS[StateListType.ScheduledMaintenanceState],
      deleteBy: deleteBy,
    });

    return {
      deleteBy,
      carryForward: null,
    };
  }

  /*
   * A state can be moved - dragged on the settings page, or given another
   * number through the API - as long as the scheduled, ongoing, ended and completed states keep their order.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<ScheduledMaintenanceState>,
  ): Promise<OnUpdate<ScheduledMaintenanceState>> {
    await StateOrderGuard.beforeUpdate({
      service: this,
      definition: STATE_LISTS[StateListType.ScheduledMaintenanceState],
      updateBy: updateBy,
    });

    return { updateBy, carryForward: null };
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
          // All four built-in kinds, as ScheduledMaintenanceStartUtil reads them.
          isEndedState: true,
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
