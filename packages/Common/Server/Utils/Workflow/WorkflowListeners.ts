import CacheGenerations from "../../Infrastructure/CacheGenerations";
import GlobalCache from "../../Infrastructure/GlobalCache";
import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import Redis from "../../Infrastructure/Redis";
import { DatabaseTriggerType } from "../../Types/Database/Hooks";
import logger from "../Logger";
import EnableWorkflowOn from "../../../Types/BaseDatabase/EnableWorkflowOn";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import Text from "../../../Types/Text";
import {
  getCreateOrUpdateTriggerId,
  hasCreateOrUpdateTrigger,
} from "../../../Types/Workflow/CreateOrUpdateTrigger";
import { DataSource } from "typeorm";

/*
 * WHICH TRIGGERS A PROJECT'S WORKFLOWS LISTEN TO (issue #8861).
 *
 * Every create, update and delete of a model a workflow can watch posts an
 * event to the workflow service (DatabaseService.onTriggerWorkflow), and its
 * handler reads the project's workflows of that trigger
 * (OnTriggerBaseModel.initTrigger): an HTTP round trip and a query for every
 * write of an incident, a monitor, a state change - though most projects have
 * no workflow on most models. Now a write posts its event only when an
 * enabled workflow of its project that is not archived listens to it: to the
 * model's own On Create, On Update or On Delete, or - for a create or an
 * update - to its On Create or Update, as initTrigger reads them.
 *
 * The triggers each project's workflows listen to are kept in Redis, under a
 * generation of the project:
 *
 *   - A write reads the project's generation and the triggers kept for it in
 *     one round trip. Kept under the generation it read, they answer it.
 *     Kept under another, or not kept, they are read from the database and
 *     kept under the generation read before that read, for
 *     TRIGGERS_TTL_SECONDS at most.
 *   - Every create, update and delete of a workflow - with its hooks or
 *     without, from the dashboard, the API, an import, Ask AI - starts a new
 *     generation of its project once the write is done (DatabaseService:
 *     afterCreate, afterUpdate, afterDelete). In every process, the next
 *     write of the project reads its workflows again; what a read that
 *     started before the change keeps, it keeps under the generation before,
 *     which no write reads again. So a workflow enabled, created or brought
 *     back from the archive hears the very next write, and one turned off,
 *     archived or deleted is posted to no more.
 *
 * Whenever it cannot tell - Redis cannot be reached, the database read
 * fails, a project's workflows listen to more triggers than one read holds -
 * the event is posted, as it always was: a run missed is worse than a
 * request wasted.
 */

// What the triggers are kept as: with the generation they were read in.
interface KeptTriggers {
  generation: string;
  triggerIds: Array<string>;
}

/*
 * The triggers of a project's workflows that hear a write: enabled, not
 * archived, not deleted - the workflows initTrigger reads.
 */
export const WORKFLOW_LISTENER_TRIGGERS_SQL: string = `SELECT DISTINCT "triggerId" FROM "Workflow" WHERE "projectId" = $1 AND "isEnabled" = true AND "isArchived" = false AND "deletedAt" IS NULL AND "triggerId" IS NOT NULL LIMIT $2`;

export default class WorkflowListeners {
  public static readonly NAMESPACE: string = "workflow-listeners";

  // How long the triggers read are kept at most: a backstop, should a change not reach Redis.
  public static readonly TRIGGERS_TTL_SECONDS: number = 60;

  // How long a generation lasts without a change: far longer than anything kept under it.
  public static readonly GENERATION_TTL_SECONDS: number = 30 * 24 * 60 * 60;

  // The table a change of starts a new generation of its project.
  public static readonly TABLE_NAME: string = "Workflow";

  // Reads of a project's triggers under way in this process, by project and generation.
  private static readonly reading: Map<string, Promise<Array<string> | null>> =
    new Map<string, Promise<Array<string> | null>>();

  /*
   * The triggers a write of a model posts its event for: the model's own
   * (incident-on-update), and for a create or an update the model's On
   * Create or Update, when it has one - as OnTriggerBaseModel reads them.
   */
  public static triggerIdsOf(data: {
    tableName: string;
    triggerType: DatabaseTriggerType;
    enableWorkflowOn?: EnableWorkflowOn | undefined;
  }): Array<string> {
    const triggerIds: Array<string> = [
      `${Text.pascalCaseToDashes(data.tableName)}-${data.triggerType}`,
    ];

    if (
      (data.triggerType === "on-create" || data.triggerType === "on-update") &&
      hasCreateOrUpdateTrigger(data.enableWorkflowOn)
    ) {
      triggerIds.push(getCreateOrUpdateTriggerId(data.tableName));
    }

    return triggerIds;
  }

  /*
   * Whether an enabled workflow of the project that is not archived listens
   * to any of the triggers: true whenever it cannot tell. Never throws.
   */
  public static async isAnyListening(data: {
    projectId: ObjectID;
    triggerIds: Array<string>;
  }): Promise<boolean> {
    try {
      const listening: Set<string> | null = await this.getTriggerIds(
        data.projectId,
      );

      if (!listening) {
        return true;
      }

      return data.triggerIds.some((triggerId: string): boolean => {
        return listening.has(triggerId);
      });
    } catch (error) {
      logger.debug(
        `Workflow listeners: could not tell whether a workflow listens; posting the event: ${error}`,
      );
      return true;
    }
  }

  /*
   * The triggers the project's enabled workflows that are not archived
   * listen to, or null when it cannot tell (see the top of this file).
   */
  public static async getTriggerIds(
    projectId: ObjectID,
  ): Promise<Set<string> | null> {
    if (!Redis.getClient() || !Redis.isConnected()) {
      return null;
    }

    const project: string = projectId.toString().toLowerCase();

    let generation: string | null = null;
    let kept: string | null = null;

    try {
      [generation = null, kept = null] = await GlobalCache.getStrings(
        this.NAMESPACE,
        [generationKey(project), triggersKey(project)],
      );

      // A project's first: its generation starts now, and nothing is kept under it.
      if (!generation) {
        const token: string = CacheGenerations.newToken();
        kept = null;

        generation = (await GlobalCache.setStringIfNotExists(
          this.NAMESPACE,
          generationKey(project),
          token,
          { expiresInSeconds: this.GENERATION_TTL_SECONDS },
        ))
          ? token
          : await GlobalCache.getString(this.NAMESPACE, generationKey(project));
      }
    } catch (error) {
      logger.debug(
        `Workflow listeners: Redis could not be read; posting the event: ${error}`,
      );
      return null;
    }

    if (!generation) {
      return null;
    }

    const keptTriggers: Array<string> | null = readKept(kept, generation);

    if (keptTriggers) {
      return new Set<string>(keptTriggers);
    }

    const triggerIds: Array<string> | null = await this.readOnce(
      projectId,
      generation,
    );

    if (!triggerIds) {
      return null;
    }

    try {
      const toKeep: KeptTriggers = {
        generation: generation,
        triggerIds: triggerIds,
      };

      await GlobalCache.setString(
        this.NAMESPACE,
        triggersKey(project),
        JSON.stringify(toKeep),
        { expiresInSeconds: this.TRIGGERS_TTL_SECONDS },
      );
    } catch (error) {
      // What was read answers this write; the next reads the database again.
      logger.debug(
        `Workflow listeners: could not keep the triggers read: ${error}`,
      );
    }

    return new Set<string>(triggerIds);
  }

  /*
   * Says the projects' workflows changed: in every process, the next write
   * of each reads its workflows again. Never throws: should Redis not take
   * it, what each process kept lasts TRIGGERS_TTL_SECONDS at most.
   */
  public static async changed(
    projectIds: Array<ObjectID | string | null | undefined>,
  ): Promise<void> {
    const projects: Array<string> = Array.from(
      new Set<string>(
        projectIds
          .filter((projectId: ObjectID | string | null | undefined) => {
            return Boolean(projectId);
          })
          .map((projectId: ObjectID | string | null | undefined): string => {
            return projectId!.toString().toLowerCase();
          }),
      ),
    );

    if (projects.length === 0) {
      return;
    }

    if (!Redis.getClient() || !Redis.isConnected()) {
      /*
       * Every write posts its event while Redis is away. What was kept
       * before it runs out within TRIGGERS_TTL_SECONDS of being kept.
       */
      logger.warn(
        `Workflow listeners: Redis is not connected, so the workflows changed in ${projects.length} project(s) are heard by their writes within ${this.TRIGGERS_TTL_SECONDS} seconds.`,
      );
      return;
    }

    await Promise.all(
      projects.map(async (project: string): Promise<void> => {
        try {
          await GlobalCache.setString(
            this.NAMESPACE,
            generationKey(project),
            CacheGenerations.newToken(),
            { expiresInSeconds: this.GENERATION_TTL_SECONDS },
          );
        } catch (error) {
          logger.error(
            `Workflow listeners: could not say a project's workflows changed; its writes hear the change within ${this.TRIGGERS_TTL_SECONDS} seconds: ${error}`,
          );
        }
      }),
    );
  }

  // A create of `tableName` is done: a workflow's starts a new generation of its project.
  public static async afterCreate(data: {
    tableName: string | null | undefined;
    row: unknown;
  }): Promise<void> {
    if (data.tableName !== this.TABLE_NAME) {
      return;
    }

    await this.changed([projectIdOf(data.row)]);
  }

  // An update of `tableName` is done: the rows it wrote, as read before it.
  public static async afterUpdate(data: {
    tableName: string | null | undefined;
    rows: Array<unknown>;
  }): Promise<void> {
    if (data.tableName !== this.TABLE_NAME || data.rows.length === 0) {
      return;
    }

    await this.changed(data.rows.map(projectIdOf));
  }

  // A delete of `tableName` is done: the rows it deleted.
  public static async afterDelete(data: {
    tableName: string | null | undefined;
    rows: Array<unknown>;
  }): Promise<void> {
    if (data.tableName !== this.TABLE_NAME || data.rows.length === 0) {
      return;
    }

    await this.changed(data.rows.map(projectIdOf));
  }

  // Drops what this process keeps. For tests.
  public static clear(): void {
    this.reading.clear();
  }

  /*
   * The project's triggers from the database, read once at a time per
   * project and generation in this process however many writes ask at once.
   */
  private static async readOnce(
    projectId: ObjectID,
    generation: string,
  ): Promise<Array<string> | null> {
    const key: string = `${projectId.toString().toLowerCase()}:${generation}`;
    let read: Promise<Array<string> | null> | undefined = this.reading.get(key);

    if (!read) {
      const started: Promise<Array<string> | null> = this.readFromDatabase(
        projectId,
      ).finally(() => {
        if (this.reading.get(key) === started) {
          this.reading.delete(key);
        }
      });

      this.reading.set(key, started);
      read = started;
    }

    return await read;
  }

  private static async readFromDatabase(
    projectId: ObjectID,
  ): Promise<Array<string> | null> {
    try {
      if (!PostgresAppInstance.isConnected()) {
        return null;
      }

      const dataSource: DataSource | null = PostgresAppInstance.getDataSource();

      if (!dataSource) {
        return null;
      }

      const rows: unknown = await dataSource.query(
        WORKFLOW_LISTENER_TRIGGERS_SQL,
        [projectId.toString(), LIMIT_MAX + 1],
      );

      if (!Array.isArray(rows) || rows.length > LIMIT_MAX) {
        return null;
      }

      return rows
        .map((row: { triggerId?: unknown }): string => {
          return typeof row?.triggerId === "string" ? row.triggerId : "";
        })
        .filter((triggerId: string): boolean => {
          return triggerId.length > 0;
        });
    } catch (error) {
      logger.error(
        `Workflow listeners: could not read which triggers a project's workflows listen to; posting its events: ${error}`,
      );
      return null;
    }
  }
}

function generationKey(project: string): string {
  return `generation:${project}`;
}

function triggersKey(project: string): string {
  return `triggers:${project}`;
}

// The triggers kept, when they were kept under `generation`; null otherwise.
function readKept(
  kept: string | null,
  generation: string,
): Array<string> | null {
  if (!kept) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(kept);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as KeptTriggers).generation !== generation ||
      !Array.isArray((parsed as KeptTriggers).triggerIds)
    ) {
      return null;
    }

    return (parsed as KeptTriggers).triggerIds.filter(
      (triggerId: unknown): triggerId is string => {
        return typeof triggerId === "string";
      },
    );
  } catch {
    return null;
  }
}

// A workflow row's project, as a write handed it.
function projectIdOf(row: unknown): ObjectID | string | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const projectId: unknown = (row as Record<string, unknown>)["projectId"];

  if (projectId instanceof ObjectID || typeof projectId === "string") {
    return projectId;
  }

  return null;
}
