import Label from "../../Models/DatabaseModels/Label";
import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceOwnerRule from "../../Models/DatabaseModels/NetworkDeviceOwnerRule";
import NetworkDeviceOwnerUser from "../../Models/DatabaseModels/NetworkDeviceOwnerUser";
import NetworkDeviceOwnerTeam from "../../Models/DatabaseModels/NetworkDeviceOwnerTeam";
import NetworkDeviceOwnerRuleService from "./NetworkDeviceOwnerRuleService";
import NetworkDeviceOwnerUserService from "./NetworkDeviceOwnerUserService";
import NetworkDeviceOwnerTeamService from "./NetworkDeviceOwnerTeamService";
import NetworkDeviceService from "./NetworkDeviceService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class NetworkDeviceOwnerRuleEngineServiceClass {
  /**
   * Evaluates NetworkDeviceOwnerRule rows for the given network device and adds matched
   * owner users / teams via NetworkDeviceOwnerUserService / NetworkDeviceOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToNetworkDevice(
    networkDevice: NetworkDevice,
  ): Promise<void> {
    if (!networkDevice.id || !networkDevice.projectId) {
      return;
    }

    try {
      const rules: Array<NetworkDeviceOwnerRule> =
        await NetworkDeviceOwnerRuleService.findBy({
          query: {
            projectId: networkDevice.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            networkDeviceLabels: { _id: true },
            networkDeviceNamePattern: true,
            networkDeviceDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const networkDeviceWithDetails: NetworkDevice | null =
        await NetworkDeviceService.findOneById({
          id: networkDevice.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!networkDeviceWithDetails) {
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

      const matchedRules: Array<NetworkDeviceOwnerRule> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesNetworkDeviceMatchRule(
          networkDeviceWithDetails,
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
          const owner: NetworkDeviceOwnerUser = new NetworkDeviceOwnerUser();
          owner.networkDeviceId = networkDevice.id;
          owner.projectId = networkDevice.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await NetworkDeviceOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
        }

        for (const teamId of teamIds) {
          const owner: NetworkDeviceOwnerTeam = new NetworkDeviceOwnerTeam();
          owner.networkDeviceId = networkDevice.id;
          owner.projectId = networkDevice.projectId;
          owner.teamId = new ObjectID(teamId);
          owner.isOwnerNotified = !notify;
          await NetworkDeviceOwnerTeamService.create({
            data: owner,
            props: { isRoot: true },
          });
        }
      }

      logger.debug(
        `NetworkDeviceOwnerRuleEngine added owners to network device ${networkDevice.id}`,
        { projectId: networkDevice.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying network device owner rules: ${error}`, {
        projectId: networkDevice.projectId?.toString(),
        networkDeviceId: networkDevice.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesNetworkDeviceMatchRule(
    networkDevice: NetworkDevice,
    rule: NetworkDeviceOwnerRule,
  ): boolean {
    if (rule.networkDeviceLabels && rule.networkDeviceLabels.length > 0) {
      if (!networkDevice.labels || networkDevice.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.networkDeviceLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = networkDevice.labels.map((l: Label) => {
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
      rule.networkDeviceNamePattern &&
      (!networkDevice.name ||
        !this.testRegex(
          rule.networkDeviceNamePattern,
          networkDevice.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.networkDeviceDescriptionPattern &&
      (!networkDevice.description ||
        !this.testRegex(
          rule.networkDeviceDescriptionPattern,
          networkDevice.description,
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
    rule: NetworkDeviceOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in network device owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new NetworkDeviceOwnerRuleEngineServiceClass();
