import Project from "Common/Models/DatabaseModels/Project";
import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import ProjectService from "Common/Server/Services/ProjectService";

export default class RenameRuleTypeInUserNotificationRule extends DataMigrationBase {
  public constructor() {
    super("RenameRuleTypeInUserNotificationRule");
  }

  public override async migrate(): Promise<void> {
    // get all projects.
    // for each project get all UserNotifiacationRules with ruleType ""When incident is created during on call"
    // update ruleType to "When on-call policy is executed"
    // update UserNotificationRule

    const projects: Array<Project> = await ProjectService.findBy({
      query: {},
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      const userNotificationRules: Array<UserNotificationRule> =
        await UserNotificationRuleService.findBy({
          query: {
            projectId: project._id,
            ruleType: "When incident is created during on call" as any,
          },
          select: {
            _id: true,
          },
          skip: 0,
          limit: LIMIT_MAX,
          props: {
            isRoot: true,
          },
        });

      for (const userNotificationRule of userNotificationRules) {
        await UserNotificationRuleService.updateOneById({
          id: userNotificationRule.id!,
          data: {
            ruleType: "When on-call policy is executed" as any,
          },
          props: {
            isRoot: true,
          },
        });
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
