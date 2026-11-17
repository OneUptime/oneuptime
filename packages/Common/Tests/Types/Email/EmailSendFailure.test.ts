import { describe, expect, test } from "@jest/globals";
import EmailSendFailure, {
  EmailSendFailureFacts,
  EmailSendFailureScope,
} from "../../../Types/Email/EmailSendFailure";

/*
 * WHOSE PROBLEM IS A FAILED EMAIL? (#9217)
 *
 * One user with an unverified address raised the banner that told every
 * admin "Email is failing ... invitations and incident emails are not
 * arriving": Amazon SES's sandbox had refused that one recipient
 * ("554 Message rejected: Email address is not verified. The following
 * identities failed the check in region ..."). These are the errors mail
 * servers and providers really give, and whose each one is.
 */

const FROM: string = "alerts@oneuptime.example.com";
const TO: string = "new.user@customer.example.com";

function scopeOf(
  message: string,
  extra: Partial<EmailSendFailureFacts> = {},
): EmailSendFailureScope {
  return EmailSendFailure.classify({
    message: message,
    fromEmail: FROM,
    toEmail: TO,
    ...extra,
  });
}

describe("Amazon SES: which identity is not verified", () => {
  test("the issue's error: a sandbox recipient, over SMTP, is that recipient's", () => {
    expect(
      scopeOf(
        `Message failed: 554 Message rejected: Email address is not verified. The following identities failed the check in region AP-SOUTHEAST-1: ${TO}`,
        { code: "EMESSAGE", responseCode: 554, command: "DATA" },
      ),
    ).toBe(EmailSendFailureScope.Recipient);
  });

  test("the same, over the SES API, wrapped in OneUptime's words", () => {
    expect(
      scopeOf(
        `Amazon SES has not verified the recipient ${TO} in us-east-1 (HTTP 400 MessageRejected). Amazon SES said: MessageRejected: Email address is not verified. The following identities failed the check in region US-EAST-1: ${TO}`,
      ),
    ).toBe(EmailSendFailureScope.Recipient);
  });

  test("the sender not verified is the server's", () => {
    expect(
      scopeOf(
        `554 Message rejected: Email address is not verified. The following identities failed the check in region US-EAST-1: ${FROM}`,
      ),
    ).toBe(EmailSendFailureScope.Server);
  });

  test("the sender among several is the server's, whatever case SES writes it in", () => {
    expect(
      scopeOf(
        `554 Message rejected: Email address is not verified. The following identities failed the check in region US-EAST-1: ${TO}, ${FROM.toUpperCase()}`,
      ),
    ).toBe(EmailSendFailureScope.Server);
  });

  test("with no identity named, it cannot be one recipient's", () => {
    expect(
      scopeOf("554 Message rejected: Email address is not verified."),
    ).toBe(EmailSendFailureScope.Server);
  });

  test("with the sender unknown, only the recipient named is still the recipient's", () => {
    expect(
      scopeOf(
        `554 Message rejected: Email address is not verified. The following identities failed the check in region EU-WEST-1: ${TO}`,
        { fromEmail: undefined },
      ),
    ).toBe(EmailSendFailureScope.Recipient);

    expect(
      scopeOf(
        `554 Message rejected: Email address is not verified. The following identities failed the check in region EU-WEST-1: someone.else@example.com`,
        { fromEmail: undefined },
      ),
    ).toBe(EmailSendFailureScope.Server);
  });

  test("reads the identities, lower-cased, and only from the list", () => {
    expect(
      EmailSendFailure.getUnverifiedIdentities(
        "Amazon SES needs a verified identity in us-east-1 for x@y.example (HTTP 400). Amazon SES said: Email address is not verified. The following identities failed the check in region US-EAST-1: A@Example.com, b@example.com.",
      ),
    ).toEqual(["a@example.com", "b@example.com"]);

    expect(
      EmailSendFailure.getUnverifiedIdentities("535 Authentication failed"),
    ).toEqual([]);
  });
});

describe("one recipient's, or one message's", () => {
  test.each([
    // Gmail
    "550-5.1.1 The email account that you tried to reach does not exist. Please try double-checking the recipient's email address for typos or unnecessary spaces. https://support.google.com/mail/?p=NoSuchUser",
    "552-5.2.2 The recipient's inbox is out of storage space and inactive. Please direct the recipient to https://support.google.com/mail/?p=OverQuotaPerm",
    "552-5.2.2 The email account that you tried to reach is over quota.",
    "450-4.2.1 The user you are trying to contact is receiving mail at a rate that prevents additional messages from being delivered.",
    // Microsoft 365 / Exchange
    "550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup",
    "550 5.1.1 RESOLVER.ADR.ExRecipNotFound; not found",
    // Postfix and generic SMTP
    "550 5.1.1 <nobody@example.com>: Recipient address rejected: User unknown in virtual mailbox table",
    "550 Requested action not taken: mailbox unavailable",
    "553 5.1.3 Invalid recipient address syntax",
    "452 4.2.2 Mailbox full",
    "552 5.3.4 Message size exceeds fixed limit",
    "451 4.7.1 Greylisted, please try again in 300 seconds",
    // Postmark
    "Postmark did not send the email (HTTP 422, ErrorCode 406). Postmark said: You tried to send to recipient(s) that have been marked as inactive. Found inactive addresses: bounced@example.com. Inactive recipients are ones that have generated a hard bounce, a spam complaint, or a manual suppression.",
    "Postmark did not send the email (HTTP 422, ErrorCode 300). Postmark said: Invalid 'To' address: 'not-an-address'.",
    // Mailgun's sandbox domain
    "Mailgun did not send the email (HTTP 403). Mailgun said: Domain sandbox123.mailgun.org is not allowed to send: Free accounts are for test purposes only. Please upgrade or add the address to authorized recipients in Account Settings.",
    // SendGrid
    "SendGrid did not send the email (HTTP 400). SendGrid said: The to email does not contain a valid address. Recipient is not valid.",
  ])("%s", (message: string) => {
    expect(scopeOf(message)).toBe(EmailSendFailureScope.Recipient);
  });

  test("an address refused at RCPT TO is that recipient's, whatever the words", () => {
    expect(
      scopeOf("Can't send mail - all recipients were rejected: 550 Rejected", {
        code: "EENVELOPE",
        responseCode: 550,
        command: "RCPT TO",
      }),
    ).toBe(EmailSendFailureScope.Recipient);

    expect(
      scopeOf("550 Rejected", { responseCode: 550, command: "RCPT TO" }),
    ).toBe(EmailSendFailureScope.Recipient);
  });

  test("but a login asked for at RCPT TO is the server's", () => {
    expect(
      scopeOf("530 5.7.0 Authentication required", {
        responseCode: 530,
        command: "RCPT TO",
      }),
    ).toBe(EmailSendFailureScope.Server);
  });
});

describe("the server's: the settings, the way there, the sender, the account", () => {
  test.each([
    // A login
    "Invalid login: 535-5.7.8 Username and Password not accepted. For more information, go to https://support.google.com/mail/?p=BadCredentials",
    "Invalid login: 535 Authentication Credentials Invalid",
    "535 5.7.3 Authentication unsuccessful",
    "534-5.7.9 Application-specific password required.",
    "530 5.7.57 Client not authenticated to send mail. Error: 535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant.",
    // The way there
    "connect ECONNREFUSED 10.0.0.5:587",
    "Connection timeout",
    "Greeting never received",
    "getaddrinfo ENOTFOUND smtp.example.invalid",
    "Unexpected socket close",
    "write EPROTO 140000:error:0A00010B:SSL routines:ssl3_get_record:wrong version number",
    "self-signed certificate in certificate chain",
    // The sender, its domain, relaying
    "553 5.7.1 <alerts@oneuptime.example.com>: Sender address rejected: not owned by user alerts@other.example.com",
    "550 5.7.1 Unable to relay",
    "554 5.7.1 <x@y>: Relay access denied",
    "550-5.7.26 This mail is unauthenticated, which poses a security risk to the sender and Gmail users, and has been blocked.",
    "554 5.2.0 STOREDRV.Submission.Exception:SendAsDeniedException.MapiExceptionSendAsDenied",
    "SendGrid did not send the email (HTTP 403). SendGrid said: The from address does not match a verified Sender Identity. Mail cannot be sent until this error is resolved.",
    "Postmark did not send the email (HTTP 422, ErrorCode 400). Postmark said: The 'From' address you supplied (alerts@oneuptime.example.com) is not a Sender Signature on your account.",
    "Resend did not send the email (HTTP 403). Resend said: The oneuptime.example.com domain is not verified. Please, add and verify your domain on https://resend.com/domains",
    "Resend did not send the email (HTTP 403). Resend said: You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain at resend.com/domains.",
    "Mailgun did not send the email (HTTP 404). Mailgun said: Domain not found: mg.example.com",
    "The custom MAIL FROM domain of alerts@oneuptime.example.com is not verified in Amazon SES (HTTP 400 MailFromDomainNotVerifiedException).",
    // A key, or the account
    "Amazon SES does not recognize the access key (HTTP 403 InvalidClientTokenId). Check the Access Key ID, and that the key is active in IAM.",
    "SendGrid did not send the email (HTTP 401). SendGrid said: The provided authorization grant is invalid, expired, or revoked",
    "Postmark did not send the email (HTTP 401, ErrorCode 10). Postmark said: Request does not contain a valid Server token.",
    "Amazon SES has suspended sending for this AWS account (HTTP 400 AccountSuspendedException).",
    "This AWS account has sent all the email its Amazon SES quota allows today (HTTP 400). Amazon SES said: Daily message quota exceeded.",
    "550-5.4.5 Daily user sending limit exceeded.",
    "554 Message rejected: Sending paused for this account.",
    // Nothing known: as every failure was before.
    "Something went wrong.",
    "",
  ])("%s", (message: string) => {
    expect(scopeOf(message)).toBe(EmailSendFailureScope.Server);
  });

  test.each(["EAUTH", "ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ETLS"])(
    "nodemailer's %s is the server's, even with a recipient's words",
    (code: string) => {
      expect(scopeOf("550 mailbox unavailable", { code: code })).toBe(
        EmailSendFailureScope.Server,
      );
    },
  );
});

describe("the provider asking to slow down", () => {
  test.each([
    "454 Throttling failure: Maximum sending rate exceeded.",
    "Amazon SES is limiting how fast this AWS account sends (HTTP 429 TooManyRequestsException).",
    "421-4.7.0 Try again later, closing connection.",
    "421 4.7.28 Our system has detected an unusual rate of unsolicited mail. Please try again later.",
    "Postmark did not send the email (HTTP 429). Postmark said: Rate limit exceeded",
    "432 4.3.2 Concurrent connections limit exceeded. Too many concurrent connections",
  ])("%s", (message: string) => {
    expect(scopeOf(message)).toBe(EmailSendFailureScope.Throttled);
  });

  test("a daily quota is not a slow-down: it lasts the day", () => {
    expect(
      scopeOf("454 Throttling failure: Daily message quota exceeded."),
    ).toBe(EmailSendFailureScope.Server);
  });
});

describe("reading an error", () => {
  test("nodemailer's code, reply code and command, and its response", () => {
    const error: Error = Object.assign(
      new Error("Message failed: 554 Message rejected"),
      {
        code: "EMESSAGE",
        responseCode: 554,
        command: "DATA",
        response: "554 Message rejected: Email address is not verified.",
      },
    );

    expect(
      EmailSendFailure.readError(error, { fromEmail: FROM, toEmail: TO }),
    ).toEqual({
      message:
        "Message failed: 554 Message rejected 554 Message rejected: Email address is not verified.",
      code: "EMESSAGE",
      responseCode: 554,
      command: "DATA",
      fromEmail: FROM,
      toEmail: TO,
    });
  });

  test("a response already in the message is not said twice", () => {
    const error: Error = Object.assign(
      new Error("Invalid login: 535 Authentication failed"),
      { response: "535 Authentication failed" },
    );

    expect(EmailSendFailure.readError(error, {}).message).toBe(
      "Invalid login: 535 Authentication failed",
    );
  });

  test("anything thrown at all", () => {
    expect(EmailSendFailure.readError("refused", {}).message).toBe("refused");
    expect(EmailSendFailure.readError(undefined, {}).message).toBe("");
    expect(EmailSendFailure.readError(null, {}).code).toBeUndefined();
  });
});
