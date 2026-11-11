import ProjectReferencesService from "./ProjectReferencesService";
import TeamService from "./TeamService";
import Model from "../../Models/DatabaseModels/TeamOwnerUser";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

// The owned team's two names: its ID column, then its relation.
const OWNED_TEAM_KEYS: Array<string> = ["ownedTeamId", "ownedTeam"];

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The team must be the project's (ProjectReferencesService, first, so a
   * team of another project gets the answer of one that does not exist),
   * and one that may have owners: not Owners or Admin (TeamService). The
   * owned team is read under both its names, and a write naming two
   * different teams is refused, so the team checked is the team stored.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const onCreate: OnCreate<Model> = await super.onBeforeCreate(createBy);

    await TeamService.assertTeamCanHaveOwners(
      RelationIdUtil.readConsistent(
        createBy.data as unknown as Record<string, unknown>,
        OWNED_TEAM_KEYS,
        "Owned Team",
      ),
    );

    return onCreate;
  }
}

export default new Service();
