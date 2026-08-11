import logger from "../Utils/Logger";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Model from "../../Models/DatabaseModels/MonitorStatus";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.priority) {
      throw new BadDataException("Monitor Status priority is required");
    }

    if (!createBy.data.projectId) {
      throw new BadDataException("Monitor Status projectId is required");
    }

    await this.rearrangePriority(
      createBy.data.priority,
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
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting Monitor Status. Please try the delete with objectId",
      );
    }

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

    let monitorStatus: Model | null = null;

    if (!deleteBy.props.isRoot) {
      monitorStatus = await this.findOneBy({
        query: deleteBy.query,
        props: {
          isRoot: true,
        },
        select: {
          priority: true,
          projectId: true,
        },
      });
    }

    return {
      deleteBy,
      carryForward: monitorStatus,
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

    const MonitorService: (typeof import("./MonitorService"))["default"] = (
      await import("./MonitorService")
    ).default;

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

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
    const monitorStatus: Model | null = onDelete.carryForward;

    if (!deleteBy.props.isRoot && monitorStatus) {
      if (monitorStatus && monitorStatus.priority && monitorStatus.projectId) {
        await this.rearrangePriority(
          monitorStatus.priority,
          monitorStatus.projectId,
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
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.data.priority && !updateBy.props.isRoot) {
      throw new BadDataException(
        "Monitor Status priority should not be updated. Delete this monitor status and create a new state with the right priority.",
      );
    }

    return { updateBy, carryForward: null };
  }

  private async rearrangePriority(
    currentPriority: number,
    projectId: ObjectID,
    increasePriority: boolean = true,
  ): Promise<void> {
    // get monitor status with this priority.
    const monitorStatuses: Array<Model> = await this.findBy({
      query: {
        priority: QueryHelper.greaterThanEqualTo(currentPriority),
        projectId: projectId,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        priority: true,
      },
      sort: {
        priority: SortOrder.Ascending,
      },
    });

    let newPriority: number = currentPriority;

    for (const monitorStatus of monitorStatuses) {
      if (increasePriority) {
        newPriority = monitorStatus.priority! + 1;
      } else {
        newPriority = monitorStatus.priority! - 1;
      }

      /*
       * Concurrent deletes (e.g. Terraform destroying several statuses in
       * parallel) can soft-delete a status between the findBy above and this
       * update. save() then treats the row as new and INSERTs with a null
       * projectId, failing the whole delete with a 500. A status that
       * vanished mid-rearrange needs no repositioning — skip it.
       */
      try {
        await this.updateOneBy({
          query: {
            _id: monitorStatus._id!,
          },
          data: {
            priority: newPriority,
          },
          props: {
            isRoot: true,
          },
        });
      } catch (err) {
        logger.warn(
          `rearrangePriority: skipping monitor status ${monitorStatus._id?.toString()} (likely deleted concurrently): ${err}`,
        );
      }
    }
  }
}
export default new Service();
