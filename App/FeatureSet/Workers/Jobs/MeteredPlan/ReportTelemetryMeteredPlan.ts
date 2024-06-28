import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Sleep from "Common/Types/Sleep";
import { EVERY_DAY, EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "CommonServer/EnvironmentConfig";
import ProjectService from "CommonServer/Services/ProjectService";
import {
  ActiveMonitoringMeteredPlan,
  LogDataIngestMeteredPlan,
  MetricsDataIngestMeteredPlan,
  TracesDataIngestMetredPlan,
} from "CommonServer/Types/Billing/MeteredPlan/AllMeteredPlans";
import logger from "CommonServer/Utils/Logger";
import Project from "Model/Models/Project";

RunCron(
  "MeteredPlan:ReportTelemetryMeteredPlan",
  {
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_DAY,
    runOnStartup: true,
  },
  async () => {
    if (!IsBillingEnabled) {
      logger.debug(
        "MeteredPlan:ReportTelemetryMeteredPlan Billing is not enabled. Skipping job.",
      );
      return;
    }

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
      try {
        if (project.id) {
          const plan: {
            plan: PlanType | null;
            isSubscriptionUnpaid: boolean;
          } = await ProjectService.getCurrentPlan(project.id);

          if (plan.isSubscriptionUnpaid) {
            // ignore and report when subscription is active.
            continue;
          }

          await LogDataIngestMeteredPlan.reportQuantityToBillingProvider(
            project.id,
          );

          await Sleep.sleep(1000);

          await MetricsDataIngestMeteredPlan.reportQuantityToBillingProvider(
            project.id,
          );

          await Sleep.sleep(1000);

          await TracesDataIngestMetredPlan.reportQuantityToBillingProvider(
            project.id,
          );

          await Sleep.sleep(1000);

          await ActiveMonitoringMeteredPlan.reportQuantityToBillingProvider(
            project.id!,
          );

          await Sleep.sleep(1000);
        }
      } catch (error) {
        logger.error(
          `MeteredPlan:ReportTelemetryMeteredPlan Error while reporting telemetry for project ${project.id}: ${error}`,
        );
      }
    }
  },
);
