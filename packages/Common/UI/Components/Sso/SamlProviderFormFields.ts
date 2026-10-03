import DigestMethod from "../../../Types/SSO/DigestMethod";
import {
  DEFAULT_SAML_DIGEST_METHOD,
  DEFAULT_SAML_SIGNATURE_METHOD,
} from "../../../Types/SSO/SamlProviderDefaults";
import SignatureMethod from "../../../Types/SSO/SignatureMethod";
import {
  isBlankSsoValue,
  isDefaultSsoProviderDescription,
} from "../../../Types/SSO/SsoProviderDefaults";
import SelectFormFields from "../../Types/SelectEntityField";
import { translationKey } from "../../Utils/TranslateTemplate";
import { DropdownOption } from "../Dropdown/Dropdown";
import Field, { FormFieldCollapsibleSection } from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import { getAdvancedFormSection } from "../Forms/Utils/AdvancedFormSection";
import {
  SSO_GLOBAL_ADVANCED_DEFAULTS_SUMMARY,
  getSsoProviderDescriptionField,
  getSsoProviderDisableSignUpField,
  getSsoProviderEnabledField,
  getSsoProviderNameField,
  getSsoProviderRestrictToAttachedProjectsField,
  getSsoProviderTeamsField,
  isSsoGlobalAccessAtDefaults,
  readSsoFormValue,
  ssoFormValueAsText,
} from "./SsoProviderFormFields";

/*
 * ADDING A SAML PROVIDER ASKS ONLY FOR WHAT THE IDENTITY PROVIDER GIVES YOU.
 *
 * The three SAML provider forms - Settings > SSO, a status page's SSO and the
 * Admin Dashboard's Global SSO - each walked four steps (Basic Info, Sign On,
 * Certificate, More). They asked for a description, required, and for a
 * signature method and a digest method: two required dropdowns with nothing
 * picked, whose help said to "leave this to RSA-SHA256" and "SHA256". The
 * status page's last step held one switch, and a project's provider could
 * not be saved before someone chose its teams. They are now one form, built
 * here, in the two steps every single sign-on provider form walks
 * (SsoProviderFormFields, the same as OpenID Connect's):
 *
 *   Provider   Name, Sign On URL, Issuer, Public Certificate - what the
 *              identity provider gives you.
 *   Sign-in    The teams newcomers join (a project's provider, starting on
 *              the members team), Enabled, and one folded Advanced section:
 *              the signature and digest methods, at RSA-SHA256 and SHA256;
 *              the description, which follows the name; and, on the Global
 *              form, its two sign-up and access switches. While all of it is
 *              at those defaults the folded header says so in a sentence;
 *              once something differs it says "Configured".
 *
 * The Sign-in step needs nothing typed, so the dialog can be finished from
 * the first step. The edit dialogs use the same layout, and a rename moves
 * the description along only while it is the one the old name gave.
 *
 * What the form fills in is what the services fill in for an API caller who
 * leaves it out (Types/SSO/SamlProviderDefaults), so the form shows what is
 * saved either way.
 */

export interface SamlProviderFormOptions {
  // A project's provider: the teams people join when they first sign in.
  withTeams?: boolean | undefined;
  /*
   * The instance-wide provider (Admin Dashboard > Global SSO): its
   * "Disable Sign Up with SSO" and "Restrict to Attached Projects" switches,
   * folded under Advanced.
   */
  withGlobalAccessSwitches?: boolean | undefined;
}

export const SAML_SIGN_ON_URL_DESCRIPTION: string = translationKey(
  "Your identity provider's single sign-on URL. OneUptime sends people there to sign in.",
);

export const SAML_ISSUER_DESCRIPTION: string = translationKey(
  "Your identity provider's issuer (its entity ID), exactly as the provider shows it.",
);

export const SAML_PUBLIC_CERTIFICATE_DESCRIPTION: string = translationKey(
  "The X.509 certificate your identity provider signs with, including its BEGIN CERTIFICATE and END CERTIFICATE lines.",
);

export const SAML_SIGNATURE_METHOD_DESCRIPTION: string = translationKey(
  "The algorithm your identity provider signs with. Most use RSA-SHA256.",
);

export const SAML_DIGEST_METHOD_DESCRIPTION: string = translationKey(
  "The digest algorithm your identity provider signs with. Most use SHA256.",
);

/*
 * What the folded Advanced section says while everything in it is at its
 * default, in place of the "Configured" badge.
 */
export const SAML_ADVANCED_DEFAULTS_SUMMARY: string = translationKey(
  "Signatures use RSA-SHA256 with a SHA256 digest, as most identity providers do.",
);

/*
 * The choices of the two dropdowns, each shown as the value it saves: they
 * are identifiers ("RSA-SHA256"), not words.
 */
const optionsOf: (values: Array<string>) => Array<DropdownOption> = (
  values: Array<string>,
): Array<DropdownOption> => {
  return values.map((value: string): DropdownOption => {
    return { label: value, value: value };
  });
};

export const SAML_SIGNATURE_METHOD_OPTIONS: Array<DropdownOption> = optionsOf(
  Object.values(SignatureMethod),
);

export const SAML_DIGEST_METHOD_OPTIONS: Array<DropdownOption> = optionsOf(
  Object.values(DigestMethod),
);

type DropdownValueAsTextFunction = (value: unknown) => string;

/*
 * A dropdown's value as text: a form can hold the option it was picked as
 * ({ label, value }) rather than its value.
 */
const dropdownValueAsText: DropdownValueAsTextFunction = (
  value: unknown,
): string => {
  if (value && typeof value === "object" && "value" in value) {
    return ssoFormValueAsText((value as { value: unknown }).value);
  }

  return ssoFormValueAsText(value);
};

type IsAtDefaultFunction = (value: unknown, defaultValue: string) => boolean;

const isAtDefault: IsAtDefaultFunction = (
  value: unknown,
  defaultValue: string,
): boolean => {
  return (
    isBlankSsoValue(dropdownValueAsText(value)) ||
    dropdownValueAsText(value).trim() === defaultValue
  );
};

/**
 * Whether everything the Advanced section folds is what the form would fill
 * in on its own: RSA-SHA256 and SHA256, the description the name gives, and
 * (on the Global form) both switches off.
 */
export const isSamlAdvancedAtDefaults: (
  values: unknown,
  options?: SamlProviderFormOptions,
) => boolean = (
  values: unknown,
  options?: SamlProviderFormOptions,
): boolean => {
  const read: (key: string) => unknown = (key: string): unknown => {
    return readSsoFormValue(values, key);
  };

  if (
    !isAtDefault(read("signatureMethod"), DEFAULT_SAML_SIGNATURE_METHOD) ||
    !isAtDefault(read("digestMethod"), DEFAULT_SAML_DIGEST_METHOD)
  ) {
    return false;
  }

  if (
    !isDefaultSsoProviderDescription({
      description: ssoFormValueAsText(read("description")),
      name: ssoFormValueAsText(read("name")),
    })
  ) {
    return false;
  }

  if (
    options?.withGlobalAccessSwitches &&
    !isSsoGlobalAccessAtDefaults(values)
  ) {
    return false;
  }

  return true;
};

export type GetSamlAdvancedSectionFunction = <TEntity>(
  options?: SamlProviderFormOptions,
) => FormFieldCollapsibleSection<TEntity>;

/*
 * The Sign-in step's Advanced section: folded on Create and Edit; while
 * everything in it is at its default its header says what that default
 * does, and once something differs it says "Configured".
 */
export const getSamlAdvancedSection: GetSamlAdvancedSectionFunction = <TEntity>(
  options?: SamlProviderFormOptions,
): FormFieldCollapsibleSection<TEntity> => {
  return getAdvancedFormSection<TEntity>({
    isConfigured: (values: FormValues<TEntity>): boolean => {
      return !isSamlAdvancedAtDefaults(values, options);
    },
    getSummary: (values: FormValues<TEntity>): Array<string> | undefined => {
      if (!isSamlAdvancedAtDefaults(values, options)) {
        return undefined;
      }

      return options?.withGlobalAccessSwitches
        ? [SAML_ADVANCED_DEFAULTS_SUMMARY, SSO_GLOBAL_ADVANCED_DEFAULTS_SUMMARY]
        : [SAML_ADVANCED_DEFAULTS_SUMMARY];
    },
  });
};

export type GetSamlProviderFormFieldsFunction = <TEntity>(
  options?: SamlProviderFormOptions,
) => Array<Field<TEntity>>;

/**
 * The fields of a SAML provider form, create and edit alike, on the steps
 * getSsoProviderFormSteps() declares.
 */
export const getSamlProviderFormFields: GetSamlProviderFormFieldsFunction = <
  TEntity,
>(
  options?: SamlProviderFormOptions,
): Array<Field<TEntity>> => {
  const advancedSection: FormFieldCollapsibleSection<TEntity> =
    getSamlAdvancedSection<TEntity>(options);

  return [
    getSsoProviderNameField<TEntity>({ stepId: "provider" }),
    {
      field: { signOnURL: true } as unknown as SelectFormFields<TEntity>,
      title: "Sign On URL",
      fieldType: FormFieldSchemaType.URL,
      required: true,
      description: SAML_SIGN_ON_URL_DESCRIPTION,
      placeholder: "https://yourapp.example.com/apps/appId",
      stepId: "provider",
      disableSpellCheck: true,
    },
    {
      field: { issuerURL: true } as unknown as SelectFormFields<TEntity>,
      title: "Issuer",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      description: SAML_ISSUER_DESCRIPTION,
      placeholder: "https://example.com",
      stepId: "provider",
      disableSpellCheck: true,
    },
    {
      field: {
        publicCertificate: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Public Certificate",
      fieldType: FormFieldSchemaType.LongText,
      required: true,
      description: SAML_PUBLIC_CERTIFICATE_DESCRIPTION,
      placeholder: "Paste in your x509 certificate here.",
      stepId: "provider",
      disableSpellCheck: true,
    },
    ...(options?.withTeams
      ? [getSsoProviderTeamsField<TEntity>({ stepId: "sign-in" })]
      : []),
    getSsoProviderEnabledField<TEntity>({ stepId: "sign-in" }),
    /*
     * Required, and started on the value nearly every identity provider
     * uses, so the form never stops on them; the services fill the same in
     * for an API caller who leaves them out.
     */
    {
      field: {
        signatureMethod: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Signature Method",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: SAML_SIGNATURE_METHOD_OPTIONS,
      required: true,
      description: SAML_SIGNATURE_METHOD_DESCRIPTION,
      placeholder: DEFAULT_SAML_SIGNATURE_METHOD,
      defaultValue: DEFAULT_SAML_SIGNATURE_METHOD,
      stepId: "sign-in",
      collapsibleSection: advancedSection,
    },
    {
      field: { digestMethod: true } as unknown as SelectFormFields<TEntity>,
      title: "Digest Method",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: SAML_DIGEST_METHOD_OPTIONS,
      required: true,
      description: SAML_DIGEST_METHOD_DESCRIPTION,
      placeholder: DEFAULT_SAML_DIGEST_METHOD,
      defaultValue: DEFAULT_SAML_DIGEST_METHOD,
      stepId: "sign-in",
      collapsibleSection: advancedSection,
    },
    getSsoProviderDescriptionField<TEntity>({
      stepId: "sign-in",
      collapsibleSection: advancedSection,
    }),
    ...(options?.withGlobalAccessSwitches
      ? [
          getSsoProviderDisableSignUpField<TEntity>({
            stepId: "sign-in",
            collapsibleSection: advancedSection,
          }),
          getSsoProviderRestrictToAttachedProjectsField<TEntity>({
            stepId: "sign-in",
            collapsibleSection: advancedSection,
          }),
        ]
      : []),
  ];
};
