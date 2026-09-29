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
import PositiveNumber from "../../Types/PositiveNumber";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
import { OnCallShiftChangeReason } from "../Utils/OnCall/OnCallShiftChangeListeners";
import logger from "../Utils/Logger";

export class Service extends DatabaseService<Model> {
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
    if (!createBy.data.onCallDutyPolicyScheduleLayerId) {
      throw new BadDataException("onCallDutyPolicyScheduleLayerId is required");
    }

    const userId: ObjectID | undefined | null =
      createBy.data.userId || createBy.data.user?.id;

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

    await this.rearrangeOrder(
      createBy.data.order,
      createBy.data.onCallDutyPolicyScheduleLayerId!,
      true,
    );

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
    const resource: Model | null = onDelete.carryForward;

    if (!deleteBy.props.isRoot && resource) {
      if (
        resource &&
        resource.order &&
        resource.onCallDutyPolicyScheduleLayerId
      ) {
        await this.rearrangeOrder(
          resource.order,
          resource.onCallDutyPolicyScheduleLayerId,
          false,
        );

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
        projectId: true,
        userId: true,
      },
      props: {
        isRoot: true,
      },
    });

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
    _onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
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
      updateBy: _onUpdate.updateBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.data.order && !updateBy.props.isRoot && updateBy.query._id) {
      const resource: Model | null = await this.findOneBy({
        query: {
          _id: updateBy.query._id!,
        },
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          onCallDutyPolicyScheduleLayerId: true,
          _id: true,
        },
      });

      const currentOrder: number = resource?.order as number;
      const newOrder: number = updateBy.data.order as number;

      const resources: Array<Model> = await this.findBy({
        query: {
          onCallDutyPolicyScheduleLayerId:
            resource?.onCallDutyPolicyScheduleLayerId as ObjectID,
        },

        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          onCallDutyPolicyScheduleLayerId: true,
          _id: true,
        },
      });

      if (currentOrder > newOrder) {
        // moving up.

        for (const resource of resources) {
          if (resource.order! >= newOrder && resource.order! < currentOrder) {
            // increment order.
            await this.updateOneBy({
              query: {
                _id: resource._id!,
              },
              data: {
                order: resource.order! + 1,
              },
              props: {
                isRoot: true,
              },
            });
          }
        }
      }

      if (newOrder > currentOrder) {
        // moving down.

        for (const resource of resources) {
          /*
           * Only shift rows strictly BETWEEN the old and new position. The lower
           * bound (order > currentOrder) was missing, so every row above the
           * moved user was also decremented — driving the top row's order to 0
           * (and negative after repeated down-drags) and opening a gap at 1,
           * breaking the 1-based contiguous invariant that create-default
           * (count+1) and delete re-sequencing rely on (audit L3). Mirrors the
           * double-bounded moving-up branch above.
           */
          if (resource.order! <= newOrder && resource.order! > currentOrder) {
            // decrement order.
            await this.updateOneBy({
              query: {
                _id: resource._id!,
              },
              data: {
                order: resource.order! - 1,
              },
              props: {
                isRoot: true,
              },
            });
          }
        }
      }
    }

    return { updateBy, carryForward: null };
  }

  private async rearrangeOrder(
    currentOrder: number,
    onCallDutyPolicyScheduleLayerId: ObjectID,
    increaseOrder: boolean = true,
  ): Promise<void> {
    // get status page resource with this order.
    const resources: Array<Model> = await this.findBy({
      query: {
        order: QueryHelper.greaterThanEqualTo(currentOrder),
        onCallDutyPolicyScheduleLayerId: onCallDutyPolicyScheduleLayerId,
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

    for (const resource of resources) {
      if (increaseOrder) {
        newOrder = resource.order! + 1;
      } else {
        newOrder = resource.order! - 1;
      }

      await this.updateOneBy({
        query: {
          _id: resource._id!,
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
}

export default new Service();
