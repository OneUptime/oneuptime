import Label from "../../Models/DatabaseModels/Label";
import VMwareVCenter from "../../Models/DatabaseModels/VMwareVCenter";
import VMwareVCenterOwnerRule from "../../Models/DatabaseModels/VMwareVCenterOwnerRule";
import VMwareVCenterOwnerUser from "../../Models/DatabaseModels/VMwareVCenterOwnerUser";
import VMwareVCenterOwnerTeam from "../../Models/DatabaseModels/VMwareVCenterOwnerTeam";
import VMwareVCenterOwnerRuleService from "./VMwareVCenterOwnerRuleService";
import VMwareVCenterOwnerUserService from "./VMwareVCenterOwnerUserService";
import VMwareVCenterOwnerTeamService from "./VMwareVCenterOwnerTeamService";
import VMwareVCenterService from "./VMwareVCenterService";
import VMwareVCenterFeedService from "./VMwareVCenterFeedService";
import { VMwareVCenterFeedEventType } from "../../Models/DatabaseModels/VMwareVCenterFeed";
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

class VMwareVCenterOwnerRuleEngineServiceClass
  implements RuleRunEngine<VMwareVCenter, VMwareVCenterOwnerRule>
{
  public readonly ruleSelect: Select<VMwareVCenterOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    vmwareVCenterLabels: { _id: true },
    vmwareVCenterNamePattern: true,
    vmwareVCenterDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the vCenter, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<VMwareVCenter> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates VMwareVCenterOwnerRule rows for the given vCenter and adds
   * matched owner users / teams via VMwareVCenterOwnerUserService /
   * VMwareVCenterOwnerTeamService. Rules with notifyOwners set notify the
   * added owners; rules with notifyOwners off add silently.
   */
  @CaptureSpan()
  public async applyRulesToVMwareVCenter(
    vmwareVCenter: VMwareVCenter,
  ): Promise<void> {
    if (!vmwareVCenter.id || !vmwareVCenter.projectId) {
      return;
    }

    try {
      const rules: Array<VMwareVCenterOwnerRule> =
        await VMwareVCenterOwnerRuleService.findBy({
          query: {
            projectId: vmwareVCenter.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "VMwareVCenterOwnerRule",
        projectId: vmwareVCenter.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        vmwareVCenter: vmwareVCenter,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying vCenter owner rules: ${error}`, {
        projectId: vmwareVCenter.projectId?.toString(),
        vmwareVCenterId: vmwareVCenter.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a vCenter that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      VMwareVCenter,
      VMwareVCenterOwnerRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        vmwareVCenter: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running vCenter owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        vmwareVCenterId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    vmwareVCenter: VMwareVCenter;
    rules: Array<VMwareVCenterOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { vmwareVCenter, rules } = data;

    if (!vmwareVCenter.id || !vmwareVCenter.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const vmwareVCenterWithDetails: VMwareVCenter | null =
      await VMwareVCenterService.findOneById({
        id: vmwareVCenter.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!vmwareVCenterWithDetails) {
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

    const matchedRules: Array<VMwareVCenterOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesVMwareVCenterMatchRule(
        vmwareVCenterWithDetails,
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

    // Owners already on the vCenter are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: VMwareVCenterOwnerUserService,
        ownerTeamService: VMwareVCenterOwnerTeamService,
        resourceIdColumn: "vmwareVCenterId",
        resourceId: vmwareVCenter.id,
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
        const owner: VMwareVCenterOwnerUser = new VMwareVCenterOwnerUser();
        owner.vmwareVCenterId = vmwareVCenter.id;
        owner.projectId = vmwareVCenter.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: VMwareVCenterOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }

      for (const teamId of teamIds) {
        const owner: VMwareVCenterOwnerTeam = new VMwareVCenterOwnerTeam();
        owner.vmwareVCenterId = vmwareVCenter.id;
        owner.projectId = vmwareVCenter.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: VMwareVCenterOwnerTeamService,
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
      `VMwareVCenterOwnerRuleEngine added owners to vCenter ${vmwareVCenter.id}`,
      { projectId: vmwareVCenter.projectId.toString() } as LogAttributes,
    );
    /*
     * The individual OwnerUserAdded / OwnerTeamAdded items say who was added;
     * this one says which rule is responsible, which is what somebody asking
     * "why am I on the hook for this?" actually needs.
     */
    await VMwareVCenterFeedService.createVMwareVCenterFeedItem({
      vmwareVCenterId: vmwareVCenter.id,
      projectId: vmwareVCenter.projectId,
      vmwareVCenterFeedEventType: VMwareVCenterFeedEventType.OwnerRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `👥 Owners were added to ${await VMwareVCenterService.getVMwareVCenterMarkdownLink(
        vmwareVCenter.projectId,
        vmwareVCenter.id,
      )} by ${matchedRules.length} owner ${matchedRules.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Owner rules that matched**: ${matchedRules
        .map((rule: VMwareVCenterOwnerRule) => {
          return `\`${rule.name || rule.id?.toString() || "Unnamed rule"}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesVMwareVCenterMatchRule(
    vmwareVCenter: VMwareVCenter,
    rule: VMwareVCenterOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "vmwareVCenterLabels",
        "vmwareVCenterNamePattern",
        "vmwareVCenterDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (
        vmwareVCenterRule: VMwareVCenterOwnerRule,
      ): boolean => {
        return this.doesVMwareVCenterMatchRuleLegacy(
          vmwareVCenter,
          vmwareVCenterRule,
        );
      },
    });
  }

  private doesVMwareVCenterMatchRuleLegacy(
    vmwareVCenter: VMwareVCenter,
    rule: VMwareVCenterOwnerRule,
  ): boolean {
    if (rule.vmwareVCenterLabels && rule.vmwareVCenterLabels.length > 0) {
      if (!vmwareVCenter.labels || vmwareVCenter.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.vmwareVCenterLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = vmwareVCenter.labels.map((l: Label) => {
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
      rule.vmwareVCenterNamePattern &&
      (!vmwareVCenter.name ||
        !this.testRegex(
          rule.vmwareVCenterNamePattern,
          vmwareVCenter.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.vmwareVCenterDescriptionPattern &&
      (!vmwareVCenter.description ||
        !this.testRegex(
          rule.vmwareVCenterDescriptionPattern,
          vmwareVCenter.description,
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
    rule: VMwareVCenterOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in vCenter owner rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new VMwareVCenterOwnerRuleEngineServiceClass();
