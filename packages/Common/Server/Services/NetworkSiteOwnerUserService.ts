import ObjectID from "../../Types/ObjectID";
import ProjectReferencesService from "./ProjectReferencesService";
import NetworkSiteOwnerTeamService from "./NetworkSiteOwnerTeamService";
import Model from "../../Models/DatabaseModels/NetworkSiteOwnerUser";
import NetworkSiteOwnerTeam from "../../Models/DatabaseModels/NetworkSiteOwnerTeam";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface NetworkSiteOwners {
  ownerUserIds: Array<ObjectID>;
  ownerTeamIds: Array<ObjectID>;
}

/*
 * The people who own a network site (#10188): made owners of the alert the
 * site raises when its health rolls up unhealthy, and the sites a role
 * limited to what its holder owns may change (OwnerTableRegistry). A site
 * keeps no timeline of its own, so adding or removing one is written to the
 * audit log, as every change through the API is.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The people and teams who own one site of a project, for the alert it
   * raises (NetworkSiteService). Read as OneUptime, and scoped to the
   * project, so a row of another project can never name them.
   */
  @CaptureSpan()
  public async getSiteOwners(data: {
    projectId: ObjectID;
    networkSiteId: ObjectID;
  }): Promise<NetworkSiteOwners> {
    const [users, teams]: [Array<Model>, Array<NetworkSiteOwnerTeam>] =
      await Promise.all([
        this.findAllBy({
          query: {
            networkSiteId: data.networkSiteId,
            projectId: data.projectId,
          },
          select: { userId: true },
          props: { isRoot: true },
        }),
        NetworkSiteOwnerTeamService.findAllBy({
          query: {
            networkSiteId: data.networkSiteId,
            projectId: data.projectId,
          },
          select: { teamId: true },
          props: { isRoot: true },
        }),
      ]);

    const userIds: Array<ObjectID> = [];
    const teamIds: Array<ObjectID> = [];

    for (const row of users) {
      if (row.userId) {
        userIds.push(row.userId);
      }
    }

    for (const row of teams) {
      if (row.teamId) {
        teamIds.push(row.teamId);
      }
    }

    return { ownerUserIds: userIds, ownerTeamIds: teamIds };
  }
}

export default new Service();
