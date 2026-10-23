import {
  InvestigationNotStartedCode,
  InvestigationGateDetails,
} from "../../../../Types/AI/InvestigationNotStartedReason";
import InvestigationEligibility from "./InvestigationEligibility";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIWorkloadLimits from "../../../../Types/AI/AIWorkloadLimits";
import { Blue500 } from "../../../../Types/BrandColors";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import Project from "../../../../Models/DatabaseModels/Project";
import { AlertFeedEventType } from "../../../../Models/DatabaseModels/AlertFeed";
import AlertService from "../../../Services/AlertService";
import AlertSeverityService from "../../../Services/AlertSeverityService";
import ProjectService from "../../../Services/ProjectService";
import AIRunService from "../../../Services/AIRunService";
import AlertFeedService from "../../../Services/AlertFeedService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import AlertAIContextBuilder, {
  AlertContextData,
} from "../AlertAIContextBuilder";
import {
  AI_ALERT_INVESTIGATION_FEATURE,
  AutonomousBudgetStatus,
} from "../../../Services/AIService";
import AIInvestigationEngine from "./AIInvestigationEngine";
import AIInvestigationQueue from "./InvestigationQueue";
import AIConfidenceSignal, { ConfidenceSignal } from "./ConfidenceSignal";
import FixFromIncidentTaskTrigger from "./FixFromIncidentTaskTrigger";
import InstrumentationTaskTrigger from "./InstrumentationTaskTrigger";
import RemediationHandoff from "./RemediationHandoff";
import {
  ObservabilityAssistantExtraTool,
  ObservabilityAssistantResult,
} from "../Chat/ObservabilityAssistant";
import { KubernetesClusterAiAccessStatus } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import KubernetesClusterAiAccessService from "../../../Services/KubernetesClusterAiAccessService";
import ClusterAccessContext from "../ClusterAccess/ClusterAccessContext";
import KubectlInvestigationToolkit from "../ClusterAccess/KubectlInvestigationToolkit";
import ToolOutputPager from "../Chat/ToolOutputPager";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
} from "../../../../Types/AI/AIAgentRunLimits";
import { ResourceAiAccessStatus } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import ResourceAiAccessService from "../../../Services/ResourceAiAccessService";
import ResourceAccessContext from "../ResourceAccess/ResourceAccessContext";
import NetworkTransceiverContext from "./NetworkTransceiverContext";
import LinkedInfrastructureContext, {
  LinkedInfrastructure,
} from "./LinkedInfrastructureContext";
import RecentChangesContext, { RecentChanges } from "./RecentChangesContext";
import InvestigationRuleWait from "./InvestigationRuleWait";
import { getInvestigationWaitUntil } from "../../../../Types/AI/InvestigationRuleWait";
import InfrastructureInvestigationToolkit from "../ResourceAccess/InfrastructureInvestigationToolkit";
import McpInvestigationTools from "../Mcp/McpInvestigationTools";
import InvestigationCodeRepositories from "./InvestigationCodeRepositories";
import { CodeRepositoryAllowance } from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import McpRunToolkit from "../Mcp/McpRunToolkit";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import InvestigationRules, {
  InvestigationRuleScope,
} from "./InvestigationRules";
import PromptText from "../../../../Utils/AI/PromptText";
import {
  AIPromptOmissions,
  AIRunEventResultSummary,
} from "../../../../Types/AI/AIChatTypes";

/*
 * AI SRE — alert investigation.
 *
 * Alerts are the earlier, "left of boom" signal. When a new alert is declared,
 * AI investigates it (read-only) and posts a cited root-cause analysis to
 * the alert timeline + Slack/Teams. Symmetric to incident investigation and
 * built on the same shared AIInvestigationEngine.
 *
 * Gated by the same per-project opt-in as incidents, PLUS two cost gates a
 * project may set for alerts (alert volume can be far higher than
 * incidents). Both are off until a project sets them, so by default every
 * alert is investigated:
 *   - severity floor: only alerts at or above the project's configured minimum
 *     severity are investigated; unset means every severity.
 *   - per-monitor cooldown: a monitor that already triggered an investigation
 *     within the window is not re-investigated — the first RCA stands; unset
 *     means no cooldown.
 */

export interface AlertGateDecision {
  investigate: boolean;
  notStartedCode?: InvestigationNotStartedCode | undefined;
  notStartedDetails?: InvestigationGateDetails | undefined;
  // Human-readable reason recorded in the debug log when skipping.
  reason: string;
  // Passed through to the AIRun as the dedupe key for future windows.
  monitorId?: ObjectID | undefined;
  /*
   * To investigate, and every investigation rule it matches waits: the
   * shortest wait, in minutes, from when the alert was created.
   */
  waitMinutes?: number | undefined;
  // When the alert was created: a wait counts from it.
  createdAt?: Date | undefined;
  /*
   * To investigate, and an investigation rule it matches picks an LLM
   * provider: the pick the run is recorded with (Types/AI/LlmProviderChoice).
   */
  llmProviderId?: ObjectID | undefined;
}

export default class AIAlertInvestigationRunner {
  /*
   * Entry point called (fire-and-forget) from AlertService.onCreateSuccess.
   * Cheap: gates + a Queued AIRun row; execution happens via the queue.
   * Never throws — all failures are logged.
   *
   * Returns whether an investigation run was actually enqueued: the create
   * hook DEFERS auto-remediation when one was (the RCA-first ordering —
   * remediation is released by RemediationHandoff when the run settles) and
   * applies the rules immediately when none was, so remediation never
   * silently depends on the AI lane.
   *
   * Why an investigation does not start is recorded on the alert's AI card
   * in one order: what stops OneUptime AI for the whole project first (AI
   * off, no provider, no credits...), then what is true of this alert -
   * created already resolved, then the cost gates.
   *
   * An alert whose investigation rules all wait is not queued: it waits
   * (InvestigationRuleWait), and this returns false, so auto remediation
   * does not wait for an investigation that may never happen. When the wait
   * ends, the rule-wait job sends a still-open alert down this path again
   * (afterWaitMinutes), and everything is decided as of then.
   */
  @CaptureSpan()
  public static async investigateNewAlert(data: {
    alertId: ObjectID;
    projectId: ObjectID;
    /*
     * Created already resolved (Common/Utils/StartingStage): over before it
     * was recorded, so there is nothing to investigate.
     */
    createdResolved?: boolean | undefined;
    /*
     * Set when an investigation rule's wait ended (InvestigationRuleWait):
     * the wait, in minutes. Whatever stops the investigation now is recorded
     * as decided after the wait, and the run it queues says it waited.
     */
    afterWaitMinutes?: number | undefined;
  }): Promise<boolean> {
    const { alertId, projectId } = data;
    const subject: { alertId: ObjectID; projectId: ObjectID } = {
      alertId,
      projectId,
    };
    const afterWaitMinutes: number | undefined =
      data.afterWaitMinutes && data.afterWaitMinutes > 0
        ? data.afterWaitMinutes
        : undefined;

    // Why not, on the alert's AI card - decided after its wait, if it waited.
    const recordSkipped: (
      code: InvestigationNotStartedCode,
      ...rest: [
        budget?: AutonomousBudgetStatus | undefined,
        details?: InvestigationGateDetails | undefined,
      ]
    ) => Promise<void> = async (
      code: InvestigationNotStartedCode,
      ...rest: [
        budget?: AutonomousBudgetStatus | undefined,
        details?: InvestigationGateDetails | undefined,
      ]
    ): Promise<void> => {
      if (afterWaitMinutes) {
        await InvestigationEligibility.recordSkipped(subject, code, rest[0], {
          ...(rest[1] || {}),
          waitMinutes: afterWaitMinutes,
        });
        return;
      }

      // Recorded exactly as each step always recorded it.
      await InvestigationEligibility.recordSkipped(subject, code, ...rest);
    };

    try {
      /*
       * What stops OneUptime AI for the whole project - but a provider or AI
       * credits it lacks for the project's own provider stop it only when
       * the provider the alert's investigation rules pick cannot run it
       * either.
       */
      const disabled: InvestigationNotStartedCode | null =
        await AIInvestigationEngine.getDisabledReasonForSubject({
          projectId,
          subjectType: "Alert",
          getRuleLlmProviderId: async (): Promise<ObjectID | undefined> => {
            return await InvestigationRules.getSubjectLlmProviderId({
              projectId,
              alertId,
            });
          },
        });
      if (disabled) {
        await recordSkipped(disabled);
        return false;
      }

      if (data.createdResolved) {
        await recordSkipped("created_resolved");
        return false;
      }

      const gate: AlertGateDecision = await this.shouldInvestigateAlert({
        alertId,
        projectId,
      });

      if (!gate.investigate) {
        await recordSkipped(
          gate.notStartedCode || "eligibility_check_failed",
          undefined,
          gate.notStartedDetails,
        );
        logger.debug(
          `AI: skipping investigation for alert ${alertId.toString()} — ${gate.reason}.`,
        );
        return false;
      }

      /*
       * Every investigation rule it matches waits: it waits until the
       * shortest wait has passed since it was created, unless that time has
       * come already (the wait ended, or it was caught up late). When the
       * wait cannot be written, it is investigated right away rather than
       * never - as a run its auto remediation waits for, like any alert
       * that does not wait.
       */
      let isWaitOver: boolean = false;

      if (gate.waitMinutes && gate.waitMinutes > 0) {
        const waitUntil: Date = getInvestigationWaitUntil(
          gate.createdAt || OneUptimeDate.getCurrentDate(),
          gate.waitMinutes,
        );

        if (waitUntil.getTime() <= OneUptimeDate.getCurrentDate().getTime()) {
          isWaitOver = true;
        } else if (
          await InvestigationRuleWait.startWaiting({
            lane: "Alert",
            projectId,
            subjectId: alertId,
            waitUntil,
          })
        ) {
          logger.debug(
            `AI: alert ${alertId.toString()} waits ${gate.waitMinutes} minutes, until ${waitUntil.toISOString()}, before it is investigated.`,
          );
          return false;
        }
      }

      /*
       * A run after a wait (or whose rule's wait had passed already, caught
       * up late): the alert's auto remediation did not wait for it -
       * nothing was queued when the alert was created - so it says so
       * (ruleWaitMinutes), and it is the alert's one investigation: the
       * job, Investigate now and Ask AI may all try to start it at once.
       */
      const ruleWaitMinutes: number | undefined =
        afterWaitMinutes ||
        (isWaitOver && gate.waitMinutes ? gate.waitMinutes : undefined);

      const enqueuedRunId: ObjectID | null = await AIInvestigationQueue.enqueue(
        {
          projectId,
          subjectAlertId: alertId,
          subjectMonitorId: gate.monitorId,
          // The LLM provider the alert's investigation rules pick.
          ...(gate.llmProviderId ? { llmProviderId: gate.llmProviderId } : {}),
          onNotEnqueued: async (
            code: InvestigationNotStartedCode,
            budget?: AutonomousBudgetStatus,
          ): Promise<void> => {
            await recordSkipped(code, budget);
          },
          ...(ruleWaitMinutes
            ? {
                ruleWaitMinutes,
                admitInsideSubjectLock: async (): Promise<boolean> => {
                  return !(await InvestigationRuleWait.hasInvestigationRun({
                    lane: "Alert",
                    projectId,
                    subjectId: alertId,
                  }));
                },
              }
            : {}),
        },
      );

      return enqueuedRunId !== null;
    } catch (error) {
      await recordSkipped("eligibility_check_failed");
      logger.error(
        `AI: unexpected error enqueueing investigation for alert ${alertId.toString()}: ${error}`,
      );
      return false;
    }
  }

  /*
   * Execute a claimed run: assemble alert context and hand it to the engine.
   * Called by AIInvestigationQueue after a successful claim. Never
   * throws — failures are handed to the queue's retry policy so a claimed
   * run is always finalized or requeued.
   */
  @CaptureSpan()
  public static async executeInvestigation(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    alertId: ObjectID;
    attemptCount: number;
    /*
     * Set on an investigation an investigation rule made wait
     * (InvestigationRuleWait): the alert's auto remediation did not wait
     * for it, so it never releases remediation when it settles.
     */
    ruleWaitMinutes?: number | undefined;
  }): Promise<void> {
    const { aiRunId, projectId, alertId, attemptCount } = data;
    // Remediation never waited for a run an investigation rule made wait.
    const isRemediationReleased: boolean = Boolean(
      data.ruleWaitMinutes && data.ruleWaitMinutes > 0,
    );

    let contextSummary: string;
    let clusterStatuses: Array<KubernetesClusterAiAccessStatus> = [];
    let resourceStatuses: Array<ResourceAiAccessStatus> = [];
    // What the summary left out of the alert's text, for the run to say.
    const promptOmissions: AIPromptOmissions = PromptText.noOmissions();
    // What the starting context read, for the run's activity.
    const contextNotes: Array<AIRunEventResultSummary> = [];
    try {
      const contextData: AlertContextData =
        await AlertAIContextBuilder.buildAlertContext({
          alertId,
        });

      contextSummary = this.buildAlertSummary(contextData, promptOmissions);

      /*
       * The infrastructure the alert is linked to - hosts, container hosts,
       * clusters, databases, services - and the other alerts on it.
       * Enrichment only: a read that fails leaves the context as it was.
       */
      let linked: LinkedInfrastructure | null = null;

      try {
        linked = await LinkedInfrastructureContext.readForAlert({
          projectId,
          alertId,
        });
        const linkedNote: AIRunEventResultSummary | null =
          LinkedInfrastructureContext.buildActivityNote(linked);

        contextSummary +=
          LinkedInfrastructureContext.buildContextSection(linked);

        if (linkedNote) {
          contextNotes.push(linkedNote);
        }
      } catch (error) {
        logger.error(
          `AI: could not read the linked infrastructure of alert ${alertId.toString()}; investigating it without it: ${error}`,
        );
      }

      /*
       * The changes recorded before the alert - deploys, rollouts, config
       * changes, OneUptime's own fixes - and which of them its services'
       * telemetry makes suspects (RecentChangesContext). Enrichment only: a
       * read that fails leaves the context as it was.
       */
      try {
        const recentChanges: RecentChanges | null =
          await RecentChangesContext.read({
            projectId,
            subjectKind: "alert",
            subjectId: alertId,
            linked,
          });
        const changesNote: AIRunEventResultSummary | null =
          RecentChangesContext.buildActivityNote(recentChanges);

        contextSummary +=
          RecentChangesContext.buildContextSection(recentChanges);

        if (changesNote) {
          contextNotes.push(changesNote);
        }
      } catch (error) {
        logger.error(
          `AI: could not read the recent changes of alert ${alertId.toString()}; investigating it without them: ${error}`,
        );
      }

      /*
       * Direct cluster access. Never a prerequisite: an access lookup that
       * fails leaves the investigation on OneUptime telemetry alone, which
       * is exactly what it did before clusters could be reached at all.
       */
      try {
        clusterStatuses =
          await KubernetesClusterAiAccessService.getStatusesForSubject({
            projectId,
            alertId,
          });
      } catch (error) {
        logger.error(
          `AI: could not resolve cluster access for alert ${alertId.toString()}; investigating with OneUptime data only: ${error}`,
        );
      }

      contextSummary +=
        ClusterAccessContext.buildContextSection(clusterStatuses);

      /*
       * Direct infrastructure access (Docker, Podman, Swarm, Proxmox,
       * VMware, Ceph, databases, hosts) through their resource AI agents.
       * Enrichment only, like cluster access, and on its own: losing it
       * never fails the investigation nor takes the cluster access away.
       */
      try {
        const statuses: Array<ResourceAiAccessStatus> =
          await ResourceAiAccessService.getStatusesForSubject({
            projectId,
            alertId,
          });
        const section: string =
          ResourceAccessContext.buildContextSection(statuses);

        resourceStatuses = statuses;
        contextSummary += section;
      } catch (error) {
        logger.error(
          `AI: could not resolve infrastructure access for alert ${alertId.toString()}; investigating it with OneUptime data only: ${error}`,
        );
      }

      /*
       * The optics of the network device the alert is about, when it is:
       * still detected or not, readings against the device's thresholds,
       * and received power over the last weeks. Enrichment only.
       */
      try {
        contextSummary += await NetworkTransceiverContext.buildContextSection({
          projectId,
          monitorIds: contextData.alert.monitorId
            ? [contextData.alert.monitorId]
            : [],
          focusText: `${contextData.alert.title || ""}\n${contextData.alert.rootCause || ""}`,
          seriesLabels: contextData.alert.seriesLabels,
        });
      } catch (error) {
        logger.error(
          `AI: could not read transceivers for alert ${alertId.toString()}; investigating it without them: ${error}`,
        );
      }
    } catch (error) {
      /*
       * Context assembly failed — the run is claimed, so hand it to the
       * retry policy rather than leaving it Running until the sweeper. When
       * this failure FINALIZED the run (retries exhausted), the alert is
       * terminally settled here and must still be released to
       * auto-remediation (RCA-first ordering).
       */
      const outcome: "requeued" | "finalized" | "noop" =
        await AIInvestigationQueue.failOrRequeue({
          aiRunId,
          attemptCount,
          errorMessage: `Failed to build alert context: ${
            error instanceof Error ? error.message : String(error)
          }`,
          isPermanent: false,
        });

      if (outcome === "finalized" && !isRemediationReleased) {
        await RemediationHandoff.runForSettledInvestigation({
          projectId,
          alertId,
        });
      }
      return;
    }

    /*
     * How far the run may go, stated once: no time limit unless the project
     * configured one. When it did, the engine enforces it between tool
     * calls and the command toolkits plan every command's wait to end
     * before it, so a command issued late in the run cannot outlive it (the
     * loop cannot interrupt a tool once it is running).
     */
    const runLimits: AIAgentRunLimits =
      await AIInvestigationEngine.getRunLimitsForProject(projectId, "Alert");
    const runDeadlineAtMs: number | undefined =
      AIAgentRunLimitsHelper.getDeadlineAtMs(runLimits, Date.now());

    // One pager for the run, so read_tool_output reads every toolkit's output.
    const outputPager: ToolOutputPager = new ToolOutputPager();

    const kubectlToolkit: KubectlInvestigationToolkit =
      new KubectlInvestigationToolkit({
        projectId,
        aiRunId,
        clusters: clusterStatuses,
        runDeadlineAtMs,
        outputPager,
      });
    const extraTools: Array<ObservabilityAssistantExtraTool> =
      kubectlToolkit.buildTools();

    /*
     * The infrastructure tools, bound to the same run and deadline. Built
     * on their own so a failure here leaves the kubectl tools (and the
     * run) as they are.
     */
    let resourceAddendum: string = "";

    try {
      const infrastructureToolkit: InfrastructureInvestigationToolkit =
        new InfrastructureInvestigationToolkit({
          projectId,
          aiRunId,
          resources: resourceStatuses,
          runDeadlineAtMs,
          outputPager,
        });
      const infrastructureTools: Array<ObservabilityAssistantExtraTool> =
        infrastructureToolkit.buildTools();

      resourceAddendum =
        resourceStatuses.length > 0
          ? ResourceAccessContext.buildPersonaAddendum(resourceStatuses)
          : "";
      extraTools.push(...infrastructureTools);
    } catch (error) {
      logger.error(
        `AI: could not offer infrastructure access for alert ${alertId.toString()}; investigating it with OneUptime data only: ${error}`,
      );
    }

    /*
     * The project's external MCP servers the investigation rules allow for
     * this alert - their tools that read only. Built on their own: a
     * failure leaves the run with every other tool (null).
     */
    const mcpToolkit: McpRunToolkit | null =
      await McpInvestigationTools.forAlert({
        projectId,
        alertId,
        aiRunId,
        outputPager,
        runDeadlineAtMs,
      });

    if (mcpToolkit) {
      extraTools.push(...mcpToolkit.buildTools());
    }

    /*
     * The code repositories the investigation rules allow for this alert:
     * its code tools read only those (every connected one with no rule, or a
     * matching rule that names none).
     */
    const codeRepositoryAllowance: CodeRepositoryAllowance =
      await InvestigationCodeRepositories.forAlert({
        projectId,
        alertId,
      });

    // Long command output is paged, never cut: offer the reader with the commands.
    if (extraTools.length > 0) {
      extraTools.push(outputPager.buildReadTool());
    }

    // The cluster rules first, exactly as before; the infrastructure rules after.
    const additionalInstructions: Array<string> = [];

    if (clusterStatuses.length > 0) {
      additionalInstructions.push(
        ClusterAccessContext.buildPersonaAddendum(clusterStatuses),
      );
    }

    if (resourceAddendum) {
      additionalInstructions.push(resourceAddendum);
    }

    // The external MCP servers last: what the run may do with them.
    if (mcpToolkit) {
      additionalInstructions.push(mcpToolkit.buildPersonaAddendum());
    }

    try {
      await this.runInvestigationEngine({
        aiRunId,
        projectId,
        alertId,
        attemptCount,
        isRemediationReleased,
        contextSummary,
        promptOmissions,
        contextNotes,
        runLimits,
        additionalInstructions,
        extraTools,
        codeRepositoryAllowance,
      });
    } finally {
      // Every session the run opened ends with it.
      await mcpToolkit?.close();
    }
  }

  // The engine run itself, with what executeInvestigation assembled.
  private static async runInvestigationEngine(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    alertId: ObjectID;
    attemptCount: number;
    // Nothing to release when it settles: a run a rule made wait.
    isRemediationReleased: boolean;
    contextSummary: string;
    promptOmissions: AIPromptOmissions;
    contextNotes: Array<AIRunEventResultSummary>;
    runLimits: AIAgentRunLimits;
    additionalInstructions: Array<string>;
    extraTools: Array<ObservabilityAssistantExtraTool>;
    codeRepositoryAllowance: CodeRepositoryAllowance;
  }): Promise<void> {
    const {
      aiRunId,
      projectId,
      alertId,
      attemptCount,
      isRemediationReleased,
      contextSummary,
      promptOmissions,
      contextNotes,
      runLimits,
      additionalInstructions,
      extraTools,
      codeRepositoryAllowance,
    } = data;

    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId,
      attemptCount,
      request: {
        // Persisted LlmLog label — owned by AIService (G4 budget list).
        feature: AI_ALERT_INVESTIGATION_FEATURE,
        alertId,
        contextSummary,
        promptOmissions,
        ...(contextNotes.length > 0 ? { contextNotes } : {}),
        maxLlmCalls: runLimits.maxLlmCalls,
        maxToolCalls: runLimits.maxToolCalls,
        maxWallClockMs: runLimits.maxWallClockMs,
        ...(additionalInstructions.length > 0
          ? { additionalInstructions: additionalInstructions.join("\n\n") }
          : {}),
        ...(extraTools.length > 0 ? { extraTools } : {}),
        codeRepositoryAllowance,
        persistCodeFixRecommendation: true,
        persistAnalysisTldr: true,
        postAnalysis: async (postData: {
          analysisMarkdown: string;
          confidence: ConfidenceSignal;
          result: ObservabilityAssistantResult;
        }): Promise<void> => {
          await AlertFeedService.createAlertFeedItem({
            alertId,
            projectId,
            aiRunId,
            alertFeedEventType: AlertFeedEventType.RootCause,
            displayColor: Blue500,
            feedInfoInMarkdown: postData.analysisMarkdown,
            /*
             * Quiet mode: an inconclusive investigation posts to the timeline
             * but does NOT loudly ping the workspace / on-call. Fail
             * direction (G6): when the confidence classification itself
             * failed, the ping SENDS — quiet mode fails louder, not silent.
             */
            workspaceNotification: {
              sendWorkspaceNotification:
                AIConfidenceSignal.shouldSendWorkspaceNotification(
                  postData.confidence,
                ),
            },
          });

          /*
           * Inconclusive means the telemetry was insufficient — while "Fix
           * new alerts automatically" is on and the auto remediation rules
           * have telemetry pull requests on for this alert (on with no
           * rule; Types/AI/AutomaticFixPullRequests), queue an
           * ImproveInstrumentation fix task that opens a PR adding the
           * missing observability. Runs strictly
           * AFTER the analysis is posted, and the trigger never throws, so
           * the investigation can neither be blocked nor failed by it.
           * Fail direction (G6): only a POSITIVE inconclusive verdict
           * (deterministic floor or classification) enqueues — a failed
           * classification does NOT create a PR.
           */
          if (
            AIConfidenceSignal.shouldEnqueueInstrumentationTask(
              postData.confidence,
            )
          ) {
            await InstrumentationTaskTrigger.enqueueForInconclusiveInvestigation(
              {
                projectId,
                alertId,
              },
            );
          }
        },
        /*
         * The engine calls this only after it atomically persists Recommended
         * with the exact posted analysis snapshot. That durable decision is
         * the prerequisite for the optional automatic FixFromIncident task;
         * the trigger then applies the alert lane's fixing switch and its
         * auto remediation rules' fix pull requests, and the remaining
         * repository, budget and dedupe gates.
         */
        onCodeFixRecommended: async (data: {
          analysisMarkdown: string;
        }): Promise<void> => {
          await FixFromIncidentTaskTrigger.autoEnqueueFromRecommendedInvestigation(
            {
              projectId,
              investigationRunId: aiRunId,
              analysisMarkdown: data.analysisMarkdown,
              alertId,
            },
          );
        },
        /*
         * RCA-first ordering: auto-remediation for this alert was deferred
         * at creation because this investigation was enqueued — release it
         * now that the run has settled (any terminal outcome). A run an
         * investigation rule made wait releases nothing: remediation did
         * not wait for it.
         */
        onSettled: async (): Promise<void> => {
          if (isRemediationReleased) {
            return;
          }

          await RemediationHandoff.runForSettledInvestigation({
            projectId,
            alertId,
          });
        },
      },
    });
  }

  /*
   * The alert-specific cost gates, evaluated BEFORE the expensive context
   * build. Severity first (cheapest to reason about), then the per-monitor
   * dedupe window. The severity gate only filters KNOWN-low-severity noise:
   * an alert whose severity order cannot be determined passes it.
   */
  @CaptureSpan()
  public static async shouldInvestigateAlert(data: {
    alertId: ObjectID;
    projectId: ObjectID;
  }): Promise<AlertGateDecision> {
    const { alertId, projectId } = data;

    const alert: Alert | null = await AlertService.findOneById({
      id: alertId,
      select: {
        // When it was created: a rule's wait counts from it.
        createdAt: true,
        // What an investigation rule matches on, and the severity floor.
        title: true,
        description: true,
        alertSeverityId: true,
        labels: {
          _id: true,
        },
        monitorId: true,
        alertSeverity: {
          order: true,
          name: true,
        },
      },
      props: { isRoot: true },
    });

    if (!alert) {
      return {
        investigate: false,
        reason: "alert not found",
        notStartedCode: "eligibility_check_failed",
      };
    }

    /*
     * Investigation rules, when the project has any: only the alerts that
     * match one are investigated. Checked first - an alert outside every
     * rule is out whatever its severity.
     */
    const scope: InvestigationRuleScope =
      await InvestigationRules.getAlertScope({ projectId, alert });

    if (!scope.isInScope) {
      return {
        investigate: false,
        notStartedCode: "no_investigation_rule_matched",
        notStartedDetails: { rulesChecked: scope.rulesChecked },
        reason: `none of the ${scope.rulesChecked} AI rules that investigate matched`,
        monitorId: alert.monitorId,
      };
    }

    // One project read serves both the severity floor and the dedupe window.
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        alertInvestigationMinimumSeverityId: true,
        alertInvestigationDedupeWindowMinutes: true,
      },
      props: { isRoot: true },
    });

    /*
     * Severity floor. Only filters KNOWN-low-severity alerts: an alert whose
     * severity order cannot be determined passes, as does every alert when
     * no floor is configured.
     */
    const floorSeverity: AlertSeverity | null = await this.getSeverityFloor(
      project?.alertInvestigationMinimumSeverityId,
    );
    const floorOrder: number | undefined = floorSeverity?.order;
    const alertOrder: number | undefined = alert.alertSeverity?.order;

    if (
      floorOrder !== undefined &&
      alertOrder !== undefined &&
      alertOrder > floorOrder
    ) {
      return {
        investigate: false,
        notStartedCode: "severity_below_threshold",
        notStartedDetails: {
          severityName: alert.alertSeverity?.name,
          minimumSeverityName: floorSeverity?.name,
        },
        reason: `severity order ${alertOrder} is below the investigation floor (order ${floorOrder})`,
        monitorId: alert.monitorId,
      };
    }

    /*
     * Per-monitor cooldown: off unless the project sets one, clamped to at
     * most a day (see AIWorkloadLimits). Alerts without a monitor have no
     * dedupe key.
     */
    const dedupeWindowMinutes: number = AIWorkloadLimits.getCooldownInMinutes(
      project?.alertInvestigationDedupeWindowMinutes,
    );

    if (alert.monitorId && dedupeWindowMinutes > 0) {
      const windowStart: Date =
        OneUptimeDate.getSomeMinutesAgo(dedupeWindowMinutes);

      const recentRunCount: number = (
        await AIRunService.countBy({
          query: {
            projectId,
            monitorId: alert.monitorId,
            runType: AIRunType.Investigation,
            triggeredByIncidentId: QueryHelper.isNull(),
            triggeredByAlertId: QueryHelper.notNull(),
            createdAt: QueryHelper.greaterThan(windowStart),
          },
          props: { isRoot: true },
        })
      ).toNumber();

      if (recentRunCount > 0) {
        return {
          investigate: false,
          notStartedCode: "monitor_cooldown",
          notStartedDetails: { cooldownWindowMinutes: dedupeWindowMinutes },
          reason: `monitor ${alert.monitorId.toString()} was already investigated within the last ${dedupeWindowMinutes} minutes`,
          monitorId: alert.monitorId,
        };
      }
    }

    return {
      investigate: true,
      reason: "passed severity and dedupe gates",
      monitorId: alert.monitorId,
      ...(scope.waitMinutes && scope.waitMinutes > 0
        ? { waitMinutes: scope.waitMinutes, createdAt: alert.createdAt }
        : {}),
      ...(scope.llmProviderId ? { llmProviderId: scope.llmProviderId } : {}),
    };
  }

  /*
   * The severity `order` value that still qualifies for investigation (lower
   * order = higher severity; an alert qualifies when its order <= floor).
   * Returns null when no floor applies — the default: no configured minimum
   * means every alert is investigated, whatever its severity.
   */
  private static async getSeverityFloor(
    minimumSeverityId: ObjectID | undefined,
  ): Promise<AlertSeverity | null> {
    if (!minimumSeverityId) {
      return null;
    }

    const floorSeverity: AlertSeverity | null =
      await AlertSeverityService.findOneById({
        id: minimumSeverityId,
        select: { order: true, name: true },
        props: { isRoot: true },
      });

    /*
     * A configured severity that has since been deleted must not silently
     * become "investigate nothing" — fall back to no floor.
     */
    if (!floorSeverity || floorSeverity.order === undefined) {
      return null;
    }

    return floorSeverity;
  }

  /*
   * Build a compact alert record to seed the investigation. It is sent with
   * every call to the model, so each free-text field goes in through
   * PromptText.field: embedded images left out, held to a length, and what
   * was left out added to `omissions`.
   */
  public static buildAlertSummary(
    contextData: AlertContextData,
    omissions?: AIPromptOmissions | undefined,
  ): string {
    const { alert, internalNotes } = contextData;

    const lines: Array<string> = [];
    lines.push("# Alert");
    lines.push(`Title: ${alert.title || "N/A"}`);

    if (alert.description) {
      lines.push(
        `Description: ${PromptText.field(alert.description, { omissions })}`,
      );
    }

    lines.push(`Severity: ${alert.alertSeverity?.name || "N/A"}`);
    lines.push(`Current state: ${alert.currentAlertState?.name || "N/A"}`);
    lines.push(
      `Declared at: ${
        alert.createdAt
          ? OneUptimeDate.getDateAsFormattedString(alert.createdAt)
          : "N/A"
      }`,
    );

    if (alert.monitor?.name) {
      lines.push(`Affected monitor: ${alert.monitor.name}`);
    }

    if (alert.labels && alert.labels.length > 0) {
      lines.push(
        `Labels: ${alert.labels
          .map((l: { name?: string }) => {
            return l.name;
          })
          .filter(Boolean)
          .join(", ")}`,
      );
    }

    if (alert.rootCause) {
      lines.push(
        `Root cause (as recorded so far): ${PromptText.field(alert.rootCause, { omissions })}`,
      );
    }

    const recentNotes: Array<string> = (internalNotes || [])
      .slice(-5)
      .map((note: { note?: string }) => {
        return note.note
          ? `- ${PromptText.field(note.note, { omissions })}`
          : "";
      })
      .filter(Boolean);

    if (recentNotes.length > 0) {
      lines.push("");
      lines.push("Recent internal notes:");
      lines.push(...recentNotes);
    }

    return lines.join("\n");
  }
}
