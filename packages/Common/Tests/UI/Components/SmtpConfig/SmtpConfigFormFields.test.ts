import { describe, expect, test } from "@jest/globals";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import ProjectSmtpConfig from "../../../../Models/DatabaseModels/ProjectSmtpConfig";
import MailTransportType from "../../../../Types/Email/MailTransportType";
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
  ADVANCED_FORM_SECTION_TITLE,
} from "../../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { getCreateFormColumnDefault } from "../../../../UI/Components/Forms/Utils/CreateFormDefaults";
import {
  DEFAULT_SMTP_PORT,
  GLOBAL_SMTP_CONFIG_FORM_COLUMNS,
  IMPLICIT_TLS_SMTP_PORT,
  PROJECT_SMTP_CONFIG_CREATE_INITIAL_VALUES,
  PROJECT_SMTP_CONFIG_FORM_COLUMNS,
  SMTP_FROM_EMAIL_DESCRIPTION,
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
  SMTP_SUMMARY_TLS_REQUIRED,
  SMTP_TRANSPORT_DESCRIPTION,
  SMTP_USERNAME_DESCRIPTION,
  SmtpConfigFormColumns,
  getGlobalSmtpConfigFormFields,
  getProjectSmtpConfigFormFields,
  getSmtpAdvancedSummary,
  getSmtpAuthType,
  getSmtpConfigFormSteps,
  getSmtpTransport,
  readSmtpFormValue,
  showsSmtpOAuthCredentials,
  showsSmtpOAuthProviderType,
  showsSmtpPassword,
  showsSmtpServerFields,
  showsSmtpUsername,
} from "../../../../UI/Components/SmtpConfig/SmtpConfigFormFields";

/*
 * The one builder behind both mail server forms - a project's Custom SMTP
 * config (Settings > Notification Settings) and the Admin Dashboard's
 * instance server (Settings > Email > Host Settings) - create and edit
 * alike:
 *
 *   Server   Name (a project's config), Hostname, Port, Username,
 *            Password, then one folded Advanced section: Transport,
 *            Require TLS, Authentication Type, the OAuth fields and (a
 *            project's config) the Description;
 *   Sender   From Email, From Name.
 *
 * Only the layout changed: the columns each form writes, and what each one
 * starts as, are pinned here, so an existing config keeps saving what it
 * holds.
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

const PROJECT_FIELDS: Array<Field<ProjectSmtpConfig>> =
  getProjectSmtpConfigFormFields();

const GLOBAL_FIELDS: Array<Field<GlobalConfig>> =
  getGlobalSmtpConfigFormFields();

const PROJECT: SmtpConfigFormColumns<ProjectSmtpConfig> =
  PROJECT_SMTP_CONFIG_FORM_COLUMNS;

const GLOBAL: SmtpConfigFormColumns<GlobalConfig> =
  GLOBAL_SMTP_CONFIG_FORM_COLUMNS;

describe("the steps", () => {
  test("are Server, then Sender, on both forms", () => {
    const steps: Array<FormStep<ProjectSmtpConfig>> =
      getSmtpConfigFormSteps<ProjectSmtpConfig>();

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
    expect(getSmtpConfigFormSteps<ProjectSmtpConfig>()).not.toBe(steps);
    expect(getSmtpConfigFormSteps<GlobalConfig>()).toEqual(steps);
  });

  test("every field is on one of them", () => {
    for (const fields of [
      PROJECT_FIELDS as Array<Field<unknown>>,
      GLOBAL_FIELDS as Array<Field<unknown>>,
    ]) {
      for (const field of fields) {
        expect([SMTP_SERVER_STEP_ID, SMTP_SENDER_STEP_ID]).toContain(
          field.stepId,
        );
      }
    }
  });
});

describe("a project's Custom SMTP config", () => {
  test("asks on Server for its name, the server and the sign-in", () => {
    expect(openOn(PROJECT_FIELDS, "server")).toEqual([
      "name",
      "hostname",
      "port",
      "username",
      "password",
    ]);
  });

  test("folds the transport, TLS, sign-in type, OAuth and description under Advanced", () => {
    expect(foldedOn(PROJECT_FIELDS, "server")).toEqual([
      "transportType",
      "secure",
      "authType",
      "oauthProviderType",
      "clientId",
      "clientSecret",
      "tokenUrl",
      "scope",
      "description",
    ]);
  });

  test("asks on Sender who the mail comes from", () => {
    expect(openOn(PROJECT_FIELDS, "sender")).toEqual(["fromEmail", "fromName"]);
    expect(foldedOn(PROJECT_FIELDS, "sender")).toEqual([]);
  });

  test("writes every column the old six-step form wrote, and nothing else", () => {
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
        "fromEmail",
        "fromName",
      ].sort(),
    );
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

  test("fills nothing in: 587 is only the placeholder, and TLS shows what is stored", () => {
    const port: Field<GlobalConfig> = fieldFor(GLOBAL_FIELDS, "smtpPort");

    expect(port.defaultValue).toBeUndefined();
    expect(port.placeholder).toBe("587");

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

    for (const column of Object.values(PROJECT)) {
      expect({
        column,
        isColumn: Boolean(projectModel.getTableColumnMetadata(column!)),
      }).toEqual({ column, isColumn: true });
    }

    for (const column of Object.values(GLOBAL)) {
      expect({
        column,
        isColumn: Boolean(globalModel.getTableColumnMetadata(column!)),
      }).toEqual({ column, isColumn: true });
    }

    expect(GLOBAL.configDescription).toBeUndefined();
    expect(PROJECT.configDescription).toBe("description");
  });

  test("lay the same fields out the same way, in the same words", () => {
    const describeField: (field: Field<unknown>) => Record<string, unknown> = (
      field: Field<unknown>,
    ): Record<string, unknown> => {
      return {
        title: field.title,
        description: field.description,
        placeholder: field.placeholder,
        fieldType: field.fieldType,
        required: field.required,
        stepId: field.stepId,
        folded: Boolean(field.collapsibleSection),
        defaultValue: field.defaultValue,
      };
    };

    const projectShared: Array<Record<string, unknown>> = (
      PROJECT_FIELDS as Array<Field<unknown>>
    )
      .filter((field: Field<unknown>): boolean => {
        return !["name", "description"].includes(keyOf(field));
      })
      .map(describeField);

    expect(projectShared).toEqual(
      (GLOBAL_FIELDS as Array<Field<unknown>>).map(describeField),
    );
  });

  test("fold their options into one section, folded on create and edit, after the open fields", () => {
    for (const fields of [
      PROJECT_FIELDS as Array<Field<unknown>>,
      GLOBAL_FIELDS as Array<Field<unknown>>,
    ]) {
      const folded: Array<Field<unknown>> = fields.filter(
        (field: Field<unknown>): boolean => {
          return Boolean(field.collapsibleSection);
        },
      );
      const section: FormFieldCollapsibleSection<unknown> =
        folded[0]!.collapsibleSection!;

      // One section object, handed to every folded field.
      for (const field of folded) {
        expect(field.collapsibleSection).toBe(section);
      }

      expect(section.id).toBe(ADVANCED_FORM_SECTION_ID);
      expect(section.title).toBe(ADVANCED_FORM_SECTION_TITLE);
      expect(section.openWhenConfigured).toBe(false);

      // Next to each other, at the end of the Server step.
      const firstFolded: number = fields.indexOf(folded[0]!);
      const lastFolded: number = fields.indexOf(folded[folded.length - 1]!);

      expect(lastFolded - firstFolded + 1).toBe(folded.length);
      expect(
        fields.slice(lastFolded + 1).every((field: Field<unknown>) => {
          return field.stepId === SMTP_SENDER_STEP_ID;
        }),
      ).toBe(true);
    }
  });

  test("require what the mail service cannot send without", () => {
    const required: (fields: Array<Field<unknown>>) => Array<string> = (
      fields: Array<Field<unknown>>,
    ): Array<string> => {
      return fields
        .filter((field: Field<unknown>): boolean => {
          return Boolean(field.required);
        })
        .map(keyOf);
    };

    expect(required(PROJECT_FIELDS as Array<Field<unknown>>)).toEqual([
      "name",
      "hostname",
      "port",
      "transportType",
      "authType",
      "oauthProviderType",
      "clientId",
      "clientSecret",
      "tokenUrl",
      "scope",
      "fromEmail",
      "fromName",
    ]);

    // A server that needs no password is the Authentication type's None.
    expect(fieldFor(PROJECT_FIELDS, "username").required).toBe(false);
    expect(fieldFor(PROJECT_FIELDS, "password").required).toBe(false);
  });

  test("start the dropdowns where the mail service reads an empty one", () => {
    expect(fieldFor(PROJECT_FIELDS, "transportType").defaultValue).toBe(
      MailTransportType.SMTP,
    );
    expect(fieldFor(PROJECT_FIELDS, "authType").defaultValue).toBe(
      SMTPAuthenticationType.UsernamePassword,
    );
    expect(fieldFor(PROJECT_FIELDS, "oauthProviderType").defaultValue).toBe(
      OAuthProviderType.ClientCredentials,
    );

    expect(
      (fieldFor(PROJECT_FIELDS, "transportType").dropdownOptions || []).map(
        (option: unknown) => {
          return (option as { value: unknown }).value;
        },
      ),
    ).toEqual([MailTransportType.SMTP, MailTransportType.MicrosoftGraph]);
    expect(
      (fieldFor(PROJECT_FIELDS, "authType").dropdownOptions || []).map(
        (option: unknown) => {
          return (option as { value: unknown }).value;
        },
      ),
    ).toEqual([
      SMTPAuthenticationType.UsernamePassword,
      SMTPAuthenticationType.OAuth,
      SMTPAuthenticationType.None,
    ]);
  });

  test("name the TLS switch after what it does, and the port after what the service does with 465", () => {
    expect(IMPLICIT_TLS_SMTP_PORT).toBe(465);

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
      SMTP_TRANSPORT_DESCRIPTION,
    );
    expect(fieldFor(PROJECT_FIELDS, "fromEmail").description).toBe(
      SMTP_FROM_EMAIL_DESCRIPTION,
    );
    // Not "Email used to log in to this SMTP Server": it is not.
    expect(SMTP_FROM_EMAIL_DESCRIPTION).not.toContain("log in");
    expect(fieldFor(PROJECT_FIELDS, "fromEmail").title).toBe("From Email");
    expect(fieldFor(PROJECT_FIELDS, "username").title).toBe("Username");
  });
});

describe("what each transport and sign-in shows", () => {
  const CASES: Array<{
    name: string;
    values: Values;
    project: Array<string>;
    global: Array<string>;
  }> = [
    {
      name: "SMTP with a username and password (a new config)",
      values: {},
      project: [
        "name",
        "hostname",
        "port",
        "username",
        "password",
        "transportType",
        "secure",
        "authType",
        "description",
        "fromEmail",
        "fromName",
      ],
      global: [
        "smtpHost",
        "smtpPort",
        "smtpUsername",
        "smtpPassword",
        "smtpTransportType",
        "isSMTPSecure",
        "smtpAuthType",
        "smtpFromEmail",
        "smtpFromName",
      ],
    },
    {
      name: "SMTP with OAuth: the mailbox to sign in as, no password, the OAuth app",
      values: { authType: SMTPAuthenticationType.OAuth },
      project: [
        "name",
        "hostname",
        "port",
        "username",
        "transportType",
        "secure",
        "authType",
        "oauthProviderType",
        "clientId",
        "clientSecret",
        "tokenUrl",
        "scope",
        "description",
        "fromEmail",
        "fromName",
      ],
      global: [],
    },
    {
      name: "SMTP without signing in: no username or password",
      values: { authType: SMTPAuthenticationType.None },
      project: [
        "name",
        "hostname",
        "port",
        "transportType",
        "secure",
        "authType",
        "description",
        "fromEmail",
        "fromName",
      ],
      global: [],
    },
    {
      name: "Microsoft Graph: no hostname, port, username, password or TLS - the OAuth app instead",
      values: { transportType: MailTransportType.MicrosoftGraph },
      project: [
        "name",
        "transportType",
        "clientId",
        "clientSecret",
        "tokenUrl",
        "scope",
        "description",
        "fromEmail",
        "fromName",
      ],
      global: [],
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
        "clientId",
        "clientSecret",
        "tokenUrl",
        "scope",
        "description",
        "fromEmail",
        "fromName",
      ],
      global: [],
    },
  ];

  test.each(CASES)("$name", ({ values, project }: (typeof CASES)[number]) => {
    expect(shownKeys(PROJECT_FIELDS, values)).toEqual(project);
  });

  test("the instance form shows the same, by its own columns", () => {
    for (const item of CASES) {
      const globalValues: Values = {};

      for (const [key, value] of Object.entries(item.values)) {
        globalValues[
          GLOBAL[key as keyof SmtpConfigFormColumns<GlobalConfig>] as string
        ] = value;
      }

      const expected: Array<string> = item.project
        .filter((key: string): boolean => {
          return key !== "name" && key !== "description";
        })
        .map((key: string): string => {
          return GLOBAL[
            key as keyof SmtpConfigFormColumns<GlobalConfig>
          ] as string;
        });

      expect({
        name: item.name,
        shown: shownKeys(GLOBAL_FIELDS, globalValues),
      }).toEqual({ name: item.name, shown: expected });
    }

    expect(shownKeys(GLOBAL_FIELDS, {})).toEqual(CASES[0]!.global);
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

  test("reads an empty or unknown value the way the mail service does", () => {
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
});

describe("the folded Advanced header", () => {
  const summaryOf: (values: Values) => Array<string> | undefined = (
    values: Values,
  ): Array<string> | undefined => {
    return fieldFor(PROJECT_FIELDS, "transportType").collapsibleSection!
      .getSummary!(values as unknown as FormValues<ProjectSmtpConfig>);
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

    // An instance that never set the switch: the service sends without requiring TLS.
    expect(getSmtpAdvancedSummary({}, GLOBAL)).toEqual([
      SMTP_SUMMARY_PASSWORD,
      SMTP_SUMMARY_TLS_OPTIONAL,
    ]);
  });

  test("is whole sentences, one each, never glued", () => {
    for (const sentence of [
      SMTP_SUMMARY_PASSWORD,
      SMTP_SUMMARY_OAUTH,
      SMTP_SUMMARY_NO_SIGN_IN,
      SMTP_SUMMARY_MICROSOFT_GRAPH,
      SMTP_SUMMARY_TLS_REQUIRED,
      SMTP_SUMMARY_TLS_OPTIONAL,
    ]) {
      expect(sentence).toMatch(/^[A-Z].*\.$/);
      expect(sentence).not.toContain("{{");
    }
  });
});
