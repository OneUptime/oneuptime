import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import RunCron from "../../Utils/Cron";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
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

// Setting up a cron job to report telemetry data for metered plans.
RunCron(
  "MeteredPlan:ReportTelemetryMeteredPlan",
  {
    // Schedule the cron job based on the environment (development or production).
    schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_DAY,
    runOnStartup: true,
  },
  async () => {
    // Check if billing is enabled; if not, skip the job.
    if (!IsBillingEnabled) {
      logger.debug(
        "MeteredPlan:ReportTelemetryMeteredPlan Billing is not enabled. Skipping job.",
      );
      return;
    }

    // Fetch all projects with no specific query and a maximum limit.
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
          // Get the current plan for the project.
          const plan: {
            plan: PlanType | null;
            isSubscriptionUnpaid: boolean;
          } = await ProjectService.getCurrentPlan(project.id);

          // If the subscription is unpaid, skip reporting.
          if (plan.isSubscriptionUnpaid) {
            continue;
          }

          // Report log data ingest quantity.
          await LogDataIngestMeteredPlan.reportQuantityToBillingProvider(
            project.id,
          );

          // Sleep for 1 second to avoid overloading the billing provider.
          await Sleep.sleep(1000);

          // Report metrics data ingest quantity.
          await MetricsDataIngestMeteredPlan.reportQuantityToBillingProvider(
            project.id,
          );

          // Sleep for 1 second to avoid overloading the billing provider.
          await Sleep.sleep(1000);

          // Report traces data ingest quantity.
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
