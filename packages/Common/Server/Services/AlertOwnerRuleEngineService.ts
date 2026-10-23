import Alert from "../../Models/DatabaseModels/Alert";
import AlertOwnerRule from "../../Models/DatabaseModels/AlertOwnerRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Team from "../../Models/DatabaseModels/Team";
import User from "../../Models/DatabaseModels/User";
import AlertFeedService from "./AlertFeedService";
import AlertOwnerRuleService from "./AlertOwnerRuleService";
import AlertOwnerTeamService from "./AlertOwnerTeamService";
import AlertOwnerUserService from "./AlertOwnerUserService";
import AlertService from "./AlertService";
import MonitorService from "./MonitorService";
import TeamService from "./TeamService";
import UserService from "./UserService";
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
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import OwnerRuleAssignment, {
  OwnersToAssign,
} from "../Utils/Rules/OwnerRuleAssignment";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import { RuleEvaluation } from "../Utils/PatternWorkScope";
import OwnerRulePlanBuilder, {
  OwnerIdSets,
  OwnerRuleInheritSource,
  OwnerRulePlan,
  OwnerRulePlanEntry,
} from "../Utils/Rules/OwnerRulePlan";
import CreatorTeams from "../Utils/Rules/CreatorTeams";
import InheritedOwners from "../Utils/Rules/InheritedOwners";

/*
 * Whether any owner that was actually added came from one inherited source.
 * The feed note names a source only for owners it lists, and an inherited
 * owner the alert already had is not listed.
 */
function addedAnyInheritedOwner(data: {
  addedUserIds: Set<string>;
  addedTeamIds: Set<string>;
  inheritedUserIds: Set<string>;
  inheritedTeamIds: Set<string>;
}): boolean {
  for (const id of data.inheritedUserIds) {
    if (data.addedUserIds.has(id)) {
      return true;
    }
  }

  for (const id of data.inheritedTeamIds) {
    if (data.addedTeamIds.has(id)) {
      return true;
    }
  }

  return false;
}

class AlertOwnerRuleEngineServiceClass
  implements RuleRunEngine<Alert, AlertOwnerRule>
{
  public readonly ruleSelect: Select<AlertOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    monitors: { _id: true },
    alertSeverities: { _id: true },
    alertLabels: { _id: true },
    monitorLabels: { _id: true },
    alertTitlePattern: true,
    alertDescriptionPattern: true,
    monitorNamePattern: true,
    monitorDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
    creatorTeams: { _id: true },
    inheritOwnersFromMonitors: true,
    inheritOwnersFromHosts: true,
    inheritOwnersFromKubernetesClusters: true,
    inheritOwnersFromDockerHosts: true,
    inheritOwnersFromPodmanHosts: true,
    inheritOwnersFromServices: true,
  };

  /*
   * Matching and inheritance read all of these straight off the alert they
   * are handed instead of re-reading it, so a run has to load every one: a
   * column left out here is a criterion a run silently never matches on, or
   * a resource it silently never inherits owners from. Who created it
   * decides the creator's team a rule adds.
   */
  public readonly resourceSelectForRuleRun: Select<Alert> = {
    _id: true,
    projectId: true,
    title: true,
    description: true,
    alertSeverityId: true,
    monitorId: true,
    createdByUserId: true,
    labels: { _id: true },
    hosts: { _id: true },
    kubernetesClusters: { _id: true },
    dockerHosts: { _id: true },
    podmanHosts: { _id: true },
    services: { _id: true },
  };

  /*
   * The project's enabled rules, as every evaluation of a new alert reads
   * them - the create and the create form's preview alike.
   */
  @CaptureSpan()
  public async getEnabledRules(
    projectId: ObjectID,
  ): Promise<Array<AlertOwnerRule>> {
    const rules: Array<AlertOwnerRule> = await AlertOwnerRuleService.findBy({
      query: {
        projectId: projectId,
        isEnabled: true,
      },
      props: { isRoot: true },
      select: this.ruleSelect,
      limit: MAX_RULES_EVALUATED_PER_PROJECT,
      skip: 0,
    });

    logIfRuleReadWasTruncated({
      ruleKind: "AlertOwnerRule",
      projectId: projectId,
      rulesRead: rules.length,
    });

    return rules;
  }

  /**
   * Evaluates AlertOwnerRule rows for the given alert and adds matched
   * owner users / teams via AlertService.addOwners.
   */
  @CaptureSpan()
  public async applyRulesToAlert(alert: Alert): Promise<void> {
    if (!alert.id || !alert.projectId) {
      return;
    }

    try {
      const rules: Array<AlertOwnerRule> = await this.getEnabledRules(
        alert.projectId,
      );

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        alert: alert,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying alert owner rules: ${error}`, {
        projectId: alert.projectId?.toString(),
        alertId: alert.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for an alert that already exists and only
   * the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Alert, AlertOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        alert: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running alert owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        alertId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  /*
   * What the project's owner rules would add to an alert that is not created
   * yet - the one the Create Alert form holds - worked out by the plan the
   * create carries out (planRules), and nothing written: each rule that would
   * add someone, and who. The alert names its project and the person
   * creating it (createdByUserId) as the create would.
   */
  @CaptureSpan()
  public async previewRules(
    alert: Alert,
  ): Promise<Array<OwnerRulePlanEntry<AlertOwnerRule>>> {
    if (!alert.projectId) {
      return [];
    }

    const rules: Array<AlertOwnerRule> = await this.getEnabledRules(
      alert.projectId,
    );

    if (rules.length === 0) {
      return [];
    }

    const plan: OwnerRulePlan<AlertOwnerRule> = await this.planRules({
      alert: alert,
      rules: rules,
      allowOwnerNotification: true,
    });

    return plan.entries;
  }

  /*
   * Which of `rules` match the alert, and who each of them brings
   * (OwnerRulePlan) - read, never written. The create, a run and the create
   * form's preview all go through here.
   */
  @RuleEvaluation()
  public async planRules(data: {
    alert: Alert;
    rules: Array<AlertOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<OwnerRulePlan<AlertOwnerRule>> {
    const { alert, rules } = data;

    const builder: OwnerRulePlanBuilder<AlertOwnerRule> =
      new OwnerRulePlanBuilder<AlertOwnerRule>(data.allowOwnerNotification);

    const creatorTeams: CreatorTeams = new CreatorTeams({
      projectId: alert.projectId,
      creatorUserId: alert.createdByUserId,
    });

    for (const rule of rules) {
      const matches: boolean = await this.doesAlertMatchRule(alert, rule);

      if (!matches) {
        continue;
      }

      builder.addMatch({
        rule: rule,
        notifyOwners: rule.notifyOwners,
        userIds: OwnerRulePlanBuilder.idsOf(rule.ownerUsers),
        teamIds: OwnerRulePlanBuilder.idsOf(rule.ownerTeams),
        listsCreatorTeams: (rule.creatorTeams || []).length > 0,
        creatorTeamIds: await creatorTeams.pick(rule.creatorTeams),
        inheritsFrom: OwnerRulePlanBuilder.getInheritSources(rule),
      });
    }

    return builder.build(
      await InheritedOwners.read({
        sources: builder.getSourcesToInherit(),
        resources: {
          // An alert has one monitor.
          monitorIds: alert.monitorId ? [alert.monitorId] : [],
          hostIds: InheritedOwners.idsOf(alert.hosts),
          kubernetesClusterIds: InheritedOwners.idsOf(alert.kubernetesClusters),
          dockerHostIds: InheritedOwners.idsOf(alert.dockerHosts),
          podmanHostIds: InheritedOwners.idsOf(alert.podmanHosts),
          serviceIds: InheritedOwners.idsOf(alert.services),
        },
      }),
    );
  }

  private async applyRules(data: {
    alert: Alert;
    rules: Array<AlertOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { alert, rules } = data;

    if (!alert.id || !alert.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const plan: OwnerRulePlan<AlertOwnerRule> = await this.planRules(data);

    if (!plan.anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    const { usersByNotify, teamsByNotify, allUserIds, allTeamIds } = plan;

    if (
      plan.matchedRules.length === 0 ||
      (allUserIds.size === 0 && allTeamIds.size === 0)
    ) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    // Owners already on the alert are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: AlertOwnerUserService,
        ownerTeamService: AlertOwnerTeamService,
        resourceIdColumn: "alertId",
        resourceId: alert.id,
        userIds: Array.from(allUserIds),
        teamIds: Array.from(allTeamIds),
      });

    const userIdsToAdd: Set<string> = new Set(
      notYetAssigned.userIds.map((id: ObjectID) => {
        return id.toString();
      }),
    );
    const teamIdsToAdd: Set<string> = new Set(
      notYetAssigned.teamIds.map((id: ObjectID) => {
        return id.toString();
      }),
    );

    const addedUserIds: Array<string> = [];
    const addedTeamIds: Array<string> = [];

    /*
     * The notifying set goes first, so an owner two matching rules disagree
     * about is added once, and notified.
     */
    for (const notify of [true, false]) {
      const userIds: Array<string> = Array.from(
        usersByNotify.get(notify)!,
      ).filter((id: string) => {
        return userIdsToAdd.delete(id);
      });
      const teamIds: Array<string> = Array.from(
        teamsByNotify.get(notify)!,
      ).filter((id: string) => {
        return teamIdsToAdd.delete(id);
      });

      if (userIds.length === 0 && teamIds.length === 0) {
        continue;
      }

      await AlertService.addOwners(
        alert.projectId,
        alert.id,
        userIds.map((id: string) => {
          return new ObjectID(id);
        }),
        teamIds.map((id: string) => {
          return new ObjectID(id);
        }),
        notify,
        { isRoot: true },
      );

      addedUserIds.push(...userIds);
      addedTeamIds.push(...teamIds);
    }

    const ownersAdded: number = addedUserIds.length + addedTeamIds.length;

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    logger.debug(`AlertOwnerRuleEngine added owners to alert ${alert.id}`, {
      projectId: alert.projectId.toString(),
    } as LogAttributes);

    const addedUserIdSet: Set<string> = new Set(addedUserIds);
    const addedTeamIdSet: Set<string> = new Set(addedTeamIds);

    const addedAnyFrom: (source: OwnerRuleInheritSource) => boolean = (
      source: OwnerRuleInheritSource,
    ): boolean => {
      const owners: OwnerIdSets | undefined = plan.inherited.get(source);

      return addedAnyInheritedOwner({
        addedUserIds: addedUserIdSet,
        addedTeamIds: addedTeamIdSet,
        inheritedUserIds: owners?.userIds || new Set<string>(),
        inheritedTeamIds: owners?.teamIds || new Set<string>(),
      });
    };

    await this.createRuleExecutedFeedItem({
      alert,
      matchedRules: plan.matchedRules,
      userIds: addedUserIds,
      teamIds: addedTeamIds,
      inheritedFromMonitors: addedAnyFrom("monitors"),
      inheritedFromHosts: addedAnyFrom("hosts"),
      inheritedFromKubernetesClusters: addedAnyFrom("kubernetesClusters"),
      inheritedFromDockerHosts: addedAnyFrom("dockerHosts"),
      inheritedFromPodmanHosts: addedAnyFrom("podmanHosts"),
      inheritedFromServices: addedAnyFrom("services"),
      addedCreatorTeams: addedTeamIds.some((teamId: string): boolean => {
        return plan.creatorTeamIds.has(teamId);
      }),
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    alert: Alert;
    matchedRules: Array<AlertOwnerRule>;
    userIds: Array<string>;
    teamIds: Array<string>;
    inheritedFromMonitors: boolean;
    inheritedFromHosts: boolean;
    inheritedFromKubernetesClusters: boolean;
    inheritedFromDockerHosts: boolean;
    inheritedFromPodmanHosts: boolean;
    inheritedFromServices: boolean;
    // Some owner it added is a team of the person who created the alert.
    addedCreatorTeams: boolean;
  }): Promise<void> {
    const {
      alert,
      matchedRules,
      userIds,
      teamIds,
      inheritedFromMonitors,
      inheritedFromHosts,
      inheritedFromKubernetesClusters,
      inheritedFromDockerHosts,
      inheritedFromPodmanHosts,
      inheritedFromServices,
      addedCreatorTeams,
    } = data;
    if (
      !alert.id ||
      !alert.projectId ||
      matchedRules.length === 0 ||
      (userIds.length === 0 && teamIds.length === 0)
    ) {
      return;
    }

    try {
      const userObjectIds: Array<ObjectID> = userIds.map((id: string) => {
        return new ObjectID(id);
      });
      const teamObjectIds: Array<ObjectID> = teamIds.map((id: string) => {
        return new ObjectID(id);
      });

      const [users, teams]: [Array<User>, Array<Team>] = await Promise.all([
        userObjectIds.length > 0
          ? UserService.findBy({
              query: { _id: QueryHelper.any(userObjectIds) },
              select: { name: true, email: true },
              props: { isRoot: true },
              limit: LIMIT_MAX,
              skip: 0,
            })
          : Promise.resolve([] as Array<User>),
        teamObjectIds.length > 0
          ? TeamService.findBy({
              query: { _id: QueryHelper.any(teamObjectIds) },
              select: { name: true },
              props: { isRoot: true },
              limit: LIMIT_MAX,
              skip: 0,
            })
          : Promise.resolve([] as Array<Team>),
      ]);

      const ruleNames: Array<string> = matchedRules
        .map((r: AlertOwnerRule) => {
          return r.name?.toString() || "Unnamed Rule";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const inheritedSources: Array<string> = [];
      if (inheritedFromMonitors) {
        inheritedSources.push("monitor");
      }
      if (inheritedFromHosts) {
        inheritedSources.push("hosts");
      }
      if (inheritedFromKubernetesClusters) {
        inheritedSources.push("Kubernetes clusters");
      }
      if (inheritedFromDockerHosts) {
        inheritedSources.push("Docker hosts");
      }
      if (inheritedFromPodmanHosts) {
        inheritedSources.push("Podman hosts");
      }
      if (inheritedFromServices) {
        inheritedSources.push("services");
      }
      const inheritedNote: MarkdownText =
        inheritedSources.length > 0
          ? mdText`\n\n_Some owners were inherited from the alert's ${FeedMarkdown.join(inheritedSources)}._`
          : FeedMarkdown.empty();

      const creatorTeamNote: MarkdownText = addedCreatorTeams
        ? mdText`\n\n_Some teams were added because the person who created the alert is a member of them._`
        : FeedMarkdown.empty();

      const feedInfoInMarkdown: MarkdownText = mdText`${RuleFeedMarkdown.executedLine(
        {
          emoji: "🛡️",
          ruleKind: "Alert Owner Rule",
          ruleNames: ruleNames,
        },
      )}\n\nAssigned the following owner${
        users.length + teams.length === 1 ? "" : "s"
      } to the alert:\n${RuleFeedMarkdown.ownersList({ users: users, teams: teams })}${inheritedNote}${creatorTeamNote}`;

      await AlertFeedService.createAlertFeedItem({
        alertId: alert.id,
        projectId: alert.projectId,
        alertFeedEventType: AlertFeedEventType.OwnerRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown: feedInfoInMarkdown.toString(),
      });
    } catch (error) {
      logger.error(
        `AlertOwnerRuleEngine: failed to create rule-executed feed item: ${
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
    rule: AlertOwnerRule,
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
        legacyRule: AlertOwnerRule,
      ): Promise<boolean> => {
        return await this.doesAlertMatchLegacyRule(alert, legacyRule);
      },
    });
  }

  private async doesAlertMatchLegacyRule(
    alert: Alert,
    rule: AlertOwnerRule,
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
      const monitor: Monitor | null = await MonitorService.findOneById({
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
    rule: AlertOwnerRule,
  ): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(`Invalid regex in alert owner rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new AlertOwnerRuleEngineServiceClass();
