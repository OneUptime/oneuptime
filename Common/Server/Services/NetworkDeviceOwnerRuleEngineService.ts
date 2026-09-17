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
import Select from "../Types/Database/Select";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
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

class NetworkDeviceOwnerRuleEngineServiceClass
  implements RuleRunEngine<NetworkDevice, NetworkDeviceOwnerRule>
{
  public readonly ruleSelect: Select<NetworkDeviceOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    networkDeviceLabels: { _id: true },
    networkDeviceNamePattern: true,
    networkDeviceDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the network device, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<NetworkDevice> = {
    _id: true,
    projectId: true,
  };

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
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "NetworkDeviceOwnerRule",
        projectId: networkDevice.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        networkDevice: networkDevice,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying network device owner rules: ${error}`, {
        projectId: networkDevice.projectId?.toString(),
        networkDeviceId: networkDevice.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a network device that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      NetworkDevice,
      NetworkDeviceOwnerRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        networkDevice: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running network device owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        networkDeviceId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    networkDevice: NetworkDevice;
    rules: Array<NetworkDeviceOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { networkDevice, rules } = data;

    if (!networkDevice.id || !networkDevice.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
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

    const matchedRules: Array<NetworkDeviceOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesNetworkDeviceMatchRule(
        networkDeviceWithDetails,
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

    // Owners already on the network device are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: NetworkDeviceOwnerUserService,
        ownerTeamService: NetworkDeviceOwnerTeamService,
        resourceIdColumn: "networkDeviceId",
        resourceId: networkDevice.id,
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
        const owner: NetworkDeviceOwnerUser = new NetworkDeviceOwnerUser();
        owner.networkDeviceId = networkDevice.id;
        owner.projectId = networkDevice.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: NetworkDeviceOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }

      for (const teamId of teamIds) {
        const owner: NetworkDeviceOwnerTeam = new NetworkDeviceOwnerTeam();
        owner.networkDeviceId = networkDevice.id;
        owner.projectId = networkDevice.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: NetworkDeviceOwnerTeamService,
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
      `NetworkDeviceOwnerRuleEngine added owners to network device ${networkDevice.id}`,
      { projectId: networkDevice.projectId.toString() } as LogAttributes,
    );

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesNetworkDeviceMatchRule(
    networkDevice: NetworkDevice,
    rule: NetworkDeviceOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "networkDeviceLabels",
        "networkDeviceNamePattern",
        "networkDeviceDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (
        networkDeviceRule: NetworkDeviceOwnerRule,
      ): boolean => {
        return this.doesNetworkDeviceMatchRuleLegacy(
          networkDevice,
          networkDeviceRule,
        );
      },
    });
  }

  private doesNetworkDeviceMatchRuleLegacy(
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
      !this.testPattern(rule.networkDeviceNamePattern, networkDevice.name, rule)
    ) {
      return false;
    }

    if (
      rule.networkDeviceDescriptionPattern &&
      !this.testPattern(
        rule.networkDeviceDescriptionPattern,
        networkDevice.description,
        rule,
      )
    ) {
      return false;
    }

    return true;
  }

  /*
   * Patterns are regexes, with a '*' wildcard fallback so the glob syntax the
   * neighbouring site assignment rules use does not silently match nothing.
   * See Common/Utils/Rules/RulePatternMatchUtil.
   */
  private testPattern(
    pattern: string,
    value: string | undefined,
    rule: NetworkDeviceOwnerRule,
  ): boolean {
    if (!RulePatternMatchUtil.isSupportedPattern(pattern)) {
      logger.warn(
        `Invalid pattern in network device owner rule ${rule.id}: ${pattern}. It is neither a valid regular expression nor a wildcard pattern, so it will never match.`,
      );
      return false;
    }

    return RulePatternMatchUtil.matches(value, pattern);
  }
}

export default new NetworkDeviceOwnerRuleEngineServiceClass();
