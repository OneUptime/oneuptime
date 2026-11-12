import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
  InvestigationGateDetails,
  InvestigationNotStartedFacts,
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
    /*
     * The settings and pages a reason names, by the names the Dashboard
     * draws (issue #6738): the record's AI card words every code itself
     * (InvestigationNotStartedWords) and links to the page, while API
     * readers and older Dashboards read the English below, which has no
     * link - so it names the page's path, and the setting as that page
     * titles it. InvestigationReasonCardParity holds the two to the same
     * setting and page for every code, kind and source.
     */
    const aiSettingsPage: string =
      kind === "alert" ? "Alerts → AI → Settings" : "Incidents → AI → Settings";
    const moreSettings: string = `${aiSettingsPage} → More settings`;
    // What OneUptime AI did for the record's kind, beside its settings.
    const aiLogsPage: string =
      kind === "alert" ? "Alerts → AI → Logs" : "Incidents → AI → Logs";
    // The record's own switch, as its AI settings page titles it.
    const investigateSwitch: string = `Investigate new ${kind}s`;
    // Its daily token limit, under that page's More settings.
    const tokenLimitName: string = `Daily ${kind === "alert" ? "Alert" : "Incident"} AI Token Limit`;
    // A limit of 0 or below pauses the work (getAutonomousDailyBudgetStatus).
    const limitInTokens: number | null =
      typeof budget?.limitInTokens === "number" &&
      Number.isFinite(budget.limitInTokens)
        ? budget.limitInTokens
        : null;
    const isPaused: boolean = limitInTokens !== null && limitInTokens <= 0;
    const checkedWhen: string = isAfterWait
      ? "as its wait ended"
      : "at creation";
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
          ? "Review the Enable AI switch under Project Settings → AI → AI Features for new records. Existing records are not automatically retried when AI is enabled."
          : "Turn on Enable AI under Project Settings → AI → AI Features to investigate new records. Existing records are not automatically retried.",
      },
      automatic_investigation_disabled: {
        title: recorded
          ? `Automatic ${kind} investigation was off ${atDecision}`
          : `Automatic ${kind} investigation is currently turned off`,
        description: `${recorded ? `Automatic investigation was not enabled for ${kind}s ${whenDecided}.` : `Automatic investigation is not currently enabled for ${kind}s.`} Alerts and incidents have separate investigation settings.`,
        nextStep: recorded
          ? `Review the ${investigateSwitch} switch under ${aiSettingsPage} for new ${kind}s. Turning it on later does not automatically retry this ${kind}.`
          : `Turn on ${investigateSwitch} under ${aiSettingsPage} for new ${kind}s. Existing records are not automatically retried.`,
      },
      /*
       * The page is LLM Providers, where the card's "Set up an LLM provider"
       * link goes: never "AI provider", a setting with no such name.
       */
      provider_missing: {
        title: recorded
          ? `No LLM provider was available ${atDecision}`
          : "No LLM provider is currently available",
        description: recorded
          ? `Automatic investigation was enabled ${whenDecided}, but the project had no LLM provider OneUptime AI could use to run it.`
          : "Automatic investigation is currently enabled, but this project has no LLM provider OneUptime AI can use to run new investigations.",
        nextStep: recorded
          ? "Review the project's LLM providers under Project Settings → AI → LLM Providers for new investigations. Setting one up later does not automatically retry existing records."
          : "Set up an LLM provider for the project under Project Settings → AI → LLM Providers. New eligible records can then be investigated; existing records are not automatically retried.",
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
      // The setting is the minimum severity for AI investigation.
      severity_below_threshold: {
        title: recorded
          ? `Severity was below the minimum for AI investigation ${atDecision}`
          : "Severity is currently below the minimum for AI investigation",
        description: `${recorded ? `${whenDecidedAtStart}, its` : `This ${kind}'s`}${details?.severityName ? ` ${details.severityName}` : ""} severity ${recorded ? "did not meet" : "does not meet"} the minimum severity for AI investigation${details?.minimumSeverityName ? ` (${details.minimumSeverityName})` : ""}.`,
        nextStep: `Review the minimum severity for AI investigation under ${moreSettings}. Changes apply to new records and do not retry this record.`,
      },
      // The setting is the re-investigation cooldown.
      monitor_cooldown: {
        title: recorded
          ? "Skipped during the re-investigation cooldown"
          : "A monitor is currently within its re-investigation cooldown",
        description: recorded
          ? `Another ${kind} investigation was already queued or started for an affected monitor within the ${cooldownWindow} re-investigation cooldown. This repeat ${kind} did not start another investigation.`
          : `An investigation for an affected monitor was queued or started within the current ${cooldownWindow} re-investigation cooldown, which prevents another automatic ${kind} investigation right now.`,
        nextStep: `Review recent investigations for the affected monitor, or shorten or clear the re-investigation cooldown under ${moreSettings} for new records. An earlier run may still be queued, running, or may have failed.`,
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
          ? `Review the AI rules under ${moreSettings}. Changing them does not retry this ${kind}; to look into it anyway, ask OneUptime AI below.`
          : `Review the AI rules under ${moreSettings}. Existing records are not automatically retried.`,
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
        nextStep: `To look into it anyway, ask OneUptime AI below. The wait is set on the AI rules under ${moreSettings}.`,
      },
      /*
       * The record's own daily token limit, under its AI settings' More
       * settings. A limit of 0 pauses the work instead, and waiting for
       * midnight does not lift it.
       */
      daily_budget_exhausted: {
        title: isPaused
          ? recorded
            ? "Automatic investigation was paused by its token limit"
            : "Automatic investigation is currently paused by its token limit"
          : recorded
            ? "The daily AI token limit had been reached"
            : "The daily AI token limit is currently reached",
        description:
          isPaused && budget
            ? recorded
              ? `The ${tokenLimitName} was set to 0 when checked ${checkedWhen}, which pauses automatic AI work for ${kind}s. No investigation was queued.`
              : `The ${tokenLimitName} is set to 0, which pauses automatic AI work for ${kind}s, so new investigations cannot start.`
            : budget && limitInTokens !== null
              ? `AI work for ${kind}s ${recorded ? "had used" : "has used"} ${budget.usedTokensToday.toLocaleString("en-US")} tokens of its ${tokenLimitName} of ${limitInTokens.toLocaleString("en-US")} ${recorded ? `when checked ${checkedWhen}. No investigation was queued.` : "today. The current limit does not permit a new investigation."}`
              : `The ${tokenLimitName} ${recorded ? `had been reached ${isAfterWait ? "when this record's wait ended" : "when this record was created"}, so no investigation was queued.` : "is currently reached, so new investigations cannot start."}`,
        nextStep: isPaused
          ? `Raise the ${tokenLimitName} above 0 under ${moreSettings}, or clear it. Records skipped meanwhile are not automatically retried.`
          : `Review the ${tokenLimitName} under ${moreSettings}. Usage resets at midnight UTC; skipped records are not automatically retried after the reset.`,
      },
      // Only ever recorded when reading the daily token limit fails.
      budget_check_failed: {
        title: recorded
          ? "The daily AI token limit could not be checked"
          : "The daily AI token limit cannot currently be checked",
        description: recorded
          ? "The system could not check the daily AI token limit, so it did not queue an investigation that might go over it."
          : "The daily AI token limit cannot currently be checked, so eligibility for a new investigation cannot be confirmed.",
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
      /*
       * The card links to the record's AI settings here, and its step names
       * the AI Logs: the English writes out both pages' paths.
       */
      no_run_recorded: {
        title: "No investigation was recorded",
        description: `This ${kind} passes the current automatic investigation checks, but no investigation or original skip decision was found. Settings may have changed since it was created, or automatic investigation may not have started when this record was created.`,
        nextStep: `Automatic investigations are triggered when a record is created, so enabling investigation later under ${aiSettingsPage} does not backfill existing records. Check the AI Logs under ${aiLogsPage} and service health if new eligible records are also missing investigations.`,
      },
    };
    const facts: InvestigationNotStartedFacts | null = this.getFacts(
      details,
      budget,
    );
    return {
      code,
      ...reasons[code],
      description: recorded
        ? reasons[code].description
        : `${reasons[code].description} These are the current conditions; the original decision was not recorded, so they do not confirm why this record was skipped at creation.`,
      source,
      evaluatedAt: new Date().toISOString(),
      ...(isAfterWait ? { decidedAfterWaitMinutes: waitMinutes } : {}),
      ...(facts ? { facts } : {}),
    };
  }

  /*
   * The facts a Dashboard words the reason from in its reader's language
   * (InvestigationNotStartedWords), beside the English sentences above: the
   * severity names, the cooldown and the daily token limit, each only when
   * it is known - or null when none is. A wait travels as
   * decidedAfterWaitMinutes instead, as it always has.
   */
  public static getFacts(
    details?: InvestigationGateDetails,
    budget?: AutonomousBudgetStatus,
  ): InvestigationNotStartedFacts | null {
    const facts: InvestigationNotStartedFacts = {};
    const name: (value: string | undefined) => string | undefined = (
      value: string | undefined,
    ): string | undefined => {
      return typeof value === "string" && value.trim() ? value : undefined;
    };
    const count: (value: number | null | undefined) => number | undefined = (
      value: number | null | undefined,
    ): number | undefined => {
      return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : undefined;
    };

    const severityName: string | undefined = name(details?.severityName);
    const minimumSeverityName: string | undefined = name(
      details?.minimumSeverityName,
    );
    const cooldownWindowMinutes: number | undefined = count(
      details?.cooldownWindowMinutes,
    );
    // A limit below 0 pauses the work as 0 does (getAutonomousDailyBudgetStatus).
    const dailyTokenLimit: number | undefined =
      typeof budget?.limitInTokens === "number" &&
      Number.isFinite(budget.limitInTokens)
        ? Math.max(0, budget.limitInTokens)
        : undefined;

    if (severityName !== undefined) {
      facts.severityName = severityName;
    }
    if (minimumSeverityName !== undefined) {
      facts.minimumSeverityName = minimumSeverityName;
    }
    if (cooldownWindowMinutes !== undefined) {
      facts.cooldownWindowMinutes = cooldownWindowMinutes;
    }
    if (dailyTokenLimit !== undefined) {
      facts.dailyTokenLimit = dailyTokenLimit;
    }

    return Object.keys(facts).length > 0 ? facts : null;
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
