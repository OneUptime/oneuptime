import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import QueryHelper from "../Types/Database/QueryHelper";
import ProjectStateListCache from "../Utils/Database/ProjectStateListCache";
import MonitorOpenRecords from "../Utils/Monitor/MonitorOpenRecords";
import logger from "../Utils/Logger";
import StateOrderGuard from "../Utils/Database/StateOrderGuard";
import ArchivableValueGuard from "../Utils/Database/ArchivableValueGuard";
import {
  ARCHIVABLE_VALUES,
  ArchivableValueType,
} from "../../Utils/ArchivableValues";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { STATE_LISTS, StateListType } from "../../Utils/StateOrder";
import StartingStageUtil, { StartingState } from "../../Utils/StartingStage";
import ResolvedStateUtil from "../../Utils/ResolvedState";
import AcknowledgedStateUtil from "../../Utils/AcknowledgedState";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * What getAllIncidentStates reads of each state: every caller of the list needs
 * no more.
 */
const STATE_COLUMNS: Array<string> = [
  "_id",
  "isResolvedState",
  "isAcknowledgedState",
  "isCreatedState",
  "order",
  "name",
];

export class Service extends DatabaseService<IncidentState> {
  /*
   * Each project's states as OneUptime reads them (isRoot), kept in this
   * process until any of them changes (ProjectStateListCache): every monitor
   * result that meets a criteria asks which states are open, and every
   * auto-resolve which state is Resolved - two reads of the whole list a
   * result, for a list that changes a handful of times in a project's life.
   * The hooks below start a new generation of the project's list on every
   * create, update and delete of a state.
   */
  public readonly statesAsOneUptime: ProjectStateListCache<IncidentState> =
    new ProjectStateListCache<IncidentState>({
      namespace: "incident-state-list",
      description: "projects' incident states",
      modelType: IncidentState,
      columns: STATE_COLUMNS,
    });

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

    // Never created archived if it is a built-in one. See ArchivableValueGuard.
    await ArchivableValueGuard.beforeCreate({
      service: this,
      definition: ARCHIVABLE_VALUES[ArchivableValueType.IncidentState],
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

    // A built-in state is never archived. See ArchivableValueGuard.
    await ArchivableValueGuard.beforeUpdate({
      service: this,
      definition: ARCHIVABLE_VALUES[ArchivableValueType.IncidentState],
      updateBy: updateBy,
    });

    return { updateBy, carryForward: null };
  }

  /*
   * A state created, changed or deleted: the project's list kept in every
   * process is read again (statesAsOneUptime), and what its monitors knew of
   * their open incidents no longer counts - a state moved past Resolved, or made
   * the resolved one, changes which incidents are open (MonitorOpenRecords).
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<IncidentState>,
    createdItem: IncidentState,
  ): Promise<IncidentState> {
    await this.forgetProjects([createdItem.projectId]);
    return createdItem;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<IncidentState>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<IncidentState>> {
    await this.forgetProjectsOf(updatedItemIds);
    return onUpdate;
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<IncidentState>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<IncidentState>> {
    await this.forgetProjectsOf(itemIdsBeforeDelete);
    return onDelete;
  }

  // The projects of these states, deleted ones included. Never throws.
  private async forgetProjectsOf(stateIds: Array<ObjectID>): Promise<void> {
    if (stateIds.length === 0) {
      return;
    }

    try {
      const states: Array<IncidentState> = await this.findByWithDeleted({
        query: {
          _id: QueryHelper.any(stateIds),
        },
        select: {
          projectId: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

      await this.forgetProjects(
        states.map((state: IncidentState) => {
          return state.projectId;
        }),
      );
    } catch (err) {
      /*
       * The projects could not be read: each process reads its lists
       * again within ProjectStateListCache.ENTRY_TTL_MS, and no monitor goes
       * by what it knew of its open incidents.
       */
      logger.error(err);
      await MonitorOpenRecords.forgetAll();
    }
  }

  private async forgetProjects(
    projectIds: Array<ObjectID | undefined>,
  ): Promise<void> {
    await this.statesAsOneUptime.forgetProjects(projectIds);

    await Promise.all(
      Array.from(
        new Set<string>(
          projectIds
            .filter((projectId: ObjectID | undefined) => {
              return Boolean(projectId);
            })
            .map((projectId: ObjectID | undefined) => {
              return projectId!.toString();
            }),
        ),
      ).map(async (projectId: string): Promise<void> => {
        await MonitorOpenRecords.forgetProject(projectId);
      }),
    );
  }

  /*
   * The project's states, in order. Read as OneUptime (isRoot), from what this
   * process keeps of them (statesAsOneUptime); read for someone, from the
   * database as they may read it.
   */
  @CaptureSpan()
  public async getAllIncidentStates(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<IncidentState>> {
    if (data.props.isRoot === true) {
      return await this.statesAsOneUptime.getStates(
        data.projectId,
        (): Promise<Array<IncidentState>> => {
          return this.readAllIncidentStates(data);
        },
      );
    }

    return await this.readAllIncidentStates(data);
  }

  /*
   * The project's states as they are in the database now, past what this
   * process keeps: for an answer about a state the kept list does not have -
   * one created a moment ago, in another process - before saying it is not
   * the project's.
   */
  private async getAllIncidentStatesHaving(data: {
    projectId: ObjectID;
    stateId: ObjectID;
  }): Promise<Array<IncidentState>> {
    const states: Array<IncidentState> = await this.getAllIncidentStates({
      projectId: data.projectId,
      props: {
        isRoot: true,
      },
    });

    const stateId: string = data.stateId.toString();

    if (
      states.some((state: IncidentState) => {
        return state.id?.toString() === stateId;
      })
    ) {
      return states;
    }

    return await this.readAllIncidentStates({
      projectId: data.projectId,
      props: {
        isRoot: true,
      },
    });
  }

  private async readAllIncidentStates(data: {
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

  /*
   * The project's states an incident (or an incident episode) is still open
   * in: every state above the resolved state, top first. Everything from the
   * resolved state down counts as resolved, flagged or not
   * (Common/Utils/ResolvedState).
   */
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

    return ResolvedStateUtil.getUnresolvedStates({
      list: StateListType.IncidentState,
      states: incidentStates,
    });
  }

  /*
   * The ids of getUnresolvedIncidentStates, read as OneUptime: what a query
   * for the project's open incidents or incident episodes matches their
   * current state against (currentIncidentStateId: QueryHelper.any(...)).
   */
  @CaptureSpan()
  public async getUnresolvedIncidentStateIds(
    projectId: ObjectID,
  ): Promise<Array<ObjectID>> {
    return ResolvedStateUtil.getUnresolvedStateIds({
      list: StateListType.IncidentState,
      states: await this.getAllIncidentStates({
        projectId: projectId,
        props: {
          isRoot: true,
        },
      }),
    });
  }

  // The project's states that count as resolved, as getUnresolvedIncidentStateIds.
  @CaptureSpan()
  public async getResolvedIncidentStateIds(
    projectId: ObjectID,
  ): Promise<Array<ObjectID>> {
    return ResolvedStateUtil.getResolvedStateIds({
      list: StateListType.IncidentState,
      states: await this.getAllIncidentStates({
        projectId: projectId,
        props: {
          isRoot: true,
        },
      }),
    });
  }

  /*
   * Whether an incident (or an incident episode) in `incidentStateId` is
   * resolved (Common/Utils/ResolvedState). False for a state that is not
   * the project's.
   */
  @CaptureSpan()
  public async isResolvedIncidentState(data: {
    projectId: ObjectID;
    incidentStateId: ObjectID;
  }): Promise<boolean> {
    return ResolvedStateUtil.isResolved({
      list: StateListType.IncidentState,
      states: await this.getAllIncidentStatesHaving({
        projectId: data.projectId,
        stateId: data.incidentStateId,
      }),
      stateId: data.incidentStateId,
    });
  }

  /*
   * The project's resolved state: the first from the top flagged resolved,
   * which resolving an incident or an episode moves it into.
   */
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

    const resolvedIncidentState: IncidentState | null =
      ResolvedStateUtil.getResolvedState({
        list: StateListType.IncidentState,
        states: incidentStates,
      });

    if (!resolvedIncidentState) {
      throw new BadDataException(
        "Resolved Incident State not found for this project",
      );
    }

    return resolvedIncidentState;
  }

  /*
   * The project's acknowledged state: the first from the top flagged
   * acknowledged (Common/Utils/AcknowledgedState), which acknowledging an
   * incident or an episode moves it into.
   */
  @CaptureSpan()
  public async getAcknowledgedIncidentState(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<IncidentState> {
    const ackIncidentState: IncidentState | null =
      AcknowledgedStateUtil.getAcknowledgedState({
        list: StateListType.IncidentState,
        states: await this.getAllIncidentStates({
          projectId: data.projectId,
          props: data.props,
        }),
      });

    if (!ackIncidentState) {
      throw new BadDataException(
        "Acknowledged Incident State not found for this project",
      );
    }

    return ackIncidentState;
  }

  // The same, read as OneUptime: null when the project has none.
  @CaptureSpan()
  public async findAcknowledgedIncidentState(
    projectId: ObjectID,
  ): Promise<IncidentState | null> {
    return AcknowledgedStateUtil.getAcknowledgedState({
      list: StateListType.IncidentState,
      states: await this.getAllIncidentStates({
        projectId: projectId,
        props: {
          isRoot: true,
        },
      }),
    });
  }

  /*
   * Whether an incident (or an incident episode) in `incidentStateId` is
   * acknowledged - or further along, resolved included
   * (Common/Utils/AcknowledgedState): what stops its on-call escalation and
   * takes Acknowledge away. False for a state that is not the project's.
   */
  @CaptureSpan()
  public async isAcknowledgedIncidentState(data: {
    projectId: ObjectID;
    incidentStateId: ObjectID;
  }): Promise<boolean> {
    return AcknowledgedStateUtil.isAcknowledged({
      list: StateListType.IncidentState,
      states: await this.getAllIncidentStatesHaving({
        projectId: data.projectId,
        stateId: data.incidentStateId,
      }),
      stateId: data.incidentStateId,
    });
  }

  /*
   * The project's states an incident (or an incident episode) is
   * acknowledged but not resolved in - the acknowledged state and every state
   * after it, up to the resolved one: what an "Acknowledged" filter asks for.
   */
  @CaptureSpan()
  public async getAcknowledgedUnresolvedIncidentStateIds(
    projectId: ObjectID,
  ): Promise<Array<ObjectID>> {
    return AcknowledgedStateUtil.getAcknowledgedUnresolvedStateIds({
      list: StateListType.IncidentState,
      states: await this.getAllIncidentStates({
        projectId: projectId,
        props: {
          isRoot: true,
        },
      }),
    });
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
   * Where an incident or an incident episode starts when it is created in
   * `incidentStateId` (StartingStage): open, acknowledged or resolved, and
   * so what its create sets off - no on-call from acknowledged on, nothing
   * that answers a live problem once resolved. One read of the project's
   * whole list, as OneUptime, which only holds the project's own states:
   * null when `incidentStateId` is not one of them, which also checks that
   * it is.
   */
  @CaptureSpan()
  public async getStartingState(data: {
    projectId: ObjectID;
    incidentStateId: ObjectID;
  }): Promise<StartingState | null> {
    const incidentStates: Array<IncidentState> =
      await this.getAllIncidentStatesHaving({
        projectId: data.projectId,
        stateId: data.incidentStateId,
      });

    return StartingStageUtil.getStartingState({
      definition: STATE_LISTS[StateListType.IncidentState],
      states: incidentStates,
      stateId: data.incidentStateId,
    });
  }
}
export default new Service();
