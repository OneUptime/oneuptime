import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import Model from "../../Models/DatabaseModels/TelemetryIngestionKey";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import { createHash } from "crypto";

/*
 * 60s is the worst-case staleness on any single API node after a key is
 * revoked from the dashboard. We invalidate in-process immediately on
 * delete/update; this TTL is the upper bound for *other* processes.
 */
const POSITIVE_TTL_MS: number = 60 * 1000;
/*
 * Short TTL on misses so an invalid-token flood can't pin entries in the
 * bounded cache for long while still absorbing repeat hits.
 */
const NEGATIVE_TTL_MS: number = 10 * 1000;

export class Service extends DatabaseService<Model> {
  private projectIdCache: InMemoryTTLCache<string | null> =
    new InMemoryTTLCache(10_000);

  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.secretKey) {
      createBy.data.secretKey = ObjectID.generate();
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * We don't know which secretKey(s) are being deleted without an extra
     * query; clear the whole cache. Key deletes are rare so this is cheap.
     */
    this.projectIdCache.clear();
    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Same reasoning as onBeforeDelete. secretKey is not user-editable today
     * but projectId could change, so be conservative.
     */
    this.projectIdCache.clear();
    return { updateBy, carryForward: null };
  }

  /**
   * Resolve an ingestion token to its projectId, with a short-lived
   * in-process cache to keep the hot ingest path off Postgres. Returns null
   * for unknown, malformed, or revoked tokens (also cached, for a shorter
   * TTL).
   */
  @CaptureSpan()
  public async getProjectIdFromSecretKey(
    secretKey: string,
  ): Promise<ObjectID | null> {
    const cacheKey: string = createHash("sha256")
      .update(secretKey)
      .digest("hex");

    const cached: string | null | undefined = this.projectIdCache.get(cacheKey);
    if (cached !== undefined) {
      return cached === null ? null : new ObjectID(cached);
    }

    let secretKeyObjectId: ObjectID;
    try {
      secretKeyObjectId = new ObjectID(secretKey);
    } catch {
      this.projectIdCache.set(cacheKey, null, NEGATIVE_TTL_MS);
      return null;
    }

    const token: Model | null = await this.findOneBy({
      query: { secretKey: secretKeyObjectId },
      select: { projectId: true },
      props: { isRoot: true },
    });

    const projectId: ObjectID | undefined = token?.projectId as
      | ObjectID
      | undefined;

    if (!projectId) {
      this.projectIdCache.set(cacheKey, null, NEGATIVE_TTL_MS);
      return null;
    }

    this.projectIdCache.set(cacheKey, projectId.toString(), POSITIVE_TTL_MS);
    return projectId;
  }
}

export default new Service();
