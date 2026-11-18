import Alert from "../../Models/DatabaseModels/Alert";
import AlertPrivacyRule from "../../Models/DatabaseModels/AlertPrivacyRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import AlertFeedService from "./AlertFeedService";
import AlertPrivacyRuleService from "./AlertPrivacyRuleService";
import AlertService from "./AlertService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { Red500 } from "../../Types/BrandColors";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { MarkdownText, mdText } from "../../Utils/Markdown/FeedMarkdown";
import RuleFeedMarkdown from "../Utils/Rules/RuleFeedMarkdown";
import logger, { LogAttributes } from "../Utils/Logger";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import RuleSetCache from "../Utils/Rules/RuleSetCache";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
  RuleRunWriteProps,
} from "../Utils/Rules/RuleRun/RuleApplication";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import PatternWorkScope, { RuleEvaluation } from "../Utils/PatternWorkScope";
import ObjectID from "../../Types/ObjectID";
import MonitorRuleCriteriaCache from "../Utils/Rules/MonitorRuleCriteriaCache";
import {
  PrivacyRulePlan,
  getPrivacyRulesThatApply,
  makePrivacyRulePlan,
} from "../Utils/Rules/PrivacyRulePlan";

class AlertPrivacyRuleEngineServiceClass
  implements RuleRunEngine<Alert, AlertPrivacyRule>
{
  public readonly ruleSelect: Select<AlertPrivacyRule> = {
    _id: true,
    name: true,
    criteria: true,
    monitors: { _id: true },
    alertSeverities: { _id: true },
    alertLabels: { _id: true },
    monitorLabels: { _id: true },
    alertTitlePattern: true,
    alertDescriptionPattern: true,
    monitorNamePattern: true,
    monitorDescriptionPattern: true,
  };

  /*
   * Evaluation reads these straight off the alert it is handed (the
   * monitor's name, description and labels are then re-read by monitorId),
   * and a run must see isPrivate to report an alert that is already private.
   */
  public readonly resourceSelectForRuleRun: Select<Alert> = {
    _id: true,
    projectId: true,
    isPrivate: true,
    title: true,
    description: true,
    alertSeverityId: true,
    monitorId: true,
    labels: { _id: true },
  };

  /**
   * Evaluates AlertPrivacyRule rows for the given alert. If any enabled rule
   * matches, the alert is marked private (isPrivate=true) and the passed-in
   * alert object is mutated in place so downstream callers see the update.
   *
   * Returns true if the alert was marked private by a rule.
   */
  @CaptureSpan()
  public async applyRulesToAlert(alert: Alert): Promise<boolean> {
    if (!alert.id || !alert.projectId) {
      return false;
    }

    if (alert.isPrivate === true) {
      // Already private — nothing to do.
      return false;
    }

    try {
      const rules: Array<AlertPrivacyRule> = await this.getEnabledRules(
        alert.projectId,
      );

      if (rules.length === 0) {
        return false;
      }

      const result: RuleApplicationResult = await this.applyRules({
        alert: alert,
        rules: rules,
      });

      return result.updated;
    } catch (error) {
      logger.error(`Error applying alert privacy rules: ${error}`, {
        projectId: alert.projectId?.toString(),
        alertId: alert.id?.toString(),
      } as LogAttributes);
      return false;
    }
  }

  /*
   * The project's enabled rules, as every evaluation of a new alert reads
   * them - the create and "When this goes down" alike. Kept until any of
   * the project's rules changes (RuleSetCache).
   */
  @CaptureSpan()
  public async getEnabledRules(
    projectId: ObjectID,
  ): Promise<Array<AlertPrivacyRule>> {
    const rules: Array<AlertPrivacyRule> =
      await RuleSetCache.findEnabledRules<AlertPrivacyRule>({
        service: AlertPrivacyRuleService,
        projectId: projectId,
        select: this.ruleSelect,
      });

    logIfRuleReadWasTruncated({
      ruleKind: "AlertPrivacyRule",
      projectId: projectId,
      rulesRead: rules.length,
    });

    return rules;
  }

  /*
   * Which of `rules` make the alert private (PrivacyRulePlan) - read, never
   * written. The create and a run carry it out (applyRules), and "When this
   * goes down" (WhoIsToldService) reads it for the alert a monitor's
   * criteria would open, held in memory (#7213). The monitor is read
   * through `monitorCache`: one shared by many matchings, or seeded with a
   * monitor not saved yet.
   */
  @RuleEvaluation()
  public async planRules(data: {
    alert: Alert;
    rules: Array<AlertPrivacyRule>;
    monitorCache?: MonitorRuleCriteriaCache | undefined;
  }): Promise<PrivacyRulePlan<AlertPrivacyRule>> {
    const matchedRules: Array<AlertPrivacyRule> = [];
    const uncheckedRules: Array<AlertPrivacyRule> = [];
    const monitorCache: MonitorRuleCriteriaCache =
      data.monitorCache || new MonitorRuleCriteriaCache();

    for (const rule of data.rules) {
      const stoppedBefore: number = PatternWorkScope.stoppedQuestions();
      const matches: boolean = await this.doesAlertMatchRule(
        data.alert,
        rule,
        monitorCache,
      );

      if (matches) {
        matchedRules.push(rule);
      } else if (PatternWorkScope.stoppedQuestions() > stoppedBefore) {
        /*
         * Its patterns could not all be answered: together with the other
         * rules' they needed more work than one evaluation may take
         * (Utils/LinearRegExp/PatternWork.ts). The rule may have matched,
         * so it counts as one that did: a record is never shown to the whole
         * project because a pattern was not read to the end.
         */
        uncheckedRules.push(rule);
      }
    }

    return makePrivacyRulePlan({
      matchedRules: matchedRules,
      uncheckedRules: uncheckedRules,
    });
  }

  /*
   * "Run now": the same evaluation, for an alert that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Alert, AlertPrivacyRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        alert: data.resource,
        rules: data.rules,
        props: data.props,
      });
    } catch (error) {
      logger.error(`Error running alert privacy rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        alertId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  // Carries the plan out (planRules): the one place a privacy rule writes.
  private async applyRules(data: {
    alert: Alert;
    rules: Array<AlertPrivacyRule>;
    // Who ran the rule (Run now); none for a rule applied on create.
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<RuleApplicationResult> {
    const { alert, rules } = data;

    if (!alert.id || !alert.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const plan: PrivacyRulePlan<AlertPrivacyRule> = await this.planRules({
      alert: alert,
      rules: rules,
    });

    if (!plan.makesPrivate) {
      return RuleApplicationResultUtil.noMatch();
    }

    const { matchedRules, uncheckedRules } = plan;

    /*
     * The create hook returns before evaluating an already-private alert; a
     * run evaluates it anyway so it can report the rule as already applied.
     */
    if (alert.isPrivate === true) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    await AlertService.updateOneById({
      id: alert.id,
      data: { isPrivate: true },
      props: RuleRunWriteProps.get(data.props),
    });

    // Mirror in memory so downstream onCreateSuccess steps see the change.
    alert.isPrivate = true;

    logger.debug(`AlertPrivacyRuleEngine marked alert ${alert.id} private`, {
      projectId: alert.projectId.toString(),
    } as LogAttributes);

    await this.createRuleExecutedFeedItem({
      alert,
      matchedRules,
      uncheckedRules,
    });

    return RuleApplicationResultUtil.updated(1);
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    alert: Alert;
    matchedRules: Array<AlertPrivacyRule>;
    uncheckedRules: Array<AlertPrivacyRule>;
  }): Promise<void> {
    const { alert, matchedRules, uncheckedRules } = data;
    if (
      !alert.id ||
      !alert.projectId ||
      (matchedRules.length === 0 && uncheckedRules.length === 0)
    ) {
      return;
    }

    try {
      /*
       * The rules that matched; or, when none did, the ones that could not
       * be checked in full and so counted as matching.
       */
      const ruleNames: Array<string> = getPrivacyRulesThatApply({
        matchedRules: matchedRules,
        uncheckedRules: uncheckedRules,
        makesPrivate: true,
      })
        .map((r: AlertPrivacyRule) => {
          return r.name?.toString() || "Unnamed Rule";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const headline: MarkdownText =
        matchedRules.length > 0
          ? RuleFeedMarkdown.executedLine({
              emoji: "🔒",
              ruleKind: "Alert Privacy Rule",
              ruleNames: ruleNames,
            })
          : RuleFeedMarkdown.notCheckedInFullLine({
              emoji: "🔒",
              ruleKind: "Alert Privacy Rule",
              ruleNames: ruleNames,
            });

      const feedInfoInMarkdown: MarkdownText = mdText`${headline}\n\nAlert has been marked **private** — visible only to its owners, Project Admins, and Project Owners.`;

      await AlertFeedService.createAlertFeedItem({
        alertId: alert.id,
        projectId: alert.projectId,
        alertFeedEventType: AlertFeedEventType.PrivacyRuleExecuted,
        displayColor: Red500,
        feedInfoInMarkdown: feedInfoInMarkdown.toString(),
      });
    } catch (error) {
      logger.error(
        `AlertPrivacyRuleEngine: failed to create rule-executed feed item: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          projectId: alert.projectId?.toString(),
          alertId: alert.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  @CaptureSpan()
  private async doesAlertMatchRule(
    alert: Alert,
    rule: AlertPrivacyRule,
    monitorCache: MonitorRuleCriteriaCache = new MonitorRuleCriteriaCache(),
  ): Promise<boolean> {
    return await RuleCriteriaMatcher.matchesWithLegacy({
      rule,
      legacyFields: [
        "monitors",
        "alertSeverities",
        "alertLabels",
        "monitorLabels",
        "alertTitlePattern",
        "alertDescriptionPattern",
        "monitorNamePattern",
        "monitorDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: async (
        legacyRule: AlertPrivacyRule,
      ): Promise<boolean> => {
        return await this.doesAlertMatchLegacyRule(
          alert,
          legacyRule,
          monitorCache,
        );
      },
    });
  }

  private async doesAlertMatchLegacyRule(
    alert: Alert,
    rule: AlertPrivacyRule,
    monitorCache: MonitorRuleCriteriaCache,
  ): Promise<boolean> {
    if (rule.monitors && rule.monitors.length > 0) {
      if (!alert.monitorId) {
        return false;
      }
      const ruleMonitorIds: Array<string> = rule.monitors.map((m: Monitor) => {
        return m.id?.toString() || "";
      });
      if (!ruleMonitorIds.includes(alert.monitorId.toString())) {
        return false;
      }
    }

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

    if (rule.alertLabels && rule.alertLabels.length > 0) {
      if (!alert.labels || alert.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.alertLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const alertLabelIds: Array<string> = alert.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      if (
        !ruleLabelIds.some((id: string) => {
          return alertLabelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    const hasMonitorCriteria: boolean = Boolean(
      (rule.monitorLabels && rule.monitorLabels.length > 0) ||
        rule.monitorNamePattern ||
        rule.monitorDescriptionPattern,
    );

    if (hasMonitorCriteria) {
      if (!alert.monitorId) {
        return false;
      }
      // Its name, description and labels (MonitorRuleCriteriaCache.getMonitor).
      const monitor: Monitor | null = await monitorCache.getMonitor(
        alert.monitorId,
      );
      if (!monitor) {
        return false;
      }

      if (rule.monitorLabels && rule.monitorLabels.length > 0) {
        if (!monitor.labels || monitor.labels.length === 0) {
          return false;
        }
        const ruleMonitorLabelIds: Array<string> = rule.monitorLabels.map(
          (l: Label) => {
            return l.id?.toString() || "";
          },
        );
        const monitorLabelIds: Array<string> = monitor.labels.map(
          (l: Label) => {
            return l.id?.toString() || "";
          },
        );
        if (
          !ruleMonitorLabelIds.some((id: string) => {
            return monitorLabelIds.includes(id);
          })
        ) {
          return false;
        }
      }

      if (
        rule.monitorNamePattern &&
        (!monitor.name ||
          !this.testRegex(rule.monitorNamePattern, monitor.name, rule))
      ) {
        return false;
      }

      if (
        rule.monitorDescriptionPattern &&
        (!monitor.description ||
          !this.testRegex(
            rule.monitorDescriptionPattern,
            monitor.description,
            rule,
          ))
      ) {
        return false;
      }
    }

    if (
      rule.alertTitlePattern &&
      (!alert.title ||
        !this.testRegex(rule.alertTitlePattern, alert.title, rule))
    ) {
      return false;
    }

    if (
      rule.alertDescriptionPattern &&
      (!alert.description ||
        !this.testRegex(rule.alertDescriptionPattern, alert.description, rule))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: AlertPrivacyRule,
  ): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(`Invalid regex in alert privacy rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new AlertPrivacyRuleEngineServiceClass();
