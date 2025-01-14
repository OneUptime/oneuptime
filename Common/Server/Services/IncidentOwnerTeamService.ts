import ObjectID from "../../Types/ObjectID";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Blue500 } from "../../Types/BrandColors";
import TeamService from "./TeamService";
import Team from "../../Models/DatabaseModels/Team";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public override async onCreateSuccess(onCreate: OnCreate<Model>, createdItem: Model): Promise<Model> {
    // add incident feed. 

    const incidentId: ObjectID | undefined = createdItem.incidentId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const teamId: ObjectID | undefined = createdItem.teamId;
    const createdByUserId: ObjectID | undefined = createdItem.createdByUserId || onCreate.createBy.props.userId;


    if (incidentId && teamId && projectId) {


      const team: Team | null = await TeamService.findOneById({
        id: teamId,
        select: {
          name: true
        },
        props: {
          isRoot: true
        }
      })

      if (team && team.name) {


        await IncidentFeedService.createIncidentFeed({

          incidentId: incidentId,
          projectId: projectId,
          incidentFeedEventType: IncidentFeedEventType.OwnerTeamAdded,
          displayColor: Blue500,
          feedInfoInMarkdown: `Team ${team.name} was added to the incident as the owner.`,
          userId: createdByUserId || undefined,
        });

      }

    }

    return createdItem;

  }
}

export default new Service();
