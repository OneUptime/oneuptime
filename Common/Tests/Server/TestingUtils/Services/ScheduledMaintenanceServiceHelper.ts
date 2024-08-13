import ObjectID from "Common/Types/ObjectID";
import Faker from "Common/Utils/Faker";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import OneUptimeDate from "../../../../Types/Date";

export default class ScheduledMaintenanceTestService {
  public static generateRandomScheduledMaintenance(data: {
    projectId: ObjectID,
    currentScheduledMaintenanceStateId: ObjectID,
  }
  ): ScheduledMaintenance {
    const maintenance: ScheduledMaintenance = new ScheduledMaintenance();

    // required fields
    maintenance.projectId = data.projectId;
    maintenance.currentScheduledMaintenanceStateId =
    data.currentScheduledMaintenanceStateId;
    maintenance.title = Faker.generateName();
    maintenance.description = Faker.generateName();
    maintenance.startsAt = OneUptimeDate.getCurrentDate();
    maintenance.endsAt = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      2,
    );
    maintenance.isOwnerNotifiedOfResourceCreation = false;
    maintenance.slug = maintenance.title;

    return maintenance;
  }
}
