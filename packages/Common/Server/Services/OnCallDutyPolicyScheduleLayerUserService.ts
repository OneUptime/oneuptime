import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import QueryHelper from "../Types/Database/QueryHelper";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
import { OnCallShiftChangeReason } from "../Utils/OnCall/OnCallShiftChangeListeners";
import logger from "../Utils/Logger";
import ContiguousOrder, {
  ContiguousOrderMoved,
} from "../Utils/Database/ContiguousOrder";
import ScheduleLayerChanges from "../Utils/OnCall/ScheduleLayerChanges";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { MoveInListResult } from "../../Types/Database/MoveInList";

/*
 * The columns that name the list a layer user is numbered in: its layer, in
 * its project. The number is the person's turn in the layer.
 */
const ORDER_LIST_COLUMNS: Array<string> = [
  "onCallDutyPolicyScheduleLayerId",
  "projectId",
];

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
    userIds: Array<ObjectID | null | undefined>,
  ): Promise<void> {
    if (!scheduleId) {
      return;
    }

    await OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
      scheduleIds: [scheduleId],
      projectId: projectId || null,
      userIds: userIds.filter(
        (userId: ObjectID | null | undefined): userId is ObjectID => {
          return Boolean(userId);
        },
      ),
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

  /*
   * After a layer user's row is written: who is on call is worked out and
   * told now, or - for a write made through the API - once the schedule's
   * layers have been quiet for a while, for the whole change at once
   * (ScheduleLayerChanges, #7813).
   */
  private async tellLayerUserChange(data: {
    scheduleId: ObjectID;
    projectId: ObjectID | null | undefined;
    userIds: Array<ObjectID | null | undefined>;
    props: DatabaseCommonInteractionProps | null | undefined;
  }): Promise<void> {
    await ScheduleLayerChanges.afterLayersWritten({
      scheduleId: data.scheduleId,
      props: data.props,
      tellNow: async (): Promise<void> => {
        await this.refreshScheduleRosterBestEffort(data.scheduleId);

        await this.propagateLayerUserChange(
          data.scheduleId,
          data.projectId,
          data.userIds,
        );
      },
    });
  }

  /**
   * Renumber the users of a layer 1..n by their current order (twins by
   * id, as they are read). Used by the team-member cleanup, which deletes
   * layer-user rows as root, to leave the layers it took people out of
   * numbered without gaps. Idempotent.
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

    /*
     * A person added at a number keeps it, and moves nobody else
     * (ContiguousOrder): one added without a number takes the last turn of
     * the layer.
     */
    if (!createBy.data.order) {
      const projectId: ObjectID | undefined =
        createBy.props.tenantId || createBy.data.projectId;

      createBy.data.order = await ContiguousOrder.getAppendOrder({
        service: this,
        list: {
          onCallDutyPolicyScheduleLayerId:
            createBy.data.onCallDutyPolicyScheduleLayerId,
          ...(projectId ? { projectId: projectId } : {}),
        },
      });
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  /*
   * Only for a layer user the delete actually removed: the roster is
   * refreshed. The users after it keep their numbers (ContiguousOrder): the
   * rotation goes by turn order, gap or none.
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

    if (
      !deleteBy.props.isRoot &&
      resource &&
      wasDeleted &&
      resource.onCallDutyPolicyScheduleId
    ) {
      await this.tellLayerUserChange({
        scheduleId: resource.onCallDutyPolicyScheduleId,
        projectId: resource.projectId,
        userIds: [resource.userId],
        props: deleteBy.props,
      });
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
      /*
       * The one layer user the delete removes, and the delete held to
       * it: the roster is refreshed once it is gone.
       */
      const found: { row: Model | null; deletesMore: boolean } =
        await this.findOneRowAndHoldDeleteToIt(deleteBy, {
          onCallDutyPolicyScheduleId: true,
          projectId: true,
          userId: true,
        });

      if (found.deletesMore) {
        throw new BadDataException(
          "Remove one person from a schedule layer at a time.",
        );
      }

      resource = found.row;
    }

    return {
      deleteBy,
      carryForward: resource,
    };
  }

  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
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

    await this.tellLayerUserChange({
      scheduleId: resource.onCallDutyPolicyScheduleId,
      projectId: resource.projectId,
      userIds: [resource.userId],
      props: onCreate?.createBy?.props,
    });

    return createdItem;
  }

  /*
   * A person given another turn takes it, and nobody else moves
   * (ContiguousOrder): Terraform numbers a layer's people one write each,
   * all at once. Moving a person past others is moveInList.
   */
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
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

      await this.tellLayerUserChange({
        scheduleId: resource.onCallDutyPolicyScheduleId,
        projectId: resource.projectId,
        userIds: [resource.userId],
        props: onUpdate?.updateBy?.props,
      });
    }

    return {
      updateBy: onUpdate.updateBy,
      carryForward: null,
    };
  }

  /*
   * Moves a person to the turn another person of the layer has (POST
   * /on-call-duty-policy-schedule-layer-user/:id/move,
   * Types/Database/MoveInList): the people between them step one turn
   * towards where they were, in one transaction holding the layer's people,
   * and who is on call is worked out again - each person whose turn changed
   * hears of it. The Layers page saves a new turn order with the rest of its
   * changes (save-layers); a write of `order` places the person alone.
   */
  @CaptureSpan()
  public override async moveInList(data: {
    id: ObjectID;
    placeOfId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<MoveInListResult> {
    const moved: ContiguousOrderMoved<Model> = await ContiguousOrder.move({
      service: this,
      rowId: data.id,
      placeOfId: data.placeOfId,
      listColumns: ORDER_LIST_COLUMNS,
      alsoSelect: ["onCallDutyPolicyScheduleId"],
      props: data.props,
    });

    const scheduleId: ObjectID | undefined =
      moved.row.onCallDutyPolicyScheduleId;

    if (moved.changedRows.length > 0 && scheduleId) {
      const people: Array<Model> = await this.findBy({
        query: {
          _id: QueryHelper.any(
            moved.changedRows.map((row: { id: string }): ObjectID => {
              return new ObjectID(row.id);
            }),
          ),
        },
        select: {
          _id: true,
          userId: true,
        },
        limit: moved.changedRows.length,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      await this.tellLayerUserChange({
        scheduleId: scheduleId,
        projectId: moved.row.projectId,
        userIds: people.map((person: Model): ObjectID | undefined => {
          return person.userId;
        }),
        props: data.props,
      });
    }

    return { changedRows: moved.changedRows };
  }
}

export default new Service();
