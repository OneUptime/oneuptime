import Label from "../../Models/DatabaseModels/Label";
import CloudResource from "../../Models/DatabaseModels/CloudResource";
import CloudResourceOwnerRule from "../../Models/DatabaseModels/CloudResourceOwnerRule";
import CloudResourceOwnerUser from "../../Models/DatabaseModels/CloudResourceOwnerUser";
import CloudResourceOwnerTeam from "../../Models/DatabaseModels/CloudResourceOwnerTeam";
import CloudResourceOwnerRuleService from "./CloudResourceOwnerRuleService";
import CloudResourceOwnerUserService from "./CloudResourceOwnerUserService";
import CloudResourceOwnerTeamService from "./CloudResourceOwnerTeamService";
import CloudResourceService from "./CloudResourceService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class CloudResourceOwnerRuleEngineServiceClass {
  /**
   * Evaluates CloudResourceOwnerRule rows for the given resource and adds
   * matched owner users / teams. Rules with notifyOwners set notify the added
   * owners; rules with notifyOwners off add silently.
   */
  @CaptureSpan()
  public async applyRulesToCloudResource(
    cloudResource: CloudResource,
  ): Promise<void> {
    if (!cloudResource.id || !cloudResource.projectId) {
      return;
    }

    try {
      const rules: Array<CloudResourceOwnerRule> =
        await CloudResourceOwnerRuleService.findBy({
          query: {
            projectId: cloudResource.projectId,
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

      const resourceWithDetails: CloudResource | null =
        await CloudResourceService.findOneById({
          id: cloudResource.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!resourceWithDetails) {
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
        if (!this.doesMatchRule(resourceWithDetails, rule)) {
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
          const owner: CloudResourceOwnerUser = new CloudResourceOwnerUser();
          owner.cloudResourceId = cloudResource.id;
          owner.projectId = cloudResource.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await CloudResourceOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
        }

        for (const teamId of teamIds) {
          const owner: CloudResourceOwnerTeam = new CloudResourceOwnerTeam();
          owner.cloudResourceId = cloudResource.id;
          owner.projectId = cloudResource.projectId;
          owner.teamId = new ObjectID(teamId);
          owner.isOwnerNotified = !notify;
          await CloudResourceOwnerTeamService.create({
            data: owner,
            props: { isRoot: true },
          });
        }
      }
    } catch (error) {
      logger.error(`Error applying cloud resource owner rules: ${error}`, {
        projectId: cloudResource.projectId?.toString(),
        cloudResourceId: cloudResource.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesMatchRule(
    cloudResource: CloudResource,
    rule: CloudResourceOwnerRule,
  ): boolean {
    if (rule.matchLabels && rule.matchLabels.length > 0) {
      if (!cloudResource.labels || cloudResource.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.matchLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = cloudResource.labels.map((l: Label) => {
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
      (!cloudResource.name ||
        !this.testRegex(rule.nameRegexPattern, cloudResource.name))
    ) {
      return false;
    }

    if (
      rule.descriptionRegexPattern &&
      (!cloudResource.description ||
        !this.testRegex(rule.descriptionRegexPattern, cloudResource.description))
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
      logger.warn(`Invalid regex in cloud resource owner rule: ${pattern}`);
      return false;
    }
  }
}

export default new CloudResourceOwnerRuleEngineServiceClass();
