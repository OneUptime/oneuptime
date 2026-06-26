import Label from "../../Models/DatabaseModels/Label";
import DockerHost from "../../Models/DatabaseModels/DockerHost";
import DockerHostOwnerRule from "../../Models/DatabaseModels/DockerHostOwnerRule";
import DockerHostOwnerUser from "../../Models/DatabaseModels/DockerHostOwnerUser";
import DockerHostOwnerTeam from "../../Models/DatabaseModels/DockerHostOwnerTeam";
import DockerHostOwnerRuleService from "./DockerHostOwnerRuleService";
import DockerHostOwnerUserService from "./DockerHostOwnerUserService";
import DockerHostOwnerTeamService from "./DockerHostOwnerTeamService";
import DockerHostService from "./DockerHostService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class DockerHostOwnerRuleEngineServiceClass {
  /**
   * Evaluates DockerHostOwnerRule rows for the given Docker host and adds matched
   * owner users / teams via DockerHostOwnerUserService / DockerHostOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToDockerHost(dockerHost: DockerHost): Promise<void> {
    if (!dockerHost.id || !dockerHost.projectId) {
      return;
    }

    try {
      const rules: Array<DockerHostOwnerRule> =
        await DockerHostOwnerRuleService.findBy({
          query: {
            projectId: dockerHost.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            dockerHostLabels: { _id: true },
            dockerHostNamePattern: true,
            dockerHostDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const dockerHostWithDetails: DockerHost | null =
        await DockerHostService.findOneById({
          id: dockerHost.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!dockerHostWithDetails) {
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

      const matchedRules: Array<DockerHostOwnerRule> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesDockerHostMatchRule(
          dockerHostWithDetails,
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
          const owner: DockerHostOwnerUser = new DockerHostOwnerUser();
          owner.dockerHostId = dockerHost.id;
          owner.projectId = dockerHost.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await DockerHostOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
        }

        for (const teamId of teamIds) {
          const owner: DockerHostOwnerTeam = new DockerHostOwnerTeam();
          owner.dockerHostId = dockerHost.id;
          owner.projectId = dockerHost.projectId;
          owner.teamId = new ObjectID(teamId);
          owner.isOwnerNotified = !notify;
          await DockerHostOwnerTeamService.create({
            data: owner,
            props: { isRoot: true },
          });
        }
      }

      logger.debug(
        `DockerHostOwnerRuleEngine added owners to Docker host ${dockerHost.id}`,
        { projectId: dockerHost.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying Docker host owner rules: ${error}`, {
        projectId: dockerHost.projectId?.toString(),
        dockerHostId: dockerHost.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesDockerHostMatchRule(
    dockerHost: DockerHost,
    rule: DockerHostOwnerRule,
  ): boolean {
    if (rule.dockerHostLabels && rule.dockerHostLabels.length > 0) {
      if (!dockerHost.labels || dockerHost.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.dockerHostLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = dockerHost.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      if (
        !ruleLabelIds.some((id: string) => {
          return labelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.dockerHostNamePattern &&
      (!dockerHost.name ||
        !this.testRegex(rule.dockerHostNamePattern, dockerHost.name, rule))
    ) {
      return false;
    }

    if (
      rule.dockerHostDescriptionPattern &&
      (!dockerHost.description ||
        !this.testRegex(
          rule.dockerHostDescriptionPattern,
          dockerHost.description,
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
    rule: DockerHostOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in Docker host owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new DockerHostOwnerRuleEngineServiceClass();
