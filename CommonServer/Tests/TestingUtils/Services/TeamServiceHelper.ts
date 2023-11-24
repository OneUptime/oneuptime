import Team from 'Model/Models/Team';
import ObjectID from 'Common/Types/ObjectID';
import faker from '@faker-js/faker';
import CreateBy from '../../../Types/Database/CreateBy';

export default class TeamTestService {
    public static generateRandomTeam(
        projectId: ObjectID,
        userId?: ObjectID
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
