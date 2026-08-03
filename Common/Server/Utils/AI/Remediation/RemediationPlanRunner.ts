import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import { AlertFeedEventType } from "../../../../Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import { Indigo500 } from "../../../../Types/BrandColors";
import AIRunService from "../../../Services/AIRunService";
import AlertFeedService from "../../../Services/AlertFeedService";
import AlertService from "../../../Services/AlertService";
import AutoRemediationRuleService from "../../../Services/AutoRemediationRuleService";
import AutoRemediationSuggestionService from "../../../Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import IncidentService from "../../../Services/IncidentService";
import RunbookService from "../../../Services/RunbookService";
import { AI_REMEDIATION_PLANNING_FEATURE } from "../../../Services/AIService";
import AIInvestigationEngine from "../SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../SRE/InvestigationQueue";
import { ConfidenceSignal } from "../SRE/ConfidenceSignal";
import { ObservabilityAssistantResult } from "../Chat/ObservabilityAssistant";
import ToolResultSerializer from "../Toolbox/Serializer";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Auto-remediation — the AI planning run.
 *
 * A matched AI auto-remediation rule created an AutoRemediationSuggestion in
 * status Planning and enqueued a RemediationPlan AIRun; this runner executes
 * it: read the incident/alert and the surrounding telemetry (the shared
 * engine's strictly read-only tool loop), then pick the most applicable
 * runbook from the rule's candidates — or none.
 *
 * The pick NEVER executes anything. It moves the suggestion to Suggested,
 * where a human approves it with one click (the approve API starts the
 * runbook under the approver's identity). Fail direction: anything
 * unparseable or uncertain becomes NoneApplicable — a malformed answer can
 * propose nothing, let alone run something.
 */

// Cap on how many candidate runbooks are offered to the model.
const MAX_CANDIDATE_RUNBOOKS: number = 50;

const REMEDIATION_PLANNING_FRAMING: string = `IMPORTANT — this is REMEDIATION PLANNING, not a root cause investigation. An auto-remediation rule matched the signal below, and your ONLY job is to decide which of the pre-authored candidate runbooks (listed below with their ids) is the most applicable remediation — or that none of them applies.

- Use your read tools briefly to understand what is actually wrong before choosing (the runbook must address the failure, not just match its name).
- Candidate runbooks were written by this project's own engineers; judge applicability by what the runbook is for versus what the telemetry shows.
- Recommend at most ONE runbook.
- Your choice gates automation: the selected runbook will be PROPOSED to a human for one-click execution — it is never executed automatically. Still choose conservatively: proposing a wrong runbook wastes responder time. When torn between a runbook and none, pick none.

SELECTION — you MUST end your analysis with one line in EXACTLY this format, on its own line, with nothing after it:
SelectedRunbook: <id>
where <id> is the exact id of one candidate runbook from the list below, or the word none.`;

export default class RemediationPlanRunner {
  /*
   * Execute a claimed RemediationPlan run. Called by AIInvestigationQueue
   * after a successful CAS claim. Never throws — failures are handed to the
   * queue's retry policy so a claimed run is always finalized or requeued.
   */
  @CaptureSpan()
  public static async executePlan(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    suggestionId: ObjectID;
    attemptCount: number;
  }): Promise<void> {
    const { aiRunId, projectId, suggestionId, attemptCount } = data;

    let suggestion: AutoRemediationSuggestion | null = null;
    let candidates: Array<Runbook> = [];
    let contextSummary: string;

    try {
      suggestion = await AutoRemediationSuggestionService.findOneById({
        id: suggestionId,
        select: {
          _id: true,
          projectId: true,
          status: true,
          incidentId: true,
          alertId: true,
          autoRemediationRuleId: true,
          ruleNameSnapshot: true,
        },
        props: { isRoot: true },
      });

      if (!suggestion) {
        await this.finalizeRunAsError(
          aiRunId,
          "Auto-remediation suggestion not found — it may have been deleted after the plan was enqueued.",
        );
        return;
      }

      // Tenancy re-check: the subject id on the run row must match the run's
      // project (belongsToProject pattern).
      if (suggestion.projectId?.toString() !== projectId.toString()) {
        await this.finalizeRunAsError(
          aiRunId,
          "Auto-remediation suggestion does not belong to this run's project.",
        );
        return;
      }

      if (suggestion.status !== AutoRemediationSuggestionStatus.Planning) {
        /*
         * A previous attempt already finished the plan (or the suggestion
         * was otherwise moved on). Retried attempts must be idempotent —
         * complete quietly without writing anything.
         */
        await AIRunService.attemptStatusTransition({
          aiRunId,
          fromStatus: AIRunStatus.Running,
          set: {
            status: AIRunStatus.Completed,
            completedAt: OneUptimeDate.getCurrentDate(),
          },
        });
        return;
      }

      candidates = await this.loadCandidateRunbooks({
        projectId,
        ruleId: suggestion.autoRemediationRuleId,
      });

      if (candidates.length === 0) {
        await this.settleSuggestion({
          suggestion,
          runbook: null,
          rationaleMarkdown:
            "No enabled runbooks were available to choose from — attach candidate runbooks to the rule or create enabled runbooks in this project.",
        });
        await AIRunService.attemptStatusTransition({
          aiRunId,
          fromStatus: AIRunStatus.Running,
          set: {
            status: AIRunStatus.Completed,
            completedAt: OneUptimeDate.getCurrentDate(),
          },
        });
        return;
      }

      contextSummary = await this.buildPlanningContext({
        suggestion,
        candidates,
      });
    } catch (error) {
      // Context assembly failed — hand the claimed run to the retry policy.
      await AIInvestigationQueue.failOrRequeue({
        aiRunId,
        attemptCount,
        errorMessage: `Failed to build remediation planning context: ${
          error instanceof Error ? error.message : String(error)
        }`,
        isPermanent: false,
      });
      return;
    }

    const candidateIds: Set<string> = new Set<string>(
      candidates.map((runbook: Runbook) => {
        return runbook.id?.toString() || "";
      }),
    );

    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId,
      attemptCount,
      request: {
        feature: AI_REMEDIATION_PLANNING_FEATURE,
        contextSummary,
        postAnalysis: async (postData: {
          analysisMarkdown: string;
          confidence: ConfidenceSignal;
          result: ObservabilityAssistantResult;
        }): Promise<void> => {
          const selectedId: string | null = this.parseSelectedRunbook(
            postData.analysisMarkdown,
            candidateIds,
          );

          const selectedRunbook: Runbook | null = selectedId
            ? candidates.find((runbook: Runbook) => {
                return runbook.id?.toString() === selectedId;
              }) || null
            : null;

          await this.settleSuggestion({
            suggestion: suggestion!,
            runbook: selectedRunbook,
            rationaleMarkdown: postData.analysisMarkdown,
          });
        },
      },
    });
  }

  /*
   * Parse the mandatory trailing "SelectedRunbook: <id>" line. The LAST
   * match wins (the model may discuss candidates earlier). The parsed id is
   * validated against the candidate set — an id the model invented, or
   * anything unparseable, fails closed to none.
   */
  public static parseSelectedRunbook(
    analysisMarkdown: string,
    candidateIds: Set<string>,
  ): string | null {
    const matches: Array<RegExpMatchArray> = Array.from(
      (analysisMarkdown || "").matchAll(
        /^\s*\**\s*selectedrunbook\s*\**\s*[:=]\s*\**\s*([a-z0-9-]{8,64}|none)\b/gim,
      ),
    );

    const last: RegExpMatchArray | undefined = matches[matches.length - 1];

    if (!last || !last[1]) {
      return null;
    }

    const value: string = last[1].toLowerCase();

    if (value === "none") {
      return null;
    }

    if (!candidateIds.has(value)) {
      logger.warn(
        `RemediationPlanRunner: model selected runbook ${value} which is not in the candidate set; treating as none.`,
      );
      return null;
    }

    return value;
  }

  /*
   * Move the Planning suggestion to Suggested (runbook picked) or
   * NoneApplicable, via the CAS transition so a racing second attempt or a
   * concurrent human action can never be clobbered. Posts the feed item
   * only when this call won the transition.
   */
  private static async settleSuggestion(data: {
    suggestion: AutoRemediationSuggestion;
    runbook: Runbook | null;
    rationaleMarkdown: string;
  }): Promise<void> {
    const { suggestion, runbook } = data;

    const transitioned: number =
      await AutoRemediationSuggestionService.attemptStatusTransition({
        suggestionId: suggestion.id!,
        fromStatus: AutoRemediationSuggestionStatus.Planning,
        set: runbook
          ? {
              status: AutoRemediationSuggestionStatus.Suggested,
              runbookId: runbook.id!.toString(),
              runbookNameSnapshot: runbook.name || "Runbook",
              rationaleMarkdown: data.rationaleMarkdown,
            }
          : {
              status: AutoRemediationSuggestionStatus.NoneApplicable,
              rationaleMarkdown: data.rationaleMarkdown,
            },
      });

    if (transitioned === 0) {
      logger.warn(
        `RemediationPlanRunner: suggestion ${suggestion.id?.toString()} was no longer Planning; skipping settle to avoid clobbering a concurrent actor.`,
      );
      return;
    }

    const ruleName: string =
      suggestion.ruleNameSnapshot || "Auto Remediation Rule";

    const markdown: string = runbook
      ? `⚡ **Auto Remediation Rule "${ruleName}": AI proposed runbook "${runbook.name}".** Review the reasoning and approve it with one click to start remediation.`
      : `⚡ **Auto Remediation Rule "${ruleName}": AI evaluated the candidate runbooks and none applies.** No remediation was proposed.`;

    await this.postFeedItem({
      suggestion,
      markdown,
      pingWorkspace: runbook !== null,
    });
  }

  /*
   * Candidates: the rule's attached runbooks when any are attached (and
   * still enabled), otherwise every enabled runbook in the project.
   */
  private static async loadCandidateRunbooks(data: {
    projectId: ObjectID;
    ruleId: ObjectID | undefined;
  }): Promise<Array<Runbook>> {
    let attachedIds: Array<string> = [];

    if (data.ruleId) {
      const rule: AutoRemediationRule | null =
        await AutoRemediationRuleService.findOneById({
          id: data.ruleId,
          select: {
            _id: true,
            runbooks: { _id: true },
          },
          props: { isRoot: true },
        });

      attachedIds = (rule?.runbooks || [])
        .map((runbook: Runbook) => {
          return runbook.id?.toString() || "";
        })
        .filter((id: string) => {
          return id !== "";
        });
    }

    const allEnabled: Array<Runbook> = await RunbookService.findBy({
      query: {
        projectId: data.projectId,
        isEnabled: true,
      },
      select: {
        _id: true,
        name: true,
        description: true,
      },
      limit: MAX_CANDIDATE_RUNBOOKS,
      skip: 0,
      props: { isRoot: true },
    });

    if (attachedIds.length === 0) {
      return allEnabled;
    }

    return allEnabled.filter((runbook: Runbook) => {
      return attachedIds.includes(runbook.id?.toString() || "");
    });
  }

  // Build the compact planning brief that seeds the run.
  private static async buildPlanningContext(data: {
    suggestion: AutoRemediationSuggestion;
    candidates: Array<Runbook>;
  }): Promise<string> {
    const lines: Array<string> = [];

    lines.push(REMEDIATION_PLANNING_FRAMING);
    lines.push("");

    if (data.suggestion.incidentId) {
      const incident: Incident | null = await IncidentService.findOneById({
        id: data.suggestion.incidentId,
        select: {
          _id: true,
          title: true,
          description: true,
          incidentNumber: true,
        },
        props: { isRoot: true },
      });

      lines.push("# The signal");
      lines.push(
        `Incident ${incident?.incidentNumber ? `#${incident.incidentNumber}` : data.suggestion.incidentId.toString()}: ${incident?.title || "N/A"}`,
      );
      if (incident?.description) {
        lines.push(incident.description);
      }
    } else if (data.suggestion.alertId) {
      const alert: Alert | null = await AlertService.findOneById({
        id: data.suggestion.alertId,
        select: {
          _id: true,
          title: true,
          description: true,
          alertNumber: true,
        },
        props: { isRoot: true },
      });

      lines.push("# The signal");
      lines.push(
        `Alert ${alert?.alertNumber ? `#${alert.alertNumber}` : data.suggestion.alertId.toString()}: ${alert?.title || "N/A"}`,
      );
      if (alert?.description) {
        lines.push(alert.description);
      }
    }

    lines.push("");
    lines.push(
      `Matched auto-remediation rule: ${data.suggestion.ruleNameSnapshot || "N/A"}`,
    );

    lines.push("");
    lines.push("# Candidate runbooks");
    for (const runbook of data.candidates) {
      lines.push(
        `- id: ${runbook.id?.toString()} — "${runbook.name || "Unnamed"}"${
          runbook.description ? `: ${runbook.description}` : ""
        }`,
      );
    }

    /*
     * Incident/alert titles and descriptions can quote raw telemetry —
     * sweep secrets before the text reaches the LLM provider (same rule as
     * insight triage).
     */
    return ToolResultSerializer.redact(lines.join("\n")).text;
  }

  private static async postFeedItem(data: {
    suggestion: AutoRemediationSuggestion;
    markdown: string;
    pingWorkspace: boolean;
  }): Promise<void> {
    try {
      if (data.suggestion.incidentId && data.suggestion.projectId) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: data.suggestion.incidentId,
          projectId: data.suggestion.projectId,
          incidentFeedEventType: IncidentFeedEventType.AutoRemediation,
          displayColor: Indigo500,
          feedInfoInMarkdown: data.markdown,
          workspaceNotification: {
            sendWorkspaceNotification: data.pingWorkspace,
          },
        });
      } else if (data.suggestion.alertId && data.suggestion.projectId) {
        await AlertFeedService.createAlertFeedItem({
          alertId: data.suggestion.alertId,
          projectId: data.suggestion.projectId,
          alertFeedEventType: AlertFeedEventType.AutoRemediation,
          displayColor: Indigo500,
          feedInfoInMarkdown: data.markdown,
          workspaceNotification: {
            sendWorkspaceNotification: data.pingWorkspace,
          },
        });
      }
    } catch (error) {
      logger.error(
        `RemediationPlanRunner: failed to create feed item: ${error}`,
      );
    }
  }

  private static async finalizeRunAsError(
    aiRunId: ObjectID,
    errorMessage: string,
  ): Promise<void> {
    await AIRunService.attemptStatusTransition({
      aiRunId,
      fromStatus: AIRunStatus.Running,
      set: {
        status: AIRunStatus.Error,
        completedAt: OneUptimeDate.getCurrentDate(),
        errorMessage,
      },
    });
  }
}
