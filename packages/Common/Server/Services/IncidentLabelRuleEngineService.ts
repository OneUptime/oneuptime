import RuleAddedLabels from "../Utils/Rules/RuleAddedLabels";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentLabelRule from "../../Models/DatabaseModels/IncidentLabelRule";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import IncidentFeedService from "./IncidentFeedService";
import IncidentLabelRuleService from "./IncidentLabelRuleService";
import IncidentService from "./IncidentService";
import LabelService from "./LabelService";
import LabelRulePlanBuilder, {
  LabelInheritableResources,
  LabelRulePlan,
  getLabelResourceIds,
  getNoLabelRulePlan,
} from "../Utils/Rules/LabelRulePlan";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../Utils/Markdown/FeedMarkdown";
import RuleFeedMarkdown from "../Utils/Rules/RuleFeedMarkdown";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Select from "../Types/Database/Select";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
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
} from "../Utils/Rules/RuleRun/RuleApplication";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import { RuleEvaluation } from "../Utils/PatternWorkScope";

class IncidentLabelRuleEngineServiceClass
  implements RuleRunEngine<Incident, IncidentLabelRule>
{
  public readonly ruleSelect: Select<IncidentLabelRule> = {
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
    labelsToAdd: { _id: true },
    inheritLabelsFromMonitors: true,
    inheritLabelsFromHosts: true,
    inheritLabelsFromKubernetesClusters: true,
    inheritLabelsFromDockerHosts: true,
    inheritLabelsFromPodmanHosts: true,
    inheritLabelsFromServices: true,
  };

  /*
   * Matching and inheritance read all of these straight off the incident they
   * are handed instead of re-reading it, so a run has to load every one: a
   * column left out here is a criterion a run silently never matches on, or
   * a resource it silently never inherits from.
   */
  public readonly resourceSelectForRuleRun: Select<Incident> = {
    _id: true,
    projectId: true,
    title: true,
    description: true,
    incidentSeverityId: true,
    labels: { _id: true },
    monitors: { _id: true },
    hosts: { _id: true },
    kubernetesClusters: { _id: true },
    dockerHosts: { _id: true },
    podmanHosts: { _id: true },
    services: { _id: true },
  };

  /**
   * Evaluates IncidentLabelRule rows for the given incident and attaches
   * matched labels to the incident. Each matched rule contributes:
   *   - labels listed on `labelsToAdd`
   *   - all labels of the incident's monitors when `inheritLabelsFromMonitors`
   *   - all labels of the incident's hosts when `inheritLabelsFromHosts`
   *   - all labels of the incident's Kubernetes clusters when `inheritLabelsFromKubernetesClusters`
   *   - all labels of the incident's Docker hosts when `inheritLabelsFromDockerHosts`
   *   - all labels of the incident's Podman hosts when `inheritLabelsFromPodmanHosts`
   *   - all labels of the incident's services when `inheritLabelsFromServices`
   * The union is deduped against labels already on the incident before insert
   * to avoid PK conflicts on the IncidentLabel join table.
   */
  @CaptureSpan()
  public async applyRulesToIncident(incident: Incident): Promise<void> {
    if (!incident.id || !incident.projectId) {
      return;
    }

    try {
      const rules: Array<IncidentLabelRule> = await this.getEnabledRules(
        incident.projectId,
      );

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ incident: incident, rules: rules });
    } catch (error) {
      logger.error(`Error applying incident label rules: ${error}`, {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      } as LogAttributes);
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
  ): Promise<Array<IncidentLabelRule>> {
    const rules: Array<IncidentLabelRule> =
      await RuleSetCache.findEnabledRules<IncidentLabelRule>({
        service: IncidentLabelRuleService,
        projectId: projectId,
        select: this.ruleSelect,
      });

    logIfRuleReadWasTruncated({
      ruleKind: "IncidentLabelRule",
      projectId: projectId,
      rulesRead: rules.length,
    });

    return rules;
  }

  /*
   * Which of `rules` match the incident, and the labels they add
   * (LabelRulePlan) - read, never written. The create and a run carry it
   * out (applyRules), and "When this goes down" (WhoIsToldService) reads it
   * for the incident a monitor's criteria would open, held in memory, so an
   * on-call rule that pages for a label a rule adds matches on the card as
   * it does for a real incident (#7212). Every rule is matched on the
   * incident as it is handed: one rule's labels do not make another match.
   * The resources it inherits from are the incident's own, as it is handed.
   * `monitorCache` is shared by many matchings, and a reader of a monitor
   * not saved yet hands it in seeded with that monitor.
   */
  @RuleEvaluation()
  public async planRules(data: {
    incident: Incident;
    rules: Array<IncidentLabelRule>;
    monitorCache?: MonitorRuleCriteriaCache | undefined;
  }): Promise<LabelRulePlan<IncidentLabelRule>> {
    const { incident } = data;

    if (!incident.projectId || data.rules.length === 0) {
      return getNoLabelRulePlan<IncidentLabelRule>();
    }

    const monitorCache: MonitorRuleCriteriaCache =
      data.monitorCache || new MonitorRuleCriteriaCache();
    const matchedRules: Array<IncidentLabelRule> = [];

    for (const rule of data.rules) {
      if (await this.doesIncidentMatchRule(incident, rule, monitorCache)) {
        matchedRules.push(rule);
      }
    }

    return await LabelRulePlanBuilder.build({
      projectId: incident.projectId,
      matchedRules: matchedRules,
      monitorIds: getLabelResourceIds(incident.monitors),
      getResources: async (): Promise<LabelInheritableResources> => {
        return {
          monitorIds: getLabelResourceIds(incident.monitors),
          hostIds: getLabelResourceIds(incident.hosts),
          kubernetesClusterIds: getLabelResourceIds(
            incident.kubernetesClusters,
          ),
          dockerHostIds: getLabelResourceIds(incident.dockerHosts),
          podmanHostIds: getLabelResourceIds(incident.podmanHosts),
          serviceIds: getLabelResourceIds(incident.services),
        };
      },
      monitorCache: monitorCache,
      description: "labels of incident label rules",
      logAttributes: {
        projectId: incident.projectId.toString(),
        incidentId: incident.id?.toString(),
      } as LogAttributes,
    });
  }

  /*
   * "Run now": the same evaluation, for an incident that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Incident, IncidentLabelRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        incident: data.resource,
        rules: data.rules,
        props: data.props,
      });
    } catch (error) {
      logger.error(`Error running incident label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        incidentId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  // Carries the plan out (planRules): the one place an incident label rule writes.
  private async applyRules(data: {
    incident: Incident;
    rules: Array<IncidentLabelRule>;
    // Who ran the rule (Run now); none for a rule applied on create.
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<RuleApplicationResult> {
    const { incident, rules } = data;

    if (!incident.id || !incident.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const plan: LabelRulePlan<IncidentLabelRule> = await this.planRules({
      incident: incident,
      rules: rules,
    });

    const matchedRules: Array<IncidentLabelRule> = plan.matchedRules;

    if (matchedRules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    /*
     * Matched, but the rules add nothing: inherited from unlabelled
     * monitors, or only another project's labels.
     */
    if (plan.labelIds.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    const incidentWithLabels: Incident | null =
      await IncidentService.findOneById({
        id: incident.id,
        select: { labels: { _id: true } },
        props: { isRoot: true },
      });

    // The incident is gone, so there is nothing left to label.
    if (!incidentWithLabels) {
      return RuleApplicationResultUtil.noMatch();
    }

    const existingLabelIds: Set<string> = new Set(
      (incidentWithLabels.labels || [])
        .map((l: Label) => {
          return l.id?.toString() || "";
        })
        .filter((id: string) => {
          return id !== "";
        }),
    );

    const newLabelIds: Array<string> = plan.labelIds.filter((id: string) => {
      return !existingLabelIds.has(id);
    });

    if (newLabelIds.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }
    await RuleAddedLabels.add({
      service: IncidentService,
      resourceId: incident.id,
      labelIds: newLabelIds,
      props: data.props,
    });

    /*
     * Sync in-memory incident.labels with the now-persisted set so downstream
     * rule engines (IncidentOnCallRuleEngineService) can match on these labels
     * in the same onCreateSuccess chain. Without this, the on-call engine sees
     * only the criteria-time labels and skips rules keyed on rule-added labels.
     */
    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    incident.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });

    logger.debug(
      `IncidentLabelRuleEngine attached ${newLabelIds.length} labels to incident ${incident.id}`,
      { projectId: incident.projectId.toString() } as LogAttributes,
    );

    await this.createRuleExecutedFeedItem({
      incident,
      matchedRules,
      addedLabelIds: newLabelIds,
    });

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    incident: Incident;
    matchedRules: Array<IncidentLabelRule>;
    addedLabelIds: Array<string>;
  }): Promise<void> {
    const { incident, matchedRules, addedLabelIds } = data;
    if (
      !incident.id ||
      !incident.projectId ||
      matchedRules.length === 0 ||
      addedLabelIds.length === 0
    ) {
      return;
    }

    try {
      const labelObjectIds: Array<ObjectID> = addedLabelIds.map(
        (id: string) => {
          return new ObjectID(id);
        },
      );

      const labels: Array<Label> = await LabelService.findBy({
        query: {
          _id: QueryHelper.any(labelObjectIds),
        },
        select: { name: true },
        props: { isRoot: true },
        limit: LIMIT_MAX,
        skip: 0,
      });

      const labelNames: Array<string> = labels
        .map((l: Label) => {
          return l.name?.toString() || "";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const ruleNames: Array<string> = matchedRules
        .map((r: IncidentLabelRule) => {
          return r.name?.toString() || "Unnamed Rule";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const feedInfoInMarkdown: MarkdownText = mdText`${RuleFeedMarkdown.executedLine(
        {
          emoji: "🏷️",
          ruleKind: "Incident Label Rule",
          ruleNames: ruleNames,
        },
      )}\n\nAdded the following label${
        labelNames.length === 1 ? "" : "s"
      } to the incident:\n${FeedMarkdown.bulletList(labelNames, {
        whenEmpty: "(no named labels)",
      })}`;

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id,
        projectId: incident.projectId,
        incidentFeedEventType: IncidentFeedEventType.LabelRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown: feedInfoInMarkdown.toString(),
      });
    } catch (error) {
      logger.error(
        `IncidentLabelRuleEngine: failed to create rule-executed feed item: ${
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
    rule: IncidentLabelRule,
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
        legacyRule: IncidentLabelRule,
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
          legacyRule: IncidentLabelRule,
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
    rule: IncidentLabelRule,
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
    rule: IncidentLabelRule,
  ): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(
        `Invalid regex in incident label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new IncidentLabelRuleEngineServiceClass();
