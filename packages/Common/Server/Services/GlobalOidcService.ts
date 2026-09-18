import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/GlobalOidc";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import {
  GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
  GlobalProviderTrust,
  clearGlobalSsoAuthorizationCaches,
  globalProviderCacheKey,
  globalSsoProviderTrustCache,
  loadTrustOnce,
} from "../Utils/GlobalSsoAuthorization";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * What the SSO-enforcement middleware needs to know about this provider:
   * whether it is still usable at all, and whether the admin opted it into
   * attachment-scoped access.
   *
   * Called on every authenticated request against an SSO-enforced project, so
   * the answer is cached for 60s and concurrent misses share one query.
   * Without this lookup, turning a provider off leaves every token it ever
   * issued working until each one expires - up to thirty days.
   */
  @CaptureSpan()
  public async getProviderTrust(
    providerId: ObjectID,
  ): Promise<GlobalProviderTrust> {
    const key: string = globalProviderCacheKey("oidc", providerId);

    const cached: GlobalProviderTrust | undefined =
      globalSsoProviderTrustCache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    return loadTrustOnce(key, async (): Promise<GlobalProviderTrust> => {
      const provider: Model | null = await this.findOneBy({
        query: { _id: providerId.toString() },
        select: {
          _id: true,
          isEnabled: true,
          restrictToAttachedProjects: true,
        },
        props: { isRoot: true },
      });

      /*
       * A deleted provider and a disabled one are the same answer: no. Both
       * are cached, so a revoked provider does not cost a query per request.
       */
      const trust: GlobalProviderTrust = {
        isUsable: Boolean(provider && provider.isEnabled),
        restrictToAttachedProjects: Boolean(
          provider && provider.restrictToAttachedProjects,
        ),
      };

      globalSsoProviderTrustCache.set(
        key,
        trust,
        GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
      );

      return trust;
    });
  }

  /*
   * Cache invalidation runs in the SUCCESS hooks, not the before-hooks: a
   * clear that happens before the row is written can be immediately re-filled
   * with the pre-change answer by a concurrent request, which would hand a
   * disabled provider another full TTL of life on the very node that served
   * the disable. Clearing in both is deliberate - the before-hook narrows the
   * window, the success hook closes it.
   *
   * These caches are per-process, so the hooks make a change immediate on the
   * node that served it and the TTL bounds every other node.
   */

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    clearGlobalSsoAuthorizationCaches();
    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    clearGlobalSsoAuthorizationCaches();
    return onUpdate;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    clearGlobalSsoAuthorizationCaches();
    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    clearGlobalSsoAuthorizationCaches();
    return onDelete;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    clearGlobalSsoAuthorizationCaches();
    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    clearGlobalSsoAuthorizationCaches();
    return createdItem;
  }
}

export default new Service();
