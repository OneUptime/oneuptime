import CacheGenerations from "../../Infrastructure/CacheGenerations";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import Redis from "../../Infrastructure/Redis";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";

/*
 * A project's incident states or alert states, as OneUptime reads them
 * (isRoot), kept in each process - and a change to the list seen at once.
 *
 * Every monitor result that meets a criteria asks which of the project's
 * states are open (IncidentStateService.getUnresolvedIncidentStateIds and
 * its alert twin), and every auto-resolve which state is Resolved: a read of
 * the whole list each time, twice a result, for a list that changes when
 * someone edits the project's states - a handful of times in its life. On a
 * large install that was two statements of every result for nothing.
 *
 * Each process keeps the list it read under the generation its project had
 * when the read began (CacheGenerations, as StatusPageOverviewCache and
 * OnCallCalendarFeedCache keep theirs), and every create, update and delete
 * of a state starts a new generation of its project (forgetProjects, from the
 * state service's hooks): at once in the process that made it, within
 * CacheGenerations.SHARED_READ_TTL_MS everywhere else. An entry also runs
 * out after ENTRY_TTL_MS, so a write that went round the hooks - a data
 * migration, a repair by hand - is seen within minutes all the same.
 *
 * Nothing is kept while Redis is not connected: a change made in another
 * process could not be seen here, so the list is read every time, as before.
 *
 * Callers get copies: the states handed out are new instances every time,
 * so no caller can change what the next one reads.
 */
export default class ProjectStateListCache<TState extends BaseModel> {
  // How long an entry is kept at most, whatever its generation says.
  public static readonly ENTRY_TTL_MS: number = 5 * 60 * 1000;

  // How long a project's generation is kept, many times an entry's life.
  public static readonly GENERATION_TTL_SECONDS: number = 24 * 60 * 60;

  private readonly generations: CacheGenerations;

  // The project's states as read, by `<projectId>:<generation>`.
  private readonly entries: InMemoryTTLCache<Promise<Array<TState>>>;

  private readonly modelType: { new (): TState };

  // The columns copied onto each state handed out.
  private readonly columns: Array<string>;

  public constructor(options: {
    // The Redis namespace the generations are kept under.
    namespace: string;
    // What the list is of, for the log.
    description: string;
    modelType: { new (): TState };
    columns: Array<string>;
    maxProjects?: number | undefined;
  }) {
    this.modelType = options.modelType;
    this.columns = options.columns;

    this.generations = new CacheGenerations({
      namespace: options.namespace,
      ttlSeconds: ProjectStateListCache.GENERATION_TTL_SECONDS,
      maxKeys: options.maxProjects,
      description: options.description,
    });

    this.entries = new InMemoryTTLCache<Promise<Array<TState>>>(
      options.maxProjects || 10_000,
    );
  }

  /*
   * The project's states: as kept, while its generation stands, or read
   * with `read` (once for all the callers that ask together).
   */
  public async getStates(
    projectId: ObjectID,
    read: () => Promise<Array<TState>>,
  ): Promise<Array<TState>> {
    if (!Redis.isConnected()) {
      return await read();
    }

    const generation: string = await this.generations.get(projectId.toString());

    const key: string = `${projectId.toString()}:${generation}`;

    let states: Promise<Array<TState>> | undefined = this.entries.get(key);

    if (!states) {
      states = read();
      this.entries.set(key, states, ProjectStateListCache.ENTRY_TTL_MS);

      // A read that failed is not kept: the next caller reads again.
      states.catch((): void => {
        if (this.entries.get(key) === states) {
          this.entries.delete(key);
        }
      });
    }

    return (await states).map((state: TState) => {
      return this.copy(state);
    });
  }

  /*
   * Starts a new generation of each project's list: nothing read before is
   * handed out again. Never throws.
   */
  public async forgetProjects(
    projectIds: Array<ObjectID | string | null | undefined>,
  ): Promise<void> {
    const keys: Array<string> = projectIds
      .filter((projectId: ObjectID | string | null | undefined) => {
        return Boolean(projectId?.toString());
      })
      .map((projectId: ObjectID | string | null | undefined) => {
        return projectId!.toString();
      });

    if (keys.length === 0) {
      return;
    }

    try {
      await this.generations.bump(keys);
    } catch (err) {
      // CacheGenerations does not throw; this is only ever a safety net.
      logger.error(err);
    }
  }

  // Drops everything this process keeps. For tests.
  public clear(): void {
    this.generations.clear();
    this.entries.clear();
  }

  private copy(state: TState): TState {
    const copy: TState = new this.modelType();

    for (const column of this.columns) {
      (copy as unknown as Record<string, unknown>)[column] = (
        state as unknown as Record<string, unknown>
      )[column];
    }

    return copy;
  }
}
