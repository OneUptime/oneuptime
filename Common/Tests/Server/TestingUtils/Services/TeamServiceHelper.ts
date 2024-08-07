import CreateBy from "../../../../Server/Types/Database/CreateBy";
import ObjectID from "Common/Types/ObjectID";
import Team from "Common/Models/DatabaseModels/Team";
import Faker from "../../../../Utils/Faker";

export default class TeamTestService {
  public static generateRandomTeam(
    projectId: ObjectID,
    userId?: ObjectID,
  ): CreateBy<Team> {
    const team: Team = new Team();

    // required fields
    team.name = Faker.generateName();
    team.slug = team.name;
    team.projectId = projectId;

    return {
      data: team,
      props: { isRoot: true, userId },
    };
  }
}
