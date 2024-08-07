import CreateBy from "../../../../Server/Types/Database/CreateBy";
import ObjectID from "Common/Types/ObjectID";
import Faker from "Common/Utils/Faker";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import OneUptimeDate from "../../../../Types/Date";

export default class ScheduledMaintenanceTestService {
  public static generateRandomScheduledMaintenance(
    projectId: ObjectID,
    currentScheduledMaintenanceStateId: ObjectID,
  ): CreateBy<ScheduledMaintenance> {
    const maintenance: ScheduledMaintenance = new ScheduledMaintenance();

    // required fields
    maintenance.projectId = projectId;
    maintenance.currentScheduledMaintenanceStateId =
      currentScheduledMaintenanceStateId;
    maintenance.title = Faker.generateName();
    maintenance.description = Faker.generateName();
    maintenance.startsAt = OneUptimeDate.getCurrentDate();
    maintenance.endsAt = OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(),2);
    maintenance.isOwnerNotifiedOfResourceCreation = false;
    maintenance.slug = maintenance.title;

    return {
      data: maintenance,
      props: { isRoot: true },
    };
  }
}
