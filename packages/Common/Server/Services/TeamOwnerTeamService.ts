import ProjectReferencesService from "./ProjectReferencesService";
import TeamService from "./TeamService";
import Model from "../../Models/DatabaseModels/TeamOwnerTeam";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The team must be the project's (ProjectReferencesService, first, so a
   * team of another project gets the answer of one that does not exist),
   * and one that may have owners: not Owners or Admin (TeamService).
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const onCreate: OnCreate<Model> = await super.onBeforeCreate(createBy);

    await TeamService.assertTeamCanHaveOwners(
      createBy.data.ownedTeamId || createBy.data.ownedTeam?.id,
    );

    return onCreate;
  }
}

export default new Service();
