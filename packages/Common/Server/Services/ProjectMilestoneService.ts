import DatabaseService from "./DatabaseService";
import ProjectService from "./ProjectService";
import PostgresAppInstance from "../Infrastructure/PostgresDatabase";
import { IsBillingEnabled, IsEnterpriseEdition } from "../EnvironmentConfig";
import InProcessMemo from "../Utils/InProcessMemo";
import logger from "../Utils/Logger";
import ProductAnalytics from "../Utils/ProductAnalytics";
import Model from "../../Models/DatabaseModels/ProjectMilestone";
import ActivationMilestone, {
  getActivationMilestoneEventName,
  isActivationMilestone,
} from "../../Types/Analytics/ActivationMilestone";
import OneUptimeDate from "../../Types/Date";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * A project's activation milestones (issue #6830, Models/DatabaseModels/
 * ProjectMilestone, Types/Analytics/ActivationMilestone).
 *
 * HOW TO RECORD ONE - where the thing happens, once it has happened:
 *
 *   ProjectMilestoneService.reachInBackground({
 *     projectId: createdItem.projectId,
 *     milestone: ActivationMilestone.FirstMonitorCreated,
 *   });
 *
 * Call it after the write that makes the milestone true has succeeded (an
 * onCreateSuccess, a stored result), never before a check that can still
 * refuse it. It returns at once and never throws: the request or the ingest
 * path that calls it waits for nothing. Call it every time the thing
 * happens - the first call keeps the milestone, and every later one costs a
 * lookup in this process's memo, with no database call at all. `await
 * reach()` instead when the caller needs to know the write is done (a test,
 * the backfill).
 *
 * HOW TO READ THEM: getReachedMilestones(projectId) on the server; the
 * Dashboard lists ProjectMilestone through its API (any member may read).
 *
 * The first call to keep a milestone sends its analytics event,
 * `activation/<milestone>`, with the seconds since the project was created
 * and its plan - nothing that names anyone (Docs/analytics/activation.md).
 * Only where product analytics is set up (ProductAnalytics.isConfigured: an
 * ANALYTICS_KEY and ANALYTICS_HOST, OneUptime Cloud): a self-hosted server
 * keeps its milestones to itself and sends nothing.
 */

/*
 * How long this process remembers that a project has a milestone. A
 * milestone is never taken back, so this bounds nothing but memory: an
 * entry let go is one more INSERT that finds the row there. Long, so a busy
 * ingest path stays out of Postgres.
 */
const REACHED_MEMO_TTL_IN_MS: number = 6 * 60 * 60 * 1000;
const REACHED_MEMO_MAX_ENTRIES: number = 100_000;

// Postgres' code for a foreign key with nothing to point at: the project is gone.
const FOREIGN_KEY_VIOLATION: string = "23503";

export interface ReachMilestoneData {
  projectId: ObjectID | string | null | undefined;
  milestone: ActivationMilestone;
  /*
   * When it happened, when that is not now: a stored result's own time.
   * Defaults to now.
   */
  reachedAt?: Date | undefined;
}

export interface ReachedMilestone {
  milestone: ActivationMilestone;
  reachedAt: Date;
  wasBackfilled: boolean;
}

interface ProjectForEvent {
  createdAt: Date | null;
  planName: string;
  createdOwnerEmail: string;
}

export class Service extends DatabaseService<Model> {
  /*
   * The (project, milestone) pairs this process knows are kept - written
   * here, or found already there. Bounded: the oldest is let go at the cap.
   */
  private readonly reachedMemo: InProcessMemo<boolean> =
    new InProcessMemo<boolean>({
      ttlInMs: REACHED_MEMO_TTL_IN_MS,
      maxEntries: REACHED_MEMO_MAX_ENTRIES,
    });

  /*
   * The writes still in flight, so calls that arrive together - a burst of
   * telemetry for a new project - share one INSERT.
   */
  private readonly writesInFlight: Map<string, Promise<boolean>> = new Map<
    string,
    Promise<boolean>
  >();

  public constructor() {
    super(Model);
  }

  private memoKey(projectId: string, milestone: ActivationMilestone): string {
    return `${projectId.toLowerCase()}:${milestone}`;
  }

  /*
   * Whether this process already knows the project has the milestone: a
   * Map lookup, for a hot path to skip work before it starts any.
   */
  public isKnownReached(
    projectId: ObjectID | string,
    milestone: ActivationMilestone,
  ): boolean {
    return Boolean(
      this.reachedMemo.get(this.memoKey(projectId.toString(), milestone)),
    );
  }

  /*
   * Keeps the milestone for the project if it has not got it yet, and sends
   * its event when this call is the one that kept it. Resolves true when
   * this call kept it, false when it was kept already - or could not be
   * kept: never rejects, and a write that failed is tried again by the next
   * call.
   */
  public async reach(data: ReachMilestoneData): Promise<boolean> {
    try {
      if (!data.projectId || !isActivationMilestone(data.milestone)) {
        return false;
      }

      const projectId: string = data.projectId.toString();
      const key: string = this.memoKey(projectId, data.milestone);

      if (this.reachedMemo.get(key)) {
        return false;
      }

      const inFlight: Promise<boolean> | undefined =
        this.writesInFlight.get(key);

      if (inFlight) {
        await inFlight;
        return false;
      }

      const write: Promise<boolean> = this.keep({
        projectId: projectId,
        milestone: data.milestone,
        reachedAt: data.reachedAt || OneUptimeDate.getCurrentDate(),
        memoKey: key,
      });

      this.writesInFlight.set(key, write);

      try {
        return await write;
      } finally {
        this.writesInFlight.delete(key);
      }
    } catch (err) {
      logger.error("Could not keep a project milestone:");
      logger.error(err as Error);
      return false;
    }
  }

  /*
   * reach() without waiting for it: what a request or an ingest path calls.
   * Costs a memo lookup once the milestone is known.
   */
  public reachInBackground(data: ReachMilestoneData): void {
    if (
      !data.projectId ||
      this.isKnownReached(data.projectId, data.milestone)
    ) {
      return;
    }

    this.reach(data).catch((err: Error) => {
      // reach() never rejects; this only keeps a surprise out of the logs' way.
      logger.error(err);
    });
  }

  private async keep(data: {
    projectId: string;
    milestone: ActivationMilestone;
    reachedAt: Date;
    memoKey: string;
  }): Promise<boolean> {
    if (!PostgresAppInstance.isConnected()) {
      return false;
    }

    /*
     * A sample project (issue #6808) reaches no milestone: it was made up
     * for a person to look around in, and what happens in it is not a
     * project getting value - nothing is kept, no activation event is sent,
     * and the first-hour funnel never sees it. Remembered like a milestone
     * kept, so it is not asked again.
     */
    if (await ProjectService.isSampleProject(data.projectId)) {
      this.reachedMemo.set(data.memoKey, true);
      return false;
    }

    let insertedRows: Array<JSONObject>;

    try {
      insertedRows = (await this.getRepository().manager.query(
        `INSERT INTO "ProjectMilestone" ("projectId", "milestone", "reachedAt", "wasBackfilled", "version") VALUES ($1, $2, $3, false, 1) ON CONFLICT ("projectId", "milestone") DO NOTHING RETURNING "_id"`,
        [data.projectId, data.milestone, data.reachedAt],
      )) as Array<JSONObject>;
    } catch (err) {
      if ((err as { code?: string })?.code === FOREIGN_KEY_VIOLATION) {
        // The project was deleted: there is nothing to keep, now or later.
        this.reachedMemo.set(data.memoKey, true);
        return false;
      }

      throw err;
    }

    this.reachedMemo.set(data.memoKey, true);

    if (!Array.isArray(insertedRows) || insertedRows.length === 0) {
      // Kept already, by an earlier call or another server.
      return false;
    }

    await this.sendMilestoneEvent({
      projectId: data.projectId,
      milestone: data.milestone,
      reachedAt: data.reachedAt,
    });

    return true;
  }

  /*
   * `activation/<milestone>` to product analytics, from the call that kept
   * the milestone - so once per project. Filed under the project creator's
   * email, the distinct id server/project_created uses, so a project's
   * milestones join the person's sign-up and project in one funnel. The
   * properties name no one (Docs/analytics/activation.md).
   */
  private async sendMilestoneEvent(data: {
    projectId: string;
    milestone: ActivationMilestone;
    reachedAt: Date;
  }): Promise<void> {
    if (!ProductAnalytics.isConfigured()) {
      return;
    }

    try {
      const project: ProjectForEvent | null = await this.readProjectForEvent(
        data.projectId,
      );

      if (!project || !project.createdOwnerEmail) {
        return;
      }

      ProductAnalytics.capture({
        event: getActivationMilestoneEventName(data.milestone),
        distinctId: project.createdOwnerEmail,
        properties: Service.getMilestoneEventProperties({
          projectId: data.projectId,
          milestone: data.milestone,
          reachedAt: data.reachedAt,
          projectCreatedAt: project.createdAt,
          planName: project.planName,
        }),
        // Stored once by PostHog, should it ever be sent twice.
        deduplicationKey: `activation:${data.projectId}:${data.milestone}`,
        timestamp: data.reachedAt,
      });
    } catch (err) {
      logger.error("Could not send a project milestone's event:");
      logger.error(err as Error);
    }
  }

  // The edition the server runs, as every event carries it.
  public static getEdition(): string {
    if (IsBillingEnabled) {
      return "cloud";
    }

    return IsEnterpriseEdition ? "enterprise" : "community";
  }

  /*
   * What a milestone's event carries, and all it carries: the project's id,
   * its plan, the server's edition, the milestone and how long after the
   * project was created it was reached.
   */
  public static getMilestoneEventProperties(data: {
    projectId: string;
    milestone: ActivationMilestone;
    reachedAt: Date;
    projectCreatedAt: Date | null;
    planName: string;
  }): JSONObject {
    const properties: JSONObject = {
      project_id: data.projectId,
      plan: data.planName || "",
      edition: Service.getEdition(),
      milestone: data.milestone,
    };

    if (data.projectCreatedAt) {
      properties["seconds_since_project_created"] = Math.max(
        0,
        Math.round(
          (data.reachedAt.getTime() - data.projectCreatedAt.getTime()) / 1000,
        ),
      );
    }

    return properties;
  }

  private async readProjectForEvent(
    projectId: string,
  ): Promise<ProjectForEvent | null> {
    const rows: Array<JSONObject> = (await this.getRepository().manager.query(
      `SELECT "createdAt", "planName", "createdOwnerEmail" FROM "Project" WHERE "_id" = $1`,
      [projectId],
    )) as Array<JSONObject>;

    const row: JSONObject | undefined = rows?.[0];

    if (!row) {
      return null;
    }

    const createdAt: unknown = row["createdAt"];

    return {
      createdAt:
        createdAt instanceof Date
          ? createdAt
          : createdAt
            ? new Date(createdAt as string)
            : null,
      planName: (row["planName"] as string) || "",
      createdOwnerEmail: (row["createdOwnerEmail"] as string) || "",
    };
  }

  // The milestones the project has reached, oldest first.
  public async getReachedMilestones(
    projectId: ObjectID,
  ): Promise<Array<ReachedMilestone>> {
    const rows: Array<Model> = await this.findBy({
      query: {
        projectId: projectId,
      },
      select: {
        milestone: true,
        reachedAt: true,
        wasBackfilled: true,
      },
      sort: {
        reachedAt: SortOrder.Ascending,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    const reached: Array<ReachedMilestone> = [];

    for (const row of rows) {
      if (!isActivationMilestone(row.milestone) || !row.reachedAt) {
        continue;
      }

      reached.push({
        milestone: row.milestone,
        reachedAt: row.reachedAt,
        wasBackfilled: Boolean(row.wasBackfilled),
      });
    }

    return reached;
  }

  // For tests: forget what this process knows.
  public forgetKnownMilestones(): void {
    this.reachedMemo.clear();
    this.writesInFlight.clear();
  }
}

export default new Service();
