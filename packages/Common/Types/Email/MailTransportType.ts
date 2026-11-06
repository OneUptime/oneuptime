/**
 * How an email is delivered: the mail service a config sends through.
 *
 * - SMTP: a mail server (with XOAUTH2, a username and password, or no
 *   sign-in at all).
 * - MicrosoftGraph: a Microsoft 365 mailbox through Microsoft Graph
 *   (POST /v1.0/users/{sender}/sendMail). Needed when the tenant has SMTP
 *   AUTH turned off; the Microsoft Entra app needs only the Mail.Send
 *   application permission.
 * - AmazonSES: Amazon Simple Email Service's v2 API (SendEmail), signed with
 *   an IAM access key.
 * - SendGrid: SendGrid's v3 Mail Send API, with an API key.
 * - Mailgun: Mailgun's Messages API, with an API key and a sending domain,
 *   in its US or EU region.
 * - Postmark: Postmark's Email API, with a server API token.
 * - Resend: Resend's Emails API, with an API key.
 *
 * Every HTTP API sends over HTTPS (port 443), so a network that blocks the
 * SMTP ports still sends mail. Each has its MailProvider in
 * App/FeatureSet/Notification/Services/MailProviders; the values are what
 * the API, Terraform and the guides use, and a stored config reads as it
 * was written.
 */
enum MailTransportType {
  SMTP = "SMTP",
  MicrosoftGraph = "Microsoft Graph",
  AmazonSES = "Amazon SES",
  SendGrid = "SendGrid",
  Mailgun = "Mailgun",
  Postmark = "Postmark",
  Resend = "Resend",
}

export default MailTransportType;

/*
 * The transports that send through a provider's HTTP API with a key of its
 * own (an IAM access key, an API key, a server token), not through a mail
 * server or Microsoft Graph's OAuth app.
 */
export const API_KEY_MAIL_TRANSPORTS: ReadonlyArray<MailTransportType> = [
  MailTransportType.AmazonSES,
  MailTransportType.SendGrid,
  MailTransportType.Mailgun,
  MailTransportType.Postmark,
  MailTransportType.Resend,
];

export function isMailTransportType(
  value: unknown,
): value is MailTransportType {
  return (
    typeof value === "string" &&
    (Object.values(MailTransportType) as Array<string>).includes(value)
  );
}

/*
 * A stored or submitted transport as the mail service reads it: one of the
 * transports, or SMTP for anything else (an empty value included) - what
 * every config written before there was a choice holds.
 */
export function toMailTransportType(value: unknown): MailTransportType {
  return isMailTransportType(value) ? value : MailTransportType.SMTP;
}

export function isApiKeyMailTransport(value: unknown): boolean {
  return (
    isMailTransportType(value) &&
    (API_KEY_MAIL_TRANSPORTS as ReadonlyArray<string>).includes(value)
  );
}
