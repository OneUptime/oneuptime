import Label from "../../Models/DatabaseModels/Label";
import ProxmoxCluster from "../../Models/DatabaseModels/ProxmoxCluster";
import ProxmoxClusterOwnerRule from "../../Models/DatabaseModels/ProxmoxClusterOwnerRule";
import ProxmoxClusterOwnerUser from "../../Models/DatabaseModels/ProxmoxClusterOwnerUser";
import ProxmoxClusterOwnerTeam from "../../Models/DatabaseModels/ProxmoxClusterOwnerTeam";
import ProxmoxClusterOwnerRuleService from "./ProxmoxClusterOwnerRuleService";
import ProxmoxClusterOwnerUserService from "./ProxmoxClusterOwnerUserService";
import ProxmoxClusterOwnerTeamService from "./ProxmoxClusterOwnerTeamService";
import ProxmoxClusterService from "./ProxmoxClusterService";
import ProxmoxClusterFeedService from "./ProxmoxClusterFeedService";
import { ProxmoxClusterFeedEventType } from "../../Models/DatabaseModels/ProxmoxClusterFeed";
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

class ProxmoxClusterOwnerRuleEngineServiceClass
  implements RuleRunEngine<ProxmoxCluster, ProxmoxClusterOwnerRule>
{
  public readonly ruleSelect: Select<ProxmoxClusterOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    proxmoxClusterLabels: { _id: true },
    proxmoxClusterNamePattern: true,
    proxmoxClusterDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the Proxmox cluster, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<ProxmoxCluster> = {
    _id: true,
    projectId: true,
  };

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
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "ProxmoxClusterOwnerRule",
        projectId: proxmoxCluster.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        proxmoxCluster: proxmoxCluster,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying Proxmox cluster owner rules: ${error}`, {
        projectId: proxmoxCluster.projectId?.toString(),
        proxmoxClusterId: proxmoxCluster.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a Proxmox cluster that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      ProxmoxCluster,
      ProxmoxClusterOwnerRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        proxmoxCluster: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running Proxmox cluster owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        proxmoxClusterId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    proxmoxCluster: ProxmoxCluster;
    rules: Array<ProxmoxClusterOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { proxmoxCluster, rules } = data;

    if (!proxmoxCluster.id || !proxmoxCluster.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
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

    const matchedRules: Array<ProxmoxClusterOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesProxmoxClusterMatchRule(
        proxmoxClusterWithDetails,
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

    if (
      matchedRules.length === 0 ||
      (allUserIds.size === 0 && allTeamIds.size === 0)
    ) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    // Owners already on the Proxmox cluster are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: ProxmoxClusterOwnerUserService,
        ownerTeamService: ProxmoxClusterOwnerTeamService,
        resourceIdColumn: "proxmoxClusterId",
        resourceId: proxmoxCluster.id,
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

    let ownersAdded: number = 0;

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
        ownersAdded++;
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
        ownersAdded++;
      }
    }

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    logger.debug(
      `ProxmoxClusterOwnerRuleEngine added owners to Proxmox cluster ${proxmoxCluster.id}`,
      { projectId: proxmoxCluster.projectId.toString() } as LogAttributes,
    );
    /*
     * The individual OwnerUserAdded / OwnerTeamAdded items say who was added;
     * this one says which rule is responsible, which is what somebody asking
     * "why am I on the hook for this?" actually needs.
     */
    await ProxmoxClusterFeedService.createProxmoxClusterFeedItem({
      proxmoxClusterId: proxmoxCluster.id,
      projectId: proxmoxCluster.projectId,
      proxmoxClusterFeedEventType:
        ProxmoxClusterFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `👥 Owners were added to ${await ProxmoxClusterService.getProxmoxClusterMarkdownLink(
        proxmoxCluster.projectId,
        proxmoxCluster.id,
      )} by ${matchedRules.length} owner ${matchedRules.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Owner rules that matched**: ${matchedRules
        .map((rule: ProxmoxClusterOwnerRule) => {
          return `\`${rule.name || rule.id?.toString() || "Unnamed rule"}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesProxmoxClusterMatchRule(
    proxmoxCluster: ProxmoxCluster,
    rule: ProxmoxClusterOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "proxmoxClusterLabels",
        "proxmoxClusterNamePattern",
        "proxmoxClusterDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (
        proxmoxClusterRule: ProxmoxClusterOwnerRule,
      ): boolean => {
        return this.doesProxmoxClusterMatchRuleLegacy(
          proxmoxCluster,
          proxmoxClusterRule,
        );
      },
    });
  }

  private doesProxmoxClusterMatchRuleLegacy(
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
