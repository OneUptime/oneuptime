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
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

/*
 * AI Insights — the scan orchestration (the "watch loop").
 *
 * THE RULE: no LLM here. Detectors are deterministic statistical sensors;
 * the LLM only engages per-finding AFTERWARDS through InsightTriage
 * (budgeted, read-only), and the fix decision inside InsightFixRouting is
 * deterministic and reuses the existing budgeted CodeFix creation paths.
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
   * then route each NEWLY created insight to FixOpened or ActionRequired and
   * enqueue its triage.
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
  }

  /*
   * Route one insight — newly created this tick, or swept up as stranded
   * from an earlier one — out of the defensive Detected state:
   *   1. deterministic fix routing (gated on enableAi + enableInsightFixTasks
   *      inside InsightFixRouting) → FixOpened + fixAiRunId, else
   *      ActionRequired;
   *   2. triage enqueue for EVERY new insight — triage enriches fix and
   *      non-fix insights alike → triageAiRunId when a run was enqueued.
   * Both collaborators are never-throws by contract, but they are wrapped
   * anyway: a contract breach must degrade (no fix / no triage), not leave
   * the insight stuck in Detected or fail the scan.
   */
  private static async routeNewInsight(data: {
    insight: AIInsight;
    project: Project;
  }): Promise<void> {
    const { insight, project } = data;

    let fixAiRunId: ObjectID | undefined = undefined;

    try {
      const fixResult: InsightFixRoutingResult =
        await InsightFixRouting.routeInsightFix({
          insight: insight,
          project: project,
        });
      fixAiRunId = fixResult.fixAiRunId;
    } catch (error) {
      logger.error(
        `AI Insights: fix routing threw for insight ${insight.id?.toString()} (treating as no fix opened): ${error}`,
      );
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
