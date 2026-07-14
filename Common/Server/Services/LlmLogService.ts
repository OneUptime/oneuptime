import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/LlmLog";
import { IsBillingEnabled } from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3);
    }
  }

  /*
   * Sum of totalTokens this project has consumed for the given features since
   * the given time — one SQL aggregate, used on the hot path of the daily
   * autonomous-budget check (G4).
   */
  @CaptureSpan()
  public async getTotalTokensUsedSince(data: {
    projectId: ObjectID;
    since: Date;
    features: Array<string>;
  }): Promise<number> {
    if (data.features.length === 0) {
      return 0;
    }

    const rows: Array<{ total: string | number | null }> =
      await this.getRepository().manager.query(
        `SELECT COALESCE(SUM("totalTokens"), 0) AS "total" FROM "LlmLog" WHERE "projectId" = $1 AND "createdAt" >= $2 AND "feature" = ANY($3) AND "deletedAt" IS NULL`,
        [data.projectId.toString(), data.since, data.features],
      );

    return Number(rows[0]?.total || 0);
  }

  /*
   * Per-run LLM usage for the server-mediated code-fix agent loop budgets
   * (B4 Tier 0): how many completion calls a run has made and how many
   * output tokens they produced. One SQL aggregate over the run's LlmLog
   * rows — executeWithLogging writes exactly one row per call (success,
   * error, or budget rejection), so the count is the honest call count and
   * errored calls conservatively consume a slot. Runs are bounded to ~30
   * minutes, far inside the 3-day cloud LlmLog retention.
   */
  @CaptureSpan()
  public async getRunCompletionUsage(data: {
    aiRunId: ObjectID;
  }): Promise<{ completionCalls: number; outputTokens: number }> {
    const rows: Array<{
      calls: string | number | null;
      outputTokens: string | number | null;
    }> = await this.getRepository().manager.query(
      `SELECT COUNT(*) AS "calls", COALESCE(SUM("completionTokens"), 0) AS "outputTokens" FROM "LlmLog" WHERE "aiRunId" = $1 AND "deletedAt" IS NULL`,
      [data.aiRunId.toString()],
    );

    return {
      completionCalls: Number(rows[0]?.calls || 0),
      outputTokens: Number(rows[0]?.outputTokens || 0),
    };
  }
}

export default new Service();
