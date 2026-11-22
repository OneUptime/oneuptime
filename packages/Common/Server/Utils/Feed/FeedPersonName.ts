import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import UserService from "../../Services/UserService";
import logger, { LogAttributes } from "../Logger";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../TeamMember/PendingInviteeProfiles";
import { FEED_INVITEE_UNNAMED, FEED_NOBODY_NAMED } from "./FeedPersonNameWords";

export { FEED_INVITEE_UNNAMED, FEED_NOBODY_NAMED };

/*
 * HOW EVERY FEED ENTRY AND CHANNEL LINE NAMES A PERSON (#10616, #10668,
 * #10669).
 *
 * A record's feed entries are posted to its Slack, Microsoft Teams and
 * Mattermost channels, and a channel can be read by people outside the
 * project - a shared channel, a guest. So can a feed: workflows and the API
 * take its entries anywhere. No line says anyone's email address:
 *
 *   - Someone only invited to the project (#10412) is named by the name
 *     typed with their invitation, never by their account's own name, which
 *     the project does not see until they join (#9823). With no name typed,
 *     or one that holds an address, they are "someone who hasn't joined the
 *     project yet". As text: a name the inviter typed links to nobody's page.
 *     They have agreed to nothing yet, and nothing pages them, so a line has
 *     no reason to say how to reach them.
 *   - A member is named by their name, linked to their page in the project.
 *     A member with no name - SSO or SCIM that sent none, an invitation
 *     accepted without one - or whose name holds an address, is named by the
 *     part of their address before the "@" (#10669): "ana.lee". The
 *     project's people still tell who it is, and the link opens their page,
 *     address and all, for whoever may see it there.
 *   - Whether someone is only invited is read once per person per change
 *     (one FeedPersonName for the change). When it cannot be read, they are
 *     "Somebody": never a name that could be an address.
 *
 * Every line names its people here: UserService.getUserMarkdownString (the
 * name most lines put in their sentence), the on-call lines
 * (OnCallChatByWorkspace), the owner rules' lists (RuleFeedMarkdown), the
 * note of who could not be added to a channel, and the rest.
 * FeedLinesNamePeopleInOnePlaceGuard holds every file that writes a feed
 * entry or a channel line to it, so a new line cannot name a person any
 * other way.
 *
 * The project's own pages - Users, On-Call Readiness, a refusal read only by
 * whoever made the change - still show a person's address: those are read
 * by the project's people, inside the project.
 */

/*
 * Whether somebody a line names is only invited to the project - with the
 * name a line says for them, and whether that is a name typed for them or
 * FEED_INVITEE_UNNAMED - or a member. Null when it could not be read.
 */
export type FeedPersonStanding =
  | { isInvited: true; name: string; isNamed: boolean }
  | { isInvited: false }
  | null;

export default class FeedPersonName {
  private readonly projectId: ObjectID | null;
  private readonly standings: Map<string, Promise<FeedPersonStanding>> =
    new Map<string, Promise<FeedPersonStanding>>();
  private readonly names: Map<string, Promise<MarkdownText>> = new Map<
    string,
    Promise<MarkdownText>
  >();
  private readonly texts: Map<string, Promise<string>> = new Map<
    string,
    Promise<string>
  >();

  // One for each change: whoever it names is read once, however many lines name them.
  public constructor(data: { projectId: ObjectID | null | undefined }) {
    this.projectId = data.projectId || null;
  }

  /*
   * A person as a line names them, in Markdown: a member as a link to their
   * page, someone only invited as text, "Somebody" when that cannot be
   * read. Empty for nobody: no id, or no such person. Asked once for each
   * person.
   */
  public nameOf(userId: ObjectID | null | undefined): Promise<MarkdownText> {
    if (!userId) {
      return Promise.resolve(FeedMarkdown.empty());
    }

    const key: string = userId.toString().toLowerCase();
    let name: Promise<MarkdownText> | undefined = this.names.get(key);

    if (!name) {
      name = this.readName(userId);
      this.names.set(key, name);
    }

    return name;
  }

  /*
   * The same name as plain text, for a line that places it as text itself
   * ("Added action item Fix the alert for Ana Lee"). Empty for nobody.
   */
  public textOf(userId: ObjectID | null | undefined): Promise<string> {
    if (!userId) {
      return Promise.resolve("");
    }

    const key: string = userId.toString().toLowerCase();
    let text: Promise<string> | undefined = this.texts.get(key);

    if (!text) {
      text = this.readText(userId);
      this.texts.set(key, text);
    }

    return text;
  }

  /*
   * Whether somebody a line names is only invited to the project, read once
   * for every line of the change. Never throws: null when it cannot be read.
   */
  public getStanding(userId: ObjectID): Promise<FeedPersonStanding> {
    const key: string = userId.toString().toLowerCase();
    let standing: Promise<FeedPersonStanding> | undefined =
      this.standings.get(key);

    if (!standing) {
      standing = this.readStanding(userId);
      this.standings.set(key, standing);
    }

    return standing;
  }

  // One person in one line: nameOf, for a line that names nobody else.
  public static getMarkdown(data: {
    userId: ObjectID | null | undefined;
    projectId: ObjectID | null | undefined;
  }): Promise<MarkdownText> {
    return new FeedPersonName({ projectId: data.projectId }).nameOf(
      data.userId,
    );
  }

  // One person in one line, as text: textOf.
  public static getText(data: {
    userId: ObjectID | null | undefined;
    projectId: ObjectID | null | undefined;
  }): Promise<string> {
    return new FeedPersonName({ projectId: data.projectId }).textOf(
      data.userId,
    );
  }

  /*
   * Many people read already, named as text for one line - a list of
   * owners, the people a channel could not add - with one read of who of
   * them is only invited. By lower-cased id. When that read fails, each of
   * them is "Somebody". Never their address.
   */
  public static async readNames(data: {
    users: Array<User | null | undefined>;
    projectId: ObjectID;
  }): Promise<Map<string, string>> {
    const users: Array<User> = data.users.filter(
      (user: User | null | undefined): user is User => {
        return Boolean(user?.id);
      },
    );

    const names: Map<string, string> = new Map<string, string>();

    if (users.length === 0) {
      return names;
    }

    let withheld: Map<string, WithheldProfile> | null = null;

    try {
      withheld = await PendingInviteeProfiles.readWithheldProfilesInProject({
        userIds: users.map((user: User): string => {
          return user.id!.toString();
        }),
        projectId: data.projectId,
      });
    } catch (err) {
      FeedPersonName.logUnread(data.projectId, err);
    }

    for (const user of users) {
      names.set(
        user.id!.toString().toLowerCase(),
        withheld
          ? FeedPersonName.getName({
              userId: user.id,
              name: user.name,
              email: user.email,
              withheld: withheld,
            }) || FEED_NOBODY_NAMED
          : FEED_NOBODY_NAMED,
      );
    }

    return names;
  }

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
    const profile: WithheldProfile | undefined =
      PendingInviteeProfiles.getWithheldProfile({
        userId: data.userId,
        withheld: data.withheld,
      });

    if (profile) {
      return FeedPersonName.getInviteeName(profile);
    }

    return FeedPersonName.getMemberName({
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
      FeedPersonName.getDisplayName(profile.inviteeName) ||
      FEED_INVITEE_UNNAMED
    );
  }

  /*
   * A member (#10669): their name, else the part of their address before
   * the "@". Empty when they have neither.
   */
  public static getMemberName(data: {
    name: Name | string | null | undefined;
    email: Email | string | null | undefined;
  }): string {
    return (
      FeedPersonName.getDisplayName(data.name) ||
      FeedPersonName.getAddressName(data.email)
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

  private async readName(userId: ObjectID): Promise<MarkdownText> {
    const user: User | null = await FeedPersonName.readUser(userId);

    if (!user) {
      return FeedMarkdown.empty();
    }

    const standing: FeedPersonStanding = await this.getStanding(userId);

    // Unread, they may be only invited: no name that could be their address.
    if (!standing) {
      return mdText`${FEED_NOBODY_NAMED}`;
    }

    // As text: the name the inviter typed links nowhere and mentions nobody.
    if (standing.isInvited) {
      return mdText`${standing.name}`;
    }

    /*
     * A user's name is theirs to set, and it is placed inside the link's own
     * text, so every Markdown character in it is escaped (mdText): a "]"
     * cannot end the text early and point the rest of the sentence
     * somewhere else, "![...](...)" is no image, and "<!channel>" mentions
     * nobody. The name still reads exactly as typed.
     */
    const name: string =
      FeedPersonName.getMemberName({ name: user.name, email: user.email }) ||
      "User";

    return mdText`[${name}](${(await UserService.getUserLinkInDashboard(this.projectId!, userId)).toString()})`;
  }

  private async readText(userId: ObjectID): Promise<string> {
    const user: User | null = await FeedPersonName.readUser(userId);

    if (!user) {
      return "";
    }

    const standing: FeedPersonStanding = await this.getStanding(userId);

    if (!standing) {
      return FEED_NOBODY_NAMED;
    }

    if (standing.isInvited) {
      return standing.name;
    }

    return (
      FeedPersonName.getMemberName({ name: user.name, email: user.email }) ||
      FEED_NOBODY_NAMED
    );
  }

  private async readStanding(userId: ObjectID): Promise<FeedPersonStanding> {
    // With no project, nobody is pending to it.
    if (!this.projectId) {
      return { isInvited: false };
    }

    try {
      const withheld: Map<string, WithheldProfile> =
        await PendingInviteeProfiles.readWithheldProfilesInProject({
          userIds: [userId.toString()],
          projectId: this.projectId,
        });

      const profile: WithheldProfile | undefined =
        PendingInviteeProfiles.getWithheldProfile({
          userId: userId,
          withheld: withheld,
        });

      return profile
        ? {
            isInvited: true,
            name: FeedPersonName.getInviteeName(profile),
            isNamed: Boolean(
              FeedPersonName.getDisplayName(profile.inviteeName),
            ),
          }
        : { isInvited: false };
    } catch (err) {
      FeedPersonName.logUnread(this.projectId, err);

      return null;
    }
  }

  /*
   * The person, as OneUptime: a line names whoever it is about. An id that
   * is not there is not a harmless lookup - the id key would drop out of
   * the WHERE clause and match an arbitrary user - so it is never asked.
   */
  private static async readUser(userId: ObjectID): Promise<User | null> {
    return await UserService.findOneBy({
      query: {
        _id: userId,
      },
      select: {
        name: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  private static logUnread(projectId: ObjectID, err: unknown): void {
    logger.error(
      "Could not read whether somebody a feed entry or channel line names is only invited to the project; the line names them as Somebody.",
      { projectId: projectId.toString() } as LogAttributes,
    );
    logger.error(err, {
      projectId: projectId.toString(),
    } as LogAttributes);
  }
}
