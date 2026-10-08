import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/GlobalOidc";
import ObjectID from "../../Types/ObjectID";
import { fillOidcProviderDefaults } from "../../Types/SSO/OidcProviderDefaults";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Exception from "../../Types/Exception/Exception";
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

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    clearGlobalSsoAuthorizationCaches();

    return { updateBy, carryForward: null };
  }

  /*
   * Once every permission check has passed: turning the provider off, or
   * restricting it to its attached projects, is refused when it would leave
   * a project that requires SSO with no provider to sign in with, and holds
   * the lock on the server's sign-in rules until it is written or fails
   * (Utils/GlobalSsoProviderChanges). Turning it off writes when, in the
   * same write: the sign-ins it gave end.
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await GlobalSsoProviderChanges.beforeProviderUpdate<Model>({
      providerType: SsoProviderType.GlobalOIDC,
      service: this,
      updateBy: updateBy,
    });

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
    // Written: the lock is given back before anything else.
    const changedReach: boolean = await GlobalSsoProviderChanges.afterWrite(
      onUpdate.updateBy,
    );

    clearGlobalSsoAuthorizationCaches();

    /*
     * Turned off or on, restricted to its attached projects or opened to
     * every project again: every server forgets what it knew of the
     * provider, once. The sign-ins it gave stop counting where it no longer
     * signs people in, and the live updates already open are asked again;
     * people it now signs in are let in at once, not when another server's
     * cached answer runs out.
     *
     * A write that turns it off or restricts it is told whatever was read
     * under the lock: one that turns it on or lifts the restriction takes
     * no lock, and may have been written between that read and this write.
     * One that turns it on or opens it, written back as it was - an edit
     * form sends every field it shows - changed nothing, and tells no
     * server.
     */
    if (
      updatedItemIds.length > 0 &&
      (changedReach || isGlobalProviderNarrowing(onUpdate.updateBy.data))
    ) {
      announceGlobalSignInChange();
    }

    return onUpdate;
  }

  /*
   * Failed, or refused, once its hooks ran: the lock it held is given back -
   * or, when the database may still apply the write, kept until it would
   * have cancelled it (GlobalSsoProviderChanges.afterFailedWrite).
   */
  @CaptureSpan()
  protected override async onUpdateError(
    error: Exception,
    onUpdate?: OnUpdate<Model> | undefined,
  ): Promise<Exception> {
    if (onUpdate) {
      await GlobalSsoProviderChanges.afterFailedWrite(onUpdate.updateBy, error);
    }

    return error;
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
    // Deleted: the lock is given back before anything else.
    await GlobalSsoProviderChanges.afterWrite(onDelete.deleteBy);

    clearGlobalSsoAuthorizationCaches();

    // A deleted provider vouches for nobody: asked again on every server.
    if (itemIdsBeforeDelete.length > 0) {
      announceGlobalSignInChange();
    }

    return onDelete;
  }

  /*
   * Failed, or refused, once its hooks ran: the lock it held is given back -
   * or, when the database may still apply the write, kept until it would
   * have cancelled it (GlobalSsoProviderChanges.afterFailedWrite).
   */
  @CaptureSpan()
  protected override async onDeleteError(
    error: Exception,
    onDelete?: OnDelete<Model> | undefined,
  ): Promise<Exception> {
    if (onDelete) {
      await GlobalSsoProviderChanges.afterFailedWrite(onDelete.deleteBy, error);
    }

    return error;
  }

  /*
   * A hard delete (the retention job's purge) runs no onDeleteSuccess: the
   * lock its check took is given back here, and every server is told only
   * when it changed where a provider signs people in, as read under the
   * lock (GlobalSsoProviderChanges.afterHardDelete). A purge of rows
   * deleted long ago tells no server anything.
   */
  @CaptureSpan()
  protected override async onHardDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    if (
      await GlobalSsoProviderChanges.afterHardDelete(
        onDelete.deleteBy,
        itemIdsBeforeDelete,
      )
    ) {
      clearGlobalSsoAuthorizationCaches();
      announceGlobalSignInChange();
    }

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
