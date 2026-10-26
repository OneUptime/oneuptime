import {
  SendGridConfig,
  getEmailServerType,
  getGlobalSMTPConfig,
  getSendgridConfig,
} from "../Config";
import InlineImageAttachments from "./MailProviders/InlineImageAttachments";
import InlineImageRefusal from "./MailProviders/InlineImageRefusal";
import MicrosoftGraphMailProvider from "./MailProviders/MicrosoftGraphMailProvider";
import SendGridMailProvider from "./MailProviders/SendGridMailProvider";
import SMTPOAuthService from "./SMTPOAuthService";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import EmailMessage, { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import MailTransportType from "Common/Types/Email/MailTransportType";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import MailStatus from "Common/Types/Mail/MailStatus";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import StatusPageSubscriberUnsubscribe from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import EmailLogService from "Common/Server/Services/EmailLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import DataSourceEgressGuard, {
  ResolvedAddress,
} from "Common/Server/Utils/DataSource/EgressGuard";
import PinnedSmtpSocket, {
  SmtpSocketCallback,
} from "Common/Server/Utils/Mail/PinnedSmtpSocket";
import EmailInlineImages, {
  EmailInlineImage,
} from "Common/Server/Utils/Mail/EmailInlineImages";
import EmailPlainText from "Common/Server/Utils/Mail/EmailPlainText";
import EmailSize, {
  EmailWithinLimit,
  MAX_EMAIL_BYTES,
} from "Common/Server/Utils/Mail/EmailSize";
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import EmailLog from "Common/Models/DatabaseModels/EmailLog";
import { EmailServerType } from "Common/Models/DatabaseModels/GlobalConfig";
import { createHash } from "crypto";
import fsp from "fs/promises";
import Handlebars from "handlebars";
import nodemailer, {
  type SMTPSentMessageInfo,
  type SMTPTransportOptions,
  type Transporter,
} from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import Path from "path";
import * as tls from "tls";
import {
  BRAND_VARIABLE_NAMES,
  ONEUPTIME_LOGO_VARIABLE_NAME,
  getCurrentEmailBrandingVariables,
  withBrandedSubject,
} from "../Utils/EmailBranding";
import HandlebarsText from "../Utils/HandlebarsText";

// An email as it is sent: its final subject and HTML body.
export interface RenderedEmail {
  subject: string;
  body: string;
}

// What every email that went says it was not: delivered.
const EMAIL_DELIVERY_NOT_TRACKED: string =
  "This does not mean the email was delivered. We do not track email delivery. If the email was not delivered - it is likely due to the email address being invalid, user has blocked sending domain, or it could have landed in spam.";

export const EMAIL_SENT_STATUS_MESSAGE: string = `Email sent successfully. ${EMAIL_DELIVERY_NOT_TRACKED}`;

const SENTENCE_END_PATTERN: RegExp = /[.!?]$/;

/*
 * What the Email Log says of an email that went without its images, the
 * mail service having refused it with them (sendEvenWithoutImages):
 * `refusal` is the service's answer, as its provider explains it.
 */
export const getSentWithoutImagesStatusMessage: (refusal: string) => string = (
  refusal: string,
): string => {
  const answer: string = refusal.trim();
  const sentence: string = SENTENCE_END_PATTERN.test(answer)
    ? answer
    : `${answer}.`;

  return `Email sent successfully without its images, which the mail service refused: ${sentence} ${EMAIL_DELIVERY_NOT_TRACKED}`;
};

interface PooledTransporter {
  transporter: Transporter<SMTPSentMessageInfo>;
  lastUsedAt: number; // Unix timestamp in milliseconds

  /*
   * The pool is keyed more finely than the semaphore (see getPoolKey), so an
   * entry has to remember which remote server it belongs to. Eviction and the
   * idle clock are per-server questions and ask through this.
   */
  connectionKey: string;
}

/*
 * Connection pool for email transporters
 * Exported so the SSRF guard on tenant-supplied SMTP hosts can be tested.
 */
export class TransporterPool {
  private static pools: Map<string, PooledTransporter> = new Map();
  private static semaphore: Map<string, number> = new Map();
  private static readonly MAX_CONCURRENT_CONNECTIONS = 100;

  /*
   * A pooled transporter that nothing has used for this long is closed and
   * dropped. Every credential is part of the pool key, so once a config is
   * edited or deleted its old transporter can no longer be reached. This
   * closes its authenticated connections instead of keeping them open for
   * the life of the process.
   */
  private static readonly IDLE_TTL_MS: number = 10 * 60 * 1000;

  private static resolveConnectionSettings(emailServer: EmailServer): {
    portNumber: number;
    wantsSecureConnection: boolean;
    secureConnection: boolean;
    requireTLS: boolean;
    mode: "implicit-tls" | "starttls" | "plain";
  } {
    /*
     * host/port/secure are optional on EmailServer to support HTTP-API
     * transports. This pool only handles SMTP — callers must have routed
     * non-SMTP transports elsewhere before reaching here.
     */
    if (!emailServer.host || !emailServer.port) {
      throw new BadDataException(
        "SMTP transport requires Hostname and Port. " +
          "If you intended to use Microsoft Graph, set Transport to 'Microsoft Graph'.",
      );
    }

    const portNumber: number = emailServer.port.toNumber();
    const wantsSecureConnection: boolean = Boolean(emailServer.secure);
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

  /*
   * WHICH REMOTE SERVER, as which principal - the identity two requests must
   * share before they may share anything at all. getPoolKey builds on this,
   * and the concurrency semaphore uses it directly.
   *
   * A pooled transporter holds an SMTP session that is already
   * authenticated, and a key hit hands it out without authenticating again.
   * So the key has to cover the credentials themselves, not only the account
   * they log in to. Host, port and username are not secret: SendGrid's
   * username is "apikey" for every customer, and an O365 or Gmail username
   * is the sender address printed on every email. With only those in the
   * key, a project that copied them and gave any password was sent through
   * another project's authenticated connection.
   *
   * The key also carries the ProjectSmtpConfig id (null for the operator's
   * global settings), so two configs never share a connection even when
   * their credentials match. It also carries the requested secure flag,
   * which decides whether the certificate is verified.
   *
   * The tuple is JSON-encoded, so a separator inside a tenant-supplied value
   * cannot make two different tuples encode the same. It is then hashed, so
   * the key holds no plaintext password.
   */
  private static getConnectionKey(emailServer: EmailServer): string {
    const { portNumber, wantsSecureConnection, mode } =
      this.resolveConnectionSettings(emailServer);

    return createHash("sha256")
      .update(
        JSON.stringify([
          emailServer.id ? emailServer.id.toString() : null,
          // resolveConnectionSettings has already guarded that host is defined.
          emailServer.host!.toString(),
          portNumber,
          mode,
          wantsSecureConnection,
          emailServer.authType || SMTPAuthenticationType.UsernamePassword,
          emailServer.username || null,
          emailServer.password || null,
          emailServer.clientId || null,
          emailServer.clientSecret || null,
          emailServer.tokenUrl ? emailServer.tokenUrl.toString() : null,
          emailServer.scope || null,
          emailServer.oauthProviderType || null,
        ]),
      )
      .digest("hex");
  }

  /*
   * Which CACHED TRANSPORTER a request may be handed, as opposed to which
   * remote server it is talking to.
   *
   * These are not the same question, because createTransporter bakes
   * `connectionTimeout` into the nodemailer transport it builds and
   * getTransporter hands a key hit straight back, unchanged - a later
   * caller's timeout is simply ignored. Two callers ask for different
   * timeouts: "Send Test Email" wants to fail fast (SMTPConfig.ts passes
   * 4000) and every real send wants the 60s default. Keyed together, whichever
   * ran first decided for both.
   *
   * Both directions were wrong, and the second one badly. A test that ran
   * after a real send silently got the 60s transporter and never failed fast.
   * A test that ran FIRST left that project's config pinned to
   * connectionTimeout=4000 for every subsequent alert email - and because
   * getTransporter restamps lastUsedAt on each hit, an actively-used config
   * never idles out of the pool, so one click on a test button could drop
   * real mail to a healthy-but-slow SMTP server indefinitely.
   *
   * The timeout therefore belongs in the pool key. It deliberately does NOT
   * belong in the connection key: the semaphore below caps how many sockets
   * we open to one server at once, which is a property of that server and not
   * of who asked.
   */
  private static getPoolKey(
    emailServer: EmailServer,
    options: { timeout?: number | undefined },
  ): string {
    return createHash("sha256")
      .update(
        JSON.stringify([
          this.getConnectionKey(emailServer),
          options.timeout || null,
        ]),
      )
      .digest("hex");
  }

  /*
   * Close and drop pooled transporters that nothing has used for
   * IDLE_TTL_MS. A transporter with a send in flight (a held semaphore slot)
   * is never evicted. getTransporter stamps lastUsedAt before it returns, so
   * the one it just handed out cannot be idle either.
   */
  private static evictIdleTransporters(): void {
    const now: number = Date.now();

    for (const [key, pooled] of this.pools) {
      if ((this.semaphore.get(pooled.connectionKey) || 0) > 0) {
        continue;
      }

      if (now - pooled.lastUsedAt < this.IDLE_TTL_MS) {
        continue;
      }

      this.pools.delete(key);
      pooled.transporter.close();
    }
  }

  /*
   * Validate the SMTP host of a PROJECT-supplied mail server before dialing
   * it, and return the addresses that passed.
   *
   * hostname/port on ProjectSmtpConfig are free text, and nodemailer reports
   * what it found on the socket — "Invalid greeting. response=<raw bytes>" —
   * which MailService stores in EmailLog.statusMessage and shows to the
   * project. That turns "send a test email" into an internal port scanner
   * with banner disclosure, so it has to be checked on every connection
   * rather than on write: rows configured before this existed are still in
   * the database.
   *
   * The GLOBAL mail server is exempt, and gets null: nodemailer dials it by
   * name as it always has. It is operator-configured, not tenant-configured
   * (EmailServer.id is set only for project configs), and pointing it at an
   * internal relay is a normal self-hosted deployment.
   */
  private static async assertMailServerHostIsAllowed(
    emailServer: EmailServer,
  ): Promise<Array<ResolvedAddress> | null> {
    if (!emailServer.id) {
      return null;
    }

    if (!emailServer.host) {
      return null;
    }

    return await this.validateMailServerHost(emailServer.host);
  }

  private static async validateMailServerHost(
    host: Hostname,
  ): Promise<Array<ResolvedAddress>> {
    /*
     * .hostname, not .toString(): the latter re-appends the port, and the
     * guard resolves what it is given.
     */
    return await DataSourceEgressGuard.assertHostnameAllowed(host.hostname, {
      targetLabel: "SMTP server",
    });
  }

  /*
   * nodemailer's getSocket hook for a project mail server: every connection
   * the transporter opens goes to an address the egress guard has just
   * validated, and nodemailer is handed the connected socket.
   *
   * Validating the name and then giving it to nodemailer is not enough.
   * nodemailer resolves it again on its own (dns.resolve4/6, then a
   * process-wide cache kept for five minutes whatever the TTL), so a DNS
   * server that answers the guard with a public address and nodemailer with
   * 127.0.0.1 or 169.254.169.254 would walk straight around the check.
   *
   * getSocket runs once per connection, not once per transporter. That
   * matters for the pooled transporter, which lives for as long as the
   * config keeps sending and opens new connections by itself (after an
   * idle close, after maxMessages, when concurrent sends need another one).
   * Each of those validates the host again and pins what it found, so a
   * resolution change can never be reached through a transporter built
   * before it. The first connection uses the addresses getTransporter has
   * just validated rather than resolving a second time.
   */
  private static createPinnedSocketProvider(data: {
    host: Hostname;
    port: number;
    validatedAddresses: Array<ResolvedAddress>;
    timeoutInMs: number;
  }): (options: unknown, callback: SmtpSocketCallback) => void {
    let unusedAddresses: Array<ResolvedAddress> | null =
      data.validatedAddresses;

    return (_options: unknown, callback: SmtpSocketCallback): void => {
      const addresses: Promise<Array<ResolvedAddress>> = unusedAddresses
        ? Promise.resolve(unusedAddresses)
        : this.validateMailServerHost(data.host);

      unusedAddresses = null;

      addresses.then(
        (validated: Array<ResolvedAddress>) => {
          try {
            PinnedSmtpSocket.connect({
              // Bare, so an IPv6 literal is dialed rather than looked up.
              host: data.host.hostname.replace(/^\[|\]$/g, ""),
              port: data.port,
              addresses: validated,
              timeoutInMs: data.timeoutInMs,
              onDone: callback,
            });
          } catch (error) {
            callback(error as Error);
          }
        },
        (error: Error) => {
          // Refused or unresolvable now: the send fails with the guard's reason.
          callback(error);
        },
      );
    };
  }

  public static async getTransporter(
    emailServer: EmailServer,
    options: { timeout?: number | undefined },
  ): Promise<Transporter<SMTPSentMessageInfo>> {
    const validatedAddresses: Array<ResolvedAddress> | null =
      await this.assertMailServerHostIsAllowed(emailServer);

    this.evictIdleTransporters();

    /*
     * For OAuth, we need to create a new transporter each time to get fresh tokens
     * The access token has a limited lifetime and needs to be refreshed
     */
    if (emailServer.authType === SMTPAuthenticationType.OAuth) {
      return await this.createOAuthTransporter(
        emailServer,
        options,
        validatedAddresses,
      );
    }

    const key: string = this.getPoolKey(emailServer, options);

    let pooled: PooledTransporter | undefined = this.pools.get(key);

    /*
     * A pool hit ignores the addresses just validated. That is safe because
     * the hit only hands back sockets already open to an address that was
     * validated when it was dialed, and the transporter's getSocket validates
     * again before any new one (see createPinnedSocketProvider). The check
     * above still refuses the send outright once the host resolves somewhere
     * it may not go.
     */
    if (!pooled) {
      pooled = {
        transporter: this.createTransporter(
          emailServer,
          options,
          validatedAddresses,
        ),
        lastUsedAt: Date.now(),
        connectionKey: this.getConnectionKey(emailServer),
      };
      this.pools.set(key, pooled);
    }

    pooled.lastUsedAt = Date.now();

    return pooled.transporter;
  }

  /*
   * What pins a transporter: a getSocket hook for a project mail server,
   * nothing for the exempt global one (validatedAddresses is null), which
   * nodemailer keeps resolving and dialing by name.
   */
  private static getSocketOptions(
    emailServer: EmailServer,
    options: {
      portNumber: number;
      timeoutInMs: number;
      validatedAddresses: Array<ResolvedAddress> | null;
    },
  ): Pick<SMTPTransportOptions, "getSocket"> {
    if (!options.validatedAddresses || !emailServer.host) {
      return {};
    }

    return {
      getSocket: this.createPinnedSocketProvider({
        host: emailServer.host,
        port: options.portNumber,
        validatedAddresses: options.validatedAddresses,
        timeoutInMs: options.timeoutInMs,
      }) as SMTPTransportOptions["getSocket"],
    };
  }

  private static async createOAuthTransporter(
    emailServer: EmailServer,
    options: { timeout?: number | undefined },
    validatedAddresses: Array<ResolvedAddress> | null,
  ): Promise<Transporter<SMTPSentMessageInfo>> {
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
      // Fields the tenant left blank in SMTP settings, not a defect.
      throw new BadDataException(
        "OAuth configuration is incomplete. Please provide Client ID, Client Secret, Token URL, and Scope.",
      ).asUserError();
    }

    if (!emailServer.username) {
      // Field the tenant left blank in SMTP settings, not a defect.
      throw new BadDataException(
        "Username (email address) is required for OAuth authentication.",
      ).asUserError();
    }

    /*
     * Get the access token using the generic OAuth service
     * Provider type determines which grant flow to use (Client Credentials vs JWT Bearer)
     */
    const accessToken: string = await SMTPOAuthService.getAccessToken({
      configId: emailServer.id ? emailServer.id.toString() : undefined,
      clientId: emailServer.clientId,
      clientSecret: emailServer.clientSecret,
      tokenUrl: emailServer.tokenUrl,
      scope: emailServer.scope,
      username: emailServer.username, // Required for JWT Bearer (user to impersonate)
      providerType:
        emailServer.oauthProviderType || OAuthProviderType.ClientCredentials,
    });

    logger.debug("Creating OAuth transporter for SMTP");
    logger.debug(`OAuth token obtained for user: ${emailServer.username}`);

    // Use nodemailer's built-in XOAUTH2 support
    return nodemailer.createTransport({
      host: emailServer.host!.toString(),
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
      ...this.getSocketOptions(emailServer, {
        portNumber,
        timeoutInMs: options.timeout || 60000,
        validatedAddresses,
      }),
    } as SMTPTransportOptions);
  }

  private static createTransporter(
    emailServer: EmailServer,
    options: { timeout?: number | undefined },
    validatedAddresses: Array<ResolvedAddress> | null,
  ): Transporter<SMTPSentMessageInfo> {
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
      host: emailServer.host!.toString(),
      port: portNumber,
      secure: secureConnection,
      requireTLS,
      tls: tlsOptions,
      auth,
      connectionTimeout: options.timeout || 60000,
      pool: true, // Enable connection pooling
      maxConnections: this.MAX_CONCURRENT_CONNECTIONS,
      ...this.getSocketOptions(emailServer, {
        portNumber,
        timeoutInMs: options.timeout || 60000,
        validatedAddresses,
      }),
    });
  }

  public static async acquireConnection(
    emailServer: EmailServer,
  ): Promise<void> {
    const key: string = this.getConnectionKey(emailServer);

    while ((this.semaphore.get(key) || 0) >= this.MAX_CONCURRENT_CONNECTIONS) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 100);
      });
    }

    this.semaphore.set(key, (this.semaphore.get(key) || 0) + 1);
  }

  public static releaseConnection(emailServer: EmailServer): void {
    const key: string = this.getConnectionKey(emailServer);
    const next: number = Math.max(0, (this.semaphore.get(key) || 0) - 1);

    /*
     * acquireConnection reads a missing key as 0, so drop the entry rather
     * than keep a 0 for every config that has ever sent mail.
     */
    if (next === 0) {
      this.semaphore.delete(key);
    } else {
      this.semaphore.set(key, next);
    }

    /*
     * The idle clock starts when the last send finishes, not when it began.
     * One server can hold more than one pooled transporter (one per requested
     * timeout), and releaseConnection is only told which SERVER finished, so
     * stamp every entry that belongs to it.
     */
    for (const pooled of this.pools.values()) {
      if (pooled.connectionKey === key) {
        pooled.lastUsedAt = Date.now();
      }
    }
  }

  public static async cleanup(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const [, pooled] of this.pools) {
      closePromises.push(
        new Promise<void>((resolve: () => void) => {
          pooled.transporter.close();
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
    /*
     * SMTP_TRANSPORT_TYPE is optional. Absent → 'SMTP' (back-compat: existing
     * callers that don't send this key get identical behavior to before).
     */
    const transportType: MailTransportType =
      (obj["SMTP_TRANSPORT_TYPE"] as MailTransportType) ||
      MailTransportType.SMTP;

    /*
     * Every branch below reports a field the operator did not fill in (or
     * filled in wrongly) in Global/Project email settings. Telling them which
     * one is the product working, so these are stamped external and never open
     * an Issue.
     */
    if (!obj["SMTP_EMAIL"]) {
      logger.error("SMTP_EMAIL env var not found", EXTERNAL_FAULT);
      return false;
    }

    if (!Email.isValid(obj["SMTP_EMAIL"].toString())) {
      logger.error(
        "SMTP_EMAIL env var " + obj["SMTP_EMAIL"] + " is not a valid email",
        EXTERNAL_FAULT,
      );
      return false;
    }

    if (!obj["SMTP_FROM_NAME"]) {
      logger.error("SMTP_FROM_NAME env var not found", EXTERNAL_FAULT);
      return false;
    }

    /*
     * Host/port/username are SMTP-only. Microsoft Graph posts to graph.microsoft.com
     * directly and uses OAuth credentials, not SMTP AUTH.
     */
    if (transportType === MailTransportType.SMTP) {
      if (!obj["SMTP_USERNAME"]) {
        logger.error("SMTP_USERNAME env var not found", EXTERNAL_FAULT);
        return false;
      }

      if (!obj["SMTP_PORT"]) {
        logger.error("SMTP_PORT env var not found", EXTERNAL_FAULT);
        return false;
      }

      if (!Port.isValid(obj["SMTP_PORT"].toString())) {
        logger.error(
          "SMTP_PORT " + obj["SMTP_HOST"] + " env var not valid",
          EXTERNAL_FAULT,
        );
        return false;
      }

      if (!obj["SMTP_HOST"]) {
        logger.error("SMTP_HOST env var not found", EXTERNAL_FAULT);
        return false;
      }

      if (!Hostname.isValid(obj["SMTP_HOST"].toString())) {
        logger.error(
          "SMTP_HOST env var " + obj["SMTP_HOST"] + "  not valid",
          EXTERNAL_FAULT,
        );
        return false;
      }
    }

    /*
     * Microsoft Graph always uses OAuth (Client Credentials). For SMTP, the
     * auth type is configurable.
     */
    const authType: SMTPAuthenticationType =
      transportType === MailTransportType.MicrosoftGraph
        ? SMTPAuthenticationType.OAuth
        : (obj["SMTP_AUTH_TYPE"] as SMTPAuthenticationType) ||
          SMTPAuthenticationType.UsernamePassword;

    if (authType === SMTPAuthenticationType.UsernamePassword) {
      if (!obj["SMTP_PASSWORD"]) {
        logger.error("SMTP_PASSWORD env var not found", EXTERNAL_FAULT);
        return false;
      }
    } else if (authType === SMTPAuthenticationType.OAuth) {
      if (!obj["SMTP_CLIENT_ID"]) {
        logger.error(
          "SMTP_CLIENT_ID env var not found for OAuth",
          EXTERNAL_FAULT,
        );
        return false;
      }

      if (!obj["SMTP_CLIENT_SECRET"]) {
        logger.error(
          "SMTP_CLIENT_SECRET env var not found for OAuth",
          EXTERNAL_FAULT,
        );
        return false;
      }

      if (!obj["SMTP_TOKEN_URL"]) {
        logger.error(
          "SMTP_TOKEN_URL env var not found for OAuth",
          EXTERNAL_FAULT,
        );
        return false;
      }

      if (!obj["SMTP_SCOPE"]) {
        logger.error("SMTP_SCOPE env var not found for OAuth", EXTERNAL_FAULT);
        return false;
      }
    }

    return true;
  }

  public static getEmailServer(obj: JSONObject): EmailServer {
    if (!this.isSMTPConfigValid(obj)) {
      // isSMTPConfigValid has already logged which field is wrong.
      throw new BadDataException("SMTP Config is not valid").asUserError();
    }

    const transportType: MailTransportType =
      (obj["SMTP_TRANSPORT_TYPE"] as MailTransportType) ||
      MailTransportType.SMTP;

    const authType: SMTPAuthenticationType =
      transportType === MailTransportType.MicrosoftGraph
        ? SMTPAuthenticationType.OAuth
        : (obj["SMTP_AUTH_TYPE"] as SMTPAuthenticationType) ||
          SMTPAuthenticationType.UsernamePassword;

    return {
      id:
        obj && obj["SMTP_ID"]
          ? new ObjectID(obj["SMTP_ID"].toString())
          : undefined,
      transportType: transportType,
      username: obj["SMTP_USERNAME"]?.toString() || undefined,
      password: obj["SMTP_PASSWORD"]?.toString() || undefined,
      host: obj["SMTP_HOST"]
        ? new Hostname(obj["SMTP_HOST"].toString())
        : undefined,
      port: obj["SMTP_PORT"]
        ? new Port(obj["SMTP_PORT"].toString())
        : undefined,
      fromEmail: new Email(obj["SMTP_EMAIL"]?.toString() as string),
      fromName: obj["SMTP_FROM_NAME"]?.toString() as string,
      secure:
        obj["SMTP_IS_SECURE"] === "true" || obj["SMTP_IS_SECURE"] === true,
      authType: authType,
      clientId: obj["SMTP_CLIENT_ID"]?.toString() || undefined,
      clientSecret: obj["SMTP_CLIENT_SECRET"]?.toString() || undefined,
      tokenUrl: obj["SMTP_TOKEN_URL"]
        ? URL.fromString(obj["SMTP_TOKEN_URL"].toString())
        : undefined,
      scope: obj["SMTP_SCOPE"]?.toString() || undefined,
      oauthProviderType:
        (obj["SMTP_OAUTH_PROVIDER_TYPE"] as OAuthProviderType) || undefined,
    };
  }

  public static async getGlobalFromEmail(): Promise<Email> {
    const emailServer: EmailServer | null = await this.getGlobalSmtpSettings();

    if (!emailServer) {
      // Email was never set up on this instance.
      throw new BadDataException("Global SMTP Config not found").asUserError();
    }

    return emailServer.fromEmail;
  }

  private static async getGlobalSmtpSettings(): Promise<EmailServer | null> {
    return await getGlobalSMTPConfig();
  }

  private static async updateUserNotificationLogTimelineAsSent(
    timelineId: ObjectID,
    statusMessage: string,
  ): Promise<void> {
    if (timelineId) {
      await UserOnCallLogTimelineService.updateOneById({
        data: {
          status: UserNotificationStatus.Sent,
          statusMessage: statusMessage,
        },
        id: timelineId,
        props: {
          isRoot: true,
        },
      });
    }
  }

  /*
   * Key is the raw template-name string (not the enum) because the
   * notification API casts unvalidated strings into EmailTemplateType.
   */
  private static compiledEmailTemplates: Map<
    string,
    Handlebars.TemplateDelegate
  > = new Map();

  private static async compileEmailBody(
    emailTemplateType: EmailTemplateType,
    vars: Dictionary<string | JSONObject>,
  ): Promise<string> {
    /*
     * Cache the compiled delegate so Handlebars parse/codegen runs once per
     * template per process. In development, re-read and recompile on every
     * call so template edits hot-reload.
     */
    let compiledTemplate: Handlebars.TemplateDelegate | undefined =
      this.compiledEmailTemplates.get(emailTemplateType);

    if (!compiledTemplate || IsDevelopment) {
      const templateData: string = await fsp.readFile(
        Path.resolve(
          process.cwd(),
          "FeatureSet",
          "Notification",
          "Templates",
          `${emailTemplateType}`,
        ),
        { encoding: "utf8", flag: "r" },
      );

      compiledTemplate = Handlebars.compile(templateData);
      this.compiledEmailTemplates.set(emailTemplateType, compiledTemplate);
    }

    return compiledTemplate(vars).toString();
  }

  /*
   * A body or a subject of the sender's own, as a template: its long runs of
   * plain text are never read by Handlebars, which runs out of stack on
   * megabytes of them (HandlebarsText).
   */
  private static compileText(
    text: string,
    vars: Dictionary<string | JSONObject>,
  ): string {
    return HandlebarsText.render(text, vars);
  }

  /**
   * The subject and HTML body an email is sent with, exactly as send()
   * sends them: its template (or its body, when it names none) compiled
   * with its variables and the defaults every email gets, and its subject
   * compiled too unless it is literal.
   *
   * send() renders through this, so anything that shows an email before it
   * goes out - the status page subscriber notification preview - shows
   * byte for byte what a recipient gets. Nothing is sent or logged, and the
   * envelope is not changed.
   *
   * The one step send() takes after this: an inline image (a screenshot in
   * a description, and OneUptime's logo in the header) stays a data: URL
   * here, which a browser shows, and is sent as an attachment the HTML
   * points at by Content-ID, which every mail client shows (see
   * EmailInlineImages and EmailLogo).
   */
  public static async render(mail: EmailEnvelope): Promise<RenderedEmail> {
    return await this.renderEmail(mail, { withOneUptimeLogo: true });
  }

  /*
   * render(), or the same email without OneUptime's logo - what an email is
   * sent as when a mail service would not take its images
   * (sendEvenWithoutImages). Its header then shows the name alone, as it
   * does when the logo's file cannot be read.
   */
  private static async renderEmail(
    mail: EmailEnvelope,
    options: { withOneUptimeLogo: boolean },
  ): Promise<RenderedEmail> {
    // The defaults every email gets.
    const vars: Dictionary<string | JSONObject> = { ...(mail.vars || {}) };

    if (!vars["year"]) {
      vars["year"] = OneUptimeDate.getCurrentYear().toString();
    }

    /*
     * How the installation names and shows itself (EmailBranding.ts). These
     * names are reserved for it: whatever a sender put there is replaced.
     */
    for (const name of BRAND_VARIABLE_NAMES) {
      delete vars[name];
    }

    const brandVariables: Dictionary<string> =
      getCurrentEmailBrandingVariables();

    if (!options.withOneUptimeLogo) {
      delete brandVariables[ONEUPTIME_LOGO_VARIABLE_NAME];
    }

    Object.assign(vars, brandVariables);

    const compiledBody: string = mail.templateType
      ? await this.compileEmailBody(mail.templateType, vars)
      : this.compileText(mail.body || "", vars);

    /*
     * A text too long for an email was cut, and ends with a note that the
     * full text is in OneUptime: the note links to what the email is about
     * (EmailSize.getRecordLink), where the email has a link to it.
     */
    const body: string = EmailSize.linkTruncatedTextNotes(
      compiledBody,
      EmailSize.getRecordLink(vars),
    );

    /*
     * A literal subject was rendered by the sender, often from user-authored
     * text; compiling it again would read any "{{" in that text as template
     * syntax. A subject template's own words name the installation's product
     * (withBrandedSubject); a literal subject is left exactly as it is.
     */
    const subject: string = mail.isSubjectLiteral
      ? mail.subject
      : this.compileText(
          withBrandedSubject(mail.subject, brandVariables),
          vars,
        );

    return {
      subject: subject,
      body: body,
    };
  }

  private static async createMailer(
    emailServer: EmailServer,
    options: {
      timeout?: number | undefined;
    },
  ): Promise<Transporter<SMTPSentMessageInfo>> {
    return await TransporterPool.getTransporter(emailServer, options);
  }

  private static async transportMail(
    mail: EmailMessage,
    options: {
      emailServer: EmailServer;
      projectId?: ObjectID | undefined;
      timeout?: number | undefined;
      inlineImages?: Array<EmailInlineImage> | undefined;
    },
  ): Promise<void> {
    const inlineImages: Array<EmailInlineImage> = options.inlineImages || [];

    /*
     * Dispatch on transport type. HTTP-API transports (Microsoft Graph today,
     * Gmail/SES tomorrow) bypass nodemailer and the SMTP connection pool — they
     * are stateless HTTP and have their own auth/retry concerns.
     */
    if (
      options.emailServer.transportType === MailTransportType.MicrosoftGraph
    ) {
      await this.transportViaMicrosoftGraph(
        mail,
        options.emailServer,
        options.timeout,
        inlineImages,
      );
      return;
    }

    const mailer: Transporter<SMTPSentMessageInfo> = await this.createMailer(
      options.emailServer,
      {
        timeout: options.timeout,
      },
    );

    let lastError: any;
    const maxRetries: number = 3;

    /*
     * The same email as text, sent beside the HTML: nodemailer sends both
     * as multipart/alternative (EmailPlainText). Written once, for every
     * attempt.
     */
    const text: string = EmailPlainText.fromHtml(mail.body);

    // Acquire connection slot to prevent overwhelming the server
    await TransporterPool.acquireConnection(options.emailServer);

    try {
      for (let attempt: number = 1; attempt <= maxRetries; attempt++) {
        try {
          const sendMailResponse: SMTPTransport.SentMessageInfo =
            await mailer.sendMail({
              from: `${options.emailServer.fromName.toString()} <${options.emailServer.fromEmail.toString()}>`,
              to: mail.toEmail.toString(),
              subject: mail.subject,
              text: text,
              html: mail.body,
              /*
               * An attachment with a cid is "related" to the HTML: nodemailer
               * sends both in one multipart/related part.
               */
              ...(inlineImages.length > 0
                ? { attachments: InlineImageAttachments.forSmtp(inlineImages) }
                : {}),
            });

          logger.debug("SMTP Email Provider Response:");
          logger.debug(JSON.stringify(sendMailResponse, null, 2));

          return; // Success, exit the function
        } catch (error) {
          lastError = error;
          /*
           * Everything nodemailer can raise here belongs to the tenant's mail
           * server: connection refused, AUTH rejected, TLS mismatch, recipient
           * bounced, greylisted. Stamped external because this loop runs three
           * times, so an undeliverable email would otherwise file SIX
           * ERROR records for one tenant misconfiguration.
           */
          logger.error(`Email send attempt ${attempt} failed:`, EXTERNAL_FAULT);
          logger.error(error, EXTERNAL_FAULT);

          /*
           * The server will not take the message for its size or its parts
           * (InlineImageRefusal): it would refuse the same message again.
           * sendEvenWithoutImages sends it once more without its images.
           */
          if (
            inlineImages.length > 0 &&
            InlineImageRefusal.isSmtpRefusal(error)
          ) {
            break;
          }

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

  private static async transportViaMicrosoftGraph(
    mail: EmailMessage,
    emailServer: EmailServer,
    timeout: number | undefined,
    inlineImages: Array<EmailInlineImage>,
  ): Promise<void> {
    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    /*
     * The provider owns throttling concerns for Graph: a per-mailbox
     * concurrency gate (to stay under Graph's MailboxConcurrency limit) and a
     * Retry-After-aware retry loop. We intentionally do NOT wrap another retry
     * loop here — that would multiply attempts and ignore Graph's Retry-After.
     *
     * The caller's timeout becomes a total deadline for the whole retry loop, so
     * fast-failing callers (e.g. the "Test mail config" endpoint) don't hang for
     * minutes on a throttled or unreachable mailbox.
     */
    await provider.send(mail, emailServer, {
      timeoutMs: timeout,
      inlineImages: inlineImages,
    });
  }

  /*
   * Sends `mail` with its inline images and, when the mail service refuses
   * the email for them (InlineImageRefusal: an attachment field it does not
   * read, a message too big with them), once more without them - rendered
   * again from `envelope` without OneUptime's logo, its header showing the
   * name alone, and with each screenshot a short note
   * (EmailInlineImages.leaveOut). An email is worth more than its images: a
   * password reset or an on-call page refused for the logo in its header
   * would otherwise be lost for a picture.
   *
   * Returns the refusal when the email went without its images, for the
   * Email Log to say so, or null when it went as it was. Any other failure,
   * and any failure of an email that has no images, is thrown as it is:
   * leaving the images out would not change it. So is a failure of the
   * email without them.
   */
  private static async sendEvenWithoutImages(data: {
    mail: EmailMessage;
    envelope: EmailEnvelope;
    inlineImages: Array<EmailInlineImage>;
    // Whether the service is the tenant's own (an SMTP server), not ours to fix.
    isServiceExternal: boolean;
    send: (
      mail: EmailMessage,
      inlineImages: Array<EmailInlineImage>,
    ) => Promise<void>;
  }): Promise<Error | null> {
    try {
      await data.send(data.mail, data.inlineImages);
      return null;
    } catch (err) {
      if (
        data.inlineImages.length === 0 ||
        !InlineImageRefusal.isRefusalOfInlineImages(err)
      ) {
        throw err;
      }

      const refusal: Error =
        err instanceof Error ? err : new Error(String(err));

      /*
       * Our own attachments refused by SendGrid or Microsoft Graph are
       * OneUptime's to fix, as issue #5308 was; an SMTP server's limits are
       * the tenant's.
       */
      logger.error(
        `The mail service refused an email for its inline images, so it is sent again without them: ${refusal.message}`,
        data.isServiceExternal ? EXTERNAL_FAULT : undefined,
      );

      data.mail.body = await this.renderWithoutImages(data.envelope);
      await data.send(data.mail, []);

      return refusal;
    }
  }

  /*
   * The HTML of the email `envelope` asks for, with no image to attach: no
   * OneUptime logo, each screenshot a note, and the whole held to
   * MAX_EMAIL_BYTES as any email is (EmailSize).
   */
  private static async renderWithoutImages(
    envelope: EmailEnvelope,
  ): Promise<string> {
    const rendered: RenderedEmail = await this.renderEmail(envelope, {
      withOneUptimeLogo: false,
    });

    const html: string = EmailInlineImages.leaveOut(rendered.body);
    const fitted: string = EmailSize.cutHtml(html, MAX_EMAIL_BYTES);

    return fitted === html
      ? html
      : EmailSize.linkTruncatedTextNotes(
          fitted,
          EmailSize.getRecordLink(envelope.vars),
        );
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
          monitorId?: ObjectID | undefined;
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
    const startNs: bigint = process.hrtime.bigint();
    let outcome: "success" | "failure" = "success";

    try {
      /*
       * One message goes to one mailbox. An address read back from a row
       * stored before every address was held to one mailbox can still hold a
       * list or a display name (Email keeps such a value readable but marks
       * it); it is refused here rather than handed to a transport, which
       * would deliver to every address in it.
       */
      if (!Email.isValid(mail.toEmail.toString())) {
        throw new BadDataException(
          `Email ${mail.toEmail.toString()} is not in valid format.`,
        );
      }

      await this.sendInternal(mail, options);
    } catch (err) {
      outcome = "failure";
      throw err;
    } finally {
      const elapsedNs: bigint = process.hrtime.bigint() - startNs;
      const durationMs: number = Number(elapsedNs) / 1e6;
      const attributes: Record<string, string> = {
        "notification.channel": "email",
        outcome,
      };

      AppMetrics.getNotificationCounter().add(1, attributes);
      AppMetrics.getNotificationDuration().record(durationMs, attributes);
    }
  }

  private static async sendInternal(
    mail: EmailMessage,
    options?:
      | {
          projectId?: ObjectID | undefined;
          emailServer?: EmailServer | undefined;
          userOnCallLogTimelineId?: ObjectID | undefined;
          timeout?: number | undefined;
          incidentId?: ObjectID | undefined;
          alertId?: ObjectID | undefined;
          monitorId?: ObjectID | undefined;
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
      /*
       * A status page's custom subject template can put {{unsubscribeUrl}}
       * in the subject, and the token in that link lets whoever holds it
       * cancel the subscription without signing in. The email log is
       * readable by project members who may not touch subscribers, so it
       * keeps the link with its token redacted (see
       * StatusPageSubscriberUnsubscribe.redactCredentials).
       */
      emailLog.subject = StatusPageSubscriberUnsubscribe.redactCredentials(
        mail.subject,
      );

      if (options.emailServer?.id) {
        emailLog.projectSmtpConfigId = options.emailServer?.id;
      }

      if (options.incidentId) {
        emailLog.incidentId = options.incidentId;
      }

      if (options.alertId) {
        emailLog.alertId = options.alertId;
      }

      if (options.monitorId) {
        emailLog.monitorId = options.monitorId;
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

    // default vars, on the message itself as they always were.
    if (!mail.vars) {
      mail.vars = {};
    }

    if (!mail.vars["year"]) {
      mail.vars["year"] = OneUptimeDate.getCurrentYear().toString();
    }

    try {
      const emailServerType: EmailServerType = await getEmailServerType();

      /*
       * The email as it was asked for, before its body and subject below
       * are the rendered ones: what it is rendered from again, without its
       * images, should a mail service refuse them (sendEvenWithoutImages).
       */
      const envelope: EmailEnvelope = { ...mail };

      /*
       * Rendered as render() renders it, so a preview of an email shows what
       * this sends.
       */
      const rendered: RenderedEmail = await this.render(mail);

      /*
       * Inline images (a screenshot in a description, OneUptime's logo in
       * the header) go out as attachments the HTML points at by Content-ID,
       * on every transport below; an email with none is sent exactly as
       * rendered. The whole of it is held to what every mail server takes
       * (EmailSize): screenshots that do not fit are left out, each with a
       * note, and HTML too big on its own is cut, with a note. The logo is
       * never left out.
       */
      const attached: EmailWithinLimit = EmailSize.attachWithinLimit(
        rendered.body,
      );
      const inlineImages: Array<EmailInlineImage> = attached.inlineImages;

      if (attached.wasFitted) {
        logger.warn(
          `An email was more than ${MAX_EMAIL_BYTES} bytes with its images (${rendered.body.length} characters of HTML), and was cut to fit.`,
        );
      }

      mail.body = attached.wasFitted
        ? EmailSize.linkTruncatedTextNotes(
            attached.html,
            EmailSize.getRecordLink(mail.vars),
          )
        : attached.html;
      mail.subject = rendered.subject;

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

          throw new BadDataException("Sendgrid Config not found").asUserError();
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

          throw new BadDataException(
            "Sendgrid API key not configured",
          ).asUserError();
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

          throw new BadDataException(
            "Sendgrid From Email not configured",
          ).asUserError();
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

          throw new BadDataException(
            "Sendgrid From Name not configured",
          ).asUserError();
        }

        if (emailLog) {
          emailLog.fromEmail = sendgridConfig.fromEmail;
        }

        const config: SendGridConfig = sendgridConfig;

        const imagesRefused: Error | null = await this.sendEvenWithoutImages({
          mail: mail,
          envelope: envelope,
          inlineImages: inlineImages,
          isServiceExternal: false,
          send: async (
            message: EmailMessage,
            images: Array<EmailInlineImage>,
          ): Promise<void> => {
            await new SendGridMailProvider().send(message, config, {
              inlineImages: images,
            });
          },
        });

        await this.recordSent({
          emailLog: emailLog,
          userOnCallLogTimelineId: options?.userOnCallLogTimelineId,
          imagesRefused: imagesRefused,
        });

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

          /*
           * The tenant picked SMTP as their email provider and then never
           * filled the settings in. The EmailLog row above already tells them
           * so; the outer catch re-logs this exception, and the authoritative
           * tag is what keeps that log line out of the Issues list.
           */
          throw new BadDataException(
            "Global SMTP Config not found",
          ).asUserError();
        }

        options.emailServer = globalEmailServer;
      }

      if (options && options.emailServer && emailLog) {
        emailLog.fromEmail = options.emailServer.fromEmail;
      }

      if (!options || !options.emailServer) {
        throw new BadDataException("Email server not found");
      }

      const emailServer: EmailServer = options.emailServer;
      const projectId: ObjectID | undefined = options.projectId;
      const timeout: number | undefined = options.timeout;

      const imagesRefused: Error | null = await this.sendEvenWithoutImages({
        mail: mail,
        envelope: envelope,
        inlineImages: inlineImages,
        isServiceExternal:
          emailServer.transportType !== MailTransportType.MicrosoftGraph,
        send: async (
          message: EmailMessage,
          images: Array<EmailInlineImage>,
        ): Promise<void> => {
          await this.transportMail(message, {
            emailServer: emailServer,
            projectId: projectId,
            timeout: timeout,
            inlineImages: images,
          });
        },
      });

      await this.recordSent({
        emailLog: emailLog,
        userOnCallLogTimelineId: options.userOnCallLogTimelineId,
        imagesRefused: imagesRefused,
      });
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

  /*
   * An email that went: its Email Log row and its on-call timeline entry say
   * so - and, when it went without its images, that it did and why.
   */
  private static async recordSent(data: {
    emailLog: EmailLog | undefined;
    userOnCallLogTimelineId: ObjectID | undefined;
    imagesRefused: Error | null;
  }): Promise<void> {
    const statusMessage: string = data.imagesRefused
      ? getSentWithoutImagesStatusMessage(data.imagesRefused.message)
      : EMAIL_SENT_STATUS_MESSAGE;

    if (data.emailLog) {
      data.emailLog.status = MailStatus.Success;
      data.emailLog.statusMessage = statusMessage;

      await EmailLogService.create({
        data: data.emailLog,
        props: {
          isRoot: true,
        },
      });
    }

    if (data.userOnCallLogTimelineId) {
      await this.updateUserNotificationLogTimelineAsSent(
        data.userOnCallLogTimelineId,
        statusMessage,
      );
    }
  }

  public static async cleanup(): Promise<void> {
    await TransporterPool.cleanup();
  }
}
