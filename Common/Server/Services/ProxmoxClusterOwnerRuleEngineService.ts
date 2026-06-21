import Label from "../../Models/DatabaseModels/Label";
import ProxmoxCluster from "../../Models/DatabaseModels/ProxmoxCluster";
import ProxmoxClusterOwnerRule from "../../Models/DatabaseModels/ProxmoxClusterOwnerRule";
import ProxmoxClusterOwnerUser from "../../Models/DatabaseModels/ProxmoxClusterOwnerUser";
import ProxmoxClusterOwnerTeam from "../../Models/DatabaseModels/ProxmoxClusterOwnerTeam";
import ProxmoxClusterOwnerRuleService from "./ProxmoxClusterOwnerRuleService";
import ProxmoxClusterOwnerUserService from "./ProxmoxClusterOwnerUserService";
import ProxmoxClusterOwnerTeamService from "./ProxmoxClusterOwnerTeamService";
import ProxmoxClusterService from "./ProxmoxClusterService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class ProxmoxClusterOwnerRuleEngineServiceClass {
  /**
   * Evaluates ProxmoxClusterOwnerRule rows for the given Proxmox cluster and adds matched
   * owner users / teams via ProxmoxClusterOwnerUserService / ProxmoxClusterOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToProxmoxCluster(
    proxmoxCluster: ProxmoxCluster,
  ): Promise<void> {
    if (!proxmoxCluster.id || !proxmoxCluster.projectId) {
      return;
    }

    try {
      const rules: Array<ProxmoxClusterOwnerRule> =
        await ProxmoxClusterOwnerRuleService.findBy({
          query: {
            projectId: proxmoxCluster.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            proxmoxClusterLabels: { _id: true },
            proxmoxClusterNamePattern: true,
            proxmoxClusterDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const proxmoxClusterWithDetails: ProxmoxCluster | null =
        await ProxmoxClusterService.findOneById({
          id: proxmoxCluster.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!proxmoxClusterWithDetails) {
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

      const matchedRules: Array<ProxmoxClusterOwnerRule> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesProxmoxClusterMatchRule(
          proxmoxClusterWithDetails,
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
          const owner: ProxmoxClusterOwnerUser = new ProxmoxClusterOwnerUser();
          owner.proxmoxClusterId = proxmoxCluster.id;
          owner.projectId = proxmoxCluster.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await ProxmoxClusterOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
        }

        for (const teamId of teamIds) {
          const owner: ProxmoxClusterOwnerTeam = new ProxmoxClusterOwnerTeam();
          owner.proxmoxClusterId = proxmoxCluster.id;
          owner.projectId = proxmoxCluster.projectId;
          owner.teamId = new ObjectID(teamId);
          owner.isOwnerNotified = !notify;
          await ProxmoxClusterOwnerTeamService.create({
            data: owner,
            props: { isRoot: true },
          });
        }
      }

      logger.debug(
        `ProxmoxClusterOwnerRuleEngine added owners to Proxmox cluster ${proxmoxCluster.id}`,
        { projectId: proxmoxCluster.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying Proxmox cluster owner rules: ${error}`, {
        projectId: proxmoxCluster.projectId?.toString(),
        proxmoxClusterId: proxmoxCluster.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesProxmoxClusterMatchRule(
    proxmoxCluster: ProxmoxCluster,
    rule: ProxmoxClusterOwnerRule,
  ): boolean {
    if (rule.proxmoxClusterLabels && rule.proxmoxClusterLabels.length > 0) {
      if (!proxmoxCluster.labels || proxmoxCluster.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.proxmoxClusterLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = proxmoxCluster.labels.map((l: Label) => {
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
      rule.proxmoxClusterNamePattern &&
      (!proxmoxCluster.name ||
        !this.testRegex(
          rule.proxmoxClusterNamePattern,
          proxmoxCluster.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.proxmoxClusterDescriptionPattern &&
      (!proxmoxCluster.description ||
        !this.testRegex(
          rule.proxmoxClusterDescriptionPattern,
          proxmoxCluster.description,
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
    rule: ProxmoxClusterOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in Proxmox cluster owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new ProxmoxClusterOwnerRuleEngineServiceClass();
