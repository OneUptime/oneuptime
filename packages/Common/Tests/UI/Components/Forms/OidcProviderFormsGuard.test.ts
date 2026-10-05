import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FormFacts,
  FormFieldFacts,
  FormStepFacts,
  countFieldRows,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "Please also find similar issues across the project and fix them as
 * well. The idea is to make software as simple as possible to use and
 * reduce decision paralysis." - the maintainer.
 *
 * Adding an OpenID Connect provider walked four steps on each of its three
 * forms (Settings > OIDC, a status page's OIDC, Admin > Global OIDC) and
 * asked for eleven things: a description, both a discovery URL and an
 * issuer, the scopes and two claim names, which nearly everyone leaves at
 * their usual values. Now one builder makes all of them
 * (Common/UI/Components/Sso/OidcProviderFormFields), in two steps:
 *
 *   Provider   Name, Issuer URL, Client ID, Client Secret;
 *   Sign-in    the teams newcomers join (a project's provider), Enabled,
 *              and one folded Advanced section with everything that has an
 *              answer - the discovery URL (from the issuer), the scopes, the
 *              claim names, the description (from the name) and the Global
 *              provider's sign-up and access switches.
 *
 * This guard reads the four forms the way the form guards read every form
 * (Tests/Helpers/FormStepsScan) and pins that shape, so a field that drifts
 * back open, or a page that writes its own fields again, is caught here.
 * The scan reads the builder's conditional parts (teams, the Global
 * switches) as always present; which form gets which is pinned on the call
 * each page makes, and the builder's own tests pin what each call returns
 * (Tests/UI/Components/Sso/OidcProviderFormFields.test.ts).
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

interface OidcForm {
  file: string;
  label: string;
  host: string;
  // The builder call the page makes, whitespace collapsed.
  builderCall: string;
}

const OIDC_FORMS: Array<OidcForm> = [
  {
    file: `${DASHBOARD}/Pages/Settings/OIDC.tsx`,
    label: "ModelTable: Settings > Project OIDC",
    host: "ModelTable",
    builderCall:
      "formFields={getOidcProviderFormFields<ProjectOIDC>({ withTeams: true, getTeamsFooterElement: getSsoTeamsGrantNote, })}",
  },
  {
    file: `${DASHBOARD}/Pages/StatusPages/View/OIDC.tsx`,
    label: "ModelTable: Status Pages > Status Page View > Status Page OIDC",
    host: "ModelTable",
    builderCall: "formFields={getOidcProviderFormFields<StatusPageOIDC>()}",
  },
  {
    file: `${ADMIN_DASHBOARD}/Pages/Settings/GlobalOIDC/Index.tsx`,
    label: "ModelTable: Settings > Global OIDC",
    host: "ModelTable",
    builderCall:
      "formFields={getOidcProviderFormFields<GlobalOIDC>({ withGlobalAccessSwitches: true, })}",
  },
  {
    file: `${ADMIN_DASHBOARD}/Pages/Settings/GlobalOIDC/View.tsx`,
    label: "CardModelDetail: Global OIDC Configuration",
    host: "CardModelDetail",
    builderCall:
      "formFields={getOidcProviderFormFields<GlobalOIDC>({ withGlobalAccessSwitches: true, })}",
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
  "issuerURL",
  "clientId",
  "clientSecret",
];

/*
 * What the Sign-in step shows open, as the scan reads the builder (teams
 * only on a project's form, see builderCall).
 */
const SIGN_IN_STEP_OPEN: Array<string> = ["teams", "isEnabled"];

// Everything with an answer, folded (the last two only on the Global form).
const SIGN_IN_STEP_FOLDED: Array<string> = [
  "discoveryURL",
  "scopes",
  "emailClaimName",
  "nameClaimName",
  "description",
  "disableSignUpWithSso",
  "restrictToAttachedProjects",
];

const SCANNED: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files: OIDC_FORMS.map((form: OidcForm): string => {
    return path.join(REPOSITORY_ROOT, form.file);
  }),
});

function formFor(oidcForm: OidcForm): FormFacts {
  const found: Array<FormFacts> = SCANNED.filter((form: FormFacts) => {
    return form.file === oidcForm.file && form.label === oidcForm.label;
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

describe("the OIDC provider forms ask for the issuer, client ID and secret; the rest is filled in", () => {
  test.each(OIDC_FORMS)(
    "the scan reads $label in full, through the shared builder",
    (oidcForm: OidcForm) => {
      const form: FormFacts = formFor(oidcForm);

      expect(form.host).toBe(oidcForm.host);
      expect(form.uncountableReasons).toEqual([]);
      expect(form.hasSteps).toBe(true);

      for (const field of form.fields) {
        expect({
          key: field.key,
          file: field.file,
        }).toEqual({
          key: field.key,
          file: expect.stringMatching(
            /^packages\/Common\/UI\/Components\/Sso\/(Oidc|Sso)ProviderFormFields\.ts$/,
          ),
        });
      }
    },
  );

  test.each(OIDC_FORMS)(
    "$label walks Provider, then Sign-in",
    (oidcForm: OidcForm) => {
      expect(
        (formFor(oidcForm).steps || []).map(
          (step: FormStepFacts): { id: string | null; title: string } => {
            return { id: step.id, title: step.title };
          },
        ),
      ).toEqual([PROVIDER_STEP, SIGN_IN_STEP]);
    },
  );

  test.each(OIDC_FORMS)(
    "$label opens on the provider's name, issuer, client ID and secret",
    (oidcForm: OidcForm) => {
      const shown: Array<FormFieldFacts> = shownOn(
        formFor(oidcForm),
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

  test.each(OIDC_FORMS)(
    "$label folds everything with an answer under one Advanced section, last on Sign-in",
    (oidcForm: OidcForm) => {
      const shown: Array<FormFieldFacts> = shownOn(
        formFor(oidcForm),
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

  test.each(OIDC_FORMS)(
    "$label has no step of a single row",
    (oidcForm: OidcForm) => {
      const form: FormFacts = formFor(oidcForm);

      for (const step of [PROVIDER_STEP, SIGN_IN_STEP]) {
        expect({
          step: step.id,
          rows: countFieldRows(shownOn(form, step.id)) > 1,
        }).toEqual({ step: step.id, rows: true });
      }
    },
  );

  test.each(OIDC_FORMS)(
    "$label takes its steps and fields from the shared builder, with its own options",
    (oidcForm: OidcForm) => {
      const source: string = dense(oidcForm.file);

      /*
       * "the scan reads ... through the shared builder" above already holds
       * every field of the form to the builder's files.
       */
      expect(source).toContain(oidcForm.builderCall);
      expect(source).toMatch(/formSteps=\{getSsoProviderFormSteps<\w+>\(\)\}/);
    },
  );

  test("only a project's provider asks which teams newcomers join, and only the Global form has its switches", () => {
    const calls: Array<string> = OIDC_FORMS.map((oidcForm: OidcForm) => {
      return oidcForm.builderCall;
    });

    expect(
      calls.filter((call: string): boolean => {
        return call.includes("withTeams: true");
      }),
    ).toEqual([OIDC_FORMS[0]!.builderCall]);

    expect(
      calls.filter((call: string): boolean => {
        return call.includes("withGlobalAccessSwitches: true");
      }),
    ).toEqual([OIDC_FORMS[2]!.builderCall, OIDC_FORMS[3]!.builderCall]);
  });

  test("the project's form starts on the members team", () => {
    const source: string = dense(OIDC_FORMS[0]!.file);

    expect(source).toContain(
      "const createInitialValues: FormValues<ProjectOIDC> | undefined = useDefaultSsoTeamsInitialValues<ProjectOIDC>();",
    );
    expect(source).toContain("createInitialValues={createInitialValues}");
  });

  /*
   * People who sign in with it join its teams, so the server saves it only
   * with teams the person saving it could invite someone to; the form names
   * a picked team beyond that under Teams (SsoTeamsGrantNote).
   */
  test("only the project's form names the picked teams the person could not invite someone to", () => {
    expect(
      OIDC_FORMS.filter((oidcForm: OidcForm): boolean => {
        return oidcForm.builderCall.includes(
          "getTeamsFooterElement: getSsoTeamsGrantNote",
        );
      }),
    ).toEqual([OIDC_FORMS[0]]);
    expect(dense(OIDC_FORMS[0]!.file)).toContain(
      'import { getSsoTeamsGrantNote } from "../../Components/Sso/SsoTeamsGrantNote";',
    );
  });

  test.each(OIDC_FORMS.slice(0, 3))(
    "$label opens what comes next once a provider is added",
    (oidcForm: OidcForm) => {
      const source: string = dense(oidcForm.file);

      expect(source).toMatch(
        /onCreateSuccess=\{\( item: \w+, modalType\?: ModalType, \): Promise<\w+> => \{ if \(modalType === ModalType\.Create && item\._id\) \{/,
      );
    },
  );
});
