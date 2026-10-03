import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FormFacts,
  FormFieldFacts,
  FormStepFacts,
  countFieldRows,
  countFormRows,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "Please also find similar issues across the project and fix them as
 * well. The idea is to make software as simple as possible to use and
 * reduce decision paralysis." - the maintainer.
 *
 * Adding a SAML provider walked four steps on each of its three forms
 * (Settings > SSO, a status page's SSO, Admin > Global SSO): Basic Info,
 * Sign On, Certificate and More. It asked for a description, required, and
 * for a signature method and a digest method - two required dropdowns with
 * nothing picked, whose help said to leave them at RSA-SHA256 and SHA256.
 * The status page's More step held one switch, and a project's provider
 * could not be saved before someone chose its teams. Now one builder makes
 * all of them (Common/UI/Components/Sso/SamlProviderFormFields), in the two
 * steps every single sign-on provider form walks - OIDC's included:
 *
 *   Provider   Name, Sign On URL, Issuer, Public Certificate;
 *   Sign-in    the teams newcomers join (a project's provider, starting on
 *              the members team), Enabled, and one folded Advanced section
 *              with everything that has an answer - the signature and digest
 *              methods, the description (from the name) and the Global
 *              provider's sign-up and access switches.
 *
 * This guard reads the four forms the way the form guards read every form
 * (Tests/Helpers/FormStepsScan) and pins that shape, so a field that drifts
 * back open, or a page that writes its own fields again, is caught here.
 * The scan reads the builder's conditional parts (teams, the Global
 * switches) as always present; which form gets which is pinned on the call
 * each page makes, and the builder's own tests pin what each call returns
 * (Tests/UI/Components/Sso/SamlProviderFormFields.test.ts).
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

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";
const ADMIN_DASHBOARD: string = "packages/App/FeatureSet/AdminDashboard/src";

interface SamlForm {
  file: string;
  label: string;
  host: string;
  // The builder call the page makes, whitespace collapsed.
  builderCall: string;
}

const SAML_FORMS: Array<SamlForm> = [
  {
    file: `${DASHBOARD}/Pages/Settings/SSO.tsx`,
    label: "ModelTable: Settings > Project SSO",
    host: "ModelTable",
    builderCall:
      "formFields={getSamlProviderFormFields<ProjectSSO>({ withTeams: true, })}",
  },
  {
    file: `${DASHBOARD}/Pages/StatusPages/View/SSO.tsx`,
    label: "ModelTable: Status Pages > Status Page View > Project SSO",
    host: "ModelTable",
    builderCall: "formFields={getSamlProviderFormFields<StatusPageSSO>()}",
  },
  {
    file: `${ADMIN_DASHBOARD}/Pages/Settings/GlobalSSO/Index.tsx`,
    label: "ModelTable: Settings > Global SSO",
    host: "ModelTable",
    builderCall:
      "formFields={getSamlProviderFormFields<GlobalSSO>({ withGlobalAccessSwitches: true, })}",
  },
  {
    file: `${ADMIN_DASHBOARD}/Pages/Settings/GlobalSSO/View.tsx`,
    label: "CardModelDetail: Global SSO Configuration",
    host: "CardModelDetail",
    builderCall:
      "formFields={getSamlProviderFormFields<GlobalSSO>({ withGlobalAccessSwitches: true, })}",
  },
];

// How the builder writes the Advanced section on its folded fields.
const ADVANCED_SECTION: string = "advancedSection";

const PROVIDER_STEP: { id: string; title: string } = {
  id: "provider",
  title: "Provider",
};

const SIGN_IN_STEP: { id: string; title: string } = {
  id: "sign-in",
  title: "Sign-in",
};

// What the Provider step shows: what the identity provider gives you.
const PROVIDER_STEP_OPEN: Array<string> = [
  "name",
  "signOnURL",
  "issuerURL",
  "publicCertificate",
];

/*
 * What the Sign-in step shows open, as the scan reads the builder (teams
 * only on a project's form, see builderCall).
 */
const SIGN_IN_STEP_OPEN: Array<string> = ["teams", "isEnabled"];

// Everything with an answer, folded (the last two only on the Global form).
const SIGN_IN_STEP_FOLDED: Array<string> = [
  "signatureMethod",
  "digestMethod",
  "description",
  "disableSignUpWithSso",
  "restrictToAttachedProjects",
];

// What the four forms asked for, and how, before (none of it may come back).
const RETIRED_STEP_IDS: Array<string> = [
  "basic",
  "sign-on",
  "certificate",
  "more",
];

const SCANNED: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files: SAML_FORMS.map((form: SamlForm): string => {
    return path.join(REPOSITORY_ROOT, form.file);
  }),
});

function formFor(samlForm: SamlForm): FormFacts {
  const found: Array<FormFacts> = SCANNED.filter((form: FormFacts) => {
    return form.file === samlForm.file && form.label === samlForm.label;
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

function dense(relativePath: string): string {
  return fs
    .readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8")
    .replace(/\s+/g, " ");
}

describe("the SAML provider forms ask only for what the identity provider gives; the rest is filled in", () => {
  test.each(SAML_FORMS)(
    "the scan reads $label in full, through the shared builder",
    (samlForm: SamlForm) => {
      const form: FormFacts = formFor(samlForm);

      expect(form.host).toBe(samlForm.host);
      expect(form.uncountableReasons).toEqual([]);
      expect(form.hasSteps).toBe(true);

      for (const field of form.fields) {
        expect({
          key: field.key,
          file: field.file,
        }).toEqual({
          key: field.key,
          file: expect.stringMatching(
            /^packages\/Common\/UI\/Components\/Sso\/(Saml|Sso)ProviderFormFields\.ts$/,
          ),
        });
      }
    },
  );

  test.each(SAML_FORMS)(
    "$label walks Provider, then Sign-in",
    (samlForm: SamlForm) => {
      expect(
        (formFor(samlForm).steps || []).map(
          (step: FormStepFacts): { id: string | null; title: string } => {
            return { id: step.id, title: step.title };
          },
        ),
      ).toEqual([PROVIDER_STEP, SIGN_IN_STEP]);
    },
  );

  test.each(SAML_FORMS)(
    "$label opens on the provider's name, sign-on URL, issuer and certificate",
    (samlForm: SamlForm) => {
      const shown: Array<FormFieldFacts> = shownOn(
        formFor(samlForm),
        PROVIDER_STEP.id,
      );

      expect(keysOf(shown)).toEqual(PROVIDER_STEP_OPEN);

      for (const field of shown) {
        expect({ key: field.key, folded: field.collapsibleSection }).toEqual({
          key: field.key,
          folded: undefined,
        });
      }
    },
  );

  test.each(SAML_FORMS)(
    "$label folds everything with an answer under one Advanced section, last on Sign-in",
    (samlForm: SamlForm) => {
      const shown: Array<FormFieldFacts> = shownOn(
        formFor(samlForm),
        SIGN_IN_STEP.id,
      );

      const open: Array<FormFieldFacts> = shown.filter(
        (field: FormFieldFacts): boolean => {
          return field.collapsibleSection === undefined;
        },
      );
      const folded: Array<FormFieldFacts> = shown.filter(
        (field: FormFieldFacts): boolean => {
          return field.collapsibleSection !== undefined;
        },
      );

      expect(keysOf(open)).toEqual(SIGN_IN_STEP_OPEN);
      expect(keysOf(folded)).toEqual(SIGN_IN_STEP_FOLDED);

      // One section, the step's last fields, built once and shared.
      expect(keysOf(shown.slice(shown.length - folded.length))).toEqual(
        keysOf(folded),
      );

      for (const field of folded) {
        expect(`${field.key}: ${field.collapsibleSection}`).toBe(
          `${field.key}: ${ADVANCED_SECTION}`,
        );
      }
    },
  );

  test.each(SAML_FORMS)(
    "$label starts the signature and digest methods where the services fill them in",
    (samlForm: SamlForm) => {
      const form: FormFacts = formFor(samlForm);

      for (const [key, defaultValue] of [
        ["signatureMethod", "DEFAULT_SAML_SIGNATURE_METHOD"],
        ["digestMethod", "DEFAULT_SAML_DIGEST_METHOD"],
      ] as Array<[string, string]>) {
        const field: FormFieldFacts | undefined = form.fields.find(
          (candidate: FormFieldFacts): boolean => {
            return candidate.key === key;
          },
        );

        expect({ key, defaultValue: field?.defaultValue }).toEqual({
          key,
          defaultValue,
        });
      }
    },
  );

  test.each(SAML_FORMS)(
    "$label has no step of a single row, and no more rows than a dialog holds",
    (samlForm: SamlForm) => {
      const form: FormFacts = formFor(samlForm);

      for (const step of [PROVIDER_STEP, SIGN_IN_STEP]) {
        expect({
          step: step.id,
          rows: countFieldRows(shownOn(form, step.id)) > 1,
        }).toEqual({ step: step.id, rows: true });
      }

      /*
       * Four on Provider; Sign-in is Teams, Enabled and one Advanced
       * header - eight rows were spread over four steps before.
       */
      expect(countFieldRows(shownOn(form, PROVIDER_STEP.id))).toBe(4);
      expect(countFieldRows(shownOn(form, SIGN_IN_STEP.id))).toBe(3);
      expect(countFormRows(form)).toBe(7);
    },
  );

  test.each(SAML_FORMS)(
    "$label takes its steps and fields from the shared builders, with its own options",
    (samlForm: SamlForm) => {
      const source: string = dense(samlForm.file);

      /*
       * "the scan reads ... through the shared builder" above already holds
       * every field of the form to the builder's files.
       */
      expect(source).toContain(samlForm.builderCall);
      expect(source).toMatch(/formSteps=\{getSsoProviderFormSteps<\w+>\(\)\}/);
    },
  );

  test.each(SAML_FORMS)(
    "$label no longer writes the old four steps or the old help",
    (samlForm: SamlForm) => {
      const source: string = dense(samlForm.file);

      for (const stepId of RETIRED_STEP_IDS) {
        expect({ stepId, written: source.includes(`id: "${stepId}"`) }).toEqual(
          { stepId, written: false },
        );
      }

      expect(source).not.toContain("If you do not know what this is");
      expect(source).not.toContain("DropdownUtil.getDropdownOptionsFromEnum");
    },
  );

  test("only a project's provider asks which teams newcomers join, and only the Global form has its switches", () => {
    const calls: Array<string> = SAML_FORMS.map((samlForm: SamlForm) => {
      return samlForm.builderCall;
    });

    expect(
      calls.filter((call: string): boolean => {
        return call.includes("withTeams: true");
      }),
    ).toEqual([SAML_FORMS[0]!.builderCall]);

    expect(
      calls.filter((call: string): boolean => {
        return call.includes("withGlobalAccessSwitches: true");
      }),
    ).toEqual([SAML_FORMS[2]!.builderCall, SAML_FORMS[3]!.builderCall]);
  });

  test("the project's form starts on the members team", () => {
    const source: string = dense(SAML_FORMS[0]!.file);

    expect(source).toContain(
      "const createInitialValues: FormValues<ProjectSSO> | undefined = useDefaultSsoTeamsInitialValues<ProjectSSO>();",
    );
    expect(source).toContain("createInitialValues={createInitialValues}");
  });

  test.each(SAML_FORMS.slice(0, 3))(
    "$label opens what comes next once a provider is added",
    (samlForm: SamlForm) => {
      const source: string = dense(samlForm.file);

      expect(source).toMatch(
        /onCreateSuccess=\{\( item: \w+, modalType\?: ModalType, \): Promise<\w+> => \{ if \(modalType === ModalType\.Create && item\._id\) \{/,
      );
    },
  );

  test("the two dashboard pages say so in the dialog while the provider is off", () => {
    for (const samlForm of SAML_FORMS.slice(0, 2)) {
      const source: string = dense(samlForm.file);

      expect(source).toContain('data-testid="sso-config-turn-on-note"');
      expect(source).toContain("{!samlConfigTarget?.isEnabled && (");
    }
  });
});
