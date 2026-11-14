import { describe, expect, test } from "@jest/globals";
import GlobalConfig, {
  EmailServerType,
} from "../../../../Models/DatabaseModels/GlobalConfig";
import ProjectSmtpConfig from "../../../../Models/DatabaseModels/ProjectSmtpConfig";
import MailTransportType, {
  API_KEY_MAIL_TRANSPORTS,
} from "../../../../Types/Email/MailTransportType";
import OAuthProviderType from "../../../../Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "../../../../Types/Email/SMTPAuthenticationType";
import Field, {
  FormFieldCollapsibleSection,
} from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import {
  ADVANCED_FORM_SECTION_ID,
  MORE_FIELDS_SECTION_TITLE,
} from "../../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { getCreateFormColumnDefault } from "../../../../UI/Components/Forms/Utils/CreateFormDefaults";
import {
  AMAZON_SES_AUTHENTICATION_TYPE_CHOICES,
  AMAZON_SES_AUTHENTICATION_TYPE_DESCRIPTION,
  AMAZON_SES_REGION_INVALID,
  DEFAULT_SMTP_PORT,
  EMAIL_PROVIDER_CHOICES,
  EMAIL_PROVIDER_DESCRIPTION,
  EMAIL_PROVIDER_KEY_COLUMNS,
  GLOBAL_AMAZON_SES_PROVIDER_DESCRIPTION,
  GLOBAL_EMAIL_PROVIDERS,
  GLOBAL_EMAIL_PROVIDER_SENDER_COLUMNS,
  GLOBAL_EMAIL_PROVIDER_TRANSPORTS,
  GLOBAL_SMTP_CONFIG_FORM_COLUMNS,
  GlobalEmailProviderMissingSetting,
  GlobalEmailProviderTransport,
  IMPLICIT_TLS_SMTP_PORT,
  MAILGUN_DOMAIN_INVALID,
  MAILGUN_REGION_CHOICES,
  PROJECT_SMTP_CONFIG_CREATE_INITIAL_VALUES,
  PROJECT_SMTP_CONFIG_FORM_COLUMNS,
  PROVIDER_FROM_EMAIL_DESCRIPTION,
  SMTP_FROM_EMAIL_DESCRIPTION,
  SMTP_OAUTH_SCOPE_DESCRIPTION,
  SMTP_PASSWORD_DESCRIPTION,
  SMTP_PORT_DESCRIPTION,
  SMTP_REQUIRE_TLS_DESCRIPTION,
  SMTP_SENDER_STEP_ID,
  SMTP_SERVER_STEP_ID,
  SMTP_SUMMARY_MICROSOFT_GRAPH,
  SMTP_SUMMARY_NO_SIGN_IN,
  SMTP_SUMMARY_OAUTH,
  SMTP_SUMMARY_PASSWORD,
  SMTP_SUMMARY_TLS_OPTIONAL,
  SMTP_SUMMARY_TLS_PORT_465_UNCHECKED,
  SMTP_SUMMARY_TLS_REQUIRED,
  SMTP_AUTH_TYPE_CHOICES,
  SMTP_AUTH_TYPE_DESCRIPTION,
  SMTP_OAUTH_PROVIDER_TYPE_CHOICES,
  SMTP_OAUTH_PROVIDER_TYPE_DESCRIPTION,
  SMTP_TRANSPORT_CHOICES,
  SMTP_TRANSPORT_DESCRIPTION,
  SMTP_USERNAME_DESCRIPTION,
  SmtpConfigFormColumns,
  getAmazonSesAuthenticationTypeTitle,
  getAmazonSesFormFields,
  getColumnsTransportIgnores,
  getEmailProviderTitle,
  getGlobalAmazonSesFormFields,
  getGlobalEmailProviderCard,
  getGlobalEmailProviderFormFields,
  getGlobalEmailProviderFormSteps,
  getGlobalEmailProviderMissingSetting,
  getGlobalSmtpConfigFormFields,
  getMailgunFormFields,
  getPostmarkFormFields,
  getProjectSmtpConfigFormFields,
  getProjectSmtpConfigFormSteps,
  getResendFormFields,
  getSendGridFormFields,
  getSmtpAdvancedSummary,
  getSmtpAuthType,
  getSmtpConfigFormSteps,
  getSmtpServerColumnsGraphIgnores,
  getSmtpSignInSentence,
  getSmtpTlsSentence,
  getSmtpTransport,
  readSmtpFormValue,
  readSmtpPort,
  requiresSmtpUsername,
  showsSmtpOAuthCredentials,
  showsSmtpOAuthProviderType,
  showsSmtpPassword,
  showsSmtpServerFields,
  showsSmtpUsername,
  usesAmazonSesServerIamRole,
  withoutValuesTransportIgnores,
} from "../../../../UI/Components/SmtpConfig/SmtpConfigFormFields";
import AmazonSesAuthenticationType from "../../../../Types/Email/AmazonSesAuthenticationType";
import MailgunRegion from "../../../../Types/Email/MailgunRegion";
import type { CardSelectOption } from "../../../../UI/Components/CardSelect/CardSelect";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Port from "../../../../Types/Port";
import type { RadioButton } from "../../../../UI/Components/RadioButtons/GroupRadioButtons";

/*
 * The builder behind every mail server form - a project's Custom SMTP
 * config (Settings > Notification Settings), the Admin Dashboard's
 * instance server (Settings > Email > Host Settings) and the instance's
 * provider cards (Amazon SES, Mailgun, Postmark, Resend) - create and edit
 * alike.
 *
 * A project's config asks for its provider first, then that provider's
 * step alone, then the sender:
 *
 *   Provider     Name, the provider (a card each), the Description folded;
 *   Server       SMTP only: Hostname, Port, Username, Password, and the
 *                folded TLS and sign-in type;
 *   OAuth        Microsoft Graph, or SMTP with OAuth: the OAuth grant (SMTP
 *                only) and the OAuth app;
 *   Amazon SES, SendGrid, Mailgun, Postmark, Resend   each provider's key;
 *   Sender       From Email, From Name.
 *
 * The instance's server keeps Server - its transport folded under Advanced
 * - then Sender. The columns each form writes, and what each starts as, are
 * pinned here, so an existing config keeps saving what it holds.
 *
 * The instance's Amazon SES card asks one thing a project's never does: how
 * the server signs in - with an access key, or with the IAM role AWS gives
 * the server itself (#7000).
 */

type Values = Record<string, unknown>;

function keyOf<TEntity>(field: Field<TEntity>): string {
  return Object.keys(field.field || {})[0] || "";
}

function fieldFor<TEntity>(
  fields: Array<Field<TEntity>>,
  key: string,
): Field<TEntity> {
  const found: Field<TEntity> | undefined = fields.find(
    (field: Field<TEntity>): boolean => {
      return keyOf(field) === key;
    },
  );

  if (!found) {
    throw new Error(`No ${key} field`);
  }

  return found;
}

function openOn<TEntity>(
  fields: Array<Field<TEntity>>,
  stepId: string,
): Array<string> {
  return fields
    .filter((field: Field<TEntity>): boolean => {
      return field.stepId === stepId && !field.collapsibleSection;
    })
    .map(keyOf);
}

function foldedOn<TEntity>(
  fields: Array<Field<TEntity>>,
  stepId: string,
): Array<string> {
  return fields
    .filter((field: Field<TEntity>): boolean => {
      return field.stepId === stepId && Boolean(field.collapsibleSection);
    })
    .map(keyOf);
}

// The keys a form shows for these values, in order.
function shownKeys<TEntity>(
  fields: Array<Field<TEntity>>,
  values: Values,
): Array<string> {
  return fields
    .filter((field: Field<TEntity>): boolean => {
      return (
        !field.showIf || field.showIf(values as unknown as FormValues<TEntity>)
      );
    })
    .map(keyOf);
}

// The steps a form shows for these values, by id, in order.
function shownSteps<TEntity>(
  steps: Array<FormStep<TEntity>>,
  values: Values,
): Array<string> {
  return steps
    .filter((step: FormStep<TEntity>): boolean => {
      return (
        !step.showIf || step.showIf(values as unknown as FormValues<TEntity>)
      );
    })
    .map((step: FormStep<TEntity>): string => {
      return step.id;
    });
}

/*
 * What a project's form shows for these values: the fields on the steps it
 * shows, each shown by its own showIf - as BasicForm shows them.
 */
function projectShows(values: Values): Array<string> {
  const steps: Array<string> = shownSteps(PROJECT_STEPS, values);

  return PROJECT_FIELDS.filter((field: Field<ProjectSmtpConfig>): boolean => {
    return (
      steps.includes(field.stepId || "") &&
      (!field.showIf ||
        field.showIf(values as unknown as FormValues<ProjectSmtpConfig>))
    );
  }).map(keyOf);
}

/*
 * The rows a step takes on screen: every field, but fields next to each
 * other in one folded section are its one header (FormStepsScan's rule).
 */
function rowsOn<TEntity>(
  fields: Array<Field<TEntity>>,
  stepId: string,
): number {
  let rows: number = 0;
  let previous: string | undefined = undefined;

  for (const field of fields) {
    if (field.stepId !== stepId) {
      continue;
    }

    const section: string | undefined = field.collapsibleSection?.id;

    if (section !== undefined && section === previous) {
      continue;
    }

    rows++;
    previous = section;
  }

  return rows;
}

const PROJECT_FIELDS: Array<Field<ProjectSmtpConfig>> =
  getProjectSmtpConfigFormFields();

const PROJECT_STEPS: Array<FormStep<ProjectSmtpConfig>> =
  getProjectSmtpConfigFormSteps();

const GLOBAL_FIELDS: Array<Field<GlobalConfig>> =
  getGlobalSmtpConfigFormFields();

const PROJECT: SmtpConfigFormColumns<ProjectSmtpConfig> =
  PROJECT_SMTP_CONFIG_FORM_COLUMNS;

const GLOBAL: SmtpConfigFormColumns<GlobalConfig> =
  GLOBAL_SMTP_CONFIG_FORM_COLUMNS;

/*
 * Where a field is required, as the transport and sign-in it is asked for
 * ("SMTP / OAuth"), read through a form's own column names. A field always
 * or never required reads as that.
 */
function requiredWhen<TEntity>(
  field: Field<TEntity>,
  columns: SmtpConfigFormColumns<TEntity>,
): boolean | Array<string> {
  const required: Field<TEntity>["required"] = field.required;

  if (typeof required !== "function") {
    return Boolean(required);
  }

  const when: Array<string> = [];

  for (const transport of Object.values(MailTransportType)) {
    for (const authType of Object.values(SMTPAuthenticationType)) {
      const values: Values = {
        [columns.transportType]: transport,
        [columns.authType]: authType,
      };

      if (required(values as unknown as FormValues<TEntity>)) {
        when.push(`${transport} / ${authType}`);
      }
    }
  }

  return when;
}

const SMTP_WITH_OAUTH: string = `${MailTransportType.SMTP} / ${SMTPAuthenticationType.OAuth}`;

const PROVIDER_STEPS: Array<[MailTransportType, string, string]> = [
  [MailTransportType.AmazonSES, "amazon-ses", "Amazon SES"],
  [MailTransportType.SendGrid, "sendgrid", "SendGrid"],
  [MailTransportType.Mailgun, "mailgun", "Mailgun"],
  [MailTransportType.Postmark, "postmark", "Postmark"],
  [MailTransportType.Resend, "resend", "Resend"],
];

describe("the instance's steps", () => {
  test("are Server, then Sender", () => {
    const steps: Array<FormStep<GlobalConfig>> =
      getSmtpConfigFormSteps<GlobalConfig>();

    expect(steps).toEqual([
      { title: "Server", id: "server" },
      { title: "Sender", id: "sender" },
    ]);
    expect(SMTP_SERVER_STEP_ID).toBe("server");
    expect(SMTP_SENDER_STEP_ID).toBe("sender");

    // Neither step hides itself: Server holds the Advanced section always.
    for (const step of steps) {
      expect(step.showIf).toBeUndefined();
    }

    // A fresh list per form, so no form can change another's.
    expect(getSmtpConfigFormSteps<GlobalConfig>()).not.toBe(steps);
  });

  test("every field is on one of them", () => {
    for (const field of GLOBAL_FIELDS) {
      expect([SMTP_SERVER_STEP_ID, SMTP_SENDER_STEP_ID]).toContain(
        field.stepId,
      );
    }
  });
});

describe("a project's steps", () => {
  test("the provider, the step of each provider, then the sender", () => {
    expect(
      PROJECT_STEPS.map((step: FormStep<ProjectSmtpConfig>) => {
        return [step.id, step.title];
      }),
    ).toEqual([
      ["provider", "Provider"],
      ["server", "Server"],
      ["oauth", "OAuth"],
      ["amazon-ses", "Amazon SES"],
      ["sendgrid", "SendGrid"],
      ["mailgun", "Mailgun"],
      ["postmark", "Postmark"],
      ["resend", "Resend"],
      ["sender", "Sender"],
    ]);

    // A fresh list per form.
    expect(getProjectSmtpConfigFormSteps()).not.toBe(PROJECT_STEPS);
  });

  test("a provider's step is titled by its name, never looked up: Resend is interface text too", () => {
    for (const step of PROJECT_STEPS) {
      expect({ id: step.id, isName: Boolean(step.isTitleProductName) }).toEqual(
        {
          id: step.id,
          isName: PROVIDER_STEPS.some(
            ([, id]: [MailTransportType, string, string]): boolean => {
              return id === step.id;
            },
          ),
        },
      );
    }
  });

  test("every field is on one of them", () => {
    const ids: Array<string> = PROJECT_STEPS.map(
      (step: FormStep<ProjectSmtpConfig>): string => {
        return step.id;
      },
    );

    for (const field of PROJECT_FIELDS) {
      expect(ids).toContain(field.stepId);
    }
  });

  test.each([
    [{}, ["provider", "server", "sender"]],
    [
      { transportType: MailTransportType.SMTP },
      ["provider", "server", "sender"],
    ],
    [
      {
        transportType: MailTransportType.SMTP,
        authType: SMTPAuthenticationType.OAuth,
      },
      ["provider", "server", "oauth", "sender"],
    ],
    [
      { transportType: MailTransportType.MicrosoftGraph },
      ["provider", "oauth", "sender"],
    ],
    [
      { transportType: MailTransportType.AmazonSES },
      ["provider", "amazon-ses", "sender"],
    ],
    [
      // A sign-in left on OAuth from before asks for no OAuth app.
      {
        transportType: MailTransportType.SendGrid,
        authType: SMTPAuthenticationType.OAuth,
      },
      ["provider", "sendgrid", "sender"],
    ],
    [
      { transportType: MailTransportType.Mailgun },
      ["provider", "mailgun", "sender"],
    ],
    [
      { transportType: MailTransportType.Postmark },
      ["provider", "postmark", "sender"],
    ],
    [
      { transportType: MailTransportType.Resend },
      ["provider", "resend", "sender"],
    ],
  ])("%j walks %j", (values: Values, steps: Array<string>) => {
    expect(shownSteps(PROJECT_STEPS, values)).toEqual(steps);
  });

  test("no step shows more than five rows", () => {
    for (const step of PROJECT_STEPS) {
      expect({ step: step.id, rows: rowsOn(PROJECT_FIELDS, step.id) }).toEqual({
        step: step.id,
        rows: expect.any(Number),
      });
      expect(rowsOn(PROJECT_FIELDS, step.id)).toBeLessThanOrEqual(5);
      expect(rowsOn(PROJECT_FIELDS, step.id)).toBeGreaterThan(0);
    }
  });
});

describe("a project's Custom SMTP config", () => {
  test("asks on Provider for its name and the provider, the description folded", () => {
    expect(openOn(PROJECT_FIELDS, "provider")).toEqual([
      "name",
      "transportType",
    ]);
    expect(foldedOn(PROJECT_FIELDS, "provider")).toEqual(["description"]);
  });

  test("offers each provider as a card, two to a row, SMTP Server to start", () => {
    const provider: Field<ProjectSmtpConfig> = fieldFor(
      PROJECT_FIELDS,
      "transportType",
    );

    expect(provider.title).toBe("Provider");
    expect(provider.fieldType).toBe(FormFieldSchemaType.CardSelect);
    expect(provider.cardSelectOptions).toBe(EMAIL_PROVIDER_CHOICES);
    expect(provider.cardSelectMaxColumns).toBe(2);
    expect(provider.required).toBe(true);
    expect(provider.defaultValue).toBe(MailTransportType.SMTP);
    expect(provider.description).toBe(EMAIL_PROVIDER_DESCRIPTION);
    expect(provider.collapsibleSection).toBeUndefined();
  });

  test("asks on Server for the server and the sign-in, TLS and the sign-in type folded", () => {
    expect(openOn(PROJECT_FIELDS, "server")).toEqual([
      "hostname",
      "port",
      "username",
      "password",
    ]);
    expect(foldedOn(PROJECT_FIELDS, "server")).toEqual(["secure", "authType"]);
  });

  test("asks on OAuth for the grant and the app", () => {
    expect(openOn(PROJECT_FIELDS, "oauth")).toEqual([
      "oauthProviderType",
      "clientId",
      "clientSecret",
      "tokenUrl",
      "scope",
    ]);
    expect(foldedOn(PROJECT_FIELDS, "oauth")).toEqual([]);
  });

  test.each([
    [
      "amazon-ses",
      ["amazonSesAccessKeyId", "amazonSesSecretAccessKey", "amazonSesRegion"],
    ],
    ["sendgrid", ["sendgridApiKey"]],
    ["mailgun", ["mailgunApiKey", "mailgunDomain", "mailgunRegion"]],
    ["postmark", ["postmarkServerToken"]],
    ["resend", ["resendApiKey"]],
  ])(
    "asks on %s for its key and nothing else",
    (step: string, keys: Array<string>) => {
      expect(openOn(PROJECT_FIELDS, step)).toEqual(keys);
      expect(foldedOn(PROJECT_FIELDS, step)).toEqual([]);
    },
  );

  test("asks on Sender who the mail comes from", () => {
    expect(openOn(PROJECT_FIELDS, "sender")).toEqual(["fromEmail", "fromName"]);
    expect(foldedOn(PROJECT_FIELDS, "sender")).toEqual([]);
    expect(fieldFor(PROJECT_FIELDS, "fromEmail").description).toBe(
      PROVIDER_FROM_EMAIL_DESCRIPTION,
    );
  });

  test("writes every column the old form wrote, each provider's own, and nothing else", () => {
    expect(PROJECT_FIELDS.map(keyOf).sort()).toEqual(
      [
        "name",
        "description",
        "transportType",
        "hostname",
        "port",
        "secure",
        "authType",
        "username",
        "password",
        "oauthProviderType",
        "clientId",
        "clientSecret",
        "tokenUrl",
        "scope",
        "amazonSesAccessKeyId",
        "amazonSesSecretAccessKey",
        "amazonSesRegion",
        "sendgridApiKey",
        "mailgunApiKey",
        "mailgunDomain",
        "mailgunRegion",
        "postmarkServerToken",
        "resendApiKey",
        "fromEmail",
        "fromName",
      ].sort(),
    );
  });

  test("names a column of its own model for every field", () => {
    const model: ProjectSmtpConfig = new ProjectSmtpConfig();

    for (const field of PROJECT_FIELDS) {
      expect({
        column: keyOf(field),
        isColumn: Boolean(model.getTableColumnMetadata(keyOf(field))),
      }).toEqual({ column: keyOf(field), isColumn: true });
    }
  });

  test("starts a new config on port 587, a create form's own start", () => {
    expect(DEFAULT_SMTP_PORT).toBe(587);
    expect(PROJECT_SMTP_CONFIG_CREATE_INITIAL_VALUES).toEqual({ port: 587 });

    // Not the field's: an edit form, which never takes create values, never writes it.
    const port: Field<ProjectSmtpConfig> = fieldFor(PROJECT_FIELDS, "port");

    expect(port.defaultValue).toBeUndefined();
    expect(port.getDefaultValue).toBeUndefined();
    expect(port.placeholder).toBe("587");

    // And the column has none: an API caller still sends a port.
    expect(
      new ProjectSmtpConfig().getTableColumnMetadata("port").defaultValue,
    ).toBeUndefined();
  });

  test("starts Require TLS on, from the column, and says nothing of its own", () => {
    const secure: Field<ProjectSmtpConfig> = fieldFor(PROJECT_FIELDS, "secure");

    expect(secure.fieldType).toBe(FormFieldSchemaType.Toggle);
    expect(secure.defaultValue).toBeUndefined();
    expect(secure.getDefaultValue).toBeUndefined();

    // What ModelForm hands a create form's switch that says nothing.
    expect(getCreateFormColumnDefault(new ProjectSmtpConfig(), secure)).toBe(
      true,
    );
  });

  test("is told apart from other configs by a name of two letters or more", () => {
    const name: Field<ProjectSmtpConfig> = fieldFor(PROJECT_FIELDS, "name");

    expect(name.required).toBe(true);
    expect(name.validation).toEqual({ minLength: 2 });
    expect(name.showIf).toBeUndefined();
  });

  test("keeps its description optional and folded", () => {
    const description: Field<ProjectSmtpConfig> = fieldFor(
      PROJECT_FIELDS,
      "description",
    );

    expect(description.required).toBe(false);
    expect(description.collapsibleSection).toBeDefined();
    expect(description.collapsibleSection!.openWhenConfigured).toBe(false);
  });

  test("requires what the mail service cannot send without, on the step it is asked", () => {
    // Always; the username only when OAuth signs in over SMTP (#7833).
    const required: Array<string> = PROJECT_FIELDS.filter(
      (field: Field<ProjectSmtpConfig>): boolean => {
        return field.required === true;
      },
    ).map((field: Field<ProjectSmtpConfig>): string => {
      return `${field.stepId}:${keyOf(field)}`;
    });

    expect(required).toEqual([
      "provider:name",
      "provider:transportType",
      "server:hostname",
      "server:port",
      "server:authType",
      "oauth:oauthProviderType",
      "oauth:clientId",
      "oauth:clientSecret",
      "oauth:tokenUrl",
      "oauth:scope",
      "amazon-ses:amazonSesAccessKeyId",
      "amazon-ses:amazonSesSecretAccessKey",
      "amazon-ses:amazonSesRegion",
      "sendgrid:sendgridApiKey",
      "mailgun:mailgunApiKey",
      "mailgun:mailgunDomain",
      "mailgun:mailgunRegion",
      "postmark:postmarkServerToken",
      "resend:resendApiKey",
      "sender:fromEmail",
      "sender:fromName",
    ]);

    // A server that needs no password is the Authentication type's None.
    expect(fieldFor(PROJECT_FIELDS, "password").required).toBe(false);
    expect(requiredWhen(fieldFor(PROJECT_FIELDS, "username"), PROJECT)).toEqual(
      [SMTP_WITH_OAUTH],
    );
  });

  test("asks the OAuth grant only of SMTP: Microsoft Graph always uses Client Credentials", () => {
    const grant: Field<ProjectSmtpConfig> = fieldFor(
      PROJECT_FIELDS,
      "oauthProviderType",
    );

    expect(
      grant.showIf!({
        transportType: MailTransportType.SMTP,
        authType: SMTPAuthenticationType.OAuth,
      } as unknown as FormValues<ProjectSmtpConfig>),
    ).toBe(true);
    expect(
      grant.showIf!({
        transportType: MailTransportType.MicrosoftGraph,
      } as unknown as FormValues<ProjectSmtpConfig>),
    ).toBe(false);
  });
});

describe("the providers' cards", () => {
  test("one for every transport, SMTP Server first and Microsoft Graph last", () => {
    expect(
      EMAIL_PROVIDER_CHOICES.map((choice: CardSelectOption): string => {
        return choice.value;
      }),
    ).toEqual([
      MailTransportType.SMTP,
      MailTransportType.AmazonSES,
      MailTransportType.SendGrid,
      MailTransportType.Mailgun,
      MailTransportType.Postmark,
      MailTransportType.Resend,
      MailTransportType.MicrosoftGraph,
    ]);
    expect(
      [...EMAIL_PROVIDER_CHOICES]
        .map((choice: CardSelectOption): string => {
          return choice.value;
        })
        .sort(),
    ).toEqual(Object.values(MailTransportType).sort());
  });

  test("each provider is named as its maker writes it, a name never looked up", () => {
    for (const [transport, , name] of PROVIDER_STEPS) {
      const choice: CardSelectOption = EMAIL_PROVIDER_CHOICES.find(
        (candidate: CardSelectOption): boolean => {
          return candidate.value === transport;
        },
      )!;

      expect(choice.title).toBe(name);
      expect(choice.isTitleProductName).toBe(true);
      expect(getEmailProviderTitle(transport)).toBe(name);
    }

    // The two that are interface text: looked up.
    expect(EMAIL_PROVIDER_CHOICES[0]!.title).toBe("SMTP Server");
    expect(EMAIL_PROVIDER_CHOICES[0]!.isTitleProductName).toBeUndefined();
    expect(getEmailProviderTitle(undefined)).toBe("SMTP Server");
    expect(getEmailProviderTitle(MailTransportType.MicrosoftGraph)).toBe(
      "Microsoft Graph",
    );
  });

  test("each card says in one sentence what it sends with, by an icon of its own", () => {
    const icons: Set<string> = new Set<string>();

    for (const choice of EMAIL_PROVIDER_CHOICES) {
      expect(choice.description).toMatch(/^[A-Z].*\.$/);
      expect(choice.description.split(". ")).toHaveLength(1);
      // No provider's logo: OneUptime's own icons, one a provider.
      expect(choice.logo).toBeUndefined();
      icons.add(choice.icon);
    }

    expect(icons.size).toBe(EMAIL_PROVIDER_CHOICES.length);
  });

  test("the columns each provider keeps its key in", () => {
    expect(EMAIL_PROVIDER_KEY_COLUMNS).toEqual({
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
    });

    expect(Object.keys(EMAIL_PROVIDER_KEY_COLUMNS).sort()).toEqual(
      [...API_KEY_MAIL_TRANSPORTS].sort(),
    );
  });
});

describe("each provider's fields", () => {
  test("every key is entered as a secret, never spell-checked", () => {
    for (const key of [
      "amazonSesSecretAccessKey",
      "sendgridApiKey",
      "mailgunApiKey",
      "postmarkServerToken",
      "resendApiKey",
    ]) {
      const field: Field<ProjectSmtpConfig> = fieldFor(PROJECT_FIELDS, key);

      expect({ key, type: field.fieldType }).toEqual({
        key,
        type: FormFieldSchemaType.EncryptedText,
      });
      expect(field.disableSpellCheck).toBe(true);
      expect(String(field.description)).toContain("stored encrypted");
    }
  });

  test("Amazon SES: an AWS Region code, checked as it is typed", () => {
    const region: Field<ProjectSmtpConfig> = fieldFor(
      PROJECT_FIELDS,
      "amazonSesRegion",
    );
    const check: (value: unknown) => string | null = (
      value: unknown,
    ): string | null => {
      return region.customValidation!({
        amazonSesRegion: value,
      } as unknown as FormValues<ProjectSmtpConfig>);
    };

    expect(region.placeholder).toBe("us-east-1");
    expect(check("us-east-1")).toBeNull();
    expect(check("eu-central-2")).toBeNull();
    expect(check("us-gov-west-1")).toBeNull();
    // Empty is the required check's to say.
    expect(check("")).toBeNull();
    expect(check("us-east")).toBe(AMAZON_SES_REGION_INVALID);
    expect(check("email.us-east-1.amazonaws.com")).toBe(
      AMAZON_SES_REGION_INVALID,
    );
  });

  test("Mailgun: a domain, checked as it is typed, and its region, US to start", () => {
    const domain: Field<ProjectSmtpConfig> = fieldFor(
      PROJECT_FIELDS,
      "mailgunDomain",
    );
    const check: (value: unknown) => string | null = (
      value: unknown,
    ): string | null => {
      return domain.customValidation!({
        mailgunDomain: value,
      } as unknown as FormValues<ProjectSmtpConfig>);
    };

    expect(check("mg.example.com")).toBeNull();
    expect(check("")).toBeNull();
    expect(check("https://mg.example.com")).toBe(MAILGUN_DOMAIN_INVALID);
    expect(check("mg.example.com/../v4")).toBe(MAILGUN_DOMAIN_INVALID);

    const region: Field<ProjectSmtpConfig> = fieldFor(
      PROJECT_FIELDS,
      "mailgunRegion",
    );

    expect(region.fieldType).toBe(FormFieldSchemaType.RadioButton);
    expect(region.radioButtonOptions).toBe(MAILGUN_REGION_CHOICES);
    expect(region.defaultValue).toBe(MailgunRegion.US);
    expect(
      MAILGUN_REGION_CHOICES.map((choice: RadioButton): string => {
        return `${choice.value}: ${choice.description}`;
      }),
    ).toEqual([
      "US: Sent through api.mailgun.net.",
      "EU: Sent through api.eu.mailgun.net.",
    ]);
  });

  test("each provider's fields are the same on a project's form and the instance's card", () => {
    const describeField: (field: Field<unknown>) => Record<string, unknown> = (
      field: Field<unknown>,
    ): Record<string, unknown> => {
      return {
        key: keyOf(field),
        title: field.title,
        description: field.description,
        placeholder: field.placeholder,
        fieldType: field.fieldType,
        required: field.required,
        stepId: field.stepId,
      };
    };

    for (const [factory, step] of [
      [getAmazonSesFormFields, "amazon-ses"],
      [getSendGridFormFields, "sendgrid"],
      [getMailgunFormFields, "mailgun"],
      [getPostmarkFormFields, "postmark"],
      [getResendFormFields, "resend"],
    ] as Array<[() => Array<Field<unknown>>, string]>) {
      expect(factory().map(describeField)).toEqual(
        (PROJECT_FIELDS as Array<Field<unknown>>)
          .filter((field: Field<unknown>): boolean => {
            return field.stepId === step;
          })
          .map(describeField),
      );
    }
  });
});

describe("the Admin Dashboard's instance mail server", () => {
  test("asks on Server for the server and the sign-in, with no name", () => {
    expect(openOn(GLOBAL_FIELDS, "server")).toEqual([
      "smtpHost",
      "smtpPort",
      "smtpUsername",
      "smtpPassword",
    ]);
  });

  test("folds the transport, TLS, sign-in type and OAuth under Advanced", () => {
    expect(foldedOn(GLOBAL_FIELDS, "server")).toEqual([
      "smtpTransportType",
      "isSMTPSecure",
      "smtpAuthType",
      "smtpOAuthProviderType",
      "smtpClientId",
      "smtpClientSecret",
      "smtpTokenUrl",
      "smtpScope",
    ]);
  });

  test("asks on Sender who the mail comes from", () => {
    expect(openOn(GLOBAL_FIELDS, "sender")).toEqual([
      "smtpFromEmail",
      "smtpFromName",
    ]);
  });

  test("writes every column the old five-step form wrote, and nothing else", () => {
    expect(GLOBAL_FIELDS.map(keyOf).sort()).toEqual(
      [
        "smtpTransportType",
        "smtpHost",
        "smtpPort",
        "isSMTPSecure",
        "smtpAuthType",
        "smtpUsername",
        "smtpPassword",
        "smtpOAuthProviderType",
        "smtpClientId",
        "smtpClientSecret",
        "smtpTokenUrl",
        "smtpScope",
        "smtpFromEmail",
        "smtpFromName",
      ].sort(),
    );
  });

  test("the port starts on 587 when the instance holds none (#6875), and TLS shows what is stored", () => {
    const port: Field<GlobalConfig> = fieldFor(GLOBAL_FIELDS, "smtpPort");

    /*
     * A value, not only the box's example: a fresh server's port is null,
     * and the edit form starts it on 587 (startsOnDefaultWhenEmpty). An
     * instance with a port of its own keeps it.
     */
    expect(port.defaultValue).toBe(DEFAULT_SMTP_PORT);
    expect(port.startsOnDefaultWhenEmpty).toBe(true);
    expect(port.placeholder).toBe("587");

    // Nothing else of the form starts on a default of its own.
    for (const field of GLOBAL_FIELDS) {
      if (field !== port) {
        expect({
          field: Object.keys(field.field || {}),
          startsOnDefaultWhenEmpty: field.startsOnDefaultWhenEmpty,
        }).toEqual({
          field: Object.keys(field.field || {}),
          startsOnDefaultWhenEmpty: undefined,
        });
      }
    }

    const secure: Field<GlobalConfig> = fieldFor(GLOBAL_FIELDS, "isSMTPSecure");

    expect(secure.defaultValue).toBeUndefined();
    // The column has no default, and the card is an edit form anyway.
    expect(getCreateFormColumnDefault(new GlobalConfig(), secure)).toBe(
      undefined,
    );
  });
});

describe("both forms", () => {
  test("name a column of their own model for every value", () => {
    const projectModel: ProjectSmtpConfig = new ProjectSmtpConfig();
    const globalModel: GlobalConfig = new GlobalConfig();

    // The column names: everything in the map but its one switch.
    const columnsOf: <TEntity>(
      map: SmtpConfigFormColumns<TEntity>,
    ) => Array<string> = <TEntity>(
      map: SmtpConfigFormColumns<TEntity>,
    ): Array<string> => {
      return Object.entries(map)
        .filter(([key]: [string, unknown]): boolean => {
          return key !== "sendsWithoutSignInWhenCredentialsAreBlank";
        })
        .map(([, value]: [string, unknown]): string => {
          return String(value);
        });
    };

    expect(columnsOf(PROJECT)).toHaveLength(15);
    expect(columnsOf(GLOBAL)).toHaveLength(14);

    for (const column of columnsOf(PROJECT)) {
      expect({
        column,
        isColumn: Boolean(projectModel.getTableColumnMetadata(column)),
      }).toEqual({ column, isColumn: true });
    }

    for (const column of columnsOf(GLOBAL)) {
      expect({
        column,
        isColumn: Boolean(globalModel.getTableColumnMetadata(column)),
      }).toEqual({ column, isColumn: true });
    }

    expect(GLOBAL.configDescription).toBeUndefined();
    expect(PROJECT.configDescription).toBe("description");
  });

  test("ask for a mail server and its sign-in in the same words", () => {
    /*
     * Both start on port 587: a new project config through its create
     * form's initial values, the instance's edit form through the port's
     * default (#6875). Every other field starts the same way in both.
     */
    const describeField: (
      field: Field<unknown>,
      columns: SmtpConfigFormColumns<unknown>,
    ) => Record<string, unknown> = (
      field: Field<unknown>,
      columns: SmtpConfigFormColumns<unknown>,
    ): Record<string, unknown> => {
      const isPort: boolean = field.fieldType === FormFieldSchemaType.Port;

      return {
        title: field.title,
        description: field.description,
        placeholder: field.placeholder,
        fieldType: field.fieldType,
        // The username's hangs on the sign-in (#7833): where it holds.
        required: requiredWhen(field, columns),
        defaultValue: isPort ? "587 to start" : field.defaultValue,
      };
    };

    expect(fieldFor(GLOBAL_FIELDS, "smtpPort").defaultValue).toBe(587);
    expect(
      (PROJECT_SMTP_CONFIG_CREATE_INITIAL_VALUES as Record<string, unknown>)[
        "port"
      ],
    ).toBe(587);

    for (const key of [
      "hostname",
      "port",
      "username",
      "password",
      "secure",
      "authType",
      "oauthProviderType",
      "clientId",
      "clientSecret",
      "tokenUrl",
      "scope",
      "fromName",
    ] as Array<keyof SmtpConfigFormColumns<ProjectSmtpConfig>>) {
      expect({
        key,
        ...describeField(
          fieldFor(PROJECT_FIELDS, String(PROJECT[key])) as Field<unknown>,
          PROJECT as SmtpConfigFormColumns<unknown>,
        ),
      }).toEqual({
        key,
        ...describeField(
          fieldFor(GLOBAL_FIELDS, String(GLOBAL[key])) as Field<unknown>,
          GLOBAL as SmtpConfigFormColumns<unknown>,
        ),
      });
    }

    // The scope each OAuth app takes, Microsoft Graph's first, each written whole.
    expect(fieldFor(GLOBAL_FIELDS, "smtpScope").description).toBe(
      SMTP_OAUTH_SCOPE_DESCRIPTION,
    );
    expect(
      SMTP_OAUTH_SCOPE_DESCRIPTION.startsWith(
        "Microsoft Graph: https://graph.microsoft.com/.default.",
      ),
    ).toBe(true);
    expect(SMTP_OAUTH_SCOPE_DESCRIPTION).toContain(
      "Microsoft 365 SMTP: https://outlook.office365.com/.default.",
    );
    expect(SMTP_OAUTH_SCOPE_DESCRIPTION).toContain(
      "Google: https://mail.google.com/",
    );
    // App's ShortDescriptionsGuard holds field descriptions to 150 characters.
    expect(SMTP_OAUTH_SCOPE_DESCRIPTION.length).toBeLessThanOrEqual(150);
  });

  test("fold their options into one section each, folded on create and edit", () => {
    for (const [fields, step] of [
      [GLOBAL_FIELDS, "server"],
      [PROJECT_FIELDS, "server"],
      [PROJECT_FIELDS, "provider"],
    ] as Array<[Array<Field<unknown>>, string]>) {
      const folded: Array<Field<unknown>> = fields.filter(
        (field: Field<unknown>): boolean => {
          return field.stepId === step && Boolean(field.collapsibleSection);
        },
      );
      const section: FormFieldCollapsibleSection<unknown> =
        folded[0]!.collapsibleSection!;

      // One section object, handed to every folded field of the step.
      for (const field of folded) {
        expect(field.collapsibleSection).toBe(section);
      }

      expect(section.id).toBe(ADVANCED_FORM_SECTION_ID);
      expect(section.title).toBe(MORE_FIELDS_SECTION_TITLE);
      expect(section.openWhenConfigured).toBe(false);

      // Next to each other, the step's last fields.
      const onStep: Array<Field<unknown>> = fields.filter(
        (field: Field<unknown>): boolean => {
          return field.stepId === step;
        },
      );

      expect(onStep.slice(onStep.length - folded.length)).toEqual(folded);
    }
  });

  test("the instance requires what the mail service cannot send without", () => {
    // Always; the username only when OAuth signs in over SMTP (#7833).
    expect(
      (GLOBAL_FIELDS as Array<Field<unknown>>)
        .filter((field: Field<unknown>): boolean => {
          return field.required === true;
        })
        .map(keyOf),
    ).toEqual([
      "smtpHost",
      "smtpPort",
      "smtpTransportType",
      "smtpAuthType",
      "smtpOAuthProviderType",
      "smtpClientId",
      "smtpClientSecret",
      "smtpTokenUrl",
      "smtpScope",
      "smtpFromEmail",
      "smtpFromName",
    ]);
  });

  test("start each choice where the mail service reads an empty one", () => {
    expect(fieldFor(PROJECT_FIELDS, "transportType").defaultValue).toBe(
      MailTransportType.SMTP,
    );
    expect(fieldFor(GLOBAL_FIELDS, "smtpTransportType").defaultValue).toBe(
      MailTransportType.SMTP,
    );
    expect(fieldFor(PROJECT_FIELDS, "authType").defaultValue).toBe(
      SMTPAuthenticationType.UsernamePassword,
    );
    expect(fieldFor(PROJECT_FIELDS, "oauthProviderType").defaultValue).toBe(
      OAuthProviderType.ClientCredentials,
    );
  });

  /*
   * Transport, Authentication Type and OAuth Provider Type were dropdowns
   * whose one description named every answer; they are the answers
   * themselves now, the default first, each with one line saying when to
   * pick it. On a project's form the transport is the Provider's cards.
   */
  test("offer the transport, sign-in and OAuth grant as plain answers, each with its line, the default first", () => {
    const pairs: Array<[Field<unknown>, Array<RadioButton>]> = [
      [
        fieldFor(GLOBAL_FIELDS, "smtpTransportType") as Field<unknown>,
        SMTP_TRANSPORT_CHOICES,
      ],
      [
        fieldFor(GLOBAL_FIELDS, "smtpAuthType") as Field<unknown>,
        SMTP_AUTH_TYPE_CHOICES,
      ],
      [
        fieldFor(GLOBAL_FIELDS, "smtpOAuthProviderType") as Field<unknown>,
        SMTP_OAUTH_PROVIDER_TYPE_CHOICES,
      ],
      [
        fieldFor(PROJECT_FIELDS, "authType") as Field<unknown>,
        SMTP_AUTH_TYPE_CHOICES,
      ],
      [
        fieldFor(PROJECT_FIELDS, "oauthProviderType") as Field<unknown>,
        SMTP_OAUTH_PROVIDER_TYPE_CHOICES,
      ],
    ];

    for (const [field, choices] of pairs) {
      expect(field.fieldType).toBe(FormFieldSchemaType.RadioButton);
      expect(field.radioButtonOptions).toBe(choices);
      expect(field.dropdownOptions).toBeUndefined();
      expect(field.defaultValue).toBe(choices[0]!.value);
    }

    expect(fieldFor(GLOBAL_FIELDS, "smtpTransportType").description).toBe(
      SMTP_TRANSPORT_DESCRIPTION,
    );
    expect(fieldFor(PROJECT_FIELDS, "authType").description).toBe(
      SMTP_AUTH_TYPE_DESCRIPTION,
    );
    expect(fieldFor(PROJECT_FIELDS, "oauthProviderType").description).toBe(
      SMTP_OAUTH_PROVIDER_TYPE_DESCRIPTION,
    );

    const values: (choices: Array<RadioButton>) => Array<string> = (
      choices: Array<RadioButton>,
    ): Array<string> => {
      return choices.map((choice: RadioButton): string => {
        return choice.value;
      });
    };

    // The instance's Custom SMTP settings: a mail server, or Microsoft Graph.
    expect(values(SMTP_TRANSPORT_CHOICES)).toEqual([
      MailTransportType.SMTP,
      MailTransportType.MicrosoftGraph,
    ]);
    expect(values(SMTP_AUTH_TYPE_CHOICES)).toEqual([
      SMTPAuthenticationType.UsernamePassword,
      SMTPAuthenticationType.OAuth,
      SMTPAuthenticationType.None,
    ]);
    expect(values(SMTP_OAUTH_PROVIDER_TYPE_CHOICES)).toEqual([
      OAuthProviderType.ClientCredentials,
      OAuthProviderType.JWTBearer,
    ]);

    // Every answer is named as it always was - the value the guides use - with one line under it.
    for (const choice of [
      ...SMTP_TRANSPORT_CHOICES,
      ...SMTP_AUTH_TYPE_CHOICES,
      ...SMTP_OAUTH_PROVIDER_TYPE_CHOICES,
    ]) {
      expect(choice.title).toBe(choice.value);
      expect(choice.description).toMatch(/^[A-Z].*\.$/);
      expect(String(choice.description).split(". ")).toHaveLength(1);
    }

    // No description lists the answers any more: each answer says it.
    for (const description of [
      SMTP_TRANSPORT_DESCRIPTION,
      SMTP_AUTH_TYPE_DESCRIPTION,
      SMTP_OAUTH_PROVIDER_TYPE_DESCRIPTION,
      EMAIL_PROVIDER_DESCRIPTION,
    ]) {
      expect(description).not.toMatch(
        /Microsoft Graph|Client Credentials|JWT Bearer|Amazon SES|SendGrid|Pick|Choose|Select/,
      );
    }
  });

  /*
   * What the mail service does with the switch and with port 465 is pinned
   * against the service itself in App/Tests/Notification/
   * SmtpRequireTlsMeaning.test.ts.
   */
  test("name the TLS switch after what it does, and the port after what the service does with 465", () => {
    const secure: Field<ProjectSmtpConfig> = fieldFor(PROJECT_FIELDS, "secure");

    expect(secure.title).toBe("Require TLS");
    expect(secure.description).toBe(SMTP_REQUIRE_TLS_DESCRIPTION);
    expect(SMTP_REQUIRE_TLS_DESCRIPTION).toContain(
      "Port 465 is always encrypted.",
    );
    expect(SMTP_REQUIRE_TLS_DESCRIPTION).toContain(
      "the certificate is not checked",
    );
    expect(fieldFor(PROJECT_FIELDS, "port").description).toBe(
      SMTP_PORT_DESCRIPTION,
    );
    expect(SMTP_PORT_DESCRIPTION).toContain("usually 587");
    expect(SMTP_PORT_DESCRIPTION).toContain("Port 465 is always encrypted.");

    // The instance form's old advice was the opposite of the switch.
    for (const field of GLOBAL_FIELDS as Array<Field<unknown>>) {
      expect(String(field.description || "")).not.toContain(
        "Do not enable this if you use port 587",
      );
      expect(field.title).not.toBe("Use SSL / TLS");
    }
  });

  test("say what each open field is for", () => {
    expect(fieldFor(PROJECT_FIELDS, "username").description).toBe(
      SMTP_USERNAME_DESCRIPTION,
    );
    expect(fieldFor(PROJECT_FIELDS, "password").description).toBe(
      SMTP_PASSWORD_DESCRIPTION,
    );
    expect(fieldFor(PROJECT_FIELDS, "transportType").description).toBe(
      EMAIL_PROVIDER_DESCRIPTION,
    );
    // A project's sender is any provider's; the instance's, a mail server's or Graph's.
    expect(fieldFor(PROJECT_FIELDS, "fromEmail").description).toBe(
      PROVIDER_FROM_EMAIL_DESCRIPTION,
    );
    expect(fieldFor(GLOBAL_FIELDS, "smtpFromEmail").description).toBe(
      SMTP_FROM_EMAIL_DESCRIPTION,
    );
    // Not "Email used to log in to this SMTP Server": it is not.
    for (const description of [
      SMTP_FROM_EMAIL_DESCRIPTION,
      PROVIDER_FROM_EMAIL_DESCRIPTION,
    ]) {
      expect(description).not.toContain("log in");
    }
    // OAuth signs in as the mailbox that sends, as the old form said.
    expect(SMTP_USERNAME_DESCRIPTION).toContain(
      "With OAuth, enter the email address of the mailbox that sends.",
    );
    expect(fieldFor(PROJECT_FIELDS, "fromEmail").title).toBe("From Email");
    expect(fieldFor(PROJECT_FIELDS, "username").title).toBe("Username");
  });
});

describe("what each transport and sign-in shows", () => {
  const CASES: Array<{
    name: string;
    values: Values;
    project: Array<string>;
  }> = [
    {
      name: "SMTP with a username and password (a new config)",
      values: {},
      project: [
        "name",
        "transportType",
        "description",
        "hostname",
        "port",
        "username",
        "password",
        "secure",
        "authType",
        "fromEmail",
        "fromName",
      ],
    },
    {
      name: "SMTP with OAuth: the mailbox to sign in as, no password, the OAuth grant and app",
      values: { authType: SMTPAuthenticationType.OAuth },
      project: [
        "name",
        "transportType",
        "description",
        "hostname",
        "port",
        "username",
        "secure",
        "authType",
        "oauthProviderType",
        "clientId",
        "clientSecret",
        "tokenUrl",
        "scope",
        "fromEmail",
        "fromName",
      ],
    },
    {
      name: "SMTP without signing in: no username or password",
      values: { authType: SMTPAuthenticationType.None },
      project: [
        "name",
        "transportType",
        "description",
        "hostname",
        "port",
        "secure",
        "authType",
        "fromEmail",
        "fromName",
      ],
    },
    {
      name: "Microsoft Graph: no hostname, port, username, password or TLS - the OAuth app instead",
      values: { transportType: MailTransportType.MicrosoftGraph },
      project: [
        "name",
        "transportType",
        "description",
        "clientId",
        "clientSecret",
        "tokenUrl",
        "scope",
        "fromEmail",
        "fromName",
      ],
    },
    {
      name: "Microsoft Graph, whatever sign-in an older config kept",
      values: {
        transportType: MailTransportType.MicrosoftGraph,
        authType: SMTPAuthenticationType.UsernamePassword,
      },
      project: [
        "name",
        "transportType",
        "description",
        "clientId",
        "clientSecret",
        "tokenUrl",
        "scope",
        "fromEmail",
        "fromName",
      ],
    },
    {
      name: "Amazon SES: its access key and Region, and nothing of a mail server",
      values: {
        transportType: MailTransportType.AmazonSES,
        authType: SMTPAuthenticationType.OAuth,
      },
      project: [
        "name",
        "transportType",
        "description",
        "amazonSesAccessKeyId",
        "amazonSesSecretAccessKey",
        "amazonSesRegion",
        "fromEmail",
        "fromName",
      ],
    },
    {
      name: "SendGrid: its API key",
      values: { transportType: MailTransportType.SendGrid },
      project: [
        "name",
        "transportType",
        "description",
        "sendgridApiKey",
        "fromEmail",
        "fromName",
      ],
    },
    {
      name: "Mailgun: its API key, domain and region",
      values: { transportType: MailTransportType.Mailgun },
      project: [
        "name",
        "transportType",
        "description",
        "mailgunApiKey",
        "mailgunDomain",
        "mailgunRegion",
        "fromEmail",
        "fromName",
      ],
    },
    {
      name: "Postmark: its server API token",
      values: { transportType: MailTransportType.Postmark },
      project: [
        "name",
        "transportType",
        "description",
        "postmarkServerToken",
        "fromEmail",
        "fromName",
      ],
    },
    {
      name: "Resend: its API key",
      values: { transportType: MailTransportType.Resend },
      project: [
        "name",
        "transportType",
        "description",
        "resendApiKey",
        "fromEmail",
        "fromName",
      ],
    },
  ];

  test.each(CASES)("$name", ({ values, project }: (typeof CASES)[number]) => {
    expect(projectShows(values)).toEqual(project);
  });

  test("the instance's form shows a mail server's fields, Microsoft Graph's OAuth app in their place", () => {
    expect(shownKeys(GLOBAL_FIELDS, {})).toEqual([
      "smtpHost",
      "smtpPort",
      "smtpUsername",
      "smtpPassword",
      "smtpTransportType",
      "isSMTPSecure",
      "smtpAuthType",
      "smtpFromEmail",
      "smtpFromName",
    ]);
    expect(
      shownKeys(GLOBAL_FIELDS, { smtpAuthType: SMTPAuthenticationType.OAuth }),
    ).toEqual([
      "smtpHost",
      "smtpPort",
      "smtpUsername",
      "smtpTransportType",
      "isSMTPSecure",
      "smtpAuthType",
      "smtpOAuthProviderType",
      "smtpClientId",
      "smtpClientSecret",
      "smtpTokenUrl",
      "smtpScope",
      "smtpFromEmail",
      "smtpFromName",
    ]);
    expect(
      shownKeys(GLOBAL_FIELDS, {
        smtpTransportType: MailTransportType.MicrosoftGraph,
      }),
    ).toEqual([
      "smtpTransportType",
      "smtpClientId",
      "smtpClientSecret",
      "smtpTokenUrl",
      "smtpScope",
      "smtpFromEmail",
      "smtpFromName",
    ]);
  });

  test("reads a dropdown that holds the option it was picked as", () => {
    const picked: Values = {
      transportType: {
        label: "Microsoft Graph",
        value: MailTransportType.MicrosoftGraph,
      },
    };

    expect(readSmtpFormValue(picked, "transportType")).toBe(
      MailTransportType.MicrosoftGraph,
    );
    expect(getSmtpTransport(picked, PROJECT)).toBe(
      MailTransportType.MicrosoftGraph,
    );
    expect(showsSmtpServerFields(picked, PROJECT)).toBe(false);
    expect(showsSmtpOAuthCredentials(picked, PROJECT)).toBe(true);

    expect(
      getSmtpAuthType(
        { authType: { label: "None", value: SMTPAuthenticationType.None } },
        PROJECT,
      ),
    ).toBe(SMTPAuthenticationType.None);
  });

  test("reads every transport as itself, and an empty or unknown one as SMTP, the way the mail service does", () => {
    for (const transport of Object.values(MailTransportType)) {
      expect(getSmtpTransport({ transportType: transport }, PROJECT)).toBe(
        transport,
      );
    }

    for (const empty of [undefined, null, "", "Carrier Pigeon"]) {
      expect(getSmtpTransport({ transportType: empty }, PROJECT)).toBe(
        MailTransportType.SMTP,
      );
      expect(getSmtpAuthType({ authType: empty }, PROJECT)).toBe(
        SMTPAuthenticationType.UsernamePassword,
      );
    }

    expect(readSmtpFormValue(null, "transportType")).toBeUndefined();
    expect(readSmtpFormValue({ a: 1 }, undefined)).toBeUndefined();
    expect(showsSmtpUsername({}, PROJECT)).toBe(true);
    expect(showsSmtpPassword({}, PROJECT)).toBe(true);
    expect(showsSmtpOAuthProviderType({}, PROJECT)).toBe(false);
    expect(showsSmtpOAuthCredentials({}, PROJECT)).toBe(false);
  });

  test("an API provider shows no mail server and no OAuth app, whatever sign-in a config kept", () => {
    for (const transport of API_KEY_MAIL_TRANSPORTS) {
      const values: Values = {
        transportType: transport,
        authType: SMTPAuthenticationType.OAuth,
      };

      expect(showsSmtpServerFields(values, PROJECT)).toBe(false);
      expect(showsSmtpUsername(values, PROJECT)).toBe(false);
      expect(requiresSmtpUsername(values, PROJECT)).toBe(false);
      expect(showsSmtpPassword(values, PROJECT)).toBe(false);
      expect(showsSmtpOAuthProviderType(values, PROJECT)).toBe(false);
      expect(showsSmtpOAuthCredentials(values, PROJECT)).toBe(false);
    }
  });
});

/*
 * Over SMTP, OAuth signs in as a mailbox - the user the XOAUTH2 sign-in
 * names, with either grant - and the mail service refuses every email
 * without one (#7833). Both forms say so before saving: the Username is
 * required with OAuth over SMTP. With a password it stays optional, as it
 * was (the instance's server sends without signing in until both are set);
 * Microsoft Graph sends as the From Email.
 */
describe("the username, when OAuth signs in over SMTP (#7833)", () => {
  test.each([
    ["a project's config", PROJECT_FIELDS, PROJECT, "username"],
    ["the instance's server", GLOBAL_FIELDS, GLOBAL, "smtpUsername"],
  ] as Array<
    [string, Array<Field<unknown>>, SmtpConfigFormColumns<unknown>, string]
  >)(
    "%s requires it then, and only then: not with a password, without signing in, through Microsoft Graph or through a provider's API",
    (
      _form: string,
      fields: Array<Field<unknown>>,
      columns: SmtpConfigFormColumns<unknown>,
      key: string,
    ) => {
      expect(requiredWhen(fieldFor(fields, key), columns)).toEqual([
        SMTP_WITH_OAUTH,
      ]);
    },
  );

  test("reads the form as the mail service does: no transport picked is SMTP, no sign-in picked is a password", () => {
    expect(requiresSmtpUsername({}, PROJECT)).toBe(false);
    expect(
      requiresSmtpUsername({ authType: SMTPAuthenticationType.OAuth }, PROJECT),
    ).toBe(true);
    expect(
      requiresSmtpUsername(
        { smtpAuthType: SMTPAuthenticationType.OAuth },
        GLOBAL,
      ),
    ).toBe(true);
    // The instance's own column names, not a project's.
    expect(
      requiresSmtpUsername({ authType: SMTPAuthenticationType.OAuth }, GLOBAL),
    ).toBe(false);
    expect(
      requiresSmtpUsername(
        {
          smtpTransportType: MailTransportType.MicrosoftGraph,
          smtpAuthType: SMTPAuthenticationType.OAuth,
        },
        GLOBAL,
      ),
    ).toBe(false);
  });

  test("required only where it is shown, so a hidden username never stops a save", () => {
    for (const [fields, columns, key] of [
      [PROJECT_FIELDS, PROJECT, "username"],
      [GLOBAL_FIELDS, GLOBAL, "smtpUsername"],
    ] as Array<
      [Array<Field<unknown>>, SmtpConfigFormColumns<unknown>, string]
    >) {
      const username: Field<unknown> = fieldFor(fields, key);

      for (const transport of Object.values(MailTransportType)) {
        for (const authType of Object.values(SMTPAuthenticationType)) {
          const values: FormValues<unknown> = {
            [columns.transportType]: transport,
            [columns.authType]: authType,
          } as unknown as FormValues<unknown>;
          const required: boolean = (
            username.required as (values: FormValues<unknown>) => boolean
          )(values);

          expect({
            key,
            transport,
            authType,
            shownIfRequired: !required || username.showIf!(values),
          }).toEqual({ key, transport, authType, shownIfRequired: true });
        }
      }
    }
  });
});

describe("what a new config is created with", () => {
  function projectConfig(values: Record<string, unknown>): ProjectSmtpConfig {
    const config: ProjectSmtpConfig = new ProjectSmtpConfig();
    Object.assign(config, values);
    return config;
  }

  // What a form can hold after its provider was changed a few times.
  const TYPED: Record<string, unknown> = {
    name: "Alerts",
    hostname: "smtp.office365.com",
    port: 587,
    username: "alerts@example.com",
    password: "an-old-password",
    clientId: "0f0e0d0c-0b0a-4000-8000-000000000001",
    clientSecret: "graph-client-secret",
    tokenUrl: "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
    scope: "https://graph.microsoft.com/.default",
    oauthProviderType: OAuthProviderType.ClientCredentials,
    amazonSesAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
    amazonSesSecretAccessKey: "ses-secret",
    amazonSesRegion: "us-east-1",
    sendgridApiKey: "SG.key",
    mailgunApiKey: "key-mailgun",
    mailgunDomain: "mg.example.com",
    mailgunRegion: MailgunRegion.EU,
    postmarkServerToken: "pm-token",
    resendApiKey: "re_key",
    fromEmail: "alerts@example.com",
    fromName: "Example Alerts",
  };

  const SERVER_COLUMNS: Array<string> = [
    "hostname",
    "port",
    "username",
    "password",
  ];

  const OAUTH_COLUMNS: Array<string> = [
    "clientId",
    "clientSecret",
    "tokenUrl",
    "scope",
    "oauthProviderType",
  ];

  const KEY_COLUMNS: Array<string> = Object.values(
    EMAIL_PROVIDER_KEY_COLUMNS,
  ).flatMap((columns: ReadonlyArray<string> | undefined): Array<string> => {
    return [...(columns || [])];
  });

  function keptOf(transport: MailTransportType | undefined): Array<string> {
    const config: ProjectSmtpConfig = withoutValuesTransportIgnores(
      projectConfig({ ...TYPED, transportType: transport }),
      PROJECT,
    );

    return Object.keys(TYPED).filter((key: string): boolean => {
      return (config as unknown as Record<string, unknown>)[key] !== undefined;
    });
  }

  test("Microsoft Graph and the API providers never use the hostname, port, username or password", () => {
    expect(getSmtpServerColumnsGraphIgnores(PROJECT)).toEqual(SERVER_COLUMNS);
    expect(getSmtpServerColumnsGraphIgnores(GLOBAL)).toEqual([
      "smtpHost",
      "smtpPort",
      "smtpUsername",
      "smtpPassword",
    ]);
  });

  test("an SMTP config keeps its server and OAuth app, and no provider's key", () => {
    for (const transport of [MailTransportType.SMTP, undefined]) {
      expect(keptOf(transport).sort()).toEqual(
        Object.keys(TYPED)
          .filter((key: string): boolean => {
            return !KEY_COLUMNS.includes(key);
          })
          .sort(),
      );
    }
  });

  test("a Microsoft Graph config keeps its OAuth app, and no server or provider's key", () => {
    expect(keptOf(MailTransportType.MicrosoftGraph).sort()).toEqual(
      Object.keys(TYPED)
        .filter((key: string): boolean => {
          return !SERVER_COLUMNS.includes(key) && !KEY_COLUMNS.includes(key);
        })
        .sort(),
    );
  });

  test.each(API_KEY_MAIL_TRANSPORTS)(
    "a %s config keeps its own key alone: no server, OAuth app or other provider's key",
    (transport: MailTransportType) => {
      const own: ReadonlyArray<string> =
        EMAIL_PROVIDER_KEY_COLUMNS[transport] || [];

      expect(keptOf(transport).sort()).toEqual(
        Object.keys(TYPED)
          .filter((key: string): boolean => {
            return (
              !SERVER_COLUMNS.includes(key) &&
              !OAUTH_COLUMNS.includes(key) &&
              (!KEY_COLUMNS.includes(key) || own.includes(key))
            );
          })
          .sort(),
      );
      expect(getColumnsTransportIgnores(transport, PROJECT)).not.toContain(
        "fromEmail",
      );
    },
  );

  test("what is left is what the API takes", () => {
    const config: ProjectSmtpConfig = withoutValuesTransportIgnores(
      projectConfig({ ...TYPED, transportType: MailTransportType.Mailgun }),
      PROJECT,
    );

    const json: Record<string, unknown> = BaseModel.toJSONObject(
      config,
      ProjectSmtpConfig,
    ) as Record<string, unknown>;

    expect({
      name: json["name"],
      transportType: json["transportType"],
      mailgunApiKey: json["mailgunApiKey"],
      mailgunDomain: json["mailgunDomain"],
      mailgunRegion: json["mailgunRegion"],
      fromName: json["fromName"],
      password: json["password"],
      resendApiKey: json["resendApiKey"],
    }).toEqual({
      name: "Alerts",
      transportType: MailTransportType.Mailgun,
      mailgunApiKey: "key-mailgun",
      mailgunDomain: "mg.example.com",
      mailgunRegion: MailgunRegion.EU,
      fromName: "Example Alerts",
      password: undefined,
      resendApiKey: undefined,
    });
  });

  test("reads the instance's own columns too", () => {
    const values: Record<string, unknown> = {
      smtpTransportType: MailTransportType.MicrosoftGraph,
      smtpHost: "smtp.office365.com",
      smtpPort: 587,
      smtpClientId: "client",
    };

    withoutValuesTransportIgnores(values as unknown as GlobalConfig, GLOBAL);

    expect(values).toEqual({
      smtpTransportType: MailTransportType.MicrosoftGraph,
      smtpClientId: "client",
    });
  });
});

describe("the instance's provider cards", () => {
  test("Amazon SES, Mailgun, Postmark and Resend are Email Server Types of their own", () => {
    expect([...GLOBAL_EMAIL_PROVIDER_TRANSPORTS]).toEqual([
      MailTransportType.AmazonSES,
      MailTransportType.Mailgun,
      MailTransportType.Postmark,
      MailTransportType.Resend,
    ]);
    expect([...GLOBAL_EMAIL_PROVIDERS]).toEqual([
      {
        serverType: EmailServerType.AmazonSES,
        transport: MailTransportType.AmazonSES,
      },
      {
        serverType: EmailServerType.Mailgun,
        transport: MailTransportType.Mailgun,
      },
      {
        serverType: EmailServerType.Postmark,
        transport: MailTransportType.Postmark,
      },
      {
        serverType: EmailServerType.Resend,
        transport: MailTransportType.Resend,
      },
    ]);
  });

  test("each Email Server Type's card is its provider's card, for its own value", () => {
    for (const provider of GLOBAL_EMAIL_PROVIDERS) {
      const card: CardSelectOption = getGlobalEmailProviderCard(
        provider.serverType,
      )!;
      const projectCard: CardSelectOption = EMAIL_PROVIDER_CHOICES.find(
        (choice: CardSelectOption): boolean => {
          return choice.value === provider.transport;
        },
      )!;

      expect(card).toEqual(
        provider.serverType === EmailServerType.AmazonSES
          ? {
              ...projectCard,
              value: provider.serverType,
              description: GLOBAL_AMAZON_SES_PROVIDER_DESCRIPTION,
            }
          : { ...projectCard, value: provider.serverType },
      );
    }

    // Only the instance's Amazon SES may sign in with the server's IAM role.
    expect(
      getGlobalEmailProviderCard(EmailServerType.AmazonSES)!.description,
    ).toBe(
      "Send through Amazon SES with an access key or this server's IAM role.",
    );
    expect(
      EMAIL_PROVIDER_CHOICES.find((choice: CardSelectOption): boolean => {
        return choice.value === MailTransportType.AmazonSES;
      })!.description,
    ).toBe("Send through Amazon Simple Email Service with an IAM access key.");

    // Custom SMTP and SendGrid have cards of the page's own.
    expect(
      getGlobalEmailProviderCard(EmailServerType.CustomSMTP),
    ).toBeUndefined();
    expect(
      getGlobalEmailProviderCard(EmailServerType.Sendgrid),
    ).toBeUndefined();
  });

  test.each(GLOBAL_EMAIL_PROVIDER_TRANSPORTS)(
    "%s: its own step, then the sender in its own columns",
    (transport: GlobalEmailProviderTransport) => {
      const steps: Array<FormStep<GlobalConfig>> =
        getGlobalEmailProviderFormSteps(transport);
      const fields: Array<Field<GlobalConfig>> =
        getGlobalEmailProviderFormFields(transport);
      const projectStep: FormStep<ProjectSmtpConfig> = PROJECT_STEPS.find(
        (step: FormStep<ProjectSmtpConfig>): boolean => {
          return step.title === transport;
        },
      )!;

      expect(
        steps.map((step: FormStep<GlobalConfig>) => {
          return [step.id, step.title, Boolean(step.isTitleProductName)];
        }),
      ).toEqual([
        [projectStep.id, transport, true],
        ["sender", "Sender", false],
      ]);

      expect(openOn(fields, projectStep.id)).toEqual(
        transport === MailTransportType.AmazonSES
          ? [
              "amazonSesAuthenticationType",
              ...openOn(PROJECT_FIELDS, projectStep.id),
            ]
          : openOn(PROJECT_FIELDS, projectStep.id),
      );
      expect(openOn(fields, "sender")).toEqual([
        GLOBAL_EMAIL_PROVIDER_SENDER_COLUMNS[transport].fromEmail,
        GLOBAL_EMAIL_PROVIDER_SENDER_COLUMNS[transport].fromName,
      ]);

      const model: GlobalConfig = new GlobalConfig();

      for (const field of fields) {
        expect({
          column: keyOf(field),
          isColumn: Boolean(model.getTableColumnMetadata(keyOf(field))),
        }).toEqual({ column: keyOf(field), isColumn: true });
      }
    },
  );

  test("says what a card still needs, the key first, then where it sends from, then the address", () => {
    const missing: (
      transport: GlobalEmailProviderTransport,
      values: Values,
    ) => GlobalEmailProviderMissingSetting | null = (
      transport: GlobalEmailProviderTransport,
      values: Values,
    ): GlobalEmailProviderMissingSetting | null => {
      return getGlobalEmailProviderMissingSetting(transport, values);
    };

    expect(missing(MailTransportType.AmazonSES, {})).toBe(
      GlobalEmailProviderMissingSetting.AccessKey,
    );
    expect(
      missing(MailTransportType.AmazonSES, { amazonSesAccessKeyId: "AKIA" }),
    ).toBe(GlobalEmailProviderMissingSetting.AccessKey);
    expect(
      missing(MailTransportType.AmazonSES, {
        amazonSesAccessKeyId: "AKIA",
        amazonSesSecretAccessKey: "secret",
        amazonSesRegion: "not a region",
      }),
    ).toBe(GlobalEmailProviderMissingSetting.Region);
    expect(
      missing(MailTransportType.AmazonSES, {
        amazonSesAccessKeyId: "AKIA",
        amazonSesSecretAccessKey: "secret",
        amazonSesRegion: "eu-west-1",
      }),
    ).toBe(GlobalEmailProviderMissingSetting.FromEmail);
    expect(
      missing(MailTransportType.AmazonSES, {
        amazonSesAccessKeyId: "AKIA",
        amazonSesSecretAccessKey: "secret",
        amazonSesRegion: "eu-west-1",
        amazonSesFromEmail: "alerts@example.com",
      }),
    ).toBeNull();

    // Signing in with the server's IAM role: no key to ask for (#7000).
    const role: Values = {
      amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
    };

    expect(missing(MailTransportType.AmazonSES, role)).toBe(
      GlobalEmailProviderMissingSetting.Region,
    );
    expect(
      missing(MailTransportType.AmazonSES, {
        ...role,
        amazonSesRegion: "not a region",
      }),
    ).toBe(GlobalEmailProviderMissingSetting.Region);
    expect(
      missing(MailTransportType.AmazonSES, {
        ...role,
        amazonSesRegion: "eu-west-1",
      }),
    ).toBe(GlobalEmailProviderMissingSetting.FromEmail);
    expect(
      missing(MailTransportType.AmazonSES, {
        ...role,
        amazonSesRegion: "eu-west-1",
        amazonSesFromEmail: "alerts@example.com",
      }),
    ).toBeNull();
    // A sign-in it does not know is an access key, as the mail service reads it.
    expect(
      missing(MailTransportType.AmazonSES, {
        amazonSesAuthenticationType: "Instance Profile",
        amazonSesRegion: "eu-west-1",
        amazonSesFromEmail: "alerts@example.com",
      }),
    ).toBe(GlobalEmailProviderMissingSetting.AccessKey);
    expect(
      missing(MailTransportType.AmazonSES, {
        amazonSesAuthenticationType: AmazonSesAuthenticationType.AccessKey,
        amazonSesRegion: "eu-west-1",
        amazonSesFromEmail: "alerts@example.com",
      }),
    ).toBe(GlobalEmailProviderMissingSetting.AccessKey);

    expect(missing(MailTransportType.Mailgun, {})).toBe(
      GlobalEmailProviderMissingSetting.ApiKey,
    );
    expect(
      missing(MailTransportType.Mailgun, {
        mailgunApiKey: "key",
        mailgunDomain: "not a domain",
      }),
    ).toBe(GlobalEmailProviderMissingSetting.Domain);
    expect(
      missing(MailTransportType.Mailgun, {
        mailgunApiKey: "key",
        mailgunDomain: "mg.example.com",
        mailgunFromEmail: "alerts@mg.example.com",
      }),
    ).toBeNull();

    expect(
      missing(MailTransportType.Postmark, { postmarkServerToken: " " }),
    ).toBe(GlobalEmailProviderMissingSetting.ServerToken);
    expect(
      missing(MailTransportType.Postmark, {
        postmarkServerToken: "token",
        postmarkFromEmail: "alerts@example.com",
      }),
    ).toBeNull();

    expect(missing(MailTransportType.Resend, {})).toBe(
      GlobalEmailProviderMissingSetting.ApiKey,
    );
    expect(missing(MailTransportType.Resend, { resendApiKey: "re_key" })).toBe(
      GlobalEmailProviderMissingSetting.FromEmail,
    );
    // A From Name left blank is the product's name, as the mail service sends it.
    expect(
      missing(MailTransportType.Resend, {
        resendApiKey: "re_key",
        resendFromEmail: "alerts@example.com",
      }),
    ).toBeNull();
  });
});

describe("the instance's Amazon SES card: an access key, or this server's IAM role (#7000)", () => {
  const fields: Array<Field<GlobalConfig>> = getGlobalAmazonSesFormFields();
  const ROLE: Values = {
    amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
  };
  const KEY: Values = {
    amazonSesAuthenticationType: AmazonSesAuthenticationType.AccessKey,
  };

  test("asks first how the server signs in, two plain answers, an access key to start", () => {
    const field: Field<GlobalConfig> = fieldFor(
      fields,
      "amazonSesAuthenticationType",
    );

    expect(keyOf(fields[0]!)).toBe("amazonSesAuthenticationType");
    expect({
      title: field.title,
      stepId: field.stepId,
      fieldType: field.fieldType,
      required: field.required,
      defaultValue: field.defaultValue,
      startsOnDefaultWhenEmpty: field.startsOnDefaultWhenEmpty,
      description: field.description,
      dataTestId: field.dataTestId,
    }).toEqual({
      title: "Authentication Type",
      stepId: "amazon-ses",
      fieldType: FormFieldSchemaType.RadioButton,
      required: true,
      defaultValue: AmazonSesAuthenticationType.AccessKey,
      // A server that never picked one signs in with its access key.
      startsOnDefaultWhenEmpty: true,
      description: "How OneUptime signs in to Amazon SES.",
      dataTestId: "amazon-ses-authentication-type",
    });
    expect(AMAZON_SES_AUTHENTICATION_TYPE_DESCRIPTION).toBe(
      "How OneUptime signs in to Amazon SES.",
    );

    expect(field.radioButtonOptions).toBe(
      AMAZON_SES_AUTHENTICATION_TYPE_CHOICES,
    );
    expect(
      AMAZON_SES_AUTHENTICATION_TYPE_CHOICES.map((choice: RadioButton) => {
        return [choice.value, choice.title, choice.description];
      }),
    ).toEqual([
      [
        AmazonSesAuthenticationType.AccessKey,
        "Access Key",
        "An IAM user's access key ID and secret access key, stored encrypted.",
      ],
      [
        AmazonSesAuthenticationType.ServerIamRole,
        "This Server's IAM Role",
        "The role AWS gives this server on Amazon EKS, ECS or EC2. No key is stored, and its credentials renew on their own.",
      ],
    ]);
  });

  test("with the server's IAM role, asks only for the Region", () => {
    expect(shownKeys(fields, ROLE)).toEqual([
      "amazonSesAuthenticationType",
      "amazonSesRegion",
    ]);
  });

  test("with an access key - picked, never picked, or one it does not know - asks for the key and the Region", () => {
    const withKey: Array<string> = [
      "amazonSesAuthenticationType",
      "amazonSesAccessKeyId",
      "amazonSesSecretAccessKey",
      "amazonSesRegion",
    ];

    expect(shownKeys(fields, KEY)).toEqual(withKey);
    expect(shownKeys(fields, {})).toEqual(withKey);
    expect(shownKeys(fields, { amazonSesAuthenticationType: null })).toEqual(
      withKey,
    );
    expect(
      shownKeys(fields, { amazonSesAuthenticationType: "Instance Profile" }),
    ).toEqual(withKey);
  });

  test("the key stays required when it is asked; hidden, it is not checked", () => {
    for (const key of ["amazonSesAccessKeyId", "amazonSesSecretAccessKey"]) {
      const field: Field<GlobalConfig> = fieldFor(fields, key);

      expect({ key, required: field.required }).toEqual({
        key,
        required: true,
      });
      expect(field.showIf!(ROLE as unknown as FormValues<GlobalConfig>)).toBe(
        false,
      );
      expect(field.showIf!(KEY as unknown as FormValues<GlobalConfig>)).toBe(
        true,
      );
    }

    // The Region is asked either way, as it was.
    expect(fieldFor(fields, "amazonSesRegion").showIf).toBeUndefined();
    expect(fieldFor(fields, "amazonSesRegion").required).toBe(true);
  });

  test("its key and Region fields are a project's own, but for when they show", () => {
    // Functions are made anew for each list: compared by what they do.
    const strip: (
      field: Field<GlobalConfig>,
    ) => Omit<Field<GlobalConfig>, "showIf" | "customValidation"> = (
      field: Field<GlobalConfig>,
    ): Omit<Field<GlobalConfig>, "showIf" | "customValidation"> => {
      const { showIf, customValidation, ...rest } = field;
      void showIf;
      void customValidation;
      return rest;
    };

    expect(fields.slice(1).map(strip)).toEqual(
      getAmazonSesFormFields<GlobalConfig>().map(strip),
    );

    const region: Field<GlobalConfig> = fieldFor(fields, "amazonSesRegion");

    expect(
      region.customValidation!({
        amazonSesRegion: "not a region",
      } as unknown as FormValues<GlobalConfig>),
    ).toBe(AMAZON_SES_REGION_INVALID);
    expect(
      region.customValidation!({
        amazonSesRegion: "eu-west-1",
      } as unknown as FormValues<GlobalConfig>),
    ).toBeFalsy();
  });

  test("takes no more than five rows", () => {
    expect(rowsOn(fields, "amazon-ses")).toBe(4);
  });

  test("a project's config never asks it: only the server's own email may use the server's role", () => {
    expect(
      PROJECT_FIELDS.map((field: Field<ProjectSmtpConfig>): string => {
        return keyOf(field);
      }),
    ).not.toContain("amazonSesAuthenticationType");
    // A project's config has nowhere to keep one.
    expect(
      new ProjectSmtpConfig().hasColumn("amazonSesAuthenticationType"),
    ).toBe(false);
    expect(new GlobalConfig().hasColumn("amazonSesAuthenticationType")).toBe(
      true,
    );
  });

  test("reads the form's answer however it holds it", () => {
    expect(usesAmazonSesServerIamRole(ROLE)).toBe(true);
    expect(
      usesAmazonSesServerIamRole({
        amazonSesAuthenticationType: {
          label: "This Server's IAM Role",
          value: AmazonSesAuthenticationType.ServerIamRole,
        },
      }),
    ).toBe(true);
    expect(usesAmazonSesServerIamRole(KEY)).toBe(false);
    expect(usesAmazonSesServerIamRole({})).toBe(false);
    expect(usesAmazonSesServerIamRole(null)).toBe(false);
    expect(usesAmazonSesServerIamRole(undefined)).toBe(false);
    expect(
      usesAmazonSesServerIamRole({
        amazonSesAuthenticationType: "server iam role",
      }),
    ).toBe(false);
  });

  test("names each answer by its title; a server that never picked one signs in with its access key", () => {
    expect(
      getAmazonSesAuthenticationTypeTitle(
        AmazonSesAuthenticationType.ServerIamRole,
      ),
    ).toBe("This Server's IAM Role");
    expect(
      getAmazonSesAuthenticationTypeTitle(
        AmazonSesAuthenticationType.AccessKey,
      ),
    ).toBe("Access Key");

    for (const value of [undefined, null, "", "Instance Profile"]) {
      expect(getAmazonSesAuthenticationTypeTitle(value)).toBe("Access Key");
    }
  });
});

describe("the folded Advanced header", () => {
  const summaryOf: (values: Values) => Array<string> | undefined = (
    values: Values,
  ): Array<string> | undefined => {
    return fieldFor(PROJECT_FIELDS, "secure").collapsibleSection!.getSummary!(
      values as unknown as FormValues<ProjectSmtpConfig>,
    );
  };

  test("says a new config sends over SMTP with the username and password, and requires TLS", () => {
    // What a create form starts with: the column defaults.
    expect(
      summaryOf({
        transportType: MailTransportType.SMTP,
        authType: SMTPAuthenticationType.UsernamePassword,
        secure: true,
      }),
    ).toEqual([SMTP_SUMMARY_PASSWORD, SMTP_SUMMARY_TLS_REQUIRED]);

    expect(SMTP_SUMMARY_PASSWORD).toBe(
      "Mail is sent over SMTP, signing in with the username and password.",
    );
    expect(SMTP_SUMMARY_TLS_REQUIRED).toBe("TLS is required.");
  });

  test("follows the sign-in", () => {
    expect(
      summaryOf({ authType: SMTPAuthenticationType.OAuth, secure: true }),
    ).toEqual([SMTP_SUMMARY_OAUTH, SMTP_SUMMARY_TLS_REQUIRED]);
    expect(
      summaryOf({ authType: SMTPAuthenticationType.None, secure: true }),
    ).toEqual([SMTP_SUMMARY_NO_SIGN_IN, SMTP_SUMMARY_TLS_REQUIRED]);
  });

  test("says when TLS is not required: switched off, or never set on an older row", () => {
    expect(summaryOf({ secure: false })).toEqual([
      SMTP_SUMMARY_PASSWORD,
      SMTP_SUMMARY_TLS_OPTIONAL,
    ]);
    expect(summaryOf({ secure: null })).toEqual([
      SMTP_SUMMARY_PASSWORD,
      SMTP_SUMMARY_TLS_OPTIONAL,
    ]);
    expect(SMTP_SUMMARY_TLS_OPTIONAL).toBe(
      "TLS is used only if the server offers it.",
    );
  });

  test("says Microsoft Graph, where a Graph user looks for the transport they picked", () => {
    expect(
      summaryOf({
        transportType: MailTransportType.MicrosoftGraph,
        secure: false,
        authType: SMTPAuthenticationType.UsernamePassword,
      }),
    ).toEqual([SMTP_SUMMARY_MICROSOFT_GRAPH]);
    expect(SMTP_SUMMARY_MICROSOFT_GRAPH).toBe(
      "Mail is sent through Microsoft Graph, signing in with OAuth.",
    );
  });

  test("reads the instance's own columns on the Admin form", () => {
    const section: FormFieldCollapsibleSection<GlobalConfig> = fieldFor(
      GLOBAL_FIELDS,
      "smtpTransportType",
    ).collapsibleSection!;

    expect(
      section.getSummary!({
        smtpTransportType: MailTransportType.SMTP,
        smtpAuthType: SMTPAuthenticationType.OAuth,
        isSMTPSecure: true,
      } as unknown as FormValues<GlobalConfig>),
    ).toEqual([SMTP_SUMMARY_OAUTH, SMTP_SUMMARY_TLS_REQUIRED]);

    expect(
      getSmtpAdvancedSummary(
        { smtpTransportType: MailTransportType.MicrosoftGraph },
        GLOBAL,
      ),
    ).toEqual([SMTP_SUMMARY_MICROSOFT_GRAPH]);

    /*
     * An instance that never set the switch nor a sign-in: the service sends
     * without requiring TLS, and without signing in.
     */
    expect(getSmtpAdvancedSummary({}, GLOBAL)).toEqual([
      SMTP_SUMMARY_NO_SIGN_IN,
      SMTP_SUMMARY_TLS_OPTIONAL,
    ]);
  });

  /*
   * The instance's server signs in only with both a username and a password
   * (Notification/Config.ts, MailService.createTransporter); a project config
   * is refused without them (ProjectSmtpConfigService.toEmailServer), so its
   * header keeps naming the sign-in it needs.
   */
  test("says the instance sends without signing in until both a username and a password are set", () => {
    const signIn: (values: Values) => string = (values: Values): string => {
      return getSmtpSignInSentence(values, GLOBAL);
    };

    expect(GLOBAL.sendsWithoutSignInWhenCredentialsAreBlank).toBe(true);
    expect(PROJECT.sendsWithoutSignInWhenCredentialsAreBlank).toBeUndefined();

    expect(signIn({})).toBe(SMTP_SUMMARY_NO_SIGN_IN);
    expect(signIn({ smtpUsername: "relay" })).toBe(SMTP_SUMMARY_NO_SIGN_IN);
    expect(signIn({ smtpPassword: "secret" })).toBe(SMTP_SUMMARY_NO_SIGN_IN);
    expect(signIn({ smtpUsername: "  ", smtpPassword: "secret" })).toBe(
      SMTP_SUMMARY_NO_SIGN_IN,
    );
    expect(signIn({ smtpUsername: "relay", smtpPassword: "secret" })).toBe(
      SMTP_SUMMARY_PASSWORD,
    );
    // OAuth and None say so whatever the credentials.
    expect(signIn({ smtpAuthType: SMTPAuthenticationType.OAuth })).toBe(
      SMTP_SUMMARY_OAUTH,
    );
    expect(
      signIn({
        smtpAuthType: SMTPAuthenticationType.None,
        smtpUsername: "relay",
        smtpPassword: "secret",
      }),
    ).toBe(SMTP_SUMMARY_NO_SIGN_IN);

    // A project config names the sign-in it needs, filled in or not.
    expect(getSmtpSignInSentence({}, PROJECT)).toBe(SMTP_SUMMARY_PASSWORD);
    expect(
      getSmtpSignInSentence({ username: "relay", password: "secret" }, PROJECT),
    ).toBe(SMTP_SUMMARY_PASSWORD);
  });

  test("says what Require TLS comes to on port 465, which is always encrypted", () => {
    expect(IMPLICIT_TLS_SMTP_PORT).toBe(465);

    const tls: (values: Values) => string = (values: Values): string => {
      return getSmtpTlsSentence(values, PROJECT);
    };

    // However the form holds the port.
    for (const port of [465, "465", " 465 ", new Port(465)]) {
      expect(tls({ port, secure: false })).toBe(
        SMTP_SUMMARY_TLS_PORT_465_UNCHECKED,
      );
      expect(tls({ port, secure: true })).toBe(SMTP_SUMMARY_TLS_REQUIRED);
    }

    expect(tls({ port: { _type: "Port", value: 465 }, secure: null })).toBe(
      SMTP_SUMMARY_TLS_PORT_465_UNCHECKED,
    );

    for (const port of [587, "25", undefined, null, "", "not a port"]) {
      expect(tls({ port, secure: false })).toBe(SMTP_SUMMARY_TLS_OPTIONAL);
    }

    expect(SMTP_SUMMARY_TLS_PORT_465_UNCHECKED).toBe(
      "Port 465 is always encrypted, but the certificate is not checked.",
    );

    expect(
      getSmtpAdvancedSummary(
        { smtpPort: 465, smtpUsername: "relay", smtpPassword: "secret" },
        GLOBAL,
      ),
    ).toEqual([SMTP_SUMMARY_PASSWORD, SMTP_SUMMARY_TLS_PORT_465_UNCHECKED]);
  });

  test("reads the port as a number, or none", () => {
    expect(readSmtpPort({ port: 587 }, PROJECT)).toBe(587);
    expect(readSmtpPort({ port: "2525" }, PROJECT)).toBe(2525);
    expect(readSmtpPort({ port: new Port(25) }, PROJECT)).toBe(25);
    expect(
      readSmtpPort({ smtpPort: { _type: "Port", value: 465 } }, GLOBAL),
    ).toBe(465);
    expect(readSmtpPort({}, PROJECT)).toBeNull();
    expect(readSmtpPort({ port: "" }, PROJECT)).toBeNull();
    expect(readSmtpPort({ port: "abc" }, PROJECT)).toBeNull();
  });

  test("is whole sentences, one each, never glued", () => {
    for (const sentence of [
      SMTP_SUMMARY_PASSWORD,
      SMTP_SUMMARY_OAUTH,
      SMTP_SUMMARY_NO_SIGN_IN,
      SMTP_SUMMARY_MICROSOFT_GRAPH,
      SMTP_SUMMARY_TLS_REQUIRED,
      SMTP_SUMMARY_TLS_OPTIONAL,
      SMTP_SUMMARY_TLS_PORT_465_UNCHECKED,
    ]) {
      expect(sentence).toMatch(/^[A-Z].*\.$/);
      expect(sentence).not.toContain("{{");
    }
  });
});
