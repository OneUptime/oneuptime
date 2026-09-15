import Label from "../../Models/DatabaseModels/Label";
import CephCluster from "../../Models/DatabaseModels/CephCluster";
import CephClusterOwnerRule from "../../Models/DatabaseModels/CephClusterOwnerRule";
import CephClusterOwnerUser from "../../Models/DatabaseModels/CephClusterOwnerUser";
import CephClusterOwnerTeam from "../../Models/DatabaseModels/CephClusterOwnerTeam";
import CephClusterOwnerRuleService from "./CephClusterOwnerRuleService";
import CephClusterOwnerUserService from "./CephClusterOwnerUserService";
import CephClusterOwnerTeamService from "./CephClusterOwnerTeamService";
import CephClusterService from "./CephClusterService";
import CephClusterFeedService from "./CephClusterFeedService";
import { CephClusterFeedEventType } from "../../Models/DatabaseModels/CephClusterFeed";
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

class CephClusterOwnerRuleEngineServiceClass
  implements RuleRunEngine<CephCluster, CephClusterOwnerRule>
{
  public readonly ruleSelect: Select<CephClusterOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    cephClusterLabels: { _id: true },
    cephClusterNamePattern: true,
    cephClusterDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the Ceph cluster, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<CephCluster> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates CephClusterOwnerRule rows for the given Ceph cluster and adds matched
   * owner users / teams via CephClusterOwnerUserService / CephClusterOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToCephCluster(
    cephCluster: CephCluster,
  ): Promise<void> {
    if (!cephCluster.id || !cephCluster.projectId) {
      return;
    }

    try {
      const rules: Array<CephClusterOwnerRule> =
        await CephClusterOwnerRuleService.findBy({
          query: {
            projectId: cephCluster.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "CephClusterOwnerRule",
        projectId: cephCluster.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        cephCluster: cephCluster,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying Ceph cluster owner rules: ${error}`, {
        projectId: cephCluster.projectId?.toString(),
        cephClusterId: cephCluster.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a Ceph cluster that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<CephCluster, CephClusterOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        cephCluster: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running Ceph cluster owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        cephClusterId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    cephCluster: CephCluster;
    rules: Array<CephClusterOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { cephCluster, rules } = data;

    if (!cephCluster.id || !cephCluster.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const cephClusterWithDetails: CephCluster | null =
      await CephClusterService.findOneById({
        id: cephCluster.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!cephClusterWithDetails) {
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

    const matchedRules: Array<CephClusterOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesCephClusterMatchRule(
        cephClusterWithDetails,
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

    // Owners already on the Ceph cluster are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: CephClusterOwnerUserService,
        ownerTeamService: CephClusterOwnerTeamService,
        resourceIdColumn: "cephClusterId",
        resourceId: cephCluster.id,
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
        const owner: CephClusterOwnerUser = new CephClusterOwnerUser();
        owner.cephClusterId = cephCluster.id;
        owner.projectId = cephCluster.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        await CephClusterOwnerUserService.create({
          data: owner,
          props: { isRoot: true },
        });
        ownersAdded++;
      }

      for (const teamId of teamIds) {
        const owner: CephClusterOwnerTeam = new CephClusterOwnerTeam();
        owner.cephClusterId = cephCluster.id;
        owner.projectId = cephCluster.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        await CephClusterOwnerTeamService.create({
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
      `CephClusterOwnerRuleEngine added owners to Ceph cluster ${cephCluster.id}`,
      { projectId: cephCluster.projectId.toString() } as LogAttributes,
    );
    /*
     * The individual OwnerUserAdded / OwnerTeamAdded items say who was added;
     * this one says which rule is responsible, which is what somebody asking
     * "why am I on the hook for this?" actually needs.
     */
    await CephClusterFeedService.createCephClusterFeedItem({
      cephClusterId: cephCluster.id,
      projectId: cephCluster.projectId,
      cephClusterFeedEventType: CephClusterFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `👥 Owners were added to ${await CephClusterService.getCephClusterMarkdownLink(
        cephCluster.projectId,
        cephCluster.id,
      )} by ${matchedRules.length} owner ${matchedRules.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Owner rules that matched**: ${matchedRules
        .map((rule: CephClusterOwnerRule) => {
          return `\`${rule.name || rule.id?.toString() || "Unnamed rule"}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesCephClusterMatchRule(
    cephCluster: CephCluster,
    rule: CephClusterOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "cephClusterLabels",
        "cephClusterNamePattern",
        "cephClusterDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: CephClusterOwnerRule): boolean => {
        return this.doesCephClusterMatchLegacyRule(cephCluster, legacyRule);
      },
    });
  }

  private doesCephClusterMatchLegacyRule(
    cephCluster: CephCluster,
    rule: CephClusterOwnerRule,
  ): boolean {
    if (rule.cephClusterLabels && rule.cephClusterLabels.length > 0) {
      if (!cephCluster.labels || cephCluster.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.cephClusterLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = cephCluster.labels.map((l: Label) => {
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
      rule.cephClusterNamePattern &&
      (!cephCluster.name ||
        !this.testRegex(rule.cephClusterNamePattern, cephCluster.name, rule))
    ) {
      return false;
    }

    if (
      rule.cephClusterDescriptionPattern &&
      (!cephCluster.description ||
        !this.testRegex(
          rule.cephClusterDescriptionPattern,
          cephCluster.description,
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
    rule: CephClusterOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in Ceph cluster owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new CephClusterOwnerRuleEngineServiceClass();
