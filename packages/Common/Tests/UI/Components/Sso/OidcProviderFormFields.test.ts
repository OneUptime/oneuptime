import { afterEach, describe, expect, jest, test } from "@jest/globals";
import GlobalOIDC from "../../../../Models/DatabaseModels/GlobalOidc";
import ProjectOIDC from "../../../../Models/DatabaseModels/ProjectOidc";
import StatusPageOIDC from "../../../../Models/DatabaseModels/StatusPageOidc";
import Team from "../../../../Models/DatabaseModels/Team";
import URL from "../../../../Types/API/URL";
import {
  DEFAULT_OIDC_EMAIL_CLAIM_NAME,
  DEFAULT_OIDC_NAME_CLAIM_NAME,
  DEFAULT_OIDC_SCOPES,
} from "../../../../Types/SSO/OidcProviderDefaults";
import Field, {
  FormFieldCollapsibleSection,
} from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import {
  ADVANCED_FORM_SECTION_TITLE,
  isFormSectionConfigured,
} from "../../../../UI/Components/Forms/Utils/AdvancedFormSection";
import {
  GLOBAL_OIDC_ADVANCED_DEFAULTS_SUMMARY,
  OIDC_ADVANCED_DEFAULTS_SUMMARY,
  OIDC_ISSUER_URL_ERROR,
  OIDC_SCOPES_WITHOUT_OPENID_ERROR,
  OidcIssuerChange,
  getOidcAdvancedSection,
  getOidcIssuerChange,
  getOidcIssuerError,
  getOidcProviderFormFields,
  getOidcScopesError,
  isOidcAdvancedAtDefaults,
} from "../../../../UI/Components/Sso/OidcProviderFormFields";
import {
  SSO_PROVIDER_STEP_ID,
  SSO_SIGN_IN_STEP_ID,
  getSsoProviderDescriptionAfterRename,
  getSsoProviderFormSteps,
} from "../../../../UI/Components/Sso/SsoProviderFormFields";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * The one builder behind the three OIDC provider forms (Settings > OIDC, a
 * status page's OIDC, Admin > Global OIDC), create and edit alike:
 *
 *   Provider   Name, Issuer URL, Client ID, Client Secret;
 *   Sign-in    Teams (a project's provider), Enabled, then one folded
 *              Advanced section - the discovery URL, the scopes, the two
 *              claim names, the description and (Global) the sign-up and
 *              access switches.
 *
 * What it fills in, and how those values follow what is typed, is what the
 * services fill in for an API caller (Types/SSO/OidcProviderDefaults).
 */

type Values = FormValues<ProjectOIDC>;

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

const PROJECT_FIELDS: Array<Field<ProjectOIDC>> =
  getOidcProviderFormFields<ProjectOIDC>({ withTeams: true });
const STATUS_PAGE_FIELDS: Array<Field<StatusPageOIDC>> =
  getOidcProviderFormFields<StatusPageOIDC>();
const GLOBAL_FIELDS: Array<Field<GlobalOIDC>> =
  getOidcProviderFormFields<GlobalOIDC>({ withGlobalAccessSwitches: true });

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the steps", () => {
  test("are Provider, then Sign-in, on every provider form", () => {
    const steps: Array<FormStep<ProjectOIDC>> =
      getSsoProviderFormSteps<ProjectOIDC>();

    expect(steps).toEqual([
      { title: "Provider", id: "provider" },
      { title: "Sign-in", id: "sign-in" },
    ]);
    expect(SSO_PROVIDER_STEP_ID).toBe("provider");
    expect(SSO_SIGN_IN_STEP_ID).toBe("sign-in");

    // A fresh list per form, so no form can change another's.
    expect(getSsoProviderFormSteps<ProjectOIDC>()).not.toBe(steps);
  });
});

describe("the fields each form gets", () => {
  test("a project's provider: the provider, then the teams newcomers join, Enabled and Advanced", () => {
    expect(keysOn(PROJECT_FIELDS, "provider")).toEqual([
      "name",
      "issuerURL",
      "clientId",
      "clientSecret",
    ]);
    expect(keysOn(PROJECT_FIELDS, "sign-in")).toEqual([
      "teams",
      "isEnabled",
      "discoveryURL",
      "scopes",
      "emailClaimName",
      "nameClaimName",
      "description",
    ]);
  });

  test("a status page's provider: no teams", () => {
    expect(keysOn(STATUS_PAGE_FIELDS, "provider")).toEqual([
      "name",
      "issuerURL",
      "clientId",
      "clientSecret",
    ]);
    expect(keysOn(STATUS_PAGE_FIELDS, "sign-in")).toEqual([
      "isEnabled",
      "discoveryURL",
      "scopes",
      "emailClaimName",
      "nameClaimName",
      "description",
    ]);
  });

  test("the instance-wide provider: no teams, and its two switches folded at the end", () => {
    expect(keysOn(GLOBAL_FIELDS, "sign-in")).toEqual([
      "isEnabled",
      "discoveryURL",
      "scopes",
      "emailClaimName",
      "nameClaimName",
      "description",
      "disableSignUpWithSso",
      "restrictToAttachedProjects",
    ]);
  });

  test("every field is on one of the two steps", () => {
    for (const fields of [PROJECT_FIELDS, STATUS_PAGE_FIELDS, GLOBAL_FIELDS]) {
      for (const field of fields as Array<Field<unknown>>) {
        expect([keyOf(field), field.stepId]).toEqual([
          keyOf(field),
          expect.stringMatching(/^(provider|sign-in)$/),
        ]);
      }
    }
  });

  test("everything after Enabled is folded under one Advanced section, built once", () => {
    for (const fields of [
      PROJECT_FIELDS,
      STATUS_PAGE_FIELDS,
      GLOBAL_FIELDS,
    ] as Array<Array<Field<unknown>>>) {
      const enabledAt: number = fields.findIndex(
        (field: Field<unknown>): boolean => {
          return keyOf(field) === "isEnabled";
        },
      );
      const open: Array<Field<unknown>> = fields.slice(0, enabledAt + 1);
      const folded: Array<Field<unknown>> = fields.slice(enabledAt + 1);

      expect(folded.length).toBeGreaterThanOrEqual(5);

      for (const field of open) {
        expect([keyOf(field), field.collapsibleSection]).toEqual([
          keyOf(field),
          undefined,
        ]);
      }

      const section: FormFieldCollapsibleSection<unknown> | undefined =
        folded[0]!.collapsibleSection;

      expect(section?.title).toBe(ADVANCED_FORM_SECTION_TITLE);
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
    expect(fieldFor(PROJECT_FIELDS, "scopes").collapsibleSection).not.toBe(
      fieldFor(STATUS_PAGE_FIELDS, "scopes").collapsibleSection,
    );
  });

  test("asks for the four things the identity provider gives, and requires them", () => {
    const issuer: Field<ProjectOIDC> = fieldFor(PROJECT_FIELDS, "issuerURL");
    const secret: Field<ProjectOIDC> = fieldFor(PROJECT_FIELDS, "clientSecret");

    for (const key of ["name", "issuerURL", "clientId", "clientSecret"]) {
      expect([key, fieldFor(PROJECT_FIELDS, key).required]).toEqual([
        key,
        true,
      ]);
    }

    expect(fieldFor(PROJECT_FIELDS, "name").title).toBe("Name");
    expect(issuer.title).toBe("Issuer URL");
    expect(issuer.fieldType).toBe(FormFieldSchemaType.Text);
    expect(issuer.disableSpellCheck).toBe(true);
    // The secret is masked on every form, the Global one included.
    expect(secret.fieldType).toBe(FormFieldSchemaType.EncryptedText);
    expect(fieldFor(GLOBAL_FIELDS, "clientSecret").fieldType).toBe(
      FormFieldSchemaType.EncryptedText,
    );
  });

  test("teams pick from the project's teams, are required, and say what they are for", () => {
    const teams: Field<ProjectOIDC> = fieldFor(PROJECT_FIELDS, "teams");

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

  test("Enabled is a switch that says why it starts off, with no default of its own", () => {
    const enabled: Field<ProjectOIDC> = fieldFor(PROJECT_FIELDS, "isEnabled");

    expect(enabled.fieldType).toBe(FormFieldSchemaType.Toggle);
    // The column's default (off) is what ModelForm starts it on.
    expect(enabled.defaultValue).toBeUndefined();
    expect(enabled.description).toBe(
      "People can sign in with this provider only while it is on. Turn it on once your identity provider has the URLs OneUptime shows after you save.",
    );
  });

  test("the scopes and claim names start at the usual values", () => {
    expect(fieldFor(PROJECT_FIELDS, "scopes").defaultValue).toBe(
      DEFAULT_OIDC_SCOPES,
    );
    expect(fieldFor(PROJECT_FIELDS, "emailClaimName").defaultValue).toBe(
      DEFAULT_OIDC_EMAIL_CLAIM_NAME,
    );
    expect(fieldFor(PROJECT_FIELDS, "nameClaimName").defaultValue).toBe(
      DEFAULT_OIDC_NAME_CLAIM_NAME,
    );

    // The Global form fills them in too, as it did not before.
    expect(fieldFor(GLOBAL_FIELDS, "scopes").defaultValue).toBe(
      DEFAULT_OIDC_SCOPES,
    );
  });

  test("the folded values are required, so an edit can never blank one: the form keeps them filled", () => {
    for (const key of [
      "discoveryURL",
      "scopes",
      "emailClaimName",
      "nameClaimName",
      "description",
    ]) {
      expect([key, fieldFor(PROJECT_FIELDS, key).required]).toEqual([
        key,
        true,
      ]);
    }

    expect(fieldFor(PROJECT_FIELDS, "discoveryURL").fieldType).toBe(
      FormFieldSchemaType.URL,
    );
  });

  test("the Global switches keep their columns' default (off)", () => {
    for (const key of ["disableSignUpWithSso", "restrictToAttachedProjects"]) {
      const field: Field<GlobalOIDC> = fieldFor(GLOBAL_FIELDS, key);

      expect(field.fieldType).toBe(FormFieldSchemaType.Toggle);
      expect(field.defaultValue).toBeUndefined();
    }
  });
});

describe("the description follows the name", () => {
  test("while it is empty or the one the old name gave", () => {
    expect(
      getSsoProviderDescriptionAfterRename({
        values: { name: "", description: "" },
        name: "O",
      }),
    ).toBe("Sign in with O");

    expect(
      getSsoProviderDescriptionAfterRename({
        values: { name: "Okt", description: "Sign in with Okt" },
        name: "Okta",
      }),
    ).toBe("Sign in with Okta");

    // Clearing the name clears the description it gave.
    expect(
      getSsoProviderDescriptionAfterRename({
        values: { name: "Okta", description: "Sign in with Okta" },
        name: "",
      }),
    ).toBe("");
  });

  test("but never over one somebody wrote", () => {
    expect(
      getSsoProviderDescriptionAfterRename({
        values: { name: "Okta", description: "Staff only" },
        name: "Okta SSO",
      }),
    ).toBeNull();
  });

  test("through the Name field's onChange, keeping every other value", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();
    const name: Field<ProjectOIDC> = fieldFor(PROJECT_FIELDS, "name");

    name.onChange!(
      "Okta",
      valuesOf({ name: "Okt", description: "Sign in with Okt", scopes: "x" }),
      setNewFormValues as unknown as (values: Values) => void,
    );

    expect(setNewFormValues).toHaveBeenCalledTimes(1);
    expect(setNewFormValues).toHaveBeenCalledWith({
      name: "Okt",
      description: "Sign in with Okta",
      scopes: "x",
    });
  });

  test("the Name field leaves a written description, and an unchanged one, alone", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();
    const name: Field<ProjectOIDC> = fieldFor(PROJECT_FIELDS, "name");

    name.onChange!(
      "Okta SSO",
      valuesOf({ name: "Okta", description: "Staff only" }),
      setNewFormValues as unknown as (values: Values) => void,
    );
    name.onChange!(
      "Okta",
      valuesOf({ name: "Okta", description: "Sign in with Okta" }),
      setNewFormValues as unknown as (values: Values) => void,
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });
});

describe("the discovery URL follows the issuer", () => {
  test("while it is empty or the one the old issuer gave", () => {
    expect(
      getOidcIssuerChange({
        values: { issuerURL: "", discoveryURL: "" },
        issuer: "https://accounts.example.com",
      }),
    ).toEqual({
      replacesTypedIssuer: false,
      values: {
        discoveryURL:
          "https://accounts.example.com/.well-known/openid-configuration",
      },
    });

    // An edit form: the stored URL is the old issuer's, as the URL type writes it.
    expect(
      getOidcIssuerChange({
        values: {
          issuerURL: "https://old.example.com",
          discoveryURL: URL.fromString(
            "https://old.example.com/.well-known/openid-configuration",
          ),
        },
        issuer: "https://new.example.com",
      }),
    ).toEqual({
      replacesTypedIssuer: false,
      values: {
        discoveryURL:
          "https://new.example.com/.well-known/openid-configuration",
      },
    });
  });

  test("clearing the issuer clears the discovery URL it gave", () => {
    expect(
      getOidcIssuerChange({
        values: {
          issuerURL: "h",
          discoveryURL: "h/.well-known/openid-configuration",
        },
        issuer: "",
      }),
    ).toEqual({ replacesTypedIssuer: false, values: { discoveryURL: "" } });
  });

  test("but never over one set by hand", () => {
    expect(
      getOidcIssuerChange({
        values: {
          issuerURL: "https://accounts.example.com",
          discoveryURL: "https://sso.example.com/metadata/openid-configuration",
        },
        issuer: "https://accounts.example.com/v2",
      }),
    ).toBeNull();
  });

  test("and nothing changes when the issuer gives the same URL", () => {
    expect(
      getOidcIssuerChange({
        values: {
          issuerURL: "https://accounts.example.com",
          discoveryURL:
            "https://accounts.example.com/.well-known/openid-configuration",
        },
        issuer: "https://accounts.example.com/",
      }),
    ).toBeNull();
  });

  test("a discovery URL pasted as the issuer is split into the two", () => {
    const change: OidcIssuerChange | null = getOidcIssuerChange({
      values: { issuerURL: "", discoveryURL: "" },
      issuer: "https://accounts.google.com/.well-known/openid-configuration",
    });

    expect(change).toEqual({
      replacesTypedIssuer: true,
      values: {
        issuerURL: "https://accounts.google.com",
        discoveryURL:
          "https://accounts.google.com/.well-known/openid-configuration",
      },
    });
  });

  test("a discovery URL pasted over a hand-set one moves only the issuer", () => {
    expect(
      getOidcIssuerChange({
        values: {
          issuerURL: "https://accounts.example.com",
          discoveryURL: "https://sso.example.com/metadata/openid-configuration",
        },
        issuer: "https://accounts.google.com/.well-known/openid-configuration",
      }),
    ).toEqual({
      replacesTypedIssuer: true,
      values: { issuerURL: "https://accounts.google.com" },
    });
  });

  test("through the Issuer field's onChange, at once", () => {
    const setNewFormValues: MockFunction = getJestMockFunction();
    const issuer: Field<ProjectOIDC> = fieldFor(PROJECT_FIELDS, "issuerURL");

    issuer.onChange!(
      "https://accounts.example.com",
      valuesOf({ name: "Okta", issuerURL: "", discoveryURL: "" }),
      setNewFormValues as unknown as (values: Values) => void,
    );

    expect(setNewFormValues).toHaveBeenCalledWith({
      name: "Okta",
      issuerURL: "",
      discoveryURL:
        "https://accounts.example.com/.well-known/openid-configuration",
    });
  });

  test("a pasted discovery URL lands after the form has stored what was typed", async () => {
    const setNewFormValues: MockFunction = getJestMockFunction();
    const issuer: Field<ProjectOIDC> = fieldFor(PROJECT_FIELDS, "issuerURL");

    issuer.onChange!(
      "https://accounts.google.com/.well-known/openid-configuration",
      valuesOf({ name: "Google", issuerURL: "", discoveryURL: "" }),
      setNewFormValues as unknown as (values: Values) => void,
    );

    // Not now: the form writes the typed text right after onChange returns.
    expect(setNewFormValues).not.toHaveBeenCalled();

    await Promise.resolve();

    expect(setNewFormValues).toHaveBeenCalledTimes(1);
    expect(setNewFormValues).toHaveBeenCalledWith({
      name: "Google",
      issuerURL: "https://accounts.google.com",
      discoveryURL:
        "https://accounts.google.com/.well-known/openid-configuration",
    });
  });
});

describe("the checks", () => {
  test("an issuer is an http(s) URL", () => {
    expect(getOidcIssuerError({ issuerURL: "https://a.example.com" })).toBe(
      null,
    );
    expect(getOidcIssuerError({ issuerURL: "http://10.0.0.5/realms/x" })).toBe(
      null,
    );
    // Required says it when empty; this check does not repeat it.
    expect(getOidcIssuerError({ issuerURL: "" })).toBe(null);
    expect(getOidcIssuerError({})).toBe(null);
    expect(getOidcIssuerError({ issuerURL: "accounts.example.com" })).toBe(
      OIDC_ISSUER_URL_ERROR,
    );
    expect(OIDC_ISSUER_URL_ERROR).toBe(
      "Enter the issuer as a URL that starts with https://.",
    );
  });

  test("the scopes ask for openid", () => {
    expect(getOidcScopesError({ scopes: "openid email" })).toBe(null);
    expect(getOidcScopesError({ scopes: "" })).toBe(null);
    expect(getOidcScopesError({ scopes: "email profile" })).toBe(
      OIDC_SCOPES_WITHOUT_OPENID_ERROR,
    );
    expect(OIDC_SCOPES_WITHOUT_OPENID_ERROR).toBe(
      "The scopes must include openid.",
    );
  });

  test("the fields run them", () => {
    expect(
      fieldFor(PROJECT_FIELDS, "issuerURL").customValidation!(
        valuesOf({ issuerURL: "accounts.example.com" }),
      ),
    ).toBe(OIDC_ISSUER_URL_ERROR);
    expect(
      fieldFor(PROJECT_FIELDS, "scopes").customValidation!(
        valuesOf({ scopes: "email" }),
      ),
    ).toBe(OIDC_SCOPES_WITHOUT_OPENID_ERROR);
  });
});

describe("the folded Advanced section", () => {
  const AT_DEFAULTS: Record<string, unknown> = {
    name: "Okta",
    issuerURL: "https://dev-123456.okta.com/oauth2/default",
    discoveryURL:
      "https://dev-123456.okta.com/oauth2/default/.well-known/openid-configuration",
    scopes: DEFAULT_OIDC_SCOPES,
    emailClaimName: DEFAULT_OIDC_EMAIL_CLAIM_NAME,
    nameClaimName: DEFAULT_OIDC_NAME_CLAIM_NAME,
    description: "Sign in with Okta",
    disableSignUpWithSso: false,
    restrictToAttachedProjects: false,
  };

  test("is at its defaults when everything is what the form fills in", () => {
    expect(isOidcAdvancedAtDefaults(AT_DEFAULTS)).toBe(true);
    expect(
      isOidcAdvancedAtDefaults(AT_DEFAULTS, { withGlobalAccessSwitches: true }),
    ).toBe(true);
    // A form that has not filled anything in yet is at its defaults too.
    expect(isOidcAdvancedAtDefaults({})).toBe(true);
  });

  test.each([
    [
      "a discovery URL set by hand",
      { discoveryURL: "https://x.example.com/d" },
    ],
    ["other scopes", { scopes: "openid email" }],
    ["another email claim", { emailClaimName: "upn" }],
    ["another name claim", { nameClaimName: "preferred_username" }],
    ["a description of one's own", { description: "Staff only" }],
  ])("is not, with %s", (_label: string, change: Record<string, unknown>) => {
    expect(isOidcAdvancedAtDefaults({ ...AT_DEFAULTS, ...change })).toBe(false);
  });

  test("on the Global form, a switch turned on is not at its default", () => {
    for (const key of ["disableSignUpWithSso", "restrictToAttachedProjects"]) {
      expect(
        isOidcAdvancedAtDefaults(
          { ...AT_DEFAULTS, [key]: true },
          { withGlobalAccessSwitches: true },
        ),
      ).toBe(false);
    }
  });

  test("says what its defaults do while folded at them, and Configured once something differs", () => {
    const section: FormFieldCollapsibleSection<ProjectOIDC> =
      getOidcAdvancedSection<ProjectOIDC>();

    expect(section.getSummary!(valuesOf(AT_DEFAULTS))).toEqual([
      OIDC_ADVANCED_DEFAULTS_SUMMARY,
    ]);
    expect(section.isConfigured!(valuesOf(AT_DEFAULTS))).toBe(false);

    const changed: Values = valuesOf({ ...AT_DEFAULTS, scopes: "openid" });

    expect(section.getSummary!(changed)).toBeUndefined();
    expect(section.isConfigured!(changed)).toBe(true);
    expect(
      isFormSectionConfigured({ section, fields: [], values: changed }),
    ).toBe(true);
  });

  test("the Global form's summary also says who is created", () => {
    const section: FormFieldCollapsibleSection<GlobalOIDC> =
      getOidcAdvancedSection<GlobalOIDC>({ withGlobalAccessSwitches: true });

    expect(
      section.getSummary!(AT_DEFAULTS as unknown as FormValues<GlobalOIDC>),
    ).toEqual([
      OIDC_ADVANCED_DEFAULTS_SUMMARY,
      GLOBAL_OIDC_ADVANCED_DEFAULTS_SUMMARY,
    ]);
  });

  test("the summaries are whole sentences", () => {
    expect(OIDC_ADVANCED_DEFAULTS_SUMMARY).toBe(
      "Endpoints are found from the issuer, and sign-in asks for the openid, email and profile scopes.",
    );
    expect(GLOBAL_OIDC_ADVANCED_DEFAULTS_SUMMARY).toBe(
      "People who sign in for the first time join the projects you attach.",
    );
  });

  test("an edit form of a provider the services completed reads as at its defaults", () => {
    // What a provider created with only the essentials holds, read back.
    expect(
      isOidcAdvancedAtDefaults({
        ...AT_DEFAULTS,
        discoveryURL: URL.fromString(
          "https://dev-123456.okta.com/oauth2/default/.well-known/openid-configuration",
        ),
      }),
    ).toBe(true);
  });
});
