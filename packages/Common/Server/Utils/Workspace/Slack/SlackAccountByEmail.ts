import ObjectID from "../../../../Types/ObjectID";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import SlackChannelMembers, { SlackPersonFacts } from "./SlackChannelMembers";

/*
 * WHO A ONEUPTIME MEMBER IS IN SLACK, FOUND BY THEIR EMAIL ADDRESS.
 *
 * Somebody who has not connected their Slack account to OneUptime is still
 * somebody to add to a record's channel: the Slack account with their
 * OneUptime email address is theirs. Add people on a record's page finds
 * them so (WorkspaceChannelMembers), and so do a notification rule's channel
 * invitations (WorkspaceNotificationRuleService.findWorkspaceUserIdsToInvite).
 * It never decides who acts: a press, a command or a reaction acts only as
 * the account a sign-in connected.
 *
 * What Slack answered is remembered per project and member - an hour for an
 * account, ten minutes for none - so the record's page and the rules ask
 * Slack once between them. A cache that cannot be read or written asks
 * Slack every time.
 */

// The Slack account with a member's email address.
export interface SlackEmailAccount {
  slackUserId: string;
  // A guest's account: Slack keeps guests out of most channels.
  isGuest: boolean;
}

const CACHE_NAMESPACE: string = "workspace-slack-account-by-email";
const ACCOUNT_CACHE_SECONDS: number = 60 * 60;
const NO_ACCOUNT_CACHE_SECONDS: number = 10 * 60;

/*
 * What the cache holds for a member nobody in Slack has the email address
 * of. Never a Slack id, which is upper-case letters and digits.
 */
const NO_ACCOUNT: string = "-";

// After a guest's Slack id in the cache.
const GUEST_SUFFIX: string = ":guest";

export default class SlackAccountByEmail {
  /*
   * The Slack account with the member's email address. Null when there is
   * none, and for a deactivated account or a bot, which are nobody to add.
   * `useCache` lets an earlier answer stand; without it Slack is asked, and
   * its answer remembered. Throws what Slack answered when it refuses
   * (SlackChannelMembersError).
   */
  @CaptureSpan()
  public static async find(data: {
    projectId: ObjectID;
    authToken: string;
    userId: ObjectID;
    email: string;
    useCache: boolean;
  }): Promise<SlackEmailAccount | null> {
    const email: string = data.email.trim().toLowerCase();

    if (!email) {
      return null;
    }

    const cacheKey: string = `${data.projectId.toString()}:${data.userId
      .toString()
      .toLowerCase()}`;

    if (data.useCache) {
      const cached: string | null =
        await SlackAccountByEmail.readCache(cacheKey);

      if (cached === NO_ACCOUNT) {
        return null;
      }

      if (cached) {
        return SlackAccountByEmail.fromCacheValue(cached);
      }
    }

    const person: SlackPersonFacts | null =
      await SlackChannelMembers.findPersonByEmail({
        authToken: data.authToken,
        email: email,
      });

    const account: SlackEmailAccount | null =
      person && !person.isDeactivated && !person.isBot
        ? { slackUserId: person.id, isGuest: person.isGuest }
        : null;

    await SlackAccountByEmail.writeCache({
      key: cacheKey,
      value: account ? SlackAccountByEmail.toCacheValue(account) : NO_ACCOUNT,
      expiresInSeconds: account
        ? ACCOUNT_CACHE_SECONDS
        : NO_ACCOUNT_CACHE_SECONDS,
    });

    return account;
  }

  public static toCacheValue(account: SlackEmailAccount): string {
    return account.isGuest
      ? `${account.slackUserId}${GUEST_SUFFIX}`
      : account.slackUserId;
  }

  public static fromCacheValue(value: string): SlackEmailAccount {
    if (value.endsWith(GUEST_SUFFIX)) {
      return {
        slackUserId: value.slice(0, -GUEST_SUFFIX.length),
        isGuest: true,
      };
    }

    return { slackUserId: value, isGuest: false };
  }

  private static async readCache(key: string): Promise<string | null> {
    try {
      return await GlobalCache.getString(CACHE_NAMESPACE, key);
    } catch {
      return null;
    }
  }

  private static async writeCache(data: {
    key: string;
    value: string;
    expiresInSeconds: number;
  }): Promise<void> {
    try {
      await GlobalCache.setString(CACHE_NAMESPACE, data.key, data.value, {
        expiresInSeconds: data.expiresInSeconds,
      });
    } catch {
      // Without the cache, the next read asks Slack again.
    }
  }
}
