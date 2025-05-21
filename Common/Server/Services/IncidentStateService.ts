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
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<IncidentState> {
  public constructor() {
    super(IncidentState);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<IncidentState>,
  ): Promise<OnCreate<IncidentState>> {
    if (!createBy.data.order) {
      throw new BadDataException("Incident State order is required");
    }

    if (!createBy.data.projectId) {
      throw new BadDataException("Incident State projectId is required");
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
    deleteBy: DeleteBy<IncidentState>,
  ): Promise<OnDelete<IncidentState>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting incident states. Please try the delete with objectId",
      );
    }

    let incidentState: IncidentState | null = null;

    if (!deleteBy.props.isRoot) {
      incidentState = await this.findOneBy({
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
      carryForward: incidentState,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<IncidentState>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<IncidentState>> {
    const deleteBy: DeleteBy<IncidentState> = onDelete.deleteBy;
    const incidentState: IncidentState | null = onDelete.carryForward;

    if (!deleteBy.props.isRoot && incidentState) {
      if (incidentState && incidentState.order && incidentState.projectId) {
        await this.rearrangeOrder(
          incidentState.order,
          incidentState.projectId,
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
    updateBy: UpdateBy<IncidentState>,
  ): Promise<OnUpdate<IncidentState>> {
    if (updateBy.data.order && !updateBy.props.isRoot) {
      throw new BadDataException(
        "Incident State order should not be updated. Delete this incident state and create a new state with the right order.",
      );
    }

    return { updateBy, carryForward: null };
  }

  private async rearrangeOrder(
    currentOrder: number,
    projectId: ObjectID,
    increaseOrder: boolean = true,
  ): Promise<void> {
    // get incident with this order.
    const incidentStates: Array<IncidentState> = await this.findBy({
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

    for (const incidentState of incidentStates) {
      if (increaseOrder) {
        newOrder = incidentState.order! + 1;
      } else {
        newOrder = incidentState.order! - 1;
      }

      await this.updateOneBy({
        query: {
          _id: incidentState._id!,
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
  public async getAllIncidentStates(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<IncidentState>> {
    const incidentStates: Array<IncidentState> = await this.findBy({
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
        name: true,
      },
      props: data.props,
    });

    return incidentStates;
  }

  @CaptureSpan()
  public async getUnresolvedIncidentStates(
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<IncidentState[]> {
    const incidentStates: Array<IncidentState> =
      await this.getAllIncidentStates({
        projectId: projectId,
        props: props,
      });

    const unresolvedIncidentStates: Array<IncidentState> = [];

    for (const state of incidentStates) {
      if (!state.isResolvedState) {
        unresolvedIncidentStates.push(state);
      } else {
        break; // everything after resolved state is resolved
      }
    }

    return unresolvedIncidentStates;
  }

  @CaptureSpan()
  public async getResolvedIncidentState(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<IncidentState> {
    const incidentStates: Array<IncidentState> =
      await this.getAllIncidentStates({
        projectId: data.projectId,
        props: data.props,
      });

    const resolvedIncidentState: IncidentState | undefined =
      incidentStates.find((incidentState: IncidentState) => {
        return incidentState?.isResolvedState;
      });

    if (!resolvedIncidentState) {
      throw new BadDataException(
        "Resolved Incident State not found for this project",
      );
    }

    return resolvedIncidentState;
  }

  @CaptureSpan()
  public async getAcknowledgedIncidentState(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<IncidentState> {
    const incidentStates: Array<IncidentState> =
      await this.getAllIncidentStates({
        projectId: data.projectId,
        props: data.props,
      });

    const ackIncidentState: IncidentState | undefined = incidentStates.find(
      (incidentState: IncidentState) => {
        return incidentState?.isAcknowledgedState;
      },
    );

    if (!ackIncidentState) {
      throw new BadDataException(
        "Acknowledged Incident State not found for this project",
      );
    }

    return ackIncidentState;
  }
}
export default new Service();
