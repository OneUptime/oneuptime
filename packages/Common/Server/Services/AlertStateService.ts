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
import StartingStageUtil, { StartingStage } from "../../Utils/StartingStage";
import AlertState from "../../Models/DatabaseModels/AlertState";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<AlertState> {
  public constructor() {
    super(AlertState);
  }

  /*
   * A new state with no place goes just above the resolved state, and a signed-in
   * create that would put the built-in states out of order is refused
   * (Common/Server/Utils/Database/StateOrderGuard). Where it ends up in the
   * list is then kept by DatabaseService (@ListOrderColumn).
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<AlertState>,
  ): Promise<OnCreate<AlertState>> {
    await StateOrderGuard.beforeCreate({
      service: this,
      definition: STATE_LISTS[StateListType.AlertState],
      createBy: createBy,
    });

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

    // A project always keeps a created, an acknowledged and a resolved state.
    await StateOrderGuard.beforeDelete({
      service: this,
      definition: STATE_LISTS[StateListType.AlertState],
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
    updateBy: UpdateBy<AlertState>,
  ): Promise<OnUpdate<AlertState>> {
    await StateOrderGuard.beforeUpdate({
      service: this,
      definition: STATE_LISTS[StateListType.AlertState],
      updateBy: updateBy,
    });

    return { updateBy, carryForward: null };
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

  /*
   * The project's created state: where a new alert or alert episode starts
   * when its create names no state (AlertService, AlertEpisodeService), as
   * every one OneUptime raises itself does. Such a record starts open
   * (StartingStage), with no need to read the rest of the list.
   */
  @CaptureSpan()
  public async getCreatedAlertStateId(projectId: ObjectID): Promise<ObjectID> {
    const createdAlertState: AlertState | null = await this.findOneBy({
      query: {
        projectId: projectId,
        isCreatedState: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!createdAlertState || !createdAlertState.id) {
      throw new BadDataException(
        "Created alert state not found for this project. Please add created alert state from settings.",
      );
    }

    return createdAlertState.id;
  }

  /*
   * How far along an alert or an alert episode starts when it is created in
   * one of the project's alert states: open, acknowledged or resolved, by
   * the state's place in the project's list (StartingStage). What its create
   * then sets off follows from it - no on-call from acknowledged on, nothing
   * that answers a live problem once resolved. Read once per create, from
   * the project's whole list, as OneUptime.
   */
  @CaptureSpan()
  public async getStartingStage(data: {
    projectId: ObjectID;
    alertStateId: ObjectID;
  }): Promise<StartingStage> {
    const alertStates: Array<AlertState> = await this.getAllAlertStates({
      projectId: data.projectId,
      props: {
        isRoot: true,
      },
    });

    return StartingStageUtil.getStage({
      definition: STATE_LISTS[StateListType.AlertState],
      states: alertStates,
      stateId: data.alertStateId,
    });
  }

  /*
   * Whether one of the project's alert states is flagged as resolved: what
   * an alert episode's timeline reads to set or clear its resolvedAt
   * (AlertEpisodeStateTimelineService), and so what its create stamps.
   */
  @CaptureSpan()
  public async isResolvedAlertState(data: {
    projectId: ObjectID;
    alertStateId: ObjectID;
  }): Promise<boolean> {
    const alertState: AlertState | null = await this.findOneBy({
      query: {
        _id: data.alertStateId.toString(),
        projectId: data.projectId,
      },
      select: {
        isResolvedState: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(alertState?.isResolvedState);
  }
}
export default new Service();
