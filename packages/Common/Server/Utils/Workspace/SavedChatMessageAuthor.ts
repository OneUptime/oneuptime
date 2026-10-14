import User from "../../../Models/DatabaseModels/User";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import ObjectID from "../../../Types/ObjectID";
import SavedChatMessage, {
  SavedChatMessageUtil,
} from "../../../Types/Workspace/SavedChatMessage";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import UserService from "../../Services/UserService";
import WorkspaceUserAuthTokenService from "../../Services/WorkspaceUserAuthTokenService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WHO WROTE A MESSAGE SAVED AS A NOTE, AS ONEUPTIME NAMES THEM.
 *
 * A message's author is a chat account. When that account is connected to
 * a OneUptime member of the project - they signed in to Slack or Microsoft
 * Teams from their User Settings - the note names the member, with their
 * OneUptime name and picture, as every other entry of the timeline names
 * people. Anybody else - a colleague who never connected, somebody from
 * another company in a shared channel, an app - is named as the chat names
 * them. Either way the name is recorded with the note
 * (SavedChatMessage.authorName), so the note keeps saying who wrote it.
 */
export default class SavedChatMessageAuthor {
  /*
   * Where a message saved as a note came from: the chat, its author (their
   * OneUptime member when connected, else `chatName`) and when it was
   * posted. Never throws: a lookup that fails names the author as the chat
   * does.
   */
  @CaptureSpan()
  public static async getSavedChatMessage(data: {
    workspaceType: WorkspaceType;
    projectId: ObjectID;
    // The author's chat account: a Slack user id, a Microsoft Entra object id.
    workspaceUserId?: string | undefined;
    // The name the chat shows for them, or for the app that posted.
    chatName?: string | undefined;
    postedAt?: Date | null | undefined;
  }): Promise<SavedChatMessage> {
    const saved: SavedChatMessage = { workspaceType: data.workspaceType };

    const member: { userId: ObjectID; name: string } | null =
      data.workspaceUserId
        ? await SavedChatMessageAuthor.getConnectedMember({
            workspaceType: data.workspaceType,
            projectId: data.projectId,
            workspaceUserId: data.workspaceUserId,
          })
        : null;

    const authorName: string = SavedChatMessageUtil.getCleanName(
      member?.name || data.chatName,
    );

    if (authorName) {
      saved.authorName = authorName;
    }

    if (member) {
      saved.authorUserId = member.userId.toString();
    }

    if (data.postedAt && !isNaN(data.postedAt.getTime())) {
      saved.postedAt = data.postedAt.toISOString();
    }

    return saved;
  }

  /*
   * The OneUptime member a chat account is connected to in the project,
   * with the name OneUptime shows for them (else their email). Null when
   * the account is not connected, or cannot be read.
   */
  @CaptureSpan()
  public static async getConnectedMember(data: {
    workspaceType: WorkspaceType;
    projectId: ObjectID;
    workspaceUserId: string;
  }): Promise<{ userId: ObjectID; name: string } | null> {
    try {
      const userAuth: WorkspaceUserAuthToken | null =
        await WorkspaceUserAuthTokenService.findOneBy({
          query: {
            workspaceUserId: data.workspaceUserId,
            workspaceType: data.workspaceType,
            projectId: data.projectId,
          },
          select: {
            userId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!userAuth || !userAuth.userId) {
        return null;
      }

      const user: User | null = await UserService.findOneById({
        id: userAuth.userId,
        select: {
          name: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
      });

      const name: string =
        user?.name?.toString().trim() || user?.email?.toString().trim() || "";

      return { userId: userAuth.userId, name: name };
    } catch (err) {
      logger.debug(
        "Could not read which member a chat account is connected to; naming them as the chat does.",
        { projectId: data.projectId.toString() },
      );
      logger.debug(err);
      return null;
    }
  }
}
