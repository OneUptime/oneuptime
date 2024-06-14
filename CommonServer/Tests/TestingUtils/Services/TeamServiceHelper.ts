import CreateBy from "../../../Types/Database/CreateBy";
import faker from "@faker-js/faker";
import ObjectID from "Common/Types/ObjectID";
import Team from "Model/Models/Team";

export default class TeamTestService {
  public static generateRandomTeam(
    projectId: ObjectID,
    userId?: ObjectID,
  ): CreateBy<Team> {
    const team: Team = new Team();

    // required fields
    team.name = faker.random.alphaNumeric(10);
    team.slug = team.name;
    team.projectId = projectId;

    return {
      data: team,
      props: { isRoot: true, userId },
    };
  }
}
