import CloudSavingsAction from "../../../Models/DatabaseModels/CloudSavingsAction";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  CLOUD_COST_DEFAULT_CURRENCY,
  getMostCommonCloudCurrency,
  roundCost,
  startOfUtcMonth,
} from "../../../Types/Cloud/CloudCost";
import {
  CloudSavingsActionOrigin,
  CloudSavingsActionStatus,
  CloudSavingsMeasurement,
} from "../../../Types/Cloud/CloudSavingsAction";
import { CloudSavingsSummary } from "../../../Types/Cloud/CloudSavingsApiTypes";
import {
  getCloudSavingsRealisedThisMonth,
  getCloudSavingsScheduledHoursThisMonth,
} from "../../../Types/Cloud/CloudSavingsMeasure";
import ObjectID from "../../../Types/ObjectID";
import CloudSavingsActionService from "../../Services/CloudSavingsActionService";
import CloudSavingsOwners, { CloudResourceOwners } from "./CloudSavingsOwners";

/*
 * THE SAVINGS PAGE'S STRIP (#11010): what the changes saved this month as
 * the bill shows it - realised, never estimated - what is still being read
 * against the bill, the hours schedules stopped resources for, and what
 * waits for an approval, and for the reader's.
 */

// The rows read for one summary, at most.
const MAX_READ: number = 2000;

// The proposals whose approvers are worked out for "waiting for you", at most.
const MAX_WAITING_JUDGED: number = 200;

export default class CloudSavingsSummaryReader {
  public static async read(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    now: Date;
  }): Promise<CloudSavingsSummary> {
    const monthStart: Date = startOfUtcMonth(data.now);
    const inEffect: Array<CloudSavingsAction> =
      await CloudSavingsActionService.findBy({
        query: {
          projectId: data.projectId,
          measurement: new Includes([
            CloudSavingsMeasurement.Realised,
            CloudSavingsMeasurement.Measuring,
          ]),
          status: new Includes([
            CloudSavingsActionStatus.Applied,
            CloudSavingsActionStatus.AppliedWithoutAsking,
            CloudSavingsActionStatus.Undone,
          ]),
        },
        select: {
          measurement: true,
          status: true,
          monthlySavings: true,
          realisedMonthlySavings: true,
          currency: true,
          appliedAt: true,
          undoneAt: true,
        },
        skip: 0,
        limit: MAX_READ,
        props: { isRoot: true },
      });
    const byCurrency: Map<string, number> = new Map();

    for (const action of inEffect) {
      const currency: string = (
        action.currency || CLOUD_COST_DEFAULT_CURRENCY
      ).toUpperCase();
      byCurrency.set(currency, (byCurrency.get(currency) || 0) + 1);
    }

    const currency: string = getMostCommonCloudCurrency(byCurrency);
    const summary: CloudSavingsSummary = {
      currency,
      savedThisMonth: 0,
      realisedCount: 0,
      measuringCount: 0,
      promisedMonthly: 0,
      scheduledHoursThisMonth: 0,
      waitingCount: 0,
      waitingForYouCount: 0,
    };

    for (const action of inEffect) {
      if (
        (action.currency || CLOUD_COST_DEFAULT_CURRENCY).toUpperCase() !==
          currency ||
        !action.appliedAt
      ) {
        continue;
      }

      if (action.measurement === CloudSavingsMeasurement.Realised) {
        summary.realisedCount++;
        summary.savedThisMonth += getCloudSavingsRealisedThisMonth({
          realisedMonthlySavings: Number(action.realisedMonthlySavings) || 0,
          appliedAt: new Date(action.appliedAt),
          undoneAt: action.undoneAt ? new Date(action.undoneAt) : null,
          now: data.now,
        });
      } else if (action.status !== CloudSavingsActionStatus.Undone) {
        summary.measuringCount++;
        summary.promisedMonthly += Number(action.monthlySavings) || 0;
      }
    }

    summary.savedThisMonth = roundCost(summary.savedThisMonth);
    summary.promisedMonthly = roundCost(summary.promisedMonthly);

    const stops: Array<CloudSavingsAction> =
      await CloudSavingsActionService.findBy({
        query: {
          projectId: data.projectId,
          origin: CloudSavingsActionOrigin.Schedule,
          status: new Includes([
            CloudSavingsActionStatus.Applied,
            CloudSavingsActionStatus.Undoing,
            CloudSavingsActionStatus.Ended,
          ]),
          updatedAt: new GreaterThanOrEqual(monthStart),
        },
        select: { appliedAt: true, endedAt: true },
        skip: 0,
        limit: MAX_READ,
        props: { isRoot: true },
      });

    for (const stop of stops) {
      if (stop.appliedAt) {
        summary.scheduledHoursThisMonth +=
          getCloudSavingsScheduledHoursThisMonth({
            appliedAt: new Date(stop.appliedAt),
            endedAt: stop.endedAt ? new Date(stop.endedAt) : null,
            now: data.now,
          });
      }
    }

    summary.scheduledHoursThisMonth =
      Math.round(summary.scheduledHoursThisMonth * 10) / 10;

    const waiting: Array<CloudSavingsAction> =
      await CloudSavingsActionService.findBy({
        query: {
          projectId: data.projectId,
          status: CloudSavingsActionStatus.Proposed,
        },
        select: { cloudResourceId: true },
        skip: 0,
        limit: MAX_WAITING_JUDGED,
        props: { isRoot: true },
      });
    const owners: Map<string, CloudResourceOwners> = new Map();

    summary.waitingCount = waiting.length;

    for (const action of waiting) {
      const key: string = action.cloudResourceId?.toString() || "";

      if (!owners.has(key)) {
        owners.set(
          key,
          await CloudSavingsOwners.getOwners({
            projectId: data.projectId,
            cloudResourceId: action.cloudResourceId,
          }),
        );
      }

      if (
        CloudSavingsOwners.canApprove({
          props: data.props,
          owners: owners.get(key)!,
          projectId: data.projectId,
        })
      ) {
        summary.waitingForYouCount++;
      }
    }

    return summary;
  }
}
