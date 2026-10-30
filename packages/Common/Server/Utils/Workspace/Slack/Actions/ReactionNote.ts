import DatabaseBaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import LIMIT_MAX from "../../../../../Types/Database/LimitMax";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../Types/ObjectID";
import { JSONObject } from "../../../../../Types/JSON";
import WorkspaceNoteReactionUtil, {
  PrivateNoteReactionNames,
  WorkspaceNoteType,
} from "../../../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import ChatMessageMarkdown from "../../../../../Utils/Markdown/ChatMessageMarkdown";
import { MarkdownText } from "../../../../../Utils/Markdown/FeedMarkdown";
import DatabaseService from "../../../../Services/DatabaseService";
import WorkspaceProjectAuthTokenService from "../../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../Services/WorkspaceUserAuthTokenService";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceReactionNote, {
  WorkspaceMessageNoteOutcome,
  WorkspaceMessageNoteResult,
  WorkspaceNoteResource,
  WorkspaceNoteResourceType,
  WorkspaceNoteSaveResult,
} from "../../WorkspaceReactionNote";
import SlackUtil from "../Slack";
import SlackSavedMessage, { SlackMessageToSave } from "../SlackSavedMessage";
import SlackActionAuthorization, {
  SlackActionRequester,
} from "./Authorization";
import WorkspaceActionAuthorization from "../../WorkspaceActionAuthorization";
import WorkspaceActionAnswers from "../../WorkspaceActionAnswers";
import {
  WorkspacePendingActionKind,
  WorkspacePressDescription,
} from "../../WorkspaceConnectRequest";
import { WorkspaceEventType } from "../../WorkspaceMemberActions";
import SlackConnectPrompt from "./ConnectPrompt";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";

export interface SlackReactionData {
  // Slack workspace (team) id.
  teamId: string;
  // Emoji name, e.g. "pushpin".
  reaction: string;
  // Slack user who reacted.
  userId: string;
  channelId: string;
  // ts of the message that was reacted to.
  messageTs: string;
}

/*
 * reaction_added and pin_added: a pin on a message - Slack's own "Pin to
 * channel" or a 📌 - saves it as a private note, a megaphone as a public
 * note, on the incident / alert / scheduled maintenance / episode the
 * channel belongs to. A private incident takes no public notes: a megaphone
 * there saves the message as a private note, and the confirmation says why
 * (WorkspaceReactionNote.getNoteTypeSavedAs).
 *
 * The note is the message as it read in Slack - its formatting, links,
 * mentions as names, files and images as links (SlackSavedMessage,
 * ChatMessageMarkdown) - and says whose words it is: the message's author
 * (their OneUptime member when their Slack account is connected, else the
 * name Slack shows), with whoever saved it as the note's creator. A private
 * note is filed at the time the message was posted, however long after it
 * was pinned.
 *
 * It is confirmed once: a short reply in the message's thread, with no
 * link preview. The note's own feed entry is not posted back into this
 * channel, where the message already is (SavedChatMessageNote).
 */
export default class SlackReactionNoteActions {
  /*
   * A pin_added event, as the reaction it stands for: a 📌 from the user who
   * pinned. Null when the pinned item is not a message (a file, say).
   */
  public static getReactionDataFromPinEvent(data: {
    payload: JSONObject;
    event: JSONObject;
  }): SlackReactionData | null {
    const item: JSONObject | undefined = data.event["item"] as
      | JSONObject
      | undefined;

    if (!item || (item["type"] && item["type"] !== "message")) {
      return null;
    }

    const message: JSONObject | undefined = item["message"] as
      | JSONObject
      | undefined;

    const channelId: string | undefined =
      (data.event["channel_id"] as string | undefined) ||
      (item["channel"] as string | undefined);

    const messageTs: string | undefined =
      (message?.["ts"] as string | undefined) ||
      (item["ts"] as string | undefined);

    const userId: string | undefined =
      (data.event["user"] as string | undefined) ||
      (item["created_by"] as string | undefined);

    const teamId: string | undefined =
      (data.payload["team_id"] as string | undefined) ||
      (data.event["team"] as string | undefined);

    if (!channelId || !messageTs || !userId || !teamId) {
      return null;
    }

    return {
      teamId: teamId,
      reaction: PrivateNoteReactionNames[0]!,
      userId: userId,
      channelId: channelId,
      messageTs: messageTs,
    };
  }

  /*
   * What a pin from somebody not connected yet asks them to connect for -
   * "save the message you pinned as a private note on this incident": the
   * prompt is at the foot of the channel, not next to the message - and
   * what OneUptime finishes for them once they have: the message, saved
   * (WorkspaceConnectCompletion).
   */
  public static describe(data: {
    resource: WorkspaceNoteResource;
    noteType: WorkspaceNoteType;
    channelId: string;
    messageTs: string;
    /*
     * The note it will be saved as, when that is not `noteType`: a public
     * note asked for on a private incident is saved as a private one, and
     * the prompt says so (WorkspaceReactionNote.getNoteTypeSavedAs).
     */
    noteSavedAs?: WorkspaceNoteType | undefined;
  }): WorkspacePressDescription {
    const kind: WorkspacePendingActionKind =
      data.noteType === WorkspaceNoteType.Public
        ? WorkspacePendingActionKind.SavePublicNote
        : WorkspacePendingActionKind.SavePrivateNote;
    const eventType: WorkspaceEventType = WorkspaceReactionNote.getEventType(
      data.resource.resourceType,
    );

    return {
      purpose: WorkspaceActionAnswers.getPendingActionPurpose({
        kind: kind,
        eventType: eventType,
        workspaceType: WorkspaceType.Slack,
        noteSavedAs: data.noteSavedAs,
      }),
      pendingAction: {
        kind: kind,
        eventType: eventType,
        eventId: data.resource.resourceId,
        message: {
          channelId: data.channelId,
          messageId: data.messageTs,
        },
      },
    };
  }

  @CaptureSpan()
  public static async handleEmojiReaction(
    data: SlackReactionData & {
      // Only consider channels of these resource types. All when omitted.
      resourceTypes?: Array<WorkspaceNoteResourceType> | undefined;
    },
  ): Promise<void> {
    const { teamId, reaction, userId, channelId, messageTs } = data;

    const noteType: WorkspaceNoteType | null =
      WorkspaceNoteReactionUtil.getNoteType(reaction);

    if (!noteType) {
      logger.debug(`Emoji "${reaction}" is not a note emoji. Ignoring.`, {
        channelId: channelId,
      });
      return;
    }

    if (!teamId || !userId || !channelId || !messageTs) {
      logger.debug("Reaction event is missing data. Ignoring.", {
        channelId: channelId,
      });
      return;
    }

    /*
     * One Slack workspace can be connected to several OneUptime projects, so
     * the channel is looked up in all of them — not in whichever connection a
     * findOne happened to return.
     */
    const projectAuths: Array<WorkspaceProjectAuthToken> = (
      await WorkspaceProjectAuthTokenService.findBy({
        query: {
          workspaceProjectId: teamId,
          workspaceType: WorkspaceType.Slack,
        },
        select: {
          projectId: true,
          authToken: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      })
    ).filter((projectAuth: WorkspaceProjectAuthToken) => {
      return Boolean(projectAuth.projectId && projectAuth.authToken);
    });

    if (projectAuths.length === 0) {
      logger.debug(
        "No OneUptime project is connected to this Slack workspace. Ignoring reaction.",
        { channelId: channelId },
      );
      return;
    }

    const resource: WorkspaceNoteResource | null =
      await WorkspaceReactionNote.resolveResourceForChannel({
        projectIds: projectAuths.map(
          (projectAuth: WorkspaceProjectAuthToken) => {
            return projectAuth.projectId!;
          },
        ),
        workspaceType: WorkspaceType.Slack,
        channelId: channelId,
        messageId: messageTs,
        getThreadId: async (): Promise<string | null> => {
          /*
           * Read as Slack has it: a reply that is only a file has no text,
           * but still a thread.
           */
          try {
            return (
              ((
                await SlackUtil.getMessage({
                  authToken: projectAuths[0]!.authToken!,
                  channelId: channelId,
                  messageTs: messageTs,
                })
              )?.["thread_ts"] as string | undefined) || null
            );
          } catch (err) {
            logger.debug(
              "Could not read the thread of the reacted-to message.",
              {
                channelId: channelId,
              },
            );
            logger.debug(err);
            return null;
          }
        },
        resourceTypes: data.resourceTypes,
      });

    if (!resource) {
      logger.debug(
        "Channel is not linked to an incident, alert, scheduled maintenance or episode. Ignoring reaction.",
        { channelId: channelId },
      );
      return;
    }

    const projectId: ObjectID = resource.projectId;

    if (
      !WorkspaceReactionNote.supportsNoteType(resource.resourceType, noteType)
    ) {
      logger.debug(
        `${resource.resourceType} does not take ${noteType} notes. Ignoring reaction.`,
        { projectId: projectId.toString(), channelId: channelId },
      );
      return;
    }

    const authToken: string = projectAuths.find(
      (projectAuth: WorkspaceProjectAuthToken) => {
        return projectAuth.projectId!.toString() === projectId.toString();
      },
    )!.authToken!;

    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          workspaceUserId: userId,
          workspaceType: WorkspaceType.Slack,
          projectId: projectId,
        },
        select: {
          userId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!userAuth || !userAuth.userId) {
      /*
       * A pin from somebody whose Slack account is not connected saves
       * nothing yet: they are asked to connect it, in a message only they
       * see - once for this message, not at every pin - with a Connect
       * button that saves the message for them once they have.
       */
      logger.debug(
        "Slack user has not connected a OneUptime account. Asking them to.",
        { projectId: projectId.toString(), channelId: channelId },
      );

      await SlackConnectPrompt.promptOnce({
        projectId: projectId,
        place: {
          projectAuthToken: authToken,
          slackUserId: userId,
          slackChannelId: channelId,
        },
        slackTeamId: teamId,
        description: SlackReactionNoteActions.describe({
          resource: resource,
          noteType: noteType,
          channelId: channelId,
          messageTs: messageTs,
          // A 📣 on a private incident: what it will be saved as.
          noteSavedAs: await WorkspaceReactionNote.getNoteTypeSavedAs({
            resource: resource,
            noteType: noteType,
          }),
        }),
        conversation: {
          workspaceType: WorkspaceType.Slack,
          workspaceId: teamId,
          // The message: one prompt for it, however many pins.
          conversationId: WorkspaceReactionNote.getSourceMessageKey({
            channelId: channelId,
            messageId: messageTs,
          }),
          workspaceUserId: userId,
        },
      });
      return;
    }

    /*
     * A refusal is told where the reaction was made: a message only they
     * see, in the channel (SlackActionAnswer), not a direct message.
     */
    const requester: SlackActionRequester = {
      userId: userAuth.userId,
      projectId: projectId,
      projectAuthToken: authToken,
      slackUserId: userId,
      slackChannelId: channelId,
    };

    await SlackReactionNoteActions.saveMessage({
      requester: requester,
      resource: resource,
      noteType: noteType,
      channelId: channelId,
      messageTs: messageTs,
    });
  }

  /*
   * Saves the message at `messageTs` as a note of `noteType` on `resource`,
   * as the member behind `requester`: checked as a note they post in
   * OneUptime is, read from Slack, saved once, and confirmed once in the
   * message's thread. A public note asked for on a private incident is
   * saved, checked and confirmed as a private note
   * (WorkspaceReactionNote.getNoteTypeSavedAs): the record takes no public
   * notes, and the confirmation says so.
   *
   * A refusal - they may not post that note, the message has nothing to
   * save - is told to them where they reacted, a message only they see;
   * unless `tellPerson` is false, when it only comes back (`reason`), for
   * the caller to say: a press finished once their account is connected is
   * answered as a whole (WorkspaceConnectCompletion).
   */
  @CaptureSpan()
  public static async saveMessage(data: {
    requester: SlackActionRequester;
    resource: WorkspaceNoteResource;
    noteType: WorkspaceNoteType;
    channelId: string;
    messageTs: string;
    tellPerson?: boolean | undefined;
  }): Promise<WorkspaceMessageNoteResult> {
    const { requester, resource, channelId, messageTs } = data;
    const projectId: ObjectID = resource.projectId;
    const authToken: string = requester.projectAuthToken || "";
    const tellPerson: boolean = data.tellPerson !== false;
    // What the reaction asked for, and what the record takes.
    const askedNoteType: WorkspaceNoteType = data.noteType;
    const noteType: WorkspaceNoteType =
      await WorkspaceReactionNote.getNoteTypeSavedAs({
        resource: resource,
        noteType: askedNoteType,
      });

    const refuse: (
      reason: string,
    ) => Promise<WorkspaceMessageNoteResult> = async (
      reason: string,
    ): Promise<WorkspaceMessageNoteResult> => {
      if (tellPerson) {
        await SlackActionAuthorization.sendRefusal({
          requester: requester,
          message: reason,
        });
      }

      return { outcome: WorkspaceMessageNoteOutcome.Refused, reason: reason };
    };

    let props: DatabaseCommonInteractionProps;

    try {
      if (!requester.userId) {
        throw new NotAuthorizedException(
          `You do not have permission to ${WorkspaceReactionNote.getAuthorizationAction(
            resource.resourceType,
            noteType,
          )}.`,
        );
      }

      props = await WorkspaceActionAuthorization.authorize({
        userId: requester.userId,
        projectId: projectId,
        modelType: WorkspaceReactionNote.getNoteModelType(
          resource.resourceType,
          noteType,
        ),
        action: WorkspaceReactionNote.getAuthorizationAction(
          resource.resourceType,
          noteType,
        ),
        resources: [
          {
            service: WorkspaceReactionNote.getResourceService(
              resource.resourceType,
            ) as unknown as DatabaseService<DatabaseBaseModel>,
            id: resource.resourceId,
          },
        ],
      });
    } catch (err) {
      if (!(err instanceof NotAuthorizedException)) {
        throw err;
      }

      logger.debug("Slack note refused: " + err.message, {
        projectId: projectId.toString(),
      });

      return await refuse(err.message);
    }

    let message: SlackMessageToSave | null = null;

    try {
      message = await SlackSavedMessage.read({
        authToken: authToken,
        projectId: projectId,
        channelId: channelId,
        messageTs: messageTs,
      });
    } catch (err) {
      logger.error("Error fetching the Slack message that was reacted to:", {
        projectId: projectId.toString(),
        channelId: channelId,
      });
      logger.error(err);
      return { outcome: WorkspaceMessageNoteOutcome.Failed };
    }

    if (!message) {
      logger.debug("Slack has no message there any more. Ignoring reaction.", {
        projectId: projectId.toString(),
        channelId: channelId,
      });
      return { outcome: WorkspaceMessageNoteOutcome.NotFound };
    }

    /*
     * A public note is shown to everyone: the links into the company's
     * Slack - its files and images - open for nobody there, so they stay
     * out of it.
     */
    const note: MarkdownText = ChatMessageMarkdown.toMarkdown(message.content, {
      withoutAttachments: noteType === WorkspaceNoteType.Public,
    });

    if (note.isEmpty()) {
      const reason: string = WorkspaceReactionNote.getNothingToSaveMessage({
        noteType: noteType,
        hasAttachments: !ChatMessageMarkdown.isEmpty(message.content),
        workspaceType: WorkspaceType.Slack,
      });

      if (tellPerson) {
        await SlackActionAuthorization.sendRefusal({
          requester: requester,
          message: reason,
        });
      }

      return {
        outcome: WorkspaceMessageNoteOutcome.NothingToSave,
        reason: reason,
      };
    }

    let saveResult: WorkspaceNoteSaveResult;

    try {
      /*
       * Saved with the member's props, so the note's own create can still
       * refuse it after the check above - a label, a column, the plan. Such
       * a refusal is told to them, as a button's is.
       */
      saveResult = await WorkspaceReactionNote.saveNote({
        resource: resource,
        noteType: noteType,
        props: props,
        note: note.toString(),
        sourceMessageKey: WorkspaceReactionNote.getSourceMessageKey({
          channelId: channelId,
          messageId: messageTs,
        }),
        savedFromChatMessage: message.savedFromChatMessage,
      });
    } catch (err) {
      if (
        err instanceof NotAuthorizedException ||
        err instanceof BadDataException ||
        err instanceof PaymentRequiredException
      ) {
        logger.debug("Slack note refused: " + err.message, {
          projectId: projectId.toString(),
        });

        return await refuse(
          `Could not save the message as a note: ${err.message}`,
        );
      }

      logger.error("Error saving Slack message as a note:", {
        projectId: projectId.toString(),
        channelId: channelId,
      });
      logger.error(err);
      return { outcome: WorkspaceMessageNoteOutcome.Failed };
    }

    // Saved before: confirmed then, so nothing is said again.
    if (saveResult === WorkspaceNoteSaveResult.Duplicate) {
      logger.debug("A note was already saved from this message. Skipping.", {
        projectId: projectId.toString(),
        channelId: channelId,
      });
      return { outcome: WorkspaceMessageNoteOutcome.AlreadySaved };
    }

    // The note is saved; the confirmation is best effort.
    try {
      const display: { label: string; link: { toString(): string } } =
        await WorkspaceReactionNote.getResourceDisplay(resource);

      await SlackUtil.sendMessageToThread({
        authToken: authToken,
        channelId: channelId,
        // Reply in the thread the message is in; Slack threads hang off the parent.
        threadTs: message.threadTs || messageTs,
        // Markdown, posted as Slack's mrkdwn: the label is text in the link.
        text: SlackUtil.slackify(
          WorkspaceReactionNote.getConfirmationMessage({
            noteType: noteType,
            resourceLabel: display.label,
            resourceLink: display.link.toString(),
            askedNoteType: askedNoteType,
            resourceType: resource.resourceType,
          }).toString(),
        ).trim(),
        withoutLinkPreviews: true,
      });
    } catch (err) {
      logger.error("Error sending note confirmation to Slack:", {
        projectId: projectId.toString(),
        channelId: channelId,
      });
      logger.error(err);
    }

    return { outcome: WorkspaceMessageNoteOutcome.Saved, noteType: noteType };
  }
}
