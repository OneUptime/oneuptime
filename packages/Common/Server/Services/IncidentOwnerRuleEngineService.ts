import Incident from "../../Models/DatabaseModels/Incident";
import IncidentOwnerRule from "../../Models/DatabaseModels/IncidentOwnerRule";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Team from "../../Models/DatabaseModels/Team";
import User from "../../Models/DatabaseModels/User";
import IncidentFeedService from "./IncidentFeedService";
import IncidentOwnerRuleService from "./IncidentOwnerRuleService";
import IncidentOwnerTeamService from "./IncidentOwnerTeamService";
import IncidentOwnerUserService from "./IncidentOwnerUserService";
import IncidentService from "./IncidentService";
import TeamService from "./TeamService";
import UserService from "./UserService";
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
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import MonitorRuleCriteriaCache from "../Utils/Rules/MonitorRuleCriteriaCache";
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
 * owner the incident already had is not listed.
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

class IncidentOwnerRuleEngineServiceClass
  implements RuleRunEngine<Incident, IncidentOwnerRule>
{
  public readonly ruleSelect: Select<IncidentOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    monitors: { _id: true },
    incidentSeverities: { _id: true },
    incidentLabels: { _id: true },
    monitorLabels: { _id: true },
    incidentTitlePattern: true,
    incidentDescriptionPattern: true,
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
   * Matching and inheritance read all of these straight off the incident they
   * are handed instead of re-reading it, so a run has to load every one: a
   * column left out here is a criterion a run silently never matches on, or
   * a resource it silently never inherits owners from. Who declared it
   * decides the creator's team a rule adds.
   */
  public readonly resourceSelectForRuleRun: Select<Incident> = {
    _id: true,
    projectId: true,
    title: true,
    description: true,
    incidentSeverityId: true,
    createdByUserId: true,
    labels: { _id: true },
    monitors: { _id: true },
    hosts: { _id: true },
    kubernetesClusters: { _id: true },
    dockerHosts: { _id: true },
    podmanHosts: { _id: true },
    services: { _id: true },
  };

  /*
   * The project's enabled rules, as every evaluation of a new incident reads
   * them - the create and the declare form's preview alike.
   */
  @CaptureSpan()
  public async getEnabledRules(
    projectId: ObjectID,
  ): Promise<Array<IncidentOwnerRule>> {
    const rules: Array<IncidentOwnerRule> =
      await IncidentOwnerRuleService.findBy({
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
      ruleKind: "IncidentOwnerRule",
      projectId: projectId,
      rulesRead: rules.length,
    });

    return rules;
  }

  /**
   * Evaluates IncidentOwnerRule rows for the given incident and adds matched
   * owner users / teams via IncidentService.addOwners. Rules with notifyOwners
   * set notify the added owners; rules with notifyOwners off add silently.
   */
  @CaptureSpan()
  public async applyRulesToIncident(incident: Incident): Promise<void> {
    if (!incident.id || !incident.projectId) {
      return;
    }

    try {
      const rules: Array<IncidentOwnerRule> = await this.getEnabledRules(
        incident.projectId,
      );

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        incident: incident,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying incident owner rules: ${error}`, {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for an incident that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Incident, IncidentOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        incident: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running incident owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        incidentId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  /*
   * What the project's owner rules would add to an incident that is not
   * declared yet - the one the Declare Incident form holds - worked out by
   * the plan the create carries out (planRules), and nothing written: each
   * rule that would add someone, and who. The incident names its project and
   * the person declaring it (createdByUserId) as the create would.
   */
  @CaptureSpan()
  public async previewRules(
    incident: Incident,
  ): Promise<Array<OwnerRulePlanEntry<IncidentOwnerRule>>> {
    if (!incident.projectId) {
      return [];
    }

    const rules: Array<IncidentOwnerRule> = await this.getEnabledRules(
      incident.projectId,
    );

    if (rules.length === 0) {
      return [];
    }

    const plan: OwnerRulePlan<IncidentOwnerRule> = await this.planRules({
      incident: incident,
      rules: rules,
      allowOwnerNotification: true,
    });

    return plan.entries;
  }

  /*
   * Which of `rules` match the incident, and who each of them brings
   * (OwnerRulePlan) - read, never written. The create, a run and the
   * declare form's preview all go through here.
   */
  @RuleEvaluation()
  public async planRules(data: {
    incident: Incident;
    rules: Array<IncidentOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<OwnerRulePlan<IncidentOwnerRule>> {
    const { incident, rules } = data;

    const builder: OwnerRulePlanBuilder<IncidentOwnerRule> =
      new OwnerRulePlanBuilder<IncidentOwnerRule>(data.allowOwnerNotification);

    const creatorTeams: CreatorTeams = new CreatorTeams({
      projectId: incident.projectId,
      creatorUserId: incident.createdByUserId,
    });

    for (const rule of rules) {
      const matches: boolean = await this.doesIncidentMatchRule(incident, rule);

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
      await this.readInheritedOwners(incident, builder.getSourcesToInherit()),
    );
  }

  // Who owns the incident's resources, for the sources a matched rule inherits from.
  private async readInheritedOwners(
    incident: Incident,
    sources: Set<OwnerRuleInheritSource>,
  ): Promise<Map<OwnerRuleInheritSource, OwnerIdSets>> {
    return await InheritedOwners.read({
      sources: sources,
      resources: {
        monitorIds: InheritedOwners.idsOf(incident.monitors),
        hostIds: InheritedOwners.idsOf(incident.hosts),
        kubernetesClusterIds: InheritedOwners.idsOf(
          incident.kubernetesClusters,
        ),
        dockerHostIds: InheritedOwners.idsOf(incident.dockerHosts),
        podmanHostIds: InheritedOwners.idsOf(incident.podmanHosts),
        serviceIds: InheritedOwners.idsOf(incident.services),
      },
    });
  }

  private async applyRules(data: {
    incident: Incident;
    rules: Array<IncidentOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { incident, rules } = data;

    if (!incident.id || !incident.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const plan: OwnerRulePlan<IncidentOwnerRule> = await this.planRules(data);

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

    // Owners already on the incident are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: IncidentOwnerUserService,
        ownerTeamService: IncidentOwnerTeamService,
        resourceIdColumn: "incidentId",
        resourceId: incident.id,
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

      await IncidentService.addOwners(
        incident.projectId,
        incident.id,
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

    logger.debug(
      `IncidentOwnerRuleEngine added owners to incident ${incident.id}`,
      { projectId: incident.projectId.toString() } as LogAttributes,
    );

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
      incident,
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
    incident: Incident;
    matchedRules: Array<IncidentOwnerRule>;
    userIds: Array<string>;
    teamIds: Array<string>;
    inheritedFromMonitors: boolean;
    inheritedFromHosts: boolean;
    inheritedFromKubernetesClusters: boolean;
    inheritedFromDockerHosts: boolean;
    inheritedFromPodmanHosts: boolean;
    inheritedFromServices: boolean;
    // Some owner it added is a team of the person who declared the incident.
    addedCreatorTeams: boolean;
  }): Promise<void> {
    const {
      incident,
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
      !incident.id ||
      !incident.projectId ||
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
        .map((r: IncidentOwnerRule) => {
          return r.name?.toString() || "Unnamed Rule";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const inheritedSources: Array<string> = [];
      if (inheritedFromMonitors) {
        inheritedSources.push("monitors");
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
          ? mdText`\n\n_Some owners were inherited from the incident's ${FeedMarkdown.join(inheritedSources)}._`
          : FeedMarkdown.empty();

      const creatorTeamNote: MarkdownText = addedCreatorTeams
        ? mdText`\n\n_Some teams were added because the person who declared the incident is a member._`
        : FeedMarkdown.empty();

      const feedInfoInMarkdown: MarkdownText = mdText`${RuleFeedMarkdown.executedLine(
        {
          emoji: "🛡️",
          ruleKind: "Incident Owner Rule",
          ruleNames: ruleNames,
        },
      )}\n\nAssigned the following owner${
        users.length + teams.length === 1 ? "" : "s"
      } to the incident:\n${RuleFeedMarkdown.ownersList({ users: users, teams: teams })}${inheritedNote}${creatorTeamNote}`;

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id,
        projectId: incident.projectId,
        incidentFeedEventType: IncidentFeedEventType.OwnerRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown: feedInfoInMarkdown.toString(),
      });
    } catch (error) {
      logger.error(
        `IncidentOwnerRuleEngine: failed to create rule-executed feed item: ${
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
    rule: IncidentOwnerRule,
  ): Promise<boolean> {
    const monitorCache: MonitorRuleCriteriaCache =
      new MonitorRuleCriteriaCache();

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
        legacyRule: IncidentOwnerRule,
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
          legacyRule: IncidentOwnerRule,
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
    rule: IncidentOwnerRule,
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
    rule: IncidentOwnerRule,
  ): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(
        `Invalid regex in incident owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new IncidentOwnerRuleEngineServiceClass();
