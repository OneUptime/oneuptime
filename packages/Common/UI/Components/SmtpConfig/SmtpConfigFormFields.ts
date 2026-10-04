import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import MailTransportType from "../../../Types/Email/MailTransportType";
import OAuthProviderType from "../../../Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "../../../Types/Email/SMTPAuthenticationType";
import SelectFormFields from "../../Types/SelectEntityField";
import DropdownUtil from "../../Utils/Dropdown";
import { translationKey } from "../../Utils/TranslateTemplate";
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

export const SMTP_TRANSPORT_DESCRIPTION: string = translationKey(
  "SMTP works with most mail servers. Choose Microsoft Graph if your Microsoft 365 tenant has SMTP AUTH turned off: mail then goes through the Graph API with an app that has the Mail.Send permission, and the hostname, port and password are not used.",
);

/*
 * What the switch does, from the mail service: on, a connection that is not
 * encrypted with a valid certificate is refused (STARTTLS is required on
 * every port but 465); off, STARTTLS is used when the server offers it and
 * the certificate is not checked. Port 465 is TLS from the first byte either
 * way. "Use SSL / TLS" said none of that, and the instance form's "Do not
 * enable this if you use port 587" was the opposite of the advice now.
 */
export const SMTP_REQUIRE_TLS_DESCRIPTION: string = translationKey(
  "Mail is sent only over an encrypted connection with a valid certificate. When this is off, mail is encrypted only if the server offers it, and the certificate is not checked. Port 465 is always encrypted.",
);

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
 * How mail is sent. Anything but Microsoft Graph - an empty value included -
 * is SMTP, as the mail service reads it.
 */
export const getSmtpTransport: <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
) => MailTransportType = <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
): MailTransportType => {
  return readSmtpFormValue(values, columns.transportType) ===
    MailTransportType.MicrosoftGraph
    ? MailTransportType.MicrosoftGraph
    : MailTransportType.SMTP;
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

// The OAuth app: Microsoft Graph, or SMTP with OAuth.
export const showsSmtpOAuthCredentials: ShowsFunction = <TEntity>(
  values: unknown,
  columns: SmtpConfigFormColumns<TEntity>,
): boolean => {
  return (
    getSmtpTransport(values, columns) === MailTransportType.MicrosoftGraph ||
    getSmtpAuthType(values, columns) === SMTPAuthenticationType.OAuth
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
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions:
        DropdownUtil.getDropdownOptionsFromEnum(MailTransportType),
      required: true,
      defaultValue: MailTransportType.SMTP,
      description: SMTP_TRANSPORT_DESCRIPTION,
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
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
        SMTPAuthenticationType,
      ),
      required: true,
      defaultValue: SMTPAuthenticationType.UsernamePassword,
      description:
        "Select the authentication method. Use OAuth for providers like Microsoft 365, Google Workspace, etc.",
      showIf: (values: FormValues<TEntity>): boolean => {
        return showsSmtpServerFields(values, columns);
      },
      collapsibleSection: advancedSection,
    },
    {
      field: { [columns.oauthProviderType]: true } as SelectFormFields<TEntity>,
      title: "OAuth Provider Type",
      stepId: "server",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions:
        DropdownUtil.getDropdownOptionsFromEnum(OAuthProviderType),
      required: true,
      defaultValue: OAuthProviderType.ClientCredentials,
      description:
        "Select the OAuth grant type. Use 'Client Credentials' for Microsoft 365 and most providers. Use 'JWT Bearer' for Google Workspace service accounts.",
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
        "Application (Client) ID from your Azure AD app registration (or service account for JWT Bearer).",
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
        "For Client Credentials: Client secret from your OAuth application. For JWT Bearer (Google): The entire private_key from your service account JSON file (including BEGIN/END markers).",
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
        "The OAuth token endpoint URL. For Microsoft 365 (both SMTP+OAuth and Microsoft Graph): https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token. For Google: https://oauth2.googleapis.com/token",
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
      description:
        "The OAuth scope(s) required. For Microsoft Graph: https://graph.microsoft.com/.default. For Microsoft 365 SMTP+OAuth: https://outlook.office365.com/.default. For Google: https://mail.google.com/",
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
            description:
              "Friendly description for this config so you remember what this is about.",
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
      description:
        "This is the display name your team and customers see, when they receive emails from OneUptime.",
      disableSpellCheck: true,
    },
  ];
};

/**
 * A project's Custom SMTP config: its Name first, on the Server step, then
 * the shared fields. The Description is folded under Advanced.
 */
export const getProjectSmtpConfigFormFields: () => Array<
  Field<ProjectSmtpConfig>
> = (): Array<Field<ProjectSmtpConfig>> => {
  return [
    {
      field: { name: true },
      title: "Name",
      stepId: "server",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      description:
        "Friendly name for this config so you remember what this is about.",
      placeholder: "Company SMTP Server",
      validation: {
        minLength: 2,
      },
    },
    ...getSmtpConfigFormFields<ProjectSmtpConfig>(
      PROJECT_SMTP_CONFIG_FORM_COLUMNS,
    ),
  ];
};

// The instance's mail server (GlobalConfig): the shared fields as they are.
export const getGlobalSmtpConfigFormFields: () => Array<
  Field<GlobalConfig>
> = (): Array<Field<GlobalConfig>> => {
  return getSmtpConfigFormFields<GlobalConfig>(GLOBAL_SMTP_CONFIG_FORM_COLUMNS);
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

/**
 * What a new config keeps of the values its form held. Once Microsoft Graph
 * is picked the form hides the hostname, port, username and password, but
 * still holds them - the port it starts on, or what was typed before Graph
 * was picked - so they are left out of what is created, as the form left
 * them out of what it showed. Any other config is created as it is. For a
 * create form's onBeforeCreate: an edited config keeps what it holds.
 */
export const withoutValuesGraphIgnores: <TEntity>(
  item: TEntity,
  columns: SmtpConfigFormColumns<TEntity>,
) => TEntity = <TEntity>(
  item: TEntity,
  columns: SmtpConfigFormColumns<TEntity>,
): TEntity => {
  if (getSmtpTransport(item, columns) !== MailTransportType.MicrosoftGraph) {
    return item;
  }

  for (const column of getSmtpServerColumnsGraphIgnores(columns)) {
    delete (item as unknown as Record<string, unknown>)[column];
  }

  return item;
};
