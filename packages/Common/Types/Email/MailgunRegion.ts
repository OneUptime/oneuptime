/*
 * Where a Mailgun account keeps its sending domains. A domain is created in
 * one region and is reached only through that region's API host
 * (https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages):
 *
 *   - US: https://api.mailgun.net
 *   - EU: https://api.eu.mailgun.net
 *
 * A domain asked for through the other region's host is answered 404
 * "Domain not found", so the region is part of a Mailgun config.
 */
enum MailgunRegion {
  US = "US",
  EU = "EU",
}

export default MailgunRegion;

export const DEFAULT_MAILGUN_REGION: MailgunRegion = MailgunRegion.US;

// A stored or submitted region as the mail service reads it: US unless EU.
export function toMailgunRegion(value: unknown): MailgunRegion {
  return value === MailgunRegion.EU ? MailgunRegion.EU : MailgunRegion.US;
}

export function getMailgunApiBaseUrl(region: MailgunRegion): string {
  return region === MailgunRegion.EU
    ? "https://api.eu.mailgun.net"
    : "https://api.mailgun.net";
}
