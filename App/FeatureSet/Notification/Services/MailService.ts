import {
  SendGridConfig,
  getEmailServerType,
  getGlobalSMTPConfig,
  getSendgridConfig,
} from "../Config";
import SMTPOAuthService from "./SMTPOAuthService";
import SendgridMail, { MailDataRequired } from "@sendgrid/mail";
import Hostname from "Common/Types/API/Hostname";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import MailStatus from "Common/Types/Mail/MailStatus";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import EmailLogService from "Common/Server/Services/EmailLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import logger from "Common/Server/Utils/Logger";
import EmailLog from "Common/Models/DatabaseModels/EmailLog";
import { EmailServerType } from "Common/Models/DatabaseModels/GlobalConfig";
import fsp from "fs/promises";
import Handlebars from "handlebars";
import nodemailer, { Transporter } from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import Path from "path";
import * as tls from "tls";

// Connection pool for email transporters
class TransporterPool {
  private static pools: Map<string, Transporter> = new Map();
  private static semaphore: Map<string, number> = new Map();
  private static readonly MAX_CONCURRENT_CONNECTIONS = 100;

  private static resolveConnectionSettings(emailServer: EmailServer): {
    portNumber: number;
    wantsSecureConnection: boolean;
    secureConnection: boolean;
    requireTLS: boolean;
    mode: "implicit-tls" | "starttls" | "plain";
  } {
    const portNumber: number = emailServer.port.toNumber();
    const wantsSecureConnection: boolean = emailServer.secure;
    const isImplicitTLSPort: boolean = portNumber === 465;

    const secureConnection: boolean = isImplicitTLSPort;
    const requireTLS: boolean = wantsSecureConnection && !isImplicitTLSPort;

    let mode: "implicit-tls" | "starttls" | "plain" = "plain";

    if (secureConnection) {
      mode = "implicit-tls";
    } else if (requireTLS) {
      mode = "starttls";
    }

    return {
      portNumber,
      wantsSecureConnection,
      secureConnection,
      requireTLS,
      mode,
    };
  }

  private static getPoolKey(emailServer: EmailServer): string {
    const { portNumber, mode } = this.resolveConnectionSettings(emailServer);
    const username: string = emailServer.username || "noauth";
    const authType: string = emailServer.authType || "password";

    return `${emailServer.host.toString()}:${portNumber}:${username}:${mode}:${authType}`;
  }

  public static async getTransporter(
    emailServer: EmailServer,
    options: { timeout?: number | undefined },
  ): Promise<Transporter> {
    // For OAuth, we need to create a new transporter each time to get fresh tokens
    // The access token has a limited lifetime and needs to be refreshed
    if (emailServer.authType === SMTPAuthenticationType.OAuth) {
      return await this.createOAuthTransporter(emailServer, options);
    }

    const key: string = this.getPoolKey(emailServer);

    if (!this.pools.has(key)) {
      const transporter: Transporter = this.createTransporter(
        emailServer,
        options,
      );
      this.pools.set(key, transporter);
      this.semaphore.set(key, 0);
    }

    return this.pools.get(key)!;
  }

  private static async createOAuthTransporter(
    emailServer: EmailServer,
    options: { timeout?: number | undefined },
  ): Promise<Transporter> {
    const { portNumber, wantsSecureConnection, secureConnection, requireTLS } =
      this.resolveConnectionSettings(emailServer);

    let tlsOptions: tls.ConnectionOptions | undefined = undefined;

    if (!wantsSecureConnection) {
      tlsOptions = {
        rejectUnauthorized: false,
      };
    }

    if (
      !emailServer.clientId ||
      !emailServer.clientSecret ||
      !emailServer.tokenUrl ||
      !emailServer.scope
    ) {
      throw new BadDataException(
        "OAuth configuration is incomplete. Please provide Client ID, Client Secret, Token URL, and Scope.",
      );
    }

    if (!emailServer.username) {
      throw new BadDataException(
        "Username (email address) is required for OAuth authentication.",
      );
    }

    // Get the access token using the generic OAuth service
    const accessToken: string = await SMTPOAuthService.getAccessToken({
      clientId: emailServer.clientId,
      clientSecret: emailServer.clientSecret,
      tokenUrl: emailServer.tokenUrl,
      scope: emailServer.scope,
    });

    logger.debug("Creating OAuth transporter for SMTP");
    logger.debug(`OAuth token obtained for user: ${emailServer.username}`);

    // Use nodemailer's built-in XOAUTH2 support
    return nodemailer.createTransport({
      host: emailServer.host.toString(),
      port: portNumber,
      secure: secureConnection,
      requireTLS,
      tls: tlsOptions,
      authMethod: "XOAUTH2",
      auth: {
        type: "OAuth2",
        user: emailServer.username,
        accessToken: accessToken,
      },
      connectionTimeout: options.timeout || 60000,
    } as nodemailer.TransportOptions);
  }

  private static createTransporter(
    emailServer: EmailServer,
    options: { timeout?: number | undefined },
  ): Transporter {
    const { portNumber, wantsSecureConnection, secureConnection, requireTLS } =
      this.resolveConnectionSettings(emailServer);

    let tlsOptions: tls.ConnectionOptions | undefined = undefined;

    if (!wantsSecureConnection) {
      tlsOptions = {
        rejectUnauthorized: false,
      };
    }

    // Determine auth configuration based on auth type
    let auth: SMTPTransport.Options["auth"] | undefined = undefined;

    const authType: SMTPAuthenticationType =
      emailServer.authType || SMTPAuthenticationType.UsernamePassword;

    if (authType === SMTPAuthenticationType.UsernamePassword) {
      if (emailServer.username && emailServer.password) {
        auth = {
          user: emailServer.username,
          pass: emailServer.password,
        };
      }
    }
    // For SMTPAuthenticationType.None, auth remains undefined

    return nodemailer.createTransport({
      host: emailServer.host.toString(),
      port: portNumber,
      secure: secureConnection,
      requireTLS,
      tls: tlsOptions,
      auth,
      connectionTimeout: options.timeout || 60000,
      pool: true, // Enable connection pooling
      maxConnections: this.MAX_CONCURRENT_CONNECTIONS,
    });
  }

  public static async acquireConnection(
    emailServer: EmailServer,
  ): Promise<void> {
    const key: string = this.getPoolKey(emailServer);

    while ((this.semaphore.get(key) || 0) >= this.MAX_CONCURRENT_CONNECTIONS) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 100);
      });
    }

    this.semaphore.set(key, (this.semaphore.get(key) || 0) + 1);
  }

  public static releaseConnection(emailServer: EmailServer): void {
    const key: string = this.getPoolKey(emailServer);
    const current: number = this.semaphore.get(key) || 0;
    this.semaphore.set(key, Math.max(0, current - 1));
  }

  public static async cleanup(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const [, transporter] of this.pools) {
      closePromises.push(
        new Promise<void>((resolve: () => void) => {
          transporter.close();
          resolve();
        }),
      );
    }

    await Promise.all(closePromises);
    this.pools.clear();
    this.semaphore.clear();
  }
}

export default class MailService {
  public static isSMTPConfigValid(obj: JSONObject): boolean {
    if (!obj["SMTP_USERNAME"]) {
      logger.error("SMTP_USERNAME env var not found");
      return false;
    }

    if (!obj["SMTP_EMAIL"]) {
      logger.error("SMTP_EMAIL env var not found");
      return false;
    }

    if (!Email.isValid(obj["SMTP_EMAIL"].toString())) {
      logger.error(
        "SMTP_EMAIL env var " + obj["SMTP_EMAIL"] + " is not a valid email",
      );
      return false;
    }

    if (!obj["SMTP_FROM_NAME"]) {
      logger.error("SMTP_FROM_NAME env var not found");
      return false;
    }

    if (!obj["SMTP_PORT"]) {
      logger.error("SMTP_PORT env var not found");
      return false;
    }

    if (!Port.isValid(obj["SMTP_PORT"].toString())) {
      logger.error("SMTP_PORT " + obj["SMTP_HOST"] + " env var not valid");
      return false;
    }

    if (!obj["SMTP_HOST"]) {
      logger.error("SMTP_HOST env var not found");
      return false;
    }

    if (!Hostname.isValid(obj["SMTP_HOST"].toString())) {
      logger.error("SMTP_HOST env var " + obj["SMTP_HOST"] + "  not valid");
      return false;
    }

    if (!obj["SMTP_PASSWORD"]) {
      logger.error("SMTP_PASSWORD env var not found");
      return false;
    }

    return true;
  }

  public static getEmailServer(obj: JSONObject): EmailServer {
    if (!this.isSMTPConfigValid(obj)) {
      throw new BadDataException("SMTP Config is not valid");
    }

    return {
      id:
        obj && obj["SMTP_ID"]
          ? new ObjectID(obj["SMTP_ID"].toString())
          : undefined,
      username: obj["SMTP_USERNAME"]?.toString() || undefined,
      password: obj["SMTP_PASSWORD"]?.toString() || undefined,
      host: new Hostname(obj["SMTP_HOST"]?.toString() as string),
      port: new Port(obj["SMTP_PORT"]?.toString() as string),
      fromEmail: new Email(obj["SMTP_EMAIL"]?.toString() as string),
      fromName: obj["SMTP_FROM_NAME"]?.toString() as string,
      secure:
        obj["SMTP_IS_SECURE"] === "true" || obj["SMTP_IS_SECURE"] === true,
    };
  }

  public static async getGlobalFromEmail(): Promise<Email> {
    const emailServer: EmailServer | null = await this.getGlobalSmtpSettings();

    if (!emailServer) {
      throw new BadDataException("Global SMTP Config not found");
    }

    return emailServer.fromEmail;
  }

  private static async getGlobalSmtpSettings(): Promise<EmailServer | null> {
    return await getGlobalSMTPConfig();
  }

  private static async updateUserNotificationLogTimelineAsSent(
    timelineId: ObjectID,
  ): Promise<void> {
    if (timelineId) {
      await UserOnCallLogTimelineService.updateOneById({
        data: {
          status: UserNotificationStatus.Sent,
          statusMessage:
            "Email sent successfully. This does not mean the email was delivered. We do not track email delivery. If the email was not delivered - it is likely due to the email address being invalid, user has blocked sending domain, or it could have landed in spam.",
        },
        id: timelineId,
        props: {
          isRoot: true,
        },
      });
    }
  }

  private static async compileEmailBody(
    emailTemplateType: EmailTemplateType,
    vars: Dictionary<string | JSONObject>,
  ): Promise<string> {
    // Localcache templates, so we don't read from disk all the time.

    let templateData: string;
    if (
      LocalCache.hasValue("email-templates", emailTemplateType) &&
      !IsDevelopment
    ) {
      templateData = LocalCache.getString("email-templates", emailTemplateType);
    } else {
      templateData = await fsp.readFile(
        Path.resolve(
          process.cwd(),
          "FeatureSet",
          "Notification",
          "Templates",
          `${emailTemplateType}`,
        ),
        { encoding: "utf8", flag: "r" },
      );
      LocalCache.setString(
        "email-templates",
        emailTemplateType,
        templateData as string,
      );
    }

    const emailBody: Handlebars.TemplateDelegate =
      Handlebars.compile(templateData);
    return emailBody(vars).toString();
  }

  private static compileText(
    subject: string,
    vars: Dictionary<string | JSONObject>,
  ): string {
    const subjectHandlebars: Handlebars.TemplateDelegate =
      Handlebars.compile(subject);
    return subjectHandlebars(vars).toString();
  }

  private static async createMailer(
    emailServer: EmailServer,
    options: {
      timeout?: number | undefined;
    },
  ): Promise<Transporter> {
    return await TransporterPool.getTransporter(emailServer, options);
  }

  private static async transportMail(
    mail: EmailMessage,
    options: {
      emailServer: EmailServer;
      projectId?: ObjectID | undefined;
      timeout?: number | undefined;
    },
  ): Promise<void> {
    const mailer: Transporter = await this.createMailer(options.emailServer, {
      timeout: options.timeout,
    });

    let lastError: any;
    const maxRetries: number = 3;

    // Acquire connection slot to prevent overwhelming the server
    await TransporterPool.acquireConnection(options.emailServer);

    try {
      for (let attempt: number = 1; attempt <= maxRetries; attempt++) {
        try {
          await mailer.sendMail({
            from: `${options.emailServer.fromName.toString()} <${options.emailServer.fromEmail.toString()}>`,
            to: mail.toEmail.toString(),
            subject: mail.subject,
            html: mail.body,
          });
          return; // Success, exit the function
        } catch (error) {
          lastError = error;
          logger.error(`Email send attempt ${attempt} failed:`);
          logger.error(error);

          if (attempt === maxRetries) {
            break; // Don't wait after the last attempt
          }

          // Wait before retrying with jitter to prevent thundering herd
          const baseWaitTime: number = Math.pow(2, attempt - 1) * 1000;
          const jitter: number = Math.random() * 1000; // Add up to 1 second of jitter
          const waitTime: number = baseWaitTime + jitter;

          await new Promise<void>((resolve: (value: void) => void) => {
            setTimeout(resolve, waitTime);
          });
        }
      }

      // If we reach here, all retries failed
      throw lastError;
    } finally {
      // Always release the connection slot
      TransporterPool.releaseConnection(options.emailServer);
    }
  }

  public static async send(
    mail: EmailMessage,
    options?:
      | {
          projectId?: ObjectID | undefined;
          emailServer?: EmailServer | undefined;
          userOnCallLogTimelineId?: ObjectID | undefined;
          timeout?: number | undefined;
          incidentId?: ObjectID | undefined;
          alertId?: ObjectID | undefined;
          scheduledMaintenanceId?: ObjectID | undefined;
          statusPageId?: ObjectID | undefined;
          statusPageAnnouncementId?: ObjectID | undefined;
          userId?: ObjectID | undefined;
          // On-call policy related fields
          onCallPolicyId?: ObjectID | undefined;
          onCallPolicyEscalationRuleId?: ObjectID | undefined;
          onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
          onCallScheduleId?: ObjectID | undefined;
          teamId?: ObjectID | undefined;
        }
      | undefined,
  ): Promise<void> {
    let emailLog: EmailLog | undefined = undefined;

    if (options && options.projectId) {
      emailLog = new EmailLog();
      emailLog.projectId = options.projectId;
      emailLog.toEmail = mail.toEmail;
      emailLog.subject = mail.subject;

      if (options.emailServer?.id) {
        emailLog.projectSmtpConfigId = options.emailServer?.id;
      }

      if (options.incidentId) {
        emailLog.incidentId = options.incidentId;
      }

      if (options.alertId) {
        emailLog.alertId = options.alertId;
      }

      if (options.scheduledMaintenanceId) {
        emailLog.scheduledMaintenanceId = options.scheduledMaintenanceId;
      }

      if (options.statusPageId) {
        emailLog.statusPageId = options.statusPageId;
      }

      if (options.statusPageAnnouncementId) {
        emailLog.statusPageAnnouncementId = options.statusPageAnnouncementId;
      }

      if (options.userId) {
        emailLog.userId = options.userId;
      }

      if (options.teamId) {
        emailLog.teamId = options.teamId;
      }

      // Set OnCall-related fields
      if (options.onCallPolicyId) {
        emailLog.onCallDutyPolicyId = options.onCallPolicyId;
      }

      if (options.onCallPolicyEscalationRuleId) {
        emailLog.onCallDutyPolicyEscalationRuleId =
          options.onCallPolicyEscalationRuleId;
      }

      if (options.onCallScheduleId) {
        emailLog.onCallDutyPolicyScheduleId = options.onCallScheduleId;
      }
    }

    // default vars.
    if (!mail.vars) {
      mail.vars = {};
    }

    if (!mail.vars["year"]) {
      mail.vars["year"] = OneUptimeDate.getCurrentYear().toString();
    }

    try {
      const emailServerType: EmailServerType = await getEmailServerType();

      mail.body = mail.templateType
        ? await this.compileEmailBody(mail.templateType, mail.vars)
        : this.compileText(mail.body || "", mail.vars);
      mail.subject = this.compileText(mail.subject, mail.vars);

      if (
        (!options || !options.emailServer) &&
        emailServerType === EmailServerType.Sendgrid
      ) {
        const sendgridConfig: SendGridConfig | null = await getSendgridConfig();

        if (!sendgridConfig) {
          if (emailLog) {
            emailLog.status = MailStatus.Error;
            emailLog.statusMessage =
              "Email is configured to use Sendgrid, but Sendgrid Settings is not configured.";

            await EmailLogService.create({
              data: emailLog,
              props: {
                isRoot: true,
              },
            });
          }

          throw new BadDataException("Sendgrid Config not found");
        }

        if (!sendgridConfig.apiKey) {
          if (emailLog) {
            emailLog.status = MailStatus.Error;
            emailLog.statusMessage =
              "Email is configured to use Sendgrid, but Sendgrid API key is not configured.";

            await EmailLogService.create({
              data: emailLog,
              props: {
                isRoot: true,
              },
            });
          }

          throw new BadDataException("Sendgrid API key not configured");
        }

        if (!sendgridConfig.fromEmail) {
          if (emailLog) {
            emailLog.status = MailStatus.Error;
            emailLog.statusMessage =
              "Email is configured to use Sendgrid, but Sendgrid From Email is not configured.";

            await EmailLogService.create({
              data: emailLog,
              props: {
                isRoot: true,
              },
            });
          }

          throw new BadDataException("Sendgrid From Email not configured");
        }

        if (!sendgridConfig.fromName) {
          if (emailLog) {
            emailLog.status = MailStatus.Error;
            emailLog.statusMessage =
              "Email is configured to use Sendgrid, but Sendgrid From Name is not configured.";

            await EmailLogService.create({
              data: emailLog,
              props: {
                isRoot: true,
              },
            });
          }

          throw new BadDataException("Sendgrid From Name not configured");
        }

        SendgridMail.setApiKey(sendgridConfig.apiKey);

        const msg: MailDataRequired = {
          to: mail.toEmail.toString(),
          from: `${
            sendgridConfig.fromName || "OneUptime"
          } <${sendgridConfig.fromEmail.toString()}>`,
          subject: mail.subject,
          html: mail.body,
        };

        if (emailLog) {
          emailLog.fromEmail = sendgridConfig.fromEmail;
        }

        await SendgridMail.send(msg);

        if (emailLog) {
          emailLog.status = MailStatus.Success;
          emailLog.statusMessage =
            "Email sent successfully. This does not mean the email was delivered. We do not track email delivery. If the email was not delivered - it is likely due to the email address being invalid, user has blocked sending domain, or it could have landed in spam.";

          await EmailLogService.create({
            data: emailLog,
            props: {
              isRoot: true,
            },
          });
        }

        if (options?.userOnCallLogTimelineId) {
          await this.updateUserNotificationLogTimelineAsSent(
            options?.userOnCallLogTimelineId,
          );
        }
        return;
      }

      if (
        (!options || !options.emailServer) &&
        emailServerType === EmailServerType.CustomSMTP
      ) {
        if (!options) {
          options = {};
        }

        const globalEmailServer: EmailServer | null =
          await this.getGlobalSmtpSettings();

        if (!globalEmailServer) {
          if (emailLog) {
            emailLog.status = MailStatus.Error;
            emailLog.statusMessage =
              "Email is configured to use SMTP, but SMTP settings are not configured.";

            await EmailLogService.create({
              data: emailLog,
              props: {
                isRoot: true,
              },
            });
          }

          throw new BadDataException("Global SMTP Config not found");
        }

        options.emailServer = globalEmailServer;
      }

      if (options && options.emailServer && emailLog) {
        emailLog.fromEmail = options.emailServer.fromEmail;
      }

      if (!options || !options.emailServer) {
        throw new BadDataException("Email server not found");
      }

      await this.transportMail(mail, {
        emailServer: options.emailServer,
        projectId: options.projectId,
        timeout: options.timeout,
      });

      if (emailLog) {
        emailLog.status = MailStatus.Success;
        emailLog.statusMessage =
          "Email sent successfully. This does not mean the email was delivered. We do not track email delivery. If the email was not delivered - it is likely due to the email address being invalid, user has blocked sending domain, or it could have landed in spam.";

        await EmailLogService.create({
          data: emailLog,
          props: {
            isRoot: true,
          },
        });
      }

      if (options?.userOnCallLogTimelineId) {
        await this.updateUserNotificationLogTimelineAsSent(
          options?.userOnCallLogTimelineId,
        );
      }
    } catch (err: any) {
      let message: string | undefined = err.message;

      if (message === "Unexpected socket close") {
        message =
          "Email failed to send. Unexpected socket close. This could mean various things, such as your SMTP server is unreachble, username and password is incorrect, your SMTP server is not configured to accept connections from this IP address, or TLS/SSL is not configured correctly, or ports are not configured correctly.";
      }

      if (!message) {
        message = "Email failed to send. Unknown error.";
      }

      logger.error(err);
      if (options?.userOnCallLogTimelineId) {
        await UserOnCallLogTimelineService.updateOneById({
          data: {
            status: UserNotificationStatus.Error,
            statusMessage: message,
          },
          id: options.userOnCallLogTimelineId,
          props: {
            isRoot: true,
          },
        });
      }

      if (emailLog) {
        emailLog.status = MailStatus.Error;
        emailLog.statusMessage = message;

        await EmailLogService.create({
          data: emailLog,
          props: {
            isRoot: true,
          },
        });
      }

      throw err;
    }
  }

  public static async cleanup(): Promise<void> {
    await TransporterPool.cleanup();
  }
}
