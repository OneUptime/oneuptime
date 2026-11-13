// UX rule: Docs/ux/README.md#ask-only-what-you-cannot-work-out
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  FormStepFacts,
  MIN_SCANNED_FORMS,
  STEP_FIELD_LIMIT,
  StepFieldCount,
  countFieldRows,
  countStepFields,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "Please also find similar issues across the project and fix them as
 * well. The idea is to make software as simple as possible to use and
 * reduce decision paralysis." - the maintainer.
 *
 * Adding a mail server walked six steps on a project (Settings >
 * Notification Settings > Custom SMTP Configs: Basic, Transport, SMTP
 * Server, Authentication, OAuth Settings, Email) and five on the Admin
 * Dashboard's instance server (Settings > Email > Host Settings). One
 * builder makes both forms now (Common/UI/Components/SmtpConfig/
 * SmtpConfigFormFields).
 *
 * The instance's server walks two steps:
 *
 *   Server   Hostname, Port, Username, Password, and one folded Advanced
 *            section - Transport, Require TLS, Authentication Type and the
 *            OAuth fields;
 *   Sender   From Email, From Name.
 *
 * A project's config can also send through a provider's HTTP API (Amazon
 * SES, SendGrid, Mailgun, Postmark, Resend), so it asks for its provider
 * first and shows only that provider's step:
 *
 *   Provider     Name, the provider, the Description folded;
 *   Server       SMTP only: Hostname, Port, Username, Password, with
 *                Require TLS and the Authentication Type folded;
 *   OAuth        Microsoft Graph, or SMTP with OAuth: the grant and the app;
 *   Amazon SES, SendGrid, Mailgun, Postmark, Resend   the provider's key;
 *   Sender       From Email, From Name.
 *
 * This guard reads both forms the way the form guards read every form
 * (Tests/Helpers/FormStepsScan) and pins that shape, so an option that
 * drifts back open, a step that comes back, or a page that writes its own
 * SMTP fields again is caught here. The builder writes the instance's
 * fields from its column map, so the scan reads those keys as written
 * there ("columns.hostname"); what each form really gets, column by
 * column, is pinned by the builder's own tests
 * (Tests/UI/Components/SmtpConfig/SmtpConfigFormFields.test.ts).
 */

// packages/Common/Tests/UI/Components/Forms -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const BUILDER_FILE: string =
  "packages/Common/UI/Components/SmtpConfig/SmtpConfigFormFields.ts";

interface SmtpFormStep {
  id: string;
  title: string;
  // What the step shows open, then what it folds under one header.
  open: Array<string>;
  folded: Array<string>;
}

interface SmtpForm {
  name: string;
  file: string;
  label: string;
  host: string;
  // The page's calls, whitespace collapsed.
  calls: Array<string>;
  steps: Array<SmtpFormStep>;
}

// The rows a step takes: its open fields, and one for its folded header.
function rowsOf(step: SmtpFormStep): number {
  return step.open.length + (step.folded.length > 0 ? 1 : 0);
}

const PROJECT_FORM: SmtpForm = {
  name: "a project's Custom SMTP config",
  file: "packages/App/FeatureSet/Dashboard/src/Components/CustomSMTP/CustomSMTPTable.tsx",
  label: "ModelTable: Settings > Custom SMTP Config",
  host: "ModelTable",
  calls: [
    "const SMTP_CONFIG_FORM_STEPS: Array<FormStep<ProjectSmtpConfig>> = getProjectSmtpConfigFormSteps();",
    "const SMTP_CONFIG_FORM_FIELDS: Array<ModelField<ProjectSmtpConfig>> = getProjectSmtpConfigFormFields();",
    "formSteps={SMTP_CONFIG_FORM_STEPS}",
    "formFields={SMTP_CONFIG_FORM_FIELDS}",
    "createInitialValues={PROJECT_SMTP_CONFIG_CREATE_INITIAL_VALUES}",
    "return withoutValuesTransportIgnores<ProjectSmtpConfig>( item, PROJECT_SMTP_CONFIG_FORM_COLUMNS, );",
  ],
  steps: [
    {
      id: "provider",
      title: "Provider",
      open: ["name", "transportType"],
      folded: ["description"],
    },
    {
      id: "server",
      title: "Server",
      open: ["hostname", "port", "username", "password"],
      folded: ["secure", "authType"],
    },
    {
      id: "oauth",
      title: "OAuth",
      open: [
        "oauthProviderType",
        "clientId",
        "clientSecret",
        "tokenUrl",
        "scope",
      ],
      folded: [],
    },
    {
      id: "amazon-ses",
      title: "Amazon SES",
      open: [
        "amazonSesAccessKeyId",
        "amazonSesSecretAccessKey",
        "amazonSesRegion",
      ],
      folded: [],
    },
    { id: "sendgrid", title: "SendGrid", open: ["sendgridApiKey"], folded: [] },
    {
      id: "mailgun",
      title: "Mailgun",
      open: ["mailgunApiKey", "mailgunDomain", "mailgunRegion"],
      folded: [],
    },
    {
      id: "postmark",
      title: "Postmark",
      open: ["postmarkServerToken"],
      folded: [],
    },
    { id: "resend", title: "Resend", open: ["resendApiKey"], folded: [] },
    {
      id: "sender",
      title: "Sender",
      open: ["columns.fromEmail", "columns.fromName"],
      folded: [],
    },
  ],
};

const INSTANCE_FORM: SmtpForm = {
  name: "the Admin Dashboard's instance mail server",
  file: "packages/App/FeatureSet/AdminDashboard/src/Pages/Settings/Email/Index.tsx",
  label: "CardModelDetail: Host Settings",
  host: "CardModelDetail",
  calls: [
    "const SMTP_HOST_FORM_STEPS: Array<FormStep<GlobalConfig>> = getSmtpConfigFormSteps<GlobalConfig>();",
    "const SMTP_HOST_FORM_FIELDS: Array<ModelField<GlobalConfig>> = getGlobalSmtpConfigFormFields();",
    "formSteps={SMTP_HOST_FORM_STEPS}",
    "formFields={SMTP_HOST_FORM_FIELDS}",
  ],
  steps: [
    {
      id: "server",
      title: "Server",
      open: [
        "columns.hostname",
        "columns.port",
        "columns.username",
        "columns.password",
      ],
      // Everything folded on Server, as the scan reads the builder.
      folded: [
        "columns.transportType",
        "columns.secure",
        "columns.authType",
        "columns.oauthProviderType",
        "columns.clientId",
        "columns.clientSecret",
        "columns.tokenUrl",
        "columns.scope",
        "descriptionColumn",
      ],
    },
    {
      id: "sender",
      title: "Sender",
      open: ["columns.fromEmail", "columns.fromName"],
      folded: [],
    },
  ],
};

const SMTP_FORMS: Array<SmtpForm> = [PROJECT_FORM, INSTANCE_FORM];

// How the builder writes a folded section on its fields.
const FOLDED_SECTIONS: Array<string> = [
  "advancedSection",
  "providerSection",
  "serverSection",
];

/*
 * The SMTP columns each model keeps, which only the builder may write: a
 * project config's (on its own model), and the instance's (smtp-named, on
 * GlobalConfig only).
 */
const PROJECT_SMTP_COLUMNS: Array<string> = [
  "transportType",
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
];

const INSTANCE_SMTP_COLUMNS: Array<string> = [
  "smtpTransportType",
  "smtpHost",
  "smtpPort",
  "smtpUsername",
  "smtpPassword",
  "isSMTPSecure",
  "smtpAuthType",
  "smtpOAuthProviderType",
  "smtpClientId",
  "smtpClientSecret",
  "smtpTokenUrl",
  "smtpScope",
  "smtpFromEmail",
  "smtpFromName",
];

// The instance's provider columns, each provider's card on Settings > Email.
const INSTANCE_PROVIDER_COLUMNS: Array<string> = [
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

// The one card that writes each provider's settings, from the builder.
const PROVIDER_CARD_FORM: string =
  "packages/App/FeatureSet/AdminDashboard/src/Pages/Settings/Email/EmailProviderSettingsCard.tsx :: CardModelDetail #1";

const SCANNED: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files: SMTP_FORMS.map((smtpForm: SmtpForm): string => {
    return path.join(REPOSITORY_ROOT, smtpForm.file);
  }),
});

function formFor(smtpForm: SmtpForm): FormFacts {
  const found: Array<FormFacts> = SCANNED.filter((form: FormFacts) => {
    return form.file === smtpForm.file && form.label === smtpForm.label;
  });

  expect(found).toHaveLength(1);

  return found[0]!;
}

function shownOn(form: FormFacts, stepId: string): Array<FormFieldFacts> {
  return form.fields.filter((field: FormFieldFacts): boolean => {
    return field.stepId === stepId && !field.isNeverShown;
  });
}

function keysOf(fields: Array<FormFieldFacts>): Array<string> {
  return fields.map((field: FormFieldFacts): string => {
    return field.key;
  });
}

function open(fields: Array<FormFieldFacts>): Array<FormFieldFacts> {
  return fields.filter((field: FormFieldFacts): boolean => {
    return field.collapsibleSection === undefined;
  });
}

function folded(fields: Array<FormFieldFacts>): Array<FormFieldFacts> {
  return fields.filter((field: FormFieldFacts): boolean => {
    return field.collapsibleSection !== undefined;
  });
}

function dense(relativePath: string): string {
  return fs
    .readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8")
    .replace(/\s+/g, " ");
}

describe("the mail server forms ask for the provider, its settings and the sender", () => {
  test.each(SMTP_FORMS)(
    "the scan reads $name in full, through the shared builder",
    (smtpForm: SmtpForm) => {
      const form: FormFacts = formFor(smtpForm);

      expect(form.host).toBe(smtpForm.host);
      expect(form.uncountableReasons).toEqual([]);
      expect(form.hasSteps).toBe(true);

      for (const field of form.fields) {
        expect({ key: field.key, file: field.file }).toEqual({
          key: field.key,
          file: BUILDER_FILE,
        });
      }
    },
  );

  test.each(SMTP_FORMS)("$name walks its steps", (smtpForm: SmtpForm) => {
    expect(
      (formFor(smtpForm).steps || []).map(
        (step: FormStepFacts): { id: string | null; title: string } => {
          return { id: step.id, title: step.title };
        },
      ),
    ).toEqual(
      smtpForm.steps.map(
        (step: SmtpFormStep): { id: string | null; title: string } => {
          return { id: step.id, title: step.title };
        },
      ),
    );
  });

  test.each(SMTP_FORMS)(
    "$name shows on each step what it should, open and folded",
    (smtpForm: SmtpForm) => {
      for (const step of smtpForm.steps) {
        const shown: Array<FormFieldFacts> = shownOn(
          formFor(smtpForm),
          step.id,
        );

        expect({ step: step.id, open: keysOf(open(shown)) }).toEqual({
          step: step.id,
          open: step.open,
        });
        expect({ step: step.id, folded: keysOf(folded(shown)) }).toEqual({
          step: step.id,
          folded: step.folded,
        });

        // One folded section a step, its last fields.
        expect(keysOf(shown.slice(shown.length - step.folded.length))).toEqual(
          step.folded,
        );

        for (const field of folded(shown)) {
          expect(FOLDED_SECTIONS).toContain(field.collapsibleSection);
        }
      }
    },
  );

  test.each(SMTP_FORMS)(
    "$name takes the rows it should on each step, never more than the limit",
    (smtpForm: SmtpForm) => {
      const counts: Record<string, number> = {};

      for (const count of countStepFields(formFor(smtpForm))) {
        counts[count.step.id || ""] = count.count;
      }

      const expected: Record<string, number> = {};

      for (const step of smtpForm.steps) {
        expected[step.id] = rowsOf(step);
        expect(rowsOf(step)).toBeLessThanOrEqual(STEP_FIELD_LIMIT);
      }

      expect(counts).toEqual(expected);
      expect(
        countFieldRows(shownOn(formFor(smtpForm), "sender")),
      ).toBeLessThanOrEqual(STEP_FIELD_LIMIT);
    },
  );

  test("no step of either form is over the step limit", () => {
    const over: Array<string> = SMTP_FORMS.flatMap(
      (smtpForm: SmtpForm): Array<string> => {
        return countStepFields(formFor(smtpForm))
          .filter((count: StepFieldCount): boolean => {
            return count.count > STEP_FIELD_LIMIT;
          })
          .map((count: StepFieldCount): string => {
            return `${smtpForm.label} :: ${count.step.id}`;
          });
      },
    );

    expect(over).toEqual([]);
  });

  test.each(SMTP_FORMS)(
    "$name takes its steps and fields from the shared builder",
    (smtpForm: SmtpForm) => {
      const source: string = dense(smtpForm.file);

      for (const call of smtpForm.calls) {
        expect(source).toContain(call);
      }

      // Not one SMTP field written on the page itself.
      expect(source).not.toMatch(/title: "Use SSL ?\/ ?TLS"/);

      for (const choices of [
        "MailTransportType",
        "SMTPAuthenticationType",
        "OAuthProviderType",
      ]) {
        expect(source).not.toContain(`Common/Types/Email/${choices}"`);
      }
    },
  );

  test("the instance's card is an edit form that fills nothing in", () => {
    const source: string = dense(INSTANCE_FORM.file);
    const card: string = source.slice(
      source.indexOf('name="Host Settings"'),
      source.indexOf('name="Sendgrid Settings"'),
    );

    expect(card).not.toContain("initialValues");
    expect(card).toContain("isEditable={true}");
  });

  test("a new project config starts on port 587, and its test email is the row's own button", () => {
    const source: string = dense(PROJECT_FORM.file);

    expect(formFor(PROJECT_FORM).createInitialValueKeys).toEqual(["port"]);
    expect(source).toContain(
      'title: "Send Test Email", buttonStyleType: ButtonStyleType.OUTLINE, icon: IconProp.Play,',
    );
    expect(source).toMatch(
      /title: "Send Test Email",[^}]*placement: ActionButtonPlacement\.Primary,/,
    );
    expect(source).toContain("/smtp-config/test");
  });
});

describe("no other form writes a mail server's fields", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: REPOSITORY_ROOT,
    files,
  });

  test("are really read", () => {
    expect(forms.length).toBeGreaterThan(MIN_SCANNED_FORMS);
  });

  test("a project's SMTP config is created and edited only from Custom SMTP Configs", () => {
    const projectSmtpForms: Array<string> = forms
      .filter((form: FormFacts): boolean => {
        return form.modelType?.name === "ProjectSmtpConfig";
      })
      .map((form: FormFacts): string => {
        return `${form.file} :: ${form.label}`;
      });

    expect(projectSmtpForms).toEqual([
      `${PROJECT_FORM.file} :: ${PROJECT_FORM.label}`,
    ]);

    const projectFields: Array<FormFieldFacts> = forms
      .filter((form: FormFacts): boolean => {
        return form.modelType?.name === "ProjectSmtpConfig";
      })
      .flatMap((form: FormFacts): Array<FormFieldFacts> => {
        return form.fields;
      })
      .filter((field: FormFieldFacts): boolean => {
        return PROJECT_SMTP_COLUMNS.includes(field.key);
      });

    // The builder writes a project's columns by name; no page does.
    expect(
      projectFields
        .filter((field: FormFieldFacts): boolean => {
          return field.file !== BUILDER_FILE;
        })
        .map((field: FormFieldFacts): string => {
          return `${field.file}:${field.line} ${field.key}`;
        }),
    ).toEqual([]);

    // ...every one but the sender's, which it writes from its column map.
    expect(
      [
        ...new Set(
          projectFields.map((field: FormFieldFacts): string => {
            return field.key;
          }),
        ),
      ].sort(),
    ).toEqual(
      PROJECT_SMTP_COLUMNS.filter((column: string): boolean => {
        return column !== "fromEmail" && column !== "fromName";
      }).sort(),
    );
  });

  test("the instance's provider columns are written by the builder alone", () => {
    // No page writes a provider's column itself, on any form.
    const handWritten: Array<string> = forms
      .flatMap((form: FormFacts): Array<FormFieldFacts> => {
        return form.fields;
      })
      .filter((field: FormFieldFacts): boolean => {
        return (
          INSTANCE_PROVIDER_COLUMNS.includes(field.key) &&
          field.file !== BUILDER_FILE
        );
      })
      .map((field: FormFieldFacts): string => {
        return `${field.file}:${field.line} ${field.key}`;
      });

    expect(handWritten).toEqual([]);

    // Read for real: the scan reads each provider's key where the builder writes it...
    const builderKeys: Array<string> = forms
      .flatMap((form: FormFacts): Array<FormFieldFacts> => {
        return form.fields;
      })
      .filter((field: FormFieldFacts): boolean => {
        return field.file === BUILDER_FILE;
      })
      .map((field: FormFieldFacts): string => {
        return field.key;
      });

    for (const key of [
      "amazonSesAccessKeyId",
      "mailgunApiKey",
      "postmarkServerToken",
      "resendApiKey",
    ]) {
      expect({ key, read: builderKeys.includes(key) }).toEqual({
        key,
        read: true,
      });
    }

    // ...and the instance's provider card is one of the builder's forms.
    const card: Array<FormFacts> = forms.filter((form: FormFacts): boolean => {
      return `${form.file} :: ${form.label}` === PROVIDER_CARD_FORM;
    });

    expect(card).toHaveLength(1);
    expect(
      card[0]!.fields.some((field: FormFieldFacts): boolean => {
        return field.file === BUILDER_FILE;
      }),
    ).toBe(true);
  });

  test("the instance's SMTP columns are written by the builder alone", () => {
    const handWritten: Array<string> = forms
      .flatMap((form: FormFacts): Array<FormFieldFacts> => {
        return form.fields;
      })
      .filter((field: FormFieldFacts): boolean => {
        return INSTANCE_SMTP_COLUMNS.includes(field.key);
      })
      .map((field: FormFieldFacts): string => {
        return `${field.file}:${field.line} ${field.key}`;
      });

    expect(handWritten).toEqual([]);

    const instanceSmtpForms: Array<string> = forms
      .filter((form: FormFacts): boolean => {
        return form.fields.some((field: FormFieldFacts): boolean => {
          return field.file === BUILDER_FILE;
        });
      })
      .map((form: FormFacts): string => {
        return `${form.file} :: ${form.label}`;
      });

    expect(instanceSmtpForms.sort()).toEqual(
      [
        ...SMTP_FORMS.map((smtpForm: SmtpForm): string => {
          return `${smtpForm.file} :: ${smtpForm.label}`;
        }),
        PROVIDER_CARD_FORM,
      ].sort(),
    );
  });
});
