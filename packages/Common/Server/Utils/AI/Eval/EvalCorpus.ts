import ObjectID from "../../../../Types/ObjectID";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunHumanVerdict from "../../../../Types/AI/AIRunHumanVerdict";
import AIRunAutoGrade from "../../../../Types/AI/AIRunAutoGrade";
import { AIRunEventResultSummary } from "../../../../Types/AI/AIChatTypes";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import { AlertFeedEventType } from "../../../../Models/DatabaseModels/AlertFeed";
import QueryHelper from "../../../Types/Database/QueryHelper";
import Query from "../../../Types/Database/Query";
import AIRunService from "../../../Services/AIRunService";
import AIRunEventService from "../../../Services/AIRunEventService";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import AlertFeedService from "../../../Services/AlertFeedService";
import AIConfidenceSignal from "../SRE/ConfidenceSignal";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI eval harness — golden-incident corpus (G3 bootstrap).
 *
 * A GoldenCase is one LABELED, completed AI investigation, exported as
 * plain JSON: the run's identity, its human/auto label (AIRun.humanVerdict /
 * AIRun.autoGrade — the Phase 2 measurement columns), deterministic per-run
 * evidence stats derived from the recorded AIRunEvent trail, and the trail
 * itself in skeletal form. Everything here is computable WITHOUT re-running
 * any LLM — that is the point of the bootstrap: recorded runs + labels make
 * the four G3 scores (EvalScores.ts) measurable today.
 *
 * WHAT THE TRAIL DOES AND DOES NOT CONTAIN (consequence for replay):
 * AIRunEvent stores the validated tool ARGUMENTS (`toolArguments`) and a
 * result SUMMARY (`resultSummary`: rowCount, durationInMs, isTruncated,
 * bytesSentToLlm, errorMessage) — never the tool's actual result rows. So the
 * corpus supports labeled-run SCORING (this file + EvalScores.ts) but not
 * offline REPLAY; see ReplayInvestigation.ts for exactly what full replay
 * would need.
 *
 * "Data-bearing" is defined ONCE, in
 * AIConfidenceSignal.isDataBearingRowCount (rowCount > 0; rowCount 0 is
 * proof of absence — evidence, but not data-bearing), and reused here so the
 * offline stats can never drift from the live confidence floor's definition.
 */

// Default number of labeled runs exported when the caller does not say.
export const DEFAULT_CORPUS_LIMIT: number = 200;

export type GoldenCaseSubjectType = "Incident" | "Alert";

export interface GoldenCaseLabel {
  humanVerdict?: AIRunHumanVerdict | undefined;
  autoGrade?: AIRunAutoGrade | undefined;
}

/*
 * Deterministic per-run evidence stats, derived from the recorded event
 * trail (server-side state — the model never wrote any of these numbers).
 */
export interface GoldenCaseConfidenceStats {
  // Events that minted a server-side citation (AIRunEvent.citationId set).
  citationsMinted: number;
  /*
   * Successful tool calls whose recorded resultSummary.rowCount passes
   * AIConfidenceSignal.isDataBearingRowCount (> 0).
   */
  dataBearingToolCalls: number;
  // ToolCallCompleted + ToolCallFailed events (calls that finished either way).
  toolCallsTotal: number;
  toolCallsFailed: number;
}

export interface GoldenCaseEvent {
  sequence: number;
  eventType: string;
  toolName?: string | undefined;
  // true = ToolCallCompleted, false = ToolCallFailed, undefined = not a tool result.
  ok?: boolean | undefined;
}

export interface GoldenCase {
  runId: string;
  projectId: string;
  subjectType: GoldenCaseSubjectType;
  // ISO timestamp of the run's Completed transition.
  completedAt?: string | undefined;
  label: GoldenCaseLabel;
  confidence: GoldenCaseConfidenceStats;
  /*
   * Whether a AI RootCause feed item exists for the run's subject.
   * Honest caveat: feed items are keyed by SUBJECT, not by run — the AI's
   * postAnalysis is their only writer (the same sourcing rule
   * InvestigationGrader uses), but when several investigations ran for one
   * subject they share this flag.
   */
  analysisPosted: boolean;
  events: Array<GoldenCaseEvent>;
}

/*
 * Structural projection of AIRunEvent used by the pure derivation helpers, so
 * tests can feed synthetic event lists without constructing database models.
 */
export interface CorpusEventInput {
  sequence?: number | undefined;
  eventType?: AIRunEventType | undefined;
  toolName?: string | undefined;
  citationId?: string | undefined;
  resultSummary?: AIRunEventResultSummary | undefined;
}

export interface ExportCorpusOptions {
  projectId?: ObjectID | undefined;
  limit?: number | undefined;
}

export default class EvalCorpus {
  /*
   * Derive the deterministic evidence stats from a run's recorded event trail
   * (pure, exported for tests). Definitions, kept consistent with the live
   * confidence floor:
   *   - citationsMinted: events carrying a citationId — the engine mints one
   *     citation per successful tool call, server-side, from validated args.
   *   - toolCallsTotal / toolCallsFailed: ToolCallCompleted + ToolCallFailed
   *     events. ToolCallStarted is deliberately NOT counted — a call that
   *     never finished (pod death mid-call) has no outcome to score.
   *   - dataBearingToolCalls: ToolCallCompleted events whose
   *     resultSummary.rowCount passes isDataBearingRowCount — the SAME helper
   *     the confidence floor applies to citation rowCounts.
   */
  public static deriveConfidenceStats(
    events: Array<CorpusEventInput>,
  ): GoldenCaseConfidenceStats {
    let citationsMinted: number = 0;
    let dataBearingToolCalls: number = 0;
    let toolCallsTotal: number = 0;
    let toolCallsFailed: number = 0;

    for (const event of events) {
      if (event.citationId) {
        citationsMinted++;
      }

      if (event.eventType === AIRunEventType.ToolCallCompleted) {
        toolCallsTotal++;

        if (
          AIConfidenceSignal.isDataBearingRowCount(
            event.resultSummary?.rowCount,
          )
        ) {
          dataBearingToolCalls++;
        }
      } else if (event.eventType === AIRunEventType.ToolCallFailed) {
        toolCallsTotal++;
        toolCallsFailed++;
      }
    }

    return {
      citationsMinted,
      dataBearingToolCalls,
      toolCallsTotal,
      toolCallsFailed,
    };
  }

  // Skeletal event projection for the exported JSON (pure, exported for tests).
  public static toGoldenCaseEvents(
    events: Array<CorpusEventInput>,
  ): Array<GoldenCaseEvent> {
    return events.map((event: CorpusEventInput) => {
      let ok: boolean | undefined = undefined;

      if (event.eventType === AIRunEventType.ToolCallCompleted) {
        ok = true;
      } else if (event.eventType === AIRunEventType.ToolCallFailed) {
        ok = false;
      }

      return {
        sequence: event.sequence || 0,
        eventType: (event.eventType || "").toString(),
        toolName: event.toolName,
        ok,
      };
    });
  }

  /*
   * Export the golden corpus: completed Investigation runs that HAVE a label
   * (humanVerdict or autoGrade set — unlabeled runs carry no ground truth and
   * are deliberately excluded), newest first, with their event trails.
   */
  @CaptureSpan()
  public static async exportCorpus(
    options: ExportCorpusOptions,
  ): Promise<Array<GoldenCase>> {
    const limit: number = Math.min(
      options.limit || DEFAULT_CORPUS_LIMIT,
      LIMIT_MAX,
    );

    const runSelect: {
      _id: boolean;
      projectId: boolean;
      completedAt: boolean;
      humanVerdict: boolean;
      autoGrade: boolean;
      triggeredByIncidentId: boolean;
      triggeredByAlertId: boolean;
    } = {
      _id: true,
      projectId: true,
      completedAt: true,
      humanVerdict: true,
      autoGrade: true,
      triggeredByIncidentId: true,
      triggeredByAlertId: true,
    };

    const baseQuery: Query<AIRun> = {
      runType: AIRunType.Investigation,
      status: AIRunStatus.Completed,
      ...(options.projectId ? { projectId: options.projectId } : {}),
    };

    /*
     * "Has a label" is an OR (humanVerdict set OR autoGrade set); the query
     * layer composes ANDs, so run the two legs separately and union by id.
     */
    const [humanLabeled, autoGraded]: [Array<AIRun>, Array<AIRun>] =
      await Promise.all([
        AIRunService.findBy({
          query: { ...baseQuery, humanVerdict: QueryHelper.notNull() },
          select: runSelect,
          sort: { completedAt: SortOrder.Descending },
          limit,
          skip: 0,
          props: { isRoot: true },
        }),
        AIRunService.findBy({
          query: { ...baseQuery, autoGrade: QueryHelper.notNull() },
          select: runSelect,
          sort: { completedAt: SortOrder.Descending },
          limit,
          skip: 0,
          props: { isRoot: true },
        }),
      ]);

    const runsById: Map<string, AIRun> = new Map<string, AIRun>();

    for (const run of [...humanLabeled, ...autoGraded]) {
      if (run.id) {
        runsById.set(run.id.toString(), run);
      }
    }

    const labeledRuns: Array<AIRun> = Array.from(runsById.values())
      .sort((a: AIRun, b: AIRun) => {
        return (
          (b.completedAt ? b.completedAt.getTime() : 0) -
          (a.completedAt ? a.completedAt.getTime() : 0)
        );
      })
      .slice(0, limit);

    const goldenCases: Array<GoldenCase> = [];

    for (const run of labeledRuns) {
      const subjectType: GoldenCaseSubjectType | null =
        this.getSubjectType(run);

      if (!subjectType) {
        // An Investigation run always has a subject; be defensive anyway.
        logger.debug(
          `Eval corpus: run ${run.id?.toString()} has no incident/alert subject — skipped.`,
        );
        continue;
      }

      const events: Array<AIRunEvent> = await AIRunEventService.findBy({
        query: { aiRunId: run.id! },
        select: {
          sequence: true,
          eventType: true,
          toolName: true,
          citationId: true,
          resultSummary: true,
        },
        sort: { sequence: SortOrder.Ascending },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

      goldenCases.push({
        runId: run.id!.toString(),
        projectId: run.projectId!.toString(),
        subjectType,
        completedAt: run.completedAt
          ? new Date(run.completedAt).toISOString()
          : undefined,
        label: {
          humanVerdict: run.humanVerdict,
          autoGrade: run.autoGrade,
        },
        confidence: this.deriveConfidenceStats(events),
        analysisPosted: await this.hasPostedAnalysis(run, subjectType),
        events: this.toGoldenCaseEvents(events),
      });
    }

    return goldenCases;
  }

  private static getSubjectType(run: AIRun): GoldenCaseSubjectType | null {
    if (run.triggeredByIncidentId) {
      return "Incident";
    }

    if (run.triggeredByAlertId) {
      return "Alert";
    }

    return null;
  }

  /*
   * Whether the AI's analysis was posted for the run's subject: a RootCause
   * feed item exists (postAnalysis is its only writer — the sourcing rule
   * shared with InvestigationGrader). Subject-level, not run-level; see the
   * GoldenCase.analysisPosted doc comment.
   */
  private static async hasPostedAnalysis(
    run: AIRun,
    subjectType: GoldenCaseSubjectType,
  ): Promise<boolean> {
    if (subjectType === "Incident") {
      const count: number = (
        await IncidentFeedService.countBy({
          query: {
            incidentId: run.triggeredByIncidentId!,
            incidentFeedEventType: IncidentFeedEventType.RootCause,
          },
          props: { isRoot: true },
        })
      ).toNumber();

      return count > 0;
    }

    const count: number = (
      await AlertFeedService.countBy({
        query: {
          alertId: run.triggeredByAlertId!,
          alertFeedEventType: AlertFeedEventType.RootCause,
        },
        props: { isRoot: true },
      })
    ).toNumber();

    return count > 0;
  }
}
