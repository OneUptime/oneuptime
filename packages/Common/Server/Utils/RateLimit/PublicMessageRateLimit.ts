import { createHash } from "crypto";
import Redis, { ClientType } from "../../Infrastructure/Redis";
import { ExpressRequest, ExpressResponse } from "../Express";
import logger from "../Logger";
import resolveTrustedClientIp, { ClientIpRequestLike } from "../ClientIp";
import ClientRateLimitCounter, {
  ClientRateLimitCounterSpec,
  ClientRateLimitRefusal,
  FixedRateLimitCounterSpec,
} from "./ClientRateLimitCounter";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";

/*
 * MESSAGES THAT A PUBLIC ROUTE SENDS TO AN ADDRESS ITS CALLER NAMES.
 *
 * A few routes anyone can call without signing in send a message to an
 * email address, a phone number, a chat channel or a webhook that the
 * request itself names:
 *
 *  - a sign-up on a status page (POST /status-page/subscribe/:statusPageId):
 *    a confirmation email, a text message, a Slack or Microsoft Teams post,
 *    or a webhook call, as each subscriber is created;
 *  - asking a status page for a subscription's manage link
 *    (POST /status-page/manage-subscription/:statusPageId), which goes to
 *    the subscription the request names;
 *  - forgetting a status page private user's password
 *    (POST /identity/status-page/forgot-password);
 *  - forgetting an account's password (POST /identity/forgot-password);
 *  - signing up for an account (POST /identity/signup), which emails the
 *    address signed up with.
 *
 * Nothing upstream of them counts anything, so each one would send as many
 * messages as a caller asked for: to people who never asked for them, and
 * - a text message is paid for from the project's balance - on the
 * project's bill. Every one of them therefore asks this limiter right before
 * it sends, and is refused when either of two things has had enough:
 *
 *  - THE CLIENT. The caller's address (and, for an IPv6 caller, its /64,
 *    with room for ten addresses - ClientRateLimitCounter) may send so many
 *    messages of each kind in a quarter of an hour, and so many text
 *    messages of every kind together. Without it one caller sends to as
 *    many addresses as it can name.
 *
 *  - THE CONTACT. Each email address, phone number, chat channel and webhook
 *    may be sent so many messages of each kind in an hour, from every caller
 *    together. Without it a caller with many addresses still sends one
 *    person as many messages as it likes.
 *
 * A contact's counter is spent only by a request its caller's own counters
 * let through, so a caller who is already refused cannot keep a contact's
 * allowance used up from one address. One that is let through and spends it
 * has sent that contact the message too: a password reset or a manage link
 * that works, which its owner can use.
 *
 * The limits are sized for people, generously, because the people behind
 * one address - an office, a campus, a carrier's network - sign up together
 * when an incident is on. A sign-up, a link or a reset is something a person
 * does once or twice; the limits sit far past that, and stop only a caller
 * that sends as fast as it can.
 *
 * WHAT FAILS OPEN AND WHAT FAILS CLOSED
 *
 * When the counter cannot be reached, a request that would send a text
 * message is refused (503): a text is paid for by the project, and this
 * counter is the only bound on how many a public page can make it pay for.
 * Anything else is let through uncounted, with a throttled warning, as it
 * was before these limits existed: refusing every sign-up and password reset
 * for as long as Redis is away costs real people more than an email that
 * goes out uncounted for that while.
 */

export enum PublicMessageKind {
  // POST /status-page/subscribe/:statusPageId: a new subscription.
  StatusPageSignUp = "status-page-sign-up",

  // POST /status-page/manage-subscription/:statusPageId.
  StatusPageManageLink = "status-page-manage-link",

  // POST /identity/status-page/forgot-password.
  StatusPagePasswordReset = "status-page-password-reset",

  // POST /identity/forgot-password.
  PasswordReset = "password-reset",

  // POST /identity/signup: a new account's welcome, or an invitation's link.
  SignUpEmail = "sign-up-email",
}

// Where a message goes.
export enum PublicMessageChannel {
  Email = "email",
  TextMessage = "text-message",
  Slack = "slack",
  MicrosoftTeams = "microsoft-teams",
  Webhook = "webhook",
}

// Which counter refused a request.
export enum PublicMessageRateLimitScope {
  // The caller's messages of this kind.
  Client = "client",

  // The caller's text messages, of every kind together.
  ClientTextMessages = "client-text-messages",

  // The messages of this kind to one contact, from every caller.
  Contact = "contact",
}

export enum PublicMessageRateLimitOutcome {
  Allowed = "allowed",
  RateLimited = "rate-limited",

  // Redis is unreachable, so no limit can be honoured either way.
  CounterUnavailable = "counter-unavailable",
}

/*
 * One contact a request would send a message to: its channel, and the
 * canonical form it is counted under (see the for* helpers below). Only a
 * hash of that form is ever written to Redis.
 */
export interface PublicMessageContact {
  channel: PublicMessageChannel;
  canonical: string;
}

export interface PublicMessageRateLimitDecision {
  outcome: PublicMessageRateLimitOutcome;
  retryAfterSeconds?: number | undefined;

  // Which counter refused, for the answer and the log. Unset unless refused.
  scope?: PublicMessageRateLimitScope | undefined;

  // The contact whose counter refused, when it was a contact's.
  contact?: PublicMessageContact | undefined;

  /*
   * The caller's IPv6 /64 when the addresses of that /64 together went over
   * the limit, rather than the caller's own address. For the log.
   */
  ipv6Network64?: string | undefined;

  // True only for the first refusal of a window: the one worth a log line.
  isFirstRejectionInWindow?: boolean | undefined;
}

export interface PublicMessageKindConfig {
  // Messages of this kind one client address may cause per client window.
  perClientLimit: number;

  // Messages of this kind one contact may be sent per contact window.
  perContactLimit: number;
}

export interface PublicMessageRateLimitConfig {
  // The window of the client counters, in seconds.
  clientWindowSeconds: number;

  // The window of the contact counters, in seconds.
  contactWindowSeconds: number;

  /*
   * Text messages one client address may cause per client window, of every
   * kind together.
   */
  perClientTextMessageLimit: number;

  kinds: Record<PublicMessageKind, PublicMessageKindConfig>;
}

/*
 * A request this limiter refused, carrying when to come back. Thrown from
 * route handlers and services, where there may be no response at hand to
 * write a header on: the route writes it as Retry-After (setRetryAfterFor)
 * before the error handler answers 429.
 */
export class PublicMessageRateLimitException extends TooManyRequestsException {
  public readonly retryAfterSeconds: number;

  public constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const parsePositiveIntFromEnv: (name: string, fallback: number) => number = (
  name: string,
  fallback: number,
): number => {
  const rawValue: string | undefined =
    process.env[`PUBLIC_MESSAGE_RATE_LIMIT_${name}`];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue: number = parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
};

/*
 * The limits, each from a PUBLIC_MESSAGE_RATE_LIMIT_* environment variable
 * of the app.
 *
 * Status page sign-ups: sixty from one address in a quarter of an hour. A
 * sign-up is one person subscribing one contact; a whole office signing up
 * to the page of a vendor that is down is a few dozen at most. Ten to one
 * contact in an hour: one person subscribing their address to the status
 * pages of every service they rely on, in one sitting.
 *
 * Manage links: thirty requests from one address in a quarter of an hour,
 * and five to one contact in an hour - a person who lost the link asks once
 * or twice. Counted whether or not the contact is subscribed, so a refusal
 * says nothing about who is.
 *
 * Password resets, of an account and of a status page's private user:
 * thirty from one address in a quarter of an hour, and five to one address
 * in an hour. Each reset link replaces the last, so a person needs one; five
 * is room for a slow inbox.
 *
 * The emails a sign-up for an account sends: sixty from one address in a
 * quarter of an hour - a class or a workshop signs up together, on one
 * network - and five to one address in an hour.
 *
 * Text messages: ten from one address in a quarter of an hour, of every kind
 * together (sign-ups by text and manage links by text). A text is paid for
 * from the project's balance, and nobody needs more.
 */
const CONFIG: PublicMessageRateLimitConfig = {
  clientWindowSeconds: parsePositiveIntFromEnv("WINDOW_SECONDS", 15 * 60),
  contactWindowSeconds: parsePositiveIntFromEnv(
    "PER_CONTACT_WINDOW_SECONDS",
    60 * 60,
  ),
  perClientTextMessageLimit: parsePositiveIntFromEnv("TEXT_MESSAGES_PER_IP", 10),
  kinds: {
    [PublicMessageKind.StatusPageSignUp]: {
      perClientLimit: parsePositiveIntFromEnv("STATUS_PAGE_SIGN_UPS_PER_IP", 60),
      perContactLimit: parsePositiveIntFromEnv(
        "STATUS_PAGE_SIGN_UPS_PER_CONTACT",
        10,
      ),
    },
    [PublicMessageKind.StatusPageManageLink]: {
      perClientLimit: parsePositiveIntFromEnv(
        "STATUS_PAGE_MANAGE_LINKS_PER_IP",
        30,
      ),
      perContactLimit: parsePositiveIntFromEnv(
        "STATUS_PAGE_MANAGE_LINKS_PER_CONTACT",
        5,
      ),
    },
    [PublicMessageKind.StatusPagePasswordReset]: {
      perClientLimit: parsePositiveIntFromEnv(
        "STATUS_PAGE_PASSWORD_RESETS_PER_IP",
        30,
      ),
      perContactLimit: parsePositiveIntFromEnv(
        "STATUS_PAGE_PASSWORD_RESETS_PER_CONTACT",
        5,
      ),
    },
    [PublicMessageKind.PasswordReset]: {
      perClientLimit: parsePositiveIntFromEnv("PASSWORD_RESETS_PER_IP", 30),
      perContactLimit: parsePositiveIntFromEnv(
        "PASSWORD_RESETS_PER_CONTACT",
        5,
      ),
    },
    [PublicMessageKind.SignUpEmail]: {
      perClientLimit: parsePositiveIntFromEnv("SIGN_UP_EMAILS_PER_IP", 60),
      perContactLimit: parsePositiveIntFromEnv(
        "SIGN_UP_EMAILS_PER_CONTACT",
        5,
      ),
    },
  },
};

// What a caller refused by its own counters is told, by kind.
const CLIENT_REFUSALS: Record<PublicMessageKind, string> = {
  [PublicMessageKind.StatusPageSignUp]:
    "Too many sign-ups from your network. Please wait a few minutes and try again.",
  [PublicMessageKind.StatusPageManageLink]:
    "Too many links asked for from your network. Please wait a few minutes and try again.",
  [PublicMessageKind.StatusPagePasswordReset]:
    "Too many password resets asked for from your network. Please wait a few minutes and try again.",
  [PublicMessageKind.PasswordReset]:
    "Too many password resets asked for from your network. Please wait a few minutes and try again.",
  [PublicMessageKind.SignUpEmail]:
    "Too many sign-ups from your network. Please wait a few minutes and try again.",
};

// What a caller refused for its text messages is told, by kind.
const CLIENT_TEXT_MESSAGE_REFUSALS: Record<PublicMessageKind, string> = {
  [PublicMessageKind.StatusPageSignUp]:
    "Too many sign-ups by text message from your network. Please wait a few minutes and try again.",
  [PublicMessageKind.StatusPageManageLink]:
    "Too many links asked for by text message from your network. Please wait a few minutes and try again.",
  [PublicMessageKind.StatusPagePasswordReset]:
    CLIENT_REFUSALS[PublicMessageKind.StatusPagePasswordReset],
  [PublicMessageKind.PasswordReset]:
    CLIENT_REFUSALS[PublicMessageKind.PasswordReset],
  [PublicMessageKind.SignUpEmail]: CLIENT_REFUSALS[PublicMessageKind.SignUpEmail],
};

// How a refusal names a contact.
const CONTACT_NAMES: Record<PublicMessageChannel, string> = {
  [PublicMessageChannel.Email]: "this email address",
  [PublicMessageChannel.TextMessage]: "this phone number",
  [PublicMessageChannel.Slack]: "this Slack channel",
  [PublicMessageChannel.MicrosoftTeams]: "this Microsoft Teams channel",
  [PublicMessageChannel.Webhook]: "this webhook",
};

/*
 * What a caller refused for a contact's counter is told, by kind. The
 * same words whether or not the contact is subscribed, or has an account.
 */
const CONTACT_REFUSALS: Record<
  PublicMessageKind,
  (contactName: string) => string
> = {
  [PublicMessageKind.StatusPageSignUp]: (contactName: string): string => {
    return `Too many sign-ups for ${contactName} in the last hour. Please try again later.`;
  },
  [PublicMessageKind.StatusPageManageLink]: (contactName: string): string => {
    return `Too many links asked for ${contactName} in the last hour. Please use the latest one, or try again later.`;
  },
  [PublicMessageKind.StatusPagePasswordReset]: (
    contactName: string,
  ): string => {
    return `Too many password resets asked for ${contactName} in the last hour. Please use the link in the latest email, or try again later.`;
  },
  [PublicMessageKind.PasswordReset]: (contactName: string): string => {
    return `Too many password resets asked for ${contactName} in the last hour. Please use the link in the latest email, or try again later.`;
  },
  [PublicMessageKind.SignUpEmail]: (contactName: string): string => {
    return `Too many sign-up emails asked for ${contactName} in the last hour. Please use the link in the latest one, or try again later.`;
  },
};

// What a request that would send a text message is told while Redis is away.
const TEXT_MESSAGE_UNAVAILABLE_REFUSALS: Record<PublicMessageKind, string> = {
  [PublicMessageKind.StatusPageSignUp]:
    "Sign-ups by text message cannot be accepted right now. Please try again in a few minutes.",
  [PublicMessageKind.StatusPageManageLink]:
    "Links cannot be sent by text message right now. Please try again in a few minutes.",
  [PublicMessageKind.StatusPagePasswordReset]:
    "Text messages cannot be sent right now. Please try again in a few minutes.",
  [PublicMessageKind.PasswordReset]:
    "Text messages cannot be sent right now. Please try again in a few minutes.",
  [PublicMessageKind.SignUpEmail]:
    "Text messages cannot be sent right now. Please try again in a few minutes.",
};

export const PUBLIC_MESSAGE_ONE_EMAIL_ADDRESS_MESSAGE: string =
  "Please enter one email address.";

/*
 * One mailbox, written the way the sign-up and reset forms take it: a local
 * part and a domain, neither holding an @, a separator, white space, a
 * quote, an angle bracket or a backslash. Email.isValid alone finds an
 * address anywhere in the text, so "a@x.com,b@y.com" passes it - a list the
 * mail transport sends to every address on - and would be counted as one
 * contact. Linear: neither class can take the @ the two sides meet at.
 */
const ONE_MAILBOX: RegExp = /^[^\s@,;<>()"'\\[\]]+@[^\s@,;<>()"'\\[\]]+$/;

/*
 * No mailbox is longer than this (RFC 5321 leaves 254 characters for an
 * address), and nothing longer is handed to Email.isValid, whose pattern
 * takes time that grows faster than the text.
 */
const MAX_EMAIL_ADDRESS_LENGTH: number = 254;

// Providers whose mailboxes ignore the dots of the local part.
const DOTS_IGNORED_DOMAINS: Array<string> = ["gmail.com", "googlemail.com"];

const NOT_A_DIGIT: RegExp = /\D/g;

/*
 * Redis namespace for every counter here, so a SCAN for these keys never
 * shows another limit's, and no other limit shares a count with them.
 */
const KEY_PREFIX: string = "pubmsg:rl:";

/*
 * Counter keys outlive their window by one full window, so a request landing
 * on a boundary cannot read a key that was reclaimed mid-window.
 */
const TTL_MULTIPLIER: number = 2;

// Bounds a Redis key segment built from the request.
const MAX_KEY_SEGMENT_LENGTH: number = 64;

// How often the "counter unavailable" condition may be logged, per kind.
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

export default class PublicMessageRateLimit {
  // The limits in force, for tests and operators' diagnostics.
  public static getConfig(): PublicMessageRateLimitConfig {
    return {
      ...CONFIG,
      kinds: {
        [PublicMessageKind.StatusPageSignUp]: {
          ...CONFIG.kinds[PublicMessageKind.StatusPageSignUp],
        },
        [PublicMessageKind.StatusPageManageLink]: {
          ...CONFIG.kinds[PublicMessageKind.StatusPageManageLink],
        },
        [PublicMessageKind.StatusPagePasswordReset]: {
          ...CONFIG.kinds[PublicMessageKind.StatusPagePasswordReset],
        },
        [PublicMessageKind.PasswordReset]: {
          ...CONFIG.kinds[PublicMessageKind.PasswordReset],
        },
        [PublicMessageKind.SignUpEmail]: {
          ...CONFIG.kinds[PublicMessageKind.SignUpEmail],
        },
      },
    };
  }

  /*
   * The client address to count this request under: the shared ClientIp
   * helper, which reads X-Forwarded-For from the trusted right-hand end -
   * never the leftmost entry, which any caller can set. Everything with no
   * address shares one "unknown" counter: an unidentifiable caller gets no
   * allowance of its own.
   */
  public static resolveClientIp(req: ExpressRequest): string {
    const clientIp: string | undefined = resolveTrustedClientIp(
      req as unknown as ClientIpRequestLike,
    );

    if (clientIp) {
      return PublicMessageRateLimit.sanitizeKeySegment(clientIp);
    }

    return "unknown";
  }

  /*
   * An email address as a contact. Refused (400) unless it is one mailbox
   * (ONE_MAILBOX): a list would be sent to each of its addresses.
   *
   * Counted case-insensitively, without a +tag (most providers deliver
   * "name+anything@" to "name@"), and for Gmail without the dots of the
   * local part, which Gmail ignores - so spelling one mailbox another way
   * does not buy it another allowance.
   */
  public static forEmail(email: Email | string): PublicMessageContact {
    const value: string = email.toString().trim().toLowerCase();

    if (
      value.length > MAX_EMAIL_ADDRESS_LENGTH ||
      !ONE_MAILBOX.test(value) ||
      !Email.isValid(value)
    ) {
      throw new BadDataException(PUBLIC_MESSAGE_ONE_EMAIL_ADDRESS_MESSAGE);
    }

    const at: number = value.lastIndexOf("@");
    let localPart: string = value.slice(0, at);
    let domain: string = value.slice(at + 1);

    const tagStart: number = localPart.indexOf("+");

    if (tagStart > 0) {
      localPart = localPart.slice(0, tagStart);
    }

    if (DOTS_IGNORED_DOMAINS.includes(domain)) {
      localPart = localPart.split(".").join("");
      domain = "gmail.com";
    }

    return {
      channel: PublicMessageChannel.Email,
      canonical: `${localPart}@${domain}`,
    };
  }

  /*
   * A phone number as a contact: its digits. A number is stored as it was
   * typed, so "+1 415 555 0100" and "+14155550100" are one phone.
   */
  public static forPhone(phone: Phone | string): PublicMessageContact {
    return {
      channel: PublicMessageChannel.TextMessage,
      canonical: phone.toString().replace(NOT_A_DIGIT, ""),
    };
  }

  /*
   * A Slack or Microsoft Teams incoming webhook, or a subscriber's webhook,
   * as a contact: the address it is sent to, as WHATWG URL parsing writes
   * it (scheme and host in lower case, no default port, no credentials, no
   * fragment). Path and query are kept: they are what tells one channel, or
   * one user of a shared webhook service, from another.
   */
  public static forWebhook(
    channel:
      | PublicMessageChannel.Slack
      | PublicMessageChannel.MicrosoftTeams
      | PublicMessageChannel.Webhook,
    url: URL | string,
  ): PublicMessageContact {
    const value: string = url.toString().trim();

    let canonical: string = value.toLowerCase();

    try {
      const parsed: globalThis.URL = new globalThis.URL(value);
      canonical = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
    } catch {
      // Counted as written.
    }

    return { channel: channel, canonical: canonical };
  }

  /*
   * A Slack or Microsoft Teams workspace, named in a request for its
   * subscriptions' manage links: its name on that status page. A workspace
   * name is not unique across status pages - two companies can both call
   * theirs "Engineering" - so it is counted per page.
   */
  public static forWorkspace(
    channel: PublicMessageChannel.Slack | PublicMessageChannel.MicrosoftTeams,
    statusPageId: ObjectID | string,
    workspaceName: string,
  ): PublicMessageContact {
    return {
      channel: channel,
      canonical: `${statusPageId.toString().toLowerCase()}:${workspaceName
        .trim()
        .toLowerCase()}`,
    };
  }

  /*
   * Count one request that is about to send a message of `kind` to each of
   * `contacts`, and decide. The caller's counters first (its messages of
   * this kind and, when a contact is a phone, its text messages), then -
   * only when those let it through - each contact's.
   */
  public static async consume(data: {
    // From resolveClientIp.
    clientIp: string;
    kind: PublicMessageKind;
    contacts: Array<PublicMessageContact>;
  }): Promise<PublicMessageRateLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return { outcome: PublicMessageRateLimitOutcome.CounterUnavailable };
    }

    const kindConfig: PublicMessageKindConfig = CONFIG.kinds[data.kind];
    const clientWindowIndex: number = PublicMessageRateLimit.getWindowIndex(
      CONFIG.clientWindowSeconds,
    );
    const contactWindowIndex: number = PublicMessageRateLimit.getWindowIndex(
      CONFIG.contactWindowSeconds,
    );

    const contacts: Array<PublicMessageContact> =
      PublicMessageRateLimit.withoutRepeats(data.contacts);

    const sendsTextMessage: boolean = contacts.some(
      (contact: PublicMessageContact): boolean => {
        return contact.channel === PublicMessageChannel.TextMessage;
      },
    );

    /*
     * The caller's text messages first, when the request sends one: when
     * both counters are over, the tighter, more specific one is what the
     * caller is told about.
     */
    const clientCounters: Array<
      ClientRateLimitCounterSpec<PublicMessageRateLimitScope>
    > = [
      ...(sendsTextMessage
        ? [
            {
              scope: PublicMessageRateLimitScope.ClientTextMessages,
              keyFor: (clientKey: string): string => {
                return `${KEY_PREFIX}text:c:${clientKey}:${clientWindowIndex}`;
              },
              limit: CONFIG.perClientTextMessageLimit,
            },
          ]
        : []),
      {
        scope: PublicMessageRateLimitScope.Client,
        keyFor: (clientKey: string): string => {
          return `${KEY_PREFIX}${data.kind}:c:${clientKey}:${clientWindowIndex}`;
        },
        limit: kindConfig.perClientLimit,
      },
    ];

    try {
      const clientRefusal: ClientRateLimitRefusal<PublicMessageRateLimitScope> | null =
        await ClientRateLimitCounter.count<PublicMessageRateLimitScope>({
          redis: client,
          clientIp: data.clientIp,
          ttlSeconds: CONFIG.clientWindowSeconds * TTL_MULTIPLIER,
          counters: clientCounters,
        });

      if (clientRefusal) {
        return {
          outcome: PublicMessageRateLimitOutcome.RateLimited,
          retryAfterSeconds: PublicMessageRateLimit.getSecondsUntilWindowEnd(
            CONFIG.clientWindowSeconds,
          ),
          scope: clientRefusal.scope,
          ipv6Network64: clientRefusal.ipv6Network64,
          isFirstRejectionInWindow: clientRefusal.isFirstRefusalInWindow,
        };
      }

      if (contacts.length === 0) {
        return { outcome: PublicMessageRateLimitOutcome.Allowed };
      }

      /*
       * Each contact's counter is known by its place in the request, so the
       * one that refused can be named.
       */
      const contactCounters: Array<FixedRateLimitCounterSpec<number>> =
        contacts.map(
          (
            contact: PublicMessageContact,
            index: number,
          ): FixedRateLimitCounterSpec<number> => {
            return {
              scope: index,
              key: `${KEY_PREFIX}${data.kind}:k:${PublicMessageRateLimit.getContactKey(
                contact,
              )}:${contactWindowIndex}`,
              limit: kindConfig.perContactLimit,
            };
          },
        );

      const contactRefusal: ClientRateLimitRefusal<number> | null =
        await ClientRateLimitCounter.countFixed<number>({
          redis: client,
          ttlSeconds: CONFIG.contactWindowSeconds * TTL_MULTIPLIER,
          counters: contactCounters,
        });

      if (!contactRefusal) {
        return { outcome: PublicMessageRateLimitOutcome.Allowed };
      }

      return {
        outcome: PublicMessageRateLimitOutcome.RateLimited,
        retryAfterSeconds: PublicMessageRateLimit.getSecondsUntilWindowEnd(
          CONFIG.contactWindowSeconds,
        ),
        scope: PublicMessageRateLimitScope.Contact,
        contact: contacts[contactRefusal.scope],
        isFirstRejectionInWindow: contactRefusal.isFirstRefusalInWindow,
      };
    } catch (err) {
      if (PublicMessageRateLimit.shouldLogCounterUnavailable(data.kind)) {
        logger.warn(
          `PublicMessageRateLimit: counter failed for ${data.kind} from ${data.clientIp}`,
        );
        logger.warn(err);
      }

      return { outcome: PublicMessageRateLimitOutcome.CounterUnavailable };
    }
  }

  /*
   * For a route about to send a message of `kind` to `contacts`: counts it
   * (consume) and returns when it may go on, or throws - a
   * PublicMessageRateLimitException (429, carrying when to come back) when
   * a counter has had enough, and while the counter cannot be reached a
   * ServiceUnavailableException (503) for a request that would send a text
   * message. Call it before anything is created or sent, after the
   * request's own checks.
   */
  public static async assertMaySend(data: {
    req: ExpressRequest;
    kind: PublicMessageKind;
    contacts: Array<PublicMessageContact>;
  }): Promise<void> {
    const clientIp: string = PublicMessageRateLimit.resolveClientIp(data.req);

    const decision: PublicMessageRateLimitDecision =
      await PublicMessageRateLimit.consume({
        clientIp: clientIp,
        kind: data.kind,
        contacts: data.contacts,
      });

    if (decision.outcome === PublicMessageRateLimitOutcome.RateLimited) {
      if (decision.isFirstRejectionInWindow) {
        logger.warn(
          `PublicMessageRateLimit: refused ${data.kind} from ${clientIp} (${ClientRateLimitCounter.describeLimit(
            String(decision.scope),
            decision.ipv6Network64,
          )}${decision.contact ? `, ${decision.contact.channel}` : ""})`,
        );
      }

      throw new PublicMessageRateLimitException(
        PublicMessageRateLimit.getRefusalMessage({
          kind: data.kind,
          scope: decision.scope,
          contact: decision.contact,
        }),
        decision.retryAfterSeconds || 1,
      );
    }

    if (
      decision.outcome === PublicMessageRateLimitOutcome.CounterUnavailable
    ) {
      const sendsTextMessage: boolean = data.contacts.some(
        (contact: PublicMessageContact): boolean => {
          return contact.channel === PublicMessageChannel.TextMessage;
        },
      );

      if (sendsTextMessage) {
        if (PublicMessageRateLimit.shouldLogCounterUnavailable(data.kind)) {
          logger.error(
            `PublicMessageRateLimit: rate limit counter unavailable, refusing ${data.kind} by text message`,
          );
        }

        throw new ServiceUnavailableException(
          TEXT_MESSAGE_UNAVAILABLE_REFUSALS[data.kind],
        );
      }

      if (PublicMessageRateLimit.shouldLogCounterUnavailable(data.kind)) {
        logger.warn(
          `PublicMessageRateLimit: rate limit counter unavailable, sending ${data.kind} uncounted`,
        );
      }
    }
  }

  // The words a refusal is answered with.
  public static getRefusalMessage(data: {
    kind: PublicMessageKind;
    scope?: PublicMessageRateLimitScope | undefined;
    contact?: PublicMessageContact | undefined;
  }): string {
    if (data.scope === PublicMessageRateLimitScope.Contact && data.contact) {
      return CONTACT_REFUSALS[data.kind](CONTACT_NAMES[data.contact.channel]);
    }

    if (data.scope === PublicMessageRateLimitScope.ClientTextMessages) {
      return CLIENT_TEXT_MESSAGE_REFUSALS[data.kind];
    }

    return CLIENT_REFUSALS[data.kind];
  }

  /*
   * For a route whose handler refused a request here: say when to come
   * back, as Retry-After, in seconds. Anything else is left alone.
   */
  public static setRetryAfterFor(res: ExpressResponse, error: unknown): void {
    if (!(error instanceof PublicMessageRateLimitException)) {
      return;
    }

    const setHeader: unknown = (res as unknown as Record<string, unknown>)?.[
      "setHeader"
    ];

    if (typeof setHeader === "function") {
      (setHeader as (name: string, value: string) => void).call(
        res,
        "Retry-After",
        String(error.retryAfterSeconds),
      );
    }
  }

  /*
   * The key a contact is counted under: a hash of its channel and canonical
   * form, so no email address or phone number is written to Redis.
   */
  public static getContactKey(contact: PublicMessageContact): string {
    return createHash("sha256")
      .update(`${contact.channel}:${contact.canonical}`, "utf8")
      .digest("hex")
      .slice(0, 32);
  }

  // One counter per contact, however often a request names it.
  private static withoutRepeats(
    contacts: Array<PublicMessageContact>,
  ): Array<PublicMessageContact> {
    const seen: Set<string> = new Set<string>();

    return contacts.filter((contact: PublicMessageContact): boolean => {
      const key: string = PublicMessageRateLimit.getContactKey(contact);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });
  }

  private static sanitizeKeySegment(value: string): string {
    return (
      value
        .slice(0, MAX_KEY_SEGMENT_LENGTH)
        /*
         * Redis keys are binary safe, but a predictable charset keeps
         * operational tooling (SCAN patterns, dashboards) sane.
         */
        .replace(/[^a-zA-Z0-9._:%\-[\]]/g, "_")
    );
  }

  private static getWindowIndex(windowSeconds: number): number {
    return Math.floor(Date.now() / (windowSeconds * 1000));
  }

  /*
   * Remaining seconds in the window of the counter that refused, so a
   * refused caller is told to come back when that window actually rolls.
   */
  private static getSecondsUntilWindowEnd(windowSeconds: number): number {
    const windowMs: number = windowSeconds * 1000;
    const msIntoWindow: number = Date.now() % windowMs;

    return Math.max(1, Math.ceil((windowMs - msIntoWindow) / 1000));
  }

  /*
   * A Redis outage puts EVERY request on the unavailable path, so an
   * unguarded log line there is one per request for as long as the outage
   * lasts. One line per kind per interval makes it visible without burying
   * everything else.
   */
  private static shouldLogCounterUnavailable(kind: PublicMessageKind): boolean {
    const now: number = Date.now();
    const lastLoggedAt: number =
      PublicMessageRateLimit.counterUnavailableLastLoggedAt.get(kind) || 0;

    if (now - lastLoggedAt < COUNTER_UNAVAILABLE_LOG_INTERVAL_MS) {
      return false;
    }

    PublicMessageRateLimit.counterUnavailableLastLoggedAt.set(kind, now);

    return true;
  }

  private static counterUnavailableLastLoggedAt: Map<PublicMessageKind, number> =
    new Map();
}
