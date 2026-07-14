import ObjectID from "../../../../../Types/ObjectID";
import SentinelInsightType from "../../../../../Types/AI/SentinelInsightType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import {
  PerformanceCodeLocation,
  PerformanceFinding,
} from "../../../../../Types/AI/CodeFixTaskContext";
import SentinelInsight from "../../../../../Models/DatabaseModels/SentinelInsight";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIRunService from "../../../../Services/AIRunService";
import TelemetryExceptionService, {
  AIFixReadiness,
} from "../../../../Services/TelemetryExceptionService";
import FixPerformanceTaskTrigger from "../FixPerformanceTaskTrigger";
import FixRunBudget, { FixRunBudgetDecision } from "../../CodeFix/FixRunBudget";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

/*
 * Deterministic fix routing for newly created insights — gated on the
 * Project.enableAi master switch AND on Project.enableInsightFixTasks
 * (default FALSE): insights whose evidence points at code (new/spiking
 * exceptions with a resolvable repository, latency regressions with
 * span-tree findings) queue a CodeFix AIRun that opens a draft pull
 * request. The decision is readiness/evidence-based, never LLM-decided.
 *
 * Everything downstream reuses the existing budgeted creation paths, so
 * every guardrail comes free: the daily fix-run budget (G11, pre-checked
 * here as a quiet skip AND enforced at creation), readiness/repository
 * gates, per-(exception, recipe) and per-trace dedupe, and the open-PR cap
 * at the repository-token gate.
 */

export interface InsightFixRoutingResult {
  // Set when a fix task was queued for the insight.
  fixAiRunId?: ObjectID | undefined;
}

export default class InsightFixRouting {
  /*
   * NEVER throws — this runs inside the scanner's per-insight routing and a
   * failed fix enqueue must not fail (or duplicate) the scan itself. Every
   * failure is logged and swallowed; an empty result means "no fix opened"
   * (the insight stays ActionRequired, where the manual fix paths remain
   * available).
   */
  @CaptureSpan()
  public static async routeInsightFix(data: {
    insight: SentinelInsight;
    project: Project;
  }): Promise<InsightFixRoutingResult> {
    const { insight, project } = data;

    try {
      if (!insight.id || !insight.projectId) {
        return {};
      }

      /*
       * The master AI kill switch, checked BEFORE the per-feature opt-in —
       * the same order InstrumentationTaskTrigger and InsightTriage use. A
       * project that turned AI off gets no autonomous agent work at all,
       * whatever a legacy per-feature flag still says. `=== false` (not
       * `!== true`) because the column defaults to TRUE: an unselected or
       * undefined value must never be read as "AI disabled". The scanner
       * selects enableAi onto the project row it hands us.
       */
      if (project.enableAi === false) {
        logger.debug(
          `Sentinel insights: not routing a fix for insight ${insight.id.toString()} — AI is disabled for the project.`,
        );
        return {};
      }

      /*
       * Strict opt-in — the column defaults to false, so unset/legacy rows
       * never enqueue. Autonomous PR creation must never be default-on.
       */
      if (project.enableInsightFixTasks !== true) {
        logger.debug(
          `Sentinel insights: not routing a fix for insight ${insight.id.toString()} — project has not opted in to insight fix tasks.`,
        );
        return {};
      }

      const isExceptionInsight: boolean =
        insight.insightType === SentinelInsightType.NewException ||
        insight.insightType === SentinelInsightType.ExceptionSpike;

      const isLatencyInsight: boolean =
        insight.insightType === SentinelInsightType.TraceLatencyRegression;

      /*
       * ErrorLogSpike and MetricDrift are NEVER auto-fixed: neither carries
       * evidence that points at a specific code path, so there is no
       * grounded recipe to run — they route to triage + the human inbox.
       */
      if (!isExceptionInsight && !isLatencyInsight) {
        return {};
      }

      // Exception insights are only fixable with the exception row to fix.
      if (isExceptionInsight && !insight.telemetryExceptionId) {
        logger.debug(
          `Sentinel insights: not routing a fix for insight ${insight.id.toString()} — no telemetryExceptionId on the insight.`,
        );
        return {};
      }

      /*
       * Latency insights are only fixable with the deterministic span-tree
       * findings (and the trace they came from) captured at detect time.
       */
      const latencyFindings: Array<PerformanceFinding> =
        insight.evidence?.latency?.performanceFindings || [];
      const latencyCodeLocations: Array<PerformanceCodeLocation> =
        insight.evidence?.latency?.codeLocations || [];
      const latencyTraceId: string | undefined =
        insight.traceId || insight.evidence?.latency?.sampleTraceId;

      if (
        isLatencyInsight &&
        (latencyFindings.length === 0 || !latencyTraceId)
      ) {
        logger.debug(
          `Sentinel insights: not routing a fix for insight ${insight.id.toString()} — the latency evidence has no span-tree findings or no trace id.`,
        );
        return {};
      }

      /*
       * G11 guardrail: the per-project daily fix-run budget. For this
       * AUTOMATIC trigger, over-budget is a logged skip — never an error
       * (the creation paths below would throw the same rejection, but that
       * lands in the catch as an unexpected failure; a budget skip is
       * expected behavior, not a failure).
       */
      const budget: FixRunBudgetDecision = await FixRunBudget.getBudgetStatus(
        insight.projectId,
      );

      if (!budget.allowed) {
        logger.debug(
          `Sentinel insights: not routing a fix for insight ${insight.id.toString()} — ${FixRunBudget.describeRejection(budget)}`,
        );
        return {};
      }

      let createdRun: AIRun;

      if (isExceptionInsight) {
        /*
         * Readiness precheck (provider payable, repository resolvable,
         * agent alive) so an unready project gets a quiet skip instead of
         * a thrown gate: the insight stays ActionRequired and the exception
         * page's manual "Fix with AI Agent" button remains available once
         * the project fixes its setup.
         */
        const readiness: AIFixReadiness =
          await TelemetryExceptionService.getAIFixReadiness({
            telemetryExceptionId: insight.telemetryExceptionId!,
            props: { isRoot: true },
          });

        if (!readiness.ready) {
          logger.debug(
            `Sentinel insights: not routing a fix for insight ${insight.id.toString()} — AI fix readiness checks failed.`,
          );
          return {};
        }

        /*
         * The exception-page creation path, system-triggered (no userId in
         * props — the run stays system-authored): budget, readiness
         * re-check and per-(exception, recipe) dedupe are enforced inside.
         */
        createdRun =
          await TelemetryExceptionService.createCodeFixRunForException({
            telemetryExceptionId: insight.telemetryExceptionId!,
            props: { isRoot: true },
            taskType: CodeFixTaskType.FixException,
          });
      } else {
        /*
         * The findings-based FixPerformance path: the deterministic
         * evidence gate already ran at detect time (the stored findings ARE
         * its output); repo gate, per-trace dedupe and budget are enforced
         * inside.
         */
        createdRun =
          await FixPerformanceTaskTrigger.createPerformanceFixTaskFromFindings({
            projectId: insight.projectId,
            traceId: latencyTraceId!,
            serviceName: insight.serviceName,
            findings: latencyFindings,
            codeLocations: latencyCodeLocations,
          });
      }

      if (!createdRun.id) {
        return {};
      }

      /*
       * Provenance: stamp the created run with the insight that opened it,
       * so the run's origin is queryable from either side. Best-effort —
       * the fix run exists either way, and the scanner links insight ->
       * run via the returned fixAiRunId.
       */
      try {
        await AIRunService.updateOneById({
          id: createdRun.id,
          data: {
            triggeredBySentinelInsightId: insight.id,
          },
          props: { isRoot: true },
        });
      } catch (error) {
        logger.error(
          `Sentinel insights: failed to stamp fix run ${createdRun.id.toString()} with insight ${insight.id.toString()}: ${error}`,
        );
      }

      logger.debug(
        `Sentinel insights: queued ${isExceptionInsight ? "FixException" : "FixPerformance"} run ${createdRun.id.toString()} for insight ${insight.id.toString()}.`,
      );

      return { fixAiRunId: createdRun.id };
    } catch (error) {
      /*
       * Creation-path throws are mostly EXPECTED quiet skips for this
       * automatic trigger (dedupe hit, readiness re-check raced, budget
       * raced) — log at debug and leave the insight on the human path.
       */
      logger.debug(
        `Sentinel insights: fix routing skipped for insight ${insight.id?.toString()}: ${error}`,
      );
      return {};
    }
  }
}
