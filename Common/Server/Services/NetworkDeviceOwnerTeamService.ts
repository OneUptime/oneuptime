import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/NetworkDeviceOwnerTeam";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Returns the ids of all teams that own the given network device. Used to
   * fan device ownership into monitor-created incidents/alerts and into the
   * owner-added notification job.
   */
  @CaptureSpan()
  public async getOwnerTeamIdsForDevice(
    networkDeviceId: ObjectID,
    projectId?: ObjectID | undefined,
  ): Promise<Array<ObjectID>> {
    const ownerTeams: Array<Model> = await this.findBy({
      query: {
        networkDeviceId: networkDeviceId,
        // Scope to the project when known so a monitor step referencing a
        // device from another project can never fan out its owners.
        ...(projectId ? { projectId: projectId } : {}),
      },
      select: {
        _id: true,
        teamId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    return ownerTeams
      .map((ownerTeam: Model) => {
        return ownerTeam.teamId!;
      })
      .filter((teamId: ObjectID) => {
        return Boolean(teamId);
      });
  }
}

export default new Service();
