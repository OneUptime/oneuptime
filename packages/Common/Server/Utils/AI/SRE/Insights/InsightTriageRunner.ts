import ObjectID from "../../../../../Types/ObjectID";
import OneUptimeDate from "../../../../../Types/Date";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIInsightEvidence from "../../../../../Types/AI/AIInsightEvidence";
import AIInsightStatus, {
  AIInsightStatusHelper,
} from "../../../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import ExceptionAIClassification from "../../../../../Types/AI/ExceptionAIClassification";
import AIInsightService from "../../../../Services/AIInsightService";
import ProjectService from "../../../../Services/ProjectService";
import TelemetryExceptionService from "../../../../Services/TelemetryExceptionService";
import { AI_INSIGHT_TRIAGE_FEATURE } from "../../../../Services/AIService";
import AIInvestigationEngine from "../AIInvestigationEngine";
import AIInvestigationQueue from "../InvestigationQueue";
import InsightFixRouting, { InsightFixRoutingResult } from "./FixRouting";
import { ConfidenceSignal } from "../ConfidenceSignal";
import {
  ObservabilityAssistantExtraTool,
  ObservabilityAssistantResult,
} from "../../Chat/ObservabilityAssistant";
import ToolResultSerializer from "../../Toolbox/Serializer";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { findLabelledValues } from "../../LabelledAnswerLines";
import ToolOutputPager from "../../Chat/ToolOutputPager";
import McpInvestigationTools from "../../Mcp/McpInvestigationTools";
import McpRunToolkit from "../../Mcp/McpRunToolkit";
import TelemetryAiRules, {
  TELEMETRY_AI_PROJECT_SELECT,
} from "../../TelemetryAi/TelemetryAiRules";
import {
  TelemetryAiWork,
  getTelemetryAiLaneOfInsightType,
} from "../../../../../Types/AI/TelemetryAi";
import {
  CodeRepositoryAllowance,
  NO_CODE_REPOSITORY,
} from "../../../../../Types/CodeRepository/CodeRepositoryAllowance";

// What a telemetry lane's problem is triaged with (getTelemetryAiScope).
interface TelemetryAiTriageScope {
  codeRepositoryAllowance: CodeRepositoryAllowance;
  extraTools: Array<ObservabilityAssistantExtraTool>;
}

/*
 * AI SRE — per-insight preventive triage.
 *
 * A deterministic detector filed a AIInsight; this runner executes the
 * budgeted, read-only Investigation AIRun that triages it: most likely root
 * cause, estimated blast radius, ONE recommended next action — every claim
 * cited. Structurally a sibling of IncidentInvestigationRunner: the queue
 * claims the run and dispatches here; the shared engine owns the run
 * lifecycle, the agent loop and the confidence signal.
 *
 * The difference is the OUTPUT SINK. Insights never page and never open
 * incidents (the roadmap's Preventive-lane rule), so postAnalysis writes the
 * summary onto the insight row and NOTHING else — the quiet inbox.
 */

/*
 * Cap on the rendered evidence JSON embedded in the triage prompt. Latency
 * evidence carries span-tree findings that can be large; the numbers matter,
 * an exhaustive span listing does not.
 */
const MAX_RENDERED_EVIDENCE_CHARS: number = 4000;

// What a "Classification:" line names.
const CLASSIFICATION_VALUE: RegExp =
  /(code-fault|user-error|expected-denial|infrastructure|unknown)\b/iy;

/*
 * The preventive-triage framing, prepended to the subject description. The
 * engine's persona is written for a just-declared incident/alert, so the
 * request context must recast the situation before the insight is described
 * (the engine embeds contextSummary into the investigation question — the
 * same mechanism the incident runner uses to convey its subject).
 */
const PREVENTIVE_TRIAGE_FRAMING: string = `IMPORTANT — this is PREVENTIVE TRIAGE, not an incident investigation: NO incident or alert exists and nobody has been paged. A deterministic statistical sensor (no AI involved) watched this project's telemetry and filed the finding described below, with the evidence it computed. Your job:
- Establish the most likely root cause of the finding.
- Estimate the blast radius: which services/users/operations are affected, and how badly.
- Recommend exactly ONE next action (the single most useful thing an engineer should do first).
Cite the evidence for every factual claim. If the telemetry cannot support a conclusion, say so plainly. Do not refer to "the incident" — there is none.

CLASSIFICATION — you MUST end your analysis with one line in EXACTLY this format, on its own line, with nothing after it:
Classification: <verdict>
where <verdict> is exactly one of: code-fault, user-error, expected-denial, infrastructure, unknown.
- code-fault: a defect in the monitored code that a code change should fix.
- user-error: an expected consequence of invalid end-user input (bad parameters, malformed values, garbage in a URL). The code rejected it correctly; the input was wrong.
- expected-denial: an intentional check doing its job — authentication/authorization failures, plan or paywall rejections, rate limits, or security scanners/fuzzers tripping validation on purpose-built probes.
- infrastructure: an environmental condition (network timeout, connection reset, resource exhaustion, dependency outage) rather than a logic defect.
- unknown: the evidence does not support a confident verdict.
This verdict gates automation: ONLY code-fault findings may get an automatic fix pull request, so classify conservatively — when torn between code-fault and anything else, pick the other one.`;

/*
 * The framing of a telemetry lane's problem - slow code a service's
 * profiles show - in place of the preventive one: what to establish is why
 * the code costs that much and whether a change can win it back.
 */
const PROFILE_TRIAGE_FRAMING: string = `IMPORTANT — this is PERFORMANCE TRIAGE, not an incident investigation: NO incident or alert exists and nobody has been paged. A deterministic sensor (no AI involved) read this service's continuous profiles and found the function described below - part of the application's own code - taking a large or growing share of the service's time, with the numbers it computed. Your job:
- Establish why that function costs that much: read its code with the code tools when a repository holds it, and its callers and callees with the profile tools.
- Say whether the cost is avoidable (repeated or unnecessary work, an expensive call inside a loop, a missing cache, a slow algorithm, contention) or inherent to what the service does.
- Recommend exactly ONE change most likely to win the time back, naming the file it is in.
Cite the evidence for every factual claim. If the telemetry and the code cannot support a conclusion, say so plainly. Do not refer to "the incident" — there is none.

CLASSIFICATION — you MUST end your analysis with one line in EXACTLY this format, on its own line, with nothing after it:
Classification: <verdict>
where <verdict> is exactly one of: code-fault, user-error, expected-denial, infrastructure, unknown.
- code-fault: the application's code does avoidable work that a code change should remove.
- infrastructure: the cost comes from the environment (CPU limits or throttling, garbage collector or runtime settings, a slow dependency) rather than the code.
- unknown: the evidence does not support a confident verdict.
user-error and expected-denial do not apply to performance findings: do not use them.`;

/*
 * The Traces product's AI section's three kinds of problem (Utils/Traces/
 * TraceInsight), each framed for what is to be established: why an
 * operation's requests repeat costly work, why an operation fails - whose
 * verdict decides whether its pull request may open on its own - and what a
 * trace lacks to say why.
 */
const TRACE_SLOW_TRIAGE_FRAMING: string = `IMPORTANT — this is PERFORMANCE TRIAGE, not an incident investigation: NO incident or alert exists and nobody has been paged. A deterministic sensor (no AI involved) read this service's traces and found the operation described below slow, with the pattern its slowest request repeats and the numbers it computed. Your job:
- Establish why the operation does this work this way: read its code with the code tools when a repository holds it, and its traces with the trace tools.
- Say whether the cost is avoidable (a query or call made once per item instead of once, calls made one after another that could run together, a slow query missing an index, a missing cache) or inherent to what the operation does.
- Recommend exactly ONE change most likely to win the time back, naming the file it is in.
Cite the evidence for every factual claim. If the telemetry and the code cannot support a conclusion, say so plainly. Do not refer to "the incident" — there is none.

CLASSIFICATION — you MUST end your analysis with one line in EXACTLY this format, on its own line, with nothing after it:
Classification: <verdict>
where <verdict> is exactly one of: code-fault, user-error, expected-denial, infrastructure, unknown.
- code-fault: the application's code does avoidable work that a code change should remove.
- infrastructure: the time is spent in the environment (a slow dependency, the network, CPU limits) rather than in the code.
- unknown: the evidence does not support a confident verdict.
user-error and expected-denial do not apply to performance findings: do not use them.`;

const TRACE_FAILING_TRIAGE_FRAMING: string = `IMPORTANT — this is PREVENTIVE TRIAGE of a failing operation, not an incident investigation: NO incident or alert exists and nobody has been paged. A deterministic sensor (no AI involved) read this service's traces and found the operation described below failing, with the error its most recent failures recorded and the numbers it computed. Your job:
- Establish why it fails: read the code that raised the error with the code tools when a repository holds it, and the failed requests with the trace tools.
- Say whether the failures are a defect in the code, a failure the code means (input it refuses correctly, an intentional denial), or the environment (a dependency down, a timeout, a limit).
- Recommend exactly ONE next action, naming the file it is in when it is a code change.
Cite the evidence for every factual claim. If the telemetry and the code cannot support a conclusion, say so plainly. Do not refer to "the incident" — there is none.

CLASSIFICATION — you MUST end your analysis with one line in EXACTLY this format, on its own line, with nothing after it:
Classification: <verdict>
where <verdict> is exactly one of: code-fault, user-error, expected-denial, infrastructure, unknown.
- code-fault: a defect in the operation's code that a code change should fix.
- user-error: the callers send input the operation refuses, correctly.
- expected-denial: an intentional check doing its job — authentication or authorization failures, plan or paywall rejections, rate limits.
- infrastructure: an environmental condition (a dependency outage, a network timeout, resource exhaustion) rather than a logic defect.
- unknown: the evidence does not support a confident verdict.
This verdict gates automation: ONLY code-fault findings may get an automatic fix pull request, so classify conservatively — when torn between code-fault and anything else, pick the other one.`;

const TRACE_TRACING_TRIAGE_FRAMING: string = `IMPORTANT — this is OBSERVABILITY TRIAGE, not an incident investigation: NO incident or alert exists and nobody has been paged. A deterministic sensor (no AI involved) read this service's traces and found that they cannot say why the service or operation described below is slow or fails: its requests record nothing inside them, or most of a slow request's time has no span under it, or its failures record neither an error message nor an exception. Your job:
- Establish what the code does where the tracing is missing: read it with the code tools when a repository holds it.
- Say which spans, attributes or recorded errors would let the next slow or failing request say why.
- Recommend exactly ONE instrumentation change, naming the file it goes in.
Cite the evidence for every factual claim. If the telemetry and the code cannot support a conclusion, say so plainly. Do not refer to "the incident" — there is none.

CLASSIFICATION — you MUST end your analysis with one line in EXACTLY this format, on its own line, with nothing after it:
Classification: <verdict>
where <verdict> is exactly one of: code-fault, user-error, expected-denial, infrastructure, unknown.
- code-fault: the code lacks instrumentation that a code change should add.
- infrastructure: the tracing is set up outside this code (an agent, a collector, a proxy, a sampling rule) and the change belongs there.
- unknown: the evidence does not support a confident verdict.
user-error and expected-denial do not apply to tracing findings: do not use them.`;

// The framing an insight's triage is given, by what kind of finding it is.
const TRIAGE_FRAMING_BY_TYPE: Partial<Record<AIInsightType, string>> = {
  [AIInsightType.ProfileHotspot]: PROFILE_TRIAGE_FRAMING,
  [AIInsightType.TraceSlowOperation]: TRACE_SLOW_TRIAGE_FRAMING,
  [AIInsightType.TraceFailingOperation]: TRACE_FAILING_TRIAGE_FRAMING,
  [AIInsightType.TraceMissingTracing]: TRACE_TRACING_TRIAGE_FRAMING,
};

export default class InsightTriageRunner {
  /*
   * Execute a claimed triage run: load the insight, build its description
   * and hand it to the shared engine. Called by AIInvestigationQueue
   * after a successful claim. Never throws — failures are handed to the
   * queue's retry policy so a claimed run is always finalized or requeued.
   */
  @CaptureSpan()
  public static async executeTriage(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    sentinelInsightId: ObjectID;
    attemptCount: number;
  }): Promise<void> {
    const { aiRunId, projectId, sentinelInsightId, attemptCount } = data;

    let contextSummary: string;
    let insight: AIInsight | null = null;
    let scope: TelemetryAiTriageScope | null = null;
    try {
      insight = await AIInsightService.findOneById({
        id: sentinelInsightId,
        select: {
          _id: true,
          projectId: true,
          insightType: true,
          severity: true,
          title: true,
          detailMarkdown: true,
          evidence: true,
          serviceName: true,
          traceId: true,
          telemetryExceptionId: true,
          metricName: true,
          firstSeenAt: true,
          lastSeenAt: true,
          occurrenceCount: true,
        },
        props: { isRoot: true },
      });

      if (!insight) {
        throw new Error(
          "AI insight not found — it may have been deleted after the triage run was enqueued.",
        );
      }

      contextSummary = this.buildInsightSummary(insight);
      scope = await InsightTriageRunner.getTelemetryAiScope({
        insight,
        projectId,
        aiRunId,
      });
    } catch (error) {
      /*
       * Context assembly failed — the run is claimed, so hand it to the
       * retry policy rather than leaving it Running until the sweeper.
       */
      await AIInvestigationQueue.failOrRequeue({
        aiRunId,
        attemptCount,
        errorMessage: `Failed to build insight context: ${
          error instanceof Error ? error.message : String(error)
        }`,
        isPermanent: false,
      });
      return;
    }

    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId,
      attemptCount,
      request: {
        feature: AI_INSIGHT_TRIAGE_FEATURE,
        contextSummary,
        ...(scope
          ? {
              codeRepositoryAllowance: scope.codeRepositoryAllowance,
              ...(scope.extraTools.length > 0
                ? { extraTools: scope.extraTools }
                : {}),
            }
          : {}),
        postAnalysis: async (postData: {
          analysisMarkdown: string;
          confidence: ConfidenceSignal;
          result: ObservabilityAssistantResult;
        }): Promise<void> => {
          const classification: ExceptionAIClassification =
            this.parseClassification(postData.analysisMarkdown);

          /*
           * The quiet inbox — the summary and verdict land on the insight
           * row: no feed items, no workspace notification, no owner/on-call
           * ping, no metrics, and no instrumentation-task trigger. Insights
           * never page and never enter the notification pipeline
           * (Preventive-lane rule); the summary waits on the Insights page
           * until a human looks.
           */
          await AIInsightService.updateOneById({
            id: sentinelInsightId,
            data: {
              triageSummaryMarkdown: postData.analysisMarkdown,
              triageCompletedAt: OneUptimeDate.getCurrentDate(),
              classification: classification,
            },
            props: { isRoot: true },
          });

          logger.debug(
            `AI insights: triage summary posted for insight ${sentinelInsightId.toString()} (run ${aiRunId.toString()}, classification=${classification}, confident=${postData.confidence.confident} via ${postData.confidence.source}).`,
          );

          /*
           * Verdict-driven follow-through. Best-effort by design: the
           * triage summary is already posted, and a failure here must not
           * fail the triage run itself.
           */
          try {
            await this.actOnClassification({
              insight: insight!,
              classification: classification,
            });
          } catch (error) {
            logger.error(
              `AI insights: post-triage action failed for insight ${sentinelInsightId.toString()} (verdict ${classification}): ${error}`,
            );
          }
        },
      },
    });
  }

  /*
   * What a telemetry lane's problem may be investigated with: the code
   * repositories and MCP servers its lane's AI rules allow for it
   * (Types/AI/TelemetryAi). Null for every other insight - triaged as it
   * always was. Rules that cannot be read allow nothing beyond OneUptime's
   * own data.
   */
  private static async getTelemetryAiScope(data: {
    insight: AIInsight;
    projectId: ObjectID;
    aiRunId: ObjectID;
  }): Promise<TelemetryAiTriageScope | null> {
    if (!getTelemetryAiLaneOfInsightType(data.insight.insightType)) {
      return null;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: TELEMETRY_AI_PROJECT_SELECT,
      props: { isRoot: true },
    });

    const work: TelemetryAiWork | null = project
      ? await TelemetryAiRules.decideForInsight({
          insight: data.insight,
          project,
        })
      : null;

    if (!work || work.skip !== null) {
      return {
        codeRepositoryAllowance: NO_CODE_REPOSITORY,
        extraTools: [],
      };
    }

    const extraTools: Array<ObservabilityAssistantExtraTool> = [];
    const outputPager: ToolOutputPager = new ToolOutputPager();
    const mcpToolkit: McpRunToolkit | null =
      await McpInvestigationTools.forTelemetryProblem({
        projectId: data.projectId,
        insightId: data.insight.id!,
        aiRunId: data.aiRunId,
        outputPager,
        allowance: work.mcpServers,
      });

    if (mcpToolkit) {
      extraTools.push(...mcpToolkit.buildTools(), outputPager.buildReadTool());
    }

    return {
      codeRepositoryAllowance: work.investigationRepositories,
      extraTools,
    };
  }

  /*
   * Parse the mandatory trailing "Classification: <verdict>" line out of
   * the triage analysis. The LAST match wins (the model may discuss the
   * taxonomy earlier in its reasoning). Anything unparseable is Unknown —
   * and Unknown never routes a fix, so a malformed answer fails closed.
   */
  public static parseClassification(
    analysisMarkdown: string,
  ): ExceptionAIClassification {
    const values: Array<string> = findLabelledValues({
      text: analysisMarkdown || "",
      label: "classification",
      value: CLASSIFICATION_VALUE,
    });

    const last: string | undefined = values[values.length - 1];

    if (!last) {
      return ExceptionAIClassification.Unknown;
    }

    return last.toLowerCase() as ExceptionAIClassification;
  }

  /*
   * Act on the triage verdict:
   *
   * 1. Stamp the verdict onto the exception group row (aiClassification)
   *    so the exceptions list can filter on it and the fix lane can skip
   *    known-non-defects without re-triaging, and PROMOTE it into the
   *    platform-wide errorClass when nothing better has claimed that field
   *    yet (see below).
   * 2. code-fault → route the automatic fix (InsightFixRouting owns every
   *    gate: enableAi, enableInsightFixTasks, budget, readiness, dedupe)
   *    and flip the insight to FixOpened when a run was queued.
   * 3. expected-denial → optionally auto-archive the exception group when
   *    the project opted in (autoArchiveNonActionableExceptions). Only
   *    expected denials are archived — user errors and infrastructure
   *    conditions stay visible for a human to judge.
   */
  private static async actOnClassification(data: {
    insight: AIInsight;
    classification: ExceptionAIClassification;
  }): Promise<void> {
    const { insight, classification } = data;

    if (!insight.id || !insight.projectId) {
      return;
    }

    /*
     * The verdict stamp on the exception group is metadata and always
     * lands; the AUTOMATION below (fix PR, auto-archive) additionally
     * requires that no human closed the insight while the triage run sat
     * in the queue or executed. The `insight` object is a snapshot from
     * claim time — minutes to half an hour old — so the status MUST be
     * re-read here: an insight a human Dismissed or Resolved in the
     * meantime gets no PR and keeps its terminal status.
     */
    if (insight.telemetryExceptionId) {
      /*
       * aiClassification is the AUDIT RECORD of what the LLM said and is
       * written unconditionally — it must stay readable even when a
       * stronger source owns errorClass, so a human comparing the two can
       * see where the model disagreed.
       */
      await TelemetryExceptionService.updateOneById({
        id: insight.telemetryExceptionId,
        data: {
          aiClassification: classification,
        },
        props: { isRoot: true },
      });

      /*
       * errorClass is the ACTED-ON field (Issues scope, emit-path
       * suppression, fix routing), and its precedence is
       * declared > manual > ai > default. A class the throwing code
       * declared for itself is a site-level statement by a developer, and
       * 'manual' is a human's verdict on this exact group; a probabilistic
       * LLM answer outranks neither. So the promotion is guarded on the
       * source still being 'default' — nobody has classified this group.
       *
       * The guard is a WHERE clause rather than a read-then-write: the
       * triage run has been in flight for minutes, so a 'declared' event
       * ingesting or a human reclassifying between a read and this write
       * is a real race, and a conditional UPDATE cannot clobber either.
       * (Same conditional-flip idiom as the ActionRequired -> FixOpened
       * write below.)
       */
      try {
        const promotedRowCount: number =
          await TelemetryExceptionService.updateOneBy({
            query: {
              _id: insight.telemetryExceptionId.toString(),
              errorClassSource: "default",
            },
            data: {
              errorClass: classification,
              errorClassSource: "ai",
            },
            props: { isRoot: true },
          });

        if (promotedRowCount === 0) {
          logger.debug(
            `AI insights: kept the existing error class on exception ${insight.telemetryExceptionId.toString()} — a declared or manual classification outranks the AI verdict ${classification}.`,
          );
        }
      } catch (err) {
        /*
         * Non-fatal on purpose. This is a secondary, self-healing write: the
         * audit record above already landed, and live traffic re-stamps
         * errorClass from the declared class on the group's next occurrence.
         *
         * The auto-archive decision below IS user-visible and irreversible by
         * comparison, so it must not be lost to a failure here. Without this
         * guard the two are coupled only by statement order, which is exactly
         * the kind of coupling nobody notices until an incident.
         */
        logger.warn(
          `AI insights: could not promote the error class on exception ${insight.telemetryExceptionId.toString()}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const currentInsight: AIInsight | null = await AIInsightService.findOneById(
      {
        id: insight.id,
        select: {
          _id: true,
          status: true,
        },
        props: { isRoot: true },
      },
    );

    if (
      !currentInsight ||
      (currentInsight.status &&
        AIInsightStatusHelper.isTerminalStatus(currentInsight.status))
    ) {
      logger.debug(
        `AI insights: skipping post-triage automation for insight ${insight.id.toString()} — insight is ${currentInsight?.status || "deleted"}.`,
      );
      return;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: insight.projectId,
      select: {
        _id: true,
        enableAi: true,
        enableInsightFixTasks: true,
        autoArchiveNonActionableExceptions: true,
      },
      props: { isRoot: true },
    });

    if (!project) {
      return;
    }

    /*
     * TraceLatencyRegression insights are fix-routed DETERMINISTICALLY at
     * scan time (their span-tree evidence needs no LLM verdict — see
     * InsightScanner.routeNewInsight); routing them again here would
     * duplicate the run/PR. The verdict gate applies to exception
     * insights only.
     */
    const isVerdictGatedInsight: boolean =
      insight.insightType !== AIInsightType.TraceLatencyRegression &&
      // A telemetry lane's rules decide its fixes (TelemetryAiRouting).
      !getTelemetryAiLaneOfInsightType(insight.insightType);

    if (
      classification === ExceptionAIClassification.CodeFault &&
      isVerdictGatedInsight
    ) {
      const fixResult: InsightFixRoutingResult =
        await InsightFixRouting.routeInsightFix({
          insight: insight,
          project: project,
        });

      if (fixResult.fixAiRunId) {
        /*
         * Conditional flip: only a still-ActionRequired insight moves to
         * FixOpened, so a dismissal landing between the status re-read
         * above and this write can never be clobbered.
         */
        await AIInsightService.updateOneBy({
          query: {
            _id: insight.id.toString(),
            status: AIInsightStatus.ActionRequired,
          },
          data: {
            status: AIInsightStatus.FixOpened,
            fixAiRunId: fixResult.fixAiRunId,
          },
          props: { isRoot: true },
        });
      }

      return;
    }

    if (
      classification === ExceptionAIClassification.ExpectedDenial &&
      project.autoArchiveNonActionableExceptions === true &&
      insight.telemetryExceptionId
    ) {
      await TelemetryExceptionService.updateOneById({
        id: insight.telemetryExceptionId,
        data: {
          isArchived: true,
          markedAsArchivedAt: OneUptimeDate.getCurrentDate(),
        },
        props: { isRoot: true },
      });

      logger.debug(
        `AI insights: auto-archived exception ${insight.telemetryExceptionId.toString()} (expected-denial verdict, project opted in).`,
      );
    }
  }

  // Build the compact insight record that seeds the triage.
  private static buildInsightSummary(insight: AIInsight): string {
    const lines: Array<string> = [];

    lines.push(
      TRIAGE_FRAMING_BY_TYPE[insight.insightType as AIInsightType] ||
        PREVENTIVE_TRIAGE_FRAMING,
    );
    lines.push("");
    lines.push("# Insight finding");
    lines.push(`Finding type: ${insight.insightType || "N/A"}`);
    lines.push(`Title: ${insight.title || "N/A"}`);
    lines.push(`Severity: ${insight.severity || "N/A"}`);

    if (insight.serviceName) {
      lines.push(`Attributed service: ${insight.serviceName}`);
    }
    if (insight.metricName) {
      lines.push(`Metric: ${insight.metricName}`);
    }
    if (insight.traceId) {
      lines.push(`Representative trace id: ${insight.traceId}`);
    }
    if (insight.firstSeenAt) {
      lines.push(
        `First seen: ${OneUptimeDate.getDateAsFormattedString(insight.firstSeenAt)}`,
      );
    }
    if (insight.lastSeenAt) {
      lines.push(
        `Last seen: ${OneUptimeDate.getDateAsFormattedString(insight.lastSeenAt)}`,
      );
    }
    if (insight.occurrenceCount) {
      lines.push(`Times detected: ${insight.occurrenceCount}`);
    }

    if (insight.detailMarkdown) {
      lines.push("");
      lines.push(
        "## Detector's evidence (deterministic, computed at detect time)",
      );
      lines.push(insight.detailMarkdown);
    }

    const renderedEvidence: string = this.renderEvidence(insight.evidence);
    if (renderedEvidence) {
      lines.push("");
      lines.push("## Raw evidence values");
      lines.push(renderedEvidence);
    }

    /*
     * Detector detailMarkdown and evidence quote raw exception messages —
     * sweep secrets/PII before the text reaches the LLM provider. (The
     * chat/investigation toolbox path already redacts its tool results;
     * this closes the same gap for the detector-supplied context.)
     */
    return ToolResultSerializer.redact(lines.join("\n")).text;
  }

  /*
   * Render the stored evidence JSON compactly: one line per populated
   * section, values verbatim (the numbers ARE the evidence), capped so a
   * large span-tree finding cannot flood the prompt.
   */
  private static renderEvidence(
    evidence: AIInsightEvidence | undefined,
  ): string {
    if (!evidence) {
      return "";
    }

    const lines: Array<string> = [];

    const sections: Array<keyof AIInsightEvidence> = [
      "exception",
      "logSpike",
      "latency",
      "metricDrift",
      "profile",
      "trace",
    ];

    for (const section of sections) {
      const value: AIInsightEvidence[keyof AIInsightEvidence] =
        evidence[section];

      if (!value) {
        continue;
      }

      let rendered: string;
      try {
        rendered = JSON.stringify(value);
      } catch {
        continue;
      }

      if (rendered.length > MAX_RENDERED_EVIDENCE_CHARS) {
        rendered = `${rendered.substring(0, MAX_RENDERED_EVIDENCE_CHARS)}… (truncated)`;
      }

      lines.push(`- ${section}: ${rendered}`);
    }

    return lines.join("\n");
  }
}
