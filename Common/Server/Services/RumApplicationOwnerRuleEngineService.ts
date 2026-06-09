import Label from "../../Models/DatabaseModels/Label";
import RumApplication from "../../Models/DatabaseModels/RumApplication";
import RumApplicationOwnerRule from "../../Models/DatabaseModels/RumApplicationOwnerRule";
import RumApplicationOwnerUser from "../../Models/DatabaseModels/RumApplicationOwnerUser";
import RumApplicationOwnerTeam from "../../Models/DatabaseModels/RumApplicationOwnerTeam";
import RumApplicationOwnerRuleService from "./RumApplicationOwnerRuleService";
import RumApplicationOwnerUserService from "./RumApplicationOwnerUserService";
import RumApplicationOwnerTeamService from "./RumApplicationOwnerTeamService";
import RumApplicationService from "./RumApplicationService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class RumApplicationOwnerRuleEngineServiceClass {
  /**
   * Evaluates RumApplicationOwnerRule rows for the given application and adds
   * matched owner users / teams. Rules with notifyOwners set notify the added
   * owners; rules with notifyOwners off add silently.
   */
  @CaptureSpan()
  public async applyRulesToRumApplication(
    rumApplication: RumApplication,
  ): Promise<void> {
    if (!rumApplication.id || !rumApplication.projectId) {
      return;
    }

    try {
      const rules: Array<RumApplicationOwnerRule> =
        await RumApplicationOwnerRuleService.findBy({
          query: {
            projectId: rumApplication.projectId,
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

      const appWithDetails: RumApplication | null =
        await RumApplicationService.findOneById({
          id: rumApplication.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!appWithDetails) {
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
        if (!this.doesMatchRule(appWithDetails, rule)) {
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
          const owner: RumApplicationOwnerUser = new RumApplicationOwnerUser();
          owner.rumApplicationId = rumApplication.id;
          owner.projectId = rumApplication.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await RumApplicationOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
        }

        for (const teamId of teamIds) {
          const owner: RumApplicationOwnerTeam = new RumApplicationOwnerTeam();
          owner.rumApplicationId = rumApplication.id;
          owner.projectId = rumApplication.projectId;
          owner.teamId = new ObjectID(teamId);
          owner.isOwnerNotified = !notify;
          await RumApplicationOwnerTeamService.create({
            data: owner,
            props: { isRoot: true },
          });
        }
      }
    } catch (error) {
      logger.error(`Error applying RUM application owner rules: ${error}`, {
        projectId: rumApplication.projectId?.toString(),
        rumApplicationId: rumApplication.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesMatchRule(
    rumApplication: RumApplication,
    rule: RumApplicationOwnerRule,
  ): boolean {
    if (rule.matchLabels && rule.matchLabels.length > 0) {
      if (!rumApplication.labels || rumApplication.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.matchLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = rumApplication.labels.map((l: Label) => {
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
      rule.nameRegexPattern &&
      (!rumApplication.name ||
        !this.testRegex(rule.nameRegexPattern, rumApplication.name))
    ) {
      return false;
    }

    if (
      rule.descriptionRegexPattern &&
      (!rumApplication.description ||
        !this.testRegex(rule.descriptionRegexPattern, rumApplication.description))
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
      logger.warn(`Invalid regex in RUM application owner rule: ${pattern}`);
      return false;
    }
  }
}

export default new RumApplicationOwnerRuleEngineServiceClass();
