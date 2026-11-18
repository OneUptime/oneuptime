import CacheGenerations from "../../Infrastructure/CacheGenerations";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import logger from "../Logger";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "../Realtime/RealtimeAccessChanges";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import ObjectID from "../../../Types/ObjectID";
import ProductKey from "../../../Types/Product/ProductKey";
import { getProductOfTable } from "../../../Types/Product/ProductOfTable";
import {
  PRODUCT_USAGE_MILESTONES,
  getProductsCountingTable,
} from "../../../Types/Product/ProductUsage";

/*
 * WHAT EACH PROJECT USES, KEPT A FEW MINUTES PER SERVER, AND A CHANGE TO IT
 * SEEN AT ONCE (issues #6814, #7465).
 *
 * The products menu says "Not set up" on a product that has nothing in it
 * (ProjectProductsService.getAnswer). Whether it has is one statement over
 * some thirty tables and a read of the project's milestones, and the menu
 * asks on every page load, so each process keeps the answer for TTL_MS. It
 * is kept under its project's generation (CacheGenerations, as
 * ProjectStateListCache and OnDutyPoliciesCache keep theirs).
 *
 * Kept for TTL_MS alone, the menu said "Not set up" on Monitors, On-Call
 * Duty and Logs for minutes after each was set up, through a reload
 * (#7465). So whatever can change the answer starts a new generation of the
 * project: here at once, and on every other server (the worker that opens
 * incidents, the telemetry writer that keeps the first logs) within
 * CacheGenerations.SHARED_READ_TTL_MS:
 *
 *   - a product's main record created (afterCreate, from DatabaseService's
 *     create, with hooks or without): a monitor, an on-call policy, a
 *     status page, the records ProductOfTable names;
 *   - such records deleted (afterDelete, from both of DatabaseService's
 *     delete paths): with the last one gone, the product is not set up
 *     again;
 *   - a telemetry product's first data (afterMilestoneReached, from
 *     ProjectMilestoneService when it keeps a milestone of
 *     PRODUCT_USAGE_MILESTONES).
 *
 * A create can be on a busy path (an incident a monitor opens, a service
 * the telemetry names, a host an agent reports), and a new generation costs
 * the next page load the statement again. Only the first record turns "Not
 * set up" into in use; every later one changes nothing. So a process starts
 * a new generation for a product of a project at most once in
 * NOTED_TTL_MS, and not at all while the answer it keeps says the product
 * is in use already. A delete in this process lets that go, so a product
 * emptied and set up again is seen again.
 *
 * Seen within TTL_MS all the same: a write that goes round DatabaseService
 * (a data migration, a repair by hand), the milestones' backfill, and a
 * product emptied in one process and set up again in another within
 * NOTED_TTL_MS.
 *
 * Every new generation is announced too (#8626): the Dashboard pages open
 * in the project, on every server, hear that what it uses changed and ask
 * for its products again (RealtimeAccessChanges.ProjectUsageChanged, which
 * Realtime hands to the project's usage room). So the products menu
 * follows a teammate's first monitor or an agent's first host without
 * waiting for the next look at it. A burst - a bulk delete, a retention
 * purge - is announced at most once per ANNOUNCE_EVERY_MS per project: the
 * first change at once, and one more once that time has passed, for those
 * that came meanwhile.
 *
 * While Redis cannot be reached, a change made here still counts here at
 * once (CacheGenerations), and one made elsewhere within TTL_MS; the pages
 * held here still hear of it. Nothing here throws. The usage handed out is a copy: no caller changes what the
 * next one reads.
 */

// What a project has something in: product -> has records or data.
export type ProjectUsage = Partial<Record<ProductKey, boolean>>;

// The milestones that say a product is in use (Logs' first logs, and so on).
const USAGE_MILESTONES: ReadonlySet<ActivationMilestone> =
  new Set<ActivationMilestone>(
    Object.values(PRODUCT_USAGE_MILESTONES).flatMap(
      (
        milestones: ReadonlyArray<ActivationMilestone> | undefined,
      ): ReadonlyArray<ActivationMilestone> => {
        return milestones || [];
      },
    ),
  );

export default class ProjectUsageCache {
  // How long a project's usage is kept at most, whatever its generation says.
  public static readonly TTL_MS: number = 5 * 60 * 1000;

  /*
   * How long this process remembers that a product of a project has records,
   * so a busy create path starts one new generation in that time, not one a
   * record.
   */
  public static readonly NOTED_TTL_MS: number = 5 * 60 * 1000;

  // How many projects' usage this process keeps at most.
  public static readonly MAX_PROJECTS: number = 10_000;

  // How long a project's generation is kept, many times an entry's life.
  public static readonly GENERATION_TTL_SECONDS: number = 24 * 60 * 60;

  // The least time between two announcements of a project's usage changing.
  public static readonly ANNOUNCE_EVERY_MS: number = 1_000;

  // The projects announced within ANNOUNCE_EVERY_MS, and when.
  private static announced: InMemoryTTLCache<number> =
    new InMemoryTTLCache<number>(ProjectUsageCache.MAX_PROJECTS);

  // The announcements waiting for ANNOUNCE_EVERY_MS to pass, by project.
  private static announcing: Map<string, ReturnType<typeof setTimeout>> =
    new Map<string, ReturnType<typeof setTimeout>>();

  // The usage read, by `<projectId>|<generation>`.
  private static entries: InMemoryTTLCache<ProjectUsage> =
    new InMemoryTTLCache<ProjectUsage>(ProjectUsageCache.MAX_PROJECTS);

  // Reads under way, by the same key: requests that miss together share one.
  private static inFlight: Map<string, Promise<ProjectUsage>> = new Map<
    string,
    Promise<ProjectUsage>
  >();

  // The (project, product) pairs this process knows have records.
  private static noted: InMemoryTTLCache<boolean> =
    new InMemoryTTLCache<boolean>(ProjectUsageCache.MAX_PROJECTS * 4);

  private static generations: CacheGenerations = new CacheGenerations({
    namespace: "project-usage-generation",
    ttlSeconds: ProjectUsageCache.GENERATION_TTL_SECONDS,
    maxKeys: ProjectUsageCache.MAX_PROJECTS,
    description: "what each project uses",
  });

  /*
   * The project's usage: as kept in its current generation, else read with
   * `read` (once for every caller that asks meanwhile) and kept. A read that
   * fails is never kept, and throws to its caller.
   */
  public static async getUsage(data: {
    projectId: ObjectID | string;
    read: () => Promise<ProjectUsage>;
  }): Promise<ProjectUsage> {
    const projectKey: string = ProjectUsageCache.toKey(data.projectId);

    const key: string = [
      projectKey,
      await ProjectUsageCache.generations.get(projectKey),
    ].join("|");

    const kept: ProjectUsage | undefined = ProjectUsageCache.entries.get(key);

    if (kept) {
      return { ...kept };
    }

    const reading: Promise<ProjectUsage> | undefined =
      ProjectUsageCache.inFlight.get(key);

    if (reading) {
      return { ...(await reading) };
    }

    const read: Promise<ProjectUsage> = data.read();
    ProjectUsageCache.inFlight.set(key, read);

    try {
      const usage: ProjectUsage = await read;

      /*
       * Kept under the generation the read started in: a change made while
       * it read started a new one, and this answer is never asked for again.
       */
      ProjectUsageCache.entries.set(
        key,
        { ...usage },
        ProjectUsageCache.TTL_MS,
      );

      return { ...usage };
    } finally {
      if (ProjectUsageCache.inFlight.get(key) === read) {
        ProjectUsageCache.inFlight.delete(key);
      }
    }
  }

  /*
   * Starts a new generation of each project's usage: read again on the next
   * request, here at once and on every other server within
   * CacheGenerations.SHARED_READ_TTL_MS. Never throws.
   */
  public static async forgetProjects(
    projectIds: Array<ObjectID | string | null | undefined>,
  ): Promise<void> {
    const keys: Array<string> = Array.from(
      new Set<string>(
        projectIds
          .filter((projectId: ObjectID | string | null | undefined) => {
            return Boolean(projectId?.toString());
          })
          .map((projectId: ObjectID | string | null | undefined): string => {
            return ProjectUsageCache.toKey(projectId!);
          }),
      ),
    );

    if (keys.length === 0) {
      return;
    }

    try {
      await ProjectUsageCache.generations.bump(keys);
    } catch (err) {
      // CacheGenerations does not throw; this is only ever a safety net.
      logger.error(err);
    }

    // Once the new generation is there: whoever asks then reads it.
    for (const key of keys) {
      ProjectUsageCache.announce(key);
    }
  }

  /*
   * Tells every server's pages in the project that its usage changed: at
   * once, unless it was told within ANNOUNCE_EVERY_MS - then once more when
   * that time is over, for every change in between. Never throws.
   */
  private static announce(projectKey: string): void {
    try {
      // One already waits: it covers this change too.
      if (ProjectUsageCache.announcing.has(projectKey)) {
        return;
      }

      const announcedAt: number | undefined =
        ProjectUsageCache.announced.get(projectKey);

      if (announcedAt === undefined) {
        ProjectUsageCache.sendAnnouncement(projectKey);
        return;
      }

      const timer: ReturnType<typeof setTimeout> = setTimeout(
        (): void => {
          ProjectUsageCache.announcing.delete(projectKey);
          ProjectUsageCache.sendAnnouncement(projectKey);
        },
        Math.max(
          0,
          announcedAt + ProjectUsageCache.ANNOUNCE_EVERY_MS - Date.now(),
        ),
      );

      // An announcement waiting never keeps the process up.
      if (typeof timer === "object" && timer && "unref" in timer) {
        timer.unref();
      }

      ProjectUsageCache.announcing.set(projectKey, timer);
    } catch (err) {
      logger.error(err);
    }
  }

  private static sendAnnouncement(projectKey: string): void {
    try {
      ProjectUsageCache.announced.set(
        projectKey,
        Date.now(),
        ProjectUsageCache.ANNOUNCE_EVERY_MS,
      );

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.ProjectUsageChanged,
        projectId: projectKey,
      });
    } catch (err) {
      logger.error(err);
    }
  }

  /*
   * The products a table's records count for: its main record's product
   * (ProductOfTable), and the products counted by some of their records
   * (ProductUsage.PRODUCT_USAGE_TABLES, #7325) - a data store is Data
   * Observability's and Data Security's.
   */
  public static getProductsOfTable(
    tableName: string | null | undefined,
  ): Array<ProductKey> {
    const products: Array<ProductKey> = [];
    const main: ProductKey | null = getProductOfTable(tableName);

    if (main) {
      products.push(main);
    }

    for (const product of getProductsCountingTable(tableName)) {
      if (!products.includes(product)) {
        products.push(product);
      }
    }

    return products;
  }

  /*
   * After a record is created: the first record of a product (ProductOfTable,
   * or one a product counts, PRODUCT_USAGE_TABLES) that this process has seen
   * in NOTED_TTL_MS starts a new generation of its project's usage, unless
   * the usage kept says the product is in use already. Never fails the
   * create.
   */
  public static async afterCreate(data: {
    tableName: string | null | undefined;
    row: unknown;
  }): Promise<void> {
    try {
      const products: Array<ProductKey> = ProjectUsageCache.getProductsOfTable(
        data.tableName,
      );

      if (products.length === 0) {
        return;
      }

      const projectId: string | null = ProjectUsageCache.getProjectId(data.row);

      if (!projectId) {
        return;
      }

      let isEveryProductKeptInUse: boolean = true;

      for (const product of products) {
        const notedKey: string = ProjectUsageCache.toNotedKey(
          projectId,
          product,
        );

        if (ProjectUsageCache.noted.get(notedKey)) {
          continue;
        }

        ProjectUsageCache.noted.set(
          notedKey,
          true,
          ProjectUsageCache.NOTED_TTL_MS,
        );

        if (!(await ProjectUsageCache.isKeptAsInUse(projectId, product))) {
          isEveryProductKeptInUse = false;
        }
      }

      if (isEveryProductKeptInUse) {
        return;
      }

      await ProjectUsageCache.forgetProjects([projectId]);
    } catch (err) {
      logger.error("Could not note a product's first record:");
      logger.error(err as Error);
    }
  }

  /*
   * After records are deleted: deleted records of a product (ProductOfTable)
   * start a new generation of their projects' usage, as the last one gone
   * leaves the product not set up. Never fails the delete.
   */
  public static async afterDelete(data: {
    tableName: string | null | undefined;
    rows: Array<unknown>;
  }): Promise<void> {
    try {
      const products: Array<ProductKey> = ProjectUsageCache.getProductsOfTable(
        data.tableName,
      );

      if (products.length === 0 || !data.rows || data.rows.length === 0) {
        return;
      }

      const projectIds: Array<string> = Array.from(
        new Set<string>(
          data.rows
            .map((row: unknown): string | null => {
              return ProjectUsageCache.getProjectId(row);
            })
            .filter((projectId: string | null): projectId is string => {
              return Boolean(projectId);
            }),
        ),
      );

      for (const projectId of projectIds) {
        for (const product of products) {
          ProjectUsageCache.noted.delete(
            ProjectUsageCache.toNotedKey(projectId, product),
          );
        }
      }

      await ProjectUsageCache.forgetProjects(projectIds);
    } catch (err) {
      logger.error("Could not note a product's records deleted:");
      logger.error(err as Error);
    }
  }

  /*
   * After a milestone is kept for the first time: a telemetry product's
   * first data (PRODUCT_USAGE_MILESTONES) starts a new generation of the
   * project's usage. Any other milestone changes nothing it answers.
   */
  public static async afterMilestoneReached(data: {
    projectId: ObjectID | string | null | undefined;
    milestone: ActivationMilestone;
  }): Promise<void> {
    if (
      !data.projectId ||
      !ProjectUsageCache.isUsageMilestone(data.milestone)
    ) {
      return;
    }

    await ProjectUsageCache.forgetProjects([data.projectId]);
  }

  // Whether a milestone says a product is in use.
  public static isUsageMilestone(milestone: ActivationMilestone): boolean {
    return USAGE_MILESTONES.has(milestone);
  }

  // Drops everything this process keeps. For tests.
  public static clear(): void {
    for (const timer of ProjectUsageCache.announcing.values()) {
      clearTimeout(timer);
    }

    ProjectUsageCache.announcing.clear();
    ProjectUsageCache.announced.clear();
    ProjectUsageCache.entries.clear();
    ProjectUsageCache.inFlight.clear();
    ProjectUsageCache.noted.clear();
    ProjectUsageCache.generations.clear();
  }

  /*
   * Whether the usage this process keeps for the project's current
   * generation says the product is in use: then a record more changes
   * nothing.
   */
  private static async isKeptAsInUse(
    projectId: string,
    product: ProductKey,
  ): Promise<boolean> {
    const key: string = [
      projectId,
      await ProjectUsageCache.generations.get(projectId),
    ].join("|");

    return ProjectUsageCache.entries.get(key)?.[product] === true;
  }

  private static getProjectId(row: unknown): string | null {
    if (!row || typeof row !== "object") {
      return null;
    }

    const value: unknown = (row as Record<string, unknown>)["projectId"];
    const projectId: string =
      value === undefined || value === null ? "" : String(value);

    return ObjectID.isValidUUID(projectId)
      ? ProjectUsageCache.toKey(projectId)
      : null;
  }

  private static toKey(projectId: ObjectID | string): string {
    return projectId.toString().toLowerCase();
  }

  private static toNotedKey(projectId: string, product: ProductKey): string {
    return `${projectId}|${product}`;
  }
}
