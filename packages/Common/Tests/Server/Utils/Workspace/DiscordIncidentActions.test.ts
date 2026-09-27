import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import DiscordIncidentActions from "../../../../Server/Utils/Workspace/Discord/Actions/Incident";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import { testResponderActions } from "./DiscordResponderActionContract";

testResponderActions({
  name: "Incident",
  actions: DiscordIncidentActions,
  model: Incident,
  service: IncidentService,
  noteService: IncidentInternalNoteService,
  publicNoteService: IncidentPublicNoteService,
  stateService: IncidentStateService,
  stateModel: IncidentState,
  trigger: "triggeredByIncidentId",
  event: UserNotificationEventType.IncidentCreated,
  noteId: "incidentId",
  stateValue: "incidentStateId",
});
