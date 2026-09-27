import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import AlertService from "../../../../Server/Services/AlertService";
import AlertInternalNoteService from "../../../../Server/Services/AlertInternalNoteService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import DiscordAlertActions from "../../../../Server/Utils/Workspace/Discord/Actions/Alert";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import { testResponderActions } from "./DiscordResponderActionContract";

testResponderActions({
  name: "Alert",
  actions: DiscordAlertActions,
  model: Alert,
  service: AlertService,
  noteService: AlertInternalNoteService,
  stateService: AlertStateService,
  stateModel: AlertState,
  trigger: "triggeredByAlertId",
  event: UserNotificationEventType.AlertCreated,
  noteId: "alertId",
  stateValue: "alertStateId",
});
