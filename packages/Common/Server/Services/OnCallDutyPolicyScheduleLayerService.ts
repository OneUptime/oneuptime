import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Recurring from "../../Types/Events/Recurring";
import RestrictionTimes, {
  LEGACY_RESTRICTION_TYPE_KEY,
  RESTRICTION_TYPE_KEY,
  RestrictionType,
} from "../../Types/OnCallDutyPolicy/RestrictionTimes";
import { getDefaultLayerRotation } from "../../Types/OnCallDutyPolicy/ScheduleLayerDefaults";
import { JSONObject } from "../../Types/JSON";
import UpdateBy from "../Types/Database/UpdateBy";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
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
 * The columns that name the list a layer is numbered in: its schedule, in
 * its project. The lower the number, the higher the layer's priority.
 */
const ORDER_LIST_COLUMNS: Array<string> = [
  "onCallDutyPolicyScheduleId",
  "projectId",
];

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A layer edit changes who is on call and when for the whole schedule:
   * bump its shiftConfigVersion, drop the calendar-feed caches and let the
   * shift-change listeners re-plan. Runs AFTER the roster refresh so a
   * listener that re-materializes sees the new configuration. Best-effort by
   * construction (propagateShiftConfigChange never throws).
   */
  private async propagateLayerChange(
    scheduleId: ObjectID | null | undefined,
    projectId: ObjectID | null | undefined,
  ): Promise<void> {
    if (!scheduleId) {
      return;
    }

    await OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
      scheduleIds: [scheduleId],
      projectId: projectId || null,
      reason: OnCallShiftChangeReason.LayerChanged,
    });
  }

  /**
   * Re-resolve and persist the schedule's roster after a layer change.
   * Best-effort: the row is already committed when the success hooks run, so
   * a throwing refresh (a concurrently-deleted schedule, a transient
   * persistence or notification failure) must not abort the hook before
   * propagateLayerChange bumps the shiftConfigVersion and purges the feed
   * caches — otherwise the caches would keep serving the pre-edit roster for
   * up to their TTL and the reminder change pass would be skipped. Mirrors
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
        "Error refreshing the schedule roster after a layer change (best-effort).",
      );
      logger.error(err);
    }
  }

  /*
   * After a layer's row is written: who is on call is worked out and told
   * now, or - for a write made through the API - once the schedule's
   * layers have been quiet for a while, for the whole change at once
   * (ScheduleLayerChanges, #7813).
   */
  private async tellLayerChange(data: {
    scheduleId: ObjectID;
    projectId: ObjectID | null | undefined;
    props: DatabaseCommonInteractionProps | null | undefined;
  }): Promise<void> {
    await ScheduleLayerChanges.afterLayersWritten({
      scheduleId: data.scheduleId,
      props: data.props,
      tellNow: async (): Promise<void> => {
        await this.refreshScheduleRosterBestEffort(data.scheduleId);

        await this.propagateLayerChange(data.scheduleId, data.projectId);
      },
    });
  }

  /*
   * A LAYER IS NEVER STORED IN A STATE THAT SILENTLY PAGES NOBODY (#11269).
   *
   * Its rotation and restriction times are read the way a write must say
   * them (Recurring.fromWrittenJSON, RestrictionTimes.fromWrittenJSON), and
   * refused with a 400 naming the key when they say nothing the engine can
   * page by: a restriction type spelled any way but restrictionType or its
   * older restictionType, or missing; a Daily window with no times, or times
   * that are a time of day alone; a rotation interval such as "Weekly", or a
   * count under another key. Each is then stored as it was read - the
   * restriction type under its name alone - so what a write meant is what is
   * kept, whichever spelling it came in.
   *
   * A value the write leaves out is not checked: an update that changes
   * neither keeps what is stored.
   */
  private readWrittenRotation(rotation: unknown): Recurring {
    return Recurring.fromWrittenJSON(rotation);
  }

  private readWrittenRestrictionTimes(
    restrictionTimes: unknown,
    currentType?: RestrictionType | null | undefined,
  ): RestrictionTimes {
    return RestrictionTimes.fromWrittenJSON(restrictionTimes, {
      currentType: currentType,
    });
  }

  /*
   * A client that read a layer gets its type under both spellings, alike,
   * and one that changes the spelling it knows and writes the value back
   * sends two that disagree. Which one changed is read from the layers the
   * update is for: only then, so no other update reads anything more. More
   * than one type among them, and the write is refused as it stands.
   */
  private async readCurrentRestrictionType(
    updateBy: UpdateBy<Model>,
  ): Promise<RestrictionType | null> {
    const written: unknown = updateBy.data.restrictionTimes;

    if (
      !written ||
      typeof written !== "object" ||
      written instanceof RestrictionTimes
    ) {
      return null;
    }

    const value: unknown = (written as JSONObject)["value"];

    if (!value || typeof value !== "object") {
      return null;
    }

    const named: unknown = (value as JSONObject)[RESTRICTION_TYPE_KEY];
    const spelledBefore: unknown = (value as JSONObject)[
      LEGACY_RESTRICTION_TYPE_KEY
    ];

    if (
      named === undefined ||
      named === null ||
      spelledBefore === undefined ||
      spelledBefore === null ||
      named === spelledBefore
    ) {
      return null;
    }

    const layers: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        restrictionTimes: true,
      },
      skip: 0,
      limit: 2,
      props: {
        isRoot: true,
      },
    });

    const types: Set<RestrictionType> = new Set<RestrictionType>(
      layers.map((layer: Model): RestrictionType => {
        return layer.restrictionTimes?.restrictionType || RestrictionType.None;
      }),
    );

    return types.size === 1 ? Array.from(types)[0]! : null;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (!createBy.data.onCallDutyPolicyScheduleId) {
      throw new BadDataException("onCallDutyPolicyScheduleId is required");
    }

    /*
     * The dashboard always sends a rotation and restriction times
     * (buildNewScheduleLayer). An API client need not: the Terraform
     * provider has both optional, as the API's schema does, and a layer
     * written without them failed with "rotation is required" or
     * "restrictionTimes is required". Left out, or null, they take what
     * every new layer starts with: a weekly hand-off, on call around the
     * clock.
     */
    if (!createBy.data.rotation) {
      createBy.data.rotation = getDefaultLayerRotation();
    }

    if (!createBy.data.restrictionTimes) {
      createBy.data.restrictionTimes = RestrictionTimes.getDefault();
    }

    createBy.data.rotation = this.readWrittenRotation(createBy.data.rotation);
    createBy.data.restrictionTimes = this.readWrittenRestrictionTimes(
      createBy.data.restrictionTimes,
    );

    /*
     * A layer created at a number keeps it, and moves no other layer
     * (ContiguousOrder): one created without a number goes below the
     * schedule's last layer.
     */
    if (!createBy.data.order) {
      const projectId: ObjectID | undefined =
        createBy.props.tenantId || createBy.data.projectId;

      createBy.data.order = await ContiguousOrder.getAppendOrder({
        service: this,
        list: {
          onCallDutyPolicyScheduleId: createBy.data.onCallDutyPolicyScheduleId,
          ...(projectId ? { projectId: projectId } : {}),
        },
      });
    }

    return {
      createBy,
      carryForward: null,
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
      },
      props: {
        isRoot: true,
      },
    });

    if (!resource || !resource.onCallDutyPolicyScheduleId) {
      return createdItem;
    }

    await this.tellLayerChange({
      scheduleId: resource.onCallDutyPolicyScheduleId,
      projectId: resource.projectId,
      props: onCreate?.createBy?.props,
    });

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    if (
      updateBy.data.rotation !== undefined &&
      updateBy.data.rotation !== null
    ) {
      updateBy.data.rotation = this.readWrittenRotation(updateBy.data.rotation);
    }

    if (
      updateBy.data.restrictionTimes !== undefined &&
      updateBy.data.restrictionTimes !== null
    ) {
      updateBy.data.restrictionTimes = this.readWrittenRestrictionTimes(
        updateBy.data.restrictionTimes,
        await this.readCurrentRestrictionType(updateBy),
      );
    }

    return {
      updateBy,
      carryForward: null,
    };
  }

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
        },
        props: {
          isRoot: true,
        },
      });

      if (!resource || !resource.onCallDutyPolicyScheduleId) {
        continue;
      }

      await this.tellLayerChange({
        scheduleId: resource.onCallDutyPolicyScheduleId,
        projectId: resource.projectId,
        props: onUpdate?.updateBy?.props,
      });
    }

    return {
      updateBy: onUpdate.updateBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * Capture the layer's schedule id as carryForward so onDeleteSuccess can
     * refresh the schedule roster after a layer is removed. Without this
     * hook, onDeleteSuccess (which gates all of its work on
     * onDelete.carryForward) was dead code: deleting a layer never called
     * refreshCurrentUserIdAndHandoffTimeInSchedule, so the schedule kept
     * showing the removed layer's user as on-call and the genuinely-now-on-call
     * user got no handoff notification for up to a full rotation period
     * (audit F3). Mirrors OnCallDutyPolicyScheduleLayerUserService.onBeforeDelete.
     */
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting a schedule layer. Please try the delete with objectId",
      );
    }

    let resource: Model | null = null;

    if (!deleteBy.props.isRoot) {
      /*
       * The one layer the delete removes, and the delete held to it. The
       * layers after it keep their numbers (ContiguousOrder): a gap is read
       * past like any other.
       */
      const found: { row: Model | null; deletesMore: boolean } =
        await this.findOneRowAndHoldDeleteToIt(deleteBy, {
          onCallDutyPolicyScheduleId: true,
          projectId: true,
        });

      if (found.deletesMore) {
        throw new BadDataException("Delete one schedule layer at a time.");
      }

      resource = found.row;
    }

    return {
      deleteBy,
      carryForward: resource,
    };
  }

  /*
   * Only for a layer the delete actually removed: the roster is refreshed.
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
      await this.tellLayerChange({
        scheduleId: resource.onCallDutyPolicyScheduleId,
        projectId: resource.projectId,
        props: deleteBy.props,
      });
    }

    return {
      deleteBy: deleteBy,
      carryForward: null,
    };
  }

  /*
   * Moves a layer to the place another layer of its schedule holds (POST
   * /on-call-duty-policy-schedule-layer/:id/move, Types/Database/MoveInList):
   * the layers between them step one place towards where it was, in one
   * transaction holding the schedule's layers, and who is on call is worked
   * out again. The Layers page saves a new priority order with the rest of
   * its changes (save-layers); a write of `order` places the layer alone.
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
      props: data.props,
    });

    const scheduleId: ObjectID | undefined =
      moved.row.onCallDutyPolicyScheduleId;

    if (moved.changedRows.length > 0 && scheduleId) {
      await this.tellLayerChange({
        scheduleId: scheduleId,
        projectId: moved.row.projectId,
        props: data.props,
      });
    }

    return { changedRows: moved.changedRows };
  }
}

export default new Service();
