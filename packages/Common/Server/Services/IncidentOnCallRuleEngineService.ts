import Incident from "../../Models/DatabaseModels/Incident";
import IncidentOnCallRule from "../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import IncidentFeedService from "./IncidentFeedService";
import IncidentOnCallRuleService from "./IncidentOnCallRuleService";
import IncidentService from "./IncidentService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import { MarkdownText, mdText } from "../../Utils/Markdown/FeedMarkdown";
import RuleFeedMarkdown from "../Utils/Rules/RuleFeedMarkdown";
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";
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

class IncidentOnCallRuleEngineServiceClass {
  /**
   * Evaluates IncidentOnCallRule rows for the given incident and merges any
   * matching rules' responder policies into the incident's
   * onCallDutyPolicies array (deduped). The caller's existing on-call
   * fan-out then runs the merged list, so each policy executes at most once
   * per incident.
   *
   * A rule that pages as observers (OnCallRulePageAs) adds nothing to the
   * incident: its policies are handed back as observer policies, which the
   * caller pages by runs of their own that page as observers - unless the
   * incident has the policy already, or another rule pages it as
   * responders.
   *
   * Hands back what the rules page (OnCallRulesPaging): the responder
   * policies it added, the observer policies, and the holds of those that
   * may not page yet - a rule that pages only during working hours, matched
   * outside them, holds its policies until they begin (OnCallRulePagingHold).
   * The fan-out passes each to executePolicy. A policy with no hold pages
   * right away.
   *
   * `ruleChange` says the incident changed, rather than being created
   * (IncidentRulesOnChange): its feed entry then says the rule now matches
   * it, and why.
   */
  @CaptureSpan()
  @RuleEvaluation()
  public async applyRulesToIncident(
    incident: Incident,
    ruleChange?: string | undefined,
  ): Promise<OnCallRulesPaging> {
    const noHolds: OnCallRulesPaging = getNoOnCallRulesPaging();

    if (!incident.id || !incident.projectId) {
      return noHolds;
    }

    try {
      /*
       * The rules that match it and page a policy - the one matching "When
       * this goes down" (WhoIsToldService) reads too, so what it shows a
       * monitor's incidents would page is what they page.
       */
      const rules: Array<IncidentOnCallRule> =
        await this.getMatchingRules(incident);

      if (rules.length === 0) {
        return noHolds;
      }

      const matchedPolicies: Map<string, OnCallDutyPolicy> = new Map();
      const matchedRules: Array<IncidentOnCallRule> = [];
      // When each matched rule lets its policies page: right away wins.
      const pagingHolds: OnCallRulePagingHolds = new OnCallRulePagingHolds();
      // What each matched rule pages its policies as: responders win.
      const pageRoles: OnCallRulePageRoles = new OnCallRulePageRoles();
      /*
       * Whether OneUptime AI may respond first to the incident: asked once, when
       * a rule set to After OneUptime AI matches it (AiFirstResponderEligibility).
       */
      let aiHold: AiHoldDecision | undefined = undefined;

      for (const rule of rules) {
        if (rule.onCallDutyPolicies && rule.onCallDutyPolicies.length > 0) {
          /*
           * OneUptime AI responds first to new incidents only: a rule set to
           * After OneUptime AI that a changed incident now matches pages
           * right away.
           */
          if (
            rule.whenToPage === OnCallRuleWhenToPage.AfterOneUptimeAI &&
            !aiHold
          ) {
            aiHold = ruleChange
              ? { canHold: false }
              : await AiFirstResponderEligibility.decideForIncident(incident);
          }

          const rulePolicyIds: Array<string> = rule.onCallDutyPolicies.map(
            (policy: OnCallDutyPolicy): string => {
              return policy.id?.toString() || "";
            },
          );

          pagingHolds.addRule(rule, rulePolicyIds, aiHold);
          pageRoles.addRule(rule, rulePolicyIds);

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
        projectId: incident.projectId,
        matchedPolicies: matchedPolicies,
        matchedRules: matchedRules,
        ruleKind: "Incident on-call",
        logAttributes: {
          projectId: incident.projectId.toString(),
          incidentId: incident.id.toString(),
        } as LogAttributes,
      });

      if (matchedPolicies.size === 0) {
        return noHolds;
      }

      const existingIds: Set<string> = new Set(
        (incident.onCallDutyPolicies || [])
          .map((p: OnCallDutyPolicy) => {
            return p.id?.toString() || (p as { _id?: string })._id || "";
          })
          .filter((id: string) => {
            return id !== "";
          }),
      );

      const merged: Array<OnCallDutyPolicy> = [
        ...(incident.onCallDutyPolicies || []),
      ];

      /*
       * The responder policies are added to the incident; the observer
       * policies are paged beside it (OnCallRulePageAs).
       */
      const { toAddPolicyIds, observerPolicyIds } = splitOnCallRulePolicies({
        matchedPolicyIds: Array.from(matchedPolicies.keys()),
        existingPolicyIds: existingIds,
        roles: pageRoles,
      });

      /*
       * Persist the new join rows so the incident detail UI shows the
       * rule-attached policies alongside any manually-attached ones. A
       * policy attached already by now - by the rules of a change to the
       * incident that ran at the same moment (IncidentRulesOnChange) - is
       * left out: they page it.
       */
      const toAddIds: Array<string> = await this.attachPolicies({
        incident: incident,
        policyIds: toAddPolicyIds,
      });

      for (const policyId of toAddIds) {
        merged.push(matchedPolicies.get(policyId)!);
      }

      /*
       * Update in-memory list so the existing on-call fan-out runs the merged
       * set in the next .then() step of onCreateSuccess.
       */
      incident.onCallDutyPolicies = merged;

      logger.debug(
        `IncidentOnCallRuleEngine merged ${matchedPolicies.size} matched policies into incident ${incident.id}`,
        { projectId: incident.projectId.toString() } as LogAttributes,
      );

      if (toAddIds.length > 0 || observerPolicyIds.length > 0) {
        await this.createRuleExecutedFeedItem({
          incident,
          matchedRules,
          addedPolicyIds: toAddIds,
          observerPolicyIds: observerPolicyIds,
          ruleChange: ruleChange,
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
          projectId: incident.projectId,
          incidentId: incident.id,
          reason: aiHold.reason,
        });
      }

      // A policy the incident had already pages as it always has: right away.
      return {
        addedPolicyIds: toAddIds,
        observerPolicyIds: observerPolicyIds,
        holds: pagingHolds.getHolds([...toAddIds, ...observerPolicyIds]),
      };
    } catch (error) {
      logger.error(`Error applying incident on-call rules: ${error}`, {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      } as LogAttributes);

      return noHolds;
    }
  }

  /*
   * The policies the incident's matching rules page now, each with the
   * names of the rules that do: a rule that pages right away, or a
   * working-hours rule inside its hours (OnCallRulePagingHoldUtil.isPagingNow).
   * A rule set to After OneUptime AI never does: what it holds starts when AI
   * hands it off (AiFirstResponder). Reads only: it adds no policy to the
   * incident. For one that changed
   * while some of its runs wait for working hours (WaitingRunsOnRecordChange).
   */
  @CaptureSpan()
  @RuleEvaluation()
  public async getPoliciesPagingNow(
    incident: Incident,
    now: Date,
  ): Promise<Map<string, Array<string>>> {
    const pagingNow: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    if (!incident.id || !incident.projectId) {
      return pagingNow;
    }

    for (const rule of await this.findEnabledRules(incident.projectId)) {
      if (
        !rule.onCallDutyPolicies ||
        rule.onCallDutyPolicies.length === 0 ||
        !OnCallRulePagingHoldUtil.isPagingNow(rule, now)
      ) {
        continue;
      }

      if (!(await this.doesIncidentMatchRule(incident, rule))) {
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
   * Attaches each policy to the incident, one at a time, and hands back the
   * ones the incident is to page: a policy attached to it already -
   * attached by the rules of a change to the incident that ran at the same
   * moment (IncidentRulesOnChange) - is the other's to page, so it is left
   * out. Any other failure to attach a policy still pages it, as it always
   * has: a page matters more than the incident's list.
   */
  private async attachPolicies(data: {
    incident: Incident;
    policyIds: Array<string>;
  }): Promise<Array<string>> {
    const toPage: Array<string> = [];

    for (const policyId of data.policyIds) {
      try {
        await IncidentService.getRepository()
          .createQueryBuilder()
          .relation(Incident, "onCallDutyPolicies")
          .of(data.incident.id!.toString())
          .add(policyId);

        toPage.push(policyId);
      } catch (err) {
        if (PostgresErrorTranslator.isUniqueViolation(err)) {
          continue;
        }

        logger.warn(
          `IncidentOnCallRuleEngine: failed to persist join row of policy ${policyId} for incident ${data.incident.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );

        toPage.push(policyId);
      }
    }

    return toPage;
  }

  /*
   * The project's enabled rules that match the incident and page a policy, in
   * the order they are read. Reads only: nothing is attached, paged or
   * written. The engine pages what they name (applyRulesToIncident), and
   * "When this goes down" (WhoIsToldService) shows them for an incident a
   * monitor's criteria would open, held in memory - so the two answer from
   * one matching and never disagree.
   *
   * `preloaded` is for a reader that asks about many incidents of one
   * project at once (Setup health, #6812, through
   * WhoIsToldService.resolveProject): the project's enabled rules, read
   * once with readEnabledRules, and the monitors those incidents come from
   * (MonitorRuleCriteriaCache.seed), so the matching reads nothing per
   * incident. It is the same matching either way.
   */
  @CaptureSpan()
  @RuleEvaluation()
  public async getMatchingRules(
    incident: Incident,
    preloaded?:
      | {
          rules: Array<IncidentOnCallRule>;
          monitorCache: MonitorRuleCriteriaCache;
        }
      | undefined,
  ): Promise<Array<IncidentOnCallRule>> {
    if (!incident.projectId) {
      return [];
    }

    const matching: Array<IncidentOnCallRule> = [];

    const rules: Array<IncidentOnCallRule> = preloaded
      ? preloaded.rules
      : await this.findEnabledRules(incident.projectId);

    for (const rule of rules) {
      if (!rule.onCallDutyPolicies || rule.onCallDutyPolicies.length === 0) {
        continue;
      }

      if (
        await this.doesIncidentMatchRule(
          incident,
          rule,
          preloaded?.monitorCache,
        )
      ) {
        matching.push(rule);
      }
    }

    return matching;
  }

  /*
   * The project's enabled rules, read as getMatchingRules reads them: for a
   * reader that matches many incidents against them (getMatchingRules'
   * `preloaded`).
   */
  public async readEnabledRules(
    projectId: ObjectID,
  ): Promise<Array<IncidentOnCallRule>> {
    return await this.findEnabledRules(projectId);
  }

  // The project's enabled rules of this kind, with what matching them needs.
  private async findEnabledRules(
    projectId: ObjectID,
  ): Promise<Array<IncidentOnCallRule>> {
    const rules: Array<IncidentOnCallRule> =
      await IncidentOnCallRuleService.findBy({
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
          incidentSeverities: { _id: true },
          incidentLabels: { _id: true },
          monitorLabels: { _id: true },
          incidentTitlePattern: true,
          incidentDescriptionPattern: true,
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
      ruleKind: "IncidentOnCallRule",
      projectId: projectId,
      rulesRead: rules.length,
    });

    return rules;
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    incident: Incident;
    matchedRules: Array<IncidentOnCallRule>;
    addedPolicyIds: Array<string>;
    // The policies paged as observers (OnCallRulePageAs), not attached.
    observerPolicyIds: Array<string>;
    // Why the rules ran again on a change, when they did (IncidentRulesOnChange).
    ruleChange?: string | undefined;
  }): Promise<void> {
    const { incident, matchedRules, addedPolicyIds, observerPolicyIds } = data;
    if (
      !incident.id ||
      !incident.projectId ||
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
        .map((r: IncidentOnCallRule) => {
          return r.name?.toString() || "Unnamed Rule";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const feedInfoInMarkdown: MarkdownText = mdText`${RuleFeedMarkdown.executedLine(
        {
          emoji: "📞",
          ruleKind: "Incident On-Call Rule",
          ruleNames: ruleNames,
        },
      )}${
        data.ruleChange
          ? mdText`\n\nThe incident now matches ${
              ruleNames.length > 1 ? "them" : "it"
            }: ${data.ruleChange}.`
          : ""
      }\n\n${RuleFeedMarkdown.onCallRulePolicies({
        recordNoun: "incident",
        attachedPolicyNames: namesOf(addedPolicyIds),
        observerPolicyNames: namesOf(observerPolicyIds),
      })}`;

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id,
        projectId: incident.projectId,
        incidentFeedEventType: IncidentFeedEventType.OnCallRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown: feedInfoInMarkdown.toString(),
      });
    } catch (error) {
      logger.error(
        `IncidentOnCallRuleEngine: failed to create rule-executed feed item: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  @CaptureSpan()
  private async doesIncidentMatchRule(
    incident: Incident,
    rule: IncidentOnCallRule,
    // A cache shared by many matchings (getMatchingRules' `preloaded`).
    sharedMonitorCache?: MonitorRuleCriteriaCache | undefined,
  ): Promise<boolean> {
    const monitorCache: MonitorRuleCriteriaCache =
      sharedMonitorCache || new MonitorRuleCriteriaCache();

    return await RuleCriteriaMatcher.matchesWithLegacy({
      rule,
      legacyFields: [
        "monitors",
        "incidentSeverities",
        "incidentLabels",
        "monitorLabels",
        "incidentTitlePattern",
        "incidentDescriptionPattern",
        "monitorNamePattern",
        "monitorDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: async (
        legacyRule: IncidentOnCallRule,
      ): Promise<boolean> => {
        return await this.doesIncidentMatchLegacyRule(
          incident,
          legacyRule,
          monitorCache,
        );
      },
      correlation: {
        fields: [
          "monitorLabels",
          "monitorNamePattern",
          "monitorDescriptionPattern",
        ],
        getCandidates: (): Array<Monitor> => {
          return incident.monitors || [];
        },
        matchesLegacyRuleForCandidate: async (
          legacyRule: IncidentOnCallRule,
          incidentMonitor: Monitor,
        ): Promise<boolean> => {
          const correlatedIncident: Incident = Object.assign(
            new Incident(),
            incident,
          );
          correlatedIncident.monitors = [incidentMonitor];
          return await this.doesIncidentMatchLegacyRule(
            correlatedIncident,
            legacyRule,
            monitorCache,
          );
        },
      },
    });
  }

  private async doesIncidentMatchLegacyRule(
    incident: Incident,
    rule: IncidentOnCallRule,
    monitorCache: MonitorRuleCriteriaCache,
  ): Promise<boolean> {
    // Monitors: incident must come from at least one of the rule's monitors
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

    // Incident labels
    if (rule.incidentLabels && rule.incidentLabels.length > 0) {
      if (!incident.labels || incident.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.incidentLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
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

    // Monitor-derived criteria (labels, name, description)
    const hasMonitorCriteria: boolean = Boolean(
      (rule.monitorLabels && rule.monitorLabels.length > 0) ||
        rule.monitorNamePattern ||
        rule.monitorDescriptionPattern,
    );

    if (hasMonitorCriteria) {
      if (!incident.monitors || incident.monitors.length === 0) {
        return false;
      }

      let anyMonitorMatches: boolean = false;

      for (const incidentMonitor of incident.monitors) {
        if (!incidentMonitor.id) {
          continue;
        }

        const monitor: Monitor | null = await monitorCache.getMonitor(
          incidentMonitor.id,
        );

        if (!monitor) {
          continue;
        }

        let monitorMatches: boolean = true;

        if (rule.monitorLabels && rule.monitorLabels.length > 0) {
          if (!monitor.labels || monitor.labels.length === 0) {
            monitorMatches = false;
          } else {
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
              monitorMatches = false;
            }
          }
        }

        if (monitorMatches && rule.monitorNamePattern) {
          if (
            !monitor.name ||
            !this.testRegex(rule.monitorNamePattern, monitor.name, rule)
          ) {
            monitorMatches = false;
          }
        }

        if (monitorMatches && rule.monitorDescriptionPattern) {
          if (
            !monitor.description ||
            !this.testRegex(
              rule.monitorDescriptionPattern,
              monitor.description,
              rule,
            )
          ) {
            monitorMatches = false;
          }
        }

        if (monitorMatches) {
          anyMonitorMatches = true;
          break;
        }
      }

      if (!anyMonitorMatches) {
        return false;
      }
    }

    if (rule.incidentTitlePattern) {
      if (
        !incident.title ||
        !this.testRegex(rule.incidentTitlePattern, incident.title, rule)
      ) {
        return false;
      }
    }

    if (rule.incidentDescriptionPattern) {
      if (
        !incident.description ||
        !this.testRegex(
          rule.incidentDescriptionPattern,
          incident.description,
          rule,
        )
      ) {
        return false;
      }
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: IncidentOnCallRule,
  ): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(
        `Invalid regex pattern in incident on-call rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new IncidentOnCallRuleEngineServiceClass();
