import Label from "../../Models/DatabaseModels/Label";
import PodmanHost from "../../Models/DatabaseModels/PodmanHost";
import PodmanHostOwnerRule from "../../Models/DatabaseModels/PodmanHostOwnerRule";
import PodmanHostOwnerUser from "../../Models/DatabaseModels/PodmanHostOwnerUser";
import PodmanHostOwnerTeam from "../../Models/DatabaseModels/PodmanHostOwnerTeam";
import PodmanHostOwnerRuleService from "./PodmanHostOwnerRuleService";
import PodmanHostOwnerUserService from "./PodmanHostOwnerUserService";
import PodmanHostOwnerTeamService from "./PodmanHostOwnerTeamService";
import PodmanHostService from "./PodmanHostService";
import PodmanHostFeedService from "./PodmanHostFeedService";
import { PodmanHostFeedEventType } from "../../Models/DatabaseModels/PodmanHostFeed";
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

class PodmanHostOwnerRuleEngineServiceClass
  implements RuleRunEngine<PodmanHost, PodmanHostOwnerRule>
{
  public readonly ruleSelect: Select<PodmanHostOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    podmanHostLabels: { _id: true },
    podmanHostNamePattern: true,
    podmanHostDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the Podman host, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<PodmanHost> = {
    _id: true,
    projectId: true,
  };

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
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "PodmanHostOwnerRule",
        projectId: podmanHost.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        podmanHost: podmanHost,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying Podman host owner rules: ${error}`, {
        projectId: podmanHost.projectId?.toString(),
        podmanHostId: podmanHost.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a Podman host that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<PodmanHost, PodmanHostOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        podmanHost: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running Podman host owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        podmanHostId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    podmanHost: PodmanHost;
    rules: Array<PodmanHostOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { podmanHost, rules } = data;

    if (!podmanHost.id || !podmanHost.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
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

    const matchedRules: Array<PodmanHostOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesPodmanHostMatchRule(
        podmanHostWithDetails,
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

    // Owners already on the Podman host are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: PodmanHostOwnerUserService,
        ownerTeamService: PodmanHostOwnerTeamService,
        resourceIdColumn: "podmanHostId",
        resourceId: podmanHost.id,
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
        const owner: PodmanHostOwnerUser = new PodmanHostOwnerUser();
        owner.podmanHostId = podmanHost.id;
        owner.projectId = podmanHost.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        await PodmanHostOwnerUserService.create({
          data: owner,
          props: { isRoot: true },
        });
        ownersAdded++;
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
        ownersAdded++;
      }
    }

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    logger.debug(
      `PodmanHostOwnerRuleEngine added owners to Podman host ${podmanHost.id}`,
      { projectId: podmanHost.projectId.toString() } as LogAttributes,
    );
    /*
     * The individual OwnerUserAdded / OwnerTeamAdded items say who was added;
     * this one says which rule is responsible, which is what somebody asking
     * "why am I on the hook for this?" actually needs.
     */
    await PodmanHostFeedService.createPodmanHostFeedItem({
      podmanHostId: podmanHost.id,
      projectId: podmanHost.projectId,
      podmanHostFeedEventType: PodmanHostFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `👥 Owners were added to ${await PodmanHostService.getPodmanHostMarkdownLink(
        podmanHost.projectId,
        podmanHost.id,
      )} by ${matchedRules.length} owner ${matchedRules.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Owner rules that matched**: ${matchedRules
        .map((rule: PodmanHostOwnerRule) => {
          return `\`${rule.name || rule.id?.toString() || "Unnamed rule"}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesPodmanHostMatchRule(
    podmanHost: PodmanHost,
    rule: PodmanHostOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "podmanHostLabels",
        "podmanHostNamePattern",
        "podmanHostDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (podmanHostRule: PodmanHostOwnerRule): boolean => {
        return this.doesPodmanHostMatchRuleLegacy(podmanHost, podmanHostRule);
      },
    });
  }

  private doesPodmanHostMatchRuleLegacy(
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
