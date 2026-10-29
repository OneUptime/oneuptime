import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/LlmLog";
import { IsBillingEnabled } from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import AiTokenCount from "../../Types/AI/AiTokenCount";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * The cached part of the tokens a usage aggregate adds up: read from and
 * written to the provider's prompt cache. AiTokenCount weighs the sums, so a
 * limit counts AI work by what it cost, as the AI Logs show each call. Both
 * columns are NOT NULL DEFAULT 0, so a row written before they existed counts
 * every one of its tokens as a fresh one, as it always did.
 */
const CACHE_TOKEN_SUMS: string =
  'COALESCE(SUM("log"."cachedInputTokens"), 0) AS "cacheRead", COALESCE(SUM("log"."cacheCreationTokens"), 0) AS "cacheWrite"';

/*
 * What a cached token counts as depends on the model the call asked for
 * (AiTokenCount.getCacheWeights), so a usage aggregate sums each model's
 * calls apart: one row per model, the model beside its sums.
 */
const MODEL_OF_THE_SUMS: string = '"log"."modelName" AS "modelName"';
const GROUP_BY_MODEL: string = 'GROUP BY "log"."modelName"';

// What a usage aggregate hands back for a day's tokens: SQL sums, as strings.
type SummedTokens = string | number | null | undefined;

interface SummedTokensOfAModel {
  modelName?: string | null | undefined;
  total: SummedTokens;
  cacheRead?: SummedTokens;
  cacheWrite?: SummedTokens;
}

/*
 * A day's tokens as OneUptime counts them, from the summed tokens and the
 * summed cache columns (CACHE_TOKEN_SUMS) of each model: every model's day
 * is counted at its own weights, and the counts added up. A model's day is
 * counted as one: its weighted parts are rounded up once, where the AI Logs
 * round each call's, so the day can count a token or so per call less than
 * its rows add up to.
 */
function countSummedTokens(rows: Array<SummedTokensOfAModel>): number {
  return rows.reduce((total: number, row: SummedTokensOfAModel): number => {
    return (
      total +
      AiTokenCount.count({
        totalTokens: AiTokenCount.toTokenCount(row.total),
        cachedInputTokens: AiTokenCount.toTokenCount(row.cacheRead),
        cacheCreationTokens: AiTokenCount.toTokenCount(row.cacheWrite),
        modelName: row.modelName,
      })
    );
  }, 0);
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3);
    }
  }

  /*
   * The tokens this project has used for the given features since the given
   * time, as OneUptime counts them (AiTokenCount: a token read from the
   * provider's prompt cache counts at what the model charges for it, a tenth
   * on most current models) — one SQL aggregate, used on the hot path of the
   * daily autonomous-budget check (G4).
   */
  @CaptureSpan()
  public async getTotalTokensUsedSince(data: {
    projectId: ObjectID;
    since: Date;
    features: Array<string>;
    /*
     * Subject ids select a lane, not one particular subject: passing an
     * incident id counts every incident-associated log for the project, and
     * passing an alert id counts every alert-associated log. With neither id,
     * only genuinely subjectless work is counted. The caller already has the
     * concrete id, so using it as the discriminator keeps this API aligned
     * with AIService's request shape without introducing a second subject enum.
     */
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    /*
     * Feature-only fallbacks for rows written before subject identity was
     * propagated. Shared features are recovered through aiRunId below.
     */
    legacyIncidentFeatures?: Array<string> | undefined;
    legacyAlertFeatures?: Array<string> | undefined;
  }): Promise<number> {
    if (data.incidentId && data.alertId) {
      throw new BadDataException(
        "An LLM usage query cannot select both the incident and alert lanes.",
      );
    }

    if (data.features.length === 0) {
      return 0;
    }

    const legacyIncidentFeatures: Array<string> =
      data.legacyIncidentFeatures || [];
    const legacyAlertFeatures: Array<string> = data.legacyAlertFeatures || [];

    const incidentRunMembership: string = `EXISTS (SELECT 1 FROM "AIRun" AS "run" WHERE "run"."_id" = "log"."aiRunId" AND "run"."triggeredByIncidentId" IS NOT NULL AND "run"."triggeredByAlertId" IS NULL)`;
    const alertRunMembership: string = `EXISTS (SELECT 1 FROM "AIRun" AS "run" WHERE "run"."_id" = "log"."aiRunId" AND "run"."triggeredByIncidentId" IS NULL AND "run"."triggeredByAlertId" IS NOT NULL)`;

    /*
     * Placeholders and bindings are built together, per branch, because
     * PostgreSQL derives a prepared statement's parameter count from the
     * HIGHEST $n present in the text — not from what the driver sends. A
     * branch that binds an argument it never references is rejected outright
     * at Bind (bind message supplies 5 parameters, but prepared statement
     * requires 4), and a branch that skips a placeholder is rejected at Parse
     * (could not determine data type of parameter $4). Both are runtime-only
     * failures no compiler catches, so the parameter array is grown next to
     * the clause that reads it and never assembled apart from it.
     */
    const params: Array<unknown> = [
      data.projectId.toString(), // $1
      data.since, // $2
      data.features, // $3
    ];

    let subjectClause: string;

    if (data.incidentId) {
      params.push(legacyIncidentFeatures); // $4
      subjectClause = `AND (("log"."incidentId" IS NOT NULL AND "log"."alertId" IS NULL) OR ("log"."incidentId" IS NULL AND "log"."alertId" IS NULL AND (("log"."feature" = ANY($4)) OR ${incidentRunMembership})))`;
    } else if (data.alertId) {
      params.push(legacyAlertFeatures); // $4
      subjectClause = `AND (("log"."incidentId" IS NULL AND "log"."alertId" IS NOT NULL) OR ("log"."incidentId" IS NULL AND "log"."alertId" IS NULL AND (("log"."feature" = ANY($4)) OR ${alertRunMembership})))`;
    } else {
      params.push(legacyIncidentFeatures, legacyAlertFeatures); // $4, $5
      subjectClause = `AND "log"."incidentId" IS NULL AND "log"."alertId" IS NULL AND NOT ("log"."feature" = ANY($4)) AND NOT ("log"."feature" = ANY($5)) AND NOT (${incidentRunMembership}) AND NOT (${alertRunMembership})`;
    }

    const rows: Array<SummedTokensOfAModel> =
      await this.getRepository().manager.query(
        `SELECT ${MODEL_OF_THE_SUMS}, COALESCE(SUM("log"."totalTokens"), 0) AS "total", ${CACHE_TOKEN_SUMS} FROM "LlmLog" AS "log" WHERE "log"."projectId" = $1 AND "log"."createdAt" >= $2 AND "log"."feature" = ANY($3) ${subjectClause} AND "log"."deletedAt" IS NULL ${GROUP_BY_MODEL}`,
        params,
      );

    return countSummedTokens(rows || []);
  }

  /*
   * Everything this project's AI has used since the given time, whatever
   * it was doing: every token of every call (any feature, any provider,
   * Ask AI included), counted as OneUptime counts them (AiTokenCount: a
   * token read from or written to the provider's prompt cache counts at
   * what the call's model charges for it), and what was billed to the
   * project's AI credits. One SQL aggregate, read on the hot path of the
   * project's own daily limits (Project Settings → AI → AI Features) - only
   * when the project has set one.
   *
   * Spend is the cost of the calls that were billed (wasBilled): only a
   * call through the OneUptime-hosted provider, with billing on, is. A call
   * that was refused or failed wrote 0 tokens and no cost, so it counts for
   * nothing. Rows are never deleted by anyone but the retention sweep
   * (LlmLog has no delete permission), which keeps 3 days - more than the
   * one day this ever reads.
   */
  @CaptureSpan()
  public async getProjectUsageSince(data: {
    projectId: ObjectID;
    since: Date;
  }): Promise<{ totalTokens: number; billedCostInUSDCents: number }> {
    const rows: Array<{
      modelName?: string | null | undefined;
      totalTokens: SummedTokens;
      cacheRead?: SummedTokens;
      cacheWrite?: SummedTokens;
      billedCostInUSDCents: string | number | null;
    }> = await this.getRepository().manager.query(
      `SELECT ${MODEL_OF_THE_SUMS}, COALESCE(SUM("log"."totalTokens"), 0) AS "totalTokens", ${CACHE_TOKEN_SUMS}, COALESCE(SUM(CASE WHEN "log"."wasBilled" = true THEN "log"."costInUSDCents" ELSE 0 END), 0) AS "billedCostInUSDCents" FROM "LlmLog" AS "log" WHERE "log"."projectId" = $1 AND "log"."createdAt" >= $2 AND "log"."deletedAt" IS NULL ${GROUP_BY_MODEL}`,
      [data.projectId.toString(), data.since],
    );

    return {
      // The day's tokens as OneUptime counts them, not their raw sum.
      totalTokens: countSummedTokens(
        (rows || []).map(
          (row: {
            modelName?: string | null | undefined;
            totalTokens: SummedTokens;
            cacheRead?: SummedTokens;
            cacheWrite?: SummedTokens;
          }): SummedTokensOfAModel => {
            return {
              modelName: row.modelName,
              total: row.totalTokens,
              cacheRead: row.cacheRead,
              cacheWrite: row.cacheWrite,
            };
          },
        ),
      ),
      billedCostInUSDCents: (rows || []).reduce(
        (
          total: number,
          row: { billedCostInUSDCents: string | number | null },
        ): number => {
          const cents: number = Number(row.billedCostInUSDCents || 0);

          return total + (Number.isFinite(cents) ? cents : 0);
        },
        0,
      ),
    };
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
