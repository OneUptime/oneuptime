import ObjectID from "../../../../../Types/ObjectID";
import AIRunType from "../../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
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
 * the subject's own strict opt-in (Project.enableAiInsights, default
 * FALSE), and a configured LLM provider.
 */

export interface InsightTriageResult {
  // Set when a triage run was enqueued for the insight.
  triageAiRunId?: ObjectID | undefined;
}

export default class InsightTriage {
  /*
   * NEVER throws — this runs inside the scanner's per-insight routing and a
   * failed triage enqueue must not fail the scan itself. Every failure is
   * logged and swallowed; an empty result means "no triage enqueued".
   */
  @CaptureSpan()
  public static async enqueueInsightTriage(data: {
    insight: AIInsight;
  }): Promise<InsightTriageResult> {
    const { insight } = data;

    try {
      if (!insight.id || !insight.projectId) {
        return {};
      }

      const projectId: ObjectID = insight.projectId;

      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          enableAi: true,
          enableAiInsights: true,
        },
        props: { isRoot: true },
      });

      if (!project) {
        logger.debug(
          `AI insights: not enqueueing triage for insight ${insight.id.toString()} — project not found.`,
        );
        return {};
      }

      if (project.enableAi === false) {
        logger.debug(
          `AI insights: not enqueueing triage for insight ${insight.id.toString()} — AI is disabled for the project.`,
        );
        return {};
      }

      /*
       * Strict opt-in — the column defaults to false. A triage run only
       * exists because insights exist, so it shares the insights flag; the
       * fix-tasks flag is a separate, stricter opt-in.
       */
      if (project.enableAiInsights !== true) {
        logger.debug(
          `AI insights: not enqueueing triage for insight ${insight.id.toString()} — project has not opted in to AI insights.`,
        );
        return {};
      }

      const llmProvider: LlmProvider | null =
        await LlmProviderService.getLLMProviderForProject(projectId);

      if (!llmProvider) {
        logger.debug(
          `AI insights: not enqueueing triage for insight ${insight.id.toString()} — no LLM provider configured.`,
        );
        return {};
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
            status: QueryHelper.notIn([
              AIRunStatus.Completed,
              AIRunStatus.Error,
              AIRunStatus.Cancelled,
              AIRunStatus.Stale,
            ]),
          },
          props: { isRoot: true },
        })
      ).toNumber();

      if (nonTerminalTriageRunCount > 0) {
        logger.debug(
          `AI insights: not enqueueing triage for insight ${insight.id.toString()} — a non-terminal triage run already exists.`,
        );
        return {};
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
        },
      );

      if (!triageAiRunId) {
        return {};
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
      return {};
    }
  }
}
