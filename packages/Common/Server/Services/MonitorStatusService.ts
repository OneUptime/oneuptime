import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import StateOrderGuard from "../Utils/Database/StateOrderGuard";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { STATE_LISTS, StateListType } from "../../Utils/StateOrder";
import Model from "../../Models/DatabaseModels/MonitorStatus";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
/*
 * Statically imported despite the MonitorService <-> MonitorStatusService
 * cycle: both modules reference each other only from method bodies (never at
 * module-init time), so the default binding is always resolved by the time
 * these methods run. A dynamic import() cannot be used here - the App build's
 * TypeScript module target rejects it (TS1323).
 */
import MonitorService from "./MonitorService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A new status with no place goes just above the offline status, so an
   * outage still shows as the worst thing on a status page
   * (Common/Server/Utils/Database/StateOrderGuard). Where it ends up in the
   * list is then kept by DatabaseService (@ListOrderColumn), and it can be
   * moved like any row of a drag-ordered list.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await StateOrderGuard.beforeCreate({
      service: this,
      definition: STATE_LISTS[StateListType.MonitorStatus],
      createBy: createBy,
    });

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting Monitor Status. Please try the delete with objectId",
      );
    }

    /*
     * A project always keeps an operational and an offline status. Checked
     * before anything below changes a row, so a refused delete leaves
     * everything as it was.
     */
    await StateOrderGuard.beforeDelete({
      service: this,
      definition: STATE_LISTS[StateListType.MonitorStatus],
      deleteBy: deleteBy,
    });

    /*
     * Clear dangling currentMonitorStatusId references held by ALREADY
     * soft-deleted monitors before the hard-delete runs. A soft-deleted
     * monitor keeps its row and its currentMonitorStatusId foreign key
     * (ON DELETE NO ACTION), so a status a since-deleted monitor last adopted
     * cannot be removed while that reference lingers - the intermittent
     * "Monitor records still reference it" failure. Live monitors are left
     * untouched (see repointDeletedMonitorsAwayFromStatuses).
     */
    await this.clearDeletedMonitorReferences(deleteBy.query);

    return {
      deleteBy,
      carryForward: null,
    };
  }

  /**
   * Repoints soft-deleted monitors that still reference the statuses matched
   * by `query` to each project's default (lowest-priority) operational status,
   * falling back to any other remaining status when no operational status
   * survives. This keeps the Monitor.currentMonitorStatusId foreign key from
   * blocking a monitor-status delete on dead rows.
   */
  private async clearDeletedMonitorReferences(
    query: DeleteBy<Model>["query"],
  ): Promise<void> {
    const statusesBeingDeleted: Array<Model> = await this.findBy({
      query: query,
      select: {
        _id: true,
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // Group the statuses being deleted by project.
    const byProject: Map<
      string,
      { projectId: ObjectID; statusIds: Array<ObjectID> }
    > = new Map();

    for (const status of statusesBeingDeleted) {
      if (!status.id || !status.projectId) {
        continue;
      }

      const key: string = status.projectId.toString();

      if (!byProject.has(key)) {
        byProject.set(key, { projectId: status.projectId, statusIds: [] });
      }

      byProject.get(key)!.statusIds.push(status.id);
    }

    if (byProject.size === 0) {
      return;
    }

    for (const { projectId, statusIds } of byProject.values()) {
      const deletedSet: Set<string> = new Set(
        statusIds.map((id: ObjectID) => {
          return id.toString();
        }),
      );

      const fallbackStatusId: ObjectID | undefined =
        await this.findFallbackStatusId(projectId, deletedSet);

      if (!fallbackStatusId) {
        // Nothing valid to repoint to - leave the referential guard in place.
        continue;
      }

      await MonitorService.repointDeletedMonitorsAwayFromStatuses({
        fromMonitorStatusIds: statusIds,
        toMonitorStatusId: fallbackStatusId,
        projectId: projectId,
      });
    }
  }

  /**
   * Picks the status a repointed monitor should fall back to: the project's
   * default (lowest-priority) operational status that is not itself being
   * deleted, or - if none survives - any other remaining status.
   */
  private async findFallbackStatusId(
    projectId: ObjectID,
    deletedStatusIds: Set<string>,
  ): Promise<ObjectID | undefined> {
    const operationalStatuses: Array<Model> = await this.findBy({
      query: {
        projectId: projectId,
        isOperationalState: true,
      },
      select: {
        _id: true,
      },
      sort: {
        priority: SortOrder.Ascending,
        createdAt: SortOrder.Ascending,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const operationalFallback: ObjectID | undefined = this.firstSurvivingId(
      operationalStatuses,
      deletedStatusIds,
    );

    if (operationalFallback) {
      return operationalFallback;
    }

    // No operational status survives - repoint to any other remaining status.
    const anyStatuses: Array<Model> = await this.findBy({
      query: {
        projectId: projectId,
      },
      select: {
        _id: true,
      },
      sort: {
        priority: SortOrder.Ascending,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return this.firstSurvivingId(anyStatuses, deletedStatusIds);
  }

  /**
   * Returns the id of the first status in `statuses` (already priority-sorted)
   * that is not in `deletedStatusIds`, or undefined when none survives.
   */
  private firstSurvivingId(
    statuses: Array<Model>,
    deletedStatusIds: Set<string>,
  ): ObjectID | undefined {
    for (const status of statuses) {
      const id: ObjectID | null | undefined = status.id;

      if (id && !deletedStatusIds.has(id.toString())) {
        return id;
      }
    }

    return undefined;
  }
}
export default new Service();
