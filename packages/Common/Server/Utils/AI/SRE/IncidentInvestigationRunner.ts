import {
  InvestigationNotStartedCode,
  InvestigationGateDetails,
} from "../../../../Types/AI/InvestigationNotStartedReason";
import InvestigationEligibility from "./InvestigationEligibility";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIWorkloadLimits from "../../../../Types/AI/AIWorkloadLimits";
import QueryHelper from "../../../Types/Database/QueryHelper";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunService from "../../../Services/AIRunService";
import IncidentSeverityService from "../../../Services/IncidentSeverityService";
import ProjectService from "../../../Services/ProjectService";
import { Blue500 } from "../../../../Types/BrandColors";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import IncidentInternalNoteService from "../../../Services/IncidentInternalNoteService";
import IncidentService from "../../../Services/IncidentService";
import IncidentAIContextBuilder, {
  IncidentContextData,
} from "../IncidentAIContextBuilder";
import {
  AI_INCIDENT_INVESTIGATION_FEATURE,
  AutonomousBudgetStatus,
} from "../../../Services/AIService";
import AIInvestigationEngine from "./AIInvestigationEngine";
import AIInvestigationQueue from "./InvestigationQueue";
import AIConfidenceSignal, { ConfidenceSignal } from "./ConfidenceSignal";
import AIMemory from "./AIMemory";
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
import { MarkdownText } from "../../../../Utils/Markdown/FeedMarkdown";
import WorkspaceNotificationText from "../../Workspace/WorkspaceNotificationText";
import LinkedInfrastructureContext, {
  LinkedInfrastructure,
} from "./LinkedInfrastructureContext";
import RecentChangesContext, { RecentChanges } from "./RecentChangesContext";
import IncidentFollowUpCheck, {
  FollowUpCheckContext,
} from "./IncidentFollowUpCheck";
import InvestigationRuleWait from "./InvestigationRuleWait";
import { getInvestigationWaitUntil } from "../../../../Types/AI/InvestigationRuleWait";
import SecurityCaseIncidentContext from "../Security/SecurityCaseIncidentContext";

/*
 * AI SRE — incident investigation.
 *
 * When a new incident is declared, wakes AI to investigate it (read-only)
 * and post a cited root-cause analysis into the incident timeline + Slack/Teams
 * — before the on-call engineer has finished reading the page. The trigger only
 * records durable intent (a Queued AIRun via AIInvestigationQueue), so a
 * pod restart can no longer orphan an investigation; the heavy lifting (run
 * lifecycle, the agent loop, confidence gating) lives in the shared
 * AIInvestigationEngine.
 *
 * A project may narrow which incidents are investigated with a severity floor
 * and a per-monitor cooldown. Both are off until a project sets them, so by
 * default every incident is investigated. An investigation rule may also
 * make OneUptime AI wait, and investigate only an incident still open after
 * the wait (InvestigationRuleWait); no rule waits unless a project sets it.
 */

export interface IncidentGateDecision {
  investigate: boolean;
  notStartedCode?: InvestigationNotStartedCode | undefined;
  notStartedDetails?: InvestigationGateDetails | undefined;
  reason: string;
  monitorId?: ObjectID | undefined;
  /*
   * To investigate, and every investigation rule it matches waits: the
   * shortest wait, in minutes, from when the incident was created.
   */
  waitMinutes?: number | undefined;
  // When the incident was created: a wait counts from it.
  createdAt?: Date | undefined;
  /*
   * To investigate, and an investigation rule it matches picks an LLM
   * provider: the pick the run is recorded with (Types/AI/LlmProviderChoice).
   */
  llmProviderId?: ObjectID | undefined;
}

export default class AIIncidentInvestigationRunner {
  /*
   * Entry point called (fire-and-forget) from IncidentService.onCreateSuccess.
   * Cheap: gates + a Queued AIRun row; execution happens via the queue.
   * Never throws — all failures are logged.
   *
   * Returns whether an investigation run was actually enqueued: the create
   * hook DEFERS auto-remediation when one was (the RCA-first ordering —
   * remediation is released by RemediationHandoff when the run settles) and
   * applies the rules immediately when none was, so remediation never
   * silently depends on the AI lane.
   *
   * Why an investigation does not start is recorded on the incident's AI
   * card in one order: what stops OneUptime AI for the whole project first
   * (AI off, no provider, no credits...), then what is true of this incident
   * - declared already resolved, then the cost gates.
   *
   * An incident whose investigation rules all wait is not queued: it waits
   * (InvestigationRuleWait), and this returns false, so auto remediation
   * does not wait for an investigation that may never happen. When the wait
   * ends, the rule-wait job sends a still-open incident down this path
   * again (afterWaitMinutes), and everything is decided as of then.
   */
  @CaptureSpan()
  public static async investigateNewIncident(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    /*
     * Declared already resolved (Common/Utils/StartingStage): over before it
     * was declared, so there is nothing to investigate.
     */
    createdResolved?: boolean | undefined;
    /*
     * Set when an investigation rule's wait ended (InvestigationRuleWait):
     * the wait, in minutes. Whatever stops the investigation now is recorded
     * as decided after the wait, and the run it queues says it waited.
     */
    afterWaitMinutes?: number | undefined;
  }): Promise<boolean> {
    const { incidentId, projectId } = data;
    const subject: { incidentId: ObjectID; projectId: ObjectID } = {
      incidentId,
      projectId,
    };
    const afterWaitMinutes: number | undefined =
      data.afterWaitMinutes && data.afterWaitMinutes > 0
        ? data.afterWaitMinutes
        : undefined;

    // Why not, on the incident's AI card - decided after its wait, if it waited.
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
       * the provider the incident's investigation rules pick cannot run it
       * either.
       */
      const disabled: InvestigationNotStartedCode | null =
        await AIInvestigationEngine.getDisabledReasonForSubject({
          projectId,
          subjectType: "Incident",
          getRuleLlmProviderId: async (): Promise<ObjectID | undefined> => {
            return await InvestigationRules.getSubjectLlmProviderId({
              projectId,
              incidentId,
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

      const gate: IncidentGateDecision = await this.shouldInvestigateIncident({
        incidentId,
        projectId,
      });

      if (!gate.investigate) {
        await recordSkipped(
          gate.notStartedCode || "eligibility_check_failed",
          undefined,
          gate.notStartedDetails,
        );
        logger.debug(
          `AI: skipping investigation for incident ${incidentId.toString()} — ${gate.reason}.`,
        );
        return false;
      }

      /*
       * Every investigation rule it matches waits: it waits until the
       * shortest wait has passed since it was declared, unless that time
       * has come already (the wait ended, or it was caught up late). When
       * the wait cannot be written, it is investigated right away rather
       * than never - as a run its auto remediation waits for, like any
       * incident that does not wait.
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
            lane: "Incident",
            projectId,
            subjectId: incidentId,
            waitUntil,
          })
        ) {
          logger.debug(
            `AI: incident ${incidentId.toString()} waits ${gate.waitMinutes} minutes, until ${waitUntil.toISOString()}, before it is investigated.`,
          );
          return false;
        }
      }

      /*
       * A run after a wait (or whose rule's wait had passed already, caught
       * up late): the incident's auto remediation did not wait for it -
       * nothing was queued when the incident was declared - so it says so
       * (ruleWaitMinutes), and it is the incident's one investigation: the
       * job, Investigate now and Ask AI may all try to start it at once.
       */
      const ruleWaitMinutes: number | undefined =
        afterWaitMinutes ||
        (isWaitOver && gate.waitMinutes ? gate.waitMinutes : undefined);

      const enqueuedRunId: ObjectID | null = await AIInvestigationQueue.enqueue(
        {
          projectId,
          subjectIncidentId: incidentId,
          subjectMonitorId: gate.monitorId,
          // The LLM provider the incident's investigation rules pick.
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
                    lane: "Incident",
                    projectId,
                    subjectId: incidentId,
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
        `AI: unexpected error enqueueing investigation for incident ${incidentId.toString()}: ${error}`,
      );
      return false;
    }
  }

  /*
   * The incident cost gates, evaluated BEFORE anything expensive. Mirrors the
   * alert lane, with one deliberate difference: the severity floor is UNSET
   * by default here, so every incident is still investigated unless an
   * operator narrows it. An alert fires straight off a monitor and is noisy
   * by nature; an incident already cleared a human-authored threshold to
   * exist, so silently investigating fewer of them on upgrade would take away
   * analysis someone was relying on.
   *
   * An incident affects a SET of monitors rather than one, so the dedupe key
   * is "any of them" — a monitor storm that opens several incidents is
   * exactly the repeat work this suppresses.
   */
  @CaptureSpan()
  public static async shouldInvestigateIncident(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<IncidentGateDecision> {
    const { incidentId, projectId } = data;

    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      select: {
        // When it was declared: a rule's wait counts from it.
        createdAt: true,
        // What an investigation rule matches on, and the severity floor.
        title: true,
        description: true,
        incidentSeverityId: true,
        labels: {
          _id: true,
        },
        monitors: {
          _id: true,
        },
        incidentSeverity: {
          order: true,
          name: true,
        },
      },
      props: { isRoot: true },
    });

    if (!incident) {
      return {
        investigate: false,
        reason: "incident not found",
        notStartedCode: "eligibility_check_failed",
      };
    }

    const monitorIds: Array<ObjectID> = (incident.monitors || [])
      .map((monitor: { _id?: string }) => {
        return monitor._id ? new ObjectID(monitor._id) : null;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return id !== null;
      });

    // The first affected monitor is the run's dedupe key for the next incident.
    const primaryMonitorId: ObjectID | undefined = monitorIds[0];

    /*
     * Investigation rules, when the project has any: only the incidents that
     * match one are investigated. Checked first - an incident outside every
     * rule is out whatever its severity.
     */
    const scope: InvestigationRuleScope =
      await InvestigationRules.getIncidentScope({ projectId, incident });

    if (!scope.isInScope) {
      return {
        investigate: false,
        notStartedCode: "no_investigation_rule_matched",
        notStartedDetails: { rulesChecked: scope.rulesChecked },
        reason: `none of the ${scope.rulesChecked} AI rules that investigate matched`,
        monitorId: primaryMonitorId,
      };
    }

    // One project read serves both the severity floor and the dedupe window.
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        incidentInvestigationMinimumSeverityId: true,
        incidentInvestigationDedupeWindowMinutes: true,
      },
      props: { isRoot: true },
    });

    /*
     * Severity floor. Only filters KNOWN-low-severity incidents: an incident
     * whose severity order cannot be determined passes, as does every
     * incident when no floor is configured.
     */
    const floorSeverity: IncidentSeverity | null = await this.getSeverityFloor(
      project?.incidentInvestigationMinimumSeverityId,
    );
    const floorOrder: number | undefined = floorSeverity?.order;
    const incidentOrder: number | undefined = incident.incidentSeverity?.order;

    if (
      floorOrder !== undefined &&
      incidentOrder !== undefined &&
      incidentOrder > floorOrder
    ) {
      return {
        investigate: false,
        notStartedCode: "severity_below_threshold",
        notStartedDetails: {
          severityName: incident.incidentSeverity?.name,
          minimumSeverityName: floorSeverity?.name,
        },
        reason: `severity order ${incidentOrder} is below the investigation floor (order ${floorOrder})`,
        monitorId: primaryMonitorId,
      };
    }

    /*
     * Per-monitor cooldown: off unless the project sets one, clamped to at
     * most a day (see AIWorkloadLimits). An incident affecting no monitor has
     * no dedupe key.
     */
    const dedupeWindowMinutes: number = AIWorkloadLimits.getCooldownInMinutes(
      project?.incidentInvestigationDedupeWindowMinutes,
    );

    if (monitorIds.length > 0 && dedupeWindowMinutes > 0) {
      const windowStart: Date =
        OneUptimeDate.getSomeMinutesAgo(dedupeWindowMinutes);

      const recentRunCount: number = (
        await AIRunService.countBy({
          query: {
            projectId,
            monitorId: QueryHelper.any(monitorIds),
            runType: AIRunType.Investigation,
            triggeredByIncidentId: QueryHelper.notNull(),
            triggeredByAlertId: QueryHelper.isNull(),
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
          reason: `a monitor affected by this incident was already investigated within the last ${dedupeWindowMinutes} minutes`,
          monitorId: primaryMonitorId,
        };
      }
    }

    return {
      investigate: true,
      reason: "passed severity and dedupe gates",
      monitorId: primaryMonitorId,
      ...(scope.waitMinutes && scope.waitMinutes > 0
        ? { waitMinutes: scope.waitMinutes, createdAt: incident.createdAt }
        : {}),
      ...(scope.llmProviderId ? { llmProviderId: scope.llmProviderId } : {}),
    };
  }

  /*
   * The severity `order` value that still qualifies for investigation (lower
   * order = higher severity; an incident qualifies when its order <= floor).
   * Returns null when no floor applies — which, unlike the alert lane, is the
   * default: no configured minimum means investigate everything.
   */
  private static async getSeverityFloor(
    minimumSeverityId: ObjectID | undefined,
  ): Promise<IncidentSeverity | null> {
    if (!minimumSeverityId) {
      return null;
    }

    const floorSeverity: IncidentSeverity | null =
      await IncidentSeverityService.findOneById({
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
   * Execute a claimed run: assemble incident context and hand it to the
   * engine. Called by AIInvestigationQueue after a successful claim.
   * Never throws — failures are handed to the queue's retry policy so a
   * claimed run is always finalized or requeued.
   */
  @CaptureSpan()
  public static async executeInvestigation(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    incidentId: ObjectID;
    attemptCount: number;
    /*
     * Set on the incident's follow-up check (IncidentFollowUpCheck): the
     * alert that opened on its linked infrastructure after the first
     * investigation.
     */
    followUpForAlertId?: ObjectID | undefined;
    /*
     * Set on an investigation an investigation rule made wait
     * (InvestigationRuleWait): the incident's auto remediation did not wait
     * for it, so it never releases remediation when it settles.
     */
    ruleWaitMinutes?: number | undefined;
  }): Promise<void> {
    const { aiRunId, projectId, incidentId, attemptCount } = data;
    const isFollowUp: boolean = Boolean(data.followUpForAlertId);
    // Remediation never waited for a follow-up check, nor for a waited run.
    const isRemediationReleased: boolean =
      isFollowUp || Boolean(data.ruleWaitMinutes && data.ruleWaitMinutes > 0);

    let contextSummary: string;
    let clusterStatuses: Array<KubernetesClusterAiAccessStatus> = [];
    let resourceStatuses: Array<ResourceAiAccessStatus> = [];
    // What the summary left out of the incident's text, for the run to say.
    const promptOmissions: AIPromptOmissions = PromptText.noOmissions();
    // What the starting context read, for the run's activity.
    const contextNotes: Array<AIRunEventResultSummary> = [];
    // A follow-up check's first line: why it was written.
    let reportLead: MarkdownText | undefined = undefined;
    try {
      const contextData: IncidentContextData =
        await IncidentAIContextBuilder.buildIncidentContext({
          incidentId,
          includeWorkspaceMessages: false,
        });

      /*
       * Recurrence memory: pull in past resolved incidents that share this
       * incident's monitors/labels so AI can recognise "I've seen this
       * before" and reference the prior fix.
       */
      const priorCasesContext: string =
        await AIMemory.getPriorSimilarIncidentsContext({
          projectId,
          currentIncidentId: incidentId,
          monitorNames: (contextData.incident.monitors || [])
            .map((m: { name?: string }) => {
              return m.name || "";
            })
            .filter(Boolean),
          labelNames: (contextData.incident.labels || [])
            .map((l: { name?: string }) => {
              return l.name || "";
            })
            .filter(Boolean),
        });

      contextSummary =
        this.buildIncidentSummary(contextData, promptOmissions) +
        priorCasesContext;

      /*
       * The infrastructure the incident is linked to - the hosts, container
       * hosts, clusters, databases and services its monitors watch - and the
       * alerts on it (issue #4786). Enrichment only: a read that fails
       * leaves the context as it was.
       */
      let linked: LinkedInfrastructure | null = null;

      try {
        linked = await LinkedInfrastructureContext.readForIncident({
          projectId,
          incidentId,
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
          `AI: could not read the linked infrastructure of incident ${incidentId.toString()}; investigating it without it: ${error}`,
        );
      }

      /*
       * The changes recorded before the incident - deploys, rollouts, config
       * changes, OneUptime's own fixes - and which of them its services'
       * telemetry makes suspects (RecentChangesContext). Enrichment only: a
       * read that fails leaves the context as it was.
       */
      try {
        const recentChanges: RecentChanges | null =
          await RecentChangesContext.read({
            projectId,
            subjectKind: "incident",
            subjectId: incidentId,
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
          `AI: could not read the recent changes of incident ${incidentId.toString()}; investigating it without them: ${error}`,
        );
      }

      /*
       * The security case that declared the incident, when one did: the
       * attack the outage may be the impact of, and OneUptime AI's triage
       * of it (SecurityCaseIncidentContext). Enrichment only.
       */
      try {
        contextSummary +=
          await SecurityCaseIncidentContext.buildContextSectionFor({
            projectId,
            incidentId,
          });
      } catch (error) {
        logger.error(
          `AI: could not read the security case behind incident ${incidentId.toString()}; investigating it without it: ${error}`,
        );
      }

      /*
       * A follow-up check (issue #4787) leads with why it runs: the alert
       * that opened on the incident's infrastructure after the first
       * analysis. When that alert can no longer be read, it runs as a plain
       * investigation.
       */
      if (data.followUpForAlertId) {
        try {
          const followUp: FollowUpCheckContext | null =
            await IncidentFollowUpCheck.readContext({
              projectId,
              incidentId,
              alertId: data.followUpForAlertId,
            });

          if (followUp) {
            contextSummary = `${IncidentFollowUpCheck.buildContextSection(followUp)}\n${contextSummary}`;
            contextNotes.unshift(
              IncidentFollowUpCheck.buildActivityNote(followUp),
            );
            reportLead = IncidentFollowUpCheck.buildReportLead(followUp);
          }
        } catch (error) {
          logger.error(
            `AI: could not read why incident ${incidentId.toString()} is checked again; checking it as a plain investigation: ${error}`,
          );
        }
      }

      // Direct cluster access — enrichment only, never a prerequisite.
      try {
        clusterStatuses =
          await KubernetesClusterAiAccessService.getStatusesForSubject({
            projectId,
            incidentId,
          });
      } catch (error) {
        logger.error(
          `AI: could not resolve cluster access for incident ${incidentId.toString()}; investigating with OneUptime data only: ${error}`,
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
            incidentId,
          });
        const section: string =
          ResourceAccessContext.buildContextSection(statuses);

        resourceStatuses = statuses;
        contextSummary += section;
      } catch (error) {
        logger.error(
          `AI: could not resolve infrastructure access for incident ${incidentId.toString()}; investigating it with OneUptime data only: ${error}`,
        );
      }

      /*
       * The optics of the network devices the incident's monitors watch:
       * still detected or not, readings against the device's thresholds,
       * and received power over the last weeks. Enrichment only.
       */
      try {
        contextSummary += await NetworkTransceiverContext.buildContextSection({
          projectId,
          monitorIds: (contextData.incident.monitors || [])
            .map((monitor: { id?: ObjectID | null }) => {
              return monitor.id;
            })
            .filter(
              (
                monitorId: ObjectID | null | undefined,
              ): monitorId is ObjectID => {
                return Boolean(monitorId);
              },
            ),
          focusText: `${contextData.incident.title || ""}\n${contextData.incident.rootCause || ""}`,
          seriesLabels: contextData.incident.seriesLabels,
        });
      } catch (error) {
        logger.error(
          `AI: could not read transceivers for incident ${incidentId.toString()}; investigating it without them: ${error}`,
        );
      }
    } catch (error) {
      /*
       * Context assembly failed — the run is claimed, so hand it to the
       * retry policy rather than leaving it Running until the sweeper. When
       * this failure FINALIZED the run (retries exhausted), the incident is
       * terminally settled here and must still be released to
       * auto-remediation (RCA-first ordering).
       */
      const outcome: "requeued" | "finalized" | "noop" =
        await AIInvestigationQueue.failOrRequeue({
          aiRunId,
          attemptCount,
          errorMessage: `Failed to build incident context: ${
            error instanceof Error ? error.message : String(error)
          }`,
          isPermanent: false,
        });

      /*
       * A follow-up check never releases remediation: the first run did. A
       * waited run neither: remediation started when the incident did.
       */
      if (outcome === "finalized" && !isRemediationReleased) {
        await RemediationHandoff.runForSettledInvestigation({
          projectId,
          incidentId,
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
      await AIInvestigationEngine.getRunLimitsForProject(projectId, "Incident");
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
        `AI: could not offer infrastructure access for incident ${incidentId.toString()}; investigating it with OneUptime data only: ${error}`,
      );
    }

    /*
     * The project's external MCP servers the investigation rules allow for
     * this incident - their tools that read only. Built on their own: a
     * failure leaves the run with every other tool (null).
     */
    const mcpToolkit: McpRunToolkit | null =
      await McpInvestigationTools.forIncident({
        projectId,
        incidentId,
        aiRunId,
        outputPager,
        runDeadlineAtMs,
      });

    if (mcpToolkit) {
      extraTools.push(...mcpToolkit.buildTools());
    }

    /*
     * The code repositories the investigation rules allow for this incident:
     * its code tools read only those (every connected one with no rule, or a
     * matching rule that names none).
     */
    const codeRepositoryAllowance: CodeRepositoryAllowance =
      await InvestigationCodeRepositories.forIncident({
        projectId,
        incidentId,
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
        incidentId,
        attemptCount,
        isFollowUp,
        isRemediationReleased,
        contextSummary,
        promptOmissions,
        contextNotes,
        reportLead,
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
    incidentId: ObjectID;
    attemptCount: number;
    isFollowUp: boolean;
    // Nothing to release when it settles: a follow-up check, or a waited run.
    isRemediationReleased: boolean;
    contextSummary: string;
    promptOmissions: AIPromptOmissions;
    contextNotes: Array<AIRunEventResultSummary>;
    reportLead: MarkdownText | undefined;
    runLimits: AIAgentRunLimits;
    additionalInstructions: Array<string>;
    extraTools: Array<ObservabilityAssistantExtraTool>;
    codeRepositoryAllowance: CodeRepositoryAllowance;
  }): Promise<void> {
    const {
      aiRunId,
      projectId,
      incidentId,
      attemptCount,
      isFollowUp,
      isRemediationReleased,
      contextSummary,
      promptOmissions,
      contextNotes,
      reportLead,
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
        feature: AI_INCIDENT_INVESTIGATION_FEATURE,
        incidentId,
        contextSummary,
        promptOmissions,
        ...(contextNotes.length > 0 ? { contextNotes } : {}),
        ...(reportLead ? { reportLead } : {}),
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
          await IncidentFeedService.createIncidentFeedItem({
            incidentId,
            projectId,
            aiRunId,
            incidentFeedEventType: IncidentFeedEventType.RootCause,
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
              /*
               * The incident's second analysis: its notification says why
               * it was written - "🧠 AI — Automated Root Cause Analysis:
               * Checked again after alert #12 opened on Host web-1, ..." -
               * where the heading alone would read like the first one again.
               */
              ...(reportLead
                ? {
                    notificationText: WorkspaceNotificationText.fromMarkdown(
                      postData.analysisMarkdown,
                      { isFirstParagraphAHeadline: true },
                    ),
                  }
                : {}),
            },
          });

          /*
           * Also file the RCA as an incident internal note, where responders
           * collaborate. The RootCause feed item above, with its quiet-mode
           * gating, must stay the single notification source, so:
           * ignoreHooks skips the note service's "posted private note" feed
           * item + unconditional workspace ping (workflow triggers and
           * realtime updates still fire), and isOwnerNotified stops the
           * note-posted owner-notification cron from paging owners about it.
           * Best-effort: a note failure must not fail the run after the feed
           * item already posted.
           */
          try {
            const note: IncidentInternalNote = new IncidentInternalNote();
            note.incidentId = incidentId;
            note.projectId = projectId;
            note.note = postData.analysisMarkdown;
            note.isOwnerNotified = true;

            await IncidentInternalNoteService.create({
              data: note,
              props: { isRoot: true, ignoreHooks: true },
            });
          } catch (error) {
            logger.error(
              `AI: failed to post RCA internal note for incident ${incidentId.toString()}: ${error}`,
            );
          }

          /*
           * Measurement layer: record the time-to-rca metric (seconds from
           * incident creation to this analysis post, with the same base
           * attribute shape as every other incident metric). Best-effort —
           * metrics must never break the RCA post. A follow-up check is not
           * the first analysis, so it records none.
           */
          if (!isFollowUp) {
            try {
              await IncidentService.recordTimeToRootCausePostedMetric({
                incidentId,
              });
            } catch (error) {
              logger.error(
                `AI: failed to record time-to-rca metric for incident ${incidentId.toString()}: ${error}`,
              );
            }
          }

          /*
           * Inconclusive means the telemetry was insufficient — while "Fix
           * new incidents automatically" is on and the auto remediation
           * rules have telemetry pull requests on for this incident (on with
           * no rule; Types/AI/AutomaticFixPullRequests), queue an
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
                incidentId,
              },
            );
          }
        },
        /*
         * The engine calls this only after it atomically persists Recommended
         * with the exact posted analysis snapshot. That durable decision is
         * the prerequisite for the optional automatic FixFromIncident task;
         * the trigger then applies the incident lane's fixing switch and its
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
              incidentId,
            },
          );
        },
        /*
         * RCA-first ordering: auto-remediation for this incident was
         * deferred at creation because this investigation was enqueued —
         * release it now that the run has settled (any terminal outcome).
         * A follow-up check releases nothing (the first run did), and is
         * itself never followed up. A run an investigation rule made wait
         * releases nothing either: remediation did not wait for it.
         *
         * Then, when an alert opened on the incident's infrastructure while
         * this run was reading it, check the incident again with that alert
         * (IncidentFollowUpCheck; once per incident, and never a loop).
         */
        onSettled: async (): Promise<void> => {
          if (isFollowUp) {
            return;
          }

          if (!isRemediationReleased) {
            await RemediationHandoff.runForSettledInvestigation({
              projectId,
              incidentId,
            });
          }

          await IncidentFollowUpCheck.onInvestigationSettled({
            projectId,
            incidentId,
            aiRunId,
          });
        },
      },
    });
  }

  /*
   * Build a compact incident record to seed the investigation. It is sent
   * with every call to the model, so each free-text field goes in through
   * PromptText.field: embedded images left out, held to a length, and what
   * was left out added to `omissions`.
   */
  public static buildIncidentSummary(
    contextData: IncidentContextData,
    omissions?: AIPromptOmissions | undefined,
  ): string {
    const { incident, internalNotes } = contextData;

    const lines: Array<string> = [];
    lines.push("# Incident");
    lines.push(`Title: ${incident.title || "N/A"}`);

    if (incident.description) {
      lines.push(
        `Description: ${PromptText.field(incident.description, { omissions })}`,
      );
    }

    lines.push(`Severity: ${incident.incidentSeverity?.name || "N/A"}`);
    lines.push(
      `Current state: ${incident.currentIncidentState?.name || "N/A"}`,
    );
    lines.push(
      `Declared at: ${
        incident.createdAt
          ? OneUptimeDate.getDateAsFormattedString(incident.createdAt)
          : "N/A"
      }`,
    );

    if (incident.monitors && incident.monitors.length > 0) {
      lines.push(
        `Affected monitors: ${incident.monitors
          .map((m: { name?: string }) => {
            return m.name;
          })
          .filter(Boolean)
          .join(", ")}`,
      );
    }

    if (incident.labels && incident.labels.length > 0) {
      lines.push(
        `Labels: ${incident.labels
          .map((l: { name?: string }) => {
            return l.name;
          })
          .filter(Boolean)
          .join(", ")}`,
      );
    }

    if (incident.rootCause) {
      lines.push(
        `Root cause (as recorded so far): ${PromptText.field(incident.rootCause, { omissions })}`,
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
