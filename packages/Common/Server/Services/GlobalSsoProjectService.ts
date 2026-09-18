import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/GlobalSsoProject";
import Team from "../../Models/DatabaseModels/Team";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import validateGlobalProviderProjectTeams, {
  resolveAttachmentProjectId,
} from "../Utils/ValidateGlobalProviderProjectTeams";
import {
  GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
  GlobalProviderAttachments,
  clearGlobalSsoAuthorizationCaches,
  doAttachmentsGovernProject,
  globalProviderCacheKey,
  globalSsoAttachmentsCache,
  loadAttachmentsOnce,
} from "../Utils/GlobalSsoAuthorization";
import DeleteBy from "../Types/Database/DeleteBy";

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
    globalSsoId: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> {
    const key: string = globalProviderCacheKey("sso", data.globalSsoId);

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
          query: { globalSsoId: data.globalSsoId },
          select: { _id: true, projectId: true, isEnabled: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

        const loaded: GlobalProviderAttachments = {
          hasAnyAttachmentRows: rows.length > 0,
          enabledProjectIds: rows
            .filter((row: Model) => {
              return Boolean(row.isEnabled) && Boolean(row.projectId);
            })
            .map((row: Model) => {
              return row.projectId!.toString();
            }),
        };

        globalSsoAttachmentsCache.set(
          key,
          loaded,
          GLOBAL_SSO_AUTHORIZATION_CACHE_TTL_MS,
        );

        return loaded;
      },
    );

    return doAttachmentsGovernProject(attachments, data.projectId);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // Detaching a project has to take effect now, not in 60s, on this node.
    clearGlobalSsoAuthorizationCaches();
    return { deleteBy, carryForward: null };
  }

  /*
   * Cleared again AFTER the write commits. A clear that runs before the row
   * lands can be immediately re-filled with the pre-change answer by a
   * concurrent request, handing the old attachment set another full TTL.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    clearGlobalSsoAuthorizationCaches();
    return onDelete;
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    clearGlobalSsoAuthorizationCaches();
    return createdItem;
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
      createBy.data.projectId = projectId;
    }

    await validateGlobalProviderProjectTeams({
      teams: createBy.data.teams,
      projectId,
    });

    // A new attachment narrows (or widens) which projects the provider governs.
    clearGlobalSsoAuthorizationCaches();

    return { createBy, carryForward: null };
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
      const explicitProjectId: ObjectID | undefined = updateBy.data
        .projectId as unknown as ObjectID | undefined;

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
}

export default new Service();
