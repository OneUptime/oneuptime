import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import AlertState from "../../Models/DatabaseModels/AlertState";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<AlertState> {
  public constructor() {
    super(AlertState);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<AlertState>,
  ): Promise<OnCreate<AlertState>> {
    if (!createBy.data.order) {
      throw new BadDataException("Alert State order is required");
    }

    if (!createBy.data.projectId) {
      throw new BadDataException("Alert State projectId is required");
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
    deleteBy: DeleteBy<AlertState>,
  ): Promise<OnDelete<AlertState>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting alert states. Please try the delete with objectId",
      );
    }

    let alertState: AlertState | null = null;

    if (!deleteBy.props.isRoot) {
      alertState = await this.findOneBy({
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
      carryForward: alertState,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<AlertState>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<AlertState>> {
    const deleteBy: DeleteBy<AlertState> = onDelete.deleteBy;
    const alertState: AlertState | null = onDelete.carryForward;

    if (!deleteBy.props.isRoot && alertState) {
      if (alertState && alertState.order && alertState.projectId) {
        await this.rearrangeOrder(
          alertState.order,
          alertState.projectId,
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
    updateBy: UpdateBy<AlertState>,
  ): Promise<OnUpdate<AlertState>> {
    if (updateBy.data.order && !updateBy.props.isRoot) {
      throw new BadDataException(
        "Alert State order should not be updated. Delete this alert state and create a new state with the right order.",
      );
    }

    return { updateBy, carryForward: null };
  }

  private async rearrangeOrder(
    currentOrder: number,
    projectId: ObjectID,
    increaseOrder: boolean = true,
  ): Promise<void> {
    // get alert with this order.
    const alertStates: Array<AlertState> = await this.findBy({
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

    for (const alertState of alertStates) {
      if (increaseOrder) {
        newOrder = alertState.order! + 1;
      } else {
        newOrder = alertState.order! - 1;
      }

      await this.updateOneBy({
        query: {
          _id: alertState._id!,
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
  public async getAllAlertStates(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<AlertState>> {
    const alertStates: Array<AlertState> = await this.findBy({
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
        isAcknowledgedState: true,
        isCreatedState: true,
        order: true,
      },
      props: data.props,
    });

    return alertStates;
  }

  @CaptureSpan()
  public async getUnresolvedAlertStates(
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<AlertState[]> {
    const alertStates: Array<AlertState> = await this.getAllAlertStates({
      projectId: projectId,
      props: props,
    });

    const unresolvedAlertStates: Array<AlertState> = [];

    for (const state of alertStates) {
      if (!state.isResolvedState) {
        unresolvedAlertStates.push(state);
      } else {
        break; // everything after resolved state is resolved
      }
    }

    return unresolvedAlertStates;
  }

  @CaptureSpan()
  public async getResolvedAlertState(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<AlertState> {
    const alertStates: Array<AlertState> = await this.getAllAlertStates({
      projectId: data.projectId,
      props: data.props,
    });

    const resolvedAlertState: AlertState | undefined = alertStates.find(
      (alertState: AlertState) => {
        return alertState?.isResolvedState;
      },
    );

    if (!resolvedAlertState) {
      throw new BadDataException(
        "Resolved Alert State not found for this project",
      );
    }

    return resolvedAlertState;
  }

  @CaptureSpan()
  public async getAcknowledgedAlertState(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<AlertState> {
    const alertStates: Array<AlertState> = await this.getAllAlertStates({
      projectId: data.projectId,
      props: data.props,
    });

    const ackAlertState: AlertState | undefined = alertStates.find(
      (alertState: AlertState) => {
        return alertState?.isAcknowledgedState;
      },
    );

    if (!ackAlertState) {
      throw new BadDataException(
        "Acknowledged Alert State not found for this project",
      );
    }

    return ackAlertState;
  }
}
export default new Service();
