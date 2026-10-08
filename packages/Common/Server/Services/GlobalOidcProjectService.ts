import DatabaseService from "./DatabaseService";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Model from "../../Models/DatabaseModels/GlobalOidcProject";
import Team from "../../Models/DatabaseModels/Team";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import GlobalOidcService from "./GlobalOidcService";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import validateGlobalProviderProjectTeams, {
  resolveAttachmentProjectId,
} from "../Utils/ValidateGlobalProviderProjectTeams";
import {
  GlobalProviderAttachments,
  GlobalProviderTrust,
  announceGlobalSignInChange,
  clearGlobalSsoAuthorizationCaches,
  isAnyAttachedProviderRestricted,
  isGlobalProviderNarrowing,
  doAttachmentsGovernProject,
  globalProviderCacheKey,
  globalSsoAttachmentsCache,
  loadAttachmentsOnce,
} from "../Utils/GlobalSsoAuthorization";
import DeleteBy from "../Types/Database/DeleteBy";
import GlobalSsoProviderChanges from "../Utils/GlobalSsoProviderChanges";
import Exception from "../../Types/Exception/Exception";
import SsoProviderType from "../../Types/SSO/SsoProviderType";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Whether this provider's attachments cover `projectId`.
   *
   * Only consulted when the provider has `restrictToAttachedProjects` on -
   * attachments are the PROVISIONING allow-list by default, not an access
   * boundary, and reading them as one without the admin asking would lock
   * existing users out of projects they legitimately reach.
   *
   * "No attachment rows at all" means instance-wide, matching the login
   * router's default-all mode. "Rows exist but none are enabled" is a
   * different answer and denies - otherwise an admin disabling the last
   * attachment would WIDEN the provider to every project.
   *
   * Cached for 60s, with concurrent misses sharing one query.
   */
  @CaptureSpan()
  public async doesProviderGovernProject(data: {
    globalOidcId: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> {
    const key: string = globalProviderCacheKey("oidc", data.globalOidcId);

    const cached: GlobalProviderAttachments | undefined =
      globalSsoAttachmentsCache.get(key);

    if (cached !== undefined) {
      return doAttachmentsGovernProject(cached, data.projectId);
    }

    const attachments: GlobalProviderAttachments = await loadAttachmentsOnce(
      key,
      async (): Promise<GlobalProviderAttachments> => {
        /*
         * Fetched WITHOUT the isEnabled filter so a disabled row still counts
         * as "this provider has attachments"; the enabled ones are selected
         * out below.
         */
        const rows: Array<Model> = await this.findBy({
          query: { globalOidcId: data.globalOidcId },
          select: { _id: true, projectId: true, isEnabled: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

        // Cached by loadAttachmentsOnce, unless the answers were dropped while it ran.
        return {
          hasAnyAttachmentRows: rows.length > 0,
          enabledProjectIds: rows
            .filter((row: Model) => {
              return Boolean(row.isEnabled) && Boolean(row.projectId);
            })
            .map((row: Model) => {
              return row.projectId!.toString();
            }),
        };
      },
    );

    return doAttachmentsGovernProject(attachments, data.projectId);
  }

  /*
   * Removing an attachment of a provider restricted to its attached
   * projects is refused when it would leave a project that requires SSO
   * with no provider to sign in with (Utils/GlobalSsoProviderChanges).
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // Detaching a project has to take effect now, not in 60s, on this node.
    clearGlobalSsoAuthorizationCaches();

    await GlobalSsoProviderChanges.beforeAttachmentDelete<Model>({
      providerType: SsoProviderType.GlobalOIDC,
      service: this,
      deleteBy: deleteBy,
    });

    /*
     * Their providers, read under the lock, while the rows are still there.
     * The read never throws - a provider it cannot tell counts as one its
     * attachments decide - so nothing after the lock here can fail and keep
     * it.
     */
    return {
      deleteBy,
      carryForward: await this.readProviderIds(deleteBy.query),
    };
  }

  /*
   * Cleared again AFTER the write commits. A clear that runs before the row
   * lands can be immediately re-filled with the pre-change answer by a
   * concurrent request, handing the old attachment set another full TTL.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    // Removed: the lock is given back before anything else.
    const changedReach: boolean = await GlobalSsoProviderChanges.afterWrite(
      onDelete.deleteBy,
    );

    clearGlobalSsoAuthorizationCaches();

    /*
     * A provider restricted to its attached projects no longer signs people
     * in to this one - or, its last attachment gone, signs people in to
     * every project again: asked again on every server.
     */
    if (
      itemIdsBeforeDelete.length > 0 &&
      (changedReach ||
        (await this.isAnyProviderRestricted(
          (onDelete.carryForward as Array<ObjectID | null> | null) || [null],
        )))
    ) {
      announceGlobalSignInChange();
    }

    return onDelete;
  }

  // Failed, or refused, once its hooks ran: the lock it held is given back.
  @CaptureSpan()
  protected override async onDeleteError(
    error: Exception,
    onDelete?: OnDelete<Model> | undefined,
  ): Promise<Exception> {
    if (onDelete) {
      await GlobalSsoProviderChanges.afterWrite(onDelete.deleteBy);
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
   * An attachment is checked, under the lock on the server's sign-in rules,
   * once every permission and clash check has passed (onCreatePermitted).
   * The lock is given back once it is written (onCreateSuccess), and here
   * whatever happened after the check: a create that fails at the INSERT,
   * or in a step just before it, runs no other hook.
   */
  @CaptureSpan()
  public override async create(createBy: CreateBy<Model>): Promise<Model> {
    try {
      return await super.create(createBy);
    } finally {
      await GlobalSsoProviderChanges.afterWrite(createBy);
    }
  }

  /*
   * The first attachment of a provider restricted to its attached projects
   * narrows it from every project to that one: asked again on every server.
   * A provider that is not restricted signs people in to every project
   * whatever its attachments, so attaching one changes nothing there.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // Written: the lock is given back before anything else.
    const changedReach: boolean = await GlobalSsoProviderChanges.afterWrite(
      onCreate.createBy,
    );

    clearGlobalSsoAuthorizationCaches();

    if (
      changedReach ||
      (await this.isAnyProviderRestricted([this.readProviderIdOf(createdItem)]))
    ) {
      announceGlobalSignInChange();
    }

    return createdItem;
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
     * An attachment turned off or on, or moved to another project or
     * provider, where that changes where its provider signs people in - only
     * for a provider restricted to its attached projects: as removing it, or
     * as adding it. The people it lets in are let in at once on every
     * server.
     *
     * One turned off is told for a provider restricted to its attached
     * projects whatever was read under the lock: turning one on takes no
     * lock, and may have been written between that read and this write. One
     * turned on again while on changed nothing, and tells no server.
     */
    if (
      updatedItemIds.length > 0 &&
      (changedReach ||
        (isGlobalProviderNarrowing(onUpdate.updateBy.data) &&
          (await this.isAnyProviderRestricted(
            await this.readProviderIds({
              _id: QueryHelper.any(updatedItemIds),
            } as Query<Model>),
          ))))
    ) {
      announceGlobalSignInChange();
    }

    return onUpdate;
  }

  // Failed, or refused, once its hooks ran: the lock it held is given back.
  @CaptureSpan()
  protected override async onUpdateError(
    error: Exception,
    onUpdate?: OnUpdate<Model> | undefined,
  ): Promise<Exception> {
    if (onUpdate) {
      await GlobalSsoProviderChanges.afterWrite(onUpdate.updateBy);
    }

    return error;
  }

  /*
   * Whether any of these providers is on and restricted to its attached
   * projects, the only kind whose attachments decide who it signs in
   * (Utils/GlobalSsoAuthorization). One that cannot be told (null) counts.
   */
  private async isAnyProviderRestricted(
    providerIds: Array<ObjectID | null>,
  ): Promise<boolean> {
    return await isAnyAttachedProviderRestricted({
      providerIds: providerIds,
      getProviderTrust: (
        providerId: ObjectID,
      ): Promise<GlobalProviderTrust> => {
        return GlobalOidcService.getProviderTrust(providerId);
      },
    });
  }

  // The providers of the attachments `query` names; a failed read cannot tell.
  private async readProviderIds(
    query: Query<Model>,
  ): Promise<Array<ObjectID | null>> {
    try {
      const rows: Array<Model> = await this.findBy({
        query: query,
        select: { _id: true, globalOidcId: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

      return rows.map((row: Model): ObjectID | null => {
        return row.globalOidcId || null;
      });
    } catch {
      return [null];
    }
  }

  // The provider a new attachment names, under either of its names.
  private readProviderIdOf(attachment: Model): ObjectID | null {
    try {
      return RelationIdUtil.readConsistent(
        attachment as unknown as Record<string, unknown>,
        ["globalOidcId", "globalOidc"],
        "Global OIDC",
      );
    } catch {
      return null;
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * The attach form submits the project via the `project` relation, so the
     * `projectId` FK is not set yet. Resolve it and persist it (the column is
     * required / NOT NULL) before validating the default teams against it.
     */
    const projectId: ObjectID | undefined = resolveAttachmentProjectId(
      createBy.data,
    );

    if (projectId) {
      RelationIdUtil.stamp(
        createBy.data as unknown as Record<string, unknown>,
        ["projectId", "project"],
        projectId,
      );
    }

    await validateGlobalProviderProjectTeams({
      teams: createBy.data.teams,
      projectId,
    });

    // A new attachment narrows (or widens) which projects the provider governs.
    clearGlobalSsoAuthorizationCaches();

    return { createBy, carryForward: null };
  }

  /*
   * Once every permission and clash check has passed: the first attachment
   * of a provider restricted to its attached projects narrows it from every
   * project to this one, refused when that would leave a project that
   * requires SSO with no provider to sign in with
   * (Utils/GlobalSsoProviderChanges). The lock it holds is given back once
   * the attachment is written, or the create fails (create).
   */
  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    await GlobalSsoProviderChanges.beforeAttachmentCreate({
      providerType: SsoProviderType.GlobalOIDC,
      createBy: onCreate.createBy as unknown as CreateBy<BaseModel>,
    });
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // `updateBy.data` is a partial-entity shape; narrow the relation/id here.
    const teams: Array<Team> | undefined = updateBy.data.teams as unknown as
      | Array<Team>
      | undefined;

    if (teams && teams.length > 0) {
      // A project the update names, under either of its names.
      const explicitProjectId: ObjectID | null = RelationIdUtil.readConsistent(
        updateBy.data as unknown as Record<string, unknown>,
        ["projectId", "project"],
        "Project",
      );

      if (explicitProjectId) {
        await validateGlobalProviderProjectTeams({
          teams,
          projectId: explicitProjectId,
        });
      } else {
        // projectId is immutable here; resolve it from the row(s) being updated.
        const rows: Array<Model> = await this.findBy({
          query: updateBy.query,
          select: { _id: true, projectId: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

        for (const row of rows) {
          await validateGlobalProviderProjectTeams({
            teams,
            projectId: row.projectId,
          });
        }
      }
    }

    clearGlobalSsoAuthorizationCaches();

    return { updateBy, carryForward: null };
  }

  /*
   * Once every permission check has passed: turning an attachment off, or
   * moving it to another project or provider, is refused when it would
   * leave a project that requires SSO with no provider to sign in with, and
   * holds the lock on the server's sign-in rules until it is written or
   * fails (Utils/GlobalSsoProviderChanges).
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await GlobalSsoProviderChanges.beforeAttachmentUpdate<Model>({
      providerType: SsoProviderType.GlobalOIDC,
      service: this,
      updateBy: updateBy,
    });
  }
}

export default new Service();
