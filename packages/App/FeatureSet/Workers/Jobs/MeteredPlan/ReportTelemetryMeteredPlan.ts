import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import RunCron from "../../Utils/Cron";
import Sleep from "Common/Types/Sleep";
import { EVERY_DAY, EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import ProjectService from "Common/Server/Services/ProjectService";
import {
  ActiveMonitoringMeteredPlan,
  LogDataIngestMeteredPlan,
  MetricsDataIngestMeteredPlan,
  TracesDataIngestMetredPlan,
  ProfilesDataIngestMeteredPlan,
  SessionReplayDataIngestMeteredPlan,
  SecurityEventsDataIngestMeteredPlan,
} from "Common/Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import ServerMeteredPlan from "Common/Server/Types/Billing/MeteredPlan/ServerMeteredPlan";
import logger from "Common/Server/Utils/Logger";
import Project from "Common/Models/DatabaseModels/Project";

/*
 * Each plan is reported on its own. They used to share one try/catch per
 * project, so the first one to fail - a Stripe error, a usage scan over its
 * time cap - skipped every plan after it, and with staging targeting only
 * yesterday, that day of those products was never billed.
 */
const METERED_PLANS_IN_REPORT_ORDER: Array<ServerMeteredPlan> = [
  LogDataIngestMeteredPlan,
  MetricsDataIngestMeteredPlan,
  TracesDataIngestMetredPlan,
  ActiveMonitoringMeteredPlan,
  ProfilesDataIngestMeteredPlan,
  SessionReplayDataIngestMeteredPlan,
  SecurityEventsDataIngestMeteredPlan,
];

RunCron(
  "MeteredPlan:ReportTelemetryMeteredPlan",
  {
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_DAY,
    runOnStartup: false,
  },
  async () => {
    if (!IsBillingEnabled) {
      logger.debug(
        "MeteredPlan:ReportTelemetryMeteredPlan Billing is not enabled. Skipping job.",
      );
      return;
    }

    const projects: Array<Project> = await ProjectService.findAllBy({
      query: {},
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      if (!project.id) {
        continue;
      }

      let plan: {
        plan: PlanType | null;
        isSubscriptionUnpaid: boolean;
      };

      try {
        plan = await ProjectService.getCurrentPlan(project.id);
      } catch (error) {
        logger.error(
          `MeteredPlan:ReportTelemetryMeteredPlan Error while reading the plan of project ${project.id}: ${error}`,
        );
        continue;
      }

      if (plan.isSubscriptionUnpaid) {
        // ignore and report when subscription is active.
        continue;
      }

      for (const meteredPlan of METERED_PLANS_IN_REPORT_ORDER) {
        try {
          await meteredPlan.reportQuantityToBillingProvider(project.id, {});
        } catch (error) {
          logger.error(
            `MeteredPlan:ReportTelemetryMeteredPlan Error while reporting ${meteredPlan.getProductType()} for project ${project.id}: ${error}`,
          );
        }

        await Sleep.sleep(1000);
      }
    }
  },
);
