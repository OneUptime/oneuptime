import ObjectID from "Common/Types/ObjectID";
import Team from "Common/Models/DatabaseModels/Team";
import Faker from "../../../../Utils/Faker";

export default class TeamTestService {
  public static generateRandomTeam(data: { projectId: ObjectID }): Team {
    const team: Team = new Team();

    // required fields
    team.name = Faker.generateName();
    team.slug = team.name;
    team.projectId = data.projectId;

    return team;
  }
}
