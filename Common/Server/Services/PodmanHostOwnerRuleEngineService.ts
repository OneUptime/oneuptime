import Label from "../../Models/DatabaseModels/Label";
import PodmanHost from "../../Models/DatabaseModels/PodmanHost";
import PodmanHostOwnerRule from "../../Models/DatabaseModels/PodmanHostOwnerRule";
import PodmanHostOwnerUser from "../../Models/DatabaseModels/PodmanHostOwnerUser";
import PodmanHostOwnerTeam from "../../Models/DatabaseModels/PodmanHostOwnerTeam";
import PodmanHostOwnerRuleService from "./PodmanHostOwnerRuleService";
import PodmanHostOwnerUserService from "./PodmanHostOwnerUserService";
import PodmanHostOwnerTeamService from "./PodmanHostOwnerTeamService";
import PodmanHostService from "./PodmanHostService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class PodmanHostOwnerRuleEngineServiceClass {
  /**
   * Evaluates PodmanHostOwnerRule rows for the given Podman host and adds matched
   * owner users / teams via PodmanHostOwnerUserService / PodmanHostOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToPodmanHost(podmanHost: PodmanHost): Promise<void> {
    if (!podmanHost.id || !podmanHost.projectId) {
      return;
    }

    try {
      const rules: Array<PodmanHostOwnerRule> =
        await PodmanHostOwnerRuleService.findBy({
          query: {
            projectId: podmanHost.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            podmanHostLabels: { _id: true },
            podmanHostNamePattern: true,
            podmanHostDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const podmanHostWithDetails: PodmanHost | null =
        await PodmanHostService.findOneById({
          id: podmanHost.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!podmanHostWithDetails) {
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

      const matchedRules: Array<PodmanHostOwnerRule> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesPodmanHostMatchRule(
          podmanHostWithDetails,
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
          const owner: PodmanHostOwnerUser = new PodmanHostOwnerUser();
          owner.podmanHostId = podmanHost.id;
          owner.projectId = podmanHost.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await PodmanHostOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
        }

        for (const teamId of teamIds) {
          const owner: PodmanHostOwnerTeam = new PodmanHostOwnerTeam();
          owner.podmanHostId = podmanHost.id;
          owner.projectId = podmanHost.projectId;
          owner.teamId = new ObjectID(teamId);
          owner.isOwnerNotified = !notify;
          await PodmanHostOwnerTeamService.create({
            data: owner,
            props: { isRoot: true },
          });
        }
      }

      logger.debug(
        `PodmanHostOwnerRuleEngine added owners to Podman host ${podmanHost.id}`,
        { projectId: podmanHost.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying Podman host owner rules: ${error}`, {
        projectId: podmanHost.projectId?.toString(),
        podmanHostId: podmanHost.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesPodmanHostMatchRule(
    podmanHost: PodmanHost,
    rule: PodmanHostOwnerRule,
  ): boolean {
    if (rule.podmanHostLabels && rule.podmanHostLabels.length > 0) {
      if (!podmanHost.labels || podmanHost.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.podmanHostLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = podmanHost.labels.map((l: Label) => {
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
      rule.podmanHostNamePattern &&
      (!podmanHost.name ||
        !this.testRegex(rule.podmanHostNamePattern, podmanHost.name, rule))
    ) {
      return false;
    }

    if (
      rule.podmanHostDescriptionPattern &&
      (!podmanHost.description ||
        !this.testRegex(
          rule.podmanHostDescriptionPattern,
          podmanHost.description,
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
    rule: PodmanHostOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in Podman host owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new PodmanHostOwnerRuleEngineServiceClass();
