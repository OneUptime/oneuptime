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

          await ProfilesDataIngestMeteredPlan.reportQuantityToBillingProvider(
            project.id,
          );

          await Sleep.sleep(1000);

          /*
           * Session replay is reported in its own try/catch, and last.
           *
           * Its Stripe price ids do not exist yet, so
           * getMeteredPlanPriceId throws for it. Everything else in this loop
           * shares one try/catch per project, so letting that throw escape
           * would abort the remaining pillars for the project and log a fresh
           * error every run. Usage still accrues in TelemetryUsageBilling and
           * will be reported once the price ids are set - only this final push
           * is unavailable.
           */
          try {
            await SessionReplayDataIngestMeteredPlan.reportQuantityToBillingProvider(
              project.id,
            );
          } catch (sessionReplayError) {
            logger.debug(
              `MeteredPlan:ReportTelemetryMeteredPlan Skipping session replay for project ${project.id}: ${sessionReplayError}`,
            );
          }

          /*
           * Security events: same deal as session replay — usage stages
           * into TelemetryUsageBilling regardless, and the final push to
           * the billing provider is skipped until its Stripe price ids
           * exist (getMeteredPlanPriceId throws until then).
           */
          try {
            await SecurityEventsDataIngestMeteredPlan.reportQuantityToBillingProvider(
              project.id,
            );
          } catch (securityEventsError) {
            logger.debug(
              `MeteredPlan:ReportTelemetryMeteredPlan Skipping security events for project ${project.id}: ${securityEventsError}`,
            );
          }

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
