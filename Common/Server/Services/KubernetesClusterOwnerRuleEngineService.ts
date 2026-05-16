import Label from "../../Models/DatabaseModels/Label";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import KubernetesClusterOwnerRule from "../../Models/DatabaseModels/KubernetesClusterOwnerRule";
import KubernetesClusterOwnerUser from "../../Models/DatabaseModels/KubernetesClusterOwnerUser";
import KubernetesClusterOwnerTeam from "../../Models/DatabaseModels/KubernetesClusterOwnerTeam";
import KubernetesClusterOwnerRuleService from "./KubernetesClusterOwnerRuleService";
import KubernetesClusterOwnerUserService from "./KubernetesClusterOwnerUserService";
import KubernetesClusterOwnerTeamService from "./KubernetesClusterOwnerTeamService";
import KubernetesClusterService from "./KubernetesClusterService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class KubernetesClusterOwnerRuleEngineServiceClass {
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
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            kubernetesClusterLabels: { _id: true },
            kubernetesClusterNamePattern: true,
            kubernetesClusterDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
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

      const matchedRules: Array<KubernetesClusterOwnerRule> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesKubernetesClusterMatchRule(
          kubernetesClusterWithDetails,
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
          const owner: KubernetesClusterOwnerUser =
            new KubernetesClusterOwnerUser();
          owner.kubernetesClusterId = kubernetesCluster.id;
          owner.projectId = kubernetesCluster.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await KubernetesClusterOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
        }

        for (const teamId of teamIds) {
          const owner: KubernetesClusterOwnerTeam =
            new KubernetesClusterOwnerTeam();
          owner.kubernetesClusterId = kubernetesCluster.id;
          owner.projectId = kubernetesCluster.projectId;
          owner.teamId = new ObjectID(teamId);
          owner.isOwnerNotified = !notify;
          await KubernetesClusterOwnerTeamService.create({
            data: owner,
            props: { isRoot: true },
          });
        }
      }

      logger.debug(
        `KubernetesClusterOwnerRuleEngine added owners to Kubernetes cluster ${kubernetesCluster.id}`,
        { projectId: kubernetesCluster.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying Kubernetes cluster owner rules: ${error}`, {
        projectId: kubernetesCluster.projectId?.toString(),
        kubernetesClusterId: kubernetesCluster.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesKubernetesClusterMatchRule(
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
