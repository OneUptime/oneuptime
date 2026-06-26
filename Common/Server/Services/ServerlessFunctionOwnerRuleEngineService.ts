import Label from "../../Models/DatabaseModels/Label";
import ServerlessFunction from "../../Models/DatabaseModels/ServerlessFunction";
import ServerlessFunctionOwnerRule from "../../Models/DatabaseModels/ServerlessFunctionOwnerRule";
import ServerlessFunctionOwnerUser from "../../Models/DatabaseModels/ServerlessFunctionOwnerUser";
import ServerlessFunctionOwnerTeam from "../../Models/DatabaseModels/ServerlessFunctionOwnerTeam";
import ServerlessFunctionOwnerRuleService from "./ServerlessFunctionOwnerRuleService";
import ServerlessFunctionOwnerUserService from "./ServerlessFunctionOwnerUserService";
import ServerlessFunctionOwnerTeamService from "./ServerlessFunctionOwnerTeamService";
import ServerlessFunctionService from "./ServerlessFunctionService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class ServerlessFunctionOwnerRuleEngineServiceClass {
  /**
   * Evaluates ServerlessFunctionOwnerRule rows for the given function and adds
   * matched owner users / teams. Rules with notifyOwners set notify the added
   * owners; rules with notifyOwners off add silently.
   */
  @CaptureSpan()
  public async applyRulesToServerlessFunction(
    serverlessFunction: ServerlessFunction,
  ): Promise<void> {
    if (!serverlessFunction.id || !serverlessFunction.projectId) {
      return;
    }

    try {
      const rules: Array<ServerlessFunctionOwnerRule> =
        await ServerlessFunctionOwnerRuleService.findBy({
          query: {
            projectId: serverlessFunction.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            matchLabels: { _id: true },
            nameRegexPattern: true,
            descriptionRegexPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const fnWithDetails: ServerlessFunction | null =
        await ServerlessFunctionService.findOneById({
          id: serverlessFunction.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!fnWithDetails) {
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

      let anyMatched: boolean = false;

      for (const rule of rules) {
        if (!this.doesMatchRule(fnWithDetails, rule)) {
          continue;
        }
        const notify: boolean = rule.notifyOwners !== false;
        for (const user of rule.ownerUsers || []) {
          if (user.id) {
            usersByNotify.get(notify)!.add(user.id.toString());
            anyMatched = true;
          }
        }
        for (const team of rule.ownerTeams || []) {
          if (team.id) {
            teamsByNotify.get(notify)!.add(team.id.toString());
            anyMatched = true;
          }
        }
      }

      if (!anyMatched) {
        return;
      }

      for (const notify of [true, false]) {
        const userIds: Set<string> = usersByNotify.get(notify)!;
        const teamIds: Set<string> = teamsByNotify.get(notify)!;

        for (const userId of userIds) {
          const owner: ServerlessFunctionOwnerUser =
            new ServerlessFunctionOwnerUser();
          owner.serverlessFunctionId = serverlessFunction.id;
          owner.projectId = serverlessFunction.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await ServerlessFunctionOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
        }

        for (const teamId of teamIds) {
          const owner: ServerlessFunctionOwnerTeam =
            new ServerlessFunctionOwnerTeam();
          owner.serverlessFunctionId = serverlessFunction.id;
          owner.projectId = serverlessFunction.projectId;
          owner.teamId = new ObjectID(teamId);
          owner.isOwnerNotified = !notify;
          await ServerlessFunctionOwnerTeamService.create({
            data: owner,
            props: { isRoot: true },
          });
        }
      }
    } catch (error) {
      logger.error(`Error applying serverless function owner rules: ${error}`, {
        projectId: serverlessFunction.projectId?.toString(),
        serverlessFunctionId: serverlessFunction.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesMatchRule(
    serverlessFunction: ServerlessFunction,
    rule: ServerlessFunctionOwnerRule,
  ): boolean {
    if (rule.matchLabels && rule.matchLabels.length > 0) {
      if (
        !serverlessFunction.labels ||
        serverlessFunction.labels.length === 0
      ) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.matchLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = serverlessFunction.labels.map(
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
      rule.nameRegexPattern &&
      (!serverlessFunction.name ||
        !this.testRegex(rule.nameRegexPattern, serverlessFunction.name))
    ) {
      return false;
    }

    if (
      rule.descriptionRegexPattern &&
      (!serverlessFunction.description ||
        !this.testRegex(
          rule.descriptionRegexPattern,
          serverlessFunction.description,
        ))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(pattern: string, value: string): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in serverless function owner rule: ${pattern}`,
      );
      return false;
    }
  }
}

export default new ServerlessFunctionOwnerRuleEngineServiceClass();
