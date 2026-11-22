import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import type { WithheldProfile } from "../TeamMember/PendingInviteeProfiles";

/*
 * THE RULE EVERY FEED ENTRY AND CHANNEL LINE NAMES A PERSON BY (#10616,
 * #10668, #10669), and its words - with nothing to read: the pure half of
 * FeedPersonName, which reads who someone is and names them by it. Here on
 * its own so the line writers that only word a name - OnCallChatText and the
 * docs that quote it, the owner notification and rule feed texts, the chat
 * answers - hold the rule without the services FeedPersonName reads through.
 * FeedPersonName extends it: FeedPersonName.getMemberName is this one.
 */

// Someone only invited to the project, with no name typed for them (#10616).
export const FEED_INVITEE_UNNAMED: string =
  "someone who hasn't joined the project yet";

/*
 * Somebody a line cannot tell who they are: whether they are only invited
 * could not be read, or OneUptime has no name for them.
 */
export const FEED_NOBODY_NAMED: string = "Somebody";

export default class FeedPersonNameRule {
  /*
   * A person read already, as a line names them, with `withheld` who of the
   * people it names is only invited
   * (PendingInviteeProfiles.readWithheldProfilesInProject, read once for
   * them all): someone only invited by getInviteeName, anyone else by
   * getMemberName. Plain text. Empty when a member has neither a name nor an
   * address.
   */
  public static getName(data: {
    userId: ObjectID | string | null | undefined;
    name: Name | string | null | undefined;
    email: Email | string | null | undefined;
    withheld: Map<string, WithheldProfile>;
  }): string {
    const profile: WithheldProfile | undefined = data.userId
      ? data.withheld.get(data.userId.toString().toLowerCase())
      : undefined;

    if (profile) {
      return FeedPersonNameRule.getInviteeName(profile);
    }

    return FeedPersonNameRule.getMemberName({
      name: data.name,
      email: data.email,
    });
  }

  /*
   * A name a line may say of somebody: trimmed, and none when it is empty
   * or holds an address - an inviter can type one as the name (#10586), and
   * SSO can send one as a member's.
   */
  public static getDisplayName(
    name: Name | string | null | undefined,
  ): string {
    const trimmed: string = (name?.toString() || "").trim();

    return trimmed.includes("@") ? "" : trimmed;
  }

  /*
   * Someone only invited to the project (#10616): the name typed with their
   * invitation, else "someone who hasn't joined the project yet" - never an
   * address, and never the part of one.
   */
  public static getInviteeName(profile: WithheldProfile): string {
    return (
      FeedPersonNameRule.getDisplayName(profile.inviteeName) ||
      FEED_INVITEE_UNNAMED
    );
  }

  /*
   * A member (#10669): their name, else the part of their address before
   * the "@". Empty when they have neither. For someone known to be a member
   * - a person who acted, someone a member-only list holds: anyone else is
   * named through FeedPersonName, which reads whether they are only invited.
   */
  public static getMemberName(data: {
    name: Name | string | null | undefined;
    email: Email | string | null | undefined;
  }): string {
    return (
      FeedPersonNameRule.getDisplayName(data.name) ||
      FeedPersonNameRule.getAddressName(data.email)
    );
  }

  /*
   * The part of an address before the "@" - "ana.lee" of "ana.lee@acme.com"
   * - without the quotes a quoted one is written in. Empty when there is
   * none, or what is left still holds an "@".
   */
  public static getAddressName(
    email: Email | string | null | undefined,
  ): string {
    const address: string = (email?.toString() || "").trim();
    const at: number = address.lastIndexOf("@");

    if (at <= 0) {
      return "";
    }

    const local: string = address
      .slice(0, at)
      .replace(/^"(.*)"$/, "$1")
      .trim();

    return local.includes("@") ? "" : local;
  }
}
