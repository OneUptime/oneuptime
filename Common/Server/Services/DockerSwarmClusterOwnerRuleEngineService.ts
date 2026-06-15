import Label from "../../Models/DatabaseModels/Label";
import DockerSwarmCluster from "../../Models/DatabaseModels/DockerSwarmCluster";
import DockerSwarmClusterOwnerRule from "../../Models/DatabaseModels/DockerSwarmClusterOwnerRule";
import DockerSwarmClusterOwnerUser from "../../Models/DatabaseModels/DockerSwarmClusterOwnerUser";
import DockerSwarmClusterOwnerTeam from "../../Models/DatabaseModels/DockerSwarmClusterOwnerTeam";
import DockerSwarmClusterOwnerRuleService from "./DockerSwarmClusterOwnerRuleService";
import DockerSwarmClusterOwnerUserService from "./DockerSwarmClusterOwnerUserService";
import DockerSwarmClusterOwnerTeamService from "./DockerSwarmClusterOwnerTeamService";
import DockerSwarmClusterService from "./DockerSwarmClusterService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class DockerSwarmClusterOwnerRuleEngineServiceClass {
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
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            dockerSwarmClusterLabels: { _id: true },
            dockerSwarmClusterNamePattern: true,
            dockerSwarmClusterDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
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
        return;
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

      for (const rule of rules) {
        const matches: boolean = this.doesDockerSwarmClusterMatchRule(
          dockerSwarmClusterWithDetails,
          rule,
        );
        if (!matches) {
          continue;
        }
        let ruleAddedAny: boolean = false;
        const notify: boolean = rule.notifyOwners !== false;
        for (const user of rule.ownerUsers || []) {
          if (user.id) {
            usersByNotify.get(notify)!.add(user.id.toString());
            ruleAddedAny = true;
          }
        }
        for (const team of rule.ownerTeams || []) {
          if (team.id) {
            teamsByNotify.get(notify)!.add(team.id.toString());
            ruleAddedAny = true;
          }
        }
        if (ruleAddedAny) {
          matchedRules.push(rule);
        }
      }

      if (matchedRules.length === 0) {
        return;
      }

      for (const notify of [true, false]) {
        const userIds: Set<string> = usersByNotify.get(notify)!;
        const teamIds: Set<string> = teamsByNotify.get(notify)!;

        for (const userId of userIds) {
          const owner: DockerSwarmClusterOwnerUser =
            new DockerSwarmClusterOwnerUser();
          owner.dockerSwarmClusterId = dockerSwarmCluster.id;
          owner.projectId = dockerSwarmCluster.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await DockerSwarmClusterOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
        }

        for (const teamId of teamIds) {
          const owner: DockerSwarmClusterOwnerTeam =
            new DockerSwarmClusterOwnerTeam();
          owner.dockerSwarmClusterId = dockerSwarmCluster.id;
          owner.projectId = dockerSwarmCluster.projectId;
          owner.teamId = new ObjectID(teamId);
          owner.isOwnerNotified = !notify;
          await DockerSwarmClusterOwnerTeamService.create({
            data: owner,
            props: { isRoot: true },
          });
        }
      }

      logger.debug(
        `DockerSwarmClusterOwnerRuleEngine added owners to DockerSwarm cluster ${dockerSwarmCluster.id}`,
        { projectId: dockerSwarmCluster.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying DockerSwarm cluster owner rules: ${error}`, {
        projectId: dockerSwarmCluster.projectId?.toString(),
        dockerSwarmClusterId: dockerSwarmCluster.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesDockerSwarmClusterMatchRule(
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
