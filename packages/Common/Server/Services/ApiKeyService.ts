import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import Model from "../../Models/DatabaseModels/ApiKey";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";

/*
 * 60s is the worst-case staleness on any single API node after a key is
 * revoked from the dashboard. We invalidate in-process immediately on
 * delete/update; this TTL is the upper bound for *other* processes.
 */
const POSITIVE_TTL_MS: number = 60 * 1000;
/*
 * Short TTL on misses so an invalid-key flood can't pin entries in the
 * bounded cache for long while still absorbing repeat hits.
 */
const NEGATIVE_TTL_MS: number = 10 * 1000;

interface CachedApiKey {
  id: string;
  projectId: string;
  name: string | null;
}

export interface ResolvedApiKey {
  id: ObjectID;
  projectId: ObjectID;

  /*
   * The key's display name, for the audit trail: "which key did this" is
   * answered by a name an administrator recognises, not by an id. Never part
   * of an authorization decision. Up to a minute stale on other nodes after
   * a rename, like everything else this cache holds.
   */
  name?: string | undefined;
}

export class Service extends DatabaseService<Model> {
  /*
   * Cache of `apiKey -> { id, projectId, name }`. The project-auth middleware
   * hits this on every API-key-authenticated request; without it that's a
   * Postgres findOneBy per request for automated callers.
   */
  private apiKeyCache: InMemoryTTLCache<CachedApiKey | null> =
    new InMemoryTTLCache(10_000);

  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    createBy.data.apiKey = ObjectID.generate();
    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * We don't know which keys are being updated without a query; updates
     * are rare so clearing is cheap.
     */
    this.apiKeyCache.clear();
    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    this.apiKeyCache.clear();
    return { deleteBy, carryForward: null };
  }

  /**
   * Resolves an API key string to its row, with a short-lived in-process
   * cache. Returns null for unknown or expired keys (also cached, for a
   * shorter TTL). Use this from the auth middleware hot path instead of
   * calling `findOneBy` directly.
   */
  @CaptureSpan()
  public async findApiKey(apiKey: ObjectID): Promise<ResolvedApiKey | null> {
    const cacheKey: string = apiKey.toString();
    const cached: CachedApiKey | null | undefined =
      this.apiKeyCache.get(cacheKey);
    if (cached !== undefined) {
      if (cached === null) {
        return null;
      }
      return {
        id: new ObjectID(cached.id),
        projectId: new ObjectID(cached.projectId),
        ...(cached.name ? { name: cached.name } : {}),
      };
    }

    const row: Model | null = await this.findOneBy({
      query: {
        apiKey: apiKey,
        expiresAt: QueryHelper.greaterThan(OneUptimeDate.getCurrentDate()),
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
      },
      props: { isRoot: true },
    });

    if (!row || !row.id || !row.projectId) {
      this.apiKeyCache.set(cacheKey, null, NEGATIVE_TTL_MS);
      return null;
    }

    const name: string | null = row.name ? row.name.toString() : null;

    this.apiKeyCache.set(
      cacheKey,
      {
        id: row.id.toString(),
        projectId: row.projectId.toString(),
        name,
      },
      POSITIVE_TTL_MS,
    );
    return {
      id: row.id,
      projectId: row.projectId,
      ...(name ? { name } : {}),
    };
  }
}

export default new Service();
