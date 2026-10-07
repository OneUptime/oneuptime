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
import StartingStageUtil, { StartingState } from "../../Utils/StartingStage";
import ResolvedStateUtil from "../../Utils/ResolvedState";
import AcknowledgedStateUtil from "../../Utils/AcknowledgedState";
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

  /*
   * The project's states an alert (or an alert episode) is still open in:
   * every state above the resolved state, top first. Everything from the
   * resolved state down counts as resolved, flagged or not
   * (Common/Utils/ResolvedState).
   */
  @CaptureSpan()
  public async getUnresolvedAlertStates(
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<AlertState[]> {
    const alertStates: Array<AlertState> = await this.getAllAlertStates({
      projectId: projectId,
      props: props,
    });

    return ResolvedStateUtil.getUnresolvedStates({
      list: StateListType.AlertState,
      states: alertStates,
    });
  }

  /*
   * The ids of getUnresolvedAlertStates, read as OneUptime: what a query for
   * the project's open alerts or alert episodes matches their current state
   * against (currentAlertStateId: QueryHelper.any(...)).
   */
  @CaptureSpan()
  public async getUnresolvedAlertStateIds(
    projectId: ObjectID,
  ): Promise<Array<ObjectID>> {
    return ResolvedStateUtil.getUnresolvedStateIds({
      list: StateListType.AlertState,
      states: await this.getAllAlertStates({
        projectId: projectId,
        props: {
          isRoot: true,
        },
      }),
    });
  }

  // The project's states that count as resolved, as getUnresolvedAlertStateIds.
  @CaptureSpan()
  public async getResolvedAlertStateIds(
    projectId: ObjectID,
  ): Promise<Array<ObjectID>> {
    return ResolvedStateUtil.getResolvedStateIds({
      list: StateListType.AlertState,
      states: await this.getAllAlertStates({
        projectId: projectId,
        props: {
          isRoot: true,
        },
      }),
    });
  }

  /*
   * Whether an alert (or an alert episode) in `alertStateId` is resolved
   * (Common/Utils/ResolvedState). False for a state that is not the
   * project's.
   */
  @CaptureSpan()
  public async isResolvedAlertState(data: {
    projectId: ObjectID;
    alertStateId: ObjectID;
  }): Promise<boolean> {
    return ResolvedStateUtil.isResolved({
      list: StateListType.AlertState,
      states: await this.getAllAlertStates({
        projectId: data.projectId,
        props: {
          isRoot: true,
        },
      }),
      stateId: data.alertStateId,
    });
  }

  /*
   * The project's resolved state: the first from the top flagged resolved,
   * which resolving an alert or an episode moves it into.
   */
  @CaptureSpan()
  public async getResolvedAlertState(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<AlertState> {
    const alertStates: Array<AlertState> = await this.getAllAlertStates({
      projectId: data.projectId,
      props: data.props,
    });

    const resolvedAlertState: AlertState | null =
      ResolvedStateUtil.getResolvedState({
        list: StateListType.AlertState,
        states: alertStates,
      });

    if (!resolvedAlertState) {
      throw new BadDataException(
        "Resolved Alert State not found for this project",
      );
    }

    return resolvedAlertState;
  }

  /*
   * The project's acknowledged state: the first from the top flagged
   * acknowledged (Common/Utils/AcknowledgedState), which acknowledging an
   * alert or an episode moves it into.
   */
  @CaptureSpan()
  public async getAcknowledgedAlertState(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<AlertState> {
    const ackAlertState: AlertState | null =
      AcknowledgedStateUtil.getAcknowledgedState({
        list: StateListType.AlertState,
        states: await this.getAllAlertStates({
          projectId: data.projectId,
          props: data.props,
        }),
      });

    if (!ackAlertState) {
      throw new BadDataException(
        "Acknowledged Alert State not found for this project",
      );
    }

    return ackAlertState;
  }

  // The same, read as OneUptime: null when the project has none.
  @CaptureSpan()
  public async findAcknowledgedAlertState(
    projectId: ObjectID,
  ): Promise<AlertState | null> {
    return AcknowledgedStateUtil.getAcknowledgedState({
      list: StateListType.AlertState,
      states: await this.getAllAlertStates({
        projectId: projectId,
        props: {
          isRoot: true,
        },
      }),
    });
  }

  /*
   * Whether an alert (or an alert episode) in `alertStateId` is acknowledged
   * - or further along, resolved included (Common/Utils/AcknowledgedState):
   * what stops its on-call escalation and takes Acknowledge away. False for a
   * state that is not the project's.
   */
  @CaptureSpan()
  public async isAcknowledgedAlertState(data: {
    projectId: ObjectID;
    alertStateId: ObjectID;
  }): Promise<boolean> {
    return AcknowledgedStateUtil.isAcknowledged({
      list: StateListType.AlertState,
      states: await this.getAllAlertStates({
        projectId: data.projectId,
        props: {
          isRoot: true,
        },
      }),
      stateId: data.alertStateId,
    });
  }

  /*
   * The project's states an alert (or an alert episode) is acknowledged but
   * not resolved in - the acknowledged state and every state after it, up to
   * the resolved one: what an "Acknowledged" filter asks for.
   */
  @CaptureSpan()
  public async getAcknowledgedUnresolvedAlertStateIds(
    projectId: ObjectID,
  ): Promise<Array<ObjectID>> {
    return AcknowledgedStateUtil.getAcknowledgedUnresolvedStateIds({
      list: StateListType.AlertState,
      states: await this.getAllAlertStates({
        projectId: projectId,
        props: {
          isRoot: true,
        },
      }),
    });
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
   * Where an alert or an alert episode starts when it is created in
   * `alertStateId` (StartingStage): open, acknowledged or resolved, and so
   * what its create sets off - no on-call from acknowledged on, nothing that
   * answers a live problem once resolved. One read of the project's whole
   * list, as OneUptime, which only holds the project's own states: null
   * when `alertStateId` is not one of them, which also checks that it is.
   */
  @CaptureSpan()
  public async getStartingState(data: {
    projectId: ObjectID;
    alertStateId: ObjectID;
  }): Promise<StartingState | null> {
    const alertStates: Array<AlertState> = await this.getAllAlertStates({
      projectId: data.projectId,
      props: {
        isRoot: true,
      },
    });

    return StartingStageUtil.getStartingState({
      definition: STATE_LISTS[StateListType.AlertState],
      states: alertStates,
      stateId: data.alertStateId,
    });
  }
}
export default new Service();
