import ObjectID from "../../../../../Types/ObjectID";
import OneUptimeDate from "../../../../../Types/Date";
import LIMIT_MAX from "../../../../../Types/Database/LimitMax";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIInsightStatus from "../../../../../Types/AI/AIInsightStatus";
import ProjectService from "../../../../Services/ProjectService";
import AIInsightService from "../../../../Services/AIInsightService";
import InsightDetectors from "./Detectors/Index";
import InsightStore, { UpsertCandidatesResult } from "./InsightStore";
import InsightFixRouting, { InsightFixRoutingResult } from "./FixRouting";
import InsightTriage, { InsightTriageResult } from "./Triage";
import { InsightCandidate, InsightDetector, InsightScanContext } from "./Types";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import AIRunType from "../../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import ExceptionAIClassification from "../../../../../Types/AI/ExceptionAIClassification";
import AIRunService from "../../../../Services/AIRunService";
import QueryHelper from "../../../../Types/Database/QueryHelper";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

/*
 * AI Insights — the scan orchestration (the "watch loop").
 *
 * THE RULE: no LLM here. Detectors are deterministic statistical sensors;
 * the LLM only engages per-finding AFTERWARDS through InsightTriage
 * (budgeted, read-only). The automatic fix decision happens after triage
 * completes (InsightTriageRunner → InsightFixRouting) and only for
 * insights the triage classified as code faults.
 *
 * Everything is opt-in and quiet: only projects with the default-false
 * enableAiInsights flag are scanned, insights never page and never
 * open incidents, and every layer (project, detector, insight) fails in
 * isolation — one broken tenant or sensor must not stop the sweep.
 */
export default class InsightScanner {
  /*
   * One scan tick across all opted-in projects. The flag query IS the gate:
   * enableAiInsights defaults to false, so nothing runs for a project
   * that never opted in. Runs as root with explicit projectId scoping
   * (monitor-worker precedent), not per-user ACL. Never throws — the cron
   * caller gets a clean resolve either way.
   */
  @CaptureSpan()
  public static async scanAllProjects(): Promise<void> {
    let projects: Array<Project> = [];

    try {
      projects = await ProjectService.findBy({
        query: { enableAiInsights: true },
        select: {
          _id: true,
          enableInsightFixTasks: true,
          enableAi: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `AI Insights: failed to list opted-in projects for the scan tick: ${error}`,
      );
      return;
    }

    for (const project of projects) {
      try {
        await this.scanProjectForInsights(project);
      } catch (error) {
        logger.error(
          `AI Insights: scan failed for project ${project.id?.toString()}: ${error}`,
        );
      }
    }
  }

  /*
   * One project's scan: self-heal any insight an earlier tick left unrouted,
   * run every registered detector (isolated — one failing sensor must not
   * blind the others), dedupe/upsert the candidates through InsightStore,
   * then route each NEWLY created insight to ActionRequired and enqueue its
   * triage (which, on a code-fault verdict, routes the fix).
   */
  @CaptureSpan()
  public static async scanProjectForInsights(project: Project): Promise<void> {
    const projectId: ObjectID | undefined = project.id || undefined;

    if (!projectId) {
      return;
    }

    /*
     * The self-heal sweep runs FIRST — before the detectors — so it can only
     * ever see rows from EARLIER ticks: this tick's own new rows do not
     * exist yet and therefore cannot be routed twice.
     */
    await this.rerouteStrandedInsights({
      projectId: projectId,
      project: project,
    });

    // The tick's single clock — detectors compute all windows from it.
    const now: Date = OneUptimeDate.getCurrentDate();

    const context: InsightScanContext = {
      projectId: projectId,
      now: now,
    };

    const candidates: Array<InsightCandidate> = [];
    const detectors: Array<InsightDetector> =
      InsightDetectors.getAllDetectors();

    for (const detector of detectors) {
      try {
        const detected: Array<InsightCandidate> =
          await detector.detect(context);
        candidates.push(...detected);
      } catch (error) {
        logger.error(
          `AI Insights: ${detector.insightType} detector failed for project ${projectId.toString()} — continuing with the remaining detectors: ${error}`,
        );
      }
    }

    if (candidates.length === 0) {
      return;
    }

    const upsertResult: UpsertCandidatesResult =
      await InsightStore.upsertCandidates({
        projectId: projectId,
        candidates: candidates,
        now: now,
      });

    /*
     * Only NEWLY created insights are routed — refreshed rows were routed
     * on the tick that created them and their status is owned by humans and
     * the fix flow from then on.
     */
    for (const insight of upsertResult.created) {
      try {
        await this.routeNewInsight({ insight: insight, project: project });
      } catch (error) {
        logger.error(
          `AI Insights: routing failed for insight ${insight.id?.toString()} (project ${projectId.toString()}) — continuing with the remaining insights: ${error}`,
        );
      }
    }
  }

  /*
   * Self-heal for insights stranded in the defensive Detected state.
   *
   * InsightStore CREATES rows as Detected and the routing status write is a
   * SEPARATE, later write. If the pod dies in between (eviction, OOM,
   * deploy) — or that write simply fails — the row is stranded: later ticks
   * take the REFRESH path, which by contract never touches status and never
   * re-routes, so the insight would stay Detected FOREVER: never triaged,
   * never fix-routed, and its fingerprint permanently pinned (the dedupe
   * lookup would keep refreshing the dead row instead of letting a fresh,
   * routable insight be created for that finding).
   *
   * RE-ROUTING IS SAFE BY CONSTRUCTION — it cannot double-create work:
   *   - fix creation dedupes inside the creation paths (per (exception,
   *     recipe) for FixException, per trace for FixPerformance), so a row
   *     that DID get its fix run created before the pod died gets a rejected
   *     create here, which InsightFixRouting swallows into "no fix opened";
   *   - triage dedupes to one non-terminal run per insight, so a re-routed
   *     insight with a live triage run enqueues nothing;
   *   - both status writes are idempotent overwrites of the same row.
   * NEVER throws: a sweep failure must not cost the project its scan.
   */
  private static async rerouteStrandedInsights(data: {
    projectId: ObjectID;
    project: Project;
  }): Promise<void> {
    const { projectId, project } = data;

    let stranded: Array<AIInsight> = [];

    try {
      stranded = await AIInsightService.findBy({
        query: {
          projectId: projectId,
          status: AIInsightStatus.Detected,
        },
        // Exactly the fields routeNewInsight's collaborators read.
        select: {
          _id: true,
          projectId: true,
          insightType: true,
          serviceName: true,
          traceId: true,
          telemetryExceptionId: true,
          evidence: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `AI Insights: failed to sweep unrouted (Detected) insights for project ${projectId.toString()} — continuing with the scan: ${error}`,
      );
      return;
    }

    for (const insight of stranded) {
      try {
        await this.routeNewInsight({ insight: insight, project: project });
      } catch (error) {
        logger.error(
          `AI Insights: re-routing failed for stranded insight ${insight.id?.toString()} (project ${projectId.toString()}) — continuing with the remaining stranded insights: ${error}`,
        );
      }
    }

    await this.resweepUntriagedInsights({ projectId });
    await this.resweepUnroutedCodeFaults({ projectId, project });
  }

  /*
   * Stranded shape 2: ActionRequired insights that never got a triage
   * verdict. With triage gating the automatic fix, a triage that was
   * quiet-skipped (token budget exhausted), expired in the queue, or
   * failed would otherwise strand the insight verdict-less FOREVER — and
   * with it any automatic fix. Re-enqueueing is safe and cheap: the
   * triage enqueue dedupes to one non-terminal run per insight and
   * quiet-skips when the budget still has no headroom. Bounded two ways:
   * only insights from the last 7 days (older rows predate the verdict
   * gate or were consciously left alone), and only while fewer than 3
   * triage attempts have ended in failure (a permanently failing triage
   * must not retry every 15 minutes for a week).
   */
  private static async resweepUntriagedInsights(data: {
    projectId: ObjectID;
  }): Promise<void> {
    const { projectId } = data;

    try {
      const untriaged: Array<AIInsight> = await AIInsightService.findBy({
        query: {
          projectId: projectId,
          status: AIInsightStatus.ActionRequired,
          triageCompletedAt: QueryHelper.isNull(),
          createdAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), -7),
          ),
        },
        select: {
          _id: true,
          projectId: true,
          insightType: true,
          serviceName: true,
          traceId: true,
          telemetryExceptionId: true,
          evidence: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

      for (const insight of untriaged) {
        try {
          const failedTriageAttempts: number = (
            await AIRunService.countBy({
              query: {
                runType: AIRunType.Investigation,
                triggeredByAiInsightId: insight.id!,
                status: QueryHelper.any([
                  AIRunStatus.Error,
                  AIRunStatus.Cancelled,
                  AIRunStatus.Stale,
                ]),
              },
              props: { isRoot: true },
            })
          ).toNumber();

          if (failedTriageAttempts >= 3) {
            continue;
          }

          const triageResult: InsightTriageResult =
            await InsightTriage.enqueueInsightTriage({ insight: insight });

          if (triageResult.triageAiRunId) {
            await AIInsightService.updateOneById({
              id: insight.id!,
              data: {
                triageAiRunId: triageResult.triageAiRunId,
              },
              props: { isRoot: true },
            });
          }
        } catch (error) {
          logger.error(
            `AI Insights: triage re-enqueue failed for insight ${insight.id?.toString()} — continuing: ${error}`,
          );
        }
      }
    } catch (error) {
      logger.error(
        `AI Insights: failed to sweep untriaged insights for project ${projectId.toString()} — continuing with the scan: ${error}`,
      );
    }
  }

  /*
   * Stranded shape 3: a code-fault verdict was recorded but the fix was
   * never routed — the pod died between the verdict write and the fix
   * routing, or routing quiet-skipped on a transient gate (daily fix
   * budget, readiness). Re-routing is idempotent: the creation path's
   * per-(exception, recipe) dedupe and the cross-group guard refuse
   * duplicates, and the conditional status flip only moves
   * ActionRequired → FixOpened. Bounded to verdicts from the last 24
   * hours so a permanently refused group (declined by a human, capped
   * repo) does not retry forever. Latency insights are excluded — they
   * are fix-routed deterministically at scan time.
   */
  private static async resweepUnroutedCodeFaults(data: {
    projectId: ObjectID;
    project: Project;
  }): Promise<void> {
    const { projectId, project } = data;

    try {
      const unrouted: Array<AIInsight> = await AIInsightService.findBy({
        query: {
          projectId: projectId,
          status: AIInsightStatus.ActionRequired,
          classification: ExceptionAIClassification.CodeFault,
          fixAiRunId: QueryHelper.isNull(),
          triageCompletedAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), -1),
          ),
        },
        select: {
          _id: true,
          projectId: true,
          insightType: true,
          serviceName: true,
          traceId: true,
          telemetryExceptionId: true,
          evidence: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

      for (const insight of unrouted) {
        if (insight.insightType === AIInsightType.TraceLatencyRegression) {
          continue;
        }

        try {
          const fixResult: InsightFixRoutingResult =
            await InsightFixRouting.routeInsightFix({
              insight: insight,
              project: project,
            });

          if (fixResult.fixAiRunId) {
            await AIInsightService.updateOneBy({
              query: {
                _id: insight.id!.toString(),
                status: AIInsightStatus.ActionRequired,
              },
              data: {
                status: AIInsightStatus.FixOpened,
                fixAiRunId: fixResult.fixAiRunId,
              },
              props: { isRoot: true },
            });
          }
        } catch (error) {
          logger.error(
            `AI Insights: fix re-routing failed for insight ${insight.id?.toString()} — continuing: ${error}`,
          );
        }
      }
    } catch (error) {
      logger.error(
        `AI Insights: failed to sweep unrouted code-fault insights for project ${projectId.toString()} — continuing with the scan: ${error}`,
      );
    }
  }

  /*
   * Route one insight — newly created this tick, or swept up as stranded
   * from an earlier one — out of the defensive Detected state.
   *
   * TRIAGE GATES THE FIX. The automatic fix decision no longer happens
   * here: every new insight goes to ActionRequired and gets its triage
   * enqueued; when the triage run completes with a code-fault
   * classification, InsightTriageRunner routes the fix (via
   * InsightFixRouting) and flips the insight to FixOpened. This exists
   * because roughly half of real exception insights turn out to be
   * expected user errors or intentional denials (auth, paywalls, scanner
   * probes) — opening an unreviewed fix PR for those is worse than
   * opening none: the agent's only "fix" is to weaken the check that
   * correctly fired. Fail-closed by design: no triage verdict, no
   * automatic PR. The manual "Fix with AI" button on the exception page
   * is unaffected.
   *
   * The collaborator is never-throws by contract, but it is wrapped
   * anyway: a contract breach must degrade (no triage), not leave the
   * insight stuck in Detected or fail the scan.
   */
  private static async routeNewInsight(data: {
    insight: AIInsight;
    project: Project;
  }): Promise<void> {
    const { insight, project } = data;

    /*
     * TraceLatencyRegression keeps DETERMINISTIC scan-time fix routing:
     * its evidence is the SpanTreeAnalyzer's own findings (N+1, dominant
     * span, sequential fan-out) — no LLM verdict adds signal there, and
     * the exception-centric classification taxonomy would mislabel most
     * latency regressions as "infrastructure". Exception insights go
     * through the verdict gate instead.
     */
    let fixAiRunId: ObjectID | undefined = undefined;

    if (insight.insightType === AIInsightType.TraceLatencyRegression) {
      try {
        const fixResult: InsightFixRoutingResult =
          await InsightFixRouting.routeInsightFix({
            insight: insight,
            project: project,
          });
        fixAiRunId = fixResult.fixAiRunId;
      } catch (error) {
        logger.error(
          `AI Insights: fix routing threw for latency insight ${insight.id?.toString()} (treating as no fix opened): ${error}`,
        );
      }
    }

    if (fixAiRunId) {
      await AIInsightService.updateOneById({
        id: insight.id!,
        data: {
          status: AIInsightStatus.FixOpened,
          fixAiRunId: fixAiRunId,
        },
        props: { isRoot: true },
      });
    } else {
      await AIInsightService.updateOneById({
        id: insight.id!,
        data: {
          status: AIInsightStatus.ActionRequired,
        },
        props: { isRoot: true },
      });
    }

    let triageAiRunId: ObjectID | undefined = undefined;

    try {
      const triageResult: InsightTriageResult =
        await InsightTriage.enqueueInsightTriage({ insight: insight });
      triageAiRunId = triageResult.triageAiRunId;
    } catch (error) {
      logger.error(
        `AI Insights: triage enqueue threw for insight ${insight.id?.toString()} (continuing without triage): ${error}`,
      );
    }

    if (triageAiRunId) {
      await AIInsightService.updateOneById({
        id: insight.id!,
        data: {
          triageAiRunId: triageAiRunId,
        },
        props: { isRoot: true },
      });
    }
  }
}
