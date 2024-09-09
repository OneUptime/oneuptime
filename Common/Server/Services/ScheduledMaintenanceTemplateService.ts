import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ScheduledMaintenanceTemplateOwnerTeamService from "./ScheduledMaintenanceTemplateOwnerTeamService";
import ScheduledMaintenanceTemplateOwnerUserService from "./ScheduledMaintenanceTemplateOwnerUserService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import Typeof from "../../Types/Typeof";
import Model from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";
import ScheduledMaintenanceTemplateOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerTeam";
import ScheduledMaintenanceTemplateOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerUser";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // add owners.

    if (
      createdItem.projectId &&
      createdItem.id &&
      onCreate.createBy.miscDataProps &&
      (onCreate.createBy.miscDataProps["ownerTeams"] ||
        onCreate.createBy.miscDataProps["ownerUsers"])
    ) {
      await this.addOwners(
        createdItem.projectId,
        createdItem.id,
        (onCreate.createBy.miscDataProps["ownerUsers"] as Array<ObjectID>) ||
          [],
        (onCreate.createBy.miscDataProps["ownerTeams"] as Array<ObjectID>) ||
          [],
        onCreate.createBy.props,
      );
    }

    return createdItem;
  }

  public async addOwners(
    projectId: ObjectID,
    scheduledMaintenanceTemplateId: ObjectID,
    userIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    for (let teamId of teamIds) {
      if (typeof teamId === Typeof.String) {
        teamId = new ObjectID(teamId.toString());
      }

      const teamOwner: ScheduledMaintenanceTemplateOwnerTeam =
        new ScheduledMaintenanceTemplateOwnerTeam();
      teamOwner.scheduledMaintenanceTemplateId = scheduledMaintenanceTemplateId;
      teamOwner.projectId = projectId;
      teamOwner.teamId = teamId;

      await ScheduledMaintenanceTemplateOwnerTeamService.create({
        data: teamOwner,
        props: props,
      });
    }

    for (let userId of userIds) {
      if (typeof userId === Typeof.String) {
        userId = new ObjectID(userId.toString());
      }
      const teamOwner: ScheduledMaintenanceTemplateOwnerUser =
        new ScheduledMaintenanceTemplateOwnerUser();
      teamOwner.scheduledMaintenanceTemplateId = scheduledMaintenanceTemplateId;
      teamOwner.projectId = projectId;
      teamOwner.userId = userId;
      await ScheduledMaintenanceTemplateOwnerUserService.create({
        data: teamOwner,
        props: props,
      });
    }
  }
}
export default new Service();
