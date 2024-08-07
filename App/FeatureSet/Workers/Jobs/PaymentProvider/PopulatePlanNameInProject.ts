import RunCron from "../../Utils/Cron";
import SubscriptionPlan, {
  PlanType,
} from "Common/Types/Billing/SubscriptionPlan";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { EVERY_WEEK } from "Common/Utils/CronTime";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import ProjectService from "Common/Server/Services/ProjectService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import Project from "Common/Models/DatabaseModels/Project";

RunCron(
  "PaymentProvider:PopulatePlanNameInProject",
  { schedule: EVERY_WEEK, runOnStartup: true },
  async () => {
    // get all projects.
    if (!IsBillingEnabled) {
      return;
    }

    const projects: Array<Project> = await ProjectService.findBy({
      query: {
        planName: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        paymentProviderPlanId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    for (const project of projects) {
      try {
        if (project.paymentProviderPlanId) {
          // get subscription detail.
          const planName: PlanType = SubscriptionPlan.getPlanType(
            project.paymentProviderPlanId as string,
          );

          await ProjectService.updateOneById({
            id: project.id!,
            data: {
              planName: planName,
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
        }
      } catch (err) {
        logger.error(err);
      }
    }
  },
);
