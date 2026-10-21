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
 * Dashboard's instance server (Settings > Email > Host Settings). The
 * Transport step held one dropdown, already on SMTP; "Use SSL / TLS" was
 * asked although the mail service decides TLS on port 465 by itself. Now
 * one builder makes both forms (Common/UI/Components/SmtpConfig/
 * SmtpConfigFormFields), in two steps:
 *
 *   Server   Name (a project's config), Hostname, Port, Username,
 *            Password, and one folded Advanced section - Transport,
 *            Require TLS, Authentication Type, the OAuth fields and the
 *            Description;
 *   Sender   From Email, From Name.
 *
 * This guard reads both forms the way the form guards read every form
 * (Tests/Helpers/FormStepsScan) and pins that shape, so an option that
 * drifts back open, a step that comes back, or a page that writes its own
 * SMTP fields again is caught here. The builder writes each field's column
 * from the surface's column map, so the scan reads the keys as written
 * there ("columns.hostname"), and it reads the project-only Description as
 * present on both forms; what each form really gets, column by column, is
 * pinned by the builder's own tests
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

interface SmtpForm {
  name: string;
  file: string;
  label: string;
  host: string;
  // The page's calls, whitespace collapsed.
  calls: Array<string>;
  // What the Server step shows open.
  serverOpen: Array<string>;
  // The rows the Server step takes: its open fields and the folded header.
  serverRows: number;
}

const PROJECT_FORM: SmtpForm = {
  name: "a project's Custom SMTP config",
  file: "packages/App/FeatureSet/Dashboard/src/Components/CustomSMTP/CustomSMTPTable.tsx",
  label: "ModelTable: Settings > Custom SMTP Config",
  host: "ModelTable",
  calls: [
    "const SMTP_CONFIG_FORM_STEPS: Array<FormStep<ProjectSmtpConfig>> = getSmtpConfigFormSteps<ProjectSmtpConfig>();",
    "const SMTP_CONFIG_FORM_FIELDS: Array<ModelField<ProjectSmtpConfig>> = getProjectSmtpConfigFormFields();",
    "formSteps={SMTP_CONFIG_FORM_STEPS}",
    "formFields={SMTP_CONFIG_FORM_FIELDS}",
    "createInitialValues={PROJECT_SMTP_CONFIG_CREATE_INITIAL_VALUES}",
    "return withoutValuesGraphIgnores<ProjectSmtpConfig>( item, PROJECT_SMTP_CONFIG_FORM_COLUMNS, );",
  ],
  serverOpen: [
    "name",
    "columns.hostname",
    "columns.port",
    "columns.username",
    "columns.password",
  ],
  // Listed in OverloadedFormStepsGuard's LONG_STEPS_ALLOWED, with the reason.
  serverRows: 6,
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
  serverOpen: [
    "columns.hostname",
    "columns.port",
    "columns.username",
    "columns.password",
  ],
  serverRows: 5,
};

const SMTP_FORMS: Array<SmtpForm> = [PROJECT_FORM, INSTANCE_FORM];

const STEPS: Array<{ id: string | null; title: string }> = [
  { id: "server", title: "Server" },
  { id: "sender", title: "Sender" },
];

// How the builder writes the Advanced section on its folded fields.
const ADVANCED_SECTION: string = "advancedSection";

// Everything folded on Server, as the scan reads the builder.
const SERVER_FOLDED: Array<string> = [
  "columns.transportType",
  "columns.secure",
  "columns.authType",
  "columns.oauthProviderType",
  "columns.clientId",
  "columns.clientSecret",
  "columns.tokenUrl",
  "columns.scope",
  "descriptionColumn",
];

const SENDER_OPEN: Array<string> = ["columns.fromEmail", "columns.fromName"];

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

describe("the mail server forms ask for the server, the sign-in and the sender", () => {
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

  test.each(SMTP_FORMS)(
    "$name walks Server, then Sender",
    (smtpForm: SmtpForm) => {
      expect(
        (formFor(smtpForm).steps || []).map(
          (step: FormStepFacts): { id: string | null; title: string } => {
            return { id: step.id, title: step.title };
          },
        ),
      ).toEqual(STEPS);
    },
  );

  test.each(SMTP_FORMS)(
    "$name opens on the server and its sign-in",
    (smtpForm: SmtpForm) => {
      const server: Array<FormFieldFacts> = shownOn(
        formFor(smtpForm),
        "server",
      );

      expect(keysOf(open(server))).toEqual(smtpForm.serverOpen);
    },
  );

  test.each(SMTP_FORMS)(
    "$name folds the transport, TLS, sign-in type, OAuth and description into one Advanced section, last on Server",
    (smtpForm: SmtpForm) => {
      const server: Array<FormFieldFacts> = shownOn(
        formFor(smtpForm),
        "server",
      );

      expect(keysOf(folded(server))).toEqual(SERVER_FOLDED);

      // One section, the step's last fields, built once and shared.
      expect(
        keysOf(server.slice(server.length - SERVER_FOLDED.length)),
      ).toEqual(SERVER_FOLDED);

      for (const field of folded(server)) {
        expect(`${field.key}: ${field.collapsibleSection}`).toBe(
          `${field.key}: ${ADVANCED_SECTION}`,
        );
      }
    },
  );

  test.each(SMTP_FORMS)(
    "$name asks on Sender who the mail comes from, and nothing else",
    (smtpForm: SmtpForm) => {
      const sender: Array<FormFieldFacts> = shownOn(
        formFor(smtpForm),
        "sender",
      );

      expect(keysOf(sender)).toEqual(SENDER_OPEN);
      expect(folded(sender)).toEqual([]);
    },
  );

  test.each(SMTP_FORMS)(
    "$name takes the rows it should on each step",
    (smtpForm: SmtpForm) => {
      const counts: Record<string, number> = {};

      for (const count of countStepFields(formFor(smtpForm))) {
        counts[count.step.id || ""] = count.count;
      }

      expect(counts).toEqual({ server: smtpForm.serverRows, sender: 2 });
      expect(
        countFieldRows(shownOn(formFor(smtpForm), "sender")),
      ).toBeLessThanOrEqual(STEP_FIELD_LIMIT);
    },
  );

  test("only the project's Server step is over the step limit, by its name", () => {
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

    expect(over).toEqual([`${PROJECT_FORM.label} :: server`]);
    expect(PROJECT_FORM.serverRows - INSTANCE_FORM.serverRows).toBe(1);
    expect(PROJECT_FORM.serverOpen[0]).toBe("name");
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

    const handWritten: Array<string> = forms
      .filter((form: FormFacts): boolean => {
        return form.modelType?.name === "ProjectSmtpConfig";
      })
      .flatMap((form: FormFacts): Array<FormFieldFacts> => {
        return form.fields;
      })
      .filter((field: FormFieldFacts): boolean => {
        return PROJECT_SMTP_COLUMNS.includes(field.key);
      })
      .map((field: FormFieldFacts): string => {
        return `${field.file}:${field.line} ${field.key}`;
      });

    expect(handWritten).toEqual([]);
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
      SMTP_FORMS.map((smtpForm: SmtpForm): string => {
        return `${smtpForm.file} :: ${smtpForm.label}`;
      }).sort(),
    );
  });
});
