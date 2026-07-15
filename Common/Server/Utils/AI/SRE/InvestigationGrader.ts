import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunAutoGrade from "../../../../Types/AI/AIRunAutoGrade";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../../Models/DatabaseModels/IncidentFeed";
import AIRunService from "../../../Services/AIRunService";
import IncidentService from "../../../Services/IncidentService";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import AIService, {
  AILogResponse,
  AI_INVESTIGATION_GRADING_FEATURE,
} from "../../../Services/AIService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE — on-resolve investigation grading (Phase 2 measurement layer).
 *
 * When an incident resolves with a human-recorded root cause AND a completed
 * AI investigation exists for it, ONE constrained LLM call compares the
 * investigation's posted analysis (the RootCause feed item — the only
 * persisted copy, the same source the fix recipes read) with
 * Incident.rootCause and stores MATCH / PARTIAL / MISMATCH on the run
 * (AIRun.autoGrade + autoGradeAt). This feeds the vision §8 accuracy metrics
 * and the G3 eval work.
 *
 * Trigger idiom mirrors IncidentPostmortemRunner: fired (fire-and-forget)
 * from IncidentStateTimelineService when the incident enters a resolved
 * state; never throws, never blocks the resolve. Deduped via autoGrade — a
 * run is graded at most once. Budgeted: the feature is in
 * AUTONOMOUS_AI_FEATURES, so the daily autonomous token budget covers it.
 *
 * Incidents only for now: alerts do have a rootCause column, but no
 * human-authored resolution flow populates it the way incident resolution
 * does — grade quality there is unproven, so the alert side is deliberately
 * skipped (noted in the roadmap).
 */

/*
 * Persisted LlmLog label. Owned by AIService so this writer and the G4 budget
 * match-list (AUTONOMOUS_AI_FEATURES) can never drift — a drift here would
 * silently drop grading out of the daily budget forever.
 */
const FEATURE_NAME: string = AI_INVESTIGATION_GRADING_FEATURE;

// Truncation caps keep the comparison call cheap and inside context limits.
const MAX_ANALYSIS_CHARS: number = 8000;
const MAX_ROOT_CAUSE_CHARS: number = 2000;

// Word-bounded token matchers (hoisted: wrap-regex and prettier disagree inline).
const MISMATCH_RE: RegExp = /\bMISMATCH\b/;
const PARTIAL_RE: RegExp = /\bPARTIAL\b/;
const MATCH_RE: RegExp = /\bMATCH\b/;

export interface GradeGateInput {
  run: {
    id?: ObjectID | null | undefined;
    autoGrade?: AIRunAutoGrade | undefined;
  } | null;
  rootCause: string | null | undefined;
}

export default class InvestigationGrader {
  /*
   * Pure gating decision (exported for tests): grade only when a completed
   * investigation run exists, it has not been graded yet (dedupe), and the
   * incident carries a non-empty human-recorded root cause to grade against.
   */
  public static shouldGradeInvestigation(data: GradeGateInput): boolean {
    if (!data.run || !data.run.id) {
      return false;
    }

    if (data.run.autoGrade) {
      // Dedupe: a run is graded at most once.
      return false;
    }

    if (!data.rootCause || data.rootCause.trim().length === 0) {
      return false;
    }

    return true;
  }

  /*
   * Defensive one-token parse (pure, exported for tests). The prompt demands
   * exactly one token, but models editorialize — accept the verdict when
   * exactly ONE of the three tokens appears in the response, word-bounded so
   * the MATCH inside MISMATCH does not double-count. None found, or more
   * than one distinct token → unparseable → null (no grade stored).
   */
  public static parseAutoGradeToken(
    response: string | null | undefined,
  ): AIRunAutoGrade | null {
    if (!response) {
      return null;
    }

    const text: string = response.toUpperCase();

    const found: Array<AIRunAutoGrade> = [];

    if (MISMATCH_RE.test(text)) {
      found.push(AIRunAutoGrade.Mismatch);
    }

    if (PARTIAL_RE.test(text)) {
      found.push(AIRunAutoGrade.Partial);
    }

    if (MATCH_RE.test(text)) {
      found.push(AIRunAutoGrade.Match);
    }

    if (found.length !== 1) {
      return null;
    }

    return found[0]!;
  }

  /*
   * Entry point called (fire-and-forget) from IncidentStateTimelineService
   * when an incident enters a resolved state. Never throws — all failures
   * are logged and swallowed so the resolve flow can never be affected.
   */
  @CaptureSpan()
  public static async gradeInvestigationOnResolve(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const { incidentId, projectId } = data;

    try {
      // The latest completed investigation for this incident (if any).
      const run: AIRun | null = await AIRunService.findOneBy({
        query: {
          runType: AIRunType.Investigation,
          status: AIRunStatus.Completed,
          triggeredByIncidentId: incidentId,
        },
        select: {
          _id: true,
          autoGrade: true,
        },
        sort: { createdAt: SortOrder.Descending },
        props: { isRoot: true },
      });

      if (!run) {
        // Nothing to grade — skip before loading anything else.
        return;
      }

      const incident: Incident | null = await IncidentService.findOneById({
        id: incidentId,
        select: {
          _id: true,
          rootCause: true,
        },
        props: { isRoot: true },
      });

      if (
        !this.shouldGradeInvestigation({
          run,
          rootCause: incident?.rootCause,
        })
      ) {
        return;
      }

      /*
       * The posted analysis: the latest RootCause feed item — the AI's
       * postAnalysis is its only writer, and it is the only persisted copy
       * of the analysis (the same source the fix recipes read).
       */
      const feedItem: IncidentFeed | null = await IncidentFeedService.findOneBy(
        {
          query: {
            incidentId: incidentId,
            incidentFeedEventType: IncidentFeedEventType.RootCause,
          },
          select: {
            feedInfoInMarkdown: true,
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
          props: { isRoot: true },
        },
      );

      const analysisMarkdown: string = (
        feedItem?.feedInfoInMarkdown || ""
      ).trim();

      if (!analysisMarkdown) {
        logger.debug(
          `AI grading: no posted analysis found for incident ${incidentId.toString()} — skipping.`,
        );
        return;
      }

      const rootCause: string = incident!.rootCause!.trim();

      const response: AILogResponse = await AIService.executeWithLogging({
        projectId,
        feature: FEATURE_NAME,
        incidentId,
        aiRunId: run.id!,
        // Grades are stored on the run; no need to persist prompt previews.
        storeContentPreviews: false,
        temperature: 0,
        maxTokens: 20,
        messages: [
          {
            role: "system",
            content: [
              "You grade an AI incident investigation against the root cause humans recorded when they resolved the incident.",
              "Respond with EXACTLY one token and nothing else:",
              "MATCH — the investigation identified the same root cause.",
              "PARTIAL — the investigation identified part of the cause, or a closely related cause.",
              "MISMATCH — the investigation pointed somewhere else.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              "Human-recorded root cause:",
              '"""',
              rootCause.substring(0, MAX_ROOT_CAUSE_CHARS),
              '"""',
              "",
              "AI investigation analysis:",
              '"""',
              analysisMarkdown.substring(0, MAX_ANALYSIS_CHARS),
              '"""',
              "",
              "One token only: MATCH, PARTIAL, or MISMATCH.",
            ].join("\n"),
          },
        ],
      });

      const grade: AIRunAutoGrade | null = this.parseAutoGradeToken(
        response.content,
      );

      if (!grade) {
        logger.warn(
          `AI grading: unparseable grade response for incident ${incidentId.toString()} (run ${run.id!.toString()}) — no grade stored.`,
        );
        return;
      }

      await AIRunService.updateOneById({
        id: run.id!,
        data: {
          autoGrade: grade,
          autoGradeAt: OneUptimeDate.getCurrentDate(),
        },
        props: { isRoot: true },
      });

      logger.debug(
        `AI grading: incident ${incidentId.toString()} investigation graded ${grade}.`,
      );
    } catch (error) {
      logger.error(
        `AI grading: failed for incident ${incidentId.toString()}: ${error}`,
      );
    }
  }
}
