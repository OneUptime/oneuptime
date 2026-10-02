import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import StateOrderGuard from "../Utils/Database/StateOrderGuard";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { STATE_LISTS, StateListType } from "../../Utils/StateOrder";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<IncidentState> {
  public constructor() {
    super(IncidentState);
  }

  /*
   * A new state with no place goes just above the resolved state, and a signed-in
   * create that would put the built-in states out of order is refused
   * (Common/Server/Utils/Database/StateOrderGuard). Where it ends up in the
   * list is then kept by DatabaseService (@ListOrderColumn).
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<IncidentState>,
  ): Promise<OnCreate<IncidentState>> {
    await StateOrderGuard.beforeCreate({
      service: this,
      definition: STATE_LISTS[StateListType.IncidentState],
      createBy: createBy,
    });

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

    // A project always keeps a created, an acknowledged and a resolved state.
    await StateOrderGuard.beforeDelete({
      service: this,
      definition: STATE_LISTS[StateListType.IncidentState],
      deleteBy: deleteBy,
    });

    return {
      deleteBy,
      carryForward: null,
    };
  }

  /*
   * A state can be moved - dragged on the settings page, or given another
   * number through the API - as long as the created, acknowledged and resolved states keep their order.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<IncidentState>,
  ): Promise<OnUpdate<IncidentState>> {
    await StateOrderGuard.beforeUpdate({
      service: this,
      definition: STATE_LISTS[StateListType.IncidentState],
      updateBy: updateBy,
    });

    return { updateBy, carryForward: null };
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
