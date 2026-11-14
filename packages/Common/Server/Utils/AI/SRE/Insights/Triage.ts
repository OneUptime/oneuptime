import ObjectID from "../../../../../Types/ObjectID";
import AIRunType from "../../../../../Types/AI/AIRunType";
import { AIRunStatusHelper } from "../../../../../Types/AI/AIRunStatus";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import Project from "../../../../../Models/DatabaseModels/Project";
import LlmProvider from "../../../../../Models/DatabaseModels/LlmProvider";
import ProjectService from "../../../../Services/ProjectService";
import LlmProviderService from "../../../../Services/LlmProviderService";
import AIRunService from "../../../../Services/AIRunService";
import AIInsightService from "../../../../Services/AIInsightService";
import AIInvestigationQueue from "../InvestigationQueue";
import QueryHelper from "../../../../Types/Database/QueryHelper";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import {
  TELEMETRY_AI_LANES,
  TelemetryAiLane,
  getTelemetryAiLaneOfInsightType,
} from "../../../../../Types/AI/TelemetryAi";
import TelemetryAiRules from "../../TelemetryAi/TelemetryAiRules";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AiRunRefusalException from "../../../../../Types/Exception/AiRunRefusalException";
import {
  AiRunRefusalCode,
  getAiRunRefusalMessage,
} from "../../../../../Types/AI/AiRunRefusal";

/*
 * Per-insight LLM triage enqueue: a budgeted, read-only Investigation AIRun
 * (triggeredByAiInsightId set) that posts a cited root-cause/blast-
 * radius/suggested-action summary back onto the insight. Quiet-skips when
 * no LLM provider is configured or the budget has no headroom, and dedupes
 * to one non-terminal triage run per insight.
 *
 * The durable queue does the heavy lifting (claim CAS, concurrency cap,
 * daily token budget, retries, TTL expiry, stale sweeping) — this module
 * only owns the insight-specific gates, mirroring the posture of
 * AIInvestigationEngine.isEnabledForProject: enableAi not disabled,
 * the subject's own switch (Project.enableAiInsights, on for new
 * projects), and a configured LLM provider.
 *
 * A problem a telemetry product's AI section works on (Types/AI/TelemetryAi
 * - slow code in a service's profiles) is that lane's: its switch is the
 * one that counts, its AI rules decide whether it is investigated (the
 * lane's look, TelemetryAiRouting, calls this only when they do), and the
 * LLM provider those rules pick is the run's. A kind a lane shares with AI
 * Insights (new and spiking exceptions) is the lane's only while the lane's
 * switch is on: while it is off, AI Insights' own switch counts, as always.
 */

// Why no triage run was enqueued for an insight.
export enum InsightTriageNotEnqueuedReason {
  // The insight, or its project, is gone.
  NotFound = "NotFound",
  // AI is switched off for the project.
  AiOff = "AiOff",
  // AI Insights (or the insight's telemetry product's AI) is switched off.
  SwitchOff = "SwitchOff",
  // The project has no LLM provider to use.
  NoProvider = "NoProvider",
  // A triage run of the insight is queued or running already.
  AlreadyRunning = "AlreadyRunning",
  // The AI budget had no headroom, or the run could not be created.
  NotQueued = "NotQueued",
  // Something failed on the way: logged, and the scan goes on.
  Failed = "Failed",
}

/*
 * What the person who pressed Try again reads when no triage could start,
 * by reason (InsightTriage.tryAgain), as the refusal's code
 * (Types/AI/AiRunRefusal): the server answers its English sentence with
 * the code beside it, and the Dashboard words the code in the reader's
 * language (#7359).
 */
export const INSIGHT_TRIAGE_NOT_ENQUEUED_REFUSALS: Record<
  InsightTriageNotEnqueuedReason,
  AiRunRefusalCode
> = {
  [InsightTriageNotEnqueuedReason.NotFound]: AiRunRefusalCode.InsightNotFound,
  [InsightTriageNotEnqueuedReason.AiOff]: AiRunRefusalCode.AiOff,
  [InsightTriageNotEnqueuedReason.SwitchOff]: AiRunRefusalCode.InsightsOff,
  [InsightTriageNotEnqueuedReason.NoProvider]:
    AiRunRefusalCode.NoProviderToTriage,
  [InsightTriageNotEnqueuedReason.AlreadyRunning]:
    AiRunRefusalCode.InsightTriageRunning,
  [InsightTriageNotEnqueuedReason.NotQueued]: AiRunRefusalCode.TriageNotQueued,
  [InsightTriageNotEnqueuedReason.Failed]: AiRunRefusalCode.TriageNotStarted,
};

// The same, as the English sentences the API answers with.
export const INSIGHT_TRIAGE_NOT_ENQUEUED_MESSAGES: Record<
  InsightTriageNotEnqueuedReason,
  string
> = Object.fromEntries(
  Object.entries(INSIGHT_TRIAGE_NOT_ENQUEUED_REFUSALS).map(
    ([reason, refusal]: [string, AiRunRefusalCode]): [string, string] => {
      return [reason, getAiRunRefusalMessage(refusal)];
    },
  ),
) as Record<InsightTriageNotEnqueuedReason, string>;

export interface InsightTriageResult {
  // Set when a triage run was enqueued for the insight.
  triageAiRunId?: ObjectID | undefined;
  // Set when none was: why.
  notEnqueuedReason?: InsightTriageNotEnqueuedReason | undefined;
}

export default class InsightTriage {
  /*
   * NEVER throws — this runs inside the scanner's per-insight routing and a
   * failed triage enqueue must not fail the scan itself. Every failure is
   * logged and swallowed; a result without triageAiRunId means "no triage
   * enqueued", and its notEnqueuedReason says why (for Try again's refusal).
   */
  @CaptureSpan()
  public static async enqueueInsightTriage(data: {
    insight: AIInsight;
    /*
     * The LLM provider the lane's AI rules pick for the problem: the run's
     * (AIRun.llmProviderId). None: the project's default, else the global.
     */
    llmProviderId?: string | undefined;
  }): Promise<InsightTriageResult> {
    const { insight } = data;

    try {
      if (!insight.id || !insight.projectId) {
        return { notEnqueuedReason: InsightTriageNotEnqueuedReason.NotFound };
      }

      const projectId: ObjectID = insight.projectId;

      const lane: TelemetryAiLane | null = getTelemetryAiLaneOfInsightType(
        insight.insightType,
      );

      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          enableAi: true,
          enableAiInsights: true,
          ...(lane ? { [TELEMETRY_AI_LANES[lane].switchColumn]: true } : {}),
        },
        props: { isRoot: true },
      });

      if (!project) {
        logger.debug(
          `AI insights: not enqueueing triage for insight ${insight.id.toString()} — project not found.`,
        );
        return { notEnqueuedReason: InsightTriageNotEnqueuedReason.NotFound };
      }

      if (project.enableAi === false) {
        logger.debug(
          `AI insights: not enqueueing triage for insight ${insight.id.toString()} — AI is disabled for the project.`,
        );
        return { notEnqueuedReason: InsightTriageNotEnqueuedReason.AiOff };
      }

      /*
       * Strictly === true — the column defaults to false, so unset/legacy
       * rows never enqueue. A triage run only exists because insights
       * exist, so it shares the insights flag; the fix-tasks flag is a
       * separate switch. A lane's problem counts its lane's switch - a
       * kind shared with AI Insights only while that switch is on.
       */
      const workingLane: TelemetryAiLane | null =
        TelemetryAiRules.getLaneWorkingOn(insight.insightType, project);
      const isSwitchOn: boolean = workingLane
        ? TelemetryAiRules.isLaneOn(project, workingLane)
        : project.enableAiInsights === true;

      if (!isSwitchOn) {
        logger.debug(
          `AI insights: not enqueueing triage for insight ${insight.id.toString()} — project has not opted in to ${workingLane ? `${workingLane} AI` : "AI insights"}.`,
        );
        return { notEnqueuedReason: InsightTriageNotEnqueuedReason.SwitchOff };
      }

      /*
       * A provider a rule picks is decided on when the run starts
       * (AIInvestigationEngine), with its fallbacks; with none, the project
       * must have one to use.
       */
      const llmProvider: LlmProvider | null = data.llmProviderId
        ? null
        : await LlmProviderService.getLLMProviderForProject(projectId);

      if (!data.llmProviderId && !llmProvider) {
        logger.debug(
          `AI insights: not enqueueing triage for insight ${insight.id.toString()} — no LLM provider configured.`,
        );
        return { notEnqueuedReason: InsightTriageNotEnqueuedReason.NoProvider };
      }

      /*
       * Dedupe: at most one non-terminal triage run per insight — the
       * scanner refreshes recurring insights every tick, and a refresh must
       * not fan out into duplicate triage runs.
       */
      const nonTerminalTriageRunCount: number = (
        await AIRunService.countBy({
          query: {
            runType: AIRunType.Investigation,
            triggeredByAiInsightId: insight.id,
            status: QueryHelper.notIn(AIRunStatusHelper.terminalStatuses()),
          },
          props: { isRoot: true },
        })
      ).toNumber();

      if (nonTerminalTriageRunCount > 0) {
        logger.debug(
          `AI insights: not enqueueing triage for insight ${insight.id.toString()} — a non-terminal triage run already exists.`,
        );
        return {
          notEnqueuedReason: InsightTriageNotEnqueuedReason.AlreadyRunning,
        };
      }

      /*
       * Record the durable intent. The queue's own budget quiet-skip
       * applies here too — a null result means no run was created (budget
       * exhausted or the create failed) and the insight simply gets no
       * triage this tick.
       */
      const triageAiRunId: ObjectID | null = await AIInvestigationQueue.enqueue(
        {
          projectId,
          subjectAIInsightId: insight.id,
          ...(data.llmProviderId
            ? { llmProviderId: new ObjectID(data.llmProviderId) }
            : {}),
        },
      );

      if (!triageAiRunId) {
        return { notEnqueuedReason: InsightTriageNotEnqueuedReason.NotQueued };
      }

      // Link the insight to its triage run for the dashboard's live panel.
      await AIInsightService.updateOneById({
        id: insight.id,
        data: {
          triageAiRunId,
        },
        props: { isRoot: true },
      });

      return { triageAiRunId };
    } catch (error) {
      logger.error(
        `AI insights: failed to enqueue triage for insight ${insight.id?.toString()}: ${error}`,
      );
      return { notEnqueuedReason: InsightTriageNotEnqueuedReason.Failed };
    }
  }

  /*
   * Try again (issue #6438): triage the insight again after its last
   * triage did not finish - it failed, stopped reporting, or expired in the
   * queue. A new triage run, through the same gates as the scanner's (the
   * AI switches, an LLM provider, the budget, one run at a time), with the
   * LLM provider the last run used, so a rule's pick still holds. The
   * insight links to the new run, and its card shows it from the next read.
   *
   * The caller checked that the person may act on the insight (the AI
   * insight routes' read check: Project Owner, Admin or Member). Throws an
   * AiRunRefusalException that says why when no triage could start.
   */
  @CaptureSpan()
  public static async tryAgain(data: {
    insightId: ObjectID;
  }): Promise<ObjectID> {
    const insight: AIInsight | null = await AIInsightService.findOneById({
      id: data.insightId,
      select: {
        _id: true,
        projectId: true,
        insightType: true,
        triageAiRunId: true,
      },
      props: { isRoot: true },
    });

    if (!insight || !insight.id) {
      throw new AiRunRefusalException(
        INSIGHT_TRIAGE_NOT_ENQUEUED_REFUSALS[
          InsightTriageNotEnqueuedReason.NotFound
        ],
      );
    }

    const lastRun: AIRun | null = insight.triageAiRunId
      ? await AIRunService.findOneById({
          id: insight.triageAiRunId,
          select: { _id: true, status: true, llmProviderId: true },
          props: { isRoot: true },
        })
      : null;

    if (lastRun && !AIRunStatusHelper.isTerminalStatus(lastRun.status!)) {
      throw new AiRunRefusalException(
        INSIGHT_TRIAGE_NOT_ENQUEUED_REFUSALS[
          InsightTriageNotEnqueuedReason.AlreadyRunning
        ],
      );
    }

    if (!lastRun || !AIRunStatusHelper.didNotFinish(lastRun.status)) {
      throw new AiRunRefusalException(AiRunRefusalCode.TriageFinished);
    }

    const result: InsightTriageResult = await this.enqueueInsightTriage({
      insight,
      llmProviderId: lastRun.llmProviderId?.toString(),
    });

    if (!result.triageAiRunId) {
      throw new AiRunRefusalException(
        INSIGHT_TRIAGE_NOT_ENQUEUED_REFUSALS[
          result.notEnqueuedReason || InsightTriageNotEnqueuedReason.NotQueued
        ],
      );
    }

    logger.info(
      `AI insights: triage of insight ${insight.id.toString()} tried again as run ${result.triageAiRunId.toString()}.`,
    );

    return result.triageAiRunId;
  }
}
