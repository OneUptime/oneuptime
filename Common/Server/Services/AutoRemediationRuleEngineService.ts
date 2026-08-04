import Alert from "../../Models/DatabaseModels/Alert";
import AutoRemediationRule from "../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../Models/DatabaseModels/Incident";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Project from "../../Models/DatabaseModels/Project";
import Runbook from "../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../Models/DatabaseModels/RunbookExecution";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import AIRunType from "../../Types/AI/AIRunType";
import AutoRemediationExecutionMode from "../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import AutoRemediationTriggerEntity from "../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import { Indigo500 } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import AlertService from "./AlertService";
import IncidentService from "./IncidentService";
import AlertFeedService from "./AlertFeedService";
import AutoRemediationRuleService from "./AutoRemediationRuleService";
import AutoRemediationSuggestionService from "./AutoRemediationSuggestionService";
import IncidentFeedService from "./IncidentFeedService";
import LlmProviderService from "./LlmProviderService";
import MonitorService from "./MonitorService";
import ProjectService from "./ProjectService";
import RunbookRuleEngineService from "./RunbookRuleEngineService";
import AIInvestigationQueue from "../Utils/AI/SRE/InvestigationQueue";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

/*
 * Guardrails (minimal G1 for auto-remediation Phase 1):
 * - At most this many suggestions per incident/alert, ever. Stops rule
 *   fan-out and repeated matching from flooding a subject with proposals.
 */
export const MAX_SUGGESTIONS_PER_SUBJECT: number = 3;

/*
 * - A FullAuto rule that has auto-executed this many times in the last hour
 *   is downgraded to Suggest for the next match (remediation-storm circuit
 *   breaker). A human gets pulled back into the loop instead of a runbook
 *   being started in a tight flap loop.
 */
export const MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR: number = 3;

/*
 * How long the subject's monitors get to recover after a remediation
 * runbook starts, when the rule does not set its own window. The verifier
 * fails the remediation past this deadline — escalation continues as
 * normal either way.
 */
export const DEFAULT_VERIFICATION_WINDOW_MINUTES: number = 15;

type SubjectLinkage = {
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
};

class AutoRemediationRuleEngineServiceClass {
  /*
   * Reload an incident and run the rules against it. Used by the
   * post-investigation remediation hand-off (RemediationHandoff), which
   * holds only the subject id: the create-hook's in-memory model is long
   * gone by the time the investigation settles, and the reload also picks
   * up edits made while the investigation ran. The select mirrors exactly
   * what doesIncidentMatchRule reads — keep the two in sync.
   */
  @CaptureSpan()
  public async applyRulesToIncidentById(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const incident: Incident | null = await IncidentService.findOneById({
      id: data.incidentId,
      select: {
        _id: true,
        projectId: true,
        title: true,
        description: true,
        incidentSeverityId: true,
        monitors: { _id: true },
        labels: { _id: true },
      },
      props: { isRoot: true },
    });

    if (!incident) {
      return;
    }

    await this.applyRulesToIncident(incident);
  }

  // The alert twin of applyRulesToIncidentById — mirrors doesAlertMatchRule.
  @CaptureSpan()
  public async applyRulesToAlertById(data: {
    alertId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const alert: Alert | null = await AlertService.findOneById({
      id: data.alertId,
      select: {
        _id: true,
        projectId: true,
        title: true,
        description: true,
        alertSeverityId: true,
        monitorId: true,
        labels: { _id: true },
      },
      props: { isRoot: true },
    });

    if (!alert) {
      return;
    }

    await this.applyRulesToAlert(alert);
  }

  @CaptureSpan()
  public async applyRulesToIncident(incident: Incident): Promise<void> {
    if (!incident.id || !incident.projectId) {
      return;
    }

    try {
      await this.applyRules({
        projectId: incident.projectId,
        triggerEntityType: AutoRemediationTriggerEntity.Incident,
        incident,
      });
    } catch (error) {
      logger.error(`Error applying auto-remediation rules: ${error}`, {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  public async applyRulesToAlert(alert: Alert): Promise<void> {
    if (!alert.id || !alert.projectId) {
      return;
    }

    try {
      await this.applyRules({
        projectId: alert.projectId,
        triggerEntityType: AutoRemediationTriggerEntity.Alert,
        alert,
      });
    } catch (error) {
      logger.error(`Error applying auto-remediation rules: ${error}`, {
        projectId: alert.projectId?.toString(),
        alertId: alert.id?.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  private async applyRules(data: {
    projectId: ObjectID;
    triggerEntityType: AutoRemediationTriggerEntity;
    incident?: Incident | undefined;
    alert?: Alert | undefined;
  }): Promise<void> {
    /*
     * Project-level kill switch. === false so a missing column (older rows,
     * self-hosted defaults) counts as enabled — same semantics as enableAi.
     */
    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        enableAi: true,
        enableAutoRemediation: true,
        enableAiCommandExecution: true,
      },
      props: { isRoot: true },
    });

    if (!project || project.enableAutoRemediation === false) {
      return;
    }

    const rules: Array<AutoRemediationRule> =
      await AutoRemediationRuleService.findBy({
        query: {
          projectId: data.projectId,
          isEnabled: true,
          triggerEntityType: data.triggerEntityType,
        },
        props: { isRoot: true },
        select: {
          _id: true,
          name: true,
          executionMode: true,
          aiSelectsRunbook: true,
          aiComposesCommands: true,
          verificationWindowMinutes: true,
          autoResolveOnVerifiedRecovery: true,
          titlePattern: true,
          descriptionPattern: true,
          monitors: { _id: true },
          incidentSeverities: { _id: true },
          alertSeverities: { _id: true },
          labels: { _id: true },
          monitorLabels: { _id: true },
          runbooks: { _id: true, name: true },
        },
        limit: 100,
        skip: 0,
      });

    if (rules.length === 0) {
      return;
    }

    const matchedRules: Array<AutoRemediationRule> = [];

    for (const rule of rules) {
      const isMatch: boolean = data.incident
        ? await this.doesIncidentMatchRule(data.incident, rule)
        : data.alert
          ? await this.doesAlertMatchRule(data.alert, rule)
          : false;

      if (isMatch) {
        matchedRules.push(rule);
      }
    }

    if (matchedRules.length === 0) {
      return;
    }

    const linkage: SubjectLinkage = {
      incidentId: data.incident?.id || undefined,
      alertId: data.alert?.id || undefined,
    };

    /*
     * Per-subject cap + per-rule dedupe. A rule that already produced a
     * suggestion on this subject never produces another (a dismissal is a
     * human "no" — do not re-ask).
     */
    const existingSuggestions: Array<AutoRemediationSuggestion> =
      await AutoRemediationSuggestionService.findBy({
        query: linkage.incidentId
          ? { incidentId: linkage.incidentId }
          : { alertId: linkage.alertId! },
        props: { isRoot: true },
        select: {
          _id: true,
          autoRemediationRuleId: true,
        },
        limit: MAX_SUGGESTIONS_PER_SUBJECT * 10,
        skip: 0,
      });

    let remainingBudget: number =
      MAX_SUGGESTIONS_PER_SUBJECT - existingSuggestions.length;

    if (remainingBudget <= 0) {
      logger.debug(
        `AutoRemediationRuleEngine: suggestion cap reached for subject; skipping ${matchedRules.length} matched rule(s).`,
        {
          projectId: data.projectId.toString(),
          incidentId: linkage.incidentId?.toString(),
          alertId: linkage.alertId?.toString(),
        } as LogAttributes,
      );
      return;
    }

    const ruleIdsWithExistingSuggestion: Set<string> = new Set<string>(
      existingSuggestions
        .map((s: AutoRemediationSuggestion) => {
          return s.autoRemediationRuleId?.toString() || "";
        })
        .filter((id: string) => {
          return id !== "";
        }),
    );

    // Lazily evaluated once: AI rules need AI enabled and a provider.
    let aiAvailable: boolean | null = null;

    for (const rule of matchedRules) {
      if (remainingBudget <= 0) {
        break;
      }

      if (rule.id && ruleIdsWithExistingSuggestion.has(rule.id.toString())) {
        continue;
      }

      /*
       * Command composition wins over runbook selection when a rule has
       * both flags — one run per rule, never two.
       */
      if (rule.aiComposesCommands) {
        if (aiAvailable === null) {
          aiAvailable =
            project.enableAi !== false &&
            (await LlmProviderService.getLLMProviderForProject(
              data.projectId,
            )) !== null;
        }

        if (!aiAvailable) {
          logger.debug(
            `AutoRemediationRuleEngine: skipping AI command rule ${rule.id?.toString()} — AI disabled or no LLM provider configured.`,
            { projectId: data.projectId.toString() } as LogAttributes,
          );
          continue;
        }

        /*
         * Opt-in semantics (=== true): the project must have explicitly
         * enabled AI command execution, on top of the AI/auto-remediation
         * kill switches.
         */
        if (project.enableAiCommandExecution !== true) {
          logger.debug(
            `AutoRemediationRuleEngine: skipping AI command rule ${rule.id?.toString()} — the project has not enabled AI command execution.`,
            { projectId: data.projectId.toString() } as LogAttributes,
          );
          continue;
        }

        await this.startAiCommandRun({
          projectId: data.projectId,
          rule,
          linkage,
        });
        remainingBudget -= 1;
        continue;
      }

      if (rule.aiSelectsRunbook) {
        if (aiAvailable === null) {
          aiAvailable =
            project.enableAi !== false &&
            (await LlmProviderService.getLLMProviderForProject(
              data.projectId,
            )) !== null;
        }

        if (!aiAvailable) {
          logger.debug(
            `AutoRemediationRuleEngine: skipping AI rule ${rule.id?.toString()} — AI disabled or no LLM provider configured.`,
            { projectId: data.projectId.toString() } as LogAttributes,
          );
          continue;
        }

        await this.startAiPlanning({
          projectId: data.projectId,
          rule,
          linkage,
        });
        remainingBudget -= 1;
        continue;
      }

      // Deterministic rule: propose or start every attached runbook.
      const runbooks: Array<Runbook> = rule.runbooks || [];

      if (runbooks.length === 0) {
        logger.warn(
          `AutoRemediationRuleEngine: rule ${rule.id?.toString()} matched but has no runbooks attached and does not use AI selection; skipping.`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        continue;
      }

      if (rule.executionMode === AutoRemediationExecutionMode.FullAuto) {
        remainingBudget -= await this.applyFullAutoRule({
          projectId: data.projectId,
          rule,
          runbooks,
          linkage,
          budget: remainingBudget,
        });
        continue;
      }

      for (const runbook of runbooks) {
        if (remainingBudget <= 0) {
          break;
        }
        if (!runbook.id) {
          continue;
        }

        await this.suggestRunbook({
          projectId: data.projectId,
          rule,
          runbook,
          linkage,
          downgradedByCircuitBreaker: false,
        });
        remainingBudget -= 1;
      }
    }
  }

  /*
   * FullAuto with the hourly circuit breaker. The whole
   * count-decide-execute-record section is serialized per rule through a
   * distributed mutex: concurrent incident creations (flap storm, multiple
   * App pods) would otherwise all read a stale count and blow past the cap
   * together. The AutoExecuted suggestion rows are written inside the lock,
   * so the next holder's count sees them. If the lock cannot be acquired
   * (e.g. Redis unavailable) the engine degrades to the unserialized check
   * rather than dropping remediation entirely — the breaker is
   * defense-in-depth, not a correctness invariant.
   *
   * Returns how many suggestions were consumed from the per-subject budget.
   */
  private async applyFullAutoRule(data: {
    projectId: ObjectID;
    rule: AutoRemediationRule;
    runbooks: Array<Runbook>;
    linkage: SubjectLinkage;
    budget: number;
  }): Promise<number> {
    let mutex: SemaphoreMutex | null = null;
    try {
      mutex = await Semaphore.lock({
        key: `auto-remediation-rule-${data.rule.id?.toString()}`,
        namespace: "AutoRemediationRuleEngine",
        lockTimeout: 60 * 1000,
        acquireTimeout: 20 * 1000,
      });
    } catch (error) {
      logger.warn(
        `AutoRemediationRuleEngine: could not acquire circuit-breaker lock for rule ${data.rule.id?.toString()} — continuing without cross-pod serialization: ${error}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
    }

    let consumed: number = 0;

    try {
      /*
       * Count inside the lock, and keep counting in-memory as this
       * invocation executes — a rule with several attached runbooks must
       * not execute all of them off one stale pre-loop count.
       */
      let executedInWindow: number = (
        await AutoRemediationSuggestionService.countBy({
          query: {
            autoRemediationRuleId: data.rule.id!,
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            createdAt: QueryHelper.greaterThan(
              OneUptimeDate.getSomeHoursAgo(1),
            ),
          },
          props: { isRoot: true },
        })
      ).toNumber();

      for (const runbook of data.runbooks) {
        if (consumed >= data.budget) {
          break;
        }
        if (!runbook.id) {
          continue;
        }

        if (executedInWindow >= MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR) {
          logger.warn(
            `AutoRemediationRuleEngine: circuit breaker tripped for rule ${data.rule.id?.toString()} (${executedInWindow} auto-executions in the last hour); downgrading to Suggest.`,
            { projectId: data.projectId.toString() } as LogAttributes,
          );
          await this.suggestRunbook({
            projectId: data.projectId,
            rule: data.rule,
            runbook,
            linkage: data.linkage,
            downgradedByCircuitBreaker: true,
          });
        } else {
          await this.autoExecuteRunbook({
            projectId: data.projectId,
            rule: data.rule,
            runbook,
            linkage: data.linkage,
          });
          /*
           * Counted even when the start failed (no row written): within
           * this invocation the fail direction of a breaker is to close
           * early, never to keep firing.
           */
          executedInWindow += 1;
        }
        consumed += 1;
      }
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (error) {
          logger.error(
            `AutoRemediationRuleEngine: failed to release circuit-breaker lock: ${error}`,
            { projectId: data.projectId.toString() } as LogAttributes,
          );
        }
      }
    }

    return consumed;
  }

  /*
   * AI path: create a Planning suggestion and enqueue a RemediationPlan run
   * on the durable AI queue. The planning runner fills in the picked runbook
   * and rationale (or NoneApplicable). AI-picked runbooks are always
   * suggest-only — never full-auto.
   */
  private async startAiPlanning(data: {
    projectId: ObjectID;
    rule: AutoRemediationRule;
    linkage: SubjectLinkage;
  }): Promise<void> {
    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();
    suggestion.projectId = data.projectId;
    suggestion.autoRemediationRuleId = data.rule.id!;
    suggestion.ruleNameSnapshot = data.rule.name || "Auto Remediation Rule";
    suggestion.status = AutoRemediationSuggestionStatus.Planning;
    suggestion.executionMode = AutoRemediationExecutionMode.Suggest;
    suggestion.verificationWindowMinutes =
      data.rule.verificationWindowMinutes ||
      DEFAULT_VERIFICATION_WINDOW_MINUTES;
    suggestion.autoResolveOnRecovery =
      data.rule.autoResolveOnVerifiedRecovery === true;
    if (data.linkage.incidentId) {
      suggestion.incidentId = data.linkage.incidentId;
    }
    if (data.linkage.alertId) {
      suggestion.alertId = data.linkage.alertId;
    }

    const created: AutoRemediationSuggestion =
      await AutoRemediationSuggestionService.create({
        data: suggestion,
        props: { isRoot: true },
      });

    const aiRunId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: data.projectId,
      subjectIncidentId: data.linkage.incidentId,
      subjectAlertId: data.linkage.alertId,
      subjectAutoRemediationSuggestionId: created.id!,
    });

    if (!aiRunId) {
      /*
       * Budget exhausted or run creation failed — do not leave the
       * suggestion stuck in Planning forever.
       */
      await AutoRemediationSuggestionService.updateOneById({
        id: created.id!,
        data: {
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          rationaleMarkdown:
            "AI planning could not be started — the daily autonomous AI budget is exhausted or no run could be queued. Re-enable by raising the budget or waiting for the daily reset.",
        },
        props: { isRoot: true },
      });
      return;
    }

    await AutoRemediationSuggestionService.updateOneById({
      id: created.id!,
      data: {
        aiRunId,
      },
      props: { isRoot: true },
    });

    await this.postFeedItem({
      projectId: data.projectId,
      linkage: data.linkage,
      markdown: `⚡ **Auto Remediation Rule "${data.rule.name}" matched.** AI is picking the most applicable runbook — a suggestion will appear here shortly.`,
      pingWorkspace: false,
    });
  }

  /*
   * AI command path (rules with aiComposesCommands): create a Planning
   * CommandPlan suggestion and enqueue a RemediationExecution run. The
   * execution runner decides Suggest vs FullAuto from the rule's execution
   * mode + allowlist + circuit breaker at run time; the suggestion's
   * executionMode snapshots the rule's intent for display.
   */
  private async startAiCommandRun(data: {
    projectId: ObjectID;
    rule: AutoRemediationRule;
    linkage: SubjectLinkage;
  }): Promise<void> {
    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();
    suggestion.projectId = data.projectId;
    suggestion.autoRemediationRuleId = data.rule.id!;
    suggestion.ruleNameSnapshot = data.rule.name || "Auto Remediation Rule";
    suggestion.status = AutoRemediationSuggestionStatus.Planning;
    suggestion.suggestionType = AutoRemediationSuggestionType.CommandPlan;
    suggestion.executionMode =
      data.rule.executionMode === AutoRemediationExecutionMode.FullAuto
        ? AutoRemediationExecutionMode.FullAuto
        : AutoRemediationExecutionMode.Suggest;
    suggestion.verificationWindowMinutes =
      data.rule.verificationWindowMinutes ||
      DEFAULT_VERIFICATION_WINDOW_MINUTES;
    suggestion.autoResolveOnRecovery =
      data.rule.autoResolveOnVerifiedRecovery === true;
    if (data.linkage.incidentId) {
      suggestion.incidentId = data.linkage.incidentId;
    }
    if (data.linkage.alertId) {
      suggestion.alertId = data.linkage.alertId;
    }

    const created: AutoRemediationSuggestion =
      await AutoRemediationSuggestionService.create({
        data: suggestion,
        props: { isRoot: true },
      });

    const aiRunId: ObjectID | null = await AIInvestigationQueue.enqueue({
      projectId: data.projectId,
      subjectIncidentId: data.linkage.incidentId,
      subjectAlertId: data.linkage.alertId,
      subjectAutoRemediationSuggestionId: created.id!,
      remediationRunType: AIRunType.RemediationExecution,
    });

    if (!aiRunId) {
      await AutoRemediationSuggestionService.updateOneById({
        id: created.id!,
        data: {
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          rationaleMarkdown:
            "The AI command run could not be started — the daily autonomous AI budget is exhausted or no run could be queued. Re-enable by raising the budget or waiting for the daily reset.",
        },
        props: { isRoot: true },
      });
      return;
    }

    await AutoRemediationSuggestionService.updateOneById({
      id: created.id!,
      data: {
        aiRunId,
      },
      props: { isRoot: true },
    });

    await this.postFeedItem({
      projectId: data.projectId,
      linkage: data.linkage,
      markdown: `⚡ **Auto Remediation Rule "${data.rule.name}" matched.** AI is diagnosing the signal and composing remediation commands — a suggestion will appear here shortly.`,
      pingWorkspace: false,
    });
  }

  // Deterministic Suggest path: propose the runbook for one-click approval.
  private async suggestRunbook(data: {
    projectId: ObjectID;
    rule: AutoRemediationRule;
    runbook: Runbook;
    linkage: SubjectLinkage;
    downgradedByCircuitBreaker: boolean;
  }): Promise<void> {
    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();
    suggestion.projectId = data.projectId;
    suggestion.autoRemediationRuleId = data.rule.id!;
    suggestion.ruleNameSnapshot = data.rule.name || "Auto Remediation Rule";
    suggestion.runbookId = data.runbook.id!;
    suggestion.runbookNameSnapshot = data.runbook.name || "Runbook";
    suggestion.status = AutoRemediationSuggestionStatus.Suggested;
    suggestion.executionMode = AutoRemediationExecutionMode.Suggest;
    suggestion.verificationWindowMinutes =
      data.rule.verificationWindowMinutes ||
      DEFAULT_VERIFICATION_WINDOW_MINUTES;
    suggestion.autoResolveOnRecovery =
      data.rule.autoResolveOnVerifiedRecovery === true;
    suggestion.rationaleMarkdown = data.downgradedByCircuitBreaker
      ? "Proposed by a FullAuto rule that was downgraded to suggest-only by the hourly circuit breaker (too many recent auto-executions). Approve to start the runbook."
      : "Proposed by a matching auto-remediation rule. Approve to start the runbook.";
    if (data.linkage.incidentId) {
      suggestion.incidentId = data.linkage.incidentId;
    }
    if (data.linkage.alertId) {
      suggestion.alertId = data.linkage.alertId;
    }

    await AutoRemediationSuggestionService.create({
      data: suggestion,
      props: { isRoot: true },
    });

    await this.postFeedItem({
      projectId: data.projectId,
      linkage: data.linkage,
      markdown: `⚡ **Auto Remediation Rule "${data.rule.name}" proposed runbook "${data.runbook.name}".** Review and approve it with one click to start remediation.`,
      pingWorkspace: true,
    });
  }

  /*
   * FullAuto path: start the runbook immediately. startRunbookFor re-checks
   * project ownership, isEnabled and non-empty steps, so a stale or
   * cross-project runbook reference can never execute.
   */
  private async autoExecuteRunbook(data: {
    projectId: ObjectID;
    rule: AutoRemediationRule;
    runbook: Runbook;
    linkage: SubjectLinkage;
  }): Promise<void> {
    const runbookLinkage: { incidentId?: ObjectID; alertId?: ObjectID } = {};
    if (data.linkage.incidentId) {
      runbookLinkage.incidentId = data.linkage.incidentId;
    }
    if (data.linkage.alertId) {
      runbookLinkage.alertId = data.linkage.alertId;
    }

    const execution: RunbookExecution | null =
      await RunbookRuleEngineService.startRunbookFor({
        projectId: data.projectId,
        runbookId: data.runbook.id!,
        linkage: runbookLinkage,
      });

    if (!execution) {
      logger.warn(
        `AutoRemediationRuleEngine: FullAuto rule ${data.rule.id?.toString()} could not start runbook ${data.runbook.id?.toString()} (missing, disabled, cross-project or empty).`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      await this.postFeedItem({
        projectId: data.projectId,
        linkage: data.linkage,
        markdown: `⚡ **Auto Remediation Rule "${data.rule.name}" matched, but runbook "${data.runbook.name}" could not be started** (it may be disabled or have no steps).`,
        pingWorkspace: false,
      });
      return;
    }

    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();
    suggestion.projectId = data.projectId;
    suggestion.autoRemediationRuleId = data.rule.id!;
    suggestion.ruleNameSnapshot = data.rule.name || "Auto Remediation Rule";
    suggestion.runbookId = data.runbook.id!;
    suggestion.runbookNameSnapshot = data.runbook.name || "Runbook";
    suggestion.status = AutoRemediationSuggestionStatus.AutoExecuted;
    suggestion.executionMode = AutoRemediationExecutionMode.FullAuto;
    suggestion.runbookExecutionId = execution.id!;
    suggestion.verificationWindowMinutes =
      data.rule.verificationWindowMinutes ||
      DEFAULT_VERIFICATION_WINDOW_MINUTES;
    suggestion.autoResolveOnRecovery =
      data.rule.autoResolveOnVerifiedRecovery === true;
    // The runbook is already running — verification starts now.
    suggestion.verificationStatus = AutoRemediationVerificationStatus.Pending;
    suggestion.verificationDeadlineAt = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      data.rule.verificationWindowMinutes ||
        DEFAULT_VERIFICATION_WINDOW_MINUTES,
    );
    suggestion.rationaleMarkdown =
      "Automatically executed by a FullAuto auto-remediation rule.";
    if (data.linkage.incidentId) {
      suggestion.incidentId = data.linkage.incidentId;
    }
    if (data.linkage.alertId) {
      suggestion.alertId = data.linkage.alertId;
    }

    await AutoRemediationSuggestionService.create({
      data: suggestion,
      props: { isRoot: true },
    });

    await this.postFeedItem({
      projectId: data.projectId,
      linkage: data.linkage,
      markdown: `⚡ **Auto Remediation Rule "${data.rule.name}" automatically started runbook "${data.runbook.name}".** Follow its progress on the runbook execution page.`,
      pingWorkspace: true,
    });
  }

  // Feed posting is best-effort observability — the feed services never throw.
  private async postFeedItem(data: {
    projectId: ObjectID;
    linkage: SubjectLinkage;
    markdown: string;
    pingWorkspace: boolean;
  }): Promise<void> {
    try {
      if (data.linkage.incidentId) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: data.linkage.incidentId,
          projectId: data.projectId,
          incidentFeedEventType: IncidentFeedEventType.AutoRemediation,
          displayColor: Indigo500,
          feedInfoInMarkdown: data.markdown,
          workspaceNotification: {
            sendWorkspaceNotification: data.pingWorkspace,
          },
        });
      } else if (data.linkage.alertId) {
        await AlertFeedService.createAlertFeedItem({
          alertId: data.linkage.alertId,
          projectId: data.projectId,
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
        `AutoRemediationRuleEngine: failed to create feed item: ${error}`,
        {
          projectId: data.projectId.toString(),
          incidentId: data.linkage.incidentId?.toString(),
          alertId: data.linkage.alertId?.toString(),
        } as LogAttributes,
      );
    }
  }

  /*
   * Matching. Every criterion is skip-if-empty with AND semantics across
   * criteria — the same shape as IncidentOnCallRuleEngineService.
   */
  public async doesIncidentMatchRule(
    incident: Incident,
    rule: AutoRemediationRule,
  ): Promise<boolean> {
    // Monitors: incident must come from at least one of the rule's monitors.
    if (rule.monitors && rule.monitors.length > 0) {
      if (!incident.monitors || incident.monitors.length === 0) {
        return false;
      }
      const ruleMonitorIds: Array<string> = rule.monitors.map((m: Monitor) => {
        return m.id?.toString() || "";
      });
      const incidentMonitorIds: Array<string> = incident.monitors.map(
        (m: Monitor) => {
          return m.id?.toString() || "";
        },
      );
      const hasMatch: boolean = ruleMonitorIds.some((id: string) => {
        return incidentMonitorIds.includes(id);
      });
      if (!hasMatch) {
        return false;
      }
    }

    // Severity
    if (rule.incidentSeverities && rule.incidentSeverities.length > 0) {
      if (!incident.incidentSeverityId) {
        return false;
      }
      const severityIds: Array<string> = rule.incidentSeverities.map(
        (s: IncidentSeverity) => {
          return s.id?.toString() || "";
        },
      );
      if (!severityIds.includes(incident.incidentSeverityId.toString())) {
        return false;
      }
    }

    // Entity labels
    if (rule.labels && rule.labels.length > 0) {
      if (!incident.labels || incident.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const incidentLabelIds: Array<string> = incident.labels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const hasMatch: boolean = ruleLabelIds.some((id: string) => {
        return incidentLabelIds.includes(id);
      });
      if (!hasMatch) {
        return false;
      }
    }

    // Monitor labels: any of the incident's monitors carrying one is enough.
    if (rule.monitorLabels && rule.monitorLabels.length > 0) {
      if (!incident.monitors || incident.monitors.length === 0) {
        return false;
      }

      let anyMonitorMatches: boolean = false;

      for (const incidentMonitor of incident.monitors) {
        if (!incidentMonitor.id) {
          continue;
        }

        if (
          await this.doesMonitorCarryAnyLabel(
            incidentMonitor.id,
            rule.monitorLabels,
          )
        ) {
          anyMonitorMatches = true;
          break;
        }
      }

      if (!anyMonitorMatches) {
        return false;
      }
    }

    if (rule.titlePattern) {
      if (
        !incident.title ||
        !this.testRegex(rule.titlePattern, incident.title, rule)
      ) {
        return false;
      }
    }

    if (rule.descriptionPattern) {
      if (
        !incident.description ||
        !this.testRegex(rule.descriptionPattern, incident.description, rule)
      ) {
        return false;
      }
    }

    return true;
  }

  public async doesAlertMatchRule(
    alert: Alert,
    rule: AutoRemediationRule,
  ): Promise<boolean> {
    // Monitors: alerts carry a single scalar monitorId.
    if (rule.monitors && rule.monitors.length > 0) {
      if (!alert.monitorId) {
        return false;
      }
      const monitorIds: Array<string> = rule.monitors.map((m: Monitor) => {
        return m.id?.toString() || "";
      });
      if (!monitorIds.includes(alert.monitorId.toString())) {
        return false;
      }
    }

    // Severity
    if (rule.alertSeverities && rule.alertSeverities.length > 0) {
      if (!alert.alertSeverityId) {
        return false;
      }
      const severityIds: Array<string> = rule.alertSeverities.map(
        (s: AlertSeverity) => {
          return s.id?.toString() || "";
        },
      );
      if (!severityIds.includes(alert.alertSeverityId.toString())) {
        return false;
      }
    }

    // Entity labels
    if (rule.labels && rule.labels.length > 0) {
      if (!alert.labels || alert.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const alertLabelIds: Array<string> = alert.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const hasMatch: boolean = ruleLabelIds.some((id: string) => {
        return alertLabelIds.includes(id);
      });
      if (!hasMatch) {
        return false;
      }
    }

    // Monitor labels
    if (rule.monitorLabels && rule.monitorLabels.length > 0) {
      if (!alert.monitorId) {
        return false;
      }
      if (
        !(await this.doesMonitorCarryAnyLabel(
          alert.monitorId,
          rule.monitorLabels,
        ))
      ) {
        return false;
      }
    }

    if (rule.titlePattern) {
      if (
        !alert.title ||
        !this.testRegex(rule.titlePattern, alert.title, rule)
      ) {
        return false;
      }
    }

    if (rule.descriptionPattern) {
      if (
        !alert.description ||
        !this.testRegex(rule.descriptionPattern, alert.description, rule)
      ) {
        return false;
      }
    }

    return true;
  }

  private async doesMonitorCarryAnyLabel(
    monitorId: ObjectID,
    ruleMonitorLabels: Array<Label>,
  ): Promise<boolean> {
    const monitor: Monitor | null = await MonitorService.findOneById({
      id: monitorId,
      select: {
        labels: { _id: true },
      },
      props: { isRoot: true },
    });

    if (!monitor || !monitor.labels || monitor.labels.length === 0) {
      return false;
    }

    const ruleLabelIds: Array<string> = ruleMonitorLabels.map((l: Label) => {
      return l.id?.toString() || "";
    });
    const monitorLabelIds: Array<string> = monitor.labels.map((l: Label) => {
      return l.id?.toString() || "";
    });

    return ruleLabelIds.some((id: string) => {
      return monitorLabelIds.includes(id);
    });
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: AutoRemediationRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex pattern in auto-remediation rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

const AutoRemediationRuleEngineService: AutoRemediationRuleEngineServiceClass =
  new AutoRemediationRuleEngineServiceClass();

export default AutoRemediationRuleEngineService;
