import RunCron from "../../Utils/Cron";
import { EVERY_FIFTEEN_MINUTE, EVERY_MINUTE } from "Common/Utils/CronTime";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import Project from "Common/Models/DatabaseModels/Project";

/*
 * Keep the existing name so previously registered repeatable jobs still have a
 * handler. Reconcile every subscribed project: a missed membership-triggered
 * update can leave an older, non-null count, while a failed provider call leaves
 * an unknown count. Matching counts do not call the payment provider again.
 */
RunCron(
  "PaymentProvider:UpdateTeamMembersIfNull",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_FIFTEEN_MINUTE,
    runOnStartup: false,
  },
  async () => {
    if (!IsBillingEnabled) {
      return;
    }

    const projects: Array<Project> = await ProjectService.findAllBy({
      query: {
        paymentProviderSubscriptionId: QueryHelper.notNull(),
        paymentProviderPlanId: QueryHelper.notNull(),
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      try {
        await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
          project.id!,
        );
      } catch (err) {
        logger.error(
          "Could not reconcile subscription seats. The next scheduled sweep will retry this project.",
          { projectId: project.id?.toString() },
        );
        logger.error(err, { projectId: project.id?.toString() });
      }
    }
  },
);
