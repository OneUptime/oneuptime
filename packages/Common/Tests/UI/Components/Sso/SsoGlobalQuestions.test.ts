import { describe, expect, jest, test } from "@jest/globals";
import GlobalOIDC from "../../../../Models/DatabaseModels/GlobalOidc";
import GlobalSSO from "../../../../Models/DatabaseModels/GlobalSso";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import type { RadioButton } from "../../../../UI/Components/RadioButtons/GroupRadioButtons";
import { getOidcProviderFormFields } from "../../../../UI/Components/Sso/OidcProviderFormFields";
import { getSamlProviderFormFields } from "../../../../UI/Components/Sso/SamlProviderFormFields";
import {
  SSO_GLOBAL_REACH_ATTACHED_ONLY,
  SSO_GLOBAL_REACH_CHOICES,
  SSO_GLOBAL_REACH_EVERY_PROJECT,
  SSO_GLOBAL_REACH_FIELD_KEY,
  SSO_GLOBAL_REACH_TITLE,
  SSO_GLOBAL_SIGN_UP_ANYONE,
  SSO_GLOBAL_SIGN_UP_CHOICES,
  SSO_GLOBAL_SIGN_UP_FIELD_KEY,
  SSO_GLOBAL_SIGN_UP_INVITED,
  SSO_GLOBAL_SIGN_UP_TITLE,
  getSsoGlobalReachAnswer,
  getSsoGlobalReachAnswerTitle,
  getSsoGlobalSignUpAnswer,
  getSsoGlobalSignUpAnswerTitle,
  getSsoProviderReachChoiceField,
  getSsoProviderReachColumnField,
  getSsoProviderSignUpChoiceField,
  getSsoProviderSignUpColumnField,
} from "../../../../UI/Components/Sso/SsoProviderFormFields";
import { getAdvancedFormSection } from "../../../../UI/Components/Forms/Utils/AdvancedFormSection";

/*
 * THE INSTANCE-WIDE PROVIDER'S TWO QUESTIONS (Admin Dashboard > Global SSO
 * and Global OIDC), Common/UI/Components/Sso/SsoProviderFormFields.
 *
 * They were two switches, "Disable Sign Up with SSO" and "Restrict to
 * Attached Projects", each with a "When on, ..." sentence that explained
 * both of its modes. Each is now its question with two answers, the default
 * first:
 *
 *   People without an account     Get one on their first sign-in (off)
 *                                  Must be invited first (on)
 *   Where this sign-in counts      Every project (off)
 *   as SSO                         Attached projects only (on)
 *
 * The answers are written into the same two columns, which the form loads
 * and saves unseen, so the API, Terraform, the sign-in routes and every
 * provider already set up read them as before.
 */

type Values = FormValues<GlobalSSO>;

// What a field hands its new values to.
type SetNewFormValuesMock = ReturnType<typeof jest.fn<(values: Values) => void>>;

function values(record: Record<string, unknown>): Values {
  return record as unknown as Values;
}

function valuesOf(choices: Array<RadioButton>): Array<string> {
  return choices.map((choice: RadioButton): string => {
    return choice.value;
  });
}

const SECTION: ReturnType<typeof getAdvancedFormSection<GlobalSSO>> =
  getAdvancedFormSection<GlobalSSO>({});

describe("the questions and their answers", () => {
  test("who gets an account: the default first", () => {
    expect(SSO_GLOBAL_SIGN_UP_TITLE).toBe("People without an account");
    expect(valuesOf(SSO_GLOBAL_SIGN_UP_CHOICES)).toEqual([
      SSO_GLOBAL_SIGN_UP_ANYONE,
      SSO_GLOBAL_SIGN_UP_INVITED,
    ]);
    expect(SSO_GLOBAL_SIGN_UP_CHOICES).toEqual([
      {
        value: SSO_GLOBAL_SIGN_UP_ANYONE,
        title: "Get one on their first sign-in",
        description:
          "They join the projects attached to this provider. With none attached, they must be invited first.",
      },
      {
        value: SSO_GLOBAL_SIGN_UP_INVITED,
        title: "Must be invited first",
        description:
          "They are turned away until someone invites them to a project.",
      },
    ]);
  });

  test("where the sign-in counts: the default first, and the answer that narrows says it narrows", () => {
    expect(SSO_GLOBAL_REACH_TITLE).toBe("Where this sign-in counts as SSO");
    expect(valuesOf(SSO_GLOBAL_REACH_CHOICES)).toEqual([
      SSO_GLOBAL_REACH_EVERY_PROJECT,
      SSO_GLOBAL_REACH_ATTACHED_ONLY,
    ]);
    expect(SSO_GLOBAL_REACH_CHOICES).toEqual([
      {
        value: SSO_GLOBAL_REACH_EVERY_PROJECT,
        title: "Every project",
        description:
          "Projects that require SSO accept a sign-in with this provider.",
      },
      {
        value: SSO_GLOBAL_REACH_ATTACHED_ONLY,
        title: "Attached projects only",
        description:
          "Other projects that require SSO turn it away, even for people already signed in.",
      },
    ]);
  });

  test("no answer is named for turning something off", () => {
    for (const choice of [
      ...SSO_GLOBAL_SIGN_UP_CHOICES,
      ...SSO_GLOBAL_REACH_CHOICES,
    ]) {
      expect(choice.title).not.toMatch(/disable|restrict|when on/i);
      expect(String(choice.description)).not.toMatch(/when on|when off/i);
    }
  });
});

describe("the answer a provider's columns read as", () => {
  test("off, or never set, is the first answer; on is the second", () => {
    expect(getSsoGlobalSignUpAnswer({})).toBe(SSO_GLOBAL_SIGN_UP_ANYONE);
    expect(getSsoGlobalSignUpAnswer(null)).toBe(SSO_GLOBAL_SIGN_UP_ANYONE);
    expect(getSsoGlobalSignUpAnswer({ disableSignUpWithSso: false })).toBe(
      SSO_GLOBAL_SIGN_UP_ANYONE,
    );
    expect(getSsoGlobalSignUpAnswer({ disableSignUpWithSso: true })).toBe(
      SSO_GLOBAL_SIGN_UP_INVITED,
    );

    expect(getSsoGlobalReachAnswer({})).toBe(SSO_GLOBAL_REACH_EVERY_PROJECT);
    expect(getSsoGlobalReachAnswer({ restrictToAttachedProjects: false })).toBe(
      SSO_GLOBAL_REACH_EVERY_PROJECT,
    );
    expect(getSsoGlobalReachAnswer({ restrictToAttachedProjects: true })).toBe(
      SSO_GLOBAL_REACH_ATTACHED_ONLY,
    );
  });

  test("a provider model reads the same as the form's values", () => {
    const provider: GlobalOIDC = new GlobalOIDC();

    provider.disableSignUpWithSso = true;
    provider.restrictToAttachedProjects = false;

    expect(getSsoGlobalSignUpAnswer(provider)).toBe(SSO_GLOBAL_SIGN_UP_INVITED);
    expect(getSsoGlobalReachAnswer(provider)).toBe(
      SSO_GLOBAL_REACH_EVERY_PROJECT,
    );
  });

  test("the provider page shows the answer's title", () => {
    expect(getSsoGlobalSignUpAnswerTitle({})).toBe(
      "Get one on their first sign-in",
    );
    expect(getSsoGlobalSignUpAnswerTitle({ disableSignUpWithSso: true })).toBe(
      "Must be invited first",
    );
    expect(getSsoGlobalReachAnswerTitle({})).toBe("Every project");
    expect(
      getSsoGlobalReachAnswerTitle({ restrictToAttachedProjects: true }),
    ).toBe("Attached projects only");
  });
});

describe("each question's field", () => {
  test.each([
    [
      "People without an account",
      getSsoProviderSignUpChoiceField,
      SSO_GLOBAL_SIGN_UP_FIELD_KEY,
      SSO_GLOBAL_SIGN_UP_CHOICES,
      "disableSignUpWithSso",
    ],
    [
      "Where this sign-in counts as SSO",
      getSsoProviderReachChoiceField,
      SSO_GLOBAL_REACH_FIELD_KEY,
      SSO_GLOBAL_REACH_CHOICES,
      "restrictToAttachedProjects",
    ],
  ] as Array<
    [
      string,
      typeof getSsoProviderSignUpChoiceField,
      string,
      Array<RadioButton>,
      string,
    ]
  >)(
    "%s: a form-only choice of plain answers, kept apart from its column, folded where it is told",
    (
      title: string,
      build: typeof getSsoProviderSignUpChoiceField,
      key: string,
      choices: Array<RadioButton>,
      column: string,
    ) => {
      const field: Field<GlobalSSO> = build<GlobalSSO>({
        stepId: "sign-in",
        collapsibleSection: SECTION,
      });

      expect(field.title).toBe(title);
      expect(field.fieldType).toBe(FormFieldSchemaType.RadioButton);
      expect(field.radioButtonOptions).toBe(choices);
      expect(field.required).toBe(true);
      // The choice is not a column: it is kept under its own key, and never sent.
      expect(field.overrideFieldKey).toBe(key);
      expect(field.formOnly).toBe(true);
      // The column stands in for the field's permissions.
      expect(Object.keys(field.field || {})).toEqual([column]);
      expect(field.hideColumnDescription).toBe(true);
      expect(field.stepId).toBe("sign-in");
      expect(field.collapsibleSection).toBe(SECTION);
    },
  );

  test("each starts on the answer its column holds", () => {
    const signUp: Field<GlobalSSO> = getSsoProviderSignUpChoiceField<GlobalSSO>(
      { stepId: "sign-in", collapsibleSection: SECTION },
    );
    const reach: Field<GlobalSSO> = getSsoProviderReachChoiceField<GlobalSSO>({
      stepId: "sign-in",
      collapsibleSection: SECTION,
    });

    // A new provider: both columns off, both on their first answer.
    expect(signUp.getDefaultValue!(values({}))).toBe(SSO_GLOBAL_SIGN_UP_ANYONE);
    expect(reach.getDefaultValue!(values({}))).toBe(
      SSO_GLOBAL_REACH_EVERY_PROJECT,
    );
    expect(signUp.isAtDefault!(values({}))).toBe(true);
    expect(reach.isAtDefault!(values({}))).toBe(true);

    // A provider set up with both on: the second answers, and not at their default.
    const both: Values = values({
      disableSignUpWithSso: true,
      restrictToAttachedProjects: true,
    });

    expect(signUp.getDefaultValue!(both)).toBe(SSO_GLOBAL_SIGN_UP_INVITED);
    expect(reach.getDefaultValue!(both)).toBe(SSO_GLOBAL_REACH_ATTACHED_ONLY);
    expect(signUp.isAtDefault!(both)).toBe(false);
    expect(reach.isAtDefault!(both)).toBe(false);
  });

  test("picking an answer writes its column, and keeps every other value", () => {
    const signUp: Field<GlobalSSO> = getSsoProviderSignUpChoiceField<GlobalSSO>(
      { stepId: "sign-in", collapsibleSection: SECTION },
    );
    const reach: Field<GlobalSSO> = getSsoProviderReachChoiceField<GlobalSSO>({
      stepId: "sign-in",
      collapsibleSection: SECTION,
    });
    const setNewFormValues: SetNewFormValuesMock =
      jest.fn<(values: Values) => void>();
    const current: Values = values({
      name: "Okta",
      disableSignUpWithSso: false,
      restrictToAttachedProjects: false,
    });

    signUp.onChange!(SSO_GLOBAL_SIGN_UP_INVITED, current, setNewFormValues);
    expect(setNewFormValues).toHaveBeenLastCalledWith({
      name: "Okta",
      disableSignUpWithSso: true,
      restrictToAttachedProjects: false,
    });

    signUp.onChange!(SSO_GLOBAL_SIGN_UP_ANYONE, current, setNewFormValues);
    expect(setNewFormValues).toHaveBeenLastCalledWith({
      name: "Okta",
      disableSignUpWithSso: false,
      restrictToAttachedProjects: false,
    });

    reach.onChange!(SSO_GLOBAL_REACH_ATTACHED_ONLY, current, setNewFormValues);
    expect(setNewFormValues).toHaveBeenLastCalledWith({
      name: "Okta",
      disableSignUpWithSso: false,
      restrictToAttachedProjects: true,
    });

    reach.onChange!(SSO_GLOBAL_REACH_EVERY_PROJECT, current, setNewFormValues);
    expect(setNewFormValues).toHaveBeenLastCalledWith({
      name: "Okta",
      disableSignUpWithSso: false,
      restrictToAttachedProjects: false,
    });
  });
});

describe("each question's column", () => {
  test.each([
    [
      getSsoProviderSignUpColumnField,
      "disableSignUpWithSso",
      "Disable Sign Up with SSO",
    ],
    [
      getSsoProviderReachColumnField,
      "restrictToAttachedProjects",
      "Restrict to Attached Projects",
    ],
  ] as Array<[typeof getSsoProviderSignUpColumnField, string, string]>)(
    "is loaded and saved on the question's step, and never drawn: %#",
    (
      build: typeof getSsoProviderSignUpColumnField,
      column: string,
      title: string,
    ) => {
      const field: Field<GlobalSSO> = build<GlobalSSO>({ stepId: "sign-in" });

      expect(Object.keys(field.field || {})).toEqual([column]);
      // Its title is the column's, for the API's sake: no one sees it.
      expect(field.title).toBe(title);
      expect(field.fieldType).toBe(FormFieldSchemaType.Toggle);
      expect(field.stepId).toBe("sign-in");
      expect(field.defaultValue).toBeUndefined();
      expect(field.overrideFieldKey).toBeUndefined();

      for (const record of [{}, { [column]: true }, { [column]: false }]) {
        expect(field.showIf!(values(record))).toBe(false);
      }
    },
  );
});

describe("the instance-wide provider forms", () => {
  test.each([
    [
      "SAML",
      getSamlProviderFormFields<GlobalSSO>({ withGlobalAccessSwitches: true }),
    ],
    [
      "OIDC",
      getOidcProviderFormFields<GlobalSSO>({ withGlobalAccessSwitches: true }),
    ],
  ])(
    "%s: the two questions come last, each followed by its column",
    (_kind: string, fields: Array<Field<GlobalSSO>>) => {
      const lastFour: Array<Field<GlobalSSO>> = fields.slice(-4);

      expect(
        lastFour.map((field: Field<GlobalSSO>): string => {
          return field.overrideFieldKey || Object.keys(field.field || {})[0]!;
        }),
      ).toEqual([
        SSO_GLOBAL_SIGN_UP_FIELD_KEY,
        "disableSignUpWithSso",
        SSO_GLOBAL_REACH_FIELD_KEY,
        "restrictToAttachedProjects",
      ]);

      // Folded with the rest of the step's answers, in one section.
      const section: unknown = lastFour[0]!.collapsibleSection;

      expect(section).toBeDefined();
      expect(lastFour[2]!.collapsibleSection).toBe(section);
      expect(
        fields.find((field: Field<GlobalSSO>): boolean => {
          return Object.keys(field.field || {})[0] === "description";
        })?.collapsibleSection,
      ).toBe(section);
    },
  );

  test.each([
    ["SAML", getSamlProviderFormFields<GlobalSSO>()],
    ["OIDC", getOidcProviderFormFields<GlobalSSO>()],
  ])(
    "%s: a project's or a status page's provider asks neither",
    (_kind: string, fields: Array<Field<GlobalSSO>>) => {
      for (const field of fields) {
        expect([
          SSO_GLOBAL_SIGN_UP_FIELD_KEY,
          SSO_GLOBAL_REACH_FIELD_KEY,
        ]).not.toContain(field.overrideFieldKey);
        expect(Object.keys(field.field || {})).not.toContain(
          "disableSignUpWithSso",
        );
        expect(Object.keys(field.field || {})).not.toContain(
          "restrictToAttachedProjects",
        );
      }
    },
  );
});
