import AlertStateTimeline from "../../../../../Models/DatabaseModels/AlertStateTimeline";
import AlertInternalNote from "../../../../../Models/DatabaseModels/AlertInternalNote";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import AlertService from "../../../../Services/AlertService";
import AlertStateService from "../../../../Services/AlertStateService";
import AlertInternalNoteService from "../../../../Services/AlertInternalNoteService";
import WorkspaceResourceUpdateAuthorization from "../../WorkspaceResourceUpdateAuthorization";
import ObjectID from "../../../../../Types/ObjectID";
import DiscordResponderAction, {
  DiscordResponderMutationContext,
} from "./ResponderAction";
import DiscordResponderForms from "./ResponderForms";
import { DiscordActionModuleRegistration } from "./Types";

const DiscordAlertActions: DiscordResponderAction = new DiscordResponderAction({
  name: "Alert",
  label: "alert",
  service: AlertService,
  stateService: AlertStateService,
  timelineModel: AlertStateTimeline,
  internalNoteModel: AlertInternalNote,
  policyTrigger: "triggeredByAlertId",
  notificationEvent: UserNotificationEventType.AlertCreated,
  acknowledge: async (
    context: DiscordResponderMutationContext,
  ): Promise<void> => {
    await AlertService.acknowledgeAlert(context.resourceId, context.userId);
  },
  resolve: async (context: DiscordResponderMutationContext): Promise<void> => {
    await AlertService.resolveAlert(context.resourceId, context.userId);
  },
  assertCanUpdate: async (
    context: DiscordResponderMutationContext,
  ): Promise<void> => {
    await WorkspaceResourceUpdateAuthorization.assertCanUpdateAlert({
      alertId: context.resourceId,
      projectId: context.projectId,
      props: context.props,
    });
  },
  changeState: async (
    context: DiscordResponderMutationContext,
    stateId: ObjectID,
  ): Promise<void> => {
    await AlertService.changeAlertState({
      projectId: context.projectId,
      alertId: context.resourceId,
      alertStateId: stateId,
      notifyOwners: true,
      rootCause: "State changed via Discord.",
      stateChangeLog: undefined,
      props: context.props,
    });
  },
  addInternalNote: async (
    context: DiscordResponderMutationContext,
    note: string,
  ): Promise<void> => {
    await AlertInternalNoteService.addNote({
      alertId: context.resourceId,
      projectId: context.projectId,
      userId: context.userId,
      note,
    });
  },
});

export const DiscordAlertActionModule: DiscordActionModuleRegistration =
  DiscordResponderForms.register(DiscordAlertActions);
export default DiscordAlertActions;
