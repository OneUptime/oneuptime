import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertEpisodeInternalNoteService from "../../../../Server/Services/AlertEpisodeInternalNoteService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import DiscordAlertEpisodeActions from "../../../../Server/Utils/Workspace/Discord/Actions/AlertEpisode";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import { testResponderActions } from "./DiscordResponderActionContract";

testResponderActions({
  name: "AlertEpisode",
  actions: DiscordAlertEpisodeActions,
  model: AlertEpisode,
  service: AlertEpisodeService,
  noteService: AlertEpisodeInternalNoteService,
  stateService: AlertStateService,
  stateModel: AlertState,
  trigger: "triggeredByAlertEpisodeId",
  event: UserNotificationEventType.AlertEpisodeCreated,
  noteId: "alertEpisodeId",
  stateValue: "alertStateId",
});
