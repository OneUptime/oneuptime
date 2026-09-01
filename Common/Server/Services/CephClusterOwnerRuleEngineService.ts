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
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";

class CephClusterOwnerRuleEngineServiceClass {
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
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            cephClusterLabels: { _id: true },
            cephClusterNamePattern: true,
            cephClusterDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
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

      const matchedRules: Array<CephClusterOwnerRule> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesCephClusterMatchRule(
          cephClusterWithDetails,
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
          const owner: CephClusterOwnerUser = new CephClusterOwnerUser();
          owner.cephClusterId = cephCluster.id;
          owner.projectId = cephCluster.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await CephClusterOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
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
        }
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
    } catch (error) {
      logger.error(`Error applying Ceph cluster owner rules: ${error}`, {
        projectId: cephCluster.projectId?.toString(),
        cephClusterId: cephCluster.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesCephClusterMatchRule(
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
