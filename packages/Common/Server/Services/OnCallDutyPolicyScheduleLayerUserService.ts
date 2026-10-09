import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectReferencesService from "./ProjectReferencesService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import PositiveNumber from "../../Types/PositiveNumber";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
import { OnCallShiftChangeReason } from "../Utils/OnCall/OnCallShiftChangeListeners";
import logger from "../Utils/Logger";
import ContiguousOrder from "../Utils/Database/ContiguousOrder";

/*
 * A layer user moved to another place by a non-root update: where it was,
 * where it goes, and its layer. Read before the update (onBeforeUpdate) and
 * acted on after it (onUpdateSuccess), only if the update wrote that row.
 */
interface LayerUserMove {
  layerUserId: ObjectID;
  previousOrder: number;
  newOrder: number;
  onCallDutyPolicyScheduleLayerId: ObjectID;
  projectId: ObjectID;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Adding, removing or re-ordering a layer user rewrites the rotation of the
   * whole schedule (the engine derives every position from the current user
   * list), so the schedule's shiftConfigVersion is bumped, its feed caches
   * dropped, and the listeners told — naming the user the row belongs to so
   * their personal feed and reminders are refreshed even when they are no
   * longer a member. Runs after the roster refresh; never throws.
   */
  private async propagateLayerUserChange(
    scheduleId: ObjectID | null | undefined,
    projectId: ObjectID | null | undefined,
    userId: ObjectID | null | undefined,
  ): Promise<void> {
    if (!scheduleId) {
      return;
    }

    await OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
      scheduleIds: [scheduleId],
      projectId: projectId || null,
      userIds: userId ? [userId] : [],
      reason: OnCallShiftChangeReason.LayerUserChanged,
    });
  }

  /**
   * Re-resolve and persist the schedule's roster after a layer-user change.
   * Best-effort: the row is already committed when the success hooks run, so
   * a throwing refresh (a concurrently-deleted schedule, a transient
   * persistence or notification failure) must not abort the hook before
   * propagateLayerUserChange bumps the shiftConfigVersion and purges the
   * feed caches — otherwise the caches would keep serving the pre-edit
   * roster for up to their TTL and the reminder change pass would be
   * skipped. Mirrors
   * OnCallDutyPolicyEscalationRuleScheduleService.refreshScheduleRoster.
   */
  private async refreshScheduleRosterBestEffort(
    scheduleId: ObjectID,
  ): Promise<void> {
    try {
      await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
        scheduleId,
      );
    } catch (err) {
      logger.error(
        "Error refreshing the schedule roster after a layer-user change (best-effort).",
      );
      logger.error(err);
    }
  }

  /**
   * Renumber the users of a layer 1..n by their current order. Used by the
   * team-member cleanup, which deletes layer-user rows as root (the per-row
   * re-sequencing in onDeleteSuccess only runs for non-root deletes) and
   * must restore the contiguous 1-based order the create-default (count + 1)
   * and delete paths rely on. Idempotent.
   */
  @CaptureSpan()
  public async resequenceOrderInLayer(
    onCallDutyPolicyScheduleLayerId: ObjectID,
  ): Promise<void> {
    const rows: Array<Model> = await this.findBy({
      query: {
        onCallDutyPolicyScheduleLayerId: onCallDutyPolicyScheduleLayerId,
      },
      select: {
        _id: true,
        order: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    let expectedOrder: number = 1;

    for (const row of rows) {
      if (row.order !== expectedOrder && row._id) {
        /*
         * ignoreHooks: renumbering is bookkeeping, not a roster change — the
         * caller (the team-member cleanup) refreshes and propagates once per
         * schedule itself. With hooks on, every renumbered row would run a
         * full onUpdateSuccess (semaphore-locked roster refresh + version
         * bump + cache purge + listener pass), i.e. N-1 redundant refreshes
         * per layer, and any hook throw would abort the remaining renumbering.
         */
        await this.updateOneBy({
          query: {
            _id: row._id,
          },
          data: {
            order: expectedOrder,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
      }
      expectedOrder++;
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (!createBy.data.onCallDutyPolicyScheduleLayerId) {
      throw new BadDataException("onCallDutyPolicyScheduleLayerId is required");
    }

    // The person, under either of their names (the two must agree).
    const userId: ObjectID | null = RelationIdUtil.readConsistent(
      createBy.data as unknown as Record<string, unknown>,
      ["userId", "user"],
      "User",
    );

    if (!userId) {
      throw new BadDataException("userId is required");
    }

    if (!createBy.data.order) {
      // count number of users in this layer.

      const count: PositiveNumber = await this.countBy({
        query: {
          onCallDutyPolicyScheduleLayerId:
            createBy.data.onCallDutyPolicyScheduleLayerId!,
        },
        props: {
          isRoot: true,
        },
      });

      createBy.data.order = count.toNumber() + 1;
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  /*
   * Only for a layer user the delete actually removed: the users after it
   * close its gap (within its layer and project) and the roster is
   * refreshed.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
    const resource: Model | null = onDelete.carryForward;

    const wasDeleted: boolean = Boolean(
      resource &&
        resource.id &&
        itemIdsBeforeDelete.some((id: ObjectID): boolean => {
          return id.toString() === resource.id!.toString();
        }),
    );

    if (!deleteBy.props.isRoot && resource && wasDeleted) {
      if (
        resource.order &&
        resource.onCallDutyPolicyScheduleLayerId &&
        resource.projectId
      ) {
        await ContiguousOrder.afterDelete({
          service: this,
          list: {
            onCallDutyPolicyScheduleLayerId:
              resource.onCallDutyPolicyScheduleLayerId,
            projectId: resource.projectId,
          },
          order: resource.order,
        });

        if (resource.onCallDutyPolicyScheduleId) {
          await this.refreshScheduleRosterBestEffort(
            resource.onCallDutyPolicyScheduleId,
          );

          await this.propagateLayerUserChange(
            resource.onCallDutyPolicyScheduleId,
            resource.projectId,
            resource.userId,
          );
        }
      }
    }

    return {
      deleteBy: deleteBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting status page resource. Please try the delete with objectId",
      );
    }

    let resource: Model | null = null;

    if (!deleteBy.props.isRoot) {
      resource = await this.findOneBy({
        query: deleteBy.query,
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          onCallDutyPolicyScheduleLayerId: true,
          onCallDutyPolicyScheduleId: true,
          projectId: true,
          userId: true,
        },
      });
    }

    return {
      deleteBy,
      carryForward: resource,
    };
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const resource: Model | null = await this.findOneById({
      id: createdItem.id!,
      select: {
        onCallDutyPolicyScheduleId: true,
        onCallDutyPolicyScheduleLayerId: true,
        projectId: true,
        userId: true,
        order: true,
      },
      props: {
        isRoot: true,
      },
    });

    /*
     * The users at the new user's place and after it move one place down -
     * now that it exists, so a create that is refused or fails leaves the
     * layer's order as it was.
     */
    if (
      resource &&
      resource.order &&
      resource.onCallDutyPolicyScheduleLayerId &&
      resource.projectId
    ) {
      await ContiguousOrder.afterCreate({
        service: this,
        list: {
          onCallDutyPolicyScheduleLayerId:
            resource.onCallDutyPolicyScheduleLayerId,
          projectId: resource.projectId,
        },
        createdItemId: createdItem.id!,
        order: resource.order,
      });
    }

    if (!resource || !resource.onCallDutyPolicyScheduleId) {
      return createdItem;
    }

    await this.refreshScheduleRosterBestEffort(
      resource.onCallDutyPolicyScheduleId,
    );

    await this.propagateLayerUserChange(
      resource.onCallDutyPolicyScheduleId,
      resource.projectId,
      resource.userId,
    );

    return createdItem;
  }

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const move: LayerUserMove | null =
      (onUpdate.carryForward as LayerUserMove) || null;

    // The users the moved one passed step aside, now that it has moved.
    if (
      move &&
      updatedItemIds.some((id: ObjectID): boolean => {
        return id.toString() === move.layerUserId.toString();
      })
    ) {
      await ContiguousOrder.afterMove({
        service: this,
        list: {
          onCallDutyPolicyScheduleLayerId: move.onCallDutyPolicyScheduleLayerId,
          projectId: move.projectId,
        },
        movedItemId: move.layerUserId,
        previousOrder: move.previousOrder,
        newOrder: move.newOrder,
      });
    }

    for (const item of updatedItemIds) {
      const resource: Model | null = await this.findOneById({
        id: item,
        select: {
          onCallDutyPolicyScheduleId: true,
          projectId: true,
          userId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!resource || !resource.onCallDutyPolicyScheduleId) {
        continue;
      }

      await this.refreshScheduleRosterBestEffort(
        resource.onCallDutyPolicyScheduleId,
      );

      await this.propagateLayerUserChange(
        resource.onCallDutyPolicyScheduleId,
        resource.projectId,
        resource.userId,
      );
    }

    return {
      updateBy: onUpdate.updateBy,
      carryForward: null,
    };
  }

  /*
   * A user moved to another place: where it is now is read here, and the
   * users it passes step aside once the update has moved it - only the rows
   * strictly between its old and new place (ContiguousOrder.afterMove).
   * Nothing is written before the update.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    let move: LayerUserMove | null = null;

    // The one row an update names by its id is the one it moves.
    const movedId: ObjectID | null = Service.getOneRowIdNamedBy(updateBy.query);

    if (updateBy.data.order && !updateBy.props.isRoot && movedId) {
      const resource: Model | null = await this.findOneBy({
        query: {
          _id: movedId,
        },
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          onCallDutyPolicyScheduleLayerId: true,
          projectId: true,
          _id: true,
        },
      });

      if (
        resource &&
        resource.id &&
        resource.order &&
        resource.onCallDutyPolicyScheduleLayerId &&
        resource.projectId
      ) {
        move = {
          layerUserId: resource.id,
          previousOrder: resource.order,
          newOrder: updateBy.data.order as number,
          onCallDutyPolicyScheduleLayerId:
            resource.onCallDutyPolicyScheduleLayerId,
          projectId: resource.projectId,
        };
      }
    }

    return { updateBy, carryForward: move };
  }
}

export default new Service();
