import IncidentEpisodeStateTimeline from "../../../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentEpisodeInternalNote from "../../../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodePublicNote from "../../../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import IncidentEpisodeService from "../../../../Services/IncidentEpisodeService";
import IncidentStateService from "../../../../Services/IncidentStateService";
import IncidentEpisodeInternalNoteService from "../../../../Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodePublicNoteService from "../../../../Services/IncidentEpisodePublicNoteService";
import ObjectID from "../../../../../Types/ObjectID";
import DiscordResponderAction, {
  DiscordResponderMutationContext,
} from "./ResponderAction";
import DiscordResponderForms from "./ResponderForms";
import { DiscordActionModuleRegistration } from "./Types";

const DiscordIncidentEpisodeActions: DiscordResponderAction =
  new DiscordResponderAction({
    name: "IncidentEpisode",
    label: "incident episode",
    service: IncidentEpisodeService,
    stateService: IncidentStateService,
    timelineModel: IncidentEpisodeStateTimeline,
    internalNoteModel: IncidentEpisodeInternalNote,
    publicNoteModel: IncidentEpisodePublicNote,
    policyTrigger: "triggeredByIncidentEpisodeId",
    notificationEvent: UserNotificationEventType.IncidentEpisodeCreated,
    acknowledge: async (
      context: DiscordResponderMutationContext,
    ): Promise<void> => {
      await IncidentEpisodeService.acknowledgeEpisode(
        context.resourceId,
        context.userId,
      );
    },
    resolve: async (
      context: DiscordResponderMutationContext,
    ): Promise<void> => {
      await IncidentEpisodeService.resolveEpisode(
        context.resourceId,
        context.userId,
      );
    },
    changeState: async (
      context: DiscordResponderMutationContext,
      stateId: ObjectID,
    ): Promise<void> => {
      /*
       * The episode timeline does not mark isOwnerNotified as computed, so
       * member props are refused at the column level even though the create
       * gate already passed. Slack and Teams take the same root path here.
       */
      await IncidentEpisodeService.changeEpisodeState({
        projectId: context.projectId,
        episodeId: context.resourceId,
        incidentStateId: stateId,
        notifyOwners: true,
        rootCause: "State changed via Discord.",
        props: {
          isRoot: true,
          userId: context.userId,
          tenantId: context.projectId,
        },
      });
    },
    addInternalNote: async (
      context: DiscordResponderMutationContext,
      note: string,
    ): Promise<void> => {
      await IncidentEpisodeInternalNoteService.addNote({
        incidentEpisodeId: context.resourceId,
        projectId: context.projectId,
        userId: context.userId,
        note,
      });
    },
    addPublicNote: async (
      context: DiscordResponderMutationContext,
      note: string,
    ): Promise<void> => {
      await IncidentEpisodePublicNoteService.addNote({
        incidentEpisodeId: context.resourceId,
        projectId: context.projectId,
        userId: context.userId,
        note,
      });
    },
  });

export const DiscordIncidentEpisodeActionModule: DiscordActionModuleRegistration =
  DiscordResponderForms.register(DiscordIncidentEpisodeActions);
export default DiscordIncidentEpisodeActions;
