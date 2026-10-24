import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
  InvestigationGateDetails,
} from "../../../../Types/AI/InvestigationNotStartedReason";
import ObjectID from "../../../../Types/ObjectID";
import AIService, { AutonomousBudgetStatus } from "../../../Services/AIService";
import AlertService from "../../../Services/AlertService";
import IncidentService from "../../../Services/IncidentService";
import logger from "../../Logger";
import AIInvestigationEngine from "./AIInvestigationEngine";
import AIAlertInvestigationRunner from "./AlertInvestigationRunner";
import AIIncidentInvestigationRunner from "./IncidentInvestigationRunner";
import InvestigationRules from "./InvestigationRules";

export interface InvestigationSubject {
  projectId: ObjectID;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
}

export default class InvestigationEligibility {
  public static reason(
    code: InvestigationNotStartedCode,
    subject: InvestigationSubject,
    budget?: AutonomousBudgetStatus,
    details?: InvestigationGateDetails,
  ): InvestigationNotStartedReason {
    return this.buildReason("recorded", code, subject, budget, details);
  }

  private static buildReason(
    source: "recorded" | "current_configuration",
    code: InvestigationNotStartedCode,
    subject: InvestigationSubject,
    budget?: AutonomousBudgetStatus,
    details?: InvestigationGateDetails,
  ): InvestigationNotStartedReason {
    const kind: string = subject.alertId ? "alert" : "incident";
    const recorded: boolean = source === "recorded";
    /*
     * A decision recorded when an investigation rule's wait ended (issue
     * #5074) rather than when the record was created: its words say so.
     */
    const waitMinutes: number | undefined =
      details?.waitMinutes && details.waitMinutes > 0
        ? details.waitMinutes
        : undefined;
    const isAfterWait: boolean = recorded && waitMinutes !== undefined;
    // " 10 minutes", " 1 minute", or nothing without a wait.
    const waitDuration: string = waitMinutes
      ? ` ${waitMinutes} ${waitMinutes === 1 ? "minute" : "minutes"}`
      : "";
    // "at creation", or "when the wait ended".
    const atDecision: string = isAfterWait
      ? "when the wait ended"
      : "at creation";
    // "when this incident was created", or "when this incident's 10-minute wait ended".
    const whenDecided: string = isAfterWait
      ? `when this ${kind}'s ${waitMinutes}-minute wait ended`
      : `when this ${kind} was created`;
    const whenDecidedAtStart: string = isAfterWait
      ? `When this ${kind}'s ${waitMinutes}-minute wait ended`
      : `When this ${kind} was created`;
    const cooldownWindow: string =
      details?.cooldownWindowMinutes !== undefined
        ? `${details.cooldownWindowMinutes}-minute`
        : "configured";
    const reasons: Record<
      InvestigationNotStartedCode,
      { title: string; description: string; nextStep: string }
    > = {
      ai_disabled: {
        title: recorded
          ? `Project AI was turned off ${atDecision}`
          : "Project AI is currently turned off",
        description: recorded
          ? `AI was disabled for this project ${whenDecided}, so its automatic investigation did not start.`
          : "AI is currently disabled for this project, so new automatic investigations cannot start.",
        nextStep: recorded
          ? "Review project AI settings (Project Settings → AI → AI Features) for new records. Existing records are not automatically retried when AI is enabled."
          : "Turn on Enable AI (Project Settings → AI → AI Features) and automatic investigations to investigate new records. Existing records are not automatically retried.",
      },
      automatic_investigation_disabled: {
        title: recorded
          ? `Automatic ${kind} investigation was off ${atDecision}`
          : `Automatic ${kind} investigation is currently turned off`,
        description: `${recorded ? `Automatic investigation was not enabled for ${kind}s ${whenDecided}.` : `Automatic investigation is not currently enabled for ${kind}s.`} Alerts and incidents have separate investigation settings.`,
        nextStep: recorded
          ? `Review automatic ${kind} investigation settings for new ${kind}s. Enabling investigation later does not automatically retry this ${kind}.`
          : `Enable automatic ${kind} investigation for new ${kind}s. Existing records are not automatically retried.`,
      },
      provider_missing: {
        title: recorded
          ? `No AI provider was available ${atDecision}`
          : "No AI provider is currently available",
        description: recorded
          ? `Automatic investigation was enabled ${whenDecided}, but no configured AI provider was available to run it.`
          : "Automatic investigation is currently enabled, but this project has no configured AI provider available to run new investigations.",
        nextStep: recorded
          ? "Review the AI provider configuration for new investigations. Configuring a provider later does not automatically retry existing records."
          : "Configure an AI provider in project settings. New eligible records can then be investigated; existing records are not automatically retried.",
      },
      insufficient_ai_balance: {
        title: recorded
          ? `The project was out of AI credits ${atDecision}`
          : "The project is currently out of AI credits",
        description: recorded
          ? `This project had no AI credits left ${whenDecided}, so its automatic investigation did not start.`
          : "This project is currently out of AI credits, so new automatic investigations cannot start.",
        /*
         * Where the credits are, and what adding them does - not who: the
         * dashboard offers the AI Credits link to those who may add them
         * and names who can to everyone else (InvestigationNotStarted), so
         * nobody is told to add credits they cannot. Not "turn on
         * auto-recharge": the reason is only recorded when Auto Recharge
         * cannot refill the credits (it is off, or its last charge failed).
         */
        nextStep: recorded
          ? `Review AI credits under Project Settings → AI → AI Credits. Adding credits later does not retry this ${kind}.`
          : `New ${kind}s can be investigated once AI credits are added under Project Settings → AI → AI Credits. Existing records are not automatically retried.`,
      },
      project_daily_limit_reached: {
        title: recorded
          ? `The project's daily AI limit had been reached ${atDecision}`
          : "The project's daily AI limit is currently reached",
        description: recorded
          ? `This project had reached one of its own daily AI limits ${whenDecided}, so its automatic investigation did not start.`
          : "This project has reached one of its own daily AI limits today, so new automatic investigations cannot start.",
        /*
         * A recorded skip is taken back once the limit no longer stops AI
         * (InvestigationLimitCatchUp): after the reset, or as soon as the
         * limit is raised or removed, while the record is still open.
         */
        nextStep: recorded
          ? `OneUptime AI investigates this ${kind} after the limit resets at midnight UTC, if it is still open then, or as soon as the limit is raised or removed under Project Settings → AI → AI Features → More settings.`
          : "Raise or remove the limit under Project Settings → AI → AI Features → More settings, or wait for midnight UTC, when usage resets. Existing records are not automatically retried.",
      },
      severity_below_threshold: {
        title: recorded
          ? `Severity was below the investigation threshold ${atDecision}`
          : "Severity is below the current investigation threshold",
        description: `${recorded ? `${whenDecidedAtStart}, its` : `This ${kind}'s`}${details?.severityName ? ` ${details.severityName}` : ""} severity ${recorded ? "did not meet" : "does not meet"} ${details?.minimumSeverityName ? `the minimum ${details.minimumSeverityName} investigation severity` : "the configured investigation threshold"}.`,
        nextStep:
          "Review the minimum investigation severity in AI settings. Changes apply to new records and do not retry this record.",
      },
      monitor_cooldown: {
        title: recorded
          ? "Skipped during the monitor cooldown"
          : "A monitor is currently within its investigation cooldown",
        description: recorded
          ? `Another ${kind} investigation was already queued or started for an affected monitor within the ${cooldownWindow} investigation cooldown window. This repeat ${kind} did not start another investigation.`
          : `An investigation for an affected monitor was queued or started within the current ${cooldownWindow} cooldown window, which prevents another automatic ${kind} investigation right now.`,
        nextStep:
          "Review recent investigations for the affected monitor, or adjust the investigation cooldown for new records. An earlier run may still be queued, running, or may have failed.",
      },
      /*
       * The AI rules that investigate (Types/AI/AiRule): the code kept the
       * name investigation rules had, so records written before they became
       * AI rules read the same way.
       */
      no_investigation_rule_matched: {
        title: recorded
          ? `This ${kind} was outside the AI rules that investigate ${atDecision}`
          : `This ${kind} is currently outside the AI rules that investigate`,
        /*
         * After a wait the record matched a rule when it was created - the
         * rule that made it wait - so what changed is said instead.
         */
        description: isAfterWait
          ? `An AI rule made OneUptime AI wait${waitDuration} before investigating this ${kind}, and when the wait ended it matched none of ${details?.rulesChecked ? `the ${details.rulesChecked} AI ${details.rulesChecked === 1 ? "rule that investigates" : "rules that investigate"}` : "the AI rules that investigate"} any more: the ${kind} or the rules had changed. Only the ${kind}s that match one are investigated automatically.`
          : `${recorded ? `When this ${kind} was created, AI rules that investigate were set up for ${kind}s, and it` : `AI rules that investigate are set up for ${kind}s, and this ${kind}`} ${recorded ? "matched" : "matches"} none of ${details?.rulesChecked ? `the ${details.rulesChecked} ${details.rulesChecked === 1 ? "rule" : "rules"}` : "them"}. Only the ${kind}s that match one are investigated automatically.`,
        nextStep: recorded
          ? `Review the AI rules under ${kind === "alert" ? "Alerts" : "Incidents"} → AI → Settings → More settings. Changing them does not retry this ${kind}; to look into it anyway, ask OneUptime AI below.`
          : `Review the AI rules under ${kind === "alert" ? "Alerts" : "Incidents"} → AI → Settings → More settings. Existing records are not automatically retried.`,
      },
      created_resolved: {
        title: `This ${kind} was created already resolved`,
        description: `It was already resolved when it was created, so OneUptime AI did not investigate it automatically.`,
        nextStep: "To look into it anyway, ask OneUptime AI below.",
      },
      /*
       * Only ever recorded when a rule's wait ends (InvestigationRuleWait):
       * "resolved before the investigation started" also holds when the
       * record was still open as the wait ended and resolved before the
       * next check reached it. Told as what happened - the rule may have
       * changed since - and why it waited.
       */
      resolved_before_investigation: {
        title: "Resolved before the investigation started",
        description: `An AI rule made OneUptime AI wait${waitDuration} to see whether this ${kind} would still be open. It was resolved first, so it was not investigated.`,
        nextStep: `To look into it anyway, ask OneUptime AI below. The wait is set on the AI rules under ${kind === "alert" ? "Alerts" : "Incidents"} → AI → Settings → More settings.`,
      },
      daily_budget_exhausted: {
        title:
          budget?.limitInTokens === 0
            ? recorded
              ? "Automatic investigation was paused by its token limit"
              : "Automatic investigation is currently paused by its token limit"
            : recorded
              ? "Daily AI token budget had been reached"
              : "Daily AI token budget is currently exhausted",
        description: budget
          ? `AI work for ${kind}s ${recorded ? "had used" : "has used"} ${budget.usedTokensToday.toLocaleString("en-US")} of its ${budget.limitInTokens?.toLocaleString("en-US")} token daily allowance ${recorded ? `when checked ${isAfterWait ? "as its wait ended" : "at creation"}. No investigation was queued.` : "today. The current allowance does not permit a new investigation."}`
          : `The daily autonomous token allowance for ${kind}s ${recorded ? `had been reached ${isAfterWait ? "when this record's wait ended" : "when this record was created"}, so no investigation was queued.` : "is currently exhausted, so new investigations cannot start."}`,
        nextStep:
          "Review the daily token limit in AI settings. Usage resets at midnight UTC; skipped records are not automatically retried after the reset.",
      },
      budget_check_failed: {
        title: recorded
          ? "The AI budget could not be checked"
          : "The current AI budget cannot be checked",
        description: recorded
          ? "The system could not verify the available AI budget. It did not queue an investigation to avoid exceeding the configured spending limit."
          : "The available AI budget cannot currently be verified, so eligibility for a new investigation cannot be confirmed.",
        nextStep:
          "Ask a project administrator to check service health and AI settings. This record was not queued for automatic retry.",
      },
      enqueue_failed: {
        title: recorded
          ? "The investigation could not be queued"
          : "Investigation queue availability could not be verified",
        description: recorded
          ? "The system could not save an investigation to the queue, so no investigation started for this record."
          : "The service could not confirm whether a new investigation can currently be saved to the queue.",
        nextStep:
          "Ask a project administrator to check service health and server logs. This record was not queued for automatic retry.",
      },
      eligibility_check_failed: {
        title: recorded
          ? "Investigation eligibility could not be verified"
          : "Current investigation eligibility cannot be verified",
        description: recorded
          ? "The system could not complete the checks required to start an automatic investigation."
          : "The current checks required to start an automatic investigation could not be completed.",
        nextStep:
          "Ask a project administrator to check service health and AI settings. No automatic retry is scheduled for this record.",
      },
      no_run_recorded: {
        title: "No investigation was recorded",
        description: `This ${kind} passes the current automatic investigation checks, but no investigation or original skip decision was found. Settings may have changed since it was created, or automatic investigation may not have started when this record was created.`,
        nextStep:
          "Automatic investigations are triggered when a record is created. Enabling investigation later does not backfill existing records; check the AI logs and service health if new eligible records are also missing investigations.",
      },
    };
    return {
      code,
      ...reasons[code],
      description: recorded
        ? reasons[code].description
        : `${reasons[code].description} These are the current conditions; the original decision was not recorded, so they do not confirm why this record was skipped at creation.`,
      source,
      evaluatedAt: new Date().toISOString(),
      ...(isAfterWait ? { decidedAfterWaitMinutes: waitMinutes } : {}),
    };
  }

  /** Best effort, without overriding the first decision or failing creation. */
  public static async recordSkipped(
    subject: InvestigationSubject,
    code: InvestigationNotStartedCode,
    budget?: AutonomousBudgetStatus,
    details?: InvestigationGateDetails,
  ): Promise<void> {
    try {
      const decision: InvestigationNotStartedReason = this.reason(
        code,
        subject,
        budget,
        details,
      );
      if (subject.alertId) {
        await AlertService.updateColumnsByIdWithoutHooks({
          id: subject.alertId,
          data: { aiInvestigationDecision: decision },
          expectedData: {
            projectId: subject.projectId,
            aiInvestigationDecision: null,
          },
          skipUpdateDateColumn: true,
        });
      } else if (subject.incidentId) {
        await IncidentService.updateColumnsByIdWithoutHooks({
          id: subject.incidentId,
          data: { aiInvestigationDecision: decision },
          expectedData: {
            projectId: subject.projectId,
            aiInvestigationDecision: null,
          },
          skipUpdateDateColumn: true,
        });
      }
    } catch (error) {
      logger.error(`AI: could not record investigation decision: ${error}`);
    }
  }

  /** Read-only; the caller must first authorize access to the subject. */
  public static async getNotStartedReason(
    subject: InvestigationSubject,
  ): Promise<InvestigationNotStartedReason> {
    try {
      const row: Alert | Incident | null = subject.alertId
        ? await AlertService.findOneBy({
            query: {
              _id: subject.alertId.toString(),
              projectId: subject.projectId,
            },
            select: { aiInvestigationDecision: true },
            props: { isRoot: true },
          })
        : await IncidentService.findOneBy({
            query: {
              _id: subject.incidentId!.toString(),
              projectId: subject.projectId,
            },
            select: { aiInvestigationDecision: true },
            props: { isRoot: true },
          });
      if (row?.aiInvestigationDecision) {
        return row.aiInvestigationDecision;
      }

      const disabled: InvestigationNotStartedCode | null =
        await AIInvestigationEngine.getDisabledReasonForSubject({
          projectId: subject.projectId,
          subjectType: subject.alertId ? "Alert" : "Incident",
          getRuleLlmProviderId: async (): Promise<ObjectID | undefined> => {
            return await InvestigationRules.getSubjectLlmProviderId({
              projectId: subject.projectId,
              incidentId: subject.incidentId,
              alertId: subject.alertId,
            });
          },
        });
      if (disabled) {
        return this.currentReason(disabled, subject);
      }

      const gate: {
        investigate: boolean;
        notStartedCode?: InvestigationNotStartedCode | undefined;
        notStartedDetails?: InvestigationGateDetails | undefined;
      } = subject.alertId
        ? await AIAlertInvestigationRunner.shouldInvestigateAlert({
            projectId: subject.projectId,
            alertId: subject.alertId,
          })
        : await AIIncidentInvestigationRunner.shouldInvestigateIncident({
            projectId: subject.projectId,
            incidentId: subject.incidentId!,
          });
      if (!gate.investigate) {
        return this.currentReason(
          gate.notStartedCode || "eligibility_check_failed",
          subject,
          undefined,
          gate.notStartedDetails,
        );
      }

      const budget: AutonomousBudgetStatus =
        await AIService.getAutonomousDailyBudgetStatus(subject.projectId, {
          incidentId: subject.incidentId,
          alertId: subject.alertId,
        });
      if (budget.exhausted) {
        return this.currentReason("daily_budget_exhausted", subject, budget);
      }
      return { ...this.reason("no_run_recorded", subject), source: "unknown" };
    } catch (error) {
      logger.error(`AI: could not explain missing investigation: ${error}`);
      return {
        ...this.reason("eligibility_check_failed", subject),
        description:
          "No investigation was found. The original decision or current eligibility checks could not be loaded.",
        source: "unknown",
      };
    }
  }

  private static currentReason(
    code: InvestigationNotStartedCode,
    subject: InvestigationSubject,
    budget?: AutonomousBudgetStatus,
    details?: InvestigationGateDetails,
  ): InvestigationNotStartedReason {
    return this.buildReason(
      "current_configuration",
      code,
      subject,
      budget,
      details,
    );
  }
}
