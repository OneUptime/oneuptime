import Label from "../../Models/DatabaseModels/Label";
import Host from "../../Models/DatabaseModels/Host";
import HostOwnerRule from "../../Models/DatabaseModels/HostOwnerRule";
import HostOwnerUser from "../../Models/DatabaseModels/HostOwnerUser";
import HostOwnerTeam from "../../Models/DatabaseModels/HostOwnerTeam";
import HostOwnerRuleService from "./HostOwnerRuleService";
import HostOwnerUserService from "./HostOwnerUserService";
import HostOwnerTeamService from "./HostOwnerTeamService";
import HostService from "./HostService";
import HostFeedService from "./HostFeedService";
import { HostFeedEventType } from "../../Models/DatabaseModels/HostFeed";
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

class HostOwnerRuleEngineServiceClass
  implements RuleRunEngine<Host, HostOwnerRule>
{
  public readonly ruleSelect: Select<HostOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    hostLabels: { _id: true },
    hostNamePattern: true,
    hostDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the host, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<Host> = {
    _id: true,
    projectId: true,
  };

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
        select: this.ruleSelect,
        limit: MAX_RULES_EVALUATED_PER_PROJECT,
        skip: 0,
      });

      logIfRuleReadWasTruncated({
        ruleKind: "HostOwnerRule",
        projectId: host.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        host: host,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying host owner rules: ${error}`, {
        projectId: host.projectId?.toString(),
        hostId: host.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a host that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Host, HostOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        host: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running host owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        hostId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    host: Host;
    rules: Array<HostOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { host, rules } = data;

    if (!host.id || !host.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
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

    const matchedRules: Array<HostOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesHostMatchRule(hostWithDetails, rule);
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

    // Owners already on the host are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: HostOwnerUserService,
        ownerTeamService: HostOwnerTeamService,
        resourceIdColumn: "hostId",
        resourceId: host.id,
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
        const owner: HostOwnerUser = new HostOwnerUser();
        owner.hostId = host.id;
        owner.projectId = host.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        await HostOwnerUserService.create({
          data: owner,
          props: { isRoot: true },
        });
        ownersAdded++;
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
        ownersAdded++;
      }
    }

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    logger.debug(`HostOwnerRuleEngine added owners to host ${host.id}`, {
      projectId: host.projectId.toString(),
    } as LogAttributes);
    /*
     * The individual OwnerUserAdded / OwnerTeamAdded items say who was added;
     * this one says which rule is responsible, which is what somebody asking
     * "why am I on the hook for this?" actually needs.
     */
    await HostFeedService.createHostFeedItem({
      hostId: host.id,
      projectId: host.projectId,
      hostFeedEventType: HostFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `👥 Owners were added to ${await HostService.getHostMarkdownLink(
        host.projectId,
        host.id,
      )} by ${matchedRules.length} owner ${matchedRules.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Owner rules that matched**: ${matchedRules
        .map((rule: HostOwnerRule) => {
          return `\`${rule.name || rule.id?.toString() || "Unnamed rule"}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesHostMatchRule(host: Host, rule: HostOwnerRule): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: ["hostLabels", "hostNamePattern", "hostDescriptionPattern"],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: HostOwnerRule): boolean => {
        return this.doesHostMatchLegacyRule(host, legacyRule);
      },
    });
  }

  private doesHostMatchLegacyRule(host: Host, rule: HostOwnerRule): boolean {
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
