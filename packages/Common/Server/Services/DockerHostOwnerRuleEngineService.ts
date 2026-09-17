import Label from "../../Models/DatabaseModels/Label";
import DockerHost from "../../Models/DatabaseModels/DockerHost";
import DockerHostOwnerRule from "../../Models/DatabaseModels/DockerHostOwnerRule";
import DockerHostOwnerUser from "../../Models/DatabaseModels/DockerHostOwnerUser";
import DockerHostOwnerTeam from "../../Models/DatabaseModels/DockerHostOwnerTeam";
import DockerHostOwnerRuleService from "./DockerHostOwnerRuleService";
import DockerHostOwnerUserService from "./DockerHostOwnerUserService";
import DockerHostOwnerTeamService from "./DockerHostOwnerTeamService";
import DockerHostService from "./DockerHostService";
import DockerHostFeedService from "./DockerHostFeedService";
import { DockerHostFeedEventType } from "../../Models/DatabaseModels/DockerHostFeed";
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

class DockerHostOwnerRuleEngineServiceClass
  implements RuleRunEngine<DockerHost, DockerHostOwnerRule>
{
  public readonly ruleSelect: Select<DockerHostOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    dockerHostLabels: { _id: true },
    dockerHostNamePattern: true,
    dockerHostDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the Docker host, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<DockerHost> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates DockerHostOwnerRule rows for the given Docker host and adds matched
   * owner users / teams via DockerHostOwnerUserService / DockerHostOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToDockerHost(dockerHost: DockerHost): Promise<void> {
    if (!dockerHost.id || !dockerHost.projectId) {
      return;
    }

    try {
      const rules: Array<DockerHostOwnerRule> =
        await DockerHostOwnerRuleService.findBy({
          query: {
            projectId: dockerHost.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "DockerHostOwnerRule",
        projectId: dockerHost.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        dockerHost: dockerHost,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying Docker host owner rules: ${error}`, {
        projectId: dockerHost.projectId?.toString(),
        dockerHostId: dockerHost.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a Docker host that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<DockerHost, DockerHostOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        dockerHost: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running Docker host owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        dockerHostId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    dockerHost: DockerHost;
    rules: Array<DockerHostOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { dockerHost, rules } = data;

    if (!dockerHost.id || !dockerHost.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const dockerHostWithDetails: DockerHost | null =
      await DockerHostService.findOneById({
        id: dockerHost.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!dockerHostWithDetails) {
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

    const matchedRules: Array<DockerHostOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesDockerHostMatchRule(
        dockerHostWithDetails,
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

    // Owners already on the Docker host are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: DockerHostOwnerUserService,
        ownerTeamService: DockerHostOwnerTeamService,
        resourceIdColumn: "dockerHostId",
        resourceId: dockerHost.id,
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
        const owner: DockerHostOwnerUser = new DockerHostOwnerUser();
        owner.dockerHostId = dockerHost.id;
        owner.projectId = dockerHost.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: DockerHostOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }

      for (const teamId of teamIds) {
        const owner: DockerHostOwnerTeam = new DockerHostOwnerTeam();
        owner.dockerHostId = dockerHost.id;
        owner.projectId = dockerHost.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: DockerHostOwnerTeamService,
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
      `DockerHostOwnerRuleEngine added owners to Docker host ${dockerHost.id}`,
      { projectId: dockerHost.projectId.toString() } as LogAttributes,
    );
    /*
     * The individual OwnerUserAdded / OwnerTeamAdded items say who was added;
     * this one says which rule is responsible, which is what somebody asking
     * "why am I on the hook for this?" actually needs.
     */
    await DockerHostFeedService.createDockerHostFeedItem({
      dockerHostId: dockerHost.id,
      projectId: dockerHost.projectId,
      dockerHostFeedEventType: DockerHostFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `👥 Owners were added to ${await DockerHostService.getDockerHostMarkdownLink(
        dockerHost.projectId,
        dockerHost.id,
      )} by ${matchedRules.length} owner ${matchedRules.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Owner rules that matched**: ${matchedRules
        .map((rule: DockerHostOwnerRule) => {
          return `\`${rule.name || rule.id?.toString() || "Unnamed rule"}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesDockerHostMatchRule(
    dockerHost: DockerHost,
    rule: DockerHostOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "dockerHostLabels",
        "dockerHostNamePattern",
        "dockerHostDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: DockerHostOwnerRule): boolean => {
        return this.doesDockerHostMatchLegacyRule(dockerHost, legacyRule);
      },
    });
  }

  private doesDockerHostMatchLegacyRule(
    dockerHost: DockerHost,
    rule: DockerHostOwnerRule,
  ): boolean {
    if (rule.dockerHostLabels && rule.dockerHostLabels.length > 0) {
      if (!dockerHost.labels || dockerHost.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.dockerHostLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = dockerHost.labels.map((l: Label) => {
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
      rule.dockerHostNamePattern &&
      (!dockerHost.name ||
        !this.testRegex(rule.dockerHostNamePattern, dockerHost.name, rule))
    ) {
      return false;
    }

    if (
      rule.dockerHostDescriptionPattern &&
      (!dockerHost.description ||
        !this.testRegex(
          rule.dockerHostDescriptionPattern,
          dockerHost.description,
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
    rule: DockerHostOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in Docker host owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new DockerHostOwnerRuleEngineServiceClass();
