import IncidentStateTimeline from "../../../../../Models/DatabaseModels/IncidentStateTimeline";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../../Models/DatabaseModels/IncidentPublicNote";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import IncidentService from "../../../../Services/IncidentService";
import IncidentStateService from "../../../../Services/IncidentStateService";
import IncidentInternalNoteService from "../../../../Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../../Services/IncidentPublicNoteService";
import WorkspaceResourceUpdateAuthorization from "../../WorkspaceResourceUpdateAuthorization";
import ObjectID from "../../../../../Types/ObjectID";
import DiscordResponderAction, {
  DiscordResponderMutationContext,
} from "./ResponderAction";
import DiscordResponderForms from "./ResponderForms";
import { DiscordActionModuleRegistration } from "./Types";

const DiscordIncidentActions: DiscordResponderAction =
  new DiscordResponderAction({
    name: "Incident",
    label: "incident",
    service: IncidentService,
    stateService: IncidentStateService,
    timelineModel: IncidentStateTimeline,
    internalNoteModel: IncidentInternalNote,
    publicNoteModel: IncidentPublicNote,
    policyTrigger: "triggeredByIncidentId",
    notificationEvent: UserNotificationEventType.IncidentCreated,
    acknowledge: async (
      context: DiscordResponderMutationContext,
    ): Promise<void> => {
      await IncidentService.acknowledgeIncident(
        context.resourceId,
        context.userId,
      );
    },
    resolve: async (
      context: DiscordResponderMutationContext,
    ): Promise<void> => {
      await IncidentService.resolveIncident(context.resourceId, context.userId);
    },
    assertCanUpdate: async (
      context: DiscordResponderMutationContext,
    ): Promise<void> => {
      await WorkspaceResourceUpdateAuthorization.assertCanUpdateIncident({
        incidentId: context.resourceId,
        projectId: context.projectId,
        props: context.props,
      });
    },
    changeState: async (
      context: DiscordResponderMutationContext,
      stateId: ObjectID,
    ): Promise<void> => {
      await IncidentService.changeIncidentState({
        projectId: context.projectId,
        incidentId: context.resourceId,
        incidentStateId: stateId,
        shouldNotifyStatusPageSubscribers: true,
        isSubscribersNotified: false,
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
      await IncidentInternalNoteService.addNote({
        incidentId: context.resourceId,
        projectId: context.projectId,
        userId: context.userId,
        note,
      });
    },
    addPublicNote: async (
      context: DiscordResponderMutationContext,
      note: string,
    ): Promise<void> => {
      await IncidentPublicNoteService.addNote({
        incidentId: context.resourceId,
        projectId: context.projectId,
        userId: context.userId,
        note,
      });
    },
  });

export const DiscordIncidentActionModule: DiscordActionModuleRegistration =
  DiscordResponderForms.register(DiscordIncidentActions);
export default DiscordIncidentActions;
