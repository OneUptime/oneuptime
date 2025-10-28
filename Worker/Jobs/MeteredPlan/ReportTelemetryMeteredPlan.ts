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
} from "Common/Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import logger from "Common/Server/Utils/Logger";
import Project from "Common/Models/DatabaseModels/Project";

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
