import Team from "../../../Models/DatabaseModels/Team";
import {
  getDefaultSsoProviderDescription,
  isDefaultSsoProviderDescription,
} from "../../../Types/SSO/SsoProviderDefaults";
import SelectFormFields from "../../Types/SelectEntityField";
import { translationKey } from "../../Utils/TranslateTemplate";
import Field, { FormFieldCollapsibleSection } from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import { FormStep } from "../Forms/Types/FormStep";
import FormValues from "../Forms/Types/FormValues";
import type { RadioButton } from "../RadioButtons/GroupRadioButtons";
import type { ReactElement } from "react";

/*
 * THE PARTS EVERY SINGLE SIGN-ON PROVIDER FORM SHARES.
 *
 * A provider form - SAML or OpenID Connect, for a project, a status page or
 * the whole instance - asks two things: which identity provider (its name
 * and what OneUptime needs to talk to it), and how people sign in with it
 * (whether it is on, which teams a newcomer joins, what the sign-in page
 * says). So it walks two steps, Provider and Sign-in, and everything with a
 * sensible answer waits folded under the Sign-in step's Advanced section.
 *
 * The fields written once for every provider form:
 *
 *   - Name: what people see on the sign-in page. While the description is
 *     the one the name gives ("Sign in with Okta"), it follows the name as it
 *     is typed, on a create form and an edit form alike, so a rename never
 *     leaves a stale description behind.
 *   - Description: shown under the name. Always folded; the services fill
 *     the same text in when an API caller leaves it out
 *     (Types/SSO/SsoProviderDefaults).
 *   - Enabled: whether people can sign in with the provider. It starts off,
 *     as its column does: the identity provider has to be told OneUptime's
 *     URLs first, and those exist once the provider is saved.
 *   - Teams (project providers): the teams people join when they first sign
 *     in. The project's settings pages start it on the members team, and
 *     say under it which picked teams the person could not invite someone
 *     to: the server saves a provider only with teams the person saving it
 *     could grant (Server/Utils/SsoProviderTeamGrant).
 *   - Who can sign in and Where this sign-in counts as SSO (the
 *     instance-wide providers of the Admin Dashboard): two plain choices
 *     written into the Disable Sign Up with SSO and Restrict to Attached
 *     Projects columns, each starting on its first answer (off, as the
 *     column does), always folded under Advanced. While both are on their
 *     first answers a newcomer who signs in joins the projects attached to
 *     the provider, which is what the folded section says.
 *
 * Use each helper with the step (and, for the folded description, the
 * form's Advanced section) written in the call:
 *
 *   getSsoProviderNameField<ProjectOIDC>({ stepId: "provider" })
 *   getSsoProviderDescriptionField<ProjectOIDC>({
 *     stepId: "sign-in",
 *     collapsibleSection: advancedSection,
 *   })
 *
 * Tests/Helpers/FormStepsScan reads what a call hands a helper, so the
 * guards place each field on its step and in its section.
 *
 * React-free: the Dashboard and the Admin Dashboard both build their forms
 * from it.
 */

export const SSO_PROVIDER_STEP_ID: string = "provider";

export const SSO_SIGN_IN_STEP_ID: string = "sign-in";

export type GetSsoProviderFormStepsFunction = <TEntity>() => Array<
  FormStep<TEntity>
>;

// Provider, then Sign-in: the steps of every provider form.
export const getSsoProviderFormSteps: GetSsoProviderFormStepsFunction = <
  TEntity,
>(): Array<FormStep<TEntity>> => {
  return [
    { title: "Provider", id: "provider" },
    { title: "Sign-in", id: "sign-in" },
  ];
};

export const SSO_PROVIDER_NAME_DESCRIPTION: string = translationKey(
  "What people see on the sign-in page.",
);

export const SSO_PROVIDER_DESCRIPTION_DESCRIPTION: string = translationKey(
  "Shown under the name on the sign-in page.",
);

export const SSO_PROVIDER_ENABLED_DESCRIPTION: string = translationKey(
  "People can sign in with this provider only while it is on. Turn it on once your identity provider has the URLs OneUptime shows after you save.",
);

export const SSO_PROVIDER_TEAMS_DESCRIPTION: string = translationKey(
  "Add users to these teams when they sign up.",
);

/*
 * What the folded Advanced section of an instance-wide provider says while
 * both of its switches are off.
 */
export const SSO_GLOBAL_ADVANCED_DEFAULTS_SUMMARY: string = translationKey(
  "People who sign in for the first time join the projects you attach.",
);

/*
 * THE INSTANCE-WIDE PROVIDER'S TWO QUESTIONS, AS PLAIN CHOICES.
 *
 * "Shouldnt this be two buttons ... to make it easier for people to
 * understand whats going on." (the maintainer, on a switch whose
 * description explained both of its modes)
 *
 * "Disable Sign Up with SSO" and "Restrict to Attached Projects" were two
 * switches, each with a "When on, ..." sentence that explained both of its
 * modes - the first one a switch named for turning something off. Each is
 * now its question with two answers, the default first, one line under
 * each:
 *
 *   Who can sign in                 Anyone your provider lets in (off)
 *                                   Only invited people (on)
 *   Where this sign-in counts       Every project (off)
 *   as SSO                          Attached projects only (on)
 *
 * The answers are written into the same two boolean columns
 * (disableSignUpWithSso, restrictToAttachedProjects), which the form loads
 * and saves unseen: the API, Terraform, the sign-in routes and every
 * provider already set up read them as before.
 */
export const SSO_GLOBAL_SIGN_UP_FIELD_KEY: string = "whoCanSignInChoice";

export const SSO_GLOBAL_SIGN_UP_TITLE: string =
  translationKey("Who can sign in");

export const SSO_GLOBAL_SIGN_UP_ANYONE: string = "anyone";

export const SSO_GLOBAL_SIGN_UP_INVITED: string = "invited";

export const SSO_GLOBAL_SIGN_UP_CHOICES: Array<RadioButton> = [
  {
    value: SSO_GLOBAL_SIGN_UP_ANYONE,
    title: translationKey("Anyone your provider lets in"),
    description: translationKey(
      "People without an account get one on their first sign-in.",
    ),
  },
  {
    value: SSO_GLOBAL_SIGN_UP_INVITED,
    title: translationKey("Only invited people"),
    description: translationKey(
      "People must be invited to a project before they can sign in.",
    ),
  },
];

export const SSO_GLOBAL_REACH_FIELD_KEY: string = "whereSignInCountsChoice";

export const SSO_GLOBAL_REACH_TITLE: string = translationKey(
  "Where this sign-in counts as SSO",
);

export const SSO_GLOBAL_REACH_EVERY_PROJECT: string = "everyProject";

export const SSO_GLOBAL_REACH_ATTACHED_ONLY: string = "attachedOnly";

/*
 * Restricting narrows access for people who are already signed in, which
 * the old wording said in capitals; the second answer still says so.
 */
export const SSO_GLOBAL_REACH_CHOICES: Array<RadioButton> = [
  {
    value: SSO_GLOBAL_REACH_EVERY_PROJECT,
    title: translationKey("Every project"),
    description: translationKey(
      "Projects that require SSO accept a sign-in with this provider.",
    ),
  },
  {
    value: SSO_GLOBAL_REACH_ATTACHED_ONLY,
    title: translationKey("Attached projects only"),
    description: translationKey(
      "Other projects that require SSO turn it away, even for people already signed in.",
    ),
  },
];

// The answer each column's value reads as: off is the first answer.
export const getSsoGlobalSignUpAnswer: (values: unknown) => string = (
  values: unknown,
): string => {
  return readSsoFormValue(values, "disableSignUpWithSso") === true
    ? SSO_GLOBAL_SIGN_UP_INVITED
    : SSO_GLOBAL_SIGN_UP_ANYONE;
};

export const getSsoGlobalReachAnswer: (values: unknown) => string = (
  values: unknown,
): string => {
  return readSsoFormValue(values, "restrictToAttachedProjects") === true
    ? SSO_GLOBAL_REACH_ATTACHED_ONLY
    : SSO_GLOBAL_REACH_EVERY_PROJECT;
};

// The answer's title, as a provider's page shows what is set.
export const getSsoGlobalSignUpAnswerTitle: (values: unknown) => string = (
  values: unknown,
): string => {
  return getSsoGlobalSignUpAnswer(values) === SSO_GLOBAL_SIGN_UP_INVITED
    ? (SSO_GLOBAL_SIGN_UP_CHOICES[1] as RadioButton).title
    : (SSO_GLOBAL_SIGN_UP_CHOICES[0] as RadioButton).title;
};

export const getSsoGlobalReachAnswerTitle: (values: unknown) => string = (
  values: unknown,
): string => {
  return getSsoGlobalReachAnswer(values) === SSO_GLOBAL_REACH_ATTACHED_ONLY
    ? (SSO_GLOBAL_REACH_CHOICES[1] as RadioButton).title
    : (SSO_GLOBAL_REACH_CHOICES[0] as RadioButton).title;
};

export interface SsoProviderFieldOptions {
  // The step the field is on: SSO_PROVIDER_STEP_ID or SSO_SIGN_IN_STEP_ID.
  stepId: string;
}

export interface SsoProviderFoldedFieldOptions<TEntity>
  extends SsoProviderFieldOptions {
  /*
   * The form's Advanced section (getAdvancedFormSection), built once and
   * handed to every field folded in it.
   */
  collapsibleSection: FormFieldCollapsibleSection<TEntity>;
}

type ReadValueFunction = (values: unknown, key: string) => unknown;

// One value of a form's values, whatever the form's model.
export const readSsoFormValue: ReadValueFunction = (
  values: unknown,
  key: string,
): unknown => {
  if (!values || typeof values !== "object") {
    return undefined;
  }

  return (values as Record<string, unknown>)[key];
};

type AsTextFunction = (value: unknown) => string;

// A form value as text: what a text field shows for it.
export const ssoFormValueAsText: AsTextFunction = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
};

/**
 * Whether an instance-wide provider's two switches are where they start:
 * both off.
 */
export const isSsoGlobalAccessAtDefaults: (values: unknown) => boolean = (
  values: unknown,
): boolean => {
  return (
    !readSsoFormValue(values, "disableSignUpWithSso") &&
    !readSsoFormValue(values, "restrictToAttachedProjects")
  );
};

/**
 * The description once the name is changed to `name`: the one the new name
 * gives, while the description is still the old name's (or empty). Null when
 * it stays as it is - somebody wrote their own.
 */
export const getSsoProviderDescriptionAfterRename: (data: {
  // The form's values before the change.
  values: unknown;
  name: unknown;
}) => string | null = (data: {
  values: unknown;
  name: unknown;
}): string | null => {
  const isTheFormsOwn: boolean = isDefaultSsoProviderDescription({
    description: ssoFormValueAsText(
      readSsoFormValue(data.values, "description"),
    ),
    name: ssoFormValueAsText(readSsoFormValue(data.values, "name")),
  });

  if (!isTheFormsOwn) {
    return null;
  }

  return getDefaultSsoProviderDescription(ssoFormValueAsText(data.name));
};

export type GetSsoProviderFieldFunction = <TEntity>(
  options: SsoProviderFieldOptions,
) => Field<TEntity>;

export type GetSsoProviderFoldedFieldFunction = <TEntity>(
  options: SsoProviderFoldedFieldOptions<TEntity>,
) => Field<TEntity>;

export const getSsoProviderNameField: GetSsoProviderFieldFunction = <TEntity>(
  options: SsoProviderFieldOptions,
): Field<TEntity> => {
  return {
    field: { name: true } as unknown as SelectFormFields<TEntity>,
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    description: SSO_PROVIDER_NAME_DESCRIPTION,
    placeholder: "Okta",
    validation: { minLength: 2 },
    stepId: options.stepId,
    onChange: (
      value: unknown,
      currentValues: FormValues<TEntity>,
      setNewFormValues: (values: FormValues<TEntity>) => void,
    ): void => {
      const description: string | null = getSsoProviderDescriptionAfterRename({
        values: currentValues,
        name: value,
      });

      if (
        description === null ||
        description ===
          ssoFormValueAsText(readSsoFormValue(currentValues, "description"))
      ) {
        return;
      }

      setNewFormValues({
        ...currentValues,
        description,
      } as FormValues<TEntity>);
    },
  };
};

export const getSsoProviderDescriptionField: GetSsoProviderFoldedFieldFunction =
  <TEntity>(
    options: SsoProviderFoldedFieldOptions<TEntity>,
  ): Field<TEntity> => {
    return {
      field: { description: true } as unknown as SelectFormFields<TEntity>,
      title: "Description",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      description: SSO_PROVIDER_DESCRIPTION_DESCRIPTION,
      placeholder: "Sign in with Okta",
      stepId: options.stepId,
      collapsibleSection: options.collapsibleSection,
      // "Sign in with" and the name, followed as the name changes.
      isAtDefault: (values: FormValues<TEntity>): boolean => {
        return isDefaultSsoProviderDescription({
          description: ssoFormValueAsText(
            readSsoFormValue(values, "description"),
          ),
          name: ssoFormValueAsText(readSsoFormValue(values, "name")),
        });
      },
    };
  };

export const getSsoProviderEnabledField: GetSsoProviderFieldFunction = <
  TEntity,
>(
  options: SsoProviderFieldOptions,
): Field<TEntity> => {
  return {
    field: { isEnabled: true } as unknown as SelectFormFields<TEntity>,
    title: "Enabled",
    fieldType: FormFieldSchemaType.Toggle,
    description: SSO_PROVIDER_ENABLED_DESCRIPTION,
    stepId: options.stepId,
  };
};

/*
 * What a page may draw under the Teams field, from the form's values: the
 * Dashboard says there which picked teams the person could not invite
 * someone to, since the server will not save a provider with them
 * (Dashboard Components/Sso/SsoTeamsGrantNote).
 */
export type SsoProviderTeamsFooterFunction = (
  values: unknown,
) => ReactElement | undefined;

export interface SsoProviderTeamsFieldOptions extends SsoProviderFieldOptions {
  getFooterElement?: SsoProviderTeamsFooterFunction | undefined;
}

export type GetSsoProviderTeamsFieldFunction = <TEntity>(
  options: SsoProviderTeamsFieldOptions,
) => Field<TEntity>;

export const getSsoProviderTeamsField: GetSsoProviderTeamsFieldFunction = <
  TEntity,
>(
  options: SsoProviderTeamsFieldOptions,
): Field<TEntity> => {
  const getFooterElement: SsoProviderTeamsFooterFunction | undefined =
    options.getFooterElement;

  return {
    field: { teams: true } as unknown as SelectFormFields<TEntity>,
    title: "Teams",
    description: SSO_PROVIDER_TEAMS_DESCRIPTION,
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownModal: {
      type: Team,
      labelField: "name",
      valueField: "_id",
    },
    required: true,
    placeholder: "Select Teams",
    stepId: options.stepId,
    ...(getFooterElement
      ? {
          getFooterElement: (
            values: FormValues<TEntity>,
          ): ReactElement | undefined => {
            return getFooterElement(values);
          },
        }
      : {}),
  };
};

export type GetSsoProviderFoldedFieldsFunction = <TEntity>(
  options: SsoProviderFoldedFieldOptions<TEntity>,
) => Array<Field<TEntity>>;

/*
 * The instance-wide provider's two questions (see SSO_GLOBAL_SIGN_UP_CHOICES
 * and SSO_GLOBAL_REACH_CHOICES). Each is a form-only choice that starts on
 * the answer its column holds - off, the first answer, for a new provider,
 * as the column's default - and writes the column when picked; the column
 * itself is registered unseen right after it, so the form loads and saves
 * it. Both are always folded under the form's Advanced section.
 */
export const getSsoProviderSignUpChoiceFields: GetSsoProviderFoldedFieldsFunction =
  <TEntity>(
    options: SsoProviderFoldedFieldOptions<TEntity>,
  ): Array<Field<TEntity>> => {
    return [
      {
        // The column stands in for the field's permissions; the value is not sent.
        field: {
          disableSignUpWithSso: true,
        } as unknown as SelectFormFields<TEntity>,
        overrideFieldKey: SSO_GLOBAL_SIGN_UP_FIELD_KEY,
        formOnly: true,
        title: SSO_GLOBAL_SIGN_UP_TITLE,
        fieldType: FormFieldSchemaType.RadioButton,
        radioButtonOptions: SSO_GLOBAL_SIGN_UP_CHOICES,
        required: true,
        dataTestId: "sso-global-sign-up",
        // Each answer says what it means; the column's sentence is for the API.
        hideColumnDescription: true,
        stepId: options.stepId,
        collapsibleSection: options.collapsibleSection,
        getDefaultValue: (values: FormValues<TEntity>): string => {
          return getSsoGlobalSignUpAnswer(values);
        },
        isAtDefault: (values: FormValues<TEntity>): boolean => {
          return getSsoGlobalSignUpAnswer(values) === SSO_GLOBAL_SIGN_UP_ANYONE;
        },
        onChange: (
          value: unknown,
          currentValues: FormValues<TEntity>,
          setNewFormValues: (values: FormValues<TEntity>) => void,
        ): void => {
          setNewFormValues({
            ...(currentValues as Record<string, unknown>),
            disableSignUpWithSso: value === SSO_GLOBAL_SIGN_UP_INVITED,
          } as unknown as FormValues<TEntity>);
        },
      },
      {
        field: {
          disableSignUpWithSso: true,
        } as unknown as SelectFormFields<TEntity>,
        title: "Disable Sign Up with SSO",
        fieldType: FormFieldSchemaType.Toggle,
        stepId: options.stepId,
        showIf: (): boolean => {
          return false;
        },
      },
    ];
  };

export const getSsoProviderReachChoiceFields: GetSsoProviderFoldedFieldsFunction =
  <TEntity>(
    options: SsoProviderFoldedFieldOptions<TEntity>,
  ): Array<Field<TEntity>> => {
    return [
      {
        // The column stands in for the field's permissions; the value is not sent.
        field: {
          restrictToAttachedProjects: true,
        } as unknown as SelectFormFields<TEntity>,
        overrideFieldKey: SSO_GLOBAL_REACH_FIELD_KEY,
        formOnly: true,
        title: SSO_GLOBAL_REACH_TITLE,
        fieldType: FormFieldSchemaType.RadioButton,
        radioButtonOptions: SSO_GLOBAL_REACH_CHOICES,
        required: true,
        dataTestId: "sso-global-reach",
        // Each answer says what it means; the column's sentence is for the API.
        hideColumnDescription: true,
        stepId: options.stepId,
        collapsibleSection: options.collapsibleSection,
        getDefaultValue: (values: FormValues<TEntity>): string => {
          return getSsoGlobalReachAnswer(values);
        },
        isAtDefault: (values: FormValues<TEntity>): boolean => {
          return (
            getSsoGlobalReachAnswer(values) === SSO_GLOBAL_REACH_EVERY_PROJECT
          );
        },
        onChange: (
          value: unknown,
          currentValues: FormValues<TEntity>,
          setNewFormValues: (values: FormValues<TEntity>) => void,
        ): void => {
          setNewFormValues({
            ...(currentValues as Record<string, unknown>),
            restrictToAttachedProjects:
              value === SSO_GLOBAL_REACH_ATTACHED_ONLY,
          } as unknown as FormValues<TEntity>);
        },
      },
      {
        field: {
          restrictToAttachedProjects: true,
        } as unknown as SelectFormFields<TEntity>,
        title: "Restrict to Attached Projects",
        fieldType: FormFieldSchemaType.Toggle,
        stepId: options.stepId,
        showIf: (): boolean => {
          return false;
        },
      },
    ];
  };
