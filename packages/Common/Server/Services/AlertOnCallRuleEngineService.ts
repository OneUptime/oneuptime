import Alert from "../../Models/DatabaseModels/Alert";
import AlertOnCallRule from "../../Models/DatabaseModels/AlertOnCallRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import AlertFeedService from "./AlertFeedService";
import AlertOnCallRuleService from "./AlertOnCallRuleService";
import AlertService from "./AlertService";
import MonitorService from "./MonitorService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import { MarkdownText, mdText } from "../../Utils/Markdown/FeedMarkdown";
import RuleFeedMarkdown from "../Utils/Rules/RuleFeedMarkdown";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import OnCallRulePolicyScope from "../Utils/Rules/OnCallRulePolicyScope";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import MonitorRuleCriteriaCache from "../Utils/Rules/MonitorRuleCriteriaCache";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import { RuleEvaluation } from "../Utils/PatternWorkScope";
import OnCallRulePagingHoldUtil, {
  ON_CALL_RULE_WHEN_TO_PAGE_SELECT,
  OnCallRulePagingHolds,
} from "../Utils/OnCall/OnCallRulePagingHold";
import {
  ON_CALL_RULE_PAGE_AS_SELECT,
  OnCallRulePageRoles,
  OnCallRulesPaging,
  getNoOnCallRulesPaging,
  splitOnCallRulePolicies,
} from "../Utils/OnCall/OnCallRulePageAs";
import OnCallRuleWhenToPage from "../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import AiFirstResponder from "../Utils/AI/FirstResponder/AiFirstResponder";
import AiFirstResponderEligibility, {
  AiHoldDecision,
} from "../Utils/AI/FirstResponder/AiFirstResponderEligibility";

class AlertOnCallRuleEngineServiceClass {
  /**
   * Evaluates AlertOnCallRule rows for the given alert and merges any
   * matching rules' on-call policies into the alert's onCallDutyPolicies
   * array (deduped). The caller's existing on-call fan-out then runs the
   * merged list, so each policy executes at most once per alert.
   *
   * Hands back the holds of the policies it added that may not page yet: a
   * rule that pages only during working hours, matched outside them, holds
   * its policies until they begin (OnCallRulePagingHold). The fan-out passes
   * each to executePolicy. A policy with no hold pages right away.
   */
  @CaptureSpan()
  @RuleEvaluation()
  public async applyRulesToAlert(alert: Alert): Promise<OnCallRulesPaging> {
    const noHolds: OnCallRulesPaging = getNoOnCallRulesPaging();

    if (!alert.id || !alert.projectId) {
      return noHolds;
    }

    try {
      /*
       * The rules that match it and page a policy - the one matching "When
       * this goes down" (WhoIsToldService) reads too, so what it shows a
       * monitor's alerts would page is what they page.
       */
      const rules: Array<AlertOnCallRule> = await this.getMatchingRules(alert);

      if (rules.length === 0) {
        return noHolds;
      }

      const matchedPolicies: Map<string, OnCallDutyPolicy> = new Map();
      const matchedRules: Array<AlertOnCallRule> = [];
      // When each matched rule lets its policies page: right away wins.
      const pagingHolds: OnCallRulePagingHolds = new OnCallRulePagingHolds();
      // What each matched rule pages its policies as: responders win.
      const pageRoles: OnCallRulePageRoles = new OnCallRulePageRoles();
      /*
       * Whether OneUptime AI may respond first to the alert: asked once, when
       * a rule set to After OneUptime AI matches it (AiFirstResponderEligibility).
       */
      let aiHold: AiHoldDecision | undefined = undefined;

      for (const rule of rules) {
        if (rule.onCallDutyPolicies && rule.onCallDutyPolicies.length > 0) {
          if (
            rule.whenToPage === OnCallRuleWhenToPage.AfterOneUptimeAI &&
            !aiHold
          ) {
            aiHold = await AiFirstResponderEligibility.decideForAlert(alert);
          }

          pagingHolds.addRule(
            rule,
            rule.onCallDutyPolicies.map((policy: OnCallDutyPolicy): string => {
              return policy.id?.toString() || "";
            }),
            aiHold,
          );
          pageRoles.addRule(
            rule,
            rule.onCallDutyPolicies.map((policy: OnCallDutyPolicy): string => {
              return policy.id?.toString() || "";
            }),
          );

          let ruleAddedAny: boolean = false;
          for (const policy of rule.onCallDutyPolicies) {
            const policyId: string | undefined = policy.id?.toString();
            if (policyId && !matchedPolicies.has(policyId)) {
              matchedPolicies.set(policyId, policy);
              ruleAddedAny = true;
            }
          }
          if (ruleAddedAny) {
            matchedRules.push(rule);
          }
        }
      }

      // Only the project's own policies are ever paged (see OnCallRulePolicyScope).
      await OnCallRulePolicyScope.keepPoliciesInProject({
        projectId: alert.projectId,
        matchedPolicies: matchedPolicies,
        matchedRules: matchedRules,
        ruleKind: "Alert on-call",
        logAttributes: {
          projectId: alert.projectId.toString(),
          alertId: alert.id.toString(),
        } as LogAttributes,
      });

      if (matchedPolicies.size === 0) {
        return noHolds;
      }

      const existingIds: Set<string> = new Set(
        (alert.onCallDutyPolicies || [])
          .map((p: OnCallDutyPolicy) => {
            return p.id?.toString() || (p as { _id?: string })._id || "";
          })
          .filter((id: string) => {
            return id !== "";
          }),
      );

      const merged: Array<OnCallDutyPolicy> = [
        ...(alert.onCallDutyPolicies || []),
      ];

      /*
       * The responder policies are added to the alert; the observer
       * policies are paged beside it (OnCallRulePageAs).
       */
      const { toAddPolicyIds: toAddIds, observerPolicyIds } =
        splitOnCallRulePolicies({
          matchedPolicyIds: Array.from(matchedPolicies.keys()),
          existingPolicyIds: existingIds,
          roles: pageRoles,
        });

      for (const policyId of toAddIds) {
        merged.push(matchedPolicies.get(policyId)!);
      }

      /*
       * Update in-memory list so the existing on-call fan-out runs the merged
       * set in the next .then() step of onCreateSuccess.
       */
      alert.onCallDutyPolicies = merged;

      /*
       * Persist the new join rows so the alert detail UI shows the
       * rule-attached policies alongside any manually-attached ones.
       */
      if (toAddIds.length > 0) {
        try {
          await AlertService.getRepository()
            .createQueryBuilder()
            .relation(Alert, "onCallDutyPolicies")
            .of(alert.id.toString())
            .add(toAddIds);
        } catch (err) {
          logger.warn(
            `AlertOnCallRuleEngine: failed to persist join rows for alert ${alert.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      logger.debug(
        `AlertOnCallRuleEngine merged ${matchedPolicies.size} matched policies into alert ${alert.id}`,
        { projectId: alert.projectId.toString() } as LogAttributes,
      );

      if (toAddIds.length > 0 || observerPolicyIds.length > 0) {
        await this.createRuleExecutedFeedItem({
          alert,
          matchedRules,
          addedPolicyIds: toAddIds,
          observerPolicyIds: observerPolicyIds,
        });
      }

      // A rule set to After OneUptime AI that paged right away says why.
      if (
        aiHold &&
        !aiHold.canHold &&
        aiHold.reason &&
        (toAddIds.length > 0 || observerPolicyIds.length > 0)
      ) {
        await AiFirstResponder.sayWhyNotHeld({
          projectId: alert.projectId,
          alertId: alert.id,
          reason: aiHold.reason,
        });
      }

      // A policy the alert had already pages as it always has: right away.
      return {
        addedPolicyIds: toAddIds,
        observerPolicyIds: observerPolicyIds,
        holds: pagingHolds.getHolds([...toAddIds, ...observerPolicyIds]),
      };
    } catch (error) {
      logger.error(`Error applying alert on-call rules: ${error}`, {
        projectId: alert.projectId?.toString(),
        alertId: alert.id?.toString(),
      } as LogAttributes);

      return noHolds;
    }
  }

  /*
   * The policies the alert's matching rules page now, each with the names of
   * the rules that do: a rule that pages right away, or a working-hours rule
   * inside its hours (OnCallRulePagingHoldUtil.isPagingNow) - never one set
   * to After OneUptime AI, whose holds start when AI hands them off
   * (AiFirstResponder). Reads only: it adds no policy to the alert. For an alert that changed while some of its runs
   * wait for working hours (WaitingRunsOnRecordChange).
   */
  @CaptureSpan()
  @RuleEvaluation()
  public async getPoliciesPagingNow(
    alert: Alert,
    now: Date,
  ): Promise<Map<string, Array<string>>> {
    const pagingNow: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    if (!alert.id || !alert.projectId) {
      return pagingNow;
    }

    for (const rule of await this.findEnabledRules(alert.projectId)) {
      if (
        !rule.onCallDutyPolicies ||
        rule.onCallDutyPolicies.length === 0 ||
        !OnCallRulePagingHoldUtil.isPagingNow(rule, now)
      ) {
        continue;
      }

      if (!(await this.doesAlertMatchRule(alert, rule))) {
        continue;
      }

      for (const policy of rule.onCallDutyPolicies) {
        const policyId: string | undefined = policy.id?.toString();

        if (!policyId) {
          continue;
        }

        pagingNow.set(policyId, [
          ...(pagingNow.get(policyId) || []),
          rule.name?.toString() || "",
        ]);
      }
    }

    return pagingNow;
  }

  /*
   * The project's enabled rules that match the alert and page a policy, in
   * the order they are read. Reads only: nothing is attached, paged or
   * written. The engine pages what they name (applyRulesToAlert), and
   * "When this goes down" (WhoIsToldService) shows them for an alert a
   * monitor's criteria would open, held in memory - so the two answer from
   * one matching and never disagree.
   *
   * `preloaded` is for a reader that asks about many alerts of one project
   * at once (Setup health, #6812, through WhoIsToldService.resolveProject):
   * the project's enabled rules, read once with readEnabledRules, and the
   * monitors those alerts come from (MonitorRuleCriteriaCache.seed), so the
   * matching reads nothing per alert. It is the same matching either way.
   */
  @CaptureSpan()
  @RuleEvaluation()
  public async getMatchingRules(
    alert: Alert,
    preloaded?:
      | {
          rules: Array<AlertOnCallRule>;
          monitorCache: MonitorRuleCriteriaCache;
        }
      | undefined,
  ): Promise<Array<AlertOnCallRule>> {
    if (!alert.projectId) {
      return [];
    }

    const matching: Array<AlertOnCallRule> = [];

    const rules: Array<AlertOnCallRule> = preloaded
      ? preloaded.rules
      : await this.findEnabledRules(alert.projectId);

    for (const rule of rules) {
      if (!rule.onCallDutyPolicies || rule.onCallDutyPolicies.length === 0) {
        continue;
      }

      if (await this.doesAlertMatchRule(alert, rule, preloaded?.monitorCache)) {
        matching.push(rule);
      }
    }

    return matching;
  }

  /*
   * The project's enabled rules, read as getMatchingRules reads them: for a
   * reader that matches many alerts against them (getMatchingRules'
   * `preloaded`).
   */
  public async readEnabledRules(
    projectId: ObjectID,
  ): Promise<Array<AlertOnCallRule>> {
    return await this.findEnabledRules(projectId);
  }

  // The project's enabled alert on-call rules, with what matching them needs.
  private async findEnabledRules(
    projectId: ObjectID,
  ): Promise<Array<AlertOnCallRule>> {
    const rules: Array<AlertOnCallRule> = await AlertOnCallRuleService.findBy({
      query: {
        projectId: projectId,
        isEnabled: true,
      },
      props: { isRoot: true },
      select: {
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
        onCallDutyPolicies: { _id: true },
        ...ON_CALL_RULE_WHEN_TO_PAGE_SELECT,
        ...ON_CALL_RULE_PAGE_AS_SELECT,
      },
      limit: MAX_RULES_EVALUATED_PER_PROJECT,
      skip: 0,
    });

    logIfRuleReadWasTruncated({
      ruleKind: "AlertOnCallRule",
      projectId: projectId,
      rulesRead: rules.length,
    });

    return rules;
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    alert: Alert;
    matchedRules: Array<AlertOnCallRule>;
    addedPolicyIds: Array<string>;
    // The policies paged as observers (OnCallRulePageAs), not attached.
    observerPolicyIds: Array<string>;
  }): Promise<void> {
    const { alert, matchedRules, addedPolicyIds, observerPolicyIds } = data;
    if (
      !alert.id ||
      !alert.projectId ||
      matchedRules.length === 0 ||
      (addedPolicyIds.length === 0 && observerPolicyIds.length === 0)
    ) {
      return;
    }

    try {
      const policyObjectIds: Array<ObjectID> = [
        ...addedPolicyIds,
        ...observerPolicyIds,
      ].map((id: string) => {
        return new ObjectID(id);
      });

      const policies: Array<OnCallDutyPolicy> =
        await OnCallDutyPolicyService.findBy({
          query: {
            _id: QueryHelper.any(policyObjectIds),
          },
          select: { _id: true, name: true },
          props: { isRoot: true },
          limit: LIMIT_MAX,
          skip: 0,
        });

      const policyNameById: Map<string, string> = new Map<string, string>();

      for (const policy of policies) {
        const name: string = policy.name?.toString() || "";

        if (policy.id && name) {
          policyNameById.set(policy.id.toString(), name);
        }
      }

      const namesOf: (ids: Array<string>) => Array<string> = (
        ids: Array<string>,
      ): Array<string> => {
        return ids
          .map((id: string): string => {
            return policyNameById.get(id) || "";
          })
          .filter((name: string): boolean => {
            return name !== "";
          });
      };

      const ruleNames: Array<string> = matchedRules
        .map((r: AlertOnCallRule) => {
          return r.name?.toString() || "Unnamed Rule";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const feedInfoInMarkdown: MarkdownText = mdText`${RuleFeedMarkdown.executedLine(
        {
          emoji: "📞",
          ruleKind: "Alert On-Call Rule",
          ruleNames: ruleNames,
        },
      )}\n\n${RuleFeedMarkdown.onCallRulePolicies({
        recordNoun: "alert",
        attachedPolicyNames: namesOf(addedPolicyIds),
        observerPolicyNames: namesOf(observerPolicyIds),
      })}`;

      await AlertFeedService.createAlertFeedItem({
        alertId: alert.id,
        projectId: alert.projectId,
        alertFeedEventType: AlertFeedEventType.OnCallRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown: feedInfoInMarkdown.toString(),
      });
    } catch (error) {
      logger.error(
        `AlertOnCallRuleEngine: failed to create rule-executed feed item: ${
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
    rule: AlertOnCallRule,
    // A cache shared by many matchings (getMatchingRules' `preloaded`).
    sharedMonitorCache?: MonitorRuleCriteriaCache | undefined,
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
        legacyRule: AlertOnCallRule,
      ): Promise<boolean> => {
        return await this.doesAlertMatchLegacyRule(
          alert,
          legacyRule,
          sharedMonitorCache,
        );
      },
    });
  }

  private async doesAlertMatchLegacyRule(
    alert: Alert,
    rule: AlertOnCallRule,
    sharedMonitorCache?: MonitorRuleCriteriaCache | undefined,
  ): Promise<boolean> {
    // Monitors: alert must come from one of the rule's monitors
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

    // Alert labels
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
      const hasMatch: boolean = ruleLabelIds.some((id: string) => {
        return alertLabelIds.includes(id);
      });
      if (!hasMatch) {
        return false;
      }
    }

    // Monitor-derived criteria
    const hasMonitorCriteria: boolean = Boolean(
      (rule.monitorLabels && rule.monitorLabels.length > 0) ||
        rule.monitorNamePattern ||
        rule.monitorDescriptionPattern,
    );

    if (hasMonitorCriteria) {
      if (!alert.monitorId) {
        return false;
      }

      const monitor: Monitor | null = sharedMonitorCache
        ? await sharedMonitorCache.getMonitor(alert.monitorId)
        : await MonitorService.findOneById({
            id: alert.monitorId,
            select: {
              name: true,
              description: true,
              labels: { _id: true },
            },
            props: { isRoot: true },
          });

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
        const hasMatch: boolean = ruleMonitorLabelIds.some((id: string) => {
          return monitorLabelIds.includes(id);
        });
        if (!hasMatch) {
          return false;
        }
      }

      if (rule.monitorNamePattern) {
        if (
          !monitor.name ||
          !this.testRegex(rule.monitorNamePattern, monitor.name, rule)
        ) {
          return false;
        }
      }

      if (rule.monitorDescriptionPattern) {
        if (
          !monitor.description ||
          !this.testRegex(
            rule.monitorDescriptionPattern,
            monitor.description,
            rule,
          )
        ) {
          return false;
        }
      }
    }

    if (rule.alertTitlePattern) {
      if (
        !alert.title ||
        !this.testRegex(rule.alertTitlePattern, alert.title, rule)
      ) {
        return false;
      }
    }

    if (rule.alertDescriptionPattern) {
      if (
        !alert.description ||
        !this.testRegex(rule.alertDescriptionPattern, alert.description, rule)
      ) {
        return false;
      }
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: AlertOnCallRule,
  ): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(
        `Invalid regex pattern in alert on-call rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new AlertOnCallRuleEngineServiceClass();
