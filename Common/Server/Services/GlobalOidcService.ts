import DatabaseService from "./DatabaseService";
import GlobalOidcProjectService from "./GlobalOidcProjectService";
import Model from "../../Models/DatabaseModels/GlobalOidc";
import GlobalOidcProject from "../../Models/DatabaseModels/GlobalOidcProject";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import { OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import syncGlobalProviderForce from "../Utils/GlobalProviderForce";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Reconcile this provider's "Force SSO for Login" setting onto all of its
   * attached projects. Reads the current force flag and the current set of
   * enabled attachments, then applies/clears the per-project enforcement.
   */
  @CaptureSpan()
  public async syncForceForProvider(providerId: ObjectID): Promise<void> {
    const provider: Model | null = await this.findOneById({
      id: providerId,
      select: { requireSsoForLogin: true },
      props: { isRoot: true },
    });

    if (!provider) {
      // Provider no longer exists: clear any pins that still point at it.
      await syncGlobalProviderForce({
        providerId,
        force: false,
        attachedProjectIds: [],
      });
      return;
    }

    const attachments: Array<GlobalOidcProject> =
      await GlobalOidcProjectService.findBy({
        query: { globalOidcId: providerId, isEnabled: true },
        select: { projectId: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    const projectIds: Array<ObjectID> = attachments
      .map((attachment: GlobalOidcProject) => {
        return attachment.projectId;
      })
      .filter((projectId: ObjectID | undefined): projectId is ObjectID => {
        return Boolean(projectId);
      });

    await syncGlobalProviderForce({
      providerId,
      force: Boolean(provider.requireSsoForLogin),
      attachedProjectIds: projectIds,
    });
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const forceWasUpdated: boolean =
      (onUpdate.updateBy.data as { requireSsoForLogin?: unknown })
        .requireSsoForLogin !== undefined;

    if (forceWasUpdated) {
      for (const providerId of updatedItemIds) {
        await this.syncForceForProvider(providerId);
      }
    }

    return onUpdate;
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    deletedItemIds: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    // Provider gone: drop the pin from every project that pointed at it.
    for (const providerId of deletedItemIds) {
      await syncGlobalProviderForce({
        providerId,
        force: false,
        attachedProjectIds: [],
      });
    }

    return onDelete;
  }
}

export default new Service();
