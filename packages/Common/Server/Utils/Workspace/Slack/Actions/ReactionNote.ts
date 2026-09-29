import DatabaseBaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import LIMIT_MAX from "../../../../../Types/Database/LimitMax";
import ObjectID from "../../../../../Types/ObjectID";
import { JSONObject } from "../../../../../Types/JSON";
import WorkspaceNoteReactionUtil, {
  PrivateNoteReactionNames,
  WorkspaceNoteType,
} from "../../../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import DatabaseService from "../../../../Services/DatabaseService";
import WorkspaceProjectAuthTokenService from "../../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../Services/WorkspaceUserAuthTokenService";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import WorkspaceReactionNote, {
  WorkspaceNoteResource,
  WorkspaceNoteResourceType,
  WorkspaceNoteSaveResult,
} from "../../WorkspaceReactionNote";
import SlackUtil from "../Slack";
import SlackActionAuthorization from "./Authorization";

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
 * reaction_added: a pin on a message saves it as a private note, a megaphone
 * as a public note, on the incident / alert / scheduled maintenance / episode
 * the channel belongs to.
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
      logger.debug(
        "Slack user has not connected a OneUptime account. Ignoring reaction.",
        { projectId: projectId.toString(), channelId: channelId },
      );
      return;
    }

    const oneUptimeUserId: ObjectID = userAuth.userId;

    if (
      !(await SlackActionAuthorization.authorize({
        requester: {
          userId: oneUptimeUserId,
          projectId: projectId,
          projectAuthToken: authToken,
          slackUserId: userId,
        },
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
      }))
    ) {
      return;
    }

    let message: { text: string; threadTs: string | null } | null = null;

    try {
      message = await SlackUtil.getMessageDetailsByTimestamp({
        authToken: authToken,
        channelId: channelId,
        messageTs: messageTs,
      });
    } catch (err) {
      logger.error("Error fetching the Slack message that was reacted to:", {
        projectId: projectId.toString(),
        channelId: channelId,
      });
      logger.error(err);
      return;
    }

    if (!message || !message.text) {
      logger.debug("Reacted message has no text. Ignoring reaction.", {
        projectId: projectId.toString(),
        channelId: channelId,
      });
      return;
    }

    let saveResult: WorkspaceNoteSaveResult;

    try {
      saveResult = await WorkspaceReactionNote.saveNote({
        resource: resource,
        noteType: noteType,
        userId: oneUptimeUserId,
        note: message.text,
        sourceMessageKey: WorkspaceReactionNote.getSourceMessageKey({
          channelId: channelId,
          messageId: messageTs,
        }),
      });
    } catch (err) {
      logger.error("Error saving Slack message as a note:", {
        projectId: projectId.toString(),
        channelId: channelId,
      });
      logger.error(err);
      return;
    }

    if (saveResult === WorkspaceNoteSaveResult.Duplicate) {
      logger.debug("A note was already saved from this message. Skipping.", {
        projectId: projectId.toString(),
        channelId: channelId,
      });
      return;
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
        text: WorkspaceReactionNote.getConfirmationMessage({
          noteType: noteType,
          resourceLabel: display.label,
          resourceLink: display.link.toString(),
          formatLink: (url: string, text: string): string => {
            return `<${url}|${text}>`;
          },
          formatBold: (text: string): string => {
            return `*${text}*`;
          },
        }),
      });
    } catch (err) {
      logger.error("Error sending note confirmation to Slack:", {
        projectId: projectId.toString(),
        channelId: channelId,
      });
      logger.error(err);
    }
  }
}
