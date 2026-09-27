import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeInternalNoteService from "../../../../Server/Services/IncidentEpisodeInternalNoteService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import IncidentEpisodePublicNoteService from "../../../../Server/Services/IncidentEpisodePublicNoteService";
import DiscordIncidentEpisodeActions from "../../../../Server/Utils/Workspace/Discord/Actions/IncidentEpisode";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import { testResponderActions } from "./DiscordResponderActionContract";

testResponderActions({
  name: "IncidentEpisode",
  actions: DiscordIncidentEpisodeActions,
  model: IncidentEpisode,
  service: IncidentEpisodeService,
  noteService: IncidentEpisodeInternalNoteService,
  publicNoteService: IncidentEpisodePublicNoteService,
  stateService: IncidentStateService,
  stateModel: IncidentState,
  trigger: "triggeredByIncidentEpisodeId",
  event: UserNotificationEventType.IncidentEpisodeCreated,
  noteId: "incidentEpisodeId",
  stateValue: "incidentStateId",
});
