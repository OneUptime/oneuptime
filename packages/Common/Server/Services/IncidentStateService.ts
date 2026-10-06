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

  /*
   * The project's created state: where a new incident or incident episode
   * starts when its create names no state and, for an incident, no template
   * names one (IncidentService, IncidentEpisodeService) - as every incident a
   * monitor declares and every episode a grouping rule opens does. Such a
   * record starts open (StartingStage), with no need to read the rest of the
   * list.
   */
  @CaptureSpan()
  public async getCreatedIncidentStateId(
    projectId: ObjectID,
  ): Promise<ObjectID> {
    const createdIncidentState: IncidentState | null = await this.findOneBy({
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

    if (!createdIncidentState || !createdIncidentState.id) {
      throw new BadDataException(
        "Created incident state not found for this project. Please add created incident state from settings.",
      );
    }

    return createdIncidentState.id;
  }

  /*
   * How far along an incident or an incident episode starts when it is
   * created in one of the project's incident states: open, acknowledged or
   * resolved, by the state's place in the project's list (StartingStage).
   * What its create then sets off follows from it - no on-call from
   * acknowledged on, nothing that answers a live problem once resolved. Read
   * once per create, from the project's whole list, as OneUptime.
   */
  @CaptureSpan()
  public async getStartingStage(data: {
    projectId: ObjectID;
    incidentStateId: ObjectID;
  }): Promise<StartingStage> {
    const incidentStates: Array<IncidentState> =
      await this.getAllIncidentStates({
        projectId: data.projectId,
        props: {
          isRoot: true,
        },
      });

    return StartingStageUtil.getStage({
      definition: STATE_LISTS[StateListType.IncidentState],
      states: incidentStates,
      stateId: data.incidentStateId,
    });
  }

  /*
   * Whether one of the project's incident states is flagged as resolved:
   * what an incident episode's timeline reads to set or clear its
   * resolvedAt (IncidentEpisodeStateTimelineService), and so what its create
   * stamps.
   */
  @CaptureSpan()
  public async isResolvedIncidentState(data: {
    projectId: ObjectID;
    incidentStateId: ObjectID;
  }): Promise<boolean> {
    const incidentState: IncidentState | null = await this.findOneBy({
      query: {
        _id: data.incidentStateId.toString(),
        projectId: data.projectId,
      },
      select: {
        isResolvedState: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(incidentState?.isResolvedState);
  }
}
export default new Service();
