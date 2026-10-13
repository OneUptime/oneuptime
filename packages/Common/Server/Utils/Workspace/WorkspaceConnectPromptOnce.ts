import crypto from "crypto";
import GlobalCache from "../../Infrastructure/GlobalCache";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * ONE CONNECT PROMPT A CONVERSATION.
 *
 * Somebody whose Slack or Microsoft Teams account is not connected to
 * OneUptime, asking OneUptime AI something - an @mention, a direct message,
 * a reply in a conversation with OneUptime AI - is asked to connect it, with
 * a Connect button (SlackConnectPrompt, MicrosoftTeamsConnectPrompt). Asked
 * that on every message, a person who kept writing in a thread got the same
 * prompt under each of their messages (#4768).
 *
 * So a person is asked once in a conversation - a thread, a direct message,
 * a chat - and not again there while the Connect button they were given
 * still works (WorkspaceConnectRequest.EXPIRES_IN_SECONDS). After that, a
 * new prompt brings a new button. A button press or a command is not
 * counted here: each is a request of its own, answered every time, where it
 * was made.
 *
 * Kept in the cache, as the Connect buttons' presses are. A cache that
 * cannot be read silences nobody: the prompt is sent, as it was before.
 */

// A person, in one conversation of one chat workspace.
export interface WorkspaceConversationPerson {
  workspaceType: WorkspaceType;
  // The Slack team, or the Microsoft 365 tenant.
  workspaceId: string;
  /*
   * The conversation: a Slack channel's thread or a direct message, a
   * Microsoft Teams channel's thread or a chat.
   */
  conversationId: string;
  // The chat account: a Slack user id, a Microsoft Entra object id.
  workspaceUserId: string;
}

// The one prompt of a conversation, claimed until its button expires.
export interface WorkspaceConnectPromptClaim {
  /*
   * Gives the claim back: a prompt that reached nobody does not count, so
   * the next message there is asked again.
   */
  release: () => Promise<void>;
}

const NAMESPACE: string = "workspace-connect-prompt";

export default class WorkspaceConnectPromptOnce {
  /*
   * As long as the Connect button a prompt carries works: thirty minutes,
   * WorkspaceConnectRequest.EXPIRES_IN_SECONDS (a test holds the two equal).
   * Not read from it: this module is imported while that one may be still
   * loading.
   */
  public static readonly ASKED_FOR_SECONDS: number = 30 * 60;

  /*
   * The prompt of a conversation, for the person: a claim when they are to
   * be asked, null when they were asked there already and that prompt's
   * Connect button still works. Never throws.
   */
  @CaptureSpan()
  public static async claim(
    person: WorkspaceConversationPerson,
  ): Promise<WorkspaceConnectPromptClaim | null> {
    const key: string = WorkspaceConnectPromptOnce.getKey(person);
    const holder: string = crypto.randomBytes(16).toString("hex");

    let isFirst: boolean;

    try {
      isFirst = await GlobalCache.setStringIfNotExists(NAMESPACE, key, holder, {
        expiresInSeconds: WorkspaceConnectPromptOnce.ASKED_FOR_SECONDS,
      });
    } catch (err) {
      logger.debug(
        "Could not read whether this person was asked to connect in this conversation already; asking them.",
      );
      logger.debug(err);

      return {
        release: async (): Promise<void> => {
          return undefined;
        },
      };
    }

    if (!isFirst) {
      return null;
    }

    return {
      release: async (): Promise<void> => {
        try {
          // Only this claim's own: one taken since by a later prompt stays.
          await GlobalCache.deleteKeyIfValue(NAMESPACE, key, holder);
        } catch (err) {
          logger.debug(
            "Could not give back the claim of a Connect prompt that reached nobody.",
          );
          logger.debug(err);
        }
      },
    };
  }

  /*
   * The cache key: a digest of who, where, so a key is the same length
   * whatever the ids, and names nobody in a read of the cache.
   */
  public static getKey(person: WorkspaceConversationPerson): string {
    return crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          person.workspaceType,
          person.workspaceId,
          person.conversationId,
          person.workspaceUserId,
        ]),
      )
      .digest("hex");
  }
}
