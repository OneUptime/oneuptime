import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/GlobalOidc";
import ObjectID from "../../Types/ObjectID";
import { fillOidcProviderDefaults } from "../../Types/SSO/OidcProviderDefaults";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import {
  GlobalProviderTrust,
  announceGlobalSignInChange,
  clearGlobalSsoAuthorizationCaches,
  isGlobalProviderNarrowing,
  globalProviderCacheKey,
  globalSsoProviderTrustCache,
  loadTrustOnce,
} from "../Utils/GlobalSsoAuthorization";
import GlobalSsoProviderChanges from "../Utils/GlobalSsoProviderChanges";
import SsoSignInsEnded from "../Utils/SsoSignInsEnded";
import SsoProviderType from "../../Types/SSO/SsoProviderType";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * What the SSO-enforcement middleware needs to know about this provider:
   * whether it is still usable at all, whether the admin opted it into
   * attachment-scoped access, and when it was last turned off - a sign-in
   * it gave before then no longer counts (Utils/SsoSignInsEnded).
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
          signInsEndedAt: true,
        },
        props: { isRoot: true },
      });

      /*
       * A deleted provider and a disabled one are the same answer: no. Both
       * are cached (loadTrustOnce), so a revoked provider does not cost a
       * query per request.
       */
      return {
        isUsable: Boolean(provider && provider.isEnabled),
        restrictToAttachedProjects: Boolean(
          provider && provider.restrictToAttachedProjects,
        ),
        signInsEndedAtMs: SsoSignInsEnded.toSignInsEndedAtMs(
          provider?.signInsEndedAt,
        ),
      };
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

  /*
   * Turning the provider off, or restricting it to its attached projects,
   * is refused when it would leave a project that requires SSO with no
   * provider to sign in with, and holds the lock on the server's sign-in
   * rules until it is written (Utils/GlobalSsoProviderChanges).
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    clearGlobalSsoAuthorizationCaches();

    await GlobalSsoProviderChanges.beforeProviderUpdate<Model>({
      providerType: SsoProviderType.GlobalOIDC,
      service: this,
      updateBy: updateBy,
    });

    return { updateBy, carryForward: null };
  }

  // Turning the provider off writes when, in the same write: the sign-ins it gave end.
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await GlobalSsoProviderChanges.beforeProviderWrite<Model>({
      service: this,
      updateBy: updateBy,
    });
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    clearGlobalSsoAuthorizationCaches();

    /*
     * Turned off, or restricted to its attached projects: the sign-ins it
     * gave stop counting where it no longer signs people in, and the live
     * updates already open are asked again on every server.
     */
    if (
      updatedItemIds.length > 0 &&
      isGlobalProviderNarrowing(onUpdate.updateBy.data)
    ) {
      announceGlobalSignInChange();
    }

    await GlobalSsoProviderChanges.afterWrite(onUpdate.updateBy);

    return onUpdate;
  }

  /*
   * Deleting the provider is refused when it would leave a project that
   * requires SSO with no provider to sign in with
   * (Utils/GlobalSsoProviderChanges).
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    clearGlobalSsoAuthorizationCaches();

    await GlobalSsoProviderChanges.beforeProviderDelete<Model>({
      providerType: SsoProviderType.GlobalOIDC,
      service: this,
      deleteBy: deleteBy,
    });

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    clearGlobalSsoAuthorizationCaches();

    // A deleted provider vouches for nobody: asked again on every server.
    if (itemIdsBeforeDelete.length > 0) {
      announceGlobalSignInChange();
    }

    await GlobalSsoProviderChanges.afterWrite(onDelete.deleteBy);

    return onDelete;
  }

  /*
   * A provider created without a discovery URL, scopes, claim names or a
   * description gets the usual ones (Types/SSO/OidcProviderDefaults), before
   * the required-field check runs: the columns stay required, so the API and
   * Terraform keep their contract, and a caller may leave them out. What the
   * caller sent is kept.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    fillOidcProviderDefaults(createBy.data);

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
