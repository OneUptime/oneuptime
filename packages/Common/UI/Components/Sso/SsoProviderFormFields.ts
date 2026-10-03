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
 *     in. The project's settings pages start it on the members team.
 *   - Disable Sign Up with SSO and Restrict to Attached Projects (the
 *     instance-wide providers of the Admin Dashboard): two switches that
 *     start off, as their columns do, always folded under Advanced. While
 *     both are off a newcomer who signs in joins the projects attached to
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

export const SSO_GLOBAL_DISABLE_SIGN_UP_DESCRIPTION: string = translationKey(
  "When on, people must be invited to a project before they can sign in with this provider. Nobody new is created on their first sign-in.",
);

/*
 * Turning it on narrows access for people who are already signed in, which
 * the old wording said in capitals; it still says so.
 */
export const SSO_GLOBAL_RESTRICT_DESCRIPTION: string = translationKey(
  "When on, signing in with this provider meets SSO enforcement only in the projects attached to it, so people already signed in can lose access to other projects. When off, it meets it in every project the person belongs to, and attached projects only decide where newcomers are added.",
);

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

export const getSsoProviderTeamsField: GetSsoProviderFieldFunction = <TEntity>(
  options: SsoProviderFieldOptions,
): Field<TEntity> => {
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
  };
};

/*
 * The instance-wide provider's two switches. Each starts off, as its column
 * does, so neither writes a default of its own; they are always folded under
 * the form's Advanced section.
 */
export const getSsoProviderDisableSignUpField: GetSsoProviderFoldedFieldFunction =
  <TEntity>(
    options: SsoProviderFoldedFieldOptions<TEntity>,
  ): Field<TEntity> => {
    return {
      field: {
        disableSignUpWithSso: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Disable Sign Up with SSO",
      fieldType: FormFieldSchemaType.Toggle,
      description: SSO_GLOBAL_DISABLE_SIGN_UP_DESCRIPTION,
      stepId: options.stepId,
      collapsibleSection: options.collapsibleSection,
    };
  };

export const getSsoProviderRestrictToAttachedProjectsField: GetSsoProviderFoldedFieldFunction =
  <TEntity>(
    options: SsoProviderFoldedFieldOptions<TEntity>,
  ): Field<TEntity> => {
    return {
      field: {
        restrictToAttachedProjects: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Restrict to Attached Projects",
      fieldType: FormFieldSchemaType.Toggle,
      description: SSO_GLOBAL_RESTRICT_DESCRIPTION,
      stepId: options.stepId,
      collapsibleSection: options.collapsibleSection,
    };
  };
