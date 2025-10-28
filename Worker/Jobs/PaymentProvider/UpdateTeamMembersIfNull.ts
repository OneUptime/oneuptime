import RunCron from "../../Utils/Cron";
import { EVERY_DAY, EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Project from "Common/Models/DatabaseModels/Project";

RunCron(
  "PaymentProvider:UpdateTeamMembersIfNull",
  { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_DAY, runOnStartup: false },
  async () => {
    const projects: Array<Project> = await ProjectService.findAllBy({
      query: {
        paymentProviderSubscriptionSeats: QueryHelper.isNull(),
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        project.id!,
      );
    }
  },
);
