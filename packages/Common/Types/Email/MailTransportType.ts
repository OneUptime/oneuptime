/**
 * Transport type for delivering email.
 *
 * - SMTP: traditional SMTP server (with optional XOAUTH2 / username+password / no auth)
 * - MicrosoftGraph: Microsoft 365 mailbox via Microsoft Graph API
 *   (POST /v1.0/users/{sender}/sendMail). Required when the tenant has SMTP AUTH
 *   disabled — the Azure AD app only needs Mail.Send (application) permission.
 *
 * Adding a new HTTP-API provider (Gmail, SES, etc.) means adding a new enum value
 * and a matching MailProvider implementation. See
 * App/FeatureSet/Notification/Services/MailProviders.
 */
enum MailTransportType {
  SMTP = "SMTP",
  MicrosoftGraph = "Microsoft Graph",
}

export default MailTransportType;
