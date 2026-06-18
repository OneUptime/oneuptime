import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/GlobalOidcProject";
import ProjectService from "./ProjectService";
import Team from "../../Models/DatabaseModels/Team";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import validateGlobalProviderProjectTeams from "../Utils/ValidateGlobalProviderProjectTeams";

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

  /*
   * Attaching / detaching / enabling / disabling a project changes whether the
   * provider's "Force SSO for Login" applies to it. SSO enforcement is resolved
   * dynamically in ProjectService, so just drop its enforcement cache.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    ProjectService.clearSsoEnforcementCache();
    return createdItem;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    ProjectService.clearSsoEnforcementCache();
    return onUpdate;
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _deletedItemIds: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    ProjectService.clearSsoEnforcementCache();
    return onDelete;
  }
}

export default new Service();
