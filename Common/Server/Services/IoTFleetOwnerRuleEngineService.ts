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
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class IoTFleetOwnerRuleEngineServiceClass {
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
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            iotFleetLabels: { _id: true },
            iotFleetNamePattern: true,
            iotFleetDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
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

      const matchedRules: Array<IoTFleetOwnerRule> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesIoTFleetMatchRule(
          iotFleetWithDetails,
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
          const owner: IoTFleetOwnerUser = new IoTFleetOwnerUser();
          owner.iotFleetId = iotFleet.id;
          owner.projectId = iotFleet.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await IoTFleetOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
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
        }
      }

      logger.debug(
        `IoTFleetOwnerRuleEngine added owners to IoT fleet ${iotFleet.id}`,
        { projectId: iotFleet.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying IoT fleet owner rules: ${error}`, {
        projectId: iotFleet.projectId?.toString(),
        iotFleetId: iotFleet.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesIoTFleetMatchRule(
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
