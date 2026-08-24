import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/LlmLog";
import { IsBillingEnabled } from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
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

    const rows: Array<{ total: string | number | null }> =
      await this.getRepository().manager.query(
        `SELECT COALESCE(SUM("log"."totalTokens"), 0) AS "total" FROM "LlmLog" AS "log" WHERE "log"."projectId" = $1 AND "log"."createdAt" >= $2 AND "log"."feature" = ANY($3) ${subjectClause} AND "log"."deletedAt" IS NULL`,
        params,
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
