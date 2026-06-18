import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/GlobalSsoProject";
import Team from "../../Models/DatabaseModels/Team";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import validateGlobalProviderProjectTeams from "../Utils/ValidateGlobalProviderProjectTeams";
import type { Service as GlobalSsoServiceType } from "./GlobalSsoService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await validateGlobalProviderProjectTeams({
      teams: createBy.data.teams,
      projectId: createBy.data.projectId,
    });

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

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // A newly attached project may need this provider's "Force SSO" applied.
    if (createdItem.globalSsoId) {
      await Service.getGlobalSsoService().syncForceForProvider(
        createdItem.globalSsoId,
      );
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // Capture the providers whose attachments are being removed so we can
    // re-sync (un-force the now-detached projects) after deletion.
    const rows: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: { globalSsoId: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    const seen: Set<string> = new Set<string>();
    const providerIds: Array<ObjectID> = [];
    for (const row of rows) {
      const id: string | undefined = row.globalSsoId?.toString();
      if (id && !seen.has(id)) {
        seen.add(id);
        providerIds.push(row.globalSsoId!);
      }
    }

    return { deleteBy, carryForward: providerIds };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const providerIds: Array<ObjectID> =
      (onDelete.carryForward as Array<ObjectID>) || [];

    for (const providerId of providerIds) {
      await Service.getGlobalSsoService().syncForceForProvider(providerId);
    }

    return onDelete;
  }

  /*
   * Lazy require to avoid an import cycle: GlobalSsoService statically imports
   * this service, so resolve it at call-time rather than import-time. Mirrors
   * the require-based cycle break used elsewhere (e.g. AuditLogService).
   */
  private static getGlobalSsoService(): GlobalSsoServiceType {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("./GlobalSsoService").default;
  }
}

export default new Service();
