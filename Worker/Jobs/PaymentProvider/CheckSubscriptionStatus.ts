import RunCron from "../../Utils/Cron";
import SubscriptionStatus from "Common/Types/Billing/SubscriptionStatus";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Sleep from "Common/Types/Sleep";
import { EVERY_DAY, EVERY_MINUTE } from "Common/Utils/CronTime";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import BillingService from "Common/Server/Services/BillingService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import Project from "Common/Models/DatabaseModels/Project";

RunCron(
  "PaymentProvider:CheckSubscriptionStatus",
  { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_DAY, runOnStartup: true },
  async () => {
    // get all projects.
    if (!IsBillingEnabled) {
      return;
    }

    const projects: Array<Project> = await ProjectService.findBy({
      query: {},
      select: {
        _id: true,
        paymentProviderSubscriptionId: true,
        paymentProviderMeteredSubscriptionId: true,
        paymentProviderCustomerId: true,
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
        if (project.paymentProviderSubscriptionId) {
          // get subscription detail.
          const subscriptionState: SubscriptionStatus =
            await BillingService.getSubscriptionStatus(
              project.paymentProviderSubscriptionId as string,
            );

          await ProjectService.updateOneById({
            id: project.id!,
            data: {
              paymentProviderSubscriptionStatus: subscriptionState,
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });

          // after every subscription fetch, sleep for a 5 seconds to avoid stripe rate limit.
          await Sleep.sleep(1000);
        }

        if (project.paymentProviderMeteredSubscriptionId) {
          // get subscription detail.
          const subscriptionState: SubscriptionStatus =
            await BillingService.getSubscriptionStatus(
              project.paymentProviderMeteredSubscriptionId as string,
            );

          await ProjectService.updateOneById({
            id: project.id!,
            data: {
              paymentProviderMeteredSubscriptionStatus: subscriptionState,
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });

          // after every subscription fetch, sleep for a 5 seconds to avoid stripe rate limit.
          await Sleep.sleep(1000);
        }
      } catch (err) {
        logger.error(err);
      }
    }
  },
);
