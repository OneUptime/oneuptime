import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { EVERY_DAY, EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "CommonServer/EnvironmentConfig";
import ProjectService from "CommonServer/Services/ProjectService";
import TeamMemberService from "CommonServer/Services/TeamMemberService";
import QueryHelper from "CommonServer/Types/Database/QueryHelper";
import Project from "Common/Models/DatabaseModels/Project";

RunCron(
  "PaymentProvider:UpdateTeamMembersIfNull",
  { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_DAY, runOnStartup: true },
  async () => {
    const projects: Array<Project> = await ProjectService.findBy({
      query: {
        paymentProviderSubscriptionSeats: QueryHelper.isNull(),
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });

    for (const project of projects) {
      await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        project.id!,
      );
    }
  },
);
