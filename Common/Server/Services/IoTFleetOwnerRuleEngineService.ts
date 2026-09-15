import Label from "../../Models/DatabaseModels/Label";
import IoTFleet from "../../Models/DatabaseModels/IoTFleet";
import IoTFleetOwnerRule from "../../Models/DatabaseModels/IoTFleetOwnerRule";
import IoTFleetOwnerUser from "../../Models/DatabaseModels/IoTFleetOwnerUser";
import IoTFleetOwnerTeam from "../../Models/DatabaseModels/IoTFleetOwnerTeam";
import IoTFleetOwnerRuleService from "./IoTFleetOwnerRuleService";
import IoTFleetOwnerUserService from "./IoTFleetOwnerUserService";
import IoTFleetOwnerTeamService from "./IoTFleetOwnerTeamService";
import IoTFleetService from "./IoTFleetService";
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

class IoTFleetOwnerRuleEngineServiceClass
  implements RuleRunEngine<IoTFleet, IoTFleetOwnerRule>
{
  public readonly ruleSelect: Select<IoTFleetOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    iotFleetLabels: { _id: true },
    iotFleetNamePattern: true,
    iotFleetDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the IoT fleet, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<IoTFleet> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates IoTFleetOwnerRule rows for the given IoT fleet and adds matched
   * owner users / teams via IoTFleetOwnerUserService / IoTFleetOwnerTeamService. Rules
   * with notifyOwners set notify the added owners; rules with notifyOwners off
   * add silently.
   */
  @CaptureSpan()
  public async applyRulesToIoTFleet(iotFleet: IoTFleet): Promise<void> {
    if (!iotFleet.id || !iotFleet.projectId) {
      return;
    }

    try {
      const rules: Array<IoTFleetOwnerRule> =
        await IoTFleetOwnerRuleService.findBy({
          query: {
            projectId: iotFleet.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "IoTFleetOwnerRule",
        projectId: iotFleet.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        iotFleet: iotFleet,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying IoT fleet owner rules: ${error}`, {
        projectId: iotFleet.projectId?.toString(),
        iotFleetId: iotFleet.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for an IoT fleet that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<IoTFleet, IoTFleetOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        iotFleet: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running IoT fleet owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        iotFleetId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    iotFleet: IoTFleet;
    rules: Array<IoTFleetOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { iotFleet, rules } = data;

    if (!iotFleet.id || !iotFleet.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const iotFleetWithDetails: IoTFleet | null =
      await IoTFleetService.findOneById({
        id: iotFleet.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!iotFleetWithDetails) {
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

    const matchedRules: Array<IoTFleetOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesIoTFleetMatchRule(
        iotFleetWithDetails,
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

    // Owners already on the IoT fleet are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: IoTFleetOwnerUserService,
        ownerTeamService: IoTFleetOwnerTeamService,
        resourceIdColumn: "iotFleetId",
        resourceId: iotFleet.id,
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
        const owner: IoTFleetOwnerUser = new IoTFleetOwnerUser();
        owner.iotFleetId = iotFleet.id;
        owner.projectId = iotFleet.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        await IoTFleetOwnerUserService.create({
          data: owner,
          props: { isRoot: true },
        });
        ownersAdded++;
      }

      for (const teamId of teamIds) {
        const owner: IoTFleetOwnerTeam = new IoTFleetOwnerTeam();
        owner.iotFleetId = iotFleet.id;
        owner.projectId = iotFleet.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        await IoTFleetOwnerTeamService.create({
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
      `IoTFleetOwnerRuleEngine added owners to IoT fleet ${iotFleet.id}`,
      { projectId: iotFleet.projectId.toString() } as LogAttributes,
    );

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesIoTFleetMatchRule(
    iotFleet: IoTFleet,
    rule: IoTFleetOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "iotFleetLabels",
        "iotFleetNamePattern",
        "iotFleetDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: IoTFleetOwnerRule): boolean => {
        return this.doesIoTFleetMatchLegacyRule(iotFleet, legacyRule);
      },
    });
  }

  private doesIoTFleetMatchLegacyRule(
    iotFleet: IoTFleet,
    rule: IoTFleetOwnerRule,
  ): boolean {
    if (rule.iotFleetLabels && rule.iotFleetLabels.length > 0) {
      if (!iotFleet.labels || iotFleet.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.iotFleetLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = iotFleet.labels.map((l: Label) => {
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
      rule.iotFleetNamePattern &&
      (!iotFleet.name ||
        !this.testRegex(rule.iotFleetNamePattern, iotFleet.name, rule))
    ) {
      return false;
    }

    if (
      rule.iotFleetDescriptionPattern &&
      (!iotFleet.description ||
        !this.testRegex(
          rule.iotFleetDescriptionPattern,
          iotFleet.description,
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
    rule: IoTFleetOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in IoT fleet owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new IoTFleetOwnerRuleEngineServiceClass();
