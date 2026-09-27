import AlertEpisodeStateTimeline from "../../../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertEpisodeInternalNote from "../../../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import UserNotificationEventType from "../../../../../Types/UserNotification/UserNotificationEventType";
import AlertEpisodeService from "../../../../Services/AlertEpisodeService";
import AlertStateService from "../../../../Services/AlertStateService";
import AlertEpisodeInternalNoteService from "../../../../Services/AlertEpisodeInternalNoteService";
import ObjectID from "../../../../../Types/ObjectID";
import DiscordResponderAction, {
  DiscordResponderMutationContext,
} from "./ResponderAction";
import DiscordResponderForms from "./ResponderForms";
import { DiscordActionModuleRegistration } from "./Types";

const DiscordAlertEpisodeActions: DiscordResponderAction =
  new DiscordResponderAction({
    name: "AlertEpisode",
    label: "alert episode",
    service: AlertEpisodeService,
    stateService: AlertStateService,
    timelineModel: AlertEpisodeStateTimeline,
    internalNoteModel: AlertEpisodeInternalNote,
    policyTrigger: "triggeredByAlertEpisodeId",
    notificationEvent: UserNotificationEventType.AlertEpisodeCreated,
    acknowledge: async (
      context: DiscordResponderMutationContext,
    ): Promise<void> => {
      await AlertEpisodeService.acknowledgeEpisode(
        context.resourceId,
        context.userId,
      );
    },
    resolve: async (
      context: DiscordResponderMutationContext,
    ): Promise<void> => {
      await AlertEpisodeService.resolveEpisode(
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
      await AlertEpisodeService.changeEpisodeState({
        projectId: context.projectId,
        episodeId: context.resourceId,
        alertStateId: stateId,
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
      await AlertEpisodeInternalNoteService.addNote({
        alertEpisodeId: context.resourceId,
        projectId: context.projectId,
        userId: context.userId,
        note,
      });
    },
  });

export const DiscordAlertEpisodeActionModule: DiscordActionModuleRegistration =
  DiscordResponderForms.register(DiscordAlertEpisodeActions);
export default DiscordAlertEpisodeActions;
