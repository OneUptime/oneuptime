import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ScheduledMaintenancePublicNote from 'Model/Models/ScheduledMaintenancePublicNote';
import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import StatusPageResource from 'Model/Models/StatusPageResource';

export default interface ScheduledMaintenanceGroup {
    scheduledMaintenance: ScheduledMaintenance;
    publicNote?: ScheduledMaintenancePublicNote | undefined | null;
    scheduledMaintenanceState: ScheduledMaintenanceState;
    scheduledMaintenanceStateTimeline: ScheduledMaintenanceStateTimeline;
    scheduledEventResources: Array<StatusPageResource>
}
