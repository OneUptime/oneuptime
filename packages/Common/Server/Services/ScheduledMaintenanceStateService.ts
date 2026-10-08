import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import StateOrderGuard from "../Utils/Database/StateOrderGuard";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { STATE_LISTS, StateListType } from "../../Utils/StateOrder";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStartUtil from "../../Utils/ScheduledMaintenanceStart";
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

  /*
   * The project's ongoing state: the one the start at an event's time and
   * Mark as Ongoing move it into (ScheduledMaintenanceStartUtil
   * .getOngoingState). Not what tells whether an event is in progress -
   * getInProgressScheduledMaintenanceStateIds does.
   */
  @CaptureSpan()
  public async getOngoingScheduledMaintenanceState(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ScheduledMaintenanceState> {
    const ongoingScheduledMaintenanceState: ScheduledMaintenanceState | null =
      ScheduledMaintenanceStartUtil.getOngoingState({
        states: await this.getAllScheduledMaintenanceStates({
          projectId: data.projectId,
          props: data.props,
        }),
      });

    if (!ongoingScheduledMaintenanceState) {
      throw new BadDataException(
        "Ongoing ScheduledMaintenance State not found for this project",
      );
    }

    return ongoingScheduledMaintenanceState;
  }

  /*
   * The ids of the project's states an event is in progress in: its ongoing
   * state, and every state of the project's own placed between Ongoing and
   * Ended, such as "Verifying" (Common/Utils/ScheduledMaintenanceStart). What
   * every query for the events in progress right now asks for, by
   * currentScheduledMaintenanceStateId - the status page's ongoing list, the
   * network sites and the telemetry series a window silences, the monitors
   * an SLO holds its burn-rate alerts back for, the Microsoft Teams "ongoing
   * maintenance" answer. One read of the project's states.
   */
  @CaptureSpan()
  public async getInProgressScheduledMaintenanceStateIds(
    projectId: ObjectID,
  ): Promise<Array<ObjectID>> {
    return ScheduledMaintenanceStartUtil.getInProgressStateIds({
      states: await this.getAllScheduledMaintenanceStates({
        projectId: projectId,
        props: {
          isRoot: true,
        },
      }),
    });
  }

  /*
   * The same rule for every project at once, as the queries for the events
   * it holds: for the jobs that act on every event in progress, such as the
   * end at an event's end time (ChangeStateToEnded). Each project's ongoing
   * state is asked for by its flag - reading every project's states to name
   * them would cost a row per project on every run - and the states projects
   * added themselves between Ongoing and Ended by their ids. Those are few:
   * the states that are none of the four kinds are read, and then the lists
   * of just the projects that have any, to place them.
   */
  @CaptureSpan()
  public async getInProgressEventQueriesOfEveryProject(): Promise<
    Array<Query<ScheduledMaintenance>>
  > {
    const ongoingStateQuery: Query<ScheduledMaintenance> = {
      currentScheduledMaintenanceState: {
        isOngoingState: true,
      } as Query<ScheduledMaintenanceState>,
    } as Query<ScheduledMaintenance>;

    const statesOfTheirOwn: Array<ScheduledMaintenanceState> =
      await this.findAllBy({
        query: {
          isScheduledState: false,
          isOngoingState: false,
          isEndedState: false,
          isResolvedState: false,
        },
        select: {
          _id: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

    const projectIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const state of statesOfTheirOwn) {
      if (state.projectId) {
        projectIds.set(state.projectId.toString(), state.projectId);
      }
    }

    if (projectIds.size === 0) {
      return [ongoingStateQuery];
    }

    const statesOfThoseProjects: Array<ScheduledMaintenanceState> =
      await this.findAllBy({
        query: {
          projectId: QueryHelper.any(Array.from(projectIds.values())),
        },
        select: {
          _id: true,
          projectId: true,
          order: true,
          isScheduledState: true,
          isOngoingState: true,
          isEndedState: true,
          isResolvedState: true,
        },
        props: {
          isRoot: true,
        },
      });

    const statesByProjectId: Map<string, Array<ScheduledMaintenanceState>> =
      new Map<string, Array<ScheduledMaintenanceState>>();

    for (const state of statesOfThoseProjects) {
      const projectKey: string = state.projectId?.toString() || "";

      if (!statesByProjectId.has(projectKey)) {
        statesByProjectId.set(projectKey, []);
      }

      statesByProjectId.get(projectKey)!.push(state);
    }

    const inProgressStateIdsOfTheirOwn: Array<ObjectID> = [];

    for (const projectStates of statesByProjectId.values()) {
      for (const stateId of ScheduledMaintenanceStartUtil.getInProgressStateIds(
        { states: projectStates },
      )) {
        const state: ScheduledMaintenanceState | undefined =
          projectStates.find(
            (candidate: ScheduledMaintenanceState): boolean => {
              return candidate.id?.toString() === stateId.toString();
            },
          );

        // The ongoing states are asked for by their flag already.
        if (
          state &&
          ScheduledMaintenanceStartUtil.isInProgressByFlags(state) === null
        ) {
          inProgressStateIdsOfTheirOwn.push(stateId);
        }
      }
    }

    if (inProgressStateIdsOfTheirOwn.length === 0) {
      return [ongoingStateQuery];
    }

    return [
      ongoingStateQuery,
      {
        currentScheduledMaintenanceStateId: QueryHelper.any(
          inProgressStateIdsOfTheirOwn,
        ),
      } as Query<ScheduledMaintenance>,
    ];
  }
}
export default new Service();
