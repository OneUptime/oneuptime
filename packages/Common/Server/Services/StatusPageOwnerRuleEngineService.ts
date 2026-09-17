import Label from "../../Models/DatabaseModels/Label";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageOwnerRule from "../../Models/DatabaseModels/StatusPageOwnerRule";
import StatusPageOwnerRuleService from "./StatusPageOwnerRuleService";
import StatusPageOwnerTeamService from "./StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "./StatusPageOwnerUserService";
import StatusPageService from "./StatusPageService";
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

class StatusPageOwnerRuleEngineServiceClass
  implements RuleRunEngine<StatusPage, StatusPageOwnerRule>
{
  public readonly ruleSelect: Select<StatusPageOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    statusPageLabels: { _id: true },
    statusPageNamePattern: true,
    statusPageDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the status page, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<StatusPage> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates StatusPageOwnerRule rows for the given status page and adds
   * matched owner users / teams via StatusPageService.addOwners. Rules with
   * notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToStatusPage(statusPage: StatusPage): Promise<void> {
    if (!statusPage.id || !statusPage.projectId) {
      return;
    }

    try {
      const rules: Array<StatusPageOwnerRule> =
        await StatusPageOwnerRuleService.findBy({
          query: {
            projectId: statusPage.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "StatusPageOwnerRule",
        projectId: statusPage.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        statusPage: statusPage,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying status page owner rules: ${error}`, {
        projectId: statusPage.projectId?.toString(),
        statusPageId: statusPage.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a status page that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<StatusPage, StatusPageOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        statusPage: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running status page owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        statusPageId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    statusPage: StatusPage;
    rules: Array<StatusPageOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { statusPage, rules } = data;

    if (!statusPage.id || !statusPage.projectId || rules.length === 0) {
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

    const matchedRules: Array<StatusPageOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();

    const statusPageWithDetails: StatusPage | null =
      await StatusPageService.findOneById({
        id: statusPage.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!statusPageWithDetails) {
      return RuleApplicationResultUtil.noMatch();
    }

    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesStatusPageMatchRule(
        statusPageWithDetails,
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

    // Owners already on the status page are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: StatusPageOwnerUserService,
        ownerTeamService: StatusPageOwnerTeamService,
        resourceIdColumn: "statusPageId",
        resourceId: statusPage.id,
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

      if (userIds.length === 0 && teamIds.length === 0) {
        continue;
      }

      await StatusPageService.addOwners(
        statusPage.projectId,
        statusPage.id,
        userIds.map((id: string) => {
          return new ObjectID(id);
        }),
        teamIds.map((id: string) => {
          return new ObjectID(id);
        }),
        notify,
        { isRoot: true },
      );

      ownersAdded += userIds.length + teamIds.length;
    }

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    logger.debug(
      `StatusPageOwnerRuleEngine added owners to status page ${statusPage.id}`,
      { projectId: statusPage.projectId.toString() } as LogAttributes,
    );

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesStatusPageMatchRule(
    statusPage: StatusPage,
    rule: StatusPageOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "statusPageLabels",
        "statusPageNamePattern",
        "statusPageDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (statusPageRule: StatusPageOwnerRule): boolean => {
        return this.doesStatusPageMatchRuleLegacy(statusPage, statusPageRule);
      },
    });
  }

  private doesStatusPageMatchRuleLegacy(
    statusPage: StatusPage,
    rule: StatusPageOwnerRule,
  ): boolean {
    if (rule.statusPageLabels && rule.statusPageLabels.length > 0) {
      if (!statusPage.labels || statusPage.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.statusPageLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const statusPageLabelIds: Array<string> = statusPage.labels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      if (
        !ruleLabelIds.some((id: string) => {
          return statusPageLabelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.statusPageNamePattern &&
      (!statusPage.name ||
        !this.testRegex(rule.statusPageNamePattern, statusPage.name, rule))
    ) {
      return false;
    }

    if (
      rule.statusPageDescriptionPattern &&
      (!statusPage.description ||
        !this.testRegex(
          rule.statusPageDescriptionPattern,
          statusPage.description,
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
    rule: StatusPageOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in status page owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new StatusPageOwnerRuleEngineServiceClass();
