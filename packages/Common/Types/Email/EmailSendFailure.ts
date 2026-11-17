import { ServerSendingFailureScope } from "../ServerSending/ServerSendingStatus";

/*
 * WHOSE PROBLEM IS A FAILED EMAIL? (#9217)
 *
 * A mail server or provider that refuses an email says why, and the why
 * decides who must act:
 *
 *   - the recipient (or this one message): the address does not exist, its
 *     mailbox is full, the provider will not send to it (an Amazon SES
 *     sandbox that has not verified it, a Postmark inactive recipient, a
 *     Mailgun sandbox's authorized recipients), the message is too large.
 *     Every other email still goes out. It belongs on that email's log row,
 *     the record that sent it and the recipient - never in a banner that
 *     tells every admin the server's email is broken;
 *   - the server: the settings or the way to the mail service do not work -
 *     the password is refused, the host is not reached, TLS fails, the
 *     sender's address or domain is not verified, the account is suspended
 *     or out of its daily quota. No email goes out until someone fixes it,
 *     so the server's admins are told (ServerSendingStatus);
 *   - throttled: the mail service asked to slow down. That is the server's
 *     only while it lasts (SERVER_SEND_THROTTLE_SUSTAINED_MS).
 *
 * Read from what the sender knows: the error's text, and for SMTP the
 * code nodemailer gives (EAUTH, ECONNECTION ...), the reply code and the
 * command the server refused. An Amazon SES "Email address is not
 * verified" names the identities that failed, which can be the sender or
 * the recipient: it is the server's only when the sender is among them.
 * Anything not known to be one recipient's is the server's, as every
 * failure was before.
 *
 * Pure, with no Node or browser APIs.
 */

// Whose problem it is, as ServerSendingStatus keeps it.
export const EmailSendFailureScope: typeof ServerSendingFailureScope =
  ServerSendingFailureScope;
export type EmailSendFailureScope = ServerSendingFailureScope;

export interface EmailSendFailureFacts {
  // What the mail server or provider said, as the error carries it.
  message: string;
  // nodemailer's error code (EAUTH, ECONNECTION, EENVELOPE ...), if any.
  code?: string | undefined;
  // The SMTP reply code (535, 550 ...), if any.
  responseCode?: number | undefined;
  // The SMTP command the server refused (AUTH PLAIN, RCPT TO ...), if any.
  command?: string | undefined;
  // The address the email was sent from.
  fromEmail?: string | undefined;
  // The address the email was sent to.
  toEmail?: string | undefined;
}

// nodemailer's codes for a connection, a login or TLS that failed.
const SERVER_ERROR_CODES: ReadonlyArray<string> = [
  "EAUTH",
  "ENOAUTH",
  "EOAUTH2",
  "ECONNECTION",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ESOCKET",
  "EDNS",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETLS",
  "EPROXY",
  "EHOSTUNREACH",
  "ENETUNREACH",
];

/*
 * The sender, its domain, relaying or the account: no email goes out. Read
 * before what a recipient's refusal says, since "550 5.7.1 Sender address
 * rejected" is a 550 too.
 */
const SENDER_PATTERNS: ReadonlyArray<RegExp> = [
  /sender[^.]*\b(?:rejected|refused|denied|not (?:allowed|authori[sz]ed|permitted|verified|owned))/i,
  /\bfrom\b[^.]*\b(?:address|domain|email)\b[^.]*\b(?:not (?:a )?(?:verified|valid|allowed|permitted|authori[sz]ed)|does not match|is not a sender signature|rejected)/i,
  /not a (?:verified )?sender signature|verified sender identity|sender identity/i,
  /\bdomain\b[^.]*\bnot (?:verified|found|registered)|verify (?:a|your) domain/i,
  /mail from domain|MailFromDomainNotVerified/i,
  /relay(?:ing)? (?:access )?(?:denied|not permitted)|unable to relay|not permitted to relay/i,
  /SendAsDenied|not allowed to send as|5\.7\.60\b/i,
  /5\.7\.26\b|unauthenticated email|\bdmarc\b|\bspf\b|\bdkim\b/i,
  /suspended|sending (?:is )?paused|SendingPaused|account (?:is )?(?:disabled|blocked|inactive|under review)/i,
  /5\.7\.1\b[^.]*unusual rate/i,
];

// A login, a key or the way to the mail service: no email goes out.
const SERVER_PATTERNS: ReadonlyArray<RegExp> = [
  /\b535\b/,
  /\b534\b/,
  /\b530\b[\s-]+5\.7\.0/,
  /5\.7\.(?:8|9|14|57|139)\b/,
  /authenticat(?:e|ion|ed)\b[^.]*\b(?:fail|unsuccessful|invalid|required|rejected|refused|denied)/i,
  /\b(?:not authenticated|unauthenticated)\b/i,
  /invalid login|username and password not accepted|bad credentials|invalid credentials/i,
  /\b(?:invalid|unknown|unrecognized|revoked|expired|missing)\b[^.]*\b(?:api key|api token|server token|access key|token|credentials?)\b/i,
  /\b(?:api key|api token|server token|access key)\b[^.]*\b(?:invalid|not valid|not recognized|revoked|expired|missing)\b/i,
  /\b(?:unauthorized|forbidden)\b/i,
  /\bHTTP 40[13]\b/,
  /IAM role|ses:SendEmail|signature/i,
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH/,
  /connection (?:refused|closed|reset|lost|timed? ?out)|timed? ?out|timeout/i,
  /unexpected socket close|socket hang up|getaddrinfo|greeting never received/i,
  /\b(?:tls|ssl)\b|certificate|wrong version number|self[- ]signed/i,
];

const DAILY_QUOTA: RegExp =
  /daily (?:user )?(?:message |sending )?(?:quota|limit)|sending quota|quota exceeded|sending limit exceeded|5\.4\.5\b/i;

// The mail service asked to slow down: the server's only while it lasts.
const THROTTLE_PATTERNS: ReadonlyArray<RegExp> = [
  /throttl/i,
  /maximum sending rate/i,
  /rate limit|rate-limit|ratelimit/i,
  /too many (?:requests|messages|connections|concurrent)/i,
  /\bHTTP 429\b|\b429\b[^.]*too many/i,
  /4\.7\.28\b/,
  /try again later/i,
];

// One recipient, or this one message: every other email still goes out.
const RECIPIENT_PATTERNS: ReadonlyArray<RegExp> = [
  /\b5\.1\.(?:1|2|3|6|10)\b/,
  /\b4\.1\.1\b/,
  /\b5\.2\.[12]\b/,
  /\b5\.3\.4\b/,
  /mailbox (?:unavailable|not found|does not exist|is full|full|disabled|inactive)|no mailbox/i,
  /user unknown|unknown user|no such (?:user|recipient|address|mailbox)/i,
  /recipient[^.]*\b(?:rejected|refused|not found|unknown|invalid|is not valid|does not exist|not verified|blocked|suppressed|inactive|unavailable|denied)/i,
  /RecipientNotFound|InactiveRecipient|inactive (?:recipient|address)|marked as inactive/i,
  /(?:mailbox|user|address|account|recipient)\b[^.]*\b(?:does not exist|doesn't exist)/i,
  /(?:mailbox|inbox|recipient|user|you tried to reach)[^.]*over (?:its |the )?quota/i,
  /address rejected|invalid recipient|undeliverable/i,
  /suppression list|is suppressed/i,
  /invalid '?to'? (?:address|field|parameter)|'to' parameter|to parameter is not a valid|is not a valid (?:email )?address/i,
  /authorized recipients/i,
  /message (?:size|too large|is too (?:large|big))|exceeds (?:the )?(?:maximum )?(?:message )?size/i,
  /greylist/i,
  /\b4\.2\.1\b|receiving mail at a rate/i,
];

// Amazon SES: "Email address is not verified. The following identities ..."
const UNVERIFIED_IDENTITY: RegExp =
  /(?:email )?address is not verified|identit(?:y|ies)[^.]*(?:not verified|failed the check)/i;

const EMAIL_ADDRESS: RegExp = /[^\s,;:<>()"'[\]]+@[^\s,;:<>()"'[\]]+/g;

const normalize: (address: string | undefined) => string = (
  address: string | undefined,
): string => {
  return (address || "").trim().toLowerCase().replace(/\.+$/, "");
};

const matchesAny: (text: string, patterns: ReadonlyArray<RegExp>) => boolean = (
  text: string,
  patterns: ReadonlyArray<RegExp>,
): boolean => {
  return patterns.some((pattern: RegExp): boolean => {
    return pattern.test(text);
  });
};

export default class EmailSendFailure {
  /*
   * The identities an Amazon SES "Email address is not verified" names
   * ("The following identities failed the check in region US-EAST-1:
   * a@example.com, b@example.com"), lower-cased; empty when it names none.
   */
  public static getUnverifiedIdentities(message: string): Array<string> {
    const match: RegExpMatchArray | null = message.match(
      /failed the check in region\s+[^:]*:\s*([^\n]*)/i,
    );

    if (!match || !match[1]) {
      return [];
    }

    return (match[1].match(EMAIL_ADDRESS) || []).map(
      (address: string): string => {
        return normalize(address);
      },
    );
  }

  // Whether the error says an identity is not verified (Amazon SES).
  public static isUnverifiedIdentity(message: string): boolean {
    return UNVERIFIED_IDENTITY.test(message);
  }

  public static classify(facts: EmailSendFailureFacts): EmailSendFailureScope {
    const message: string = facts.message || "";
    const code: string = (facts.code || "").toUpperCase();
    const command: string = (facts.command || "").toUpperCase();
    const fromEmail: string = normalize(facts.fromEmail);
    const toEmail: string = normalize(facts.toEmail);

    // The connection, the login or TLS: nothing gets as far as a recipient.
    if (SERVER_ERROR_CODES.includes(code)) {
      return EmailSendFailureScope.Server;
    }

    /*
     * Amazon SES names the identities it has not verified: the sender's is
     * the server's to fix, a sandbox recipient's only that recipient's.
     */
    if (EmailSendFailure.isUnverifiedIdentity(message)) {
      const identities: Array<string> =
        EmailSendFailure.getUnverifiedIdentities(message);

      if (identities.length === 0) {
        return EmailSendFailureScope.Server;
      }

      if (fromEmail) {
        return identities.includes(fromEmail)
          ? EmailSendFailureScope.Server
          : EmailSendFailureScope.Recipient;
      }

      return toEmail &&
        identities.every((identity: string): boolean => {
          return identity === toEmail;
        })
        ? EmailSendFailureScope.Recipient
        : EmailSendFailureScope.Server;
    }

    // A daily quota lasts the day: the account's, never a slow-down.
    if (DAILY_QUOTA.test(message)) {
      return EmailSendFailureScope.Server;
    }

    if (matchesAny(message, THROTTLE_PATTERNS)) {
      return EmailSendFailureScope.Throttled;
    }

    // The sender, its domain or the account: every email from it fails.
    if (matchesAny(message, SENDER_PATTERNS)) {
      return EmailSendFailureScope.Server;
    }

    // An address the server refused at RCPT TO is that recipient's.
    if (
      code === "EENVELOPE" ||
      (command.startsWith("RCPT") &&
        (facts.responseCode === undefined ||
          (facts.responseCode >= 450 && facts.responseCode < 600)))
    ) {
      // Unless it asks for a login first, which no recipient can give.
      return matchesAny(message, SERVER_PATTERNS) &&
        !matchesAny(message, RECIPIENT_PATTERNS)
        ? EmailSendFailureScope.Server
        : EmailSendFailureScope.Recipient;
    }

    if (matchesAny(message, RECIPIENT_PATTERNS)) {
      return EmailSendFailureScope.Recipient;
    }

    // A login, a key, the connection - or nothing known: the server's.
    return EmailSendFailureScope.Server;
  }

  /*
   * The facts of an error thrown by a send: its message, and what
   * nodemailer adds to an SMTP error.
   */
  public static readError(
    err: unknown,
    addresses: { fromEmail?: string | undefined; toEmail?: string | undefined },
  ): EmailSendFailureFacts {
    const error: Record<string, unknown> =
      err && typeof err === "object" ? (err as Record<string, unknown>) : {};

    const message: string =
      typeof error["message"] === "string"
        ? (error["message"] as string)
        : typeof err === "string"
          ? err
          : "";
    const response: string =
      typeof error["response"] === "string"
        ? (error["response"] as string)
        : "";

    return {
      message:
        response && !message.includes(response)
          ? `${message} ${response}`.trim()
          : message,
      code:
        typeof error["code"] === "string"
          ? (error["code"] as string)
          : undefined,
      responseCode:
        typeof error["responseCode"] === "number"
          ? (error["responseCode"] as number)
          : undefined,
      command:
        typeof error["command"] === "string"
          ? (error["command"] as string)
          : undefined,
      fromEmail: addresses.fromEmail,
      toEmail: addresses.toEmail,
    };
  }
}
