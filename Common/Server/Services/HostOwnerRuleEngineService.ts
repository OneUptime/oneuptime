import Label from "../../Models/DatabaseModels/Label";
import Host from "../../Models/DatabaseModels/Host";
import HostOwnerRule from "../../Models/DatabaseModels/HostOwnerRule";
import HostOwnerUser from "../../Models/DatabaseModels/HostOwnerUser";
import HostOwnerTeam from "../../Models/DatabaseModels/HostOwnerTeam";
import HostOwnerRuleService from "./HostOwnerRuleService";
import HostOwnerUserService from "./HostOwnerUserService";
import HostOwnerTeamService from "./HostOwnerTeamService";
import HostService from "./HostService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class HostOwnerRuleEngineServiceClass {
  /**
   * Evaluates HostOwnerRule rows for the given host and adds matched
   * owner users / teams via HostOwnerUserService / HostOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToHost(host: Host): Promise<void> {
    if (!host.id || !host.projectId) {
      return;
    }

    try {
      const rules: Array<HostOwnerRule> = await HostOwnerRuleService.findBy({
        query: {
          projectId: host.projectId,
          isEnabled: true,
        },
        props: { isRoot: true },
        select: {
          _id: true,
          name: true,
          notifyOwners: true,
          hostLabels: { _id: true },
          hostNamePattern: true,
          hostDescriptionPattern: true,
          ownerUsers: { _id: true },
          ownerTeams: { _id: true },
        },
        limit: 100,
        skip: 0,
      });

      if (rules.length === 0) {
        return;
      }

      const hostWithDetails: Host | null = await HostService.findOneById({
        id: host.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

      if (!hostWithDetails) {
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

      const matchedRules: Array<HostOwnerRule> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesHostMatchRule(hostWithDetails, rule);
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
          const owner: HostOwnerUser = new HostOwnerUser();
          owner.hostId = host.id;
          owner.projectId = host.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await HostOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
        }

        for (const teamId of teamIds) {
          const owner: HostOwnerTeam = new HostOwnerTeam();
          owner.hostId = host.id;
          owner.projectId = host.projectId;
          owner.teamId = new ObjectID(teamId);
          owner.isOwnerNotified = !notify;
          await HostOwnerTeamService.create({
            data: owner,
            props: { isRoot: true },
          });
        }
      }

      logger.debug(`HostOwnerRuleEngine added owners to host ${host.id}`, {
        projectId: host.projectId.toString(),
      } as LogAttributes);
    } catch (error) {
      logger.error(`Error applying host owner rules: ${error}`, {
        projectId: host.projectId?.toString(),
        hostId: host.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesHostMatchRule(host: Host, rule: HostOwnerRule): boolean {
    if (rule.hostLabels && rule.hostLabels.length > 0) {
      if (!host.labels || host.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.hostLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = host.labels.map((l: Label) => {
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
      rule.hostNamePattern &&
      (!host.name || !this.testRegex(rule.hostNamePattern, host.name, rule))
    ) {
      return false;
    }

    if (
      rule.hostDescriptionPattern &&
      (!host.description ||
        !this.testRegex(rule.hostDescriptionPattern, host.description, rule))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: HostOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in host owner rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new HostOwnerRuleEngineServiceClass();
