import { Black, Yellow } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";

export default class ScheduledMaintenanceStateTestService {
  public static generateScheduledState(data: {
    projectId: ObjectID;
  }): ScheduledMaintenanceState {
    const scheduledState: ScheduledMaintenanceState =
      new ScheduledMaintenanceState();

    // required fields
    scheduledState.name = "Scheduled";
    scheduledState.description =
      "When an event is scheduled, it belongs to this state";
    scheduledState.color = Black;
    scheduledState.isScheduledState = true;
    scheduledState.projectId = data.projectId;
    scheduledState.order = 1;
    scheduledState.slug = scheduledState.name;

    return scheduledState;
  }

  public static generateOngoingState(data: {
    projectId: ObjectID;
  }): ScheduledMaintenanceState {
    const ongoingState: ScheduledMaintenanceState =
      new ScheduledMaintenanceState();

    // required fields
    ongoingState.name = "Ongoing";
    ongoingState.description =
      "When an event is ongoing, it belongs to this state.";
    ongoingState.color = Yellow;
    ongoingState.isOngoingState = true;
    ongoingState.projectId = data.projectId;
    ongoingState.order = 2;
    ongoingState.slug = ongoingState.name;

    return ongoingState;
  }
}
