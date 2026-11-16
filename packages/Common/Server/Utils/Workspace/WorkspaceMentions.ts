import { JSONObject } from "../../../Types/JSON";
import { WorkspacePayloadMention } from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import MicrosoftTeamsActionAnswer from "./MicrosoftTeams/MicrosoftTeamsActionAnswer";

/*
 * A PERSON MENTIONED ON PURPOSE IN A MESSAGE, IN EACH WORKSPACE'S OWN WAY
 * (issue #7968).
 *
 * OneUptime names people in its messages as text that notifies nobody: a
 * name somebody typed can hold "@channel", and Mattermost breaks every "@"
 * a post has (MattermostUtil.neutralizeMentions). An on-call rule can ask
 * for the person who comes on call to be mentioned in its hand-off line -
 * notified, and a click away for their teammates - by the account they
 * connected to OneUptime in that workspace, and nobody else:
 *
 *   Slack             <@U0123ABC>         Slack reads it as a mention as it is.
 *   Microsoft Teams   <at>Ana Lee</at>     with a mention entity on the card.
 *   Mattermost        @ana.lee             kept whole where the post breaks the rest.
 *
 * Each is built only from what the account's connection stored, checked
 * against what that workspace's ids look like, so nothing a person typed
 * becomes a mention. A message carries its mentions beside its text
 * (WorkspacePayloadMarkdown.mentions), for the card's entities, the post's
 * kept "@", and a notification log, which names them.
 */

// A Slack user's id: "U0123ABC", or "W0123ABC" in an Enterprise organization.
const SLACK_USER_ID: RegExp = /^[UW][A-Z0-9]{2,40}$/;

// A Microsoft Entra object id: a GUID.
const MICROSOFT_ENTRA_OBJECT_ID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A Mattermost user's id: 26 lower-case letters and digits.
const MATTERMOST_USER_ID: RegExp = /^[a-z0-9]{26}$/;

/*
 * A Mattermost username: letters, digits, ".", "-" and "_", starting with a
 * letter, at most 22 characters (Mattermost's own rule).
 */
const MATTERMOST_USERNAME: RegExp = /^[a-z][a-z0-9._-]{0,21}$/i;

// A Mattermost username character: what a mention reads on to.
const MATTERMOST_USERNAME_CHARACTER: RegExp = /[a-z0-9._-]/i;

export default class WorkspaceMentions {
  /*
   * The mention of a person in a workspace, by the account they connected
   * there, or null when what was stored is not that workspace's account -
   * they are then named, not mentioned.
   *
   *   workspaceUserId   their Slack user id, Entra object id or Mattermost user id
   *   name              their name there: the Teams mention's text; their
   *                     Mattermost username; for Slack, how a log names them
   */
  public static getMention(data: {
    workspaceType: WorkspaceType;
    workspaceUserId: string | null | undefined;
    name: string | null | undefined;
  }): WorkspacePayloadMention | null {
    const id: string = (data.workspaceUserId || "").trim();
    const name: string = MicrosoftTeamsActionAnswer.getMentionName(
      data.name || "",
    );

    if (!id) {
      return null;
    }

    if (data.workspaceType === WorkspaceType.Slack) {
      return SLACK_USER_ID.test(id)
        ? { text: `<@${id}>`, workspaceUserId: id, name: name || id }
        : null;
    }

    if (data.workspaceType === WorkspaceType.MicrosoftTeams) {
      return MICROSOFT_ENTRA_OBJECT_ID.test(id) && name
        ? { text: `<at>${name}</at>`, workspaceUserId: id, name: name }
        : null;
    }

    if (data.workspaceType === WorkspaceType.Mattermost) {
      const username: string = (data.name || "").trim();

      return MATTERMOST_USER_ID.test(id) && MATTERMOST_USERNAME.test(username)
        ? { text: `@${username}`, workspaceUserId: id, name: username }
        : null;
    }

    return null;
  }

  /*
   * The text with each mention as the name it shows - "@Ana Lee", not
   * "<@U0123ABC>": for a notification log, which shows no workspace's own
   * formatting.
   */
  public static toLogText(
    text: string,
    mentions: Array<WorkspacePayloadMention> | undefined,
  ): string {
    let logText: string = text || "";

    for (const mention of mentions || []) {
      if (mention.text) {
        logText = logText.split(mention.text).join(`@${mention.name}`);
      }
    }

    return logText;
  }

  /*
   * A Microsoft Teams card's mention entities: Teams notifies the person of
   * each, where the card's text holds its <at> tag. None for a mention the
   * text does not hold, which Teams would refuse.
   */
  public static getMicrosoftTeamsEntities(data: {
    texts: Array<string>;
    mentions: Array<WorkspacePayloadMention>;
  }): Array<JSONObject> {
    const entities: Array<JSONObject> = [];
    const seen: Set<string> = new Set<string>();

    for (const mention of data.mentions) {
      if (
        seen.has(mention.text) ||
        !data.texts.some((text: string): boolean => {
          return text.includes(mention.text);
        })
      ) {
        continue;
      }

      seen.add(mention.text);
      entities.push({
        type: "mention",
        text: mention.text,
        mentioned: {
          id: mention.workspaceUserId,
          name: mention.name,
        },
      });
    }

    return entities;
  }

  /*
   * Whether the "@" at `index` of a Mattermost post starts one of its
   * mentions: the username whole, not the start of a longer one.
   */
  public static isMattermostMentionAt(data: {
    text: string;
    index: number;
    usernames: Array<string>;
  }): boolean {
    for (const username of data.usernames) {
      if (
        data.text.substring(
          data.index + 1,
          data.index + 1 + username.length,
        ) !== username
      ) {
        continue;
      }

      const after: string = data.text.substring(
        data.index + 1 + username.length,
      );

      /*
       * Mattermost reads a mention on through letters, digits, ".", "-" and
       * "_"; a "." with no username character after it ends the sentence.
       */
      const next: string = after.charAt(0);

      if (
        !next ||
        !MATTERMOST_USERNAME_CHARACTER.test(next) ||
        (next === "." && !MATTERMOST_USERNAME_CHARACTER.test(after.charAt(1)))
      ) {
        return true;
      }
    }

    return false;
  }

  // The usernames a Mattermost post's mentions keep whole.
  public static getMattermostUsernames(
    mentions: Array<WorkspacePayloadMention> | undefined,
  ): Array<string> {
    return (mentions || [])
      .map((mention: WorkspacePayloadMention): string => {
        return mention.name;
      })
      .filter((username: string): boolean => {
        return MATTERMOST_USERNAME.test(username);
      });
  }
}
