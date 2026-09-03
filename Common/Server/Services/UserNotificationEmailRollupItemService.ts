import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { ROLLUP_ITEM_RETENTION_DAYS } from "../Utils/EmailRollup/EmailRollupConstants";
import Model from "../../Models/DatabaseModels/UserNotificationEmailRollupItem";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";

/*
 * The owner-email rollup queue and volume ledger. Root only in every
 * direction: a pending row is the thing that makes a deferred notification
 * eventually arrive, so nothing outside the notification write path and the
 * flush sweep may insert, edit or remove one.
 *
 * Retention is set UNCONDITIONALLY, deliberately unlike EmailLogService,
 * which only registers its retention when billing is enabled. The
 * HardDelete:HardDeleteOlderItemsInDatabase cron iterates every service in
 * the Services array and honours whatever retention it declares, with no
 * billing check anywhere in the loop - so gating the call on IsBillingEnabled
 * would leave a self-hosted install accumulating one row per owner email
 * forever, which for the exact customer this feature exists for is thousands
 * of rows a day.
 *
 * Seven days is chosen against the two things that read the table: the burst
 * counter, which looks back BURST_WINDOW_MINUTES, and a human answering "what
 * flooded this inbox last week".
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays(
      "createdAt",
      ROLLUP_ITEM_RETENTION_DAYS,
    );
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.isRoot) {
      throw new NotAuthorizedException(
        "Notification email rollup items are written by the notification pipeline only.",
      );
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (!updateBy.props.isRoot) {
      throw new NotAuthorizedException(
        "Notification email rollup items are written by the notification pipeline only.",
      );
    }

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.props.isRoot) {
      throw new NotAuthorizedException(
        "Notification email rollup items are written by the notification pipeline only.",
      );
    }

    return { deleteBy, carryForward: null };
  }
}

export default new Service();
