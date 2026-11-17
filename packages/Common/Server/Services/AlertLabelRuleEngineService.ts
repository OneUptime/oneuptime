import RuleAddedLabels from "../Utils/Rules/RuleAddedLabels";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertLabelRule from "../../Models/DatabaseModels/AlertLabelRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import AlertFeedService from "./AlertFeedService";
import AlertLabelRuleService from "./AlertLabelRuleService";
import AlertService from "./AlertService";
import LabelService from "./LabelService";
import MonitorRuleCriteriaCache from "../Utils/Rules/MonitorRuleCriteriaCache";
import LabelRulePlanBuilder, {
  LabelInheritableResources,
  LabelRulePlan,
  doLabelRulesInheritFromResources,
  getLabelResourceIds,
  getNoLabelRulePlan,
} from "../Utils/Rules/LabelRulePlan";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
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
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import { RuleEvaluation } from "../Utils/PatternWorkScope";

class AlertLabelRuleEngineServiceClass
  implements RuleRunEngine<Alert, AlertLabelRule>
{
  public readonly ruleSelect: Select<AlertLabelRule> = {
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
    labelsToAdd: { _id: true },
    inheritLabelsFromMonitors: true,
    inheritLabelsFromHosts: true,
    inheritLabelsFromKubernetesClusters: true,
    inheritLabelsFromDockerHosts: true,
    inheritLabelsFromPodmanHosts: true,
    inheritLabelsFromServices: true,
  };

  /*
   * Matching and monitor inheritance read these straight off the alert they
   * are handed, so a run has to load every one: a column left out here is a
   * criterion a run silently never matches on. The alert's hosts, clusters,
   * Docker and Podman hosts and services are re-read when a rule inherits
   * from them, so they are not needed here.
   */
  public readonly resourceSelectForRuleRun: Select<Alert> = {
    _id: true,
    projectId: true,
    title: true,
    description: true,
    alertSeverityId: true,
    monitorId: true,
    labels: { _id: true },
  };

  /**
   * Evaluates AlertLabelRule rows for the given alert and attaches matched
   * labels to the alert. Each matched rule contributes:
   *   - labels listed on `labelsToAdd`
   *   - all labels of the alert's monitor when `inheritLabelsFromMonitors`
   *   - all labels of the alert's hosts when `inheritLabelsFromHosts`
   *   - all labels of the alert's Kubernetes clusters when `inheritLabelsFromKubernetesClusters`
   *   - all labels of the alert's Docker hosts when `inheritLabelsFromDockerHosts`
   *   - all labels of the alert's Podman hosts when `inheritLabelsFromPodmanHosts`
   *   - all labels of the alert's services when `inheritLabelsFromServices`
   * The union is deduped against labels already on the alert before insert
   * to avoid PK conflicts on the AlertLabel join table.
   */
  @CaptureSpan()
  public async applyRulesToAlert(alert: Alert): Promise<void> {
    if (!alert.id || !alert.projectId) {
      return;
    }

    try {
      const rules: Array<AlertLabelRule> = await this.getEnabledRules(
        alert.projectId,
      );

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ alert: alert, rules: rules });
    } catch (error) {
      logger.error(`Error applying alert label rules: ${error}`, {
        projectId: alert.projectId?.toString(),
        alertId: alert.id?.toString(),
      } as LogAttributes);
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
  ): Promise<Array<AlertLabelRule>> {
    const rules: Array<AlertLabelRule> =
      await RuleSetCache.findEnabledRules<AlertLabelRule>({
        service: AlertLabelRuleService,
        projectId: projectId,
        select: this.ruleSelect,
      });

    logIfRuleReadWasTruncated({
      ruleKind: "AlertLabelRule",
      projectId: projectId,
      rulesRead: rules.length,
    });

    return rules;
  }

  /*
   * Which of `rules` match the alert, and the labels they add
   * (LabelRulePlan) - read, never written. The create and a run carry it
   * out (applyRules), and "When this goes down" (WhoIsToldService) reads it
   * for the alert a monitor's criteria would open, held in memory (#7212).
   * Every rule is matched on the alert as it is handed. The hosts,
   * clusters, Docker and Podman hosts and services a rule inherits from are
   * read as the alert is stored, unless `resources` hands them in - an alert
   * not saved yet has none stored. Null only when the stored alert is gone.
   */
  @RuleEvaluation()
  public async planRules(data: {
    alert: Alert;
    rules: Array<AlertLabelRule>;
    monitorCache?: MonitorRuleCriteriaCache | undefined;
    resources?: LabelInheritableResources | undefined;
  }): Promise<LabelRulePlan<AlertLabelRule> | null> {
    const { alert } = data;

    if (!alert.projectId || data.rules.length === 0) {
      return getNoLabelRulePlan<AlertLabelRule>();
    }

    const monitorCache: MonitorRuleCriteriaCache =
      data.monitorCache || new MonitorRuleCriteriaCache();
    const matchedRules: Array<AlertLabelRule> = [];

    for (const rule of data.rules) {
      if (await this.doesAlertMatchRule(alert, rule, monitorCache)) {
        matchedRules.push(rule);
      }
    }

    const monitorIds: Array<ObjectID> = alert.monitorId
      ? [alert.monitorId]
      : [];

    let resources: LabelInheritableResources | null = data.resources || null;

    if (
      !resources &&
      matchedRules.length > 0 &&
      doLabelRulesInheritFromResources(matchedRules)
    ) {
      const stored: Alert | null = alert.id
        ? await AlertService.findOneById({
            id: alert.id,
            select: {
              hosts: { _id: true },
              kubernetesClusters: { _id: true },
              dockerHosts: { _id: true },
              podmanHosts: { _id: true },
              services: { _id: true },
            },
            props: { isRoot: true },
          })
        : null;

      // The alert is gone, so there is nothing left to label.
      if (!stored) {
        return null;
      }

      resources = {
        monitorIds: monitorIds,
        hostIds: getLabelResourceIds(stored.hosts),
        kubernetesClusterIds: getLabelResourceIds(stored.kubernetesClusters),
        dockerHostIds: getLabelResourceIds(stored.dockerHosts),
        podmanHostIds: getLabelResourceIds(stored.podmanHosts),
        serviceIds: getLabelResourceIds(stored.services),
      };
    }

    return await LabelRulePlanBuilder.build({
      projectId: alert.projectId,
      matchedRules: matchedRules,
      monitorIds: monitorIds,
      getResources: async (): Promise<LabelInheritableResources> => {
        return (
          resources || {
            monitorIds: monitorIds,
            hostIds: [],
            kubernetesClusterIds: [],
            dockerHostIds: [],
            podmanHostIds: [],
            serviceIds: [],
          }
        );
      },
      monitorCache: monitorCache,
      description: "labels of alert label rules",
      logAttributes: {
        projectId: alert.projectId.toString(),
        alertId: alert.id?.toString(),
      } as LogAttributes,
    });
  }

  /*
   * "Run now": the same evaluation, for an alert that already exists and only
   * the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Alert, AlertLabelRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        alert: data.resource,
        rules: data.rules,
        props: data.props,
      });
    } catch (error) {
      logger.error(`Error running alert label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        alertId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  // Carries the plan out (planRules): the one place an alert label rule writes.
  private async applyRules(data: {
    alert: Alert;
    rules: Array<AlertLabelRule>;
    // Who ran the rule (Run now); none for a rule applied on create.
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<RuleApplicationResult> {
    const { alert, rules } = data;

    if (!alert.id || !alert.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const plan: LabelRulePlan<AlertLabelRule> | null = await this.planRules({
      alert: alert,
      rules: rules,
    });

    // The alert is gone, so there is nothing left to label.
    if (!plan) {
      return RuleApplicationResultUtil.noMatch();
    }

    const matchedRules: Array<AlertLabelRule> = plan.matchedRules;

    if (matchedRules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    /*
     * Matched, but the rules add nothing: inherited from an unlabelled
     * monitor, or only another project's labels.
     */
    if (plan.labelIds.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    const alertWithLabels: Alert | null = await AlertService.findOneById({
      id: alert.id,
      select: { labels: { _id: true } },
      props: { isRoot: true },
    });

    // The alert is gone, so there is nothing left to label.
    if (!alertWithLabels) {
      return RuleApplicationResultUtil.noMatch();
    }

    const existingLabelIds: Set<string> = new Set(
      (alertWithLabels.labels || [])
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
      service: AlertService,
      resourceId: alert.id,
      labelIds: newLabelIds,
      props: data.props,
    });

    /*
     * Sync in-memory alert.labels with the now-persisted set so downstream
     * rule engines (AlertOnCallRuleEngineService) can match on these labels
     * in the same onCreateSuccess chain. Without this, the on-call engine sees
     * only the criteria-time labels and skips rules keyed on rule-added labels.
     */
    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    alert.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });

    logger.debug(
      `AlertLabelRuleEngine attached ${newLabelIds.length} labels to alert ${alert.id}`,
      { projectId: alert.projectId.toString() } as LogAttributes,
    );

    await this.createRuleExecutedFeedItem({
      alert,
      matchedRules,
      addedLabelIds: newLabelIds,
    });

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    alert: Alert;
    matchedRules: Array<AlertLabelRule>;
    addedLabelIds: Array<string>;
  }): Promise<void> {
    const { alert, matchedRules, addedLabelIds } = data;
    if (
      !alert.id ||
      !alert.projectId ||
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
        .map((r: AlertLabelRule) => {
          return r.name?.toString() || "Unnamed Rule";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const feedInfoInMarkdown: MarkdownText = mdText`${RuleFeedMarkdown.executedLine(
        {
          emoji: "🏷️",
          ruleKind: "Alert Label Rule",
          ruleNames: ruleNames,
        },
      )}\n\nAdded the following label${
        labelNames.length === 1 ? "" : "s"
      } to the alert:\n${FeedMarkdown.bulletList(labelNames, {
        whenEmpty: "(no named labels)",
      })}`;

      await AlertFeedService.createAlertFeedItem({
        alertId: alert.id,
        projectId: alert.projectId,
        alertFeedEventType: AlertFeedEventType.LabelRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown: feedInfoInMarkdown.toString(),
      });
    } catch (error) {
      logger.error(
        `AlertLabelRuleEngine: failed to create rule-executed feed item: ${
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
    rule: AlertLabelRule,
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
        legacyRule: AlertLabelRule,
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
    rule: AlertLabelRule,
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
    rule: AlertLabelRule,
  ): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(`Invalid regex in alert label rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new AlertLabelRuleEngineServiceClass();
