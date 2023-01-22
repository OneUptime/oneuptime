import Incident from 'Model/Models/Incident';
import IncidentPublicNote from 'Model/Models/IncidentPublicNote';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import IncidentState from 'Model/Models/IncidentState';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import StatusPageResource from 'Model/Models/StatusPageResource';

export default interface IncidentGroup {
    incident: Incident;
    incidentSeverity: IncidentSeverity;
    publicNotes?: Array<IncidentPublicNote>;
    incidentState: IncidentState;
    incidentStateTimelines: Array<IncidentStateTimeline>;
    incidentResources: Array<StatusPageResource>;
}
