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
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";
import WorkspaceRecordOwners from "../Utils/Workspace/WorkspaceRecordOwners";
import {
  getOwnersMeetingRuleCriteriaOwnerFilter,
  matchesRuleCriteriaOwnerFilter,
} from "../../Utils/Rules/RuleCriteriaOwnerMatch";
import RuleCriteria, {
  RuleCriteriaFilter,
} from "../../Types/Rules/RuleCriteria";
import { getRuleCriteriaOwnerFieldsForModel } from "../../Types/Rules/RuleCriteriaFieldRegistry";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import OnCallRulePolicyScope from "../Utils/Rules/OnCallRulePolicyScope";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import RuleSetCache from "../Utils/Rules/RuleSetCache";
import Select from "../Types/Database/Select";
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

// Why the rules of an alert that changed run again (applyRulesToAlert).
export interface AlertOnCallRuleChange {
  // What changed, as the feed says it after "The alert now matches it:".
  reason: string;
  // Only the rules with an Alert Owner condition: its owners changed.
  onlyOwnerRules?: boolean | undefined;
}

/*
 * The ids of the people and teams that own an alert, as an Alert Owner
 * condition matches them (WorkspaceRecordOwners, as a workspace rule's owner
 * condition reads them): read the first time a rule asks, and kept for the
 * other rules matched against the alert at the same time.
 *
 * An alert not saved yet has no owner rows. "When this goes down" asks
 * about one a monitor would open (#9407), and hands in the owners its
 * create will give it - the people and teams its criteria names, the
 * network device's owners and whom its owner rules add, as owner rows are
 * written: the members of the project and the project's teams
 * (WhoIsToldService) - which are read instead. Without them it has none.
 */
export class AlertOwnerIdsReader {
  private ownerIds: Promise<Array<string>> | null = null;

  public constructor(
    private readonly alert: Alert,
    private readonly knownOwnerIds?: ReadonlyArray<string> | undefined,
  ) {}

  public read(): Promise<Array<string>> {
    if (!this.ownerIds) {
      const alertId: ObjectID | undefined = this.alert.id || undefined;

      if (this.knownOwnerIds) {
        this.ownerIds = Promise.resolve([...this.knownOwnerIds]);
      } else {
        this.ownerIds = alertId
          ? WorkspaceRecordOwners.getOwnerIds({
              recordKey: "alertId",
              recordId: alertId,
            })
          : Promise.resolve([]);
      }
    }

    return this.ownerIds;
  }
}

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
   *
   * `change` is for an alert that changed rather than was created: its
   * owners did (AlertOnCallRulesOnOwnerChange). Only the rules with an
   * Alert Owner condition are matched then (onlyOwnerRules) - nothing else
   * the others match on changed - and the feed entry says the rule now
   * matches the alert, and why. OneUptime AI responds first to new alerts
   * only, so a rule set to After OneUptime AI pages right away.
   */
  @CaptureSpan()
  @RuleEvaluation()
  public async applyRulesToAlert(
    alert: Alert,
    change?: AlertOnCallRuleChange | undefined,
  ): Promise<OnCallRulesPaging> {
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
      const rules: Array<AlertOnCallRule> = await this.getMatchingRules(
        alert,
        undefined,
        { onlyOwnerRules: Boolean(change?.onlyOwnerRules) },
      );

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
            aiHold = change
              ? { canHold: false }
              : await AiFirstResponderEligibility.decideForAlert(alert);
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
      const { toAddPolicyIds, observerPolicyIds } = splitOnCallRulePolicies({
        matchedPolicyIds: Array.from(matchedPolicies.keys()),
        existingPolicyIds: existingIds,
        roles: pageRoles,
      });

      /*
       * Persist the new join rows so the alert detail UI shows the
       * rule-attached policies alongside any manually-attached ones. A
       * policy attached already by now - by the rules of an owner change
       * that ran at the same moment (AlertOnCallRulesOnOwnerChange), or by
       * the alert's creation - is left out: they page it.
       */
      const toAddIds: Array<string> = await this.attachPolicies({
        alert: alert,
        policyIds: toAddPolicyIds,
      });

      for (const policyId of toAddIds) {
        merged.push(matchedPolicies.get(policyId)!);
      }

      /*
       * Update in-memory list so the existing on-call fan-out runs the merged
       * set in the next .then() step of onCreateSuccess.
       */
      alert.onCallDutyPolicies = merged;

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
          ruleChange: change?.reason,
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

    // Read once, by the first rule that asks who owns the alert.
    const owners: AlertOwnerIdsReader = new AlertOwnerIdsReader(alert);

    for (const rule of await this.findEnabledRules(alert.projectId)) {
      if (
        !rule.onCallDutyPolicies ||
        rule.onCallDutyPolicies.length === 0 ||
        !OnCallRulePagingHoldUtil.isPagingNow(rule, now)
      ) {
        continue;
      }

      if (!(await this.doesAlertMatchRule(alert, rule, undefined, owners))) {
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
   * matching reads nothing per alert. It is the same matching either way. A
   * reader of one alert hands in only the cache - seeded with a monitor not
   * saved yet, say - and the rules are read as ever.
   *
   * `options.ownerIds` are the owners of an alert not saved yet, as its
   * create will give them (#9407): an Alert Owner condition is matched on
   * them, as the real alert's is on its owner rows (AlertOwnerIdsReader).
   */
  @CaptureSpan()
  @RuleEvaluation()
  public async getMatchingRules(
    alert: Alert,
    preloaded?:
      | {
          rules?: Array<AlertOnCallRule> | undefined;
          monitorCache: MonitorRuleCriteriaCache;
        }
      | undefined,
    options?: {
      // Only the rules with an Alert Owner condition (applyRulesToAlert's change).
      onlyOwnerRules?: boolean | undefined;
      // Who will own an alert not saved yet, by id: people and teams alike.
      ownerIds?: ReadonlyArray<string> | undefined;
    },
  ): Promise<Array<AlertOnCallRule>> {
    if (!alert.projectId) {
      return [];
    }

    const matching: Array<AlertOnCallRule> = [];

    const rules: Array<AlertOnCallRule> =
      preloaded?.rules || (await this.findEnabledRules(alert.projectId));

    // Read once, by the first rule that asks who owns the alert.
    const owners: AlertOwnerIdsReader = new AlertOwnerIdsReader(
      alert,
      options?.ownerIds,
    );

    for (const rule of rules) {
      if (!rule.onCallDutyPolicies || rule.onCallDutyPolicies.length === 0) {
        continue;
      }

      if (options?.onlyOwnerRules && !this.hasOwnerCondition(rule)) {
        continue;
      }

      if (
        await this.doesAlertMatchRule(
          alert,
          rule,
          preloaded?.monitorCache,
          owners,
        )
      ) {
        matching.push(rule);
      }
    }

    return matching;
  }

  /*
   * Whether any of the project's enabled rules that page a policy asks who
   * owns the alert: when none does, an owner change has nothing to run
   * (AlertOnCallRulesOnOwnerChange). The rules are cached (RuleSetCache).
   */
  public async hasRulesWithOwnerCondition(
    projectId: ObjectID,
  ): Promise<boolean> {
    return (await this.findEnabledRules(projectId)).some(
      (rule: AlertOnCallRule): boolean => {
        return (
          Boolean(rule.onCallDutyPolicies?.length) &&
          this.hasOwnerCondition(rule)
        );
      },
    );
  }

  /*
   * Whether a rule asks who owns the alert: an Alert Owner condition
   * (RULE_CRITERIA_OWNER_FIELDS_BY_MODEL). The only rules an owner change
   * can make match, or stop matching.
   */
  public hasOwnerCondition(rule: AlertOnCallRule): boolean {
    const criteria: RuleCriteria | null | undefined = rule.criteria as
      | RuleCriteria
      | null
      | undefined;

    if (!criteria || !Array.isArray(criteria.filters)) {
      return false;
    }

    const ownerFields: ReadonlyArray<string> =
      getRuleCriteriaOwnerFieldsForModel("AlertOnCallRule");

    return criteria.filters.some((filter: RuleCriteriaFilter): boolean => {
      return ownerFields.includes(filter?.field);
    });
  }

  /*
   * THE OWNERS THAT MAKE A RULE MATCH (#9407): of an alert's owners, the
   * people and teams an Alert Owner condition of the rule picks ("is any of
   * Payments"), each once, in the order the conditions pick them - what
   * "When this goes down" says made the rule match, as it names a label rule
   * whose label did (#7212). None for a rule without such a condition, or
   * one whose owner condition is "is none of": no owner makes that hold.
   */
  public getOwnersMakingRuleMatch(data: {
    rule: AlertOnCallRule;
    ownerIds: ReadonlyArray<string>;
  }): Array<string> {
    const criteria: RuleCriteria | null | undefined = data.rule.criteria as
      | RuleCriteria
      | null
      | undefined;

    if (!criteria || !Array.isArray(criteria.filters)) {
      return [];
    }

    const ownerFields: ReadonlyArray<string> =
      getRuleCriteriaOwnerFieldsForModel("AlertOnCallRule");
    const met: Array<string> = [];

    for (const filter of criteria.filters) {
      if (!filter || !ownerFields.includes(filter.field)) {
        continue;
      }

      for (const id of getOwnersMeetingRuleCriteriaOwnerFilter({
        filter: filter,
        ownerIds: data.ownerIds,
      })) {
        if (!met.includes(id)) {
          met.push(id);
        }
      }
    }

    return met;
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

  // What matching the project's alert on-call rules needs of each.
  private readonly ruleSelect: Select<AlertOnCallRule> = {
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
  };

  /*
   * The project's enabled alert on-call rules, with what matching them
   * needs: kept until any of the project's rules changes (RuleSetCache).
   */
  private async findEnabledRules(
    projectId: ObjectID,
  ): Promise<Array<AlertOnCallRule>> {
    const rules: Array<AlertOnCallRule> =
      await RuleSetCache.findEnabledRules<AlertOnCallRule>({
        service: AlertOnCallRuleService,
        projectId: projectId,
        select: this.ruleSelect,
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
    // Why the rules ran again on a change, when they did.
    ruleChange?: string | undefined;
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
      )}${
        data.ruleChange
          ? mdText`\n\nThe alert now matches ${
              ruleNames.length > 1 ? "them" : "it"
            }: ${data.ruleChange}.`
          : ""
      }\n\n${RuleFeedMarkdown.onCallRulePolicies({
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
    // Who owns the alert, read once for every rule matched against it.
    owners?: AlertOwnerIdsReader | undefined,
  ): Promise<boolean> {
    const ownerIds: AlertOwnerIdsReader =
      owners || new AlertOwnerIdsReader(alert);

    return await RuleCriteriaMatcher.matchesWithLegacy({
      rule,
      /*
       * Alert Owner (#9353): one of the people and teams picked is among the
       * alert's owners, or none is - read when a rule asks, not before.
       */
      recordFields: {
        alertOwners: async (filter: RuleCriteriaFilter): Promise<boolean> => {
          return matchesRuleCriteriaOwnerFilter({
            filter: filter,
            ownerIds: await ownerIds.read(),
          });
        },
      },
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

  /*
   * Attaches each policy to the alert, one at a time, and hands back the
   * ones the alert is to page: a policy attached to it already - attached
   * by the rules of an owner change that ran at the same moment, or by the
   * alert's creation (AlertOnCallRulesOnOwnerChange) - is the other's to
   * page, so it is left out. Any other failure to attach a policy still
   * pages it, as it always has: a page matters more than the alert's list.
   */
  private async attachPolicies(data: {
    alert: Alert;
    policyIds: Array<string>;
  }): Promise<Array<string>> {
    const toPage: Array<string> = [];

    for (const policyId of data.policyIds) {
      try {
        await AlertService.getRepository()
          .createQueryBuilder()
          .relation(Alert, "onCallDutyPolicies")
          .of(data.alert.id!.toString())
          .add(policyId);

        toPage.push(policyId);
      } catch (err) {
        if (PostgresErrorTranslator.isUniqueViolation(err)) {
          continue;
        }

        logger.warn(
          `AlertOnCallRuleEngine: failed to persist join row of policy ${policyId} for alert ${data.alert.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );

        toPage.push(policyId);
      }
    }

    return toPage;
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
