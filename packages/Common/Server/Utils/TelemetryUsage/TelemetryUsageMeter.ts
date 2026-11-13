import Project from "../../../Models/DatabaseModels/Project";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import { TELEMETRY_USAGE_PRODUCT_TYPES } from "../../../Types/Telemetry/TelemetryUsage";
import { IsBillingEnabled } from "../../EnvironmentConfig";
import ProjectService from "../../Services/ProjectService";
import TelemetryUsageBillingService from "../../Services/TelemetryUsageBillingService";
import logger from "../Logger";

/*
 * Metering where billing is off: every project's telemetry usage, one project
 * at a time, each signal of it on its own - the TelemetryUsage:
 * MeterTelemetryUsage worker job, daily.
 *
 * Each project and signal stages the days of the last week it has telemetry
 * for and no usage yet (TelemetryUsageBillingService
 * .meterUnstagedTelemetryUsageForProject): a project with no telemetry costs
 * one cheap day query per signal, a day already staged costs nothing in
 * ClickHouse, and each day it does stage is one capped usage scan per table
 * of it - the scan OneUptime Cloud runs for billing. So the work of a run is
 * the days that ended since the last one.
 *
 * Bounded twice: every scan keeps the analytics service's time cap, and the
 * run stops starting new work at its deadline (or once it loses its lock),
 * leaving the rest to the next run - which finds the days it did stage
 * staged, and moves straight on. A signal or project that fails is logged
 * and retried by the next run while its days are in the week; it stops none
 * of the others.
 *
 * Nothing where billing is on: billing stages usage itself.
 */

export type TelemetryUsageMeterStopReason =
  | "done"
  | "deadline"
  | "lost-lock"
  | "billing-enabled";

export interface TelemetryUsageMeterSummary {
  stopReason: TelemetryUsageMeterStopReason;
  projectsMetered: number;
  // Project and signal pairs that failed this run; each is retried next run.
  failures: number;
}

export default class TelemetryUsageMeter {
  public static async meterAllProjects(options: {
    deadline: Date;
    // False once the run should stop - its lock was lost.
    shouldContinue: () => boolean;
  }): Promise<TelemetryUsageMeterSummary> {
    const summary: TelemetryUsageMeterSummary = {
      stopReason: "done",
      projectsMetered: 0,
      failures: 0,
    };

    if (IsBillingEnabled) {
      summary.stopReason = "billing-enabled";
      return summary;
    }

    /*
     * Oldest first, the same order every run: no project waits on its name.
     * Never a sample project (issue #6808): what it holds was written once
     * when it was made, and it is in nobody's usage.
     */
    const projects: Array<Project> = await ProjectService.findAllBy({
      query: {
        isSampleProject: false,
      },
      select: {
        _id: true,
      },
      sort: {
        createdAt: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });

    for (const project of projects) {
      if (!project.id) {
        continue;
      }

      for (const productType of TELEMETRY_USAGE_PRODUCT_TYPES) {
        const stopReason: TelemetryUsageMeterStopReason | null =
          TelemetryUsageMeter.getStopReason(options);

        if (stopReason) {
          summary.stopReason = stopReason;
          return summary;
        }

        try {
          await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject(
            {
              projectId: project.id,
              productType: productType as ProductType,
            },
          );
        } catch (err) {
          summary.failures++;
          logger.error(
            `TelemetryUsage: could not count the ${productType} usage of project ${project.id.toString()}; the next run tries again.`,
          );
          logger.error(err);
        }
      }

      summary.projectsMetered++;
    }

    return summary;
  }

  private static getStopReason(options: {
    deadline: Date;
    shouldContinue: () => boolean;
  }): TelemetryUsageMeterStopReason | null {
    if (!options.shouldContinue()) {
      return "lost-lock";
    }

    if (
      OneUptimeDate.getCurrentDate().getTime() >= options.deadline.getTime()
    ) {
      return "deadline";
    }

    return null;
  }
}
