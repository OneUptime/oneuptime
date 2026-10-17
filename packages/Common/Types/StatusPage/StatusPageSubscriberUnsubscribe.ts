import URL from "../API/URL";

/*
 * The unsubscribe link every status page subscriber notification carries, and
 * what the status page's unsubscribe page and its API say about one.
 *
 * WHY A TOKEN
 *
 * The link used to be the subscriber's manage page,
 * {statusPageUrl}/update-subscription/{subscriberId}. On a private status page
 * that page, like everything else on the page, needs a signed-in visitor - and
 * the people a private page emails are often not people who have an account on
 * it (a site's staff, a mailing list). So an internal audience had no way to
 * stop the emails. The link now carries a random token that belongs to the one
 * subscription (StatusPageSubscriber.unsubscribeToken): holding the link is
 * what lets its recipient unsubscribe, signed in or not, on a public page or a
 * private one, and nothing about the page itself is shown to them.
 *
 * WHY A CONFIRMATION
 *
 * Opening the link changes nothing. Mail scanners and link previewers fetch
 * every link in a message, and a single stray click is not a decision - least
 * of all for an address a team added on purpose, such as a site's mailing
 * list, where one reader could otherwise take the whole site off the list. The
 * page asks, and only its POST unsubscribes.
 *
 * THE LINK'S SHAPE
 *
 *   {statusPageUrl}/unsubscribe/{subscriberId}-{token}
 *
 * The subscriber id and the token travel as ONE path segment on purpose. The
 * status page registers "unsubscribe" as a route whose next segment is a
 * bearer credential (Common/Server/Views/Partials/SensitiveUrlToken.ejs), so
 * the credential is moved out of the address bar before any analytics tag a
 * status page loads can report it - the same treatment a password reset link
 * gets. That mechanism strips exactly one segment. The id is kept in the
 * credential so the server can find the subscription by its primary key and
 * compare the token in constant time, rather than look the token itself up.
 *
 * A credential with no token - just the id - is what an out-of-date link
 * leads to (see StatusPageSubscriberAPI's old GET route); the page then says
 * the link has expired instead of offering to unsubscribe.
 *
 * THE MANAGE LINK CARRIES THE SAME CREDENTIAL
 *
 *   {statusPageUrl}/update-subscription/{subscriberId}-{token}
 *
 * The subscriber's manage page (Update Subscription) reads the subscription's
 * contact and choices, changes them and cancels the subscription, so it asks
 * for exactly what the unsubscribe page asks for: the subscription's token.
 * The subscriber id alone is not a secret - every project member who may read
 * subscribers sees it, read-only roles included, and every log that names a
 * subscription keeps it - so a link keyed by the id alone let anyone who could
 * read about a subscription change it. Every link that opens one of the two
 * pages is sent only to the subscription's own contact, and every copy of a
 * message that is kept for others to read has its token redacted
 * (redactCredentials).
 *
 * Browser-safe: the status page app, the server and the workers all use this
 * file, so they agree on the link, the credential and the answers.
 */

// What the unsubscribe API answers about a link, before and after confirming.
export enum StatusPageSubscriberUnsubscribeState {
  // The link is good and the subscription is live: the page asks to confirm.
  Subscribed = "Subscribed",
  // The link is good and the subscription is already cancelled.
  Unsubscribed = "Unsubscribed",
  /*
   * Everything else: a wrong token, a subscriber that does not exist or was
   * deleted, one on another status page, or a malformed link. One answer for
   * all of them, so the API cannot be used to find out which subscriptions
   * exist.
   */
  Invalid = "Invalid",
}

/*
 * What the manage page's API answers for every link that does not open a
 * subscription: a wrong or missing token, a subscriber that does not exist or
 * was deleted, one on another status page, a malformed link. One answer for
 * all of them, as the unsubscribe API gives, so it cannot be used to find out
 * which subscriptions exist. The status page shows its own words for it.
 */
export const MANAGE_SUBSCRIPTION_LINK_NOT_VALID_MESSAGE: string =
  "This link to manage the subscription has expired or is not valid. To get a new one, use Manage Existing Subscription on the status page's Subscribe page.";

// Which kind of subscription a link belongs to, so the page can name it.
export enum StatusPageSubscriberUnsubscribeChannel {
  Email = "Email",
  SMS = "SMS",
  Slack = "Slack",
  MicrosoftTeams = "MicrosoftTeams",
  Webhook = "Webhook",
}

export interface StatusPageSubscriberUnsubscribeDetails {
  state: StatusPageSubscriberUnsubscribeState;
  /*
   * Only for a valid link: the subscription's channel and the contact the
   * page shows so its reader knows what they are unsubscribing (an email
   * address in full, a phone number masked, a workspace name or a webhook's
   * host). Never the token.
   */
  channel?: StatusPageSubscriberUnsubscribeChannel | undefined;
  contact?: string | undefined;
  /*
   * Whether the status page's team added this subscription (rather than its
   * owner signing up). The page then warns that the address may be shared,
   * and that the team will be told.
   */
  wasAddedByTeam?: boolean | undefined;
}

export interface StatusPageSubscriberUnsubscribeCredential {
  subscriberId: string;
  // null for an out-of-date link that carries only the subscriber id.
  token: string | null;
}

/*
 * Anything that looks like a subscriber: the model, or the plain object a
 * query hands back. The contact columns are typed loosely so the model's
 * Email, Phone and URL value types fit without importing them here.
 */
export interface StatusPageSubscriberContactFields {
  subscriberEmail?: { toString(): string } | string | null | undefined;
  subscriberPhone?: { toString(): string } | string | null | undefined;
  slackIncomingWebhookUrl?: { toString(): string } | string | null | undefined;
  slackWorkspaceName?: string | null | undefined;
  microsoftTeamsIncomingWebhookUrl?:
    | { toString(): string }
    | string
    | null
    | undefined;
  microsoftTeamsWorkspaceName?: string | null | undefined;
  subscriberWebhook?: { toString(): string } | string | null | undefined;
}

export interface StatusPageSubscriberContact {
  channel: StatusPageSubscriberUnsubscribeChannel;
  // May be empty, e.g. a Slack subscription with no workspace name.
  contact: string;
}

const UUID_PATTERN: string =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

const TOKEN_PATTERN: RegExp = /^[0-9a-f]{64}$/;

const CREDENTIAL_PATTERN: RegExp = new RegExp(
  `^(${UUID_PATTERN})(?:-([0-9a-fA-F]{64}))?$`,
);

/*
 * A subscription link's credential anywhere in a text: the route segment of
 * the unsubscribe page or of the manage page, the subscriber id, and the 64
 * hex characters of its token. No lookahead after the token, so a token that
 * some template runs straight into more text is still caught. Linear: the two
 * route segments are literals and everything after them has a fixed length.
 */
const LINK_TOKEN_PATTERN: RegExp = new RegExp(
  `(/(?:unsubscribe|update-subscription)/${UUID_PATTERN})-[0-9a-fA-F]{64}`,
  "g",
);

export default class StatusPageSubscriberUnsubscribe {
  /*
   * The status page route segment the link opens, on both a custom domain
   * (/unsubscribe/...) and the page's own address (/status-page/{id}/unsubscribe/...).
   * SensitiveUrlToken.ejs and Common/UI/Utils/SensitiveUrlToken.ts list it
   * as a token-bearing route.
   */
  public static readonly PAGE_ROUTE_SEGMENT: string = "unsubscribe";

  /*
   * The route segment of the subscriber's manage page (Update Subscription),
   * whose link carries the same credential. SensitiveUrlToken lists it as a
   * token-bearing route too.
   */
  public static readonly MANAGE_PAGE_ROUTE_SEGMENT: string =
    "update-subscription";

  /*
   * 32 random bytes as lowercase hex (StatusPageSubscriberUnsubscribeToken
   * generates them; the migration backfills the same shape from two random
   * UUIDs with their dashes removed).
   */
  public static readonly TOKEN_LENGTH: number = 64;

  // What redactCredentials puts where a token was.
  public static readonly REDACTED_TOKEN: string = "[redacted]";

  public static isWellFormedToken(value: unknown): value is string {
    return typeof value === "string" && TOKEN_PATTERN.test(value);
  }

  /*
   * The text with the token of every unsubscribe link and every manage link
   * in it replaced by "[redacted]": ".../unsubscribe/{id}-[redacted]",
   * ".../update-subscription/{id}-[redacted]".
   *
   * For any copy of a message that is kept where people other than its
   * recipient can read it. The token is the whole of what lets the link's
   * holder cancel or change the subscription, on a private status page too,
   * so it may only ever leave the server inside the message to the
   * subscription's own contact. An SMS is the case in point: the SMS log keeps
   * its text, and project members who may not touch subscribers (Viewer, and
   * any role with Read SMS Log) can read that log. The id is kept, so the log
   * still says which subscription the message went to - and the id alone
   * opens neither page.
   */
  public static redactCredentials(text: string): string {
    if (!text || typeof text !== "string") {
      return text;
    }

    return text.replace(
      LINK_TOKEN_PATTERN,
      `$1-${StatusPageSubscriberUnsubscribe.REDACTED_TOKEN}`,
    );
  }

  /*
   * The one path segment the link carries: "{subscriberId}-{token}", or just
   * the id when there is no token.
   */
  public static buildCredential(data: {
    subscriberId: { toString(): string } | string;
    unsubscribeToken?: string | null | undefined;
  }): string {
    const subscriberId: string = data.subscriberId.toString().toLowerCase();

    if (
      !StatusPageSubscriberUnsubscribe.isWellFormedToken(data.unsubscribeToken)
    ) {
      return subscriberId;
    }

    return `${subscriberId}-${data.unsubscribeToken}`;
  }

  /*
   * Read a credential back. Returns null for anything that is not one - a
   * stale token from another flow that shares the same sessionStorage slot,
   * a truncated link, a guess - so the page can show its "invalid link"
   * state without asking the server.
   */
  public static parseCredential(
    value: string | null | undefined,
  ): StatusPageSubscriberUnsubscribeCredential | null {
    if (!value || typeof value !== "string") {
      return null;
    }

    const match: RegExpMatchArray | null = value
      .trim()
      .match(CREDENTIAL_PATTERN);

    if (!match || !match[1]) {
      return null;
    }

    return {
      subscriberId: match[1].toLowerCase(),
      token: match[2] ? match[2].toLowerCase() : null,
    };
  }

  /*
   * The link that goes into every subscriber notification - on every channel,
   * an SMS included, and on public and private status pages alike. Without a
   * token - which only a subscription created around the migration could
   * lack - the link still leads somewhere useful: the page that says the link
   * is out of date and what to do instead.
   *
   * An SMS from a public status page used to carry the shorter manage link,
   * keyed by the subscriber id alone, to save the characters. Once the manage
   * page asks for the token too, that link is the longer of the two, and the
   * unsubscribe page offers the manage page on a public status page anyway.
   */
  public static buildLink(data: {
    statusPageUrl: URL | string;
    subscriberId: { toString(): string } | string;
    unsubscribeToken?: string | null | undefined;
  }): URL {
    return URL.fromString(data.statusPageUrl.toString()).addRoute(
      `/${StatusPageSubscriberUnsubscribe.PAGE_ROUTE_SEGMENT}/${StatusPageSubscriberUnsubscribe.buildCredential(
        {
          subscriberId: data.subscriberId,
          unsubscribeToken: data.unsubscribeToken,
        },
      )}`,
    );
  }

  /*
   * The subscriber's manage page, where a subscriber chooses which resources
   * and event types they hear about, or cancels: what the "manage your
   * subscription" message a visitor asks for from the Subscribe page links to.
   * It carries the same credential as the unsubscribe link, and the page and
   * its API ask for the token (see THE MANAGE LINK CARRIES THE SAME
   * CREDENTIAL above). On a private status page the page also needs a
   * signed-in visitor, since it shows the page's resources.
   *
   * Without a token the link leads to the manage page's "this link has
   * expired" state, which says how to get a new one.
   */
  public static buildManageSubscriptionLink(data: {
    statusPageUrl: URL | string;
    subscriberId: { toString(): string } | string;
    unsubscribeToken?: string | null | undefined;
  }): URL {
    return URL.fromString(data.statusPageUrl.toString()).addRoute(
      `/${StatusPageSubscriberUnsubscribe.MANAGE_PAGE_ROUTE_SEGMENT}/${StatusPageSubscriberUnsubscribe.buildCredential(
        {
          subscriberId: data.subscriberId,
          unsubscribeToken: data.unsubscribeToken,
        },
      )}`,
    );
  }

  /*
   * What the unsubscribe page names the subscription by. An email address is
   * shown in full: it is where the link was sent, and recognising a shared
   * address such as site03-all@ is the point. A phone number is masked to its
   * last four digits. Slack and Teams show the workspace name they were
   * registered with, and a webhook only its host - never a webhook URL, which
   * is itself a credential.
   *
   * The team's own notice about an unsubscribe passes maskPhone: false - the
   * team can read the number on the dashboard already, and needs it to know
   * which subscriber left.
   */
  public static describeContact(
    subscriber: StatusPageSubscriberContactFields,
    options?: { maskPhone?: boolean | undefined } | undefined,
  ): StatusPageSubscriberContact | null {
    const text: (value: unknown) => string = (value: unknown): string => {
      if (value === null || value === undefined) {
        return "";
      }

      return String(value).trim();
    };

    const email: string = text(subscriber.subscriberEmail);

    if (email) {
      return {
        channel: StatusPageSubscriberUnsubscribeChannel.Email,
        contact: email,
      };
    }

    const phone: string = text(subscriber.subscriberPhone);

    if (phone) {
      return {
        channel: StatusPageSubscriberUnsubscribeChannel.SMS,
        contact:
          options?.maskPhone === false
            ? phone
            : StatusPageSubscriberUnsubscribe.maskPhone(phone),
      };
    }

    if (
      text(subscriber.slackIncomingWebhookUrl) ||
      text(subscriber.slackWorkspaceName)
    ) {
      return {
        channel: StatusPageSubscriberUnsubscribeChannel.Slack,
        contact: text(subscriber.slackWorkspaceName),
      };
    }

    if (
      text(subscriber.microsoftTeamsIncomingWebhookUrl) ||
      text(subscriber.microsoftTeamsWorkspaceName)
    ) {
      return {
        channel: StatusPageSubscriberUnsubscribeChannel.MicrosoftTeams,
        contact: text(subscriber.microsoftTeamsWorkspaceName),
      };
    }

    const webhook: string = text(subscriber.subscriberWebhook);

    if (webhook) {
      return {
        channel: StatusPageSubscriberUnsubscribeChannel.Webhook,
        contact: StatusPageSubscriberUnsubscribe.hostOf(webhook),
      };
    }

    return null;
  }

  // Every digit but the last four replaced, so the number is recognisable only to its owner.
  public static maskPhone(phone: string): string {
    const digitCount: number = (phone.match(/\d/g) || []).length;
    let digitsSeen: number = 0;

    return phone.replace(/\d/g, (digit: string): string => {
      digitsSeen++;
      return digitsSeen > digitCount - 4 ? digit : "•";
    });
  }

  private static hostOf(url: string): string {
    const match: RegExpMatchArray | null = url.match(
      /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/,
    );

    return match && match[1] ? match[1].toLowerCase() : "";
  }
}
