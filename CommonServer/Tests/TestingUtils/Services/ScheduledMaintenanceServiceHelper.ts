import CreateBy from '../../../Types/Database/CreateBy';
import faker from '@faker-js/faker';
import ObjectID from 'Common/Types/ObjectID';
import Faker from 'Common/Utils/Faker';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';

export default class ScheduledMaintenanceTestService {
    public static generateRandomScheduledMaintenance(
        projectId: ObjectID,
        currentScheduledMaintenanceStateId: ObjectID
    ): CreateBy<ScheduledMaintenance> {
        const maintenance: ScheduledMaintenance = new ScheduledMaintenance();

        // required fields
        maintenance.projectId = projectId;
        maintenance.currentScheduledMaintenanceStateId =
            currentScheduledMaintenanceStateId;
        maintenance.title = Faker.generateName();
        maintenance.description = Faker.generateName();
        maintenance.startsAt = faker.date.soon(1);
        maintenance.endsAt = faker.date.soon(2);
        maintenance.isOwnerNotifiedOfResourceCreation = false;
        maintenance.slug = maintenance.title;

        return {
            data: maintenance,
            props: { isRoot: true },
        };
    }
}
