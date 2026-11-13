import GlobalConfig, {
  EmailServerType,
} from "../../../Models/DatabaseModels/GlobalConfig";
import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import { isAwsRegion } from "../../../Types/Cloud/AwsRegionCode";
import AmazonSesAuthenticationType, {
  toAmazonSesAuthenticationType,
} from "../../../Types/Email/AmazonSesAuthenticationType";
import { isMailgunDomain } from "../../../Types/Email/MailgunDomain";
import MailgunRegion, {
  DEFAULT_MAILGUN_REGION,
} from "../../../Types/Email/MailgunRegion";
import MailTransportType, {
  toMailTransportType,
} from "../../../Types/Email/MailTransportType";
import IconProp from "../../../Types/Icon/IconProp";
import OAuthProviderType from "../../../Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "../../../Types/Email/SMTPAuthenticationType";
import SelectFormFields from "../../Types/SelectEntityField";
import { translationKey } from "../../Utils/TranslateTemplate";
import type { CardSelectOption } from "../CardSelect/CardSelect";
import type { RadioButton } from "../RadioButtons/GroupRadioButtons";
import Field, { FormFieldCollapsibleSection } from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import { FormStep } from "../Forms/Types/FormStep";
import FormValues from "../Forms/Types/FormValues";
import {
  getAdvancedFormSection,
  normalizeFormValue,
} from "../Forms/Utils/AdvancedFormSection";

/*
 * ADDING A MAIL SERVER ASKS FOR THE SERVER, THE SIGN-IN AND THE SENDER;
 * TRANSPORT, OAUTH AND TLS WAIT UNDER ADVANCED.
 *
 * "The idea is to make software as simple as possible to use and reduce
 * decision paralysis." - the maintainer.
 *
 * A project's Custom SMTP config (Settings > Notification Settings) walked
 * six steps - Basic, Transport, SMTP Server, Authentication, OAuth Settings,
 * Email - and the Admin Dashboard's instance mail server (Settings > Emails,
 * the Custom Email and SMTP Settings card) the same five but Basic. The
 * Transport step was one dropdown, already
 * on SMTP. "Use SSL / TLS" was asked although the mail service decides TLS
 * from the port on its own (port 465 is always TLS) and only reads the
 * switch as "require it" everywhere else, and the port had no value to
 * start from. Both forms are now this one builder, given each one's column
 * names, in two steps:
 *
 *   Server   Name (a project's config), Hostname, Port, Username and
 *            Password - what a provider's SMTP settings page lists
 *            together - and one folded Advanced section:
 *              Transport (SMTP, or Microsoft Graph for a Microsoft 365
 *              tenant with SMTP AUTH turned off), Require TLS, the
 *              Authentication type, the OAuth fields (shown once OAuth or
 *              Microsoft Graph is picked) and, for a project's config, the
 *              Description.
 *   Sender   From Email and From Name: who the mail comes from.
 *
 * Picking Microsoft Graph hides the hostname, port, username and password,
 * which Graph does not use, and shows the OAuth fields it needs, right below
 * the Transport it was picked in. While folded, the Advanced header says in
 * a sentence how mail is sent ("Mail is sent over SMTP, signing in with the
 * username and password. TLS is required."), so someone looking for
 * Microsoft Graph or TLS can tell where they went without opening it.
 *
 * Only the layout changed. The columns, the API and the mail service are as
 * they were: an existing config opens with its own values, and saves them
 * unchanged. A new project config starts on port 587 (the form's own start:
 * the column has no default, so an API caller still sends a port) with TLS
 * required (the column's default, which ModelForm starts every create form
 * from). The instance's mail server is an edit form of the one GlobalConfig
 * row, so nothing is filled in there: 587 is only its placeholder.
 *
 * React-free: the Dashboard and the Admin Dashboard both build their forms
 * from it. The step ids are written as strings on every field, so
 * Tests/Helpers/FormStepsScan places each field on its step, and the
 * Advanced section is built once per form and handed to every folded field,
 * so the scan counts it as one row.
 *
 * A PROJECT'S CONFIG ASKS FOR ITS PROVIDER FIRST.
 *
 * A project can send through a mail server, or through a provider's HTTPS
 * API with a key of the provider's own: Amazon SES, SendGrid, Mailgun,
 * Postmark or Resend - or Microsoft Graph, for a Microsoft 365 tenant with
 * SMTP AUTH turned off. Which one is the first thing to know, and nobody
 * looks for it under Advanced, so a project's form opens on it:
 *
 *   Provider     Name, the provider (one card each, SMTP Server first),
 *                and the Description folded under More fields;
 *   Server       SMTP only: Hostname, Port, Username, Password, and the
 *                folded TLS, sign-in type and OAuth grant;
 *   OAuth        Microsoft Graph, or SMTP signing in with OAuth: the OAuth
 *                app's Client ID, Client Secret, Token URL and Scope;
 *   Amazon SES   its Access Key ID, Secret Access Key and Region;
 *   SendGrid     its API Key;
 *   Mailgun      its API Key, sending Domain and Region (US or EU);
 *   Postmark     its Server API Token;
 *   Resend       its API Key;
 *   Sender       From Email, From Name.
 *
 * Each provider's step is shown only for that provider (FormStep.showIf),
 * so a form asks only what the provider it sends through needs - never a
 * hostname for SendGrid, never an API key for an SMTP server - and no step
 * holds more than five rows. The instance's mail server (the Admin
 * Dashboard's Custom SMTP card) keeps Server, then Sender: there, the
 * providers with an HTTP API of their own are Email Server Types, each with
 * a card of its own (getGlobalEmailProviderFormFields).
 */

/*
 * What the form has to know of a surface: the column it keeps each value in,
 * and how its mail service treats a blank sign-in.
 */
export interface SmtpConfigFormColumns<TEntity> {
  transportType: Extract<keyof TEntity, string>;
  hostname: Extract<keyof TEntity, string>;
  port: Extract<keyof TEntity, string>;
  username: Extract<keyof TEntity, string>;
  password: Extract<keyof TEntity, string>;
  // The "Require TLS" switch.
  secure: Extract<keyof TEntity, string>;
  authType: Extract<keyof TEntity, string>;
  oauthProviderType: Extract<keyof TEntity, string>;
  clientId: Extract<keyof TEntity, string>;
  clientSecret: Extract<keyof TEntity, string>;
  tokenUrl: Extract<keyof TEntity, string>;
  scope: Extract<keyof TEntity, string>;
  fromEmail: Extract<keyof TEntity, string>;
  fromName: Extract<keyof TEntity, string>;
  /*
   * A project's config only: the note about it, folded under Advanced. (Its
   * name, the first field, is getProjectSmtpConfigFormFields' own.)
   */
  configDescription?: Extract<keyof TEntity, string> | undefined;
  /*
   * The instance's server signs in with a username and password only when
   * both are set, and sends without signing in otherwise
   * (Notification/Config.ts, then MailService.createTransporter) - which is
   * how a self-hosted relay that needs no sign-in has always run. A
   * project's config is refused without them instead
   * (ProjectSmtpConfigService.toEmailServer), so its header keeps saying
   * what it signs in with.
   */
  sendsWithoutSignInWhenCredentialsAreBlank?: boolean | undefined;
}

// Settings > Notification Settings > Custom SMTP Configs.
export const PROJECT_SMTP_CONFIG_FORM_COLUMNS: SmtpConfigFormColumns<ProjectSmtpConfig> =
  {
    transportType: "transportType",
    hostname: "hostname",
    port: "port",
    username: "username",
    password: "password",
    secure: "secure",
    authType: "authType",
    oauthProviderType: "oauthProviderType",
    clientId: "clientId",
    clientSecret: "clientSecret",
    tokenUrl: "tokenUrl",
    scope: "scope",
    fromEmail: "fromEmail",
    fromName: "fromName",
    configDescription: "description",
  };

/*
 * Admin Dashboard > Settings > Emails, the Custom Email and SMTP Settings
 * card: the server the instance itself sends from.
 */
export const GLOBAL_SMTP_CONFIG_FORM_COLUMNS: SmtpConfigFormColumns<GlobalConfig> =
  {
    transportType: "smtpTransportType",
    hostname: "smtpHost",
    port: "smtpPort",
    username: "smtpUsername",
    password: "smtpPassword",
    secure: "isSMTPSecure",
    authType: "smtpAuthType",
    oauthProviderType: "smtpOAuthProviderType",
    clientId: "smtpClientId",
    clientSecret: "smtpClientSecret",
    tokenUrl: "smtpTokenUrl",
    scope: "smtpScope",
    fromEmail: "smtpFromEmail",
    fromName: "smtpFromName",
    sendsWithoutSignInWhenCredentialsAreBlank: true,
  };

/*
 * The two steps' ids. The fields write them out as strings, which is what
 * Tests/Helpers/FormStepsScan reads a field's step from; the builder's
 * tests hold every field to these two.
 */
export const SMTP_SERVER_STEP_ID: string = "server";

export const SMTP_SENDER_STEP_ID: string = "sender";

/*
 * The port a new project config starts on: the submission port (STARTTLS)
 * nearly every provider gives. Only a create form's start - the column has
 * no default. Every form's Port placeholder says the same.
 */
export const DEFAULT_SMTP_PORT: number = 587;

/*
 * The port the mail service speaks TLS on from the first byte, whatever
 * Require TLS says (App/Tests/Notification/SmtpRequireTlsMeaning pins it).
 */
export const IMPLICIT_TLS_SMTP_PORT: number = 465;

export const SMTP_PORT_DESCRIPTION: string = translationKey(
  "The port your provider gives you, usually 587. Port 465 is always encrypted.",
);

export const SMTP_USERNAME_DESCRIPTION: string = translationKey(
  "The account OneUptime signs in as, often the email address you send from. With OAuth, enter the email address of the mailbox that sends.",
);

export const SMTP_PASSWORD_DESCRIPTION: string = translationKey(
  "The account's password, or the API key your provider gives you for SMTP.",
);

/*
 * TRANSPORT, SIGN-IN AND OAUTH GRANT: PLAIN CHOICES.
 *
 * "Shouldnt this be two buttons ... to make it easier for people to
 * understand whats going on." (the maintainer, on a switch whose
 * description explained both of its modes)
 *
 * Transport, Authentication Type and OAuth Provider Type were dropdowns
 * whose one description named every answer ("SMTP works with most mail
 * servers. Pick Microsoft Graph if ..."), so a reader had to open the list
 * and match the names back to the sentence. They are now the answers
 * themselves, each with one line saying when to pick it, the default
 * first. The answers keep their names - the values the API, Terraform and
 * the guides use - and every stored config reads as before.
 */
export const SMTP_TRANSPORT_DESCRIPTION: string = translationKey(
  "How OneUptime sends your mail.",
);

export const SMTP_TRANSPORT_CHOICES: Array<RadioButton> = [
  {
    value: MailTransportType.SMTP,
    title: translationKey("SMTP"),
    description: translationKey("Works with most mail servers."),
  },
  {
    value: MailTransportType.MicrosoftGraph,
    title: translationKey("Microsoft Graph"),
    description: translationKey(
      "For a Microsoft 365 tenant with SMTP AUTH turned off.",
    ),
  },
];

export const SMTP_AUTH_TYPE_DESCRIPTION: string = translationKey(
  "How OneUptime signs in to your mail server.",
);

export const SMTP_AUTH_TYPE_CHOICES: Array<RadioButton> = [
  {
    value: SMTPAuthenticationType.UsernamePassword,
    title: translationKey("Username and Password"),
    description: translationKey(
      "The account's password, or an API key your provider gives you.",
    ),
  },
  {
    value: SMTPAuthenticationType.OAuth,
    title: translationKey("OAuth"),
    description: translationKey(
      "For Microsoft 365 and Google Workspace, where passwords are often turned off.",
    ),
  },
  {
    value: SMTPAuthenticationType.None,
    title: translationKey("None"),
    description: translationKey("For a relay that needs no sign-in."),
  },
];

export const SMTP_OAUTH_PROVIDER_TYPE_DESCRIPTION: string = translationKey(
  "The OAuth grant your provider uses.",
);

export const SMTP_OAUTH_PROVIDER_TYPE_CHOICES: Array<RadioButton> = [
  {
    value: OAuthProviderType.ClientCredentials,
    title: translationKey("Client Credentials"),
    description: translationKey("Microsoft 365 and most other providers."),
  },
  {
    value: OAuthProviderType.JWTBearer,
    title: translationKey("JWT Bearer"),
    description: translationKey("Google Workspace service accounts."),
  },
];

/*
 * What the switch does, from the mail service: on, a connection that is not
 * encrypted with a valid certificate is refused (STARTTLS is required on
 * every port but 465); off, STARTTLS is used when the server offers it and
 * the certificate is not checked. Port 465 is TLS from the first byte either
 * way. "Use SSL / TLS" said none of that, and the instance form's "Do not
 * enable this if you use port 587" was the opposite of the advice now.
 */
export const SMTP_REQUIRE_TLS_DESCRIPTION: string = translationKey(
  "Send mail only over an encrypted connection with a valid certificate. When off, the certificate is not checked. Port 465 is always encrypted.",
);

/*
 * The scope each OAuth app takes, on both forms: Graph's, Microsoft 365 SMTP's, Google's. Each scope is written
 * whole, so the labels stay short to keep it within ShortDescriptionsGuard's 150 characters.
 */
export const SMTP_OAUTH_SCOPE_DESCRIPTION: string =
  "Microsoft Graph: https://graph.microsoft.com/.default. Microsoft 365 SMTP: https://outlook.office365.com/.default. Google: https://mail.google.com/";

export const SMTP_FROM_EMAIL_DESCRIPTION: string = translationKey(
  "The address your emails come from. Your server must allow sending from it; with Microsoft Graph, it is the mailbox that sends.",
);

/*
 * What the folded Advanced header says: how mail is sent, then (over SMTP)
 * whether TLS is required. Whole sentences, each looked up on its own.
 */
export const SMTP_SUMMARY_PASSWORD: string = translationKey(
  "Mail is sent over SMTP, signing in with the username and password.",
);

export const SMTP_SUMMARY_OAUTH: string = translationKey(
  "Mail is sent over SMTP, signing in with OAuth.",
);

export const SMTP_SUMMARY_NO_SIGN_IN: string = translationKey(
  "Mail is sent over SMTP without signing in.",
);

export const SMTP_SUMMARY_MICROSOFT_GRAPH: string = translationKey(
  "Mail is sent through Microsoft Graph, signing in with OAuth.",
);

export const SMTP_SUMMARY_TLS_REQUIRED: string =
  translationKey("TLS is required.");

export const SMTP_SUMMARY_TLS_OPTIONAL: string = translationKey(
  "TLS is used only if the server offers it.",
);

// Port 465 speaks TLS from the first byte; off only skips the certificate.
export const SMTP_SUMMARY_TLS_PORT_465_UNCHECKED: string = translationKey(
  "Port 465 is always encrypted, but the certificate is not checked.",
);

type ReadValueFunction = (values: unknown, key: string | undefined) => unknown;

/*
 * One value of a form's values, whatever the form's model. A dropdown can
 * hold the option it was picked as ({ label, value }); its value is read.
 */
export const readSmtpFormValue: ReadValueFunction = (
  values: unknown,
  key: string | undefined,
): unknown => {
  if (!key || !values || typeof values !== "object") {
    return undefined;
  }

  return normalizeFormValue((values as Record<string, unknown>)[key]);
};

/*
 * The port as a number, however the form holds it: typed text, a number, a
 * Port, or a Port as JSON. Null while there is none.
 */
export const readSmtpPort: <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
) => number | null = <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
): number | null => {
  let port: unknown = readSmtpFormValue(values, columns.port);

  if (
    port &&
    typeof port === "object" &&
    Object.prototype.hasOwnProperty.call(port, "_type") &&
    Object.prototype.hasOwnProperty.call(port, "value")
  ) {
    port = (port as { value: unknown }).value;
  }

  if (port === undefined || port === null || String(port).trim() === "") {
    return null;
  }

  const portNumber: number = Number(String(port).trim());

  return Number.isFinite(portNumber) ? portNumber : null;
};

type IsFilledFunction = (value: unknown) => boolean;

const isFilled: IsFilledFunction = (value: unknown): boolean => {
  return value !== undefined && value !== null && String(value).trim() !== "";
};

/*
 * How mail is sent: the transport picked, or SMTP for anything else - an
 * empty value included - as the mail service reads it.
 */
export const getSmtpTransport: <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
) => MailTransportType = <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
): MailTransportType => {
  return toMailTransportType(readSmtpFormValue(values, columns.transportType));
};

/*
 * How an SMTP server is signed in to. An empty value is Username and
 * Password, as the mail service reads it. (Microsoft Graph always signs in
 * with OAuth, whatever this says.)
 */
export const getSmtpAuthType: <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
) => SMTPAuthenticationType = <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
): SMTPAuthenticationType => {
  const authType: unknown = readSmtpFormValue(values, columns.authType);

  if (
    authType === SMTPAuthenticationType.OAuth ||
    authType === SMTPAuthenticationType.None
  ) {
    return authType;
  }

  return SMTPAuthenticationType.UsernamePassword;
};

type ShowsFunction = <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
) => boolean;

// The hostname, port, Require TLS and Authentication type: SMTP only.
export const showsSmtpServerFields: ShowsFunction = <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
): boolean => {
  return getSmtpTransport(values, columns) === MailTransportType.SMTP;
};

/*
 * The username: what an SMTP server is signed in to as - with a password,
 * or the mailbox OAuth signs in as. Not without signing in, and not for
 * Microsoft Graph, which sends as the From Email.
 */
export const showsSmtpUsername: ShowsFunction = <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
): boolean => {
  return (
    showsSmtpServerFields(values, columns) &&
    getSmtpAuthType(values, columns) !== SMTPAuthenticationType.None
  );
};

// The password: signing in to an SMTP server with a username and password.
export const showsSmtpPassword: ShowsFunction = <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
): boolean => {
  return (
    showsSmtpServerFields(values, columns) &&
    getSmtpAuthType(values, columns) === SMTPAuthenticationType.UsernamePassword
  );
};

/*
 * The OAuth grant: SMTP with OAuth. Microsoft Graph always uses Client
 * Credentials, so it is not asked there.
 */
export const showsSmtpOAuthProviderType: ShowsFunction = <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
): boolean => {
  return (
    showsSmtpServerFields(values, columns) &&
    getSmtpAuthType(values, columns) === SMTPAuthenticationType.OAuth
  );
};

/*
 * The OAuth app: Microsoft Graph, or SMTP with OAuth. A sign-in type left
 * on OAuth from before another provider was picked asks for nothing.
 */
export const showsSmtpOAuthCredentials: ShowsFunction = <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
): boolean => {
  const transport: MailTransportType = getSmtpTransport(values, columns);

  return (
    transport === MailTransportType.MicrosoftGraph ||
    (transport === MailTransportType.SMTP &&
      getSmtpAuthType(values, columns) === SMTPAuthenticationType.OAuth)
  );
};

/*
 * How an SMTP server is signed in to, as the mail service will: OAuth, no
 * sign-in, or the username and password - which the instance's server
 * uses only when both are set (sendsWithoutSignInWhenCredentialsAreBlank).
 */
export const getSmtpSignInSentence: <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
) => string = <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
): string => {
  const authType: SMTPAuthenticationType = getSmtpAuthType(values, columns);

  if (authType === SMTPAuthenticationType.OAuth) {
    return SMTP_SUMMARY_OAUTH;
  }

  if (authType === SMTPAuthenticationType.None) {
    return SMTP_SUMMARY_NO_SIGN_IN;
  }

  if (
    columns.sendsWithoutSignInWhenCredentialsAreBlank &&
    !(
      isFilled(readSmtpFormValue(values, columns.username)) &&
      isFilled(readSmtpFormValue(values, columns.password))
    )
  ) {
    return SMTP_SUMMARY_NO_SIGN_IN;
  }

  return SMTP_SUMMARY_PASSWORD;
};

/*
 * What Require TLS comes to on this port: required (with the certificate
 * checked); port 465's TLS without the certificate checked; or STARTTLS
 * only when the server offers it.
 */
export const getSmtpTlsSentence: <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
) => string = <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
): string => {
  if (readSmtpFormValue(values, columns.secure) === true) {
    return SMTP_SUMMARY_TLS_REQUIRED;
  }

  if (readSmtpPort(values, columns) === IMPLICIT_TLS_SMTP_PORT) {
    return SMTP_SUMMARY_TLS_PORT_465_UNCHECKED;
  }

  return SMTP_SUMMARY_TLS_OPTIONAL;
};

/**
 * What the folded Advanced header says, in sentences that follow the form's
 * values: how mail is sent and signed in with, then - over SMTP - whether
 * TLS is required. It takes the place of the "Configured" badge: it says
 * what is set, a Microsoft Graph config included.
 */
export const getSmtpAdvancedSummary: <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
) => Array<string> = <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
): Array<string> => {
  if (getSmtpTransport(values, columns) === MailTransportType.MicrosoftGraph) {
    return [SMTP_SUMMARY_MICROSOFT_GRAPH];
  }

  return [
    getSmtpSignInSentence(values, columns),
    getSmtpTlsSentence(values, columns),
  ];
};

export type GetSmtpConfigFormStepsFunction = <TEntity>() => Array<
  FormStep<TEntity>
>;

// Server, then Sender: a fresh list per form.
export const getSmtpConfigFormSteps: GetSmtpConfigFormStepsFunction = <
  TEntity,
>(): Array<FormStep<TEntity>> => {
  return [
    { title: "Server", id: "server" },
    { title: "Sender", id: "sender" },
  ];
};

export type GetSmtpAdvancedSectionFunction = <TEntity>(
  columns: SmtpConfigFormColumns<TEntity>,
) => FormFieldCollapsibleSection<TEntity>;

/*
 * The Server step's Advanced section: folded on create and edit alike, its
 * header saying how mail is sent; it opens by itself when a field in it
 * fails validation (the OAuth fields of a Microsoft Graph config, say).
 */
export const getSmtpAdvancedSection: GetSmtpAdvancedSectionFunction = <TEntity>(
  columns: SmtpConfigFormColumns<TEntity>,
): FormFieldCollapsibleSection<TEntity> => {
  return getAdvancedFormSection<TEntity>({
    getSummary: (values: FormValues<TEntity>): Array<string> => {
      return getSmtpAdvancedSummary(values, columns);
    },
  });
};

export type GetSmtpConfigFormFieldsFunction = <TEntity>(
  columns: SmtpConfigFormColumns<TEntity>,
) => Array<Field<TEntity>>;

/**
 * The fields of a mail server form, create and edit alike, on the steps
 * getSmtpConfigFormSteps() declares - less a project config's Name, which
 * getProjectSmtpConfigFormFields() puts first.
 */
export const getSmtpConfigFormFields: GetSmtpConfigFormFieldsFunction = <
  TEntity,
>(
  columns: SmtpConfigFormColumns<TEntity>,
): Array<Field<TEntity>> => {
  const advancedSection: FormFieldCollapsibleSection<TEntity> =
    getSmtpAdvancedSection<TEntity>(columns);

  const descriptionColumn: string | undefined = columns.configDescription;

  return [
    {
      field: { [columns.hostname]: true } as SelectFormFields<TEntity>,
      title: "Hostname",
      stepId: "server",
      fieldType: FormFieldSchemaType.Hostname,
      required: true,
      placeholder: "smtp.server.com",
      description:
        "SMTP server hostname. Examples: smtp.office365.com (Microsoft 365), smtp.gmail.com (Google)",
      disableSpellCheck: true,
      showIf: (values: FormValues<TEntity>): boolean => {
        return showsSmtpServerFields(values, columns);
      },
    },
    {
      field: { [columns.port]: true } as SelectFormFields<TEntity>,
      title: "Port",
      stepId: "server",
      fieldType: FormFieldSchemaType.Port,
      required: true,
      placeholder: "587",
      description: SMTP_PORT_DESCRIPTION,
      showIf: (values: FormValues<TEntity>): boolean => {
        return showsSmtpServerFields(values, columns);
      },
    },
    {
      field: { [columns.username]: true } as SelectFormFields<TEntity>,
      title: "Username",
      stepId: "server",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "emailuser@company.com",
      description: SMTP_USERNAME_DESCRIPTION,
      disableSpellCheck: true,
      showIf: (values: FormValues<TEntity>): boolean => {
        return showsSmtpUsername(values, columns);
      },
    },
    {
      field: { [columns.password]: true } as SelectFormFields<TEntity>,
      title: "Password",
      stepId: "server",
      fieldType: FormFieldSchemaType.EncryptedText,
      required: false,
      placeholder: "Password",
      description: SMTP_PASSWORD_DESCRIPTION,
      disableSpellCheck: true,
      showIf: (values: FormValues<TEntity>): boolean => {
        return showsSmtpPassword(values, columns);
      },
    },
    {
      field: { [columns.transportType]: true } as SelectFormFields<TEntity>,
      title: "Transport",
      stepId: "server",
      fieldType: FormFieldSchemaType.RadioButton,
      radioButtonOptions: SMTP_TRANSPORT_CHOICES,
      required: true,
      defaultValue: MailTransportType.SMTP,
      description: SMTP_TRANSPORT_DESCRIPTION,
      dataTestId: "smtp-transport",
      collapsibleSection: advancedSection,
    },
    {
      field: { [columns.secure]: true } as SelectFormFields<TEntity>,
      title: "Require TLS",
      stepId: "server",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      description: SMTP_REQUIRE_TLS_DESCRIPTION,
      showIf: (values: FormValues<TEntity>): boolean => {
        return showsSmtpServerFields(values, columns);
      },
      collapsibleSection: advancedSection,
    },
    {
      field: { [columns.authType]: true } as SelectFormFields<TEntity>,
      title: "Authentication Type",
      stepId: "server",
      fieldType: FormFieldSchemaType.RadioButton,
      radioButtonOptions: SMTP_AUTH_TYPE_CHOICES,
      required: true,
      defaultValue: SMTPAuthenticationType.UsernamePassword,
      description: SMTP_AUTH_TYPE_DESCRIPTION,
      dataTestId: "smtp-auth-type",
      showIf: (values: FormValues<TEntity>): boolean => {
        return showsSmtpServerFields(values, columns);
      },
      collapsibleSection: advancedSection,
    },
    {
      field: { [columns.oauthProviderType]: true } as SelectFormFields<TEntity>,
      title: "OAuth Provider Type",
      stepId: "server",
      fieldType: FormFieldSchemaType.RadioButton,
      radioButtonOptions: SMTP_OAUTH_PROVIDER_TYPE_CHOICES,
      required: true,
      defaultValue: OAuthProviderType.ClientCredentials,
      description: SMTP_OAUTH_PROVIDER_TYPE_DESCRIPTION,
      dataTestId: "smtp-oauth-provider-type",
      showIf: (values: FormValues<TEntity>): boolean => {
        return showsSmtpOAuthProviderType(values, columns);
      },
      collapsibleSection: advancedSection,
    },
    {
      field: { [columns.clientId]: true } as SelectFormFields<TEntity>,
      title: "OAuth Client ID",
      stepId: "server",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "12345678-1234-1234-1234-123456789012",
      description:
        "Application (Client) ID from your Microsoft Entra ID app registration (or service account for JWT Bearer).",
      disableSpellCheck: true,
      showIf: (values: FormValues<TEntity>): boolean => {
        return showsSmtpOAuthCredentials(values, columns);
      },
      collapsibleSection: advancedSection,
    },
    {
      field: { [columns.clientSecret]: true } as SelectFormFields<TEntity>,
      title: "OAuth Client Secret",
      stepId: "server",
      fieldType: FormFieldSchemaType.LongText,
      required: true,
      placeholder: "Client secret value",
      description:
        "Your OAuth app's client secret. For Google (JWT Bearer), the whole private_key from the service account's JSON file.",
      disableSpellCheck: true,
      showIf: (values: FormValues<TEntity>): boolean => {
        return showsSmtpOAuthCredentials(values, columns);
      },
      collapsibleSection: advancedSection,
    },
    {
      field: { [columns.tokenUrl]: true } as SelectFormFields<TEntity>,
      title: "OAuth Token URL",
      stepId: "server",
      fieldType: FormFieldSchemaType.URL,
      required: true,
      placeholder:
        "https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token",
      description:
        "Your provider's OAuth token endpoint. For Google: https://oauth2.googleapis.com/token",
      disableSpellCheck: true,
      showIf: (values: FormValues<TEntity>): boolean => {
        return showsSmtpOAuthCredentials(values, columns);
      },
      collapsibleSection: advancedSection,
    },
    {
      field: { [columns.scope]: true } as SelectFormFields<TEntity>,
      title: "OAuth Scope",
      stepId: "server",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "https://graph.microsoft.com/.default",
      description: SMTP_OAUTH_SCOPE_DESCRIPTION,
      disableSpellCheck: true,
      showIf: (values: FormValues<TEntity>): boolean => {
        return showsSmtpOAuthCredentials(values, columns);
      },
      collapsibleSection: advancedSection,
    },
    ...(descriptionColumn
      ? [
          {
            field: { [descriptionColumn]: true } as SelectFormFields<TEntity>,
            title: "Description",
            stepId: "server",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            // A note for your team: nothing to explain, the placeholder shows one.
            hideColumnDescription: true,
            placeholder: "Company SMTP server hosted on AWS",
            collapsibleSection: advancedSection,
          },
        ]
      : []),
    {
      field: { [columns.fromEmail]: true } as SelectFormFields<TEntity>,
      title: "From Email",
      stepId: "sender",
      fieldType: FormFieldSchemaType.Email,
      required: true,
      placeholder: "email@company.com",
      description: SMTP_FROM_EMAIL_DESCRIPTION,
      disableSpellCheck: true,
    },
    {
      field: { [columns.fromName]: true } as SelectFormFields<TEntity>,
      title: "From Name",
      stepId: "sender",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Company, Inc.",
      description: "The name people see your emails come from.",
      disableSpellCheck: true,
    },
  ];
};

/*
 * THE PROVIDERS A PROJECT'S CONFIG CAN SEND THROUGH, AND THEIR STEPS.
 *
 * The step ids are written out as strings on every field (FormStepsScan
 * places a field by them), and each provider's step is the same on a
 * project's form and on the instance's card for that provider.
 */
export const EMAIL_PROVIDER_STEP_ID: string = "provider";

export const SMTP_OAUTH_STEP_ID: string = "oauth";

export const AMAZON_SES_STEP_ID: string = "amazon-ses";

export const SENDGRID_STEP_ID: string = "sendgrid";

export const MAILGUN_STEP_ID: string = "mailgun";

export const POSTMARK_STEP_ID: string = "postmark";

export const RESEND_STEP_ID: string = "resend";

export const EMAIL_PROVIDER_DESCRIPTION: string = translationKey(
  "How OneUptime sends this project's email.",
);

/*
 * One card a provider: what it is, in a line, with an icon of OneUptime's
 * own (no provider's logo: Amazon asks to be named in plain text, and the
 * others' marks are not ones OneUptime may draw). The SMTP server first,
 * the default; Microsoft Graph last, for the one case it is for. The values
 * are the transports the API, Terraform and the guides use. A provider's
 * name is its own in every language (isTitleProductName): "Resend" is
 * also interface text, which reads "Erneut senden" in German.
 */
export const EMAIL_PROVIDER_CHOICES: Array<CardSelectOption> = [
  {
    value: MailTransportType.SMTP,
    title: translationKey("SMTP Server"),
    description: translationKey("Works with most mail servers."),
    icon: IconProp.Server,
  },
  {
    value: MailTransportType.AmazonSES,
    title: "Amazon SES",
    isTitleProductName: true,
    description: translationKey(
      "Send through Amazon Simple Email Service with an IAM access key.",
    ),
    icon: IconProp.Cloud,
  },
  {
    value: MailTransportType.SendGrid,
    title: "SendGrid",
    isTitleProductName: true,
    description: translationKey("Send through SendGrid's API with an API key."),
    icon: IconProp.PaperAirplane,
  },
  {
    value: MailTransportType.Mailgun,
    title: "Mailgun",
    isTitleProductName: true,
    description: translationKey(
      "Send through Mailgun's API with an API key and a sending domain.",
    ),
    icon: IconProp.Envelope,
  },
  {
    value: MailTransportType.Postmark,
    title: "Postmark",
    isTitleProductName: true,
    description: translationKey(
      "Send through Postmark's API with a server API token.",
    ),
    icon: IconProp.InboxArrowDown,
  },
  {
    value: MailTransportType.Resend,
    title: "Resend",
    isTitleProductName: true,
    description: translationKey("Send through Resend's API with an API key."),
    icon: IconProp.SendMessage,
  },
  {
    value: MailTransportType.MicrosoftGraph,
    title: translationKey("Microsoft Graph"),
    description: translationKey(
      "For a Microsoft 365 tenant with SMTP AUTH turned off.",
    ),
    icon: IconProp.Email,
  },
];

/*
 * A provider's name as people know it - the card's title, which the API's
 * own value is ("Amazon SES") - or "SMTP Server" for a mail server.
 */
export const getEmailProviderTitle: (transport: unknown) => string = (
  transport: unknown,
): string => {
  const value: MailTransportType = toMailTransportType(transport);
  const choice: CardSelectOption | undefined = EMAIL_PROVIDER_CHOICES.find(
    (candidate: CardSelectOption): boolean => {
      return candidate.value === value;
    },
  );

  return choice ? choice.title : value;
};

// The columns each provider with an HTTP API of its own keeps its key in.
export const EMAIL_PROVIDER_KEY_COLUMNS: Readonly<
  Partial<Record<MailTransportType, ReadonlyArray<string>>>
> = {
  [MailTransportType.AmazonSES]: [
    "amazonSesAccessKeyId",
    "amazonSesSecretAccessKey",
    "amazonSesRegion",
  ],
  [MailTransportType.SendGrid]: ["sendgridApiKey"],
  [MailTransportType.Mailgun]: [
    "mailgunApiKey",
    "mailgunDomain",
    "mailgunRegion",
  ],
  [MailTransportType.Postmark]: ["postmarkServerToken"],
  [MailTransportType.Resend]: ["resendApiKey"],
};

export const AMAZON_SES_ACCESS_KEY_ID_DESCRIPTION: string = translationKey(
  "The access key ID of an IAM user allowed to send with Amazon SES (ses:SendEmail).",
);

export const AMAZON_SES_SECRET_ACCESS_KEY_DESCRIPTION: string = translationKey(
  "The secret that goes with the access key ID. It is stored encrypted.",
);

export const AMAZON_SES_REGION_DESCRIPTION: string = translationKey(
  "The AWS Region your sender's identity is verified in, such as us-east-1 or eu-west-1.",
);

export const AMAZON_SES_REGION_INVALID: string = translationKey(
  "Enter an AWS Region code, such as us-east-1.",
);

/*
 * How the server signs in to Amazon SES (#7000), on the server's own Amazon
 * SES card only: with an IAM user's access key, as it always has, or as the
 * IAM role AWS gives the server - IAM roles for service accounts or EKS Pod
 * Identity, an ECS task role, an EC2 instance profile - with no key stored.
 * A project's Amazon SES config keeps its access key: the server's role is
 * the server's own AWS identity, never a project's to send with.
 */
export const AMAZON_SES_AUTHENTICATION_TYPE_DESCRIPTION: string =
  translationKey("How OneUptime signs in to Amazon SES.");

export const AMAZON_SES_AUTHENTICATION_TYPE_CHOICES: Array<RadioButton> = [
  {
    value: AmazonSesAuthenticationType.AccessKey,
    title: translationKey("Access Key"),
    description: translationKey(
      "An IAM user's access key ID and secret access key, stored encrypted.",
    ),
  },
  {
    value: AmazonSesAuthenticationType.ServerIamRole,
    title: translationKey("This Server's IAM Role"),
    description: translationKey(
      "The role AWS gives this server on Amazon EKS, ECS or EC2. No key is stored, and its credentials renew on their own.",
    ),
  },
];

/*
 * The sign-in a stored Authentication Type reads as, in the Edit dialog's
 * words. Never picked, the server signs in with the access key.
 */
export const getAmazonSesAuthenticationTypeTitle: (value: unknown) => string = (
  value: unknown,
): string => {
  const type: AmazonSesAuthenticationType =
    toAmazonSesAuthenticationType(value);
  const choice: RadioButton | undefined =
    AMAZON_SES_AUTHENTICATION_TYPE_CHOICES.find(
      (candidate: RadioButton): boolean => {
        return candidate.value === type;
      },
    );

  return choice ? choice.title : type;
};

// Whether the server's Amazon SES card signs in with the server's IAM role.
export const usesAmazonSesServerIamRole: (values: unknown) => boolean = (
  values: unknown,
): boolean => {
  return (
    toAmazonSesAuthenticationType(
      readSmtpFormValue(values, "amazonSesAuthenticationType"),
    ) === AmazonSesAuthenticationType.ServerIamRole
  );
};

export const SENDGRID_API_KEY_DESCRIPTION: string = translationKey(
  "A SendGrid API key with the Mail Send permission, from SendGrid's Settings > API Keys. It is stored encrypted.",
);

export const MAILGUN_API_KEY_DESCRIPTION: string = translationKey(
  "An API key from your Mailgun account, or a sending key made for this domain. It is stored encrypted.",
);

export const MAILGUN_DOMAIN_DESCRIPTION: string = translationKey(
  "The sending domain, as Mailgun lists it under Sending > Domains.",
);

export const MAILGUN_DOMAIN_INVALID: string = translationKey(
  "Enter a domain, such as mg.example.com.",
);

export const MAILGUN_REGION_DESCRIPTION: string = translationKey(
  "The region the domain was created in.",
);

export const MAILGUN_REGION_CHOICES: Array<RadioButton> = [
  {
    value: MailgunRegion.US,
    title: translationKey("US"),
    description: translationKey("Sent through api.mailgun.net."),
  },
  {
    value: MailgunRegion.EU,
    title: translationKey("EU"),
    description: translationKey("Sent through api.eu.mailgun.net."),
  },
];

export const POSTMARK_SERVER_TOKEN_DESCRIPTION: string = translationKey(
  "The API token of the Postmark server that sends, from the server's API Tokens tab. It is stored encrypted.",
);

export const RESEND_API_KEY_DESCRIPTION: string = translationKey(
  "A Resend API key with sending access, from API Keys in Resend. It is stored encrypted.",
);

export const PROVIDER_FROM_EMAIL_DESCRIPTION: string = translationKey(
  "The address your emails come from. Your mail server or provider must allow sending from it, such as an address or domain verified there.",
);

export const FROM_NAME_DESCRIPTION: string = translationKey(
  "The name people see your emails come from.",
);

type IsTransportFunction = (values: unknown) => boolean;

// Whether a project's form has a provider picked.
const isProjectTransport: (
  transport: MailTransportType,
) => IsTransportFunction = (
  transport: MailTransportType,
): IsTransportFunction => {
  return (values: unknown): boolean => {
    return (
      getSmtpTransport(values, PROJECT_SMTP_CONFIG_FORM_COLUMNS) === transport
    );
  };
};

/*
 * A project's steps: the provider, then the one step of the provider
 * picked (two for SMTP signing in with OAuth), then the sender.
 */
export const getProjectSmtpConfigFormSteps: () => Array<
  FormStep<ProjectSmtpConfig>
> = (): Array<FormStep<ProjectSmtpConfig>> => {
  return [
    { title: "Provider", id: "provider" },
    {
      title: "Server",
      id: "server",
      showIf: (values: FormValues<ProjectSmtpConfig>): boolean => {
        return showsSmtpServerFields(values, PROJECT_SMTP_CONFIG_FORM_COLUMNS);
      },
    },
    {
      title: "OAuth",
      id: "oauth",
      showIf: (values: FormValues<ProjectSmtpConfig>): boolean => {
        return showsSmtpOAuthCredentials(
          values,
          PROJECT_SMTP_CONFIG_FORM_COLUMNS,
        );
      },
    },
    {
      title: "Amazon SES",
      id: "amazon-ses",
      isTitleProductName: true,
      showIf: isProjectTransport(MailTransportType.AmazonSES),
    },
    {
      title: "SendGrid",
      id: "sendgrid",
      isTitleProductName: true,
      showIf: isProjectTransport(MailTransportType.SendGrid),
    },
    {
      title: "Mailgun",
      id: "mailgun",
      isTitleProductName: true,
      showIf: isProjectTransport(MailTransportType.Mailgun),
    },
    {
      title: "Postmark",
      id: "postmark",
      isTitleProductName: true,
      showIf: isProjectTransport(MailTransportType.Postmark),
    },
    {
      title: "Resend",
      id: "resend",
      isTitleProductName: true,
      showIf: isProjectTransport(MailTransportType.Resend),
    },
    { title: "Sender", id: "sender" },
  ];
};

/*
 * The Server step's folded fields on a project's form - TLS and the sign-in
 * type - under a header that says how mail is sent and signed in with.
 */
export const getProjectSmtpServerSection: () => FormFieldCollapsibleSection<ProjectSmtpConfig> =
  (): FormFieldCollapsibleSection<ProjectSmtpConfig> => {
    return getAdvancedFormSection<ProjectSmtpConfig>({
      getSummary: (values: FormValues<ProjectSmtpConfig>): Array<string> => {
        return getSmtpAdvancedSummary(values, PROJECT_SMTP_CONFIG_FORM_COLUMNS);
      },
    });
  };

/*
 * An Amazon SES config: the IAM access key and the Region. Its own step,
 * on a project's form and on the instance's Amazon SES card alike.
 */
export const getAmazonSesFormFields: <TEntity>() => Array<Field<TEntity>> = <
  TEntity,
>(): Array<Field<TEntity>> => {
  return [
    {
      field: { amazonSesAccessKeyId: true } as SelectFormFields<TEntity>,
      title: "Access Key ID",
      stepId: "amazon-ses",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "AKIAIOSFODNN7EXAMPLE",
      description: AMAZON_SES_ACCESS_KEY_ID_DESCRIPTION,
      disableSpellCheck: true,
    },
    {
      field: { amazonSesSecretAccessKey: true } as SelectFormFields<TEntity>,
      title: "Secret Access Key",
      stepId: "amazon-ses",
      fieldType: FormFieldSchemaType.EncryptedText,
      required: true,
      placeholder: "Secret access key",
      description: AMAZON_SES_SECRET_ACCESS_KEY_DESCRIPTION,
      disableSpellCheck: true,
    },
    {
      field: { amazonSesRegion: true } as SelectFormFields<TEntity>,
      title: "Region",
      stepId: "amazon-ses",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "us-east-1",
      description: AMAZON_SES_REGION_DESCRIPTION,
      disableSpellCheck: true,
      customValidation: (values: FormValues<TEntity>): string | null => {
        const region: unknown = readSmtpFormValue(values, "amazonSesRegion");

        if (!region || isAwsRegion(String(region))) {
          return null;
        }

        return AMAZON_SES_REGION_INVALID;
      },
    },
  ];
};

/*
 * The server's own Amazon SES card (#7000): how it signs in first - its
 * access key, or the IAM role AWS gives the server - then the access key
 * only when it signs in with one, then the Region either way. The key's
 * fields are hidden for the role, so they are neither asked for nor
 * checked; the server clears a stored key when the role is saved.
 */
export const getGlobalAmazonSesFormFields: () => Array<
  Field<GlobalConfig>
> = (): Array<Field<GlobalConfig>> => {
  const usesAccessKey: (values: FormValues<GlobalConfig>) => boolean = (
    values: FormValues<GlobalConfig>,
  ): boolean => {
    return !usesAmazonSesServerIamRole(values);
  };

  return [
    {
      field: { amazonSesAuthenticationType: true },
      title: "Authentication Type",
      stepId: "amazon-ses",
      fieldType: FormFieldSchemaType.RadioButton,
      radioButtonOptions: AMAZON_SES_AUTHENTICATION_TYPE_CHOICES,
      required: true,
      defaultValue: AmazonSesAuthenticationType.AccessKey,
      // A server that has never picked one signs in with its access key.
      startsOnDefaultWhenEmpty: true,
      description: AMAZON_SES_AUTHENTICATION_TYPE_DESCRIPTION,
      dataTestId: "amazon-ses-authentication-type",
    },
    ...getAmazonSesFormFields<GlobalConfig>().map(
      (field: Field<GlobalConfig>): Field<GlobalConfig> => {
        const isRegion: boolean = Boolean(
          field.field &&
            (field.field as Record<string, unknown>)["amazonSesRegion"],
        );

        return isRegion ? field : { ...field, showIf: usesAccessKey };
      },
    ),
  ];
};

// A SendGrid config: its API key.
export const getSendGridFormFields: <TEntity>() => Array<Field<TEntity>> = <
  TEntity,
>(): Array<Field<TEntity>> => {
  return [
    {
      field: { sendgridApiKey: true } as SelectFormFields<TEntity>,
      title: "API Key",
      stepId: "sendgrid",
      fieldType: FormFieldSchemaType.EncryptedText,
      required: true,
      placeholder: "SG.xxxxxxxxxxxxxxxx",
      description: SENDGRID_API_KEY_DESCRIPTION,
      disableSpellCheck: true,
    },
  ];
};

// A Mailgun config: its API key, sending domain and region.
export const getMailgunFormFields: <TEntity>() => Array<Field<TEntity>> = <
  TEntity,
>(): Array<Field<TEntity>> => {
  return [
    {
      field: { mailgunApiKey: true } as SelectFormFields<TEntity>,
      title: "API Key",
      stepId: "mailgun",
      fieldType: FormFieldSchemaType.EncryptedText,
      required: true,
      placeholder: "Mailgun API key",
      description: MAILGUN_API_KEY_DESCRIPTION,
      disableSpellCheck: true,
    },
    {
      field: { mailgunDomain: true } as SelectFormFields<TEntity>,
      title: "Domain",
      stepId: "mailgun",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "mg.example.com",
      description: MAILGUN_DOMAIN_DESCRIPTION,
      disableSpellCheck: true,
      customValidation: (values: FormValues<TEntity>): string | null => {
        const domain: unknown = readSmtpFormValue(values, "mailgunDomain");

        if (!domain || isMailgunDomain(domain)) {
          return null;
        }

        return MAILGUN_DOMAIN_INVALID;
      },
    },
    {
      field: { mailgunRegion: true } as SelectFormFields<TEntity>,
      title: "Region",
      stepId: "mailgun",
      fieldType: FormFieldSchemaType.RadioButton,
      radioButtonOptions: MAILGUN_REGION_CHOICES,
      required: true,
      defaultValue: DEFAULT_MAILGUN_REGION,
      description: MAILGUN_REGION_DESCRIPTION,
      dataTestId: "mailgun-region",
    },
  ];
};

// A Postmark config: its server's API token.
export const getPostmarkFormFields: <TEntity>() => Array<Field<TEntity>> = <
  TEntity,
>(): Array<Field<TEntity>> => {
  return [
    {
      field: { postmarkServerToken: true } as SelectFormFields<TEntity>,
      title: "Server API Token",
      stepId: "postmark",
      fieldType: FormFieldSchemaType.EncryptedText,
      required: true,
      placeholder: "00000000-0000-0000-0000-000000000000",
      description: POSTMARK_SERVER_TOKEN_DESCRIPTION,
      disableSpellCheck: true,
    },
  ];
};

// A Resend config: its API key.
export const getResendFormFields: <TEntity>() => Array<Field<TEntity>> = <
  TEntity,
>(): Array<Field<TEntity>> => {
  return [
    {
      field: { resendApiKey: true } as SelectFormFields<TEntity>,
      title: "API Key",
      stepId: "resend",
      fieldType: FormFieldSchemaType.EncryptedText,
      required: true,
      placeholder: "re_xxxxxxxxxxxxxxxx",
      description: RESEND_API_KEY_DESCRIPTION,
      disableSpellCheck: true,
    },
  ];
};

/*
 * Who an email through a provider comes from: the Sender step, given the
 * columns the surface keeps it in - a project's config's own, or each
 * provider's on the instance (amazonSesFromEmail ...).
 */
export const getProviderSenderFormFields: <TEntity>(columns: {
  fromEmail: Extract<keyof TEntity, string>;
  fromName: Extract<keyof TEntity, string>;
}) => Array<Field<TEntity>> = <TEntity>(columns: {
  fromEmail: Extract<keyof TEntity, string>;
  fromName: Extract<keyof TEntity, string>;
}): Array<Field<TEntity>> => {
  return [
    {
      field: { [columns.fromEmail]: true } as SelectFormFields<TEntity>,
      title: "From Email",
      stepId: "sender",
      fieldType: FormFieldSchemaType.Email,
      required: true,
      placeholder: "email@company.com",
      description: PROVIDER_FROM_EMAIL_DESCRIPTION,
      disableSpellCheck: true,
    },
    {
      field: { [columns.fromName]: true } as SelectFormFields<TEntity>,
      title: "From Name",
      stepId: "sender",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Company, Inc.",
      description: FROM_NAME_DESCRIPTION,
      disableSpellCheck: true,
    },
  ];
};

/**
 * A project's Custom SMTP config: the provider first, its Name beside it,
 * then the step of the provider picked, then who the mail comes from.
 */
export const getProjectSmtpConfigFormFields: () => Array<
  Field<ProjectSmtpConfig>
> = (): Array<Field<ProjectSmtpConfig>> => {
  const columns: SmtpConfigFormColumns<ProjectSmtpConfig> =
    PROJECT_SMTP_CONFIG_FORM_COLUMNS;
  const providerSection: FormFieldCollapsibleSection<ProjectSmtpConfig> =
    getAdvancedFormSection<ProjectSmtpConfig>();
  const serverSection: FormFieldCollapsibleSection<ProjectSmtpConfig> =
    getProjectSmtpServerSection();

  return [
    {
      field: { name: true },
      title: "Name",
      stepId: "provider",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      // The placeholder shows one; "Friendly name for this config ..." said nothing more.
      hideColumnDescription: true,
      placeholder: "Company SMTP Server",
      validation: {
        minLength: 2,
      },
    },
    {
      field: { transportType: true },
      title: "Provider",
      stepId: "provider",
      fieldType: FormFieldSchemaType.CardSelect,
      cardSelectOptions: EMAIL_PROVIDER_CHOICES,
      // Two to a row: each card carries a line, which three columns squeeze.
      cardSelectMaxColumns: 2,
      required: true,
      defaultValue: MailTransportType.SMTP,
      description: EMAIL_PROVIDER_DESCRIPTION,
      dataTestId: "email-provider",
    },
    {
      field: { description: true },
      title: "Description",
      stepId: "provider",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      // A note for your team: nothing to explain, the placeholder shows one.
      hideColumnDescription: true,
      placeholder: "Company SMTP server hosted on AWS",
      collapsibleSection: providerSection,
    },
    {
      field: { hostname: true },
      title: "Hostname",
      stepId: "server",
      fieldType: FormFieldSchemaType.Hostname,
      required: true,
      placeholder: "smtp.server.com",
      description:
        "SMTP server hostname. Examples: smtp.office365.com (Microsoft 365), smtp.gmail.com (Google)",
      disableSpellCheck: true,
    },
    {
      field: { port: true },
      title: "Port",
      stepId: "server",
      fieldType: FormFieldSchemaType.Port,
      required: true,
      placeholder: "587",
      description: SMTP_PORT_DESCRIPTION,
    },
    {
      field: { username: true },
      title: "Username",
      stepId: "server",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "emailuser@company.com",
      description: SMTP_USERNAME_DESCRIPTION,
      disableSpellCheck: true,
      showIf: (values: FormValues<ProjectSmtpConfig>): boolean => {
        return showsSmtpUsername(values, columns);
      },
    },
    {
      field: { password: true },
      title: "Password",
      stepId: "server",
      fieldType: FormFieldSchemaType.EncryptedText,
      required: false,
      placeholder: "Password",
      description: SMTP_PASSWORD_DESCRIPTION,
      disableSpellCheck: true,
      showIf: (values: FormValues<ProjectSmtpConfig>): boolean => {
        return showsSmtpPassword(values, columns);
      },
    },
    {
      field: { secure: true },
      title: "Require TLS",
      stepId: "server",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      description: SMTP_REQUIRE_TLS_DESCRIPTION,
      collapsibleSection: serverSection,
    },
    {
      field: { authType: true },
      title: "Authentication Type",
      stepId: "server",
      fieldType: FormFieldSchemaType.RadioButton,
      radioButtonOptions: SMTP_AUTH_TYPE_CHOICES,
      required: true,
      defaultValue: SMTPAuthenticationType.UsernamePassword,
      description: SMTP_AUTH_TYPE_DESCRIPTION,
      dataTestId: "smtp-auth-type",
      collapsibleSection: serverSection,
    },
    {
      field: { oauthProviderType: true },
      title: "OAuth Provider Type",
      stepId: "oauth",
      fieldType: FormFieldSchemaType.RadioButton,
      radioButtonOptions: SMTP_OAUTH_PROVIDER_TYPE_CHOICES,
      required: true,
      defaultValue: OAuthProviderType.ClientCredentials,
      description: SMTP_OAUTH_PROVIDER_TYPE_DESCRIPTION,
      dataTestId: "smtp-oauth-provider-type",
      // Microsoft Graph always uses Client Credentials: not asked there.
      showIf: (values: FormValues<ProjectSmtpConfig>): boolean => {
        return showsSmtpOAuthProviderType(values, columns);
      },
    },
    {
      field: { clientId: true },
      title: "OAuth Client ID",
      stepId: "oauth",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "12345678-1234-1234-1234-123456789012",
      description:
        "Application (Client) ID from your Microsoft Entra ID app registration (or service account for JWT Bearer).",
      disableSpellCheck: true,
    },
    {
      field: { clientSecret: true },
      title: "OAuth Client Secret",
      stepId: "oauth",
      fieldType: FormFieldSchemaType.LongText,
      required: true,
      placeholder: "Client secret value",
      description:
        "Your OAuth app's client secret. For Google (JWT Bearer), the whole private_key from the service account's JSON file.",
      disableSpellCheck: true,
    },
    {
      field: { tokenUrl: true },
      title: "OAuth Token URL",
      stepId: "oauth",
      fieldType: FormFieldSchemaType.URL,
      required: true,
      placeholder:
        "https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token",
      description:
        "Your provider's OAuth token endpoint. For Google: https://oauth2.googleapis.com/token",
      disableSpellCheck: true,
    },
    {
      field: { scope: true },
      title: "OAuth Scope",
      stepId: "oauth",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "https://graph.microsoft.com/.default",
      description: SMTP_OAUTH_SCOPE_DESCRIPTION,
      disableSpellCheck: true,
    },
    ...getAmazonSesFormFields<ProjectSmtpConfig>(),
    ...getSendGridFormFields<ProjectSmtpConfig>(),
    ...getMailgunFormFields<ProjectSmtpConfig>(),
    ...getPostmarkFormFields<ProjectSmtpConfig>(),
    ...getResendFormFields<ProjectSmtpConfig>(),
    ...getProviderSenderFormFields<ProjectSmtpConfig>({
      fromEmail: "fromEmail",
      fromName: "fromName",
    }),
  ];
};

/*
 * THE INSTANCE'S OWN PROVIDERS (Admin Dashboard > Settings > Email): one
 * card each for the Email Server Types that send through an HTTP API -
 * Amazon SES, Mailgun, Postmark, Resend - each with its key and its sender
 * in columns of its own, so switching the Email Server Type keeps every
 * provider's settings as they were.
 */
export type GlobalEmailProviderTransport =
  | MailTransportType.AmazonSES
  | MailTransportType.Mailgun
  | MailTransportType.Postmark
  | MailTransportType.Resend;

export const GLOBAL_EMAIL_PROVIDER_TRANSPORTS: ReadonlyArray<GlobalEmailProviderTransport> =
  [
    MailTransportType.AmazonSES,
    MailTransportType.Mailgun,
    MailTransportType.Postmark,
    MailTransportType.Resend,
  ];

/*
 * The Email Server Type each of them is (Admin Dashboard > Settings >
 * Email > Email Server Settings).
 */
export const GLOBAL_EMAIL_PROVIDERS: ReadonlyArray<{
  serverType: EmailServerType;
  transport: GlobalEmailProviderTransport;
}> = [
  {
    serverType: EmailServerType.AmazonSES,
    transport: MailTransportType.AmazonSES,
  },
  { serverType: EmailServerType.Mailgun, transport: MailTransportType.Mailgun },
  {
    serverType: EmailServerType.Postmark,
    transport: MailTransportType.Postmark,
  },
  { serverType: EmailServerType.Resend, transport: MailTransportType.Resend },
];

/*
 * The server's Amazon SES card's line: unlike a project's config, the
 * server can also sign in as the IAM role AWS gives it (#7000). The card's
 * title names the service, so the line is short enough to wrap like the
 * cards beside it.
 */
export const GLOBAL_AMAZON_SES_PROVIDER_DESCRIPTION: string = translationKey(
  "Send through Amazon SES with an access key or this server's IAM role.",
);

/*
 * An Email Server Type's card in the Email Server Settings dialog: the card
 * its provider has in a project's form - the same icon and line - for the
 * Email Server Type's own value. Undefined for a type with no provider of
 * its own (Custom SMTP, SendGrid). Amazon SES says the server may also
 * sign in with its IAM role.
 */
export const getGlobalEmailProviderCard: (
  serverType: EmailServerType,
) => CardSelectOption | undefined = (
  serverType: EmailServerType,
): CardSelectOption | undefined => {
  const provider:
    | { serverType: EmailServerType; transport: GlobalEmailProviderTransport }
    | undefined = GLOBAL_EMAIL_PROVIDERS.find(
    (candidate: {
      serverType: EmailServerType;
      transport: GlobalEmailProviderTransport;
    }): boolean => {
      return candidate.serverType === serverType;
    },
  );

  const choice: CardSelectOption | undefined = provider
    ? EMAIL_PROVIDER_CHOICES.find((candidate: CardSelectOption): boolean => {
        return candidate.value === provider.transport;
      })
    : undefined;

  if (!choice) {
    return undefined;
  }

  return serverType === EmailServerType.AmazonSES
    ? {
        ...choice,
        value: serverType,
        description: GLOBAL_AMAZON_SES_PROVIDER_DESCRIPTION,
      }
    : { ...choice, value: serverType };
};

export const GLOBAL_EMAIL_PROVIDER_SENDER_COLUMNS: Readonly<
  Record<
    GlobalEmailProviderTransport,
    {
      fromEmail: Extract<keyof GlobalConfig, string>;
      fromName: Extract<keyof GlobalConfig, string>;
    }
  >
> = {
  [MailTransportType.AmazonSES]: {
    fromEmail: "amazonSesFromEmail",
    fromName: "amazonSesFromName",
  },
  [MailTransportType.Mailgun]: {
    fromEmail: "mailgunFromEmail",
    fromName: "mailgunFromName",
  },
  [MailTransportType.Postmark]: {
    fromEmail: "postmarkFromEmail",
    fromName: "postmarkFromName",
  },
  [MailTransportType.Resend]: {
    fromEmail: "resendFromEmail",
    fromName: "resendFromName",
  },
};

/*
 * What a provider's card still needs before the server sends through it,
 * in the order the dialog asks: the key, then where it sends from, then the
 * address. Null once everything is set: the card says Enabled. (A From Name
 * left blank is the product's name, as the mail service sends it.)
 */
export enum GlobalEmailProviderMissingSetting {
  AccessKey = "accessKey",
  Region = "region",
  ApiKey = "apiKey",
  Domain = "domain",
  ServerToken = "serverToken",
  FromEmail = "fromEmail",
}

export const getGlobalEmailProviderMissingSetting: (
  transport: GlobalEmailProviderTransport,
  values: unknown,
) => GlobalEmailProviderMissingSetting | null = (
  transport: GlobalEmailProviderTransport,
  values: unknown,
): GlobalEmailProviderMissingSetting | null => {
  const isSet: (column: string) => boolean = (column: string): boolean => {
    const value: unknown = readSmtpFormValue(values, column);

    return value !== undefined && value !== null && String(value).trim() !== "";
  };

  if (transport === MailTransportType.AmazonSES) {
    // Signing in with the server's IAM role, no key is stored (#7000).
    if (
      !usesAmazonSesServerIamRole(values) &&
      (!isSet("amazonSesAccessKeyId") || !isSet("amazonSesSecretAccessKey"))
    ) {
      return GlobalEmailProviderMissingSetting.AccessKey;
    }

    if (
      !isSet("amazonSesRegion") ||
      !isAwsRegion(String(readSmtpFormValue(values, "amazonSesRegion")))
    ) {
      return GlobalEmailProviderMissingSetting.Region;
    }
  } else if (transport === MailTransportType.Mailgun) {
    if (!isSet("mailgunApiKey")) {
      return GlobalEmailProviderMissingSetting.ApiKey;
    }

    if (!isMailgunDomain(readSmtpFormValue(values, "mailgunDomain"))) {
      return GlobalEmailProviderMissingSetting.Domain;
    }
  } else if (transport === MailTransportType.Postmark) {
    if (!isSet("postmarkServerToken")) {
      return GlobalEmailProviderMissingSetting.ServerToken;
    }
  } else if (!isSet("resendApiKey")) {
    return GlobalEmailProviderMissingSetting.ApiKey;
  }

  const sender: {
    fromEmail: Extract<keyof GlobalConfig, string>;
    fromName: Extract<keyof GlobalConfig, string>;
  } = GLOBAL_EMAIL_PROVIDER_SENDER_COLUMNS[transport];

  if (!isSet(sender.fromEmail)) {
    return GlobalEmailProviderMissingSetting.FromEmail;
  }

  return null;
};

// A provider's card: its own step, then the sender.
export const getGlobalEmailProviderFormSteps: (
  transport: GlobalEmailProviderTransport,
) => Array<FormStep<GlobalConfig>> = (
  transport: GlobalEmailProviderTransport,
): Array<FormStep<GlobalConfig>> => {
  const providerStep: Record<
    GlobalEmailProviderTransport,
    FormStep<GlobalConfig>
  > = {
    [MailTransportType.AmazonSES]: {
      title: "Amazon SES",
      id: "amazon-ses",
      isTitleProductName: true,
    },
    [MailTransportType.Mailgun]: {
      title: "Mailgun",
      id: "mailgun",
      isTitleProductName: true,
    },
    [MailTransportType.Postmark]: {
      title: "Postmark",
      id: "postmark",
      isTitleProductName: true,
    },
    [MailTransportType.Resend]: {
      title: "Resend",
      id: "resend",
      isTitleProductName: true,
    },
  };

  return [providerStep[transport], { title: "Sender", id: "sender" }];
};

export const getGlobalEmailProviderFormFields: (
  transport: GlobalEmailProviderTransport,
) => Array<Field<GlobalConfig>> = (
  transport: GlobalEmailProviderTransport,
): Array<Field<GlobalConfig>> => {
  const providerFields: Record<
    GlobalEmailProviderTransport,
    () => Array<Field<GlobalConfig>>
  > = {
    [MailTransportType.AmazonSES]: getGlobalAmazonSesFormFields,
    [MailTransportType.Mailgun]: getMailgunFormFields<GlobalConfig>,
    [MailTransportType.Postmark]: getPostmarkFormFields<GlobalConfig>,
    [MailTransportType.Resend]: getResendFormFields<GlobalConfig>,
  };

  return [
    ...providerFields[transport](),
    ...getProviderSenderFormFields<GlobalConfig>(
      GLOBAL_EMAIL_PROVIDER_SENDER_COLUMNS[transport],
    ),
  ];
};

/*
 * The instance's mail server (GlobalConfig): the shared fields, with the
 * port starting on 587 when the instance has none (#6875). The form edits
 * the one settings row, so nothing else is filled in; a fresh server's
 * empty port showed 587 as its placeholder, looked filled in, and refused
 * Next. An instance with a port of its own keeps it.
 */
export const getGlobalSmtpConfigFormFields: () => Array<
  Field<GlobalConfig>
> = (): Array<Field<GlobalConfig>> => {
  return getSmtpConfigFormFields<GlobalConfig>(
    GLOBAL_SMTP_CONFIG_FORM_COLUMNS,
  ).map((field: Field<GlobalConfig>): Field<GlobalConfig> => {
    const isPort: boolean = Boolean(
      field.field &&
        (field.field as Record<string, unknown>)[
          GLOBAL_SMTP_CONFIG_FORM_COLUMNS.port
        ],
    );

    return isPort
      ? {
          ...field,
          defaultValue: DEFAULT_SMTP_PORT,
          startsOnDefaultWhenEmpty: true,
        }
      : field;
  });
};

/*
 * What a new project config starts with: port 587. Create only - an edit
 * form shows the config as it is.
 */
export const PROJECT_SMTP_CONFIG_CREATE_INITIAL_VALUES: FormValues<ProjectSmtpConfig> =
  {
    port: DEFAULT_SMTP_PORT,
  } as unknown as FormValues<ProjectSmtpConfig>;

/*
 * The server and sign-in columns Microsoft Graph has no use for: it posts
 * to Graph, not to a hostname and port, and signs in with the OAuth app.
 */
export const getSmtpServerColumnsGraphIgnores: <TEntity>(
  columns: SmtpConfigFormColumns<TEntity>,
) => Array<Extract<keyof TEntity, string>> = <TEntity>(
  columns: SmtpConfigFormColumns<TEntity>,
): Array<Extract<keyof TEntity, string>> => {
  return [columns.hostname, columns.port, columns.username, columns.password];
};

/*
 * The columns a transport has no use for: a mail server's and the OAuth
 * app's for a provider with an HTTP API of its own, and every other
 * provider's key for each of them.
 */
export const getColumnsTransportIgnores: <TEntity>(
  transport: MailTransportType,
  columns: SmtpConfigFormColumns<TEntity>,
) => Array<string> = <TEntity>(
  transport: MailTransportType,
  columns: SmtpConfigFormColumns<TEntity>,
): Array<string> => {
  const otherProvidersKeys: Array<string> = Object.entries(
    EMAIL_PROVIDER_KEY_COLUMNS,
  )
    .filter(([provider]: [string, ReadonlyArray<string> | undefined]) => {
      return provider !== transport;
    })
    .flatMap(([, keyColumns]: [string, ReadonlyArray<string> | undefined]) => {
      return [...(keyColumns || [])];
    });

  if (transport === MailTransportType.SMTP) {
    return otherProvidersKeys;
  }

  if (transport === MailTransportType.MicrosoftGraph) {
    return [
      ...getSmtpServerColumnsGraphIgnores(columns),
      ...otherProvidersKeys,
    ];
  }

  return [
    ...getSmtpServerColumnsGraphIgnores(columns),
    columns.clientId,
    columns.clientSecret,
    columns.tokenUrl,
    columns.scope,
    columns.oauthProviderType,
    ...otherProvidersKeys,
  ];
};

/**
 * What a new config keeps of the values its form held. A provider picked
 * hides the steps of every other - Microsoft Graph and the API providers
 * the hostname, port, username and password; an API provider the OAuth
 * app; each provider every other's key - but the form still holds them:
 * the port it starts on, or what was typed before another provider was
 * picked. So they are left out of what is created, as the form left them
 * out of what it showed, and a key typed in for one provider is never
 * stored on a config of another. For a create form's onBeforeCreate: an
 * edited config keeps what it holds.
 */
export const withoutValuesTransportIgnores: <TEntity>(
  item: TEntity,
  columns: SmtpConfigFormColumns<TEntity>,
) => TEntity = <TEntity>(
  item: TEntity,
  columns: SmtpConfigFormColumns<TEntity>,
): TEntity => {
  for (const column of getColumnsTransportIgnores(
    getSmtpTransport(item, columns),
    columns,
  )) {
    delete (item as unknown as Record<string, unknown>)[column];
  }

  return item;
};
