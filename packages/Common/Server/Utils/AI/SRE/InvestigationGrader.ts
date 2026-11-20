import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunAutoGrade from "../../../../Types/AI/AIRunAutoGrade";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import PostedRootCause from "./PostedRootCause";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunService from "../../../Services/AIRunService";
import IncidentService from "../../../Services/IncidentService";
import AlertService from "../../../Services/AlertService";
import AIService, {
  AILogResponse,
  AI_INVESTIGATION_GRADING_FEATURE,
} from "../../../Services/AIService";
import logger from "../../Logger";
import { LLMMessage } from "../../LLM/LLMService";
import LlmProviderChoice, { RuleLlmProviderChoice } from "../LlmProviderChoice";
import PromptText from "../../../../Utils/AI/PromptText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { isWhoOpenedItRootCause } from "../../../../Utils/Incident/WhoOpenedItRootCause";

/*
 * How the root cause a monitor writes when its criteria opens an incident or
 * an alert begins (MonitorCriteriaEvaluator), trimmed.
 */
export const MONITOR_ROOT_CAUSE_OPENING: string =
  "**Created because the following criteria was met**";

/*
 * AI SRE — on-resolve investigation grading (Phase 2 measurement layer).
 *
 * When an incident or an alert resolves with a root cause people wrote AND
 * a completed AI investigation exists for it, ONE constrained LLM call
 * compares the investigation's posted analysis (the RootCause feed item —
 * the only persisted copy, the same source the fix recipes read) with that
 * root cause and stores MATCH / PARTIAL / MISMATCH on the run
 * (AIRun.autoGrade + autoGradeAt). This feeds the vision §8 accuracy metrics
 * and the G3 eval work.
 *
 * Trigger idiom mirrors IncidentPostmortemRunner: fired (fire-and-forget)
 * from IncidentStateTimelineService and AlertStateTimelineService when the
 * record enters a resolved state; never throws, never blocks the resolve.
 * Deduped via autoGrade — a run is graded at most once. Budgeted: the
 * feature is in AUTONOMOUS_AI_FEATURES, so the daily autonomous token
 * budget covers it.
 *
 * Which root cause is people's (#7765), the same for incidents and alerts:
 *
 *  - the one written as the record was resolved: the Resolve dialog's "Add
 *    the root cause", or writtenRootCause on the state change over the API
 *    (StateChangeRootCause);
 *  - else, for a record a person declared, the root cause it holds - unless
 *    it is the line OneUptime used to write to say who opened it;
 *  - never the root cause of a record OneUptime opened - a monitor, a rule,
 *    a budget, a workflow or an integration - unless written as it was
 *    resolved: that one is what OneUptime wrote ("Created because the
 *    following criteria was met: Response Status Code was 503"), and graded
 *    against it, a right analysis reads as a miss. Somebody may have edited
 *    it since, but nothing says so; the Resolve dialog asks.
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

// The grade is one token; the call is held to a few.
export const GRADING_MAX_TOKENS: number = 20;

export default class InvestigationGrader {
  /*
   * What the grading call asks (pure, exported for tests): the root cause
   * people recorded, the analysis to grade, and one token back. A replayed
   * investigation is graded with the very same words (Eval/
   * ReplayInvestigation), so a replay's grade means what a live one does.
   */
  public static getGradingMessages(data: {
    rootCause: string;
    analysisMarkdown: string;
  }): Array<LLMMessage> {
    return [
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
          PromptText.field(data.rootCause, {
            maxLength: MAX_ROOT_CAUSE_CHARS,
          }),
          '"""',
          "",
          "AI investigation analysis:",
          '"""',
          data.analysisMarkdown.substring(0, MAX_ANALYSIS_CHARS),
          '"""',
          "",
          "One token only: MATCH, PARTIAL, or MISMATCH.",
        ].join("\n"),
      },
    ];
  }

  /*
   * Pure gating decision (exported for tests): grade only when a completed
   * investigation run exists, it has not been graded yet (dedupe), and there
   * is a non-empty root cause people wrote to grade against - not one
   * OneUptime wrote itself (isWrittenByOneUptime).
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

    if (this.isWrittenByOneUptime(data.rootCause)) {
      return false;
    }

    return true;
  }

  /*
   * The root cause a record holds, when people wrote it (pure, exported for
   * tests): a record a person declared - its createdByUserId - holds their
   * words. A record OneUptime opened holds what OneUptime wrote: "".
   */
  public static getPeoplesRootCause(
    record: {
      rootCause?: string | undefined;
      createdByUserId?: ObjectID | undefined;
    } | null,
  ): string {
    if (!record || !record.createdByUserId) {
      return "";
    }

    return (record.rootCause || "").trim();
  }

  /*
   * Whether a root cause is one OneUptime wrote, not people (pure, exported
   * for tests): what a monitor's criteria wrote when it opened the record -
   * the Markdown that opens "**Created because the following criteria was
   * met**" (MonitorCriteriaEvaluator) - or the line OneUptime used to write
   * to say who opened it (WhoOpenedItRootCause). It says which check failed,
   * not why; graded against it, a right analysis reads as a miss.
   */
  public static isWrittenByOneUptime(
    rootCause: string | null | undefined,
  ): boolean {
    const text: string = (rootCause || "").trim();

    return (
      text.startsWith(MONITOR_ROOT_CAUSE_OPENING) ||
      isWhoOpenedItRootCause(text)
    );
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
   * and AlertStateTimelineService when the record enters a resolved state.
   * Never throws — all failures are logged and swallowed so the resolve flow
   * can never be affected.
   */
  @CaptureSpan()
  public static async gradeInvestigationOnResolve(data: {
    // The resolved record: an incident or an alert.
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    projectId: ObjectID;
    /*
     * The root cause written as it was resolved (StateChangeRootCause),
     * when one was. Without one, the root cause a record a person declared
     * holds is graded against; a record OneUptime opened is not graded.
     */
    writtenRootCause?: string | undefined;
  }): Promise<void> {
    const { incidentId, alertId, projectId } = data;
    const subject: string = incidentId
      ? `incident ${incidentId.toString()}`
      : `alert ${alertId?.toString()}`;
    const writtenRootCause: string = (data.writtenRootCause || "").trim();

    try {
      if (!incidentId && !alertId) {
        return;
      }

      /*
       * The project's AI kill switch, checked the non-throwing way.
       *
       * This runs fire-and-forget off a resolve, inside a catch that logs at
       * error level. "This project switched AI off" is a setting, not a
       * failure, so letting the backstop in executeWithLogging throw would
       * file a permanent error for every incident or alert such a project
       * ever resolves. It is a silent skip instead — the same posture the
       * sibling on-resolve job takes via
       * AIIncidentPostmortemRunner.isEnabledForProject.
       */
      if (!(await AIService.isProjectAIEnabled(projectId))) {
        logger.debug(
          `AI grading: AI is disabled for project ${projectId.toString()} — skipping.`,
        );
        return;
      }

      /*
       * The project's own daily AI limits, the same way: a limit someone
       * set is a setting too, and every grading call would be refused
       * until midnight UTC.
       */
      if (await AIService.getReachedProjectDailyLimit({ projectId })) {
        logger.debug(
          `AI grading: project ${projectId.toString()} has reached its own daily AI limit — skipping.`,
        );
        return;
      }

      // The latest completed investigation of the record (if any).
      const run: AIRun | null = await AIRunService.findOneBy({
        query: {
          runType: AIRunType.Investigation,
          status: AIRunStatus.Completed,
          ...(incidentId
            ? { triggeredByIncidentId: incidentId }
            : { triggeredByAlertId: alertId! }),
        },
        select: {
          _id: true,
          autoGrade: true,
          completedAt: true,
          // The LLM provider its rule picked: the grade uses it too.
          llmProviderId: true,
        },
        sort: { createdAt: SortOrder.Descending },
        props: { isRoot: true },
      });

      if (!run) {
        // Nothing to grade — skip before loading anything else.
        return;
      }

      /*
       * The root cause written as it was resolved, else the one a record a
       * person declared holds (getPeoplesRootCause).
       */
      const rootCause: string =
        writtenRootCause ||
        this.getPeoplesRootCause(
          incidentId
            ? await IncidentService.findOneById({
                id: incidentId,
                select: { _id: true, rootCause: true, createdByUserId: true },
                props: { isRoot: true },
              })
            : await AlertService.findOneById({
                id: alertId!,
                select: { _id: true, rootCause: true, createdByUserId: true },
                props: { isRoot: true },
              }),
        );

      if (
        !this.shouldGradeInvestigation({
          run,
          rootCause,
        })
      ) {
        return;
      }

      /*
       * The posted analysis owned by this exact run. A newer investigation or
       * a human RootCause item may exist by resolution time; neither may be
       * graded as though it came from the selected investigation.
       */
      const analysisMarkdown: string | null =
        await PostedRootCause.getForInvestigation({
          ...(incidentId ? { incidentId } : { alertId: alertId! }),
          aiRunId: run.id!,
          runCompletedAt: run.completedAt,
        });

      if (!analysisMarkdown) {
        logger.debug(
          `AI grading: no posted analysis found for ${subject} — skipping.`,
        );
        return;
      }

      /*
       * The grade is part of the investigation: it uses the LLM provider
       * the run's rule picked, when one did (Server/Utils/AI/LlmProviderChoice).
       */
      const llmProviderChoice: RuleLlmProviderChoice =
        await LlmProviderChoice.decideIfPicked({
          projectId,
          pickedProviderId: run.llmProviderId,
        });

      const response: AILogResponse = await AIService.executeWithLogging({
        projectId,
        feature: FEATURE_NAME,
        ...(incidentId ? { incidentId } : { alertId: alertId! }),
        aiRunId: run.id!,
        llmProviderId: llmProviderChoice.llmProviderId,
        // Grades are stored on the run; no need to persist prompt previews.
        storeContentPreviews: false,
        temperature: 0,
        maxTokens: GRADING_MAX_TOKENS,
        messages: this.getGradingMessages({ rootCause, analysisMarkdown }),
      });

      const grade: AIRunAutoGrade | null = this.parseAutoGradeToken(
        response.content,
      );

      if (!grade) {
        logger.warn(
          `AI grading: unparseable grade response for ${subject} (run ${run.id!.toString()}) — no grade stored.`,
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

      logger.debug(`AI grading: ${subject} investigation graded ${grade}.`);
    } catch (error) {
      logger.error(`AI grading: failed for ${subject}: ${error}`);
    }
  }
}
