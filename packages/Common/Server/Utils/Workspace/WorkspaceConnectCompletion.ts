import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import { ConnectRequestOutcome } from "../../../Types/Workspace/ConnectCallback";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
import WorkspaceNotificationLogService from "../../Services/WorkspaceNotificationLogService";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceActionAnswers, {
  WorkspaceAnswer,
  WorkspaceLatePress,
} from "./WorkspaceActionAnswers";
import WorkspaceActionAuthorization from "./WorkspaceActionAuthorization";
import {
  isSaveNoteKind,
  WorkspaceConnectRequestAgain,
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestRecord,
  WorkspacePendingAction,
  WorkspacePendingActionKind,
  WorkspacePendingMessage,
} from "./WorkspaceConnectRequest";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "../../Services/WorkspaceProjectAuthTokenService";
import { WorkspaceNoteType } from "../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceReactionNote, {
  WorkspaceMessageNoteOutcome,
  WorkspaceMessageNoteResult,
  WorkspaceNoteResource,
} from "./WorkspaceReactionNote";
import SlackReactionNoteActions from "./Slack/Actions/ReactionNote";
import OnCallPersonPageAnswer from "../OnCall/OnCallPersonPageAnswer";
import MicrosoftTeamsReactionNoteSync from "./MicrosoftTeams/ReactionNoteSync";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventStanding,
  WorkspaceEventType,
} from "./WorkspaceMemberActions";

/*
 * FINISHING A PRESS ONCE THE ACCOUNT IS CONNECTED.
 *
 * Somebody pressed Acknowledge in Slack or Microsoft Teams before their
 * account was connected, was asked to connect it, and did, with the Connect
 * button (WorkspaceConnectRequest). The sign-in has just connected their
 * chat account to their OneUptime account. What they pressed is finished
 * now, as that member - exactly as the button would have done it, with the
 * same checks (WorkspaceMemberActions): their permission, their read of the
 * record, the project's plan. A record somebody else got to first is
 * answered with who and when, a refusal with its reason, and a press
 * OneUptime cannot finish for them (a form, a command, a question) with
 * what to press, run or ask again.
 *
 * The answer opens with the news that the account is connected, and the
 * chat delivers it where the press was (SlackActionAnswer,
 * MicrosoftTeamsActionAnswer). The settings page the sign-in returns to is
 * told only what became of the press (ConnectRequestOutcome).
 */

export interface WorkspaceConnectCompletionResult {
  /*
   * Done only when OneUptime did what was pressed; Answered when the chat
   * says why it did not (done already, refused, failed, nothing to finish).
   */
  outcome: ConnectRequestOutcome;
  // What the chat says, where the press was.
  answer: WorkspaceAnswer;
}

// A pending press, tried: what the chat says, and whether it was done.
interface PendingActionResult {
  answer: WorkspaceAnswer;
  isDone: boolean;
}

// The row each kind of record's state change is, for the check.
const STATE_TIMELINE_MODELS: Record<WorkspaceEventType, DatabaseBaseModelType> =
  {
    [WorkspaceEventType.Incident]: IncidentStateTimeline,
    [WorkspaceEventType.Alert]: AlertStateTimeline,
    [WorkspaceEventType.IncidentEpisode]: IncidentEpisodeStateTimeline,
    [WorkspaceEventType.AlertEpisode]: AlertEpisodeStateTimeline,
    [WorkspaceEventType.ScheduledMaintenance]:
      ScheduledMaintenanceStateTimeline,
  };

// A state change that comes too late: what its answer says was pressed.
const LATE_PRESSES: Partial<
  Record<WorkspacePendingActionKind, WorkspaceLatePress>
> = {
  [WorkspacePendingActionKind.Acknowledge]: WorkspaceLatePress.Acknowledge,
  [WorkspacePendingActionKind.Resolve]: WorkspaceLatePress.Resolve,
  [WorkspacePendingActionKind.MarkAsOngoing]: WorkspaceLatePress.MarkAsOngoing,
  [WorkspacePendingActionKind.MarkAsComplete]:
    WorkspaceLatePress.MarkAsComplete,
};

// A record's name in the workspace logs' button names ("acknowledge_incident").
const LOGGED_RECORD_NAMES: Record<WorkspaceEventType, string> = {
  [WorkspaceEventType.Incident]: "incident",
  [WorkspaceEventType.Alert]: "alert",
  [WorkspaceEventType.IncidentEpisode]: "incident_episode",
  [WorkspaceEventType.AlertEpisode]: "alert_episode",
  [WorkspaceEventType.ScheduledMaintenance]: "scheduled_maintenance",
};

export default class WorkspaceConnectCompletion {
  /*
   * Finishes `request` as `userId`, the OneUptime member the chat account
   * was just connected to, and says what the chat should answer. Never
   * throws: the account is connected either way.
   */
  @CaptureSpan()
  public static async complete(data: {
    request: WorkspaceConnectRequestRecord;
    userId: ObjectID;
  }): Promise<WorkspaceConnectCompletionResult> {
    const { request } = data;

    if (!request.pendingAction) {
      return {
        outcome: WorkspaceConnectCompletion.getAgainOutcome(request.again),
        answer: WorkspaceActionAnswers.getConnectedAnswer({
          workspaceType: request.workspaceType,
          again: request.again,
        }),
      };
    }

    const finished: PendingActionResult =
      await WorkspaceConnectCompletion.finishPendingAction({
        request: request,
        pendingAction: request.pendingAction,
        userId: data.userId,
      });

    return {
      /*
       * The settings page says "finished" only for a press that was: one
       * somebody got to first, a refusal or a failure is answered in the
       * chat, which says why.
       */
      outcome: finished.isDone
        ? ConnectRequestOutcome.Done
        : ConnectRequestOutcome.Answered,
      answer: WorkspaceActionAnswers.getConnectedAnswer({
        workspaceType: request.workspaceType,
        outcome: finished.answer,
      }),
    };
  }

  /*
   * What the settings page says of a press OneUptime does not finish, in
   * the words the chat answers with (WorkspaceActionAnswers.getAgainPhrase):
   * a question is asked again and a command run again - no button sent
   * either, so the page never says to press one - and a form's button is
   * pressed again. With nothing to do again, the chat has the whole answer.
   */
  public static getAgainOutcome(
    again: WorkspaceConnectRequestAgain | undefined,
  ): ConnectRequestOutcome {
    if (!again) {
      return ConnectRequestOutcome.Answered;
    }

    switch (again.kind) {
      case WorkspaceConnectRequestAgainKind.Question:
        return ConnectRequestOutcome.AskAgain;
      /*
       * A command is run again in Slack and typed again in Teams - never
       * "pressed": no button sent it.
       */
      case WorkspaceConnectRequestAgainKind.Command:
        return ConnectRequestOutcome.RunAgain;
      // A menu item, as a button: the page asks to go back and press it.
      case WorkspaceConnectRequestAgainKind.Button:
      case WorkspaceConnectRequestAgainKind.MenuItem:
        return ConnectRequestOutcome.PressAgain;
    }
  }

  /*
   * Acknowledge, Resolve, Mark as Ongoing or Mark as Complete, as the
   * member, as the button does it: checked as the button checks it, and
   * answered as the button answers - done, done already by somebody else,
   * or refused with why.
   */
  private static async finishPendingAction(data: {
    request: WorkspaceConnectRequestRecord;
    pendingAction: WorkspacePendingAction;
    userId: ObjectID;
  }): Promise<PendingActionResult> {
    const { request, pendingAction } = data;

    // A pinned message, saved as the pin would have saved it.
    if (isSaveNoteKind(pendingAction.kind)) {
      return await WorkspaceConnectCompletion.finishNoteSave(data);
    }

    try {
      const props: DatabaseCommonInteractionProps =
        await WorkspaceActionAuthorization.getProjectMemberProps({
          userId: data.userId,
          projectId: request.projectId,
        });

      const event: WorkspaceEventRecord =
        await WorkspaceMemberActions.authorize({
          props: props,
          modelType: STATE_TIMELINE_MODELS[pendingAction.eventType],
          action: request.purpose,
          event: {
            type: pendingAction.eventType,
            id: pendingAction.eventId,
          },
        });

      const standing: WorkspaceEventStanding =
        await WorkspaceMemberActions.getStanding(event);

      if (
        WorkspaceConnectCompletion.isDoneAlready(pendingAction.kind, standing)
      ) {
        return {
          answer: await WorkspaceActionAnswers.getAlreadyAnswer({
            event: event,
            press:
              LATE_PRESSES[pendingAction.kind] ||
              WorkspaceLatePress.Acknowledge,
            /*
             * Acknowledge on an incident or an alert somebody else is on
             * answers the presser's own person's pages about it, as the
             * button does once they are connected (OnCallPersonPageAnswer).
             */
            answeredPageCount:
              pendingAction.kind === WorkspacePendingActionKind.Acknowledge &&
              (event.type === WorkspaceEventType.Incident ||
                event.type === WorkspaceEventType.Alert)
                ? await OnCallPersonPageAnswer.onAcknowledgePressed({
                    kind:
                      event.type === WorkspaceEventType.Incident
                        ? "incident"
                        : "alert",
                    recordId: event.id,
                    projectId: event.projectId,
                    pressedByUserId: data.userId,
                    isResolved: standing.isResolved,
                  })
                : 0,
          }),
          isDone: false,
        };
      }

      switch (pendingAction.kind) {
        case WorkspacePendingActionKind.Acknowledge:
          await WorkspaceMemberActions.acknowledge({
            event: event,
            props: props,
          });
          break;
        case WorkspacePendingActionKind.Resolve:
        case WorkspacePendingActionKind.MarkAsComplete:
          await WorkspaceMemberActions.resolve({
            event: event,
            props: props,
          });
          break;
        case WorkspacePendingActionKind.MarkAsOngoing:
          await WorkspaceMemberActions.markScheduledMaintenanceAsOngoing({
            event: event,
            props: props,
          });
          break;
      }

      await WorkspaceConnectCompletion.logPress({
        request: request,
        pendingAction: pendingAction,
        userId: data.userId,
      });

      return {
        answer: await WorkspaceActionAnswers.getDoneAnswer({
          event: event,
          kind: pendingAction.kind,
        }),
        isDone: true,
      };
    } catch (err) {
      // A refusal is written for the person: their reason, as the button says it.
      if (
        err instanceof NotAuthorizedException ||
        err instanceof BadDataException ||
        err instanceof PaymentRequiredException
      ) {
        return {
          answer: {
            markdown: mdText`${err.message}`.toString(),
            text: err.message,
          },
          isDone: false,
        };
      }

      logger.error(
        "Could not finish a press once its chat account was connected.",
        { projectId: request.projectId.toString() },
      );
      logger.error(err, { projectId: request.projectId.toString() });

      const productName: string = ProductBrandingText.getProductName();

      return {
        answer: {
          markdown:
            mdText`${productName} could not ${request.purpose} just now. Please press the button again.`.toString(),
          text: `${productName} could not ${request.purpose} just now`,
        },
        isDone: false,
      };
    }
  }

  private static isDoneAlready(
    kind: WorkspacePendingActionKind,
    standing: WorkspaceEventStanding,
  ): boolean {
    switch (kind) {
      case WorkspacePendingActionKind.Acknowledge:
        return standing.isAcknowledged;
      case WorkspacePendingActionKind.Resolve:
        return standing.isResolved || standing.isComplete;
      case WorkspacePendingActionKind.MarkAsOngoing:
        return standing.hasStarted;
      case WorkspacePendingActionKind.MarkAsComplete:
        return standing.isComplete;
      // A note is saved once by its own check (finishNoteSave).
      case WorkspacePendingActionKind.SavePrivateNote:
      case WorkspacePendingActionKind.SavePublicNote:
        return false;
    }
  }

  /*
   * The press as the button's own handler names it in the workspace logs:
   * "acknowledge_incident", "mark_scheduled_maintenance_as_complete".
   */
  public static getLoggedButtonAction(action: WorkspacePendingAction): string {
    const record: string = LOGGED_RECORD_NAMES[action.eventType];

    switch (action.kind) {
      case WorkspacePendingActionKind.Acknowledge:
        return `acknowledge_${record}`;
      case WorkspacePendingActionKind.Resolve:
        return `resolve_${record}`;
      case WorkspacePendingActionKind.MarkAsOngoing:
        return `mark_${record}_as_ongoing`;
      case WorkspacePendingActionKind.MarkAsComplete:
        return `mark_${record}_as_complete`;
      case WorkspacePendingActionKind.SavePrivateNote:
        return `save_${record}_private_note`;
      case WorkspacePendingActionKind.SavePublicNote:
        return `save_${record}_public_note`;
    }
  }

  /*
   * A message somebody pinned - or gave a note emoji - before their account
   * was connected, saved now as the member it is connected to, exactly as
   * the pin would have saved it: checked as a note they post in OneUptime
   * is, read from the chat, saved once and confirmed once in its thread.
   * The answer says what became of it; a refusal says why.
   */
  private static async finishNoteSave(data: {
    request: WorkspaceConnectRequestRecord;
    pendingAction: WorkspacePendingAction;
    userId: ObjectID;
  }): Promise<PendingActionResult> {
    const { request, pendingAction } = data;
    const message: WorkspacePendingMessage | undefined = pendingAction.message;
    const noteType: WorkspaceNoteType =
      pendingAction.kind === WorkspacePendingActionKind.SavePublicNote
        ? WorkspaceNoteType.Public
        : WorkspaceNoteType.Private;
    const resource: WorkspaceNoteResource = {
      resourceType: WorkspaceReactionNote.getResourceType(
        pendingAction.eventType,
      ),
      resourceId: pendingAction.eventId,
      projectId: request.projectId,
    };

    let result: WorkspaceMessageNoteResult = {
      outcome: WorkspaceMessageNoteOutcome.Failed,
    };

    try {
      if (message && request.workspaceType === WorkspaceType.MicrosoftTeams) {
        result = await MicrosoftTeamsReactionNoteSync.saveAfterConnect({
          resource: resource,
          noteType: noteType,
          message: message,
          workspaceUserId: request.workspaceUserId,
        });
      } else if (message && request.workspaceType === WorkspaceType.Slack) {
        const projectAuth: WorkspaceProjectAuthToken | null =
          await WorkspaceProjectAuthTokenService.getProjectAuth({
            projectId: request.projectId,
            workspaceType: WorkspaceType.Slack,
          });

        if (projectAuth?.authToken) {
          result = await SlackReactionNoteActions.saveMessage({
            requester: {
              userId: data.userId,
              projectId: request.projectId,
              projectAuthToken: projectAuth.authToken,
              slackUserId: request.workspaceUserId,
              slackChannelId: message.channelId,
            },
            resource: resource,
            noteType: noteType,
            channelId: message.channelId,
            messageTs: message.messageId,
            // Answered here, as a whole, with the news of the connection.
            tellPerson: false,
          });
        }
      }
    } catch (err) {
      logger.error(
        "Could not save a pinned message once its chat account was connected.",
        { projectId: request.projectId.toString() },
      );
      logger.error(err, { projectId: request.projectId.toString() });
      result = { outcome: WorkspaceMessageNoteOutcome.Failed };
    }

    let record: MarkdownText = mdText`the ${WorkspaceMemberActions.getNoun(
      pendingAction.eventType,
    )}`;
    let recordLabel: string = record.toString();

    try {
      const display: { label: string; link: { toString(): string } } =
        await WorkspaceReactionNote.getResourceDisplay(resource);

      record = WorkspaceActionAnswers.getRecordMarkdown({
        label: display.label,
        link: display.link.toString(),
      });
      recordLabel = display.label;
    } catch (err) {
      logger.debug("Could not name the record a pinned message was saved on.");
      logger.debug(err);
    }

    switch (result.outcome) {
      case WorkspaceMessageNoteOutcome.Saved: {
        /*
         * As the note it was saved as: a 📣 on an incident made private
         * since is saved as a private note (getNoteTypeSavedAs), and its
         * confirmation in the thread says why.
         */
        const verb: string = WorkspaceActionAnswers.getDoneVerb(
          result.noteType === WorkspaceNoteType.Private
            ? WorkspacePendingActionKind.SavePrivateNote
            : pendingAction.kind,
        );

        return {
          answer: {
            markdown: mdText`✅ You ${verb} ${record}.`.toString(),
            text: `You ${verb} ${recordLabel}`,
          },
          isDone: true,
        };
      }
      case WorkspaceMessageNoteOutcome.AlreadySaved:
        return {
          answer: {
            markdown:
              mdText`✅ This message is already saved as a note on ${record}.`.toString(),
            text: `This message is already saved as a note on ${recordLabel}`,
          },
          isDone: false,
        };
      case WorkspaceMessageNoteOutcome.Refused:
      case WorkspaceMessageNoteOutcome.NothingToSave: {
        const reason: string =
          result.reason || "The message could not be saved as a note.";

        return {
          answer: { markdown: mdText`${reason}`.toString(), text: reason },
          isDone: false,
        };
      }
      case WorkspaceMessageNoteOutcome.NotFound: {
        /*
         * Slack: the message was deleted. Microsoft Teams saves a message
         * by the reaction on it, so it is also not found once the person
         * took their reaction off.
         */
        const gone: string =
          request.workspaceType === WorkspaceType.MicrosoftTeams
            ? "The message, or your reaction to it, is no longer there, so nothing was saved"
            : "The message is no longer there, so nothing was saved";

        return {
          answer: {
            markdown: mdText`${gone}.`.toString(),
            text: gone,
          },
          isDone: false,
        };
      }
      case WorkspaceMessageNoteOutcome.Failed: {
        const productName: string = ProductBrandingText.getProductName();

        return {
          answer: {
            markdown:
              mdText`${productName} could not save the message as a note just now. Please try again.`.toString(),
            text: `${productName} could not save the message as a note just now`,
          },
          isDone: false,
        };
      }
    }
  }

  // Logged as the button's own press is: a workspace log, best effort.
  private static async logPress(data: {
    request: WorkspaceConnectRequestRecord;
    pendingAction: WorkspacePendingAction;
    userId: ObjectID;
  }): Promise<void> {
    const { request, pendingAction } = data;

    try {
      const logData: Parameters<
        typeof WorkspaceNotificationLogService.logButtonPressed
      >[0] = {
        projectId: request.projectId,
        workspaceType: request.workspaceType,
        userId: data.userId,
        buttonAction:
          WorkspaceConnectCompletion.getLoggedButtonAction(pendingAction),
      };

      const channelId: string | undefined =
        request.slack?.channelId || request.teams?.conversationId;

      if (channelId) {
        logData.channelId = channelId;
      }

      switch (pendingAction.eventType) {
        case WorkspaceEventType.Incident:
          logData.incidentId = pendingAction.eventId;
          break;
        case WorkspaceEventType.Alert:
          logData.alertId = pendingAction.eventId;
          break;
        case WorkspaceEventType.IncidentEpisode:
          logData.incidentEpisodeId = pendingAction.eventId;
          break;
        case WorkspaceEventType.AlertEpisode:
          logData.alertEpisodeId = pendingAction.eventId;
          break;
        case WorkspaceEventType.ScheduledMaintenance:
          logData.scheduledMaintenanceId = pendingAction.eventId;
          break;
      }

      await WorkspaceNotificationLogService.logButtonPressed(logData, {
        isRoot: true,
      });
    } catch (err) {
      logger.error("Could not log a press finished after connecting:", {
        projectId: request.projectId.toString(),
      });
      logger.error(err);
    }
  }
}
