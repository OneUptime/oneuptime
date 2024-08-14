import ObjectID from "Common/Types/ObjectID";
import Team from "Common/Models/DatabaseModels/Team";
import Faker from "../../../../Utils/Faker";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TeamService from "../../../../Server/Services/TeamService";

export interface TeamData {
  projectId: ObjectID;
}

export default class TeamServiceHelper {
  public static async generateAndSaveRandomTeam(
    data: TeamData,
    props: DatabaseCommonInteractionProps,
  ): Promise<Team> {
    const team: Team = this.generateRandomTeam(data);

    return TeamService.create({
      data: team,
      props,
    });
  }

  public static generateRandomTeam(data: TeamData): Team {
    const team: Team = new Team();

    // required fields
    team.name = Faker.generateName();
    team.slug = team.name;
    team.projectId = data.projectId;

    return team;
  }
}
