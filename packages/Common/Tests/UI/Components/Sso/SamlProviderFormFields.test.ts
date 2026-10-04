import { afterEach, describe, expect, jest, test } from "@jest/globals";
import GlobalSSO from "../../../../Models/DatabaseModels/GlobalSso";
import ProjectSSO from "../../../../Models/DatabaseModels/ProjectSso";
import StatusPageSSO from "../../../../Models/DatabaseModels/StatusPageSso";
import Team from "../../../../Models/DatabaseModels/Team";
import DigestMethod from "../../../../Types/SSO/DigestMethod";
import {
  DEFAULT_SAML_DIGEST_METHOD,
  DEFAULT_SAML_SIGNATURE_METHOD,
} from "../../../../Types/SSO/SamlProviderDefaults";
import SignatureMethod from "../../../../Types/SSO/SignatureMethod";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import Field, {
  FormFieldCollapsibleSection,
} from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import {
  MORE_FIELDS_SECTION_TITLE,
  isFormSectionConfigured,
} from "../../../../UI/Components/Forms/Utils/AdvancedFormSection";
import {
  GLOBAL_OIDC_ADVANCED_DEFAULTS_SUMMARY,
  GLOBAL_OIDC_DISABLE_SIGN_UP_DESCRIPTION,
  GLOBAL_OIDC_RESTRICT_DESCRIPTION,
  getOidcProviderFormFields,
} from "../../../../UI/Components/Sso/OidcProviderFormFields";
import {
  SAML_ADVANCED_DEFAULTS_SUMMARY,
  SAML_DIGEST_METHOD_DESCRIPTION,
  SAML_DIGEST_METHOD_OPTIONS,
  SAML_ISSUER_DESCRIPTION,
  SAML_PUBLIC_CERTIFICATE_DESCRIPTION,
  SAML_SIGNATURE_METHOD_DESCRIPTION,
  SAML_SIGNATURE_METHOD_OPTIONS,
  SAML_SIGN_ON_URL_DESCRIPTION,
  getSamlAdvancedSection,
  getSamlProviderFormFields,
  isSamlAdvancedAtDefaults,
} from "../../../../UI/Components/Sso/SamlProviderFormFields";
import {
  SSO_GLOBAL_ADVANCED_DEFAULTS_SUMMARY,
  SSO_GLOBAL_DISABLE_SIGN_UP_DESCRIPTION,
  SSO_GLOBAL_RESTRICT_DESCRIPTION,
  isSsoGlobalAccessAtDefaults,
} from "../../../../UI/Components/Sso/SsoProviderFormFields";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * The one builder behind the three SAML provider forms (Settings > SSO, a
 * status page's SSO, Admin > Global SSO), create and edit alike:
 *
 *   Provider   Name, Sign On URL, Issuer, Public Certificate;
 *   Sign-in    Teams (a project's provider), Enabled, then one folded
 *              Advanced section - the signature method, the digest method,
 *              the description and (Global) the sign-up and access switches.
 *
 * What it fills in is what the services fill in for an API caller
 * (Types/SSO/SamlProviderDefaults), and the Global switches are the very
 * fields the OIDC builder uses (SsoProviderFormFields).
 */

type Values = FormValues<ProjectSSO>;

function keyOf<TEntity>(field: Field<TEntity>): string {
  return Object.keys(field.field || {})[0] || "";
}

function keysOn<TEntity>(
  fields: Array<Field<TEntity>>,
  stepId: string,
): Array<string> {
  return fields
    .filter((field: Field<TEntity>): boolean => {
      return field.stepId === stepId;
    })
    .map(keyOf);
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

function valuesOf(values: Record<string, unknown>): Values {
  return values as unknown as Values;
}

function optionValues(
  options: Array<DropdownOption> | undefined,
): Array<unknown> {
  return (options || []).map((option: DropdownOption): unknown => {
    return option.value;
  });
}

const PROJECT_FIELDS: Array<Field<ProjectSSO>> =
  getSamlProviderFormFields<ProjectSSO>({ withTeams: true });
const STATUS_PAGE_FIELDS: Array<Field<StatusPageSSO>> =
  getSamlProviderFormFields<StatusPageSSO>();
const GLOBAL_FIELDS: Array<Field<GlobalSSO>> =
  getSamlProviderFormFields<GlobalSSO>({ withGlobalAccessSwitches: true });

const ALL_FORMS: Array<Array<Field<unknown>>> = [
  PROJECT_FIELDS,
  STATUS_PAGE_FIELDS,
  GLOBAL_FIELDS,
] as Array<Array<Field<unknown>>>;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the fields each form gets", () => {
  test("a project's provider: what the identity provider gives, then the teams newcomers join, Enabled and Advanced", () => {
    expect(keysOn(PROJECT_FIELDS, "provider")).toEqual([
      "name",
      "signOnURL",
      "issuerURL",
      "publicCertificate",
    ]);
    expect(keysOn(PROJECT_FIELDS, "sign-in")).toEqual([
      "teams",
      "isEnabled",
      "signatureMethod",
      "digestMethod",
      "description",
    ]);
  });

  test("a status page's provider: no teams", () => {
    expect(keysOn(STATUS_PAGE_FIELDS, "provider")).toEqual([
      "name",
      "signOnURL",
      "issuerURL",
      "publicCertificate",
    ]);
    expect(keysOn(STATUS_PAGE_FIELDS, "sign-in")).toEqual([
      "isEnabled",
      "signatureMethod",
      "digestMethod",
      "description",
    ]);
  });

  test("the instance-wide provider: no teams, and its two switches folded at the end", () => {
    expect(keysOn(GLOBAL_FIELDS, "provider")).toEqual([
      "name",
      "signOnURL",
      "issuerURL",
      "publicCertificate",
    ]);
    expect(keysOn(GLOBAL_FIELDS, "sign-in")).toEqual([
      "isEnabled",
      "signatureMethod",
      "digestMethod",
      "description",
      "disableSignUpWithSso",
      "restrictToAttachedProjects",
    ]);
  });

  test("every field is on one of the two steps every provider form walks", () => {
    for (const fields of ALL_FORMS) {
      for (const field of fields) {
        expect([keyOf(field), field.stepId]).toEqual([
          keyOf(field),
          expect.stringMatching(/^(provider|sign-in)$/),
        ]);
      }
    }
  });

  test("everything after Enabled is folded under one Advanced section, built once", () => {
    for (const fields of ALL_FORMS) {
      const enabledAt: number = fields.findIndex(
        (field: Field<unknown>): boolean => {
          return keyOf(field) === "isEnabled";
        },
      );
      const open: Array<Field<unknown>> = fields.slice(0, enabledAt + 1);
      const folded: Array<Field<unknown>> = fields.slice(enabledAt + 1);

      expect(folded.length).toBeGreaterThanOrEqual(3);

      for (const field of open) {
        expect([keyOf(field), field.collapsibleSection]).toEqual([
          keyOf(field),
          undefined,
        ]);
      }

      const section: FormFieldCollapsibleSection<unknown> | undefined =
        folded[0]!.collapsibleSection;

      expect(section?.title).toBe(MORE_FIELDS_SECTION_TITLE);
      // Folded on Edit too, saying "Configured" instead of opening.
      expect(section?.openWhenConfigured).toBe(false);

      for (const field of folded) {
        expect([keyOf(field), field.collapsibleSection]).toEqual([
          keyOf(field),
          section,
        ]);
      }
    }
  });

  test("each form gets its own Advanced section", () => {
    expect(
      fieldFor(PROJECT_FIELDS, "signatureMethod").collapsibleSection,
    ).not.toBe(
      fieldFor(STATUS_PAGE_FIELDS, "signatureMethod").collapsibleSection,
    );
    expect(
      fieldFor(
        getSamlProviderFormFields<ProjectSSO>({ withTeams: true }),
        "description",
      ).collapsibleSection,
    ).not.toBe(fieldFor(PROJECT_FIELDS, "description").collapsibleSection);
  });

  test("asks for the four things the identity provider gives, and requires them", () => {
    for (const fields of ALL_FORMS) {
      for (const key of [
        "name",
        "signOnURL",
        "issuerURL",
        "publicCertificate",
      ]) {
        expect([key, fieldFor(fields, key).required]).toEqual([key, true]);
      }
    }

    const signOn: Field<ProjectSSO> = fieldFor(PROJECT_FIELDS, "signOnURL");
    const issuer: Field<ProjectSSO> = fieldFor(PROJECT_FIELDS, "issuerURL");
    const certificate: Field<ProjectSSO> = fieldFor(
      PROJECT_FIELDS,
      "publicCertificate",
    );

    expect(fieldFor(PROJECT_FIELDS, "name").title).toBe("Name");
    expect([signOn.title, signOn.fieldType]).toEqual([
      "Sign On URL",
      FormFieldSchemaType.URL,
    ]);
    expect([issuer.title, issuer.fieldType]).toEqual([
      "Issuer",
      FormFieldSchemaType.Text,
    ]);
    expect([certificate.title, certificate.fieldType]).toEqual([
      "Public Certificate",
      FormFieldSchemaType.LongText,
    ]);

    // URLs and a certificate are not prose.
    for (const field of [signOn, issuer, certificate]) {
      expect(field.disableSpellCheck).toBe(true);
    }
  });

  test("says in plain words what each of them is", () => {
    expect(fieldFor(PROJECT_FIELDS, "signOnURL").description).toBe(
      SAML_SIGN_ON_URL_DESCRIPTION,
    );
    expect(fieldFor(PROJECT_FIELDS, "issuerURL").description).toBe(
      SAML_ISSUER_DESCRIPTION,
    );
    expect(fieldFor(PROJECT_FIELDS, "publicCertificate").description).toBe(
      SAML_PUBLIC_CERTIFICATE_DESCRIPTION,
    );

    expect(SAML_SIGN_ON_URL_DESCRIPTION).toBe(
      "Your identity provider's single sign-on URL. OneUptime sends people there to sign in.",
    );
    expect(SAML_ISSUER_DESCRIPTION).toBe(
      "Your identity provider's issuer (its entity ID), exactly as the provider shows it.",
    );
    expect(SAML_PUBLIC_CERTIFICATE_DESCRIPTION).toBe(
      "The X.509 certificate your identity provider signs with, including its BEGIN CERTIFICATE and END CERTIFICATE lines.",
    );
  });

  test("teams pick from the project's teams, are required, and say what they are for", () => {
    const teams: Field<ProjectSSO> = fieldFor(PROJECT_FIELDS, "teams");

    expect(teams.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(teams.dropdownModal).toEqual({
      type: Team,
      labelField: "name",
      valueField: "_id",
    });
    expect(teams.required).toBe(true);
    expect(teams.description).toBe(
      "Add users to these teams when they sign up.",
    );
  });

  test("Enabled is the switch every provider form has: off, as its column, until the identity provider knows OneUptime", () => {
    const enabled: Field<ProjectSSO> = fieldFor(PROJECT_FIELDS, "isEnabled");
    const oidcEnabled: Field<ProjectSSO> = fieldFor(
      getOidcProviderFormFields<ProjectSSO>({ withTeams: true }),
      "isEnabled",
    );

    expect(enabled.fieldType).toBe(FormFieldSchemaType.Toggle);
    expect(enabled.defaultValue).toBeUndefined();
    expect(enabled.description).toBe(oidcEnabled.description);
  });
});

describe("the signature and digest methods", () => {
  test("are required dropdowns that start on RSA-SHA256 and SHA256", () => {
    for (const fields of ALL_FORMS) {
      const signature: Field<unknown> = fieldFor(fields, "signatureMethod");
      const digest: Field<unknown> = fieldFor(fields, "digestMethod");

      expect({
        type: signature.fieldType,
        required: signature.required,
        defaultValue: signature.defaultValue,
      }).toEqual({
        type: FormFieldSchemaType.Dropdown,
        required: true,
        defaultValue: "RSA-SHA256",
      });
      expect({
        type: digest.fieldType,
        required: digest.required,
        defaultValue: digest.defaultValue,
      }).toEqual({
        type: FormFieldSchemaType.Dropdown,
        required: true,
        defaultValue: "SHA256",
      });
    }
  });

  test("start where the services fill them in", () => {
    expect(fieldFor(PROJECT_FIELDS, "signatureMethod").defaultValue).toBe(
      DEFAULT_SAML_SIGNATURE_METHOD,
    );
    expect(fieldFor(PROJECT_FIELDS, "digestMethod").defaultValue).toBe(
      DEFAULT_SAML_DIGEST_METHOD,
    );
  });

  test("offer every method the columns know, each shown as the value it saves", () => {
    expect(optionValues(SAML_SIGNATURE_METHOD_OPTIONS)).toEqual(
      Object.values(SignatureMethod),
    );
    expect(optionValues(SAML_DIGEST_METHOD_OPTIONS)).toEqual(
      Object.values(DigestMethod),
    );

    for (const option of [
      ...SAML_SIGNATURE_METHOD_OPTIONS,
      ...SAML_DIGEST_METHOD_OPTIONS,
    ]) {
      expect(option.label).toBe(option.value);
    }

    expect(fieldFor(PROJECT_FIELDS, "signatureMethod").dropdownOptions).toBe(
      SAML_SIGNATURE_METHOD_OPTIONS,
    );
    expect(fieldFor(PROJECT_FIELDS, "digestMethod").dropdownOptions).toBe(
      SAML_DIGEST_METHOD_OPTIONS,
    );
  });

  test("say what they are without telling anyone to leave them alone", () => {
    expect(fieldFor(PROJECT_FIELDS, "signatureMethod").description).toBe(
      SAML_SIGNATURE_METHOD_DESCRIPTION,
    );
    expect(fieldFor(PROJECT_FIELDS, "digestMethod").description).toBe(
      SAML_DIGEST_METHOD_DESCRIPTION,
    );

    for (const description of [
      SAML_SIGNATURE_METHOD_DESCRIPTION,
      SAML_DIGEST_METHOD_DESCRIPTION,
    ]) {
      expect(description).not.toMatch(/If you do not know what this is/);
      expect(description).toMatch(/^The .+\. Most use [A-Z0-9-]+\.$/);
    }
  });
});

describe("the description follows the name", () => {
  test("through the Name field's onChange, keeping every other value", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();
    const name: Field<ProjectSSO> = fieldFor(PROJECT_FIELDS, "name");

    name.onChange!(
      "Okta",
      valuesOf({
        name: "Okt",
        description: "Sign in with Okt",
        signatureMethod: "RSA-SHA256",
      }),
      setNewFormValues as unknown as (values: Values) => void,
    );

    expect(setNewFormValues).toHaveBeenCalledTimes(1);
    expect(setNewFormValues).toHaveBeenCalledWith({
      name: "Okt",
      description: "Sign in with Okta",
      signatureMethod: "RSA-SHA256",
    });
  });

  test("but never over one somebody wrote", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();
    const name: Field<ProjectSSO> = fieldFor(PROJECT_FIELDS, "name");

    name.onChange!(
      "Okta SAML",
      valuesOf({ name: "Okta", description: "Staff only" }),
      setNewFormValues as unknown as (values: Values) => void,
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });

  test("the description is required, short and folded: the form keeps it filled", () => {
    const description: Field<ProjectSSO> = fieldFor(
      PROJECT_FIELDS,
      "description",
    );

    expect(description.required).toBe(true);
    expect(description.fieldType).toBe(FormFieldSchemaType.Text);
    expect(description.collapsibleSection).toBeDefined();
  });
});

describe("the instance-wide provider's switches", () => {
  test("are the very fields the OIDC form has, at their columns' default (off)", () => {
    const oidcGlobal: Array<Field<GlobalSSO>> =
      getOidcProviderFormFields<GlobalSSO>({ withGlobalAccessSwitches: true });

    for (const key of ["disableSignUpWithSso", "restrictToAttachedProjects"]) {
      const saml: Field<GlobalSSO> = fieldFor(GLOBAL_FIELDS, key);
      const oidc: Field<GlobalSSO> = fieldFor(oidcGlobal, key);

      expect(saml.fieldType).toBe(FormFieldSchemaType.Toggle);
      expect(saml.defaultValue).toBeUndefined();
      expect({
        title: saml.title,
        description: saml.description,
        stepId: saml.stepId,
      }).toEqual({
        title: oidc.title,
        description: oidc.description,
        stepId: oidc.stepId,
      });
    }

    expect(fieldFor(GLOBAL_FIELDS, "disableSignUpWithSso").description).toBe(
      SSO_GLOBAL_DISABLE_SIGN_UP_DESCRIPTION,
    );
    expect(
      fieldFor(GLOBAL_FIELDS, "restrictToAttachedProjects").description,
    ).toBe(SSO_GLOBAL_RESTRICT_DESCRIPTION);
  });

  test("the OIDC builder's names for them still read the same", () => {
    expect(GLOBAL_OIDC_ADVANCED_DEFAULTS_SUMMARY).toBe(
      SSO_GLOBAL_ADVANCED_DEFAULTS_SUMMARY,
    );
    expect(GLOBAL_OIDC_DISABLE_SIGN_UP_DESCRIPTION).toBe(
      SSO_GLOBAL_DISABLE_SIGN_UP_DESCRIPTION,
    );
    expect(GLOBAL_OIDC_RESTRICT_DESCRIPTION).toBe(
      SSO_GLOBAL_RESTRICT_DESCRIPTION,
    );
  });

  test("are at their defaults while both are off", () => {
    expect(isSsoGlobalAccessAtDefaults({})).toBe(true);
    expect(
      isSsoGlobalAccessAtDefaults({
        disableSignUpWithSso: false,
        restrictToAttachedProjects: false,
      }),
    ).toBe(true);
    expect(isSsoGlobalAccessAtDefaults({ disableSignUpWithSso: true })).toBe(
      false,
    );
    expect(
      isSsoGlobalAccessAtDefaults({ restrictToAttachedProjects: true }),
    ).toBe(false);
    expect(isSsoGlobalAccessAtDefaults(null)).toBe(true);
  });
});

describe("the folded Advanced section", () => {
  const AT_DEFAULTS: Record<string, unknown> = {
    name: "Okta",
    signOnURL: "https://dev-123456.okta.com/app/exk1/sso/saml",
    issuerURL: "http://www.okta.com/exk1",
    publicCertificate: "-----BEGIN CERTIFICATE-----",
    signatureMethod: "RSA-SHA256",
    digestMethod: "SHA256",
    description: "Sign in with Okta",
    disableSignUpWithSso: false,
    restrictToAttachedProjects: false,
  };

  test("is at its defaults when everything is what the form fills in", () => {
    expect(isSamlAdvancedAtDefaults(AT_DEFAULTS)).toBe(true);
    expect(
      isSamlAdvancedAtDefaults(AT_DEFAULTS, { withGlobalAccessSwitches: true }),
    ).toBe(true);
    // A form that has not filled anything in yet is at its defaults too.
    expect(isSamlAdvancedAtDefaults({})).toBe(true);
  });

  test("reads a dropdown holding the option it was picked as", () => {
    expect(
      isSamlAdvancedAtDefaults({
        ...AT_DEFAULTS,
        signatureMethod: { label: "RSA-SHA256", value: "RSA-SHA256" },
        digestMethod: { label: "SHA256", value: "SHA256" },
      }),
    ).toBe(true);
    expect(
      isSamlAdvancedAtDefaults({
        ...AT_DEFAULTS,
        signatureMethod: { label: "RSA-SHA1", value: "RSA-SHA1" },
      }),
    ).toBe(false);
  });

  test.each([
    ["another signature method", { signatureMethod: "RSA-SHA1" }],
    ["another digest method", { digestMethod: "SHA512" }],
    ["a description of one's own", { description: "Staff only" }],
  ])("is not, with %s", (_label: string, change: Record<string, unknown>) => {
    expect(isSamlAdvancedAtDefaults({ ...AT_DEFAULTS, ...change })).toBe(false);
  });

  test("the switches count only on the Global form", () => {
    for (const key of ["disableSignUpWithSso", "restrictToAttachedProjects"]) {
      const changed: Record<string, unknown> = { ...AT_DEFAULTS, [key]: true };

      expect(
        isSamlAdvancedAtDefaults(changed, { withGlobalAccessSwitches: true }),
      ).toBe(false);
      expect(isSamlAdvancedAtDefaults(changed)).toBe(true);
    }
  });

  test("says what its defaults do while folded at them, and Configured once something differs", () => {
    const section: FormFieldCollapsibleSection<ProjectSSO> =
      getSamlAdvancedSection<ProjectSSO>();

    expect(section.getSummary!(valuesOf(AT_DEFAULTS))).toEqual([
      SAML_ADVANCED_DEFAULTS_SUMMARY,
    ]);
    expect(section.isConfigured!(valuesOf(AT_DEFAULTS))).toBe(false);

    const changed: Values = valuesOf({
      ...AT_DEFAULTS,
      digestMethod: "SHA1",
    });

    expect(section.getSummary!(changed)).toBeUndefined();
    expect(section.isConfigured!(changed)).toBe(true);
    expect(
      isFormSectionConfigured({ section, fields: [], values: changed }),
    ).toBe(true);
  });

  test("the Global form's summary also says who is created", () => {
    const section: FormFieldCollapsibleSection<GlobalSSO> =
      getSamlAdvancedSection<GlobalSSO>({ withGlobalAccessSwitches: true });

    expect(
      section.getSummary!(AT_DEFAULTS as unknown as FormValues<GlobalSSO>),
    ).toEqual([
      SAML_ADVANCED_DEFAULTS_SUMMARY,
      SSO_GLOBAL_ADVANCED_DEFAULTS_SUMMARY,
    ]);
  });

  test("the summary is a whole sentence", () => {
    expect(SAML_ADVANCED_DEFAULTS_SUMMARY).toBe(
      "Signatures use RSA-SHA256 with a SHA256 digest, as most identity providers do.",
    );
  });

  test("an edit form of an older provider on RSA-SHA1 says Configured, and keeps it", () => {
    const section: FormFieldCollapsibleSection<ProjectSSO> =
      getSamlAdvancedSection<ProjectSSO>({ withTeams: true });

    const older: Values = valuesOf({
      ...AT_DEFAULTS,
      signatureMethod: SignatureMethod.SHA1,
      digestMethod: DigestMethod.SHA1,
      description: "Sign in with our Okta",
    });

    expect(section.isConfigured!(older)).toBe(true);
    expect(section.getSummary!(older)).toBeUndefined();
  });
});
