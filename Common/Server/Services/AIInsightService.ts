import DatabaseService from "./DatabaseService";
import AIRunService from "./AIRunService";
import AIRunEventService from "./AIRunEventService";
import AIInsight from "../../Models/DatabaseModels/AIInsight";
import AIRun from "../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../Models/DatabaseModels/AIRunEvent";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../Types/Exception/BadDataException";
import AIInsightStatus from "../../Types/AI/AIInsightStatus";
import AIInsightHumanVerdict from "../../Types/AI/AIInsightHumanVerdict";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Upper bound on triage-run events returned for one insight — mirrors the
 * investigation panel's cap (AIInvestigationAPI MAX_EVENTS). The engine's
 * per-run step budgets keep real trails far below this; the cap only
 * bounds pathological rows.
 */
export const MAX_TRIAGE_RUN_EVENTS: number = 500;

export class Service extends DatabaseService<AIInsight> {
  public constructor() {
    super(AIInsight);
  }

  /*
   * Human verdict capture — this IS the G11 precision measurement:
   * confirm/dismiss rates per insight type tell us how precise each
   * deterministic detector is in the field and gate any future automation.
   *
   * Overwriting an existing verdict is deliberate — people change their
   * minds; the latest verdict wins (per-insight state, not an audit trail).
   * Dismissed is a human terminal state, so it also closes the insight;
   * Confirmed leaves the status untouched (the insight stays open until a
   * human resolves it or a fix lands).
   *
   * Callers must have already access-checked the insight under the USER's
   * permissions — insight rows are server-authored (empty update ACL), so
   * this writes as root.
   */
  @CaptureSpan()
  public async applyHumanVerdict(data: {
    insightId: ObjectID;
    verdict: AIInsightHumanVerdict;
    byUserId: ObjectID;
  }): Promise<{ insightId: ObjectID; verdict: AIInsightHumanVerdict }> {
    await this.updateOneById({
      id: data.insightId,
      data: {
        humanVerdict: data.verdict,
        humanVerdictAt: OneUptimeDate.getCurrentDate(),
        humanVerdictByUserId: data.byUserId,
        ...(data.verdict === AIInsightHumanVerdict.Dismissed
          ? { status: AIInsightStatus.Dismissed }
          : {}),
      },
      props: { isRoot: true },
    });

    return { insightId: data.insightId, verdict: data.verdict };
  }

  /*
   * Marks the insight handled. Resolving implies the finding was real, so
   * when no verdict was recorded yet this also stamps Confirmed (+ at/by) —
   * the G11 measurement should count a silently-fixed insight as a true
   * positive. An existing verdict (either value) is left untouched:
   * resolve is a lifecycle action, not a verdict change.
   *
   * Callers must have already access-checked the insight under the USER's
   * permissions — this reads and writes as root.
   */
  @CaptureSpan()
  public async resolveInsight(data: {
    insightId: ObjectID;
    byUserId: ObjectID;
  }): Promise<{ insightId: ObjectID; status: AIInsightStatus }> {
    const insight: AIInsight | null = await this.findOneById({
      id: data.insightId,
      select: { _id: true, humanVerdict: true },
      props: { isRoot: true },
    });

    if (!insight || !insight.id) {
      throw new BadDataException("AI insight not found.");
    }

    await this.updateOneById({
      id: insight.id,
      data: {
        status: AIInsightStatus.Resolved,
        ...(insight.humanVerdict
          ? {}
          : {
              humanVerdict: AIInsightHumanVerdict.Confirmed,
              humanVerdictAt: OneUptimeDate.getCurrentDate(),
              humanVerdictByUserId: data.byUserId,
            }),
      },
      props: { isRoot: true },
    });

    return { insightId: insight.id, status: AIInsightStatus.Resolved };
  }

  /*
   * Data for the dashboard's live triage panel: the insight's triage AIRun
   * plus its ordered event trail. Triage runs are system-authored
   * (userId = null) and therefore hidden by the per-user privacy pin on the
   * generic AIRun / AIRunEvent CRUD — so, mirroring AIInvestigationAPI's
   * sendLatestInvestigation, the run and events are read as root AFTER the
   * caller has access-checked the insight under the USER's permissions.
   *
   * A missing insight (raced deletion) or an insight without a triage run
   * (no LLM provider / no budget headroom at scan time) returns the empty
   * shape — the panel renders an empty state, not an error.
   */
  @CaptureSpan()
  public async getLatestTriageRunWithEvents(data: {
    insightId: ObjectID;
  }): Promise<{ run: AIRun | null; events: Array<AIRunEvent> }> {
    const insight: AIInsight | null = await this.findOneById({
      id: data.insightId,
      select: { _id: true, triageAiRunId: true },
      props: { isRoot: true },
    });

    if (!insight || !insight.triageAiRunId) {
      return { run: null, events: [] };
    }

    const run: AIRun | null = await AIRunService.findOneById({
      id: insight.triageAiRunId,
      select: {
        _id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
        llmCallCount: true,
        toolCallCount: true,
        totalTokens: true,
        createdAt: true,
      },
      props: { isRoot: true },
    });

    if (!run || !run.id) {
      return { run: null, events: [] };
    }

    const events: Array<AIRunEvent> = await AIRunEventService.findBy({
      query: { aiRunId: run.id },
      select: {
        _id: true,
        sequence: true,
        eventType: true,
        toolName: true,
        resultSummary: true,
        createdAt: true,
      },
      sort: { sequence: SortOrder.Ascending },
      limit: MAX_TRIAGE_RUN_EVENTS,
      skip: 0,
      props: { isRoot: true },
    });

    return { run, events };
  }
}

export default new Service();
