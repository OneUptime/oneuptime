import { JSONObject } from "../JSON";

/*
 * HOW MANY ACTIVE MONITORS A PROJECT'S PLAN INCLUDES.
 *
 * An active monitor is every monitor but a Manual one, whether it is turned
 * on, turned off or archived (MonitorTypeHelper.isBilledAsActiveMonitor):
 * what OneUptime bills at its monthly rate (ActiveMonitoringMeteredPlan),
 * and what Project.currentActiveMonitorsCount holds. Manual monitors are
 * free and never limited.
 *
 * On a billed install two plans cap them:
 *
 *  - a plan bought from a reseller, at its own number: the project's
 *    activeMonitorsLimit, written from the reseller plan's Monitor Limit
 *    when the project is made with the reseller's promo code and again on
 *    every change of tier (ResellerPlanAPI). Nothing above 0 is no limit,
 *    as with the reseller plan's seat limit;
 *  - the Free plan, at ALLOWED_ACTIVE_MONITOR_COUNT_IN_FREE_PLAN.
 *
 * A project held to both is held to the lower. A self-hosted install has
 * no plans, so no limit.
 *
 * A project at its limit adds no active monitor until it has fewer: every
 * way one is made is refused, in a sentence that names the limit, how many
 * the project has and what to do (Server/Utils/Billing/ActiveMonitorLimit).
 * A project already past its limit keeps every monitor it has, running:
 * nothing is turned off, and turning one off does not make room, as it does
 * not take it off the bill.
 */
export enum ActiveMonitorLimitKind {
  // The project's own plan sets it: a plan bought from a reseller.
  Plan = "Plan",
  // The Free plan of OneUptime Cloud.
  FreePlan = "FreePlan",
}

// The limit a project is held to, and which plan sets it.
export interface ActiveMonitorPlanLimit {
  limit: number;
  kind: ActiveMonitorLimitKind;
}

/*
 * What the Dashboard is told (GET /api/monitor/active-monitor-limit): the
 * limit and, only when there is one, how many active monitors the project
 * has. A project with no limit is not counted.
 */
export interface ActiveMonitorLimitStatus {
  limit: ActiveMonitorPlanLimit | null;
  activeMonitors: number | null;
}

export const NO_ACTIVE_MONITOR_LIMIT: ActiveMonitorLimitStatus = {
  limit: null,
  activeMonitors: null,
};

const isWholeNumberAtLeast: (value: unknown, minimum: number) => boolean = (
  value: unknown,
  minimum: number,
): boolean => {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= minimum
  );
};

export default class ActiveMonitorLimitUtil {
  /*
   * The project's own limit as the Project row holds it, or null: a
   * reseller plan with no Monitor Limit writes nothing, or 0, and either
   * is no limit.
   */
  public static getProjectLimit(
    activeMonitorsLimit: number | null | undefined,
  ): number | null {
    return isWholeNumberAtLeast(activeMonitorsLimit, 1)
      ? (activeMonitorsLimit as number)
      : null;
  }

  /*
   * The limit a project is held to: the lower of its own plan's and the
   * Free plan's, either of which may be missing. On a tie, the project's
   * own plan, whose words ("change the plan") fit a project that bought it.
   */
  public static getLowerLimit(
    limits: Array<ActiveMonitorPlanLimit | null>,
  ): ActiveMonitorPlanLimit | null {
    let lowest: ActiveMonitorPlanLimit | null = null;

    for (const limit of limits) {
      if (!limit) {
        continue;
      }

      if (
        !lowest ||
        limit.limit < lowest.limit ||
        (limit.limit === lowest.limit &&
          limit.kind === ActiveMonitorLimitKind.Plan)
      ) {
        lowest = limit;
      }
    }

    return lowest;
  }

  // How many more active monitors fit: 0 at the limit and past it.
  public static getRoom(data: { limit: number; activeMonitors: number }): number {
    return Math.max(0, data.limit - data.activeMonitors);
  }

  // Whether `adding` more fit under the limit.
  public static hasRoomFor(data: {
    limit: number;
    activeMonitors: number;
    adding: number;
  }): boolean {
    return data.activeMonitors + data.adding <= data.limit;
  }

  // At the limit or past it: no active monitor can be added.
  public static isAtOrOverLimit(status: ActiveMonitorLimitStatus): boolean {
    return Boolean(
      status.limit &&
        status.activeMonitors !== null &&
        status.activeMonitors >= status.limit.limit,
    );
  }

  // Past it: the project has more than its plan includes.
  public static isOverLimit(status: ActiveMonitorLimitStatus): boolean {
    return Boolean(
      status.limit &&
        status.activeMonitors !== null &&
        status.activeMonitors > status.limit.limit,
    );
  }

  public static toJSON(status: ActiveMonitorLimitStatus): JSONObject {
    return {
      limit: status.limit
        ? { limit: status.limit.limit, kind: status.limit.kind }
        : null,
      activeMonitors: status.activeMonitors,
    };
  }

  /*
   * Read back from the response. Anything that is not a whole limit and a
   * whole count, with a kind this version knows, reads as no limit: a
   * notice is never drawn from a value nobody can vouch for. A limit of 0
   * is one: an install can give the Free plan no active monitors at all.
   */
  public static fromJSON(
    json: JSONObject | null | undefined,
  ): ActiveMonitorLimitStatus {
    if (!json || typeof json !== "object") {
      return NO_ACTIVE_MONITOR_LIMIT;
    }

    const limit: unknown = json["limit"];
    const activeMonitors: unknown = json["activeMonitors"];

    if (!limit || typeof limit !== "object" || Array.isArray(limit)) {
      return NO_ACTIVE_MONITOR_LIMIT;
    }

    const limitValue: unknown = (limit as JSONObject)["limit"];
    const kind: unknown = (limit as JSONObject)["kind"];

    if (
      !isWholeNumberAtLeast(limitValue, 0) ||
      !Object.values(ActiveMonitorLimitKind).includes(
        kind as ActiveMonitorLimitKind,
      ) ||
      !isWholeNumberAtLeast(activeMonitors, 0)
    ) {
      return NO_ACTIVE_MONITOR_LIMIT;
    }

    return {
      limit: {
        limit: limitValue as number,
        kind: kind as ActiveMonitorLimitKind,
      },
      activeMonitors: activeMonitors as number,
    };
  }
}
