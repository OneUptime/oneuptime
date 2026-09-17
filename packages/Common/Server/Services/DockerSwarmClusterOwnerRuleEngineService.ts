import Label from "../../Models/DatabaseModels/Label";
import DockerSwarmCluster from "../../Models/DatabaseModels/DockerSwarmCluster";
import DockerSwarmClusterOwnerRule from "../../Models/DatabaseModels/DockerSwarmClusterOwnerRule";
import DockerSwarmClusterOwnerUser from "../../Models/DatabaseModels/DockerSwarmClusterOwnerUser";
import DockerSwarmClusterOwnerTeam from "../../Models/DatabaseModels/DockerSwarmClusterOwnerTeam";
import DockerSwarmClusterOwnerRuleService from "./DockerSwarmClusterOwnerRuleService";
import DockerSwarmClusterOwnerUserService from "./DockerSwarmClusterOwnerUserService";
import DockerSwarmClusterOwnerTeamService from "./DockerSwarmClusterOwnerTeamService";
import DockerSwarmClusterService from "./DockerSwarmClusterService";
import DockerSwarmClusterFeedService from "./DockerSwarmClusterFeedService";
import { DockerSwarmClusterFeedEventType } from "../../Models/DatabaseModels/DockerSwarmClusterFeed";
import { Purple500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import OwnerRuleAssignment, {
  OwnersToAssign,
} from "../Utils/Rules/OwnerRuleAssignment";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";

class DockerSwarmClusterOwnerRuleEngineServiceClass
  implements RuleRunEngine<DockerSwarmCluster, DockerSwarmClusterOwnerRule>
{
  public readonly ruleSelect: Select<DockerSwarmClusterOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    dockerSwarmClusterLabels: { _id: true },
    dockerSwarmClusterNamePattern: true,
    dockerSwarmClusterDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the Docker Swarm cluster, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<DockerSwarmCluster> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates DockerSwarmClusterOwnerRule rows for the given DockerSwarm cluster and adds matched
   * owner users / teams via DockerSwarmClusterOwnerUserService / DockerSwarmClusterOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToDockerSwarmCluster(
    dockerSwarmCluster: DockerSwarmCluster,
  ): Promise<void> {
    if (!dockerSwarmCluster.id || !dockerSwarmCluster.projectId) {
      return;
    }

    try {
      const rules: Array<DockerSwarmClusterOwnerRule> =
        await DockerSwarmClusterOwnerRuleService.findBy({
          query: {
            projectId: dockerSwarmCluster.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "DockerSwarmClusterOwnerRule",
        projectId: dockerSwarmCluster.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        dockerSwarmCluster: dockerSwarmCluster,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying DockerSwarm cluster owner rules: ${error}`, {
        projectId: dockerSwarmCluster.projectId?.toString(),
        dockerSwarmClusterId: dockerSwarmCluster.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a Docker Swarm cluster that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      DockerSwarmCluster,
      DockerSwarmClusterOwnerRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        dockerSwarmCluster: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running DockerSwarm cluster owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        dockerSwarmClusterId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    dockerSwarmCluster: DockerSwarmCluster;
    rules: Array<DockerSwarmClusterOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { dockerSwarmCluster, rules } = data;

    if (
      !dockerSwarmCluster.id ||
      !dockerSwarmCluster.projectId ||
      rules.length === 0
    ) {
      return RuleApplicationResultUtil.noMatch();
    }

    const dockerSwarmClusterWithDetails: DockerSwarmCluster | null =
      await DockerSwarmClusterService.findOneById({
        id: dockerSwarmCluster.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!dockerSwarmClusterWithDetails) {
      return RuleApplicationResultUtil.noMatch();
    }

    const usersByNotify: Map<boolean, Set<string>> = new Map([
      [true, new Set()],
      [false, new Set()],
    ]);
    const teamsByNotify: Map<boolean, Set<string>> = new Map([
      [true, new Set()],
      [false, new Set()],
    ]);

    const matchedRules: Array<DockerSwarmClusterOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesDockerSwarmClusterMatchRule(
        dockerSwarmClusterWithDetails,
        rule,
      );
      if (!matches) {
        continue;
      }
      anyRuleMatched = true;
      let ruleAddedAny: boolean = false;
      const notify: boolean =
        rule.notifyOwners !== false && data.allowOwnerNotification;
      for (const user of rule.ownerUsers || []) {
        if (user.id) {
          usersByNotify.get(notify)!.add(user.id.toString());
          allUserIds.add(user.id.toString());
          ruleAddedAny = true;
        }
      }
      for (const team of rule.ownerTeams || []) {
        if (team.id) {
          teamsByNotify.get(notify)!.add(team.id.toString());
          allTeamIds.add(team.id.toString());
          ruleAddedAny = true;
        }
      }
      if (ruleAddedAny) {
        matchedRules.push(rule);
      }
    }

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    // The rules that matched name no owners, so there is nothing to add.
    if (matchedRules.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    // Owners already on the Docker Swarm cluster are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: DockerSwarmClusterOwnerUserService,
        ownerTeamService: DockerSwarmClusterOwnerTeamService,
        resourceIdColumn: "dockerSwarmClusterId",
        resourceId: dockerSwarmCluster.id,
        userIds: Array.from(allUserIds),
        teamIds: Array.from(allTeamIds),
      });

    const userIdsToAdd: Set<string> = new Set(
      notYetAssigned.userIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );
    const teamIdsToAdd: Set<string> = new Set(
      notYetAssigned.teamIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    let ownersAdded: number = 0;

    /*
     * The notifying set goes first, so an owner two matching rules disagree
     * about is added once, and notified.
     */
    for (const notify of [true, false]) {
      const userIds: Array<string> = Array.from(
        usersByNotify.get(notify)!,
      ).filter((id: string): boolean => {
        return userIdsToAdd.delete(id);
      });
      const teamIds: Array<string> = Array.from(
        teamsByNotify.get(notify)!,
      ).filter((id: string): boolean => {
        return teamIdsToAdd.delete(id);
      });

      for (const userId of userIds) {
        const owner: DockerSwarmClusterOwnerUser =
          new DockerSwarmClusterOwnerUser();
        owner.dockerSwarmClusterId = dockerSwarmCluster.id;
        owner.projectId = dockerSwarmCluster.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: DockerSwarmClusterOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }

      for (const teamId of teamIds) {
        const owner: DockerSwarmClusterOwnerTeam =
          new DockerSwarmClusterOwnerTeam();
        owner.dockerSwarmClusterId = dockerSwarmCluster.id;
        owner.projectId = dockerSwarmCluster.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: DockerSwarmClusterOwnerTeamService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }
    }

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    logger.debug(
      `DockerSwarmClusterOwnerRuleEngine added owners to DockerSwarm cluster ${dockerSwarmCluster.id}`,
      { projectId: dockerSwarmCluster.projectId.toString() } as LogAttributes,
    );
    /*
     * The individual OwnerUserAdded / OwnerTeamAdded items say who was added;
     * this one says which rule is responsible, which is what somebody asking
     * "why am I on the hook for this?" actually needs.
     */
    await DockerSwarmClusterFeedService.createDockerSwarmClusterFeedItem({
      dockerSwarmClusterId: dockerSwarmCluster.id,
      projectId: dockerSwarmCluster.projectId,
      dockerSwarmClusterFeedEventType:
        DockerSwarmClusterFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `👥 Owners were added to ${await DockerSwarmClusterService.getDockerSwarmClusterMarkdownLink(
        dockerSwarmCluster.projectId,
        dockerSwarmCluster.id,
      )} by ${matchedRules.length} owner ${matchedRules.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Owner rules that matched**: ${matchedRules
        .map((rule: DockerSwarmClusterOwnerRule) => {
          return `\`${rule.name || rule.id?.toString() || "Unnamed rule"}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesDockerSwarmClusterMatchRule(
    dockerSwarmCluster: DockerSwarmCluster,
    rule: DockerSwarmClusterOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "dockerSwarmClusterLabels",
        "dockerSwarmClusterNamePattern",
        "dockerSwarmClusterDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: DockerSwarmClusterOwnerRule): boolean => {
        return this.doesDockerSwarmClusterMatchLegacyRule(
          dockerSwarmCluster,
          legacyRule,
        );
      },
    });
  }

  private doesDockerSwarmClusterMatchLegacyRule(
    dockerSwarmCluster: DockerSwarmCluster,
    rule: DockerSwarmClusterOwnerRule,
  ): boolean {
    if (
      rule.dockerSwarmClusterLabels &&
      rule.dockerSwarmClusterLabels.length > 0
    ) {
      if (
        !dockerSwarmCluster.labels ||
        dockerSwarmCluster.labels.length === 0
      ) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.dockerSwarmClusterLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = dockerSwarmCluster.labels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      if (
        !ruleLabelIds.some((id: string) => {
          return labelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.dockerSwarmClusterNamePattern &&
      (!dockerSwarmCluster.name ||
        !this.testRegex(
          rule.dockerSwarmClusterNamePattern,
          dockerSwarmCluster.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.dockerSwarmClusterDescriptionPattern &&
      (!dockerSwarmCluster.description ||
        !this.testRegex(
          rule.dockerSwarmClusterDescriptionPattern,
          dockerSwarmCluster.description,
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
    rule: DockerSwarmClusterOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in DockerSwarm cluster owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new DockerSwarmClusterOwnerRuleEngineServiceClass();
