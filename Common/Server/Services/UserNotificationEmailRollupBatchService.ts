import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { ROLLUP_BATCH_RETENTION_DAYS } from "../Utils/EmailRollup/EmailRollupConstants";
import Model from "../../Models/DatabaseModels/UserNotificationEmailRollupBatch";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";

/*
 * The rollup claim ledger. Root only in every direction: an insert here is
 * what wins an epoch, so a caller who could create one could stop the next
 * rollup being sent, and one who could delete one could make it be sent
 * twice.
 *
 * Retention is set UNCONDITIONALLY, deliberately unlike EmailLogService,
 * which only registers its retention when billing is enabled. The
 * HardDelete:HardDeleteOlderItemsInDatabase cron iterates every service in
 * the Services array with no billing check, so a gated call would simply
 * never prune on a self-hosted install.
 *
 * Thirty days rather than the items' seven: a batch row is the record of how
 * many notifications one email replaced, which is the number the whole
 * feature is judged on, and it is one row per flush rather than one per
 * notification. Pruning it cannot orphan anything, because rollupBatchId on
 * the item table is deliberately a bare column with no foreign key.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays(
      "createdAt",
      ROLLUP_BATCH_RETENTION_DAYS,
    );
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.isRoot) {
      throw new NotAuthorizedException(
        "Notification email rollup batches are claimed by the flush worker only.",
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
        "Notification email rollup batches are claimed by the flush worker only.",
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
        "Notification email rollup batches are claimed by the flush worker only.",
      );
    }

    return { deleteBy, carryForward: null };
  }
}

export default new Service();
