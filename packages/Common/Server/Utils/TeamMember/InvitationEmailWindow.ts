import Redis, { ClientType } from "../../Infrastructure/Redis";
import logger from "../Logger";
import PublicMessageRateLimit from "../RateLimit/PublicMessageRateLimit";
import ObjectID from "../../../Types/ObjectID";

/*
 * ONE INVITATION EMAIL FROM A PROJECT TO A PERSON PER WINDOW (#10179).
 *
 * A SCIM connection that creates a user, deletes them and creates them
 * again - an identity provider retrying, or a script holding the
 * connection's token - made a new invitation each time, because each delete
 * removed the one before, and each was emailed: only the per-address limit
 * stopped it. A dashboard invitation to another team of a project that has
 * just invited the person mailed them again too.
 *
 * Now the first invitation email a project sends a person opens a window as
 * long as the invitation limit's (PublicMessageRateLimit's contact window,
 * an hour). Until it ends, another invitation from that project to that
 * person is made as before - their membership, pending - but sends no email:
 * the one they were sent stands, and accepting it accepts every team of the
 * project. Resend Invitation still sends one (and starts the window again),
 * and the window ends early once the person accepts an invitation into the
 * project or declines one, so a project that invites them again after that
 * mails them as it would anyone.
 *
 * Kept per project, so one project's invitations never change what another's
 * do, and by the person's account, so a change of address does not open a
 * second window. What it says is about the project's own invitations, which
 * the project knows already.
 *
 * In Valkey, like the limits: one key per project and person, set only if
 * absent, so of two invitations racing only one sends. While Valkey cannot be
 * reached every invitation is emailed, as every invitation went out
 * uncounted before (fail open): a person may be mailed twice, but never left
 * without their invitation.
 */

// The namespace of the windows' keys: no limit's counter shares it.
const KEY_PREFIX: string = "invitation-email-window:";

// What claim answers: whether this invitation sends the email.
export interface InvitationEmailWindowClaim {
  /*
   * True when this invitation opened the window, so it is the one that
   * emails the person - or when no window can be read (fail open). False
   * when the project emailed them within the window already.
   */
  isClaimed: boolean;
  /*
   * Closes the window this invitation opened, for an invitation that ended
   * with nothing sent, so the next one emails them. Never throws; does
   * nothing for a claim that opened none, and closes once.
   */
  release: () => Promise<void>;
}

const NOTHING_TO_RELEASE: () => Promise<void> = async (): Promise<void> => {
  // A claim that opened no window has none to close.
};

export default class InvitationEmailWindow {
  // How long a window lasts, in seconds: the invitation limit's window.
  public static getWindowSeconds(): number {
    return PublicMessageRateLimit.getConfig().contactWindowSeconds;
  }

  // The key of one project's window for one person.
  public static getKey(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): string {
    return `${KEY_PREFIX}${data.projectId.toString().toLowerCase()}:${data.userId
      .toString()
      .toLowerCase()}`;
  }

  /*
   * For an invitation about to email a person: opens the project's window
   * for them and answers that it may send, or answers that the project
   * emailed them within the window already.
   */
  public static async claim(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<InvitationEmailWindowClaim> {
    const client: ClientType | null = InvitationEmailWindow.getClient();

    if (!client) {
      return { isClaimed: true, release: NOTHING_TO_RELEASE };
    }

    const key: string = InvitationEmailWindow.getKey(data);

    try {
      const opened: string | null = await client.set(
        key,
        "1",
        "EX",
        InvitationEmailWindow.getWindowSeconds(),
        "NX",
      );

      if (opened !== "OK") {
        return { isClaimed: false, release: NOTHING_TO_RELEASE };
      }
    } catch (err) {
      InvitationEmailWindow.warn(
        "could not open an invitation email window",
        err,
      );
      return { isClaimed: true, release: NOTHING_TO_RELEASE };
    }

    let isReleased: boolean = false;

    return {
      isClaimed: true,
      release: async (): Promise<void> => {
        if (isReleased) {
          return;
        }

        isReleased = true;

        await InvitationEmailWindow.deleteKeys([key]);
      },
    };
  }

  /*
   * A Resend Invitation sent the person their email again: the project's
   * window for them starts again from now.
   */
  public static async renew(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    const client: ClientType | null = InvitationEmailWindow.getClient();

    if (!client) {
      return;
    }

    try {
      await client.set(
        InvitationEmailWindow.getKey(data),
        "1",
        "EX",
        InvitationEmailWindow.getWindowSeconds(),
      );
    } catch (err) {
      InvitationEmailWindow.warn(
        "could not start an invitation email window again",
        err,
      );
    }
  }

  /*
   * The person accepted an invitation into the project, or declined one:
   * the project's window for them ends, so its next invitation emails them.
   */
  public static async end(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
  }): Promise<void> {
    await InvitationEmailWindow.deleteKeys(
      data.userIds.map((userId: ObjectID): string => {
        return InvitationEmailWindow.getKey({
          projectId: data.projectId,
          userId: userId,
        });
      }),
    );
  }

  private static async deleteKeys(keys: Array<string>): Promise<void> {
    if (keys.length === 0) {
      return;
    }

    const client: ClientType | null = InvitationEmailWindow.getClient();

    if (!client) {
      return;
    }

    try {
      await client.del(...keys);
    } catch (err) {
      // Left to end with its expiry: the next invitation in it sends nothing.
      InvitationEmailWindow.warn(
        "could not end an invitation email window",
        err,
      );
    }
  }

  private static getClient(): ClientType | null {
    const client: ClientType | null = Redis.getClient();

    return client && Redis.isConnected() ? client : null;
  }

  private static warn(what: string, err: unknown): void {
    logger.warn(`InvitationEmailWindow: ${what}.`);
    logger.warn(err);
  }
}
