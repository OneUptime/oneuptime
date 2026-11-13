import GlobalConfig, {
  EmailServerType,
} from "../../Models/DatabaseModels/GlobalConfig";
import { isAwsRegion } from "../Cloud/AwsRegionCode";
import Email from "../Email";
import Hostname from "../API/Hostname";
import URL from "../API/URL";
import { JSONObject } from "../JSON";
import Port from "../Port";
import { refusedValue } from "../../Utils/RefusedValue";
import AmazonSesAuthenticationType from "./AmazonSesAuthenticationType";
import { isMailgunDomain } from "./MailgunDomain";
import MailgunRegion from "./MailgunRegion";
import MailTransportType from "./MailTransportType";
import OAuthProviderType from "./OAuthProviderType";
import SMTPAuthenticationType from "./SMTPAuthenticationType";

/*
 * THE SERVER'S OWN EMAIL SETTINGS, SET BY ENVIRONMENT VARIABLES (#7738).
 *
 * Admin Dashboard > Settings > Emails keeps how the server sends its own
 * email in GlobalConfig: the Email Server Type, and that type's settings -
 * a mail server (Custom SMTP, or Microsoft Graph), or SendGrid, Amazon SES,
 * Mailgun, Postmark or Resend. An installation that keeps its configuration
 * in code - Helm values, Terraform's helm_release, a config.env kept in git -
 * sets them with these variables instead, as GLOBAL_TWILIO_ does for the
 * server's Twilio account (Types/CallAndSMS/ServerTwilioEnvironment, #7515).
 *
 * Once GLOBAL_EMAIL_SERVER_TYPE is set, the server's email settings are the
 * ones the variables describe: the senders read them (Server/Utils/
 * ServerEmailSettings), the Admin Dashboard shows them without an Edit
 * button, and the server refuses a write to the saved ones
 * (GlobalConfigService). Unset, the saved settings apply again, as they
 * were. Nothing is copied into the database, so a password or a key stays
 * where it was given: a Kubernetes Secret, or config.env.
 *
 * All of the settings come from the variables, or none of them: a variable
 * left unset is empty, never the saved value, so the variables are the
 * whole of the settings and a value nobody wrote down cannot change what is
 * sent.
 *
 * What is wrong with them is said by the variable's name, and never with a
 * password or a key: when the server starts, on the Admin Dashboard's Email
 * page, and in what the server's sending status says email is missing
 * (ServerChannelSetup). Settings with something wrong send nothing, as
 * settings that are not set up, rather than send through a server or from
 * an address nobody meant. A variable the chosen settings do not read - an
 * SMTP host with SendGrid picked - stops nothing: it is named, as ignored.
 *
 * The variables are new names. SMTP_HOST, SMTP_PORT, SMTP_USERNAME,
 * SMTP_PASSWORD, SMTP_IS_SECURE, SMTP_FROM_EMAIL, SMTP_FROM_NAME and
 * SENDGRID_API_KEY were read once, into a new installation's database, by
 * the UpdateGlobalConfigFromEnv data migration, and an old config.env may
 * still hold them: reading them again would put stale settings over the
 * ones an admin has saved since.
 */

export enum ServerEmailEnvironmentVariable {
  ServerType = "GLOBAL_EMAIL_SERVER_TYPE",
  FromEmail = "GLOBAL_EMAIL_FROM_EMAIL",
  FromName = "GLOBAL_EMAIL_FROM_NAME",
  SmtpTransport = "GLOBAL_EMAIL_SMTP_TRANSPORT",
  SmtpHost = "GLOBAL_EMAIL_SMTP_HOST",
  SmtpPort = "GLOBAL_EMAIL_SMTP_PORT",
  SmtpRequireTls = "GLOBAL_EMAIL_SMTP_REQUIRE_TLS",
  SmtpAuthType = "GLOBAL_EMAIL_SMTP_AUTH_TYPE",
  SmtpUsername = "GLOBAL_EMAIL_SMTP_USERNAME",
  SmtpPassword = "GLOBAL_EMAIL_SMTP_PASSWORD",
  SmtpOAuthProviderType = "GLOBAL_EMAIL_SMTP_OAUTH_PROVIDER_TYPE",
  SmtpOAuthClientId = "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID",
  SmtpOAuthClientSecret = "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET",
  SmtpOAuthTokenUrl = "GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL",
  SmtpOAuthScope = "GLOBAL_EMAIL_SMTP_OAUTH_SCOPE",
  SendgridApiKey = "GLOBAL_EMAIL_SENDGRID_API_KEY",
  AmazonSesAuthenticationType = "GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE",
  AmazonSesAccessKeyId = "GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID",
  AmazonSesSecretAccessKey = "GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY",
  AmazonSesRegion = "GLOBAL_EMAIL_AMAZON_SES_REGION",
  MailgunApiKey = "GLOBAL_EMAIL_MAILGUN_API_KEY",
  MailgunDomain = "GLOBAL_EMAIL_MAILGUN_DOMAIN",
  MailgunRegion = "GLOBAL_EMAIL_MAILGUN_REGION",
  PostmarkServerToken = "GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN",
  ResendApiKey = "GLOBAL_EMAIL_RESEND_API_KEY",
}

// Every variable, the one that turns them on first: the order problems are said in.
export const SERVER_EMAIL_ENVIRONMENT_VARIABLES: ReadonlyArray<ServerEmailEnvironmentVariable> =
  [
    ServerEmailEnvironmentVariable.ServerType,
    ServerEmailEnvironmentVariable.FromEmail,
    ServerEmailEnvironmentVariable.FromName,
    ServerEmailEnvironmentVariable.SmtpTransport,
    ServerEmailEnvironmentVariable.SmtpHost,
    ServerEmailEnvironmentVariable.SmtpPort,
    ServerEmailEnvironmentVariable.SmtpRequireTls,
    ServerEmailEnvironmentVariable.SmtpAuthType,
    ServerEmailEnvironmentVariable.SmtpUsername,
    ServerEmailEnvironmentVariable.SmtpPassword,
    ServerEmailEnvironmentVariable.SmtpOAuthProviderType,
    ServerEmailEnvironmentVariable.SmtpOAuthClientId,
    ServerEmailEnvironmentVariable.SmtpOAuthClientSecret,
    ServerEmailEnvironmentVariable.SmtpOAuthTokenUrl,
    ServerEmailEnvironmentVariable.SmtpOAuthScope,
    ServerEmailEnvironmentVariable.SendgridApiKey,
    ServerEmailEnvironmentVariable.AmazonSesAuthenticationType,
    ServerEmailEnvironmentVariable.AmazonSesAccessKeyId,
    ServerEmailEnvironmentVariable.AmazonSesSecretAccessKey,
    ServerEmailEnvironmentVariable.AmazonSesRegion,
    ServerEmailEnvironmentVariable.MailgunApiKey,
    ServerEmailEnvironmentVariable.MailgunDomain,
    ServerEmailEnvironmentVariable.MailgunRegion,
    ServerEmailEnvironmentVariable.PostmarkServerToken,
    ServerEmailEnvironmentVariable.ResendApiKey,
  ];

/*
 * The variables that hold a password or a key: never repeated in a
 * message, never sent to the Admin Dashboard - only whether they are set.
 */
export const SERVER_EMAIL_SECRET_VARIABLES: ReadonlyArray<ServerEmailEnvironmentVariable> =
  [
    ServerEmailEnvironmentVariable.SmtpPassword,
    ServerEmailEnvironmentVariable.SmtpOAuthClientSecret,
    ServerEmailEnvironmentVariable.SendgridApiKey,
    ServerEmailEnvironmentVariable.AmazonSesSecretAccessKey,
    ServerEmailEnvironmentVariable.MailgunApiKey,
    ServerEmailEnvironmentVariable.PostmarkServerToken,
    ServerEmailEnvironmentVariable.ResendApiKey,
  ];

/*
 * What GLOBAL_EMAIL_SERVER_TYPE is written as for each Email Server Type,
 * in the docs, the Helm chart and config.example.env. The Admin Dashboard's
 * own words ("Amazon SES") are taken too, in any case and with spaces,
 * hyphens or underscores (readChoice), and smtp for Custom SMTP.
 */
export const SERVER_EMAIL_SERVER_TYPE_VALUES: Readonly<
  Record<EmailServerType, string>
> = {
  [EmailServerType.CustomSMTP]: "custom-smtp",
  [EmailServerType.Sendgrid]: "sendgrid",
  [EmailServerType.AmazonSES]: "amazon-ses",
  [EmailServerType.Mailgun]: "mailgun",
  [EmailServerType.Postmark]: "postmark",
  [EmailServerType.Resend]: "resend",
};

// The transports a mail server of its own sends through.
export type ServerEmailSmtpTransport =
  | MailTransportType.SMTP
  | MailTransportType.MicrosoftGraph;

export const SERVER_EMAIL_SMTP_TRANSPORT_VALUES: Readonly<
  Record<ServerEmailSmtpTransport, string>
> = {
  [MailTransportType.SMTP]: "smtp",
  [MailTransportType.MicrosoftGraph]: "microsoft-graph",
};

export const SERVER_EMAIL_SMTP_AUTH_TYPE_VALUES: Readonly<
  Record<SMTPAuthenticationType, string>
> = {
  [SMTPAuthenticationType.UsernamePassword]: "username-and-password",
  [SMTPAuthenticationType.OAuth]: "oauth",
  [SMTPAuthenticationType.None]: "none",
};

export const SERVER_EMAIL_SMTP_OAUTH_PROVIDER_TYPE_VALUES: Readonly<
  Record<OAuthProviderType, string>
> = {
  [OAuthProviderType.ClientCredentials]: "client-credentials",
  [OAuthProviderType.JWTBearer]: "jwt-bearer",
};

export const SERVER_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE_VALUES: Readonly<
  Record<AmazonSesAuthenticationType, string>
> = {
  [AmazonSesAuthenticationType.AccessKey]: "access-key",
  [AmazonSesAuthenticationType.ServerIamRole]: "server-iam-role",
};

export const SERVER_EMAIL_MAILGUN_REGION_VALUES: Readonly<
  Record<MailgunRegion, string>
> = {
  [MailgunRegion.US]: "us",
  [MailgunRegion.EU]: "eu",
};

// Where the Admin Dashboard asks the server whether the variables set its email.
export const SERVER_EMAIL_ENVIRONMENT_ROUTE: string =
  "/global-config/email-environment";

/*
 * Said when someone tries to change settings the variables set: the server
 * refuses the write (GlobalConfigService), and the docs and the Admin
 * Dashboard say where the settings are changed instead.
 */
export const SERVER_EMAIL_SET_BY_ENVIRONMENT_MESSAGE: string = `This server's email settings are set by environment variables (${ServerEmailEnvironmentVariable.ServerType} and the other GLOBAL_EMAIL_ variables), so they cannot be changed in the Admin Dashboard. Change those variables - email in the Helm chart's values, or config.env with Docker Compose - and restart OneUptime.`;

/*
 * The columns of the server's email settings (Admin Dashboard > Settings >
 * Emails): what the variables stand in for once they are set, all of them -
 * a column the chosen type does not read is empty - and what nobody but
 * OneUptime itself may write meanwhile (GlobalConfigService).
 */
export type ServerEmailColumn =
  | "emailServerType"
  | "isSMTPSecure"
  | "smtpTransportType"
  | "smtpAuthType"
  | "smtpHost"
  | "smtpPort"
  | "smtpUsername"
  | "smtpPassword"
  | "smtpFromEmail"
  | "smtpFromName"
  | "smtpClientId"
  | "smtpClientSecret"
  | "smtpTokenUrl"
  | "smtpScope"
  | "smtpOAuthProviderType"
  | "sendgridApiKey"
  | "sendgridFromEmail"
  | "sendgridFromName"
  | "amazonSesAuthenticationType"
  | "amazonSesAccessKeyId"
  | "amazonSesSecretAccessKey"
  | "amazonSesRegion"
  | "amazonSesFromEmail"
  | "amazonSesFromName"
  | "mailgunApiKey"
  | "mailgunDomain"
  | "mailgunRegion"
  | "mailgunFromEmail"
  | "mailgunFromName"
  | "postmarkServerToken"
  | "postmarkFromEmail"
  | "postmarkFromName"
  | "resendApiKey"
  | "resendFromEmail"
  | "resendFromName";

export const SERVER_EMAIL_COLUMNS: ReadonlyArray<ServerEmailColumn> = [
  "emailServerType",
  "isSMTPSecure",
  "smtpTransportType",
  "smtpAuthType",
  "smtpHost",
  "smtpPort",
  "smtpUsername",
  "smtpPassword",
  "smtpFromEmail",
  "smtpFromName",
  "smtpClientId",
  "smtpClientSecret",
  "smtpTokenUrl",
  "smtpScope",
  "smtpOAuthProviderType",
  "sendgridApiKey",
  "sendgridFromEmail",
  "sendgridFromName",
  "amazonSesAuthenticationType",
  "amazonSesAccessKeyId",
  "amazonSesSecretAccessKey",
  "amazonSesRegion",
  "amazonSesFromEmail",
  "amazonSesFromName",
  "mailgunApiKey",
  "mailgunDomain",
  "mailgunRegion",
  "mailgunFromEmail",
  "mailgunFromName",
  "postmarkServerToken",
  "postmarkFromEmail",
  "postmarkFromName",
  "resendApiKey",
  "resendFromEmail",
  "resendFromName",
];

/*
 * The server's email settings by the names of the GlobalConfig columns they
 * stand in for: what the senders read (Server/Utils/ServerEmailSettings),
 * from the saved row or from the variables.
 */
export type ServerEmailSettings = Partial<
  Pick<GlobalConfig, ServerEmailColumn>
>;

export interface ServerEmailEnvironmentReading {
  // Whether GLOBAL_EMAIL_SERVER_TYPE is set: the variables are then the settings.
  isSet: boolean;
  // The Email Server Type the variables name, when it is one.
  serverType: EmailServerType | null;
  // The settings the variables give, when they name a type: every other column empty.
  settings: ServerEmailSettings | null;
  /*
   * What is wrong, each naming its variable and never a password or a key.
   * While the variables are set, settings with any problem send nothing.
   * While they are not, the problem is the variables set without
   * GLOBAL_EMAIL_SERVER_TYPE, which nothing reads.
   */
  problems: Array<string>;
  /*
   * The variables that hold a value the chosen settings do not read, such
   * as an SMTP host with SendGrid picked: nothing wrong with sending, but
   * a change to them changes nothing.
   */
  ignored: Array<ServerEmailEnvironmentVariable>;
  /*
   * Each variable that is set, as it is read: without the whitespace
   * around it. Passwords and keys too - the reading stays on the server;
   * what leaves it is the answer (toAnswer).
   */
  values: Readonly<Partial<Record<ServerEmailEnvironmentVariable, string>>>;
}

// One of the variables the chosen settings read, as the Admin Dashboard shows it.
export interface ServerEmailEnvironmentField {
  variable: ServerEmailEnvironmentVariable;
  // What it holds; null for a password or a key, or a variable left empty.
  value: string | null;
  // A password or a key: shown only as whether it is set.
  isSecret: boolean;
  isSet: boolean;
}

/*
 * The variables as the Admin Dashboard is told them (GET
 * /global-config/email-environment): the settings without a password or a
 * key - only whether each is set - and what is wrong with them.
 */
export interface ServerEmailEnvironmentAnswer {
  isSetByEnvironment: boolean;
  serverType: EmailServerType | null;
  // The variables the chosen settings read, in the order the page lists them.
  fields: Array<ServerEmailEnvironmentField>;
  problems: Array<string>;
  ignored: Array<ServerEmailEnvironmentVariable>;
}

export type ServerEmailEnvironmentValues = Readonly<
  Record<string, string | undefined>
>;

// "amazonses" for "Amazon SES", "amazon-ses" and "AMAZON_SES".
const comparable: (value: string) => string = (value: string): string => {
  return value.toLowerCase().replace(/[^a-z]/g, "");
};

// "A", "A and B", "A, B and C".
const listed: (names: Array<string>) => string = (
  names: Array<string>,
): string => {
  if (names.length <= 1) {
    return names.join("");
  }

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

// "A or B", "A, B or C".
const eitherOf: (names: Array<string>) => string = (
  names: Array<string>,
): string => {
  if (names.length <= 1) {
    return names.join("");
  }

  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
};

const NO_SETTINGS_ANSWER: ServerEmailEnvironmentAnswer = {
  isSetByEnvironment: false,
  serverType: null,
  fields: [],
  problems: [],
  ignored: [],
};

// An http or https URL's scheme and host, and any white space.
const HTTP_URL_START: RegExp = /^https?:\/\/[^\s/]+/i;
const WHITE_SPACE: RegExp = /\s/;
// A port as written: one to five digits.
const PORT_DIGITS: RegExp = /^[0-9]{1,5}$/;

export default class ServerEmailEnvironment {
  /*
   * The choice a variable names: the documented value, or the Admin
   * Dashboard's own words for it, in any case and with spaces, hyphens or
   * underscores. The default when it is empty, or null when it names none.
   */
  public static readChoice<T extends string>(
    value: string | undefined,
    values: Readonly<Record<T, string>>,
    defaultChoice: T | null,
    aliases: Readonly<Record<string, T>> = {},
  ): T | null {
    const written: string = comparable((value || "").trim());

    if (!written) {
      return defaultChoice;
    }

    for (const choice of Object.keys(values) as Array<T>) {
      if (
        comparable(choice) === written ||
        comparable(values[choice]) === written
      ) {
        return choice;
      }
    }

    for (const alias of Object.keys(aliases)) {
      if (comparable(alias) === written) {
        return aliases[alias] as T;
      }
    }

    return null;
  }

  // The Email Server Type GLOBAL_EMAIL_SERVER_TYPE names, or null.
  public static readServerType(
    value: string | undefined,
  ): EmailServerType | null {
    return ServerEmailEnvironment.readChoice<EmailServerType>(
      value,
      SERVER_EMAIL_SERVER_TYPE_VALUES,
      null,
      { smtp: EmailServerType.CustomSMTP },
    );
  }

  public static isSecret(variable: ServerEmailEnvironmentVariable): boolean {
    return SERVER_EMAIL_SECRET_VARIABLES.includes(variable);
  }

  /*
   * A mail server's host name or IP address alone, as the mail service
   * connects to it: no port (GLOBAL_EMAIL_SMTP_PORT has it), no user name,
   * no scheme or path.
   */
  public static isBareHost(value: string): boolean {
    const host: string = value.trim();

    if (
      !host ||
      host.includes("@") ||
      host.includes("/") ||
      host.includes("[")
    ) {
      return false;
    }

    // One colon is a port; an IPv6 address has two or more.
    if (host.split(":").length === 2) {
      return false;
    }

    return Hostname.isValid(host);
  }

  // An OAuth token endpoint: an http or https URL the server can parse.
  public static isTokenUrl(value: string): boolean {
    const text: string = value.trim();

    if (!HTTP_URL_START.test(text) || WHITE_SPACE.test(text)) {
      return false;
    }

    try {
      URL.fromString(text);
      return true;
    } catch {
      return false;
    }
  }

  /*
   * The server's email settings as the environment sets them - process.env
   * on the server, read again on every call, so nothing it held goes stale.
   * Each value is read without the whitespace around it: a key read from a
   * file keeps its final newline (helm --set-file, Terraform's file()).
   */
  public static read(
    environment: ServerEmailEnvironmentValues,
  ): ServerEmailEnvironmentReading {
    const value: (variable: ServerEmailEnvironmentVariable) => string = (
      variable: ServerEmailEnvironmentVariable,
    ): string => {
      const written: unknown = environment[variable];

      return typeof written === "string" ? written.trim() : "";
    };

    const setVariables: Array<ServerEmailEnvironmentVariable> =
      SERVER_EMAIL_ENVIRONMENT_VARIABLES.filter(
        (variable: ServerEmailEnvironmentVariable): boolean => {
          return Boolean(value(variable));
        },
      );

    const values: Partial<Record<ServerEmailEnvironmentVariable, string>> = {};

    for (const variable of setVariables) {
      values[variable] = value(variable);
    }

    const serverTypeText: string = value(
      ServerEmailEnvironmentVariable.ServerType,
    );

    if (!serverTypeText) {
      return {
        isSet: false,
        serverType: null,
        settings: null,
        problems:
          setVariables.length > 0
            ? [
                `${listed(setVariables)} ${setVariables.length === 1 ? "is" : "are"} set, but ${ServerEmailEnvironmentVariable.ServerType} is not, so nothing reads ${setVariables.length === 1 ? "it" : "them"}: the email settings saved in the Admin Dashboard are used. Set ${ServerEmailEnvironmentVariable.ServerType} too, or remove ${setVariables.length === 1 ? "it" : "them"}.`,
              ]
            : [],
        ignored: [],
        values: values,
      };
    }

    const serverType: EmailServerType | null =
      ServerEmailEnvironment.readServerType(serverTypeText);

    if (!serverType) {
      return {
        isSet: true,
        serverType: null,
        settings: null,
        problems: [
          `${ServerEmailEnvironmentVariable.ServerType} must be ${eitherOf(Object.values(SERVER_EMAIL_SERVER_TYPE_VALUES))}, not "${refusedValue(serverTypeText)}".`,
        ],
        ignored: [],
        values: values,
      };
    }

    const problems: Array<string> = [];
    /*
     * Only the columns the variables fill: one they leave empty is not
     * there, and reads as empty - never as the saved value.
     */
    const settings: ServerEmailSettings = { emailServerType: serverType };

    const put: <Column extends ServerEmailColumn>(
      column: Column,
      columnValue: GlobalConfig[Column] | undefined,
    ) => void = <Column extends ServerEmailColumn>(
      column: Column,
      columnValue: GlobalConfig[Column] | undefined,
    ): void => {
      if (columnValue === undefined || (columnValue as unknown) === "") {
        return;
      }

      (settings as Record<string, unknown>)[column] = columnValue;
    };

    // Each variable the chosen settings read, as they are read below.
    const readVariables: Set<ServerEmailEnvironmentVariable> = new Set([
      ServerEmailEnvironmentVariable.ServerType,
    ]);

    const take: (variable: ServerEmailEnvironmentVariable) => string = (
      variable: ServerEmailEnvironmentVariable,
    ): string => {
      readVariables.add(variable);
      return value(variable);
    };

    const notSet: (
      variable: ServerEmailEnvironmentVariable,
      why: string,
    ) => void = (variable: ServerEmailEnvironmentVariable, why: string) => {
      problems.push(`${variable} is not set: ${why}`);
    };

    // A choice the variable must name, or a problem that lists the ones it can.
    const choice: <T extends string>(
      variable: ServerEmailEnvironmentVariable,
      values: Readonly<Record<T, string>>,
      defaultChoice: T,
    ) => T = <T extends string>(
      variable: ServerEmailEnvironmentVariable,
      values: Readonly<Record<T, string>>,
      defaultChoice: T,
    ): T => {
      const text: string = take(variable);
      const picked: T | null = ServerEmailEnvironment.readChoice<T>(
        text,
        values,
        defaultChoice,
      );

      if (picked === null) {
        problems.push(
          `${variable} must be ${eitherOf(Object.values(values) as Array<string>)}, not "${refusedValue(text)}".`,
        );

        return defaultChoice;
      }

      return picked;
    };

    // Who the emails come from: every type needs the address.
    const fromEmailText: string = take(
      ServerEmailEnvironmentVariable.FromEmail,
    );
    let fromEmail: Email | undefined = undefined;

    if (!fromEmailText) {
      notSet(
        ServerEmailEnvironmentVariable.FromEmail,
        "every email needs the address it comes from.",
      );
    } else if (!Email.isValid(fromEmailText)) {
      problems.push(
        `${ServerEmailEnvironmentVariable.FromEmail}: "${refusedValue(fromEmailText)}" is not an email address.`,
      );
    } else {
      fromEmail = new Email(fromEmailText);
    }

    const fromName: string = take(ServerEmailEnvironmentVariable.FromName);

    /*
     * Custom SMTP and SendGrid send with the name too, as the Admin
     * Dashboard's forms ask for it; the providers with an HTTP API of their
     * own send with the product's name when it is empty.
     */
    if (
      !fromName &&
      (serverType === EmailServerType.CustomSMTP ||
        serverType === EmailServerType.Sendgrid)
    ) {
      notSet(
        ServerEmailEnvironmentVariable.FromName,
        `${SERVER_EMAIL_SERVER_TYPE_VALUES[serverType]} sends every email with the name it comes from.`,
      );
    }

    // A value the chosen settings cannot send without, and why when it is empty.
    const needed: (
      variable: ServerEmailEnvironmentVariable,
      why: string,
    ) => string = (
      variable: ServerEmailEnvironmentVariable,
      why: string,
    ): string => {
      const text: string = take(variable);

      if (!text) {
        notSet(variable, why);
      }

      return text;
    };

    switch (serverType) {
      case EmailServerType.CustomSMTP: {
        const transport: ServerEmailSmtpTransport =
          choice<ServerEmailSmtpTransport>(
            ServerEmailEnvironmentVariable.SmtpTransport,
            SERVER_EMAIL_SMTP_TRANSPORT_VALUES,
            MailTransportType.SMTP,
          );

        put("smtpTransportType", transport);
        put("smtpFromEmail", fromEmail);
        put("smtpFromName", fromName);

        let usesOAuth: boolean = transport === MailTransportType.MicrosoftGraph;
        let usesJwtBearer: boolean = false;

        if (transport === MailTransportType.SMTP) {
          const hostText: string = take(
            ServerEmailEnvironmentVariable.SmtpHost,
          );

          if (!hostText) {
            notSet(
              ServerEmailEnvironmentVariable.SmtpHost,
              "email goes out through that mail server, such as smtp.example.com.",
            );
          } else if (!ServerEmailEnvironment.isBareHost(hostText)) {
            problems.push(
              `${ServerEmailEnvironmentVariable.SmtpHost}: "${refusedValue(hostText)}" is not a host name, such as smtp.example.com. The port goes in ${ServerEmailEnvironmentVariable.SmtpPort}.`,
            );
          } else {
            put("smtpHost", new Hostname(hostText));
          }

          const portText: string = take(
            ServerEmailEnvironmentVariable.SmtpPort,
          );

          if (!portText) {
            notSet(
              ServerEmailEnvironmentVariable.SmtpPort,
              "most mail servers take 587.",
            );
          } else if (
            !PORT_DIGITS.test(portText) ||
            Number(portText) < 1 ||
            Number(portText) > 65535
          ) {
            problems.push(
              `${ServerEmailEnvironmentVariable.SmtpPort}: "${refusedValue(portText)}" is not a port, a number from 1 to 65535 such as 587.`,
            );
          } else {
            put("smtpPort", new Port(Number(portText)));
          }

          const requireTlsText: string = take(
            ServerEmailEnvironmentVariable.SmtpRequireTls,
          ).toLowerCase();

          if (requireTlsText === "true") {
            put("isSMTPSecure", true);
          } else if (!requireTlsText || requireTlsText === "false") {
            put("isSMTPSecure", false);
          } else {
            problems.push(
              `${ServerEmailEnvironmentVariable.SmtpRequireTls} must be true or false, not "${refusedValue(requireTlsText)}".`,
            );
          }

          const authType: SMTPAuthenticationType =
            choice<SMTPAuthenticationType>(
              ServerEmailEnvironmentVariable.SmtpAuthType,
              SERVER_EMAIL_SMTP_AUTH_TYPE_VALUES,
              SMTPAuthenticationType.UsernamePassword,
            );

          put("smtpAuthType", authType);

          if (authType === SMTPAuthenticationType.UsernamePassword) {
            /*
             * Both or neither: the mail service signs in only with both, so
             * one alone would send without signing in - most often a
             * password that did not arrive from its Secret.
             */
            const username: string = take(
              ServerEmailEnvironmentVariable.SmtpUsername,
            );
            const password: string = take(
              ServerEmailEnvironmentVariable.SmtpPassword,
            );

            if (username && !password) {
              notSet(
                ServerEmailEnvironmentVariable.SmtpPassword,
                `the mail server is signed in to with ${ServerEmailEnvironmentVariable.SmtpUsername} and a password. Set it, or set ${ServerEmailEnvironmentVariable.SmtpAuthType} to none to send without signing in.`,
              );
            } else if (password && !username) {
              notSet(
                ServerEmailEnvironmentVariable.SmtpUsername,
                `the mail server is signed in to with a username and ${ServerEmailEnvironmentVariable.SmtpPassword}.`,
              );
            }

            put("smtpUsername", username);
            put("smtpPassword", password);
          } else if (authType === SMTPAuthenticationType.OAuth) {
            const providerType: OAuthProviderType = choice<OAuthProviderType>(
              ServerEmailEnvironmentVariable.SmtpOAuthProviderType,
              SERVER_EMAIL_SMTP_OAUTH_PROVIDER_TYPE_VALUES,
              OAuthProviderType.ClientCredentials,
            );

            // Left empty, as an admin who never picked it: Client Credentials.
            put(
              "smtpOAuthProviderType",
              value(ServerEmailEnvironmentVariable.SmtpOAuthProviderType)
                ? providerType
                : undefined,
            );

            usesJwtBearer = providerType === OAuthProviderType.JWTBearer;

            /*
             * The mailbox OAuth signs in as, with either grant: the user
             * the mail server's XOAUTH2 sign-in names, and what JWT Bearer
             * impersonates. MailService refuses every email without one,
             * so the settings are not usable without it.
             */
            const username: string = take(
              ServerEmailEnvironmentVariable.SmtpUsername,
            );

            if (!username) {
              notSet(
                ServerEmailEnvironmentVariable.SmtpUsername,
                `with ${ServerEmailEnvironmentVariable.SmtpAuthType} ${SERVER_EMAIL_SMTP_AUTH_TYPE_VALUES[SMTPAuthenticationType.OAuth]}, the mail server is signed in to as that mailbox, such as alerts@example.com.`,
              );
            }

            put("smtpUsername", username);
            usesOAuth = true;
          }
        }

        if (usesOAuth) {
          const signsInWith: string =
            transport === MailTransportType.MicrosoftGraph
              ? "Microsoft Graph sends with an OAuth app's client ID, client secret, token URL and scope."
              : "the mail server is signed in to with an OAuth app's client ID, client secret, token URL and scope.";

          put(
            "smtpClientId",
            needed(
              ServerEmailEnvironmentVariable.SmtpOAuthClientId,
              signsInWith,
            ),
          );

          const clientSecret: string = needed(
            ServerEmailEnvironmentVariable.SmtpOAuthClientSecret,
            signsInWith,
          );

          /*
           * JWT Bearer signs its request with a private key, given as the
           * client secret: anything else could never sign in
           * (SMTPOAuthService). Said without the value.
           */
          if (
            clientSecret &&
            usesJwtBearer &&
            !(
              clientSecret.includes("-----BEGIN") &&
              clientSecret.includes("PRIVATE KEY")
            )
          ) {
            problems.push(
              `${ServerEmailEnvironmentVariable.SmtpOAuthClientSecret} is not a private key in PEM format (-----BEGIN PRIVATE KEY-----), which ${SERVER_EMAIL_SMTP_OAUTH_PROVIDER_TYPE_VALUES[OAuthProviderType.JWTBearer]} signs in with.`,
            );
          }

          put("smtpClientSecret", clientSecret);

          const tokenUrlText: string = needed(
            ServerEmailEnvironmentVariable.SmtpOAuthTokenUrl,
            signsInWith,
          );

          if (tokenUrlText) {
            if (ServerEmailEnvironment.isTokenUrl(tokenUrlText)) {
              put("smtpTokenUrl", tokenUrlText);
            } else {
              problems.push(
                `${ServerEmailEnvironmentVariable.SmtpOAuthTokenUrl}: "${refusedValue(tokenUrlText)}" is not a URL, such as https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token.`,
              );
            }
          }

          put(
            "smtpScope",
            needed(ServerEmailEnvironmentVariable.SmtpOAuthScope, signsInWith),
          );
        }

        break;
      }

      case EmailServerType.Sendgrid: {
        put(
          "sendgridApiKey",
          needed(
            ServerEmailEnvironmentVariable.SendgridApiKey,
            "SendGrid sends nothing without it.",
          ),
        );
        put("sendgridFromEmail", fromEmail);
        put("sendgridFromName", fromName);
        break;
      }

      case EmailServerType.AmazonSES: {
        const authenticationType: AmazonSesAuthenticationType =
          choice<AmazonSesAuthenticationType>(
            ServerEmailEnvironmentVariable.AmazonSesAuthenticationType,
            SERVER_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE_VALUES,
            AmazonSesAuthenticationType.AccessKey,
          );

        put("amazonSesAuthenticationType", authenticationType);

        /*
         * Signed in as the server's own IAM role (#7000), it needs no key:
         * the credentials are the role's, fetched when the email goes.
         */
        if (authenticationType === AmazonSesAuthenticationType.AccessKey) {
          const signsInWith: string = `Amazon SES is signed in to with an access key, unless ${ServerEmailEnvironmentVariable.AmazonSesAuthenticationType} is ${SERVER_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE_VALUES[AmazonSesAuthenticationType.ServerIamRole]}.`;

          put(
            "amazonSesAccessKeyId",
            needed(
              ServerEmailEnvironmentVariable.AmazonSesAccessKeyId,
              signsInWith,
            ),
          );
          put(
            "amazonSesSecretAccessKey",
            needed(
              ServerEmailEnvironmentVariable.AmazonSesSecretAccessKey,
              signsInWith,
            ),
          );
        }

        const regionText: string = take(
          ServerEmailEnvironmentVariable.AmazonSesRegion,
        ).toLowerCase();

        if (!regionText) {
          notSet(
            ServerEmailEnvironmentVariable.AmazonSesRegion,
            "Amazon SES sends from the Region your sender is verified in, such as us-east-1.",
          );
        } else if (!isAwsRegion(regionText)) {
          problems.push(
            `${ServerEmailEnvironmentVariable.AmazonSesRegion}: "${refusedValue(regionText)}" is not an AWS Region code, such as us-east-1.`,
          );
        } else {
          put("amazonSesRegion", regionText);
        }

        put("amazonSesFromEmail", fromEmail);
        put("amazonSesFromName", fromName);
        break;
      }

      case EmailServerType.Mailgun: {
        put(
          "mailgunApiKey",
          needed(
            ServerEmailEnvironmentVariable.MailgunApiKey,
            "Mailgun sends nothing without it.",
          ),
        );

        const domainText: string = take(
          ServerEmailEnvironmentVariable.MailgunDomain,
        ).toLowerCase();

        if (!domainText) {
          notSet(
            ServerEmailEnvironmentVariable.MailgunDomain,
            "Mailgun sends from that domain, such as mg.example.com.",
          );
        } else if (!isMailgunDomain(domainText)) {
          problems.push(
            `${ServerEmailEnvironmentVariable.MailgunDomain}: "${refusedValue(domainText)}" is not a domain, such as mg.example.com.`,
          );
        } else {
          put("mailgunDomain", domainText);
        }

        put(
          "mailgunRegion",
          choice<MailgunRegion>(
            ServerEmailEnvironmentVariable.MailgunRegion,
            SERVER_EMAIL_MAILGUN_REGION_VALUES,
            MailgunRegion.US,
          ),
        );
        put("mailgunFromEmail", fromEmail);
        put("mailgunFromName", fromName);
        break;
      }

      case EmailServerType.Postmark: {
        put(
          "postmarkServerToken",
          needed(
            ServerEmailEnvironmentVariable.PostmarkServerToken,
            "Postmark sends nothing without the server's API token.",
          ),
        );
        put("postmarkFromEmail", fromEmail);
        put("postmarkFromName", fromName);
        break;
      }

      case EmailServerType.Resend: {
        put(
          "resendApiKey",
          needed(
            ServerEmailEnvironmentVariable.ResendApiKey,
            "Resend sends nothing without it.",
          ),
        );
        put("resendFromEmail", fromEmail);
        put("resendFromName", fromName);
        break;
      }
    }

    // In the variables' own order, whatever order they were read in.
    const orderedProblems: Array<string> = [...problems].sort(
      (a: string, b: string): number => {
        return (
          ServerEmailEnvironment.variableOrderOf(a) -
          ServerEmailEnvironment.variableOrderOf(b)
        );
      },
    );

    return {
      isSet: true,
      serverType: serverType,
      settings: settings,
      problems: orderedProblems,
      ignored: setVariables.filter(
        (variable: ServerEmailEnvironmentVariable): boolean => {
          return !readVariables.has(variable);
        },
      ),
      values: values,
    };
  }

  // Where a problem's variable comes in SERVER_EMAIL_ENVIRONMENT_VARIABLES.
  private static variableOrderOf(problem: string): number {
    const index: number = SERVER_EMAIL_ENVIRONMENT_VARIABLES.findIndex(
      (variable: ServerEmailEnvironmentVariable): boolean => {
        return (
          problem.startsWith(`${variable} `) ||
          problem.startsWith(`${variable}:`)
        );
      },
    );

    return index === -1 ? SERVER_EMAIL_ENVIRONMENT_VARIABLES.length : index;
  }

  // Whether the settings the variables set can send: set, with nothing wrong.
  public static isUsable(reading: ServerEmailEnvironmentReading): boolean {
    return (
      reading.isSet &&
      reading.serverType !== null &&
      reading.settings !== null &&
      reading.problems.length === 0
    );
  }

  /*
   * The variables the chosen settings read, in the order the Admin
   * Dashboard lists them: the type, its own settings, then who the emails
   * come from.
   */
  public static getReadVariables(
    reading: ServerEmailEnvironmentReading,
  ): Array<ServerEmailEnvironmentVariable> {
    if (!reading.isSet) {
      return [];
    }

    // A type that is not one: only it, beside the problem that says so.
    if (!reading.serverType || !reading.settings) {
      return [ServerEmailEnvironmentVariable.ServerType];
    }

    const settings: ServerEmailSettings = reading.settings;
    const own: Array<ServerEmailEnvironmentVariable> = [];

    switch (reading.serverType) {
      case EmailServerType.CustomSMTP: {
        own.push(ServerEmailEnvironmentVariable.SmtpTransport);

        const isGraph: boolean =
          settings.smtpTransportType === MailTransportType.MicrosoftGraph;

        if (!isGraph) {
          own.push(
            ServerEmailEnvironmentVariable.SmtpHost,
            ServerEmailEnvironmentVariable.SmtpPort,
            ServerEmailEnvironmentVariable.SmtpRequireTls,
            ServerEmailEnvironmentVariable.SmtpAuthType,
          );

          if (
            settings.smtpAuthType === SMTPAuthenticationType.UsernamePassword
          ) {
            own.push(
              ServerEmailEnvironmentVariable.SmtpUsername,
              ServerEmailEnvironmentVariable.SmtpPassword,
            );
          } else if (settings.smtpAuthType === SMTPAuthenticationType.OAuth) {
            own.push(
              ServerEmailEnvironmentVariable.SmtpUsername,
              ServerEmailEnvironmentVariable.SmtpOAuthProviderType,
            );
          }
        }

        if (isGraph || settings.smtpAuthType === SMTPAuthenticationType.OAuth) {
          own.push(
            ServerEmailEnvironmentVariable.SmtpOAuthClientId,
            ServerEmailEnvironmentVariable.SmtpOAuthClientSecret,
            ServerEmailEnvironmentVariable.SmtpOAuthTokenUrl,
            ServerEmailEnvironmentVariable.SmtpOAuthScope,
          );
        }

        break;
      }

      case EmailServerType.Sendgrid:
        own.push(ServerEmailEnvironmentVariable.SendgridApiKey);
        break;

      case EmailServerType.AmazonSES:
        own.push(ServerEmailEnvironmentVariable.AmazonSesAuthenticationType);

        if (
          settings.amazonSesAuthenticationType !==
          AmazonSesAuthenticationType.ServerIamRole
        ) {
          own.push(
            ServerEmailEnvironmentVariable.AmazonSesAccessKeyId,
            ServerEmailEnvironmentVariable.AmazonSesSecretAccessKey,
          );
        }

        own.push(ServerEmailEnvironmentVariable.AmazonSesRegion);
        break;

      case EmailServerType.Mailgun:
        own.push(
          ServerEmailEnvironmentVariable.MailgunApiKey,
          ServerEmailEnvironmentVariable.MailgunDomain,
          ServerEmailEnvironmentVariable.MailgunRegion,
        );
        break;

      case EmailServerType.Postmark:
        own.push(ServerEmailEnvironmentVariable.PostmarkServerToken);
        break;

      case EmailServerType.Resend:
        own.push(ServerEmailEnvironmentVariable.ResendApiKey);
        break;
    }

    return [
      ServerEmailEnvironmentVariable.ServerType,
      ...own,
      ServerEmailEnvironmentVariable.FromEmail,
      ServerEmailEnvironmentVariable.FromName,
    ];
  }

  // What the Admin Dashboard is told: never a password or a key.
  public static toAnswer(
    reading: ServerEmailEnvironmentReading,
  ): ServerEmailEnvironmentAnswer {
    if (!reading.isSet) {
      return {
        ...NO_SETTINGS_ANSWER,
        problems: [...reading.problems],
      };
    }

    const fields: Array<ServerEmailEnvironmentField> =
      ServerEmailEnvironment.getReadVariables(reading).map(
        (
          variable: ServerEmailEnvironmentVariable,
        ): ServerEmailEnvironmentField => {
          const text: string = reading.values[variable] || "";
          const isSecret: boolean = ServerEmailEnvironment.isSecret(variable);

          return {
            variable: variable,
            value: isSecret || !text ? null : text,
            isSecret: isSecret,
            isSet: Boolean(text),
          };
        },
      );

    return {
      isSetByEnvironment: true,
      serverType: reading.serverType,
      fields: fields,
      problems: [...reading.problems],
      ignored: [...reading.ignored],
    };
  }

  /*
   * The answer as the Admin Dashboard reads it back. Anything that is not
   * the answer's shape reads as the variables not set, so the page shows
   * the saved settings and their Edit buttons, and the server still refuses
   * a write it must not take.
   */
  public static answerFromJSON(json: unknown): ServerEmailEnvironmentAnswer {
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return { ...NO_SETTINGS_ANSWER, fields: [], problems: [], ignored: [] };
    }

    const data: JSONObject = json as JSONObject;

    const isVariable: (
      variable: unknown,
    ) => variable is ServerEmailEnvironmentVariable = (
      variable: unknown,
    ): variable is ServerEmailEnvironmentVariable => {
      return (
        SERVER_EMAIL_ENVIRONMENT_VARIABLES as ReadonlyArray<unknown>
      ).includes(variable);
    };

    const texts: (key: string) => Array<string> = (
      key: string,
    ): Array<string> => {
      return Array.isArray(data[key])
        ? (data[key] as Array<unknown>).filter(
            (text: unknown): text is string => {
              return typeof text === "string" && text.length > 0;
            },
          )
        : [];
    };

    const serverType: unknown = data["serverType"];

    const fields: Array<ServerEmailEnvironmentField> = Array.isArray(
      data["fields"],
    )
      ? (data["fields"] as Array<unknown>).flatMap(
          (field: unknown): Array<ServerEmailEnvironmentField> => {
            if (!field || typeof field !== "object" || Array.isArray(field)) {
              return [];
            }

            const entry: JSONObject = field as JSONObject;

            if (!isVariable(entry["variable"])) {
              return [];
            }

            const variable: ServerEmailEnvironmentVariable = entry["variable"];
            const isSecret: boolean = ServerEmailEnvironment.isSecret(variable);
            const value: unknown = entry["value"];

            return [
              {
                variable: variable,
                // A secret's value is never shown, whatever came back.
                value:
                  !isSecret && typeof value === "string" && value.trim()
                    ? value
                    : null,
                isSecret: isSecret,
                isSet: entry["isSet"] === true,
              },
            ];
          },
        )
      : [];

    return {
      isSetByEnvironment: data["isSetByEnvironment"] === true,
      serverType: (Object.values(EmailServerType) as Array<unknown>).includes(
        serverType,
      )
        ? (serverType as EmailServerType)
        : null,
      fields: fields,
      problems: texts("problems"),
      ignored: texts("ignored").filter(isVariable),
    };
  }

  /*
   * What the server says once as it starts, so nobody looks for the
   * settings in the Admin Dashboard: the variables set them. Null when
   * GLOBAL_EMAIL_SERVER_TYPE is not set.
   */
  public static getStartupNotice(
    reading: ServerEmailEnvironmentReading,
  ): string | null {
    if (!reading.isSet) {
      return null;
    }

    return `The server's email settings are set by environment variables (${ServerEmailEnvironmentVariable.ServerType} and the other GLOBAL_EMAIL_ variables): the settings saved in the Admin Dashboard are not used.`;
  }

  /*
   * The variables that hold a value nothing reads with the chosen settings,
   * as the server and the Admin Dashboard say it. Null when there are none.
   */
  public static getIgnoredMessage(
    reading: ServerEmailEnvironmentReading,
  ): string | null {
    if (!reading.isSet || reading.ignored.length === 0) {
      return null;
    }

    const count: number = reading.ignored.length;

    return `${listed(reading.ignored)} ${count === 1 ? "is" : "are"} set, but the email settings the GLOBAL_EMAIL_ variables describe do not read ${count === 1 ? "it" : "them"}, so ${count === 1 ? "it changes" : "they change"} nothing. Remove ${count === 1 ? "it" : "them"}, or check ${ServerEmailEnvironmentVariable.ServerType} and the variables that pick how email is sent.`;
  }

  // What is wrong with the variables, as the server says it when it starts.
  public static getStartupWarning(
    reading: ServerEmailEnvironmentReading,
  ): string | null {
    const ignored: string | null =
      ServerEmailEnvironment.getIgnoredMessage(reading);

    if (reading.problems.length === 0) {
      return ignored;
    }

    if (!reading.isSet) {
      return reading.problems.join(" ");
    }

    const warning: string = `The email settings set by environment variables send no email until this is fixed: ${reading.problems.join(" ")}`;

    return ignored ? `${warning} ${ignored}` : warning;
  }
}
