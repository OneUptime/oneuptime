import {
  AllowedActiveMonitorCountInFreePlan,
  IsBillingEnabled,
} from "../../EnvironmentConfig";
import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import ProjectService, { CurrentPlan } from "../../Services/ProjectService";
import CreateLimit from "../../Types/Database/CreateLimit";
import ProjectLimitLock from "../Database/ProjectLimitLock";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import ActiveMonitorLimitUtil, {
  ActiveMonitorLimitKind,
  ActiveMonitorLimitStatus,
  ActiveMonitorPlanLimit,
  NO_ACTIVE_MONITOR_LIMIT,
} from "../../../Types/Monitor/ActiveMonitorLimit";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DataSource, EntityManager } from "typeorm";

/*
 * THE ACTIVE MONITOR LIMIT OF A PROJECT'S PLAN, HELD ON EVERY PATH.
 *
 * What counts, and which plans cap it: Types/Monitor/ActiveMonitorLimit.
 *
 * Every monitor is made through MonitorService.create: the dashboard's form
 * and Duplicate, the API (and so Terraform and the MCP server), a
 * workflow's Create Monitor step, an import from another tool, network
 * discovery's auto-import rules and alert policies, monitor
 * recommendations and the bulk Ping monitors. So the limit is held there,
 * twice, by this one class:
 *
 *  1. MonitorService.onBeforeCreate asks assertRoomFor before anything else
 *     is prepared, so a project at its limit is told at once;
 *  2. the INSERT itself is decided under the limit's lock (getCreateLimit,
 *     DatabaseService.insertWithinCreateLimit): the project's active
 *     monitors are counted in the INSERT's own transaction, once every
 *     earlier create held to the limit has committed, so two creates at
 *     the limit cannot both pass.
 *
 * An update that turns a Manual monitor into another kind - only
 * OneUptime's own writes may change a monitor's type - asks assertRoomFor
 * for the monitors it makes active.
 *
 * Nothing is ever turned off. A project already past its limit keeps every
 * monitor running, and new ones are refused until it has fewer than its
 * limit.
 *
 * Every reader counts with one statement (COUNT_STATEMENT): the limit,
 * the bill (ActiveMonitoringMeteredPlan) and Project.currentActiveMonitorsCount,
 * which refreshCount writes under the same lock, so that it stays what the
 * Monitor table holds.
 */
export default class ActiveMonitorLimit {
  // The limit's lock in a project (ProjectLimitLock).
  public static readonly LIMIT_NAME: string = "active-monitors";

  /*
   * The project's active monitors: every monitor but a Manual one,
   * whether turned on, turned off or archived. A deleted one no longer.
   */
  public static readonly COUNT_STATEMENT: string =
    'SELECT COUNT(*)::int AS "count" FROM "Monitor" WHERE "projectId" = $1 AND "monitorType" <> $2 AND "deletedAt" IS NULL';

  // The count, written on the project when it changed.
  public static readonly WRITE_COUNT_STATEMENT: string =
    'UPDATE "Project" SET "currentActiveMonitorsCount" = $1 WHERE "_id" = $2 AND "currentActiveMonitorsCount" IS DISTINCT FROM $1';

  // Where to change the plan, as the dashboard's settings menu names it.
  public static readonly BILLING_SETTINGS: string =
    "Project Settings > Billing";

  /*
   * The limit a project's plan holds it to: the lower of its own (a plan
   * bought from a reseller) and the Free plan's, or null.
   */
  public static getLimitOfPlan(
    currentPlan: CurrentPlan,
  ): ActiveMonitorPlanLimit | null {
    const projectLimit: number | null = ActiveMonitorLimitUtil.getProjectLimit(
      currentPlan.activeMonitorsLimit,
    );

    return ActiveMonitorLimitUtil.getLowerLimit([
      projectLimit !== null
        ? { limit: projectLimit, kind: ActiveMonitorLimitKind.Plan }
        : null,
      currentPlan.plan === PlanType.Free
        ? {
            limit: AllowedActiveMonitorCountInFreePlan,
            kind: ActiveMonitorLimitKind.FreePlan,
          }
        : null,
    ]);
  }

  /*
   * The project's limit: none on an install without billing, which has no
   * plans. The plan is read (and cached) by ProjectService.getCurrentPlan,
   * or handed in by a caller that has just read it.
   */
  public static async readLimit(data: {
    projectId: ObjectID;
    currentPlan?: CurrentPlan | undefined;
  }): Promise<ActiveMonitorPlanLimit | null> {
    if (!IsBillingEnabled) {
      return null;
    }

    const currentPlan: CurrentPlan =
      data.currentPlan || (await ProjectService.getCurrentPlan(data.projectId));

    return this.getLimitOfPlan(currentPlan);
  }

  /*
   * How many active monitors the project has, read with `manager` - the
   * transaction holding the limit's lock - or, with none, on its own.
   */
  public static async countActiveMonitors(data: {
    projectId: ObjectID;
    manager?: EntityManager | undefined;
  }): Promise<number> {
    const manager: EntityManager = data.manager || this.getManager();

    const rows: Array<{ count: number | string }> = await manager.query(
      this.COUNT_STATEMENT,
      [data.projectId.toString(), MonitorType.Manual],
    );

    return Number(rows[0]?.count || 0);
  }

  /*
   * The project's limit and, only when it has one, how many active
   * monitors it has (GET /api/monitor/active-monitor-limit).
   */
  public static async getStatus(
    projectId: ObjectID,
  ): Promise<ActiveMonitorLimitStatus> {
    const limit: ActiveMonitorPlanLimit | null = await this.readLimit({
      projectId: projectId,
    });

    if (!limit) {
      return NO_ACTIVE_MONITOR_LIMIT;
    }

    return {
      limit: limit,
      activeMonitors: await this.countActiveMonitors({ projectId: projectId }),
    };
  }

  /*
   * Null when `adding` more active monitors fit in the project, else the
   * sentence that refuses them. Not under the lock: an answer for now,
   * which the INSERT's own check makes again (getCreateLimit).
   */
  public static async getRefusal(data: {
    projectId: ObjectID;
    adding?: number | undefined;
    currentPlan?: CurrentPlan | undefined;
  }): Promise<string | null> {
    const adding: number = data.adding ?? 1;

    if (adding <= 0) {
      return null;
    }

    const limit: ActiveMonitorPlanLimit | null = await this.readLimit({
      projectId: data.projectId,
      currentPlan: data.currentPlan,
    });

    if (!limit) {
      return null;
    }

    const activeMonitors: number = await this.countActiveMonitors({
      projectId: data.projectId,
    });

    return this.refuseUnlessRoom({
      limit: limit,
      activeMonitors: activeMonitors,
      adding: adding,
    });
  }

  // Throws the limit's refusal unless `adding` more active monitors fit.
  public static async assertRoomFor(data: {
    projectId: ObjectID;
    adding?: number | undefined;
    currentPlan?: CurrentPlan | undefined;
  }): Promise<void> {
    const refusal: string | null = await this.getRefusal(data);

    if (refusal) {
      throw new BadDataException(refusal);
    }
  }

  /*
   * The limit a monitor create is held to, for DatabaseService to decide
   * with the INSERT: null for a Manual monitor, and in a project with no
   * limit.
   */
  public static async getCreateLimit(data: {
    projectId: ObjectID | null | undefined;
    monitorType: MonitorType | null | undefined;
  }): Promise<CreateLimit | null> {
    const projectId: ObjectID | null | undefined = data.projectId;

    if (
      !projectId ||
      !data.monitorType ||
      !MonitorTypeHelper.isBilledAsActiveMonitor(data.monitorType)
    ) {
      return null;
    }

    const limit: ActiveMonitorPlanLimit | null = await this.readLimit({
      projectId: projectId,
    });

    if (!limit) {
      return null;
    }

    return {
      limitName: this.LIMIT_NAME,
      projectId: projectId,
      check: async (manager: EntityManager): Promise<void> => {
        const refusal: string | null = this.refuseUnlessRoom({
          limit: limit,
          activeMonitors: await this.countActiveMonitors({
            projectId: projectId,
            manager: manager,
          }),
          adding: 1,
        });

        if (refusal) {
          throw new BadDataException(refusal);
        }
      },
    };
  }

  /*
   * Counts the project's active monitors under the limit's lock and writes
   * the count to Project.currentActiveMonitorsCount, when it changed. Under
   * the lock, the count is read after every create held to the limit that
   * started before it has committed, and two refreshes never interleave a
   * count and a write: whichever runs last writes what the table holds.
   * Returns the count, which the bill reports (ActiveMonitoringMeteredPlan).
   */
  public static async refreshCount(projectId: ObjectID): Promise<number> {
    return await ProjectLimitLock.run({
      limitName: this.LIMIT_NAME,
      projectId: projectId,
      run: async (manager: EntityManager): Promise<number> => {
        const count: number = await this.countActiveMonitors({
          projectId: projectId,
          manager: manager,
        });

        await manager.query(this.WRITE_COUNT_STATEMENT, [
          count,
          projectId.toString(),
        ]);

        return count;
      },
    });
  }

  // Null when `adding` more fit under the limit, else the refusal.
  public static refuseUnlessRoom(data: {
    limit: ActiveMonitorPlanLimit;
    activeMonitors: number;
    adding: number;
  }): string | null {
    if (
      ActiveMonitorLimitUtil.hasRoomFor({
        limit: data.limit.limit,
        activeMonitors: data.activeMonitors,
        adding: data.adding,
      })
    ) {
      return null;
    }

    return this.getRefusalMessage(data);
  }

  /*
   * The refusal, in one paragraph: which limit, how many active monitors
   * the project has, what to do, and what counts.
   */
  public static getRefusalMessage(data: {
    limit: ActiveMonitorPlanLimit;
    activeMonitors: number;
    adding: number;
  }): string {
    const isFreePlan: boolean =
      data.limit.kind === ActiveMonitorLimitKind.FreePlan;
    const limit: number = data.limit.limit;
    const room: number = ActiveMonitorLimitUtil.getRoom({
      limit: limit,
      activeMonitors: data.activeMonitors,
    });
    const plan: string = isFreePlan ? "the Free plan" : "its plan";

    let state: string;

    if (room > 0) {
      state = `This project has ${this.monitors(data.activeMonitors)} and ${plan} includes ${this.formatCount(limit)}, so it has room for ${this.formatCount(room)} more, not ${this.formatCount(data.adding)}.`;
    } else if (data.activeMonitors > limit) {
      state = `This project has ${this.monitors(data.activeMonitors)} and ${plan} includes ${this.formatCount(limit)}, so no more can be added until it has fewer than ${this.formatCount(limit)}. Every monitor it has keeps running.`;
    } else {
      state = `This project has reached ${isFreePlan ? "the Free plan's" : "its plan's"} limit of ${this.monitors(limit)}, so no more can be added.`;
    }

    const whatToDo: string = isFreePlan
      ? `Upgrade the plan in ${this.BILLING_SETTINGS} to add more.`
      : `Delete monitors you no longer need, or change the plan in ${this.BILLING_SETTINGS}.`;

    return `${state} ${whatToDo} Manual monitors do not count towards the limit; monitors that are turned off or archived do.`;
  }

  // "1 active monitor", "2,881 active monitors".
  private static monitors(count: number): string {
    return `${this.formatCount(count)} active monitor${count === 1 ? "" : "s"}`;
  }

  private static formatCount(count: number): string {
    return new Intl.NumberFormat("en-US").format(count);
  }

  private static getManager(): EntityManager {
    const dataSource: DataSource | null = PostgresAppInstance.isConnected()
      ? PostgresAppInstance.getDataSource()
      : null;

    if (!dataSource) {
      throw new DatabaseNotConnectedException();
    }

    return dataSource.manager;
  }
}
