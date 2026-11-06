import Select from "../../Types/Database/Select";
import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";

/*
 * THE COLUMNS A PROJECT'S SMTP CONFIG IS READ WITH, TO SEND THROUGH IT.
 *
 * Everything ProjectSmtpConfigService.toEmailServer reads, for every
 * transport: the mail server and its sign-in, Microsoft Graph's OAuth app,
 * and the key of each provider with an HTTP API of its own - Amazon SES's
 * access key and Region, SendGrid's, Mailgun's key, domain and region,
 * Postmark's server token and Resend's key - with the sender.
 *
 * A reader that listed the columns by hand would leave out whatever came
 * after it was written: a status page whose config sends through Amazon SES
 * would be read without its access key, and every email it sends refused
 * as "Amazon SES Access Key ID is not set". So every read of a config to
 * send through it - a status page's, for its subscribers, its private
 * users' sign-in emails and its reports - selects this, and
 * ProjectSmtpConfigSelectGuard holds every server file to it.
 */
export const PROJECT_SMTP_CONFIG_SEND_SELECT: Select<ProjectSmtpConfig> = {
  _id: true,
  transportType: true,
  hostname: true,
  port: true,
  username: true,
  password: true,
  fromEmail: true,
  fromName: true,
  secure: true,
  authType: true,
  clientId: true,
  clientSecret: true,
  tokenUrl: true,
  scope: true,
  oauthProviderType: true,
  amazonSesAccessKeyId: true,
  amazonSesSecretAccessKey: true,
  amazonSesRegion: true,
  sendgridApiKey: true,
  mailgunApiKey: true,
  mailgunDomain: true,
  mailgunRegion: true,
  postmarkServerToken: true,
  resendApiKey: true,
};
