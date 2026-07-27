import DatabaseService from "./DatabaseService";
import AIRemediationAction from "../../Models/DatabaseModels/AIRemediationAction";
import AIRemediationActionStatus from "../../Types/AI/AIRemediationActionStatus";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<AIRemediationAction> {
  public constructor() {
    super(AIRemediationAction);
  }

  /*
   * The single write primitive for the action lifecycle: one conditional
   * UPDATE guarded on the expected current status, exactly the
   * AIRunService.attemptStatusTransition idiom. Returns the number of rows
   * moved (0 or 1) — 0 means another actor won the transition (a concurrent
   * approve, the expiry sweeper, ...) and the caller must do NOTHING with
   * the action, because the winner already owns its side effects. Every
   * transition in the executor, the API, and the sweeper routes through
   * this so double-execution is structurally impossible.
   */
  @CaptureSpan()
  public async attemptStatusTransition(data: {
    actionId: ObjectID;
    fromStatus: AIRemediationActionStatus;
    set: {
      status: AIRemediationActionStatus;
      approvedByUserId?: ObjectID;
      approvedAt?: Date;
      rejectedByUserId?: ObjectID;
      rejectedAt?: Date;
      rejectionReason?: string;
      executedAt?: Date;
      runbookId?: ObjectID;
      runbookExecutionId?: ObjectID;
      errorMessage?: string;
    };
  }): Promise<number> {
    const updatedCount: number = await this.updateBy({
      query: {
        _id: data.actionId.toString(),
        status: data.fromStatus,
      },
      data: data.set as never,
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    return updatedCount;
  }
}

export default new Service();
