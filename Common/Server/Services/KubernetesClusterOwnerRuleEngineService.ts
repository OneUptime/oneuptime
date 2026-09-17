import Label from "../../Models/DatabaseModels/Label";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import KubernetesClusterOwnerRule from "../../Models/DatabaseModels/KubernetesClusterOwnerRule";
import KubernetesClusterOwnerUser from "../../Models/DatabaseModels/KubernetesClusterOwnerUser";
import KubernetesClusterOwnerTeam from "../../Models/DatabaseModels/KubernetesClusterOwnerTeam";
import KubernetesClusterOwnerRuleService from "./KubernetesClusterOwnerRuleService";
import KubernetesClusterOwnerUserService from "./KubernetesClusterOwnerUserService";
import KubernetesClusterOwnerTeamService from "./KubernetesClusterOwnerTeamService";
import KubernetesClusterService from "./KubernetesClusterService";
import KubernetesClusterFeedService from "./KubernetesClusterFeedService";
import { KubernetesClusterFeedEventType } from "../../Models/DatabaseModels/KubernetesClusterFeed";
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

class KubernetesClusterOwnerRuleEngineServiceClass
  implements RuleRunEngine<KubernetesCluster, KubernetesClusterOwnerRule>
{
  public readonly ruleSelect: Select<KubernetesClusterOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    kubernetesClusterLabels: { _id: true },
    kubernetesClusterNamePattern: true,
    kubernetesClusterDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the Kubernetes cluster, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<KubernetesCluster> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates KubernetesClusterOwnerRule rows for the given Kubernetes cluster and adds matched
   * owner users / teams via KubernetesClusterOwnerUserService / KubernetesClusterOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToKubernetesCluster(
    kubernetesCluster: KubernetesCluster,
  ): Promise<void> {
    if (!kubernetesCluster.id || !kubernetesCluster.projectId) {
      return;
    }

    try {
      const rules: Array<KubernetesClusterOwnerRule> =
        await KubernetesClusterOwnerRuleService.findBy({
          query: {
            projectId: kubernetesCluster.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "KubernetesClusterOwnerRule",
        projectId: kubernetesCluster.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        kubernetesCluster: kubernetesCluster,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying Kubernetes cluster owner rules: ${error}`, {
        projectId: kubernetesCluster.projectId?.toString(),
        kubernetesClusterId: kubernetesCluster.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a Kubernetes cluster that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      KubernetesCluster,
      KubernetesClusterOwnerRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        kubernetesCluster: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running Kubernetes cluster owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        kubernetesClusterId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    kubernetesCluster: KubernetesCluster;
    rules: Array<KubernetesClusterOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { kubernetesCluster, rules } = data;

    if (
      !kubernetesCluster.id ||
      !kubernetesCluster.projectId ||
      rules.length === 0
    ) {
      return RuleApplicationResultUtil.noMatch();
    }

    const kubernetesClusterWithDetails: KubernetesCluster | null =
      await KubernetesClusterService.findOneById({
        id: kubernetesCluster.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!kubernetesClusterWithDetails) {
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

    const matchedRules: Array<KubernetesClusterOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesKubernetesClusterMatchRule(
        kubernetesClusterWithDetails,
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

    // Owners already on the Kubernetes cluster are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: KubernetesClusterOwnerUserService,
        ownerTeamService: KubernetesClusterOwnerTeamService,
        resourceIdColumn: "kubernetesClusterId",
        resourceId: kubernetesCluster.id,
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
        const owner: KubernetesClusterOwnerUser =
          new KubernetesClusterOwnerUser();
        owner.kubernetesClusterId = kubernetesCluster.id;
        owner.projectId = kubernetesCluster.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: KubernetesClusterOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }

      for (const teamId of teamIds) {
        const owner: KubernetesClusterOwnerTeam =
          new KubernetesClusterOwnerTeam();
        owner.kubernetesClusterId = kubernetesCluster.id;
        owner.projectId = kubernetesCluster.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: KubernetesClusterOwnerTeamService,
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
      `KubernetesClusterOwnerRuleEngine added owners to Kubernetes cluster ${kubernetesCluster.id}`,
      { projectId: kubernetesCluster.projectId.toString() } as LogAttributes,
    );
    /*
     * The individual OwnerUserAdded / OwnerTeamAdded items say who was added;
     * this one says which rule is responsible, which is what somebody asking
     * "why am I on the hook for this?" actually needs.
     */
    await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
      kubernetesClusterId: kubernetesCluster.id,
      projectId: kubernetesCluster.projectId,
      kubernetesClusterFeedEventType:
        KubernetesClusterFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `👥 Owners were added to ${await KubernetesClusterService.getKubernetesClusterMarkdownLink(
        kubernetesCluster.projectId,
        kubernetesCluster.id,
      )} by ${matchedRules.length} owner ${matchedRules.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Owner rules that matched**: ${matchedRules
        .map((rule: KubernetesClusterOwnerRule) => {
          return `\`${rule.name || rule.id?.toString() || "Unnamed rule"}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesKubernetesClusterMatchRule(
    kubernetesCluster: KubernetesCluster,
    rule: KubernetesClusterOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "kubernetesClusterLabels",
        "kubernetesClusterNamePattern",
        "kubernetesClusterDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: KubernetesClusterOwnerRule): boolean => {
        return this.doesKubernetesClusterMatchLegacyRule(
          kubernetesCluster,
          legacyRule,
        );
      },
    });
  }

  private doesKubernetesClusterMatchLegacyRule(
    kubernetesCluster: KubernetesCluster,
    rule: KubernetesClusterOwnerRule,
  ): boolean {
    if (
      rule.kubernetesClusterLabels &&
      rule.kubernetesClusterLabels.length > 0
    ) {
      if (!kubernetesCluster.labels || kubernetesCluster.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.kubernetesClusterLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = kubernetesCluster.labels.map(
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
      rule.kubernetesClusterNamePattern &&
      (!kubernetesCluster.name ||
        !this.testRegex(
          rule.kubernetesClusterNamePattern,
          kubernetesCluster.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.kubernetesClusterDescriptionPattern &&
      (!kubernetesCluster.description ||
        !this.testRegex(
          rule.kubernetesClusterDescriptionPattern,
          kubernetesCluster.description,
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
    rule: KubernetesClusterOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in Kubernetes cluster owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new KubernetesClusterOwnerRuleEngineServiceClass();
