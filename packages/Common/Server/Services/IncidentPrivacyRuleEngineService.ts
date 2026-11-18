import Incident from "../../Models/DatabaseModels/Incident";
import IncidentPrivacyRule from "../../Models/DatabaseModels/IncidentPrivacyRule";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import IncidentFeedService from "./IncidentFeedService";
import IncidentPrivacyRuleService from "./IncidentPrivacyRuleService";
import IncidentService from "./IncidentService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Red500 } from "../../Types/BrandColors";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { MarkdownText, mdText } from "../../Utils/Markdown/FeedMarkdown";
import RuleFeedMarkdown from "../Utils/Rules/RuleFeedMarkdown";
import logger, { LogAttributes } from "../Utils/Logger";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import RuleSetCache from "../Utils/Rules/RuleSetCache";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import MonitorRuleCriteriaCache from "../Utils/Rules/MonitorRuleCriteriaCache";
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
import {
  PrivacyRulePlan,
  getPrivacyRulesThatApply,
  makePrivacyRulePlan,
} from "../Utils/Rules/PrivacyRulePlan";

class IncidentPrivacyRuleEngineServiceClass
  implements RuleRunEngine<Incident, IncidentPrivacyRule>
{
  public readonly ruleSelect: Select<IncidentPrivacyRule> = {
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
  };

  /*
   * Evaluation reads these straight off the incident it is handed (monitor
   * names, descriptions and labels are then re-read per monitor id), and a
   * run must see isPrivate to report an incident that is already private.
   */
  public readonly resourceSelectForRuleRun: Select<Incident> = {
    _id: true,
    projectId: true,
    isPrivate: true,
    title: true,
    description: true,
    incidentSeverityId: true,
    monitors: { _id: true },
    labels: { _id: true },
  };

  /**
   * Evaluates IncidentPrivacyRule rows for the given incident. If any enabled
   * rule matches, the incident is marked private (isPrivate=true) and the
   * passed-in incident object is mutated in place so downstream callers see
   * the updated value.
   *
   * Returns true if the incident was marked private by a rule.
   */
  @CaptureSpan()
  public async applyRulesToIncident(incident: Incident): Promise<boolean> {
    if (!incident.id || !incident.projectId) {
      return false;
    }

    if (incident.isPrivate === true) {
      // Already private — nothing to do.
      return false;
    }

    try {
      const rules: Array<IncidentPrivacyRule> = await this.getEnabledRules(
        incident.projectId,
      );

      if (rules.length === 0) {
        return false;
      }

      const result: RuleApplicationResult = await this.applyRules({
        incident: incident,
        rules: rules,
      });

      return result.updated;
    } catch (error) {
      logger.error(`Error applying incident privacy rules: ${error}`, {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      } as LogAttributes);
      return false;
    }
  }

  /*
   * The project's enabled rules, as every evaluation of a new incident reads
   * them - the create and "When this goes down" alike. Kept until any of
   * the project's rules changes (RuleSetCache).
   */
  @CaptureSpan()
  public async getEnabledRules(
    projectId: ObjectID,
  ): Promise<Array<IncidentPrivacyRule>> {
    const rules: Array<IncidentPrivacyRule> =
      await RuleSetCache.findEnabledRules<IncidentPrivacyRule>({
        service: IncidentPrivacyRuleService,
        projectId: projectId,
        select: this.ruleSelect,
      });

    logIfRuleReadWasTruncated({
      ruleKind: "IncidentPrivacyRule",
      projectId: projectId,
      rulesRead: rules.length,
    });

    return rules;
  }

  /*
   * Which of `rules` make the incident private (PrivacyRulePlan) - read,
   * never written. The create and a run carry it out (applyRules), and
   * "When this goes down" (WhoIsToldService) reads it for the incident a
   * monitor's criteria would open, held in memory, so the two never
   * disagree (#7213). `monitorCache` is shared by many matchings, and a
   * reader of a monitor not saved yet hands it in seeded with that monitor.
   */
  @RuleEvaluation()
  public async planRules(data: {
    incident: Incident;
    rules: Array<IncidentPrivacyRule>;
    monitorCache?: MonitorRuleCriteriaCache | undefined;
  }): Promise<PrivacyRulePlan<IncidentPrivacyRule>> {
    const matchedRules: Array<IncidentPrivacyRule> = [];
    const uncheckedRules: Array<IncidentPrivacyRule> = [];
    const monitorCache: MonitorRuleCriteriaCache =
      data.monitorCache || new MonitorRuleCriteriaCache();

    for (const rule of data.rules) {
      const stoppedBefore: number = PatternWorkScope.stoppedQuestions();
      const matches: boolean = await this.doesIncidentMatchRule(
        data.incident,
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
   * "Run now": the same evaluation, for an incident that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Incident, IncidentPrivacyRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        incident: data.resource,
        rules: data.rules,
        props: data.props,
      });
    } catch (error) {
      logger.error(`Error running incident privacy rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        incidentId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  // Carries the plan out (planRules): the one place a privacy rule writes.
  private async applyRules(data: {
    incident: Incident;
    rules: Array<IncidentPrivacyRule>;
    // Who ran the rule (Run now); none for a rule applied on create.
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<RuleApplicationResult> {
    const { incident, rules } = data;

    if (!incident.id || !incident.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const plan: PrivacyRulePlan<IncidentPrivacyRule> = await this.planRules({
      incident: incident,
      rules: rules,
    });

    if (!plan.makesPrivate) {
      return RuleApplicationResultUtil.noMatch();
    }

    const { matchedRules, uncheckedRules } = plan;

    /*
     * The create hook returns before evaluating an already-private incident;
     * a run evaluates it anyway so it can report the rule as already applied.
     */
    if (incident.isPrivate === true) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    await IncidentService.updateOneById({
      id: incident.id,
      data: { isPrivate: true },
      props: RuleRunWriteProps.get(data.props),
    });

    // Mirror in memory so downstream onCreateSuccess steps see the change.
    incident.isPrivate = true;

    logger.debug(
      `IncidentPrivacyRuleEngine marked incident ${incident.id} private`,
      { projectId: incident.projectId.toString() } as LogAttributes,
    );

    await this.createRuleExecutedFeedItem({
      incident,
      matchedRules,
      uncheckedRules,
    });

    return RuleApplicationResultUtil.updated(1);
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    incident: Incident;
    matchedRules: Array<IncidentPrivacyRule>;
    uncheckedRules: Array<IncidentPrivacyRule>;
  }): Promise<void> {
    const { incident, matchedRules, uncheckedRules } = data;
    if (
      !incident.id ||
      !incident.projectId ||
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
        .map((r: IncidentPrivacyRule) => {
          return r.name?.toString() || "Unnamed Rule";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const headline: MarkdownText =
        matchedRules.length > 0
          ? RuleFeedMarkdown.executedLine({
              emoji: "🔒",
              ruleKind: "Incident Privacy Rule",
              ruleNames: ruleNames,
            })
          : RuleFeedMarkdown.notCheckedInFullLine({
              emoji: "🔒",
              ruleKind: "Incident Privacy Rule",
              ruleNames: ruleNames,
            });

      const feedInfoInMarkdown: MarkdownText = mdText`${headline}\n\nIncident has been marked **private** — visible only to its owners, Project Admins, and Project Owners.`;

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id,
        projectId: incident.projectId,
        incidentFeedEventType: IncidentFeedEventType.PrivacyRuleExecuted,
        displayColor: Red500,
        feedInfoInMarkdown: feedInfoInMarkdown.toString(),
      });
    } catch (error) {
      logger.error(
        `IncidentPrivacyRuleEngine: failed to create rule-executed feed item: ${
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
    rule: IncidentPrivacyRule,
    monitorCache: MonitorRuleCriteriaCache = new MonitorRuleCriteriaCache(),
  ): Promise<boolean> {
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
        legacyRule: IncidentPrivacyRule,
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
          legacyRule: IncidentPrivacyRule,
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
    rule: IncidentPrivacyRule,
    monitorCache: MonitorRuleCriteriaCache,
  ): Promise<boolean> {
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
      if (
        !ruleMonitorIds.some((id: string) => {
          return incidentMonitorIds.includes(id);
        })
      ) {
        return false;
      }
    }

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
      if (
        !ruleLabelIds.some((id: string) => {
          return incidentLabelIds.includes(id);
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
            if (
              !ruleMonitorLabelIds.some((id: string) => {
                return monitorLabelIds.includes(id);
              })
            ) {
              monitorMatches = false;
            }
          }
        }

        if (
          monitorMatches &&
          rule.monitorNamePattern &&
          (!monitor.name ||
            !this.testRegex(rule.monitorNamePattern, monitor.name, rule))
        ) {
          monitorMatches = false;
        }

        if (
          monitorMatches &&
          rule.monitorDescriptionPattern &&
          (!monitor.description ||
            !this.testRegex(
              rule.monitorDescriptionPattern,
              monitor.description,
              rule,
            ))
        ) {
          monitorMatches = false;
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

    if (
      rule.incidentTitlePattern &&
      (!incident.title ||
        !this.testRegex(rule.incidentTitlePattern, incident.title, rule))
    ) {
      return false;
    }

    if (
      rule.incidentDescriptionPattern &&
      (!incident.description ||
        !this.testRegex(
          rule.incidentDescriptionPattern,
          incident.description,
          rule,
        ))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: IncidentPrivacyRule,
  ): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(
        `Invalid regex in incident privacy rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new IncidentPrivacyRuleEngineServiceClass();
