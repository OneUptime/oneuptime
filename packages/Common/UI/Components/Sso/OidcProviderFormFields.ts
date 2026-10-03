import {
  DEFAULT_OIDC_EMAIL_CLAIM_NAME,
  DEFAULT_OIDC_NAME_CLAIM_NAME,
  DEFAULT_OIDC_SCOPES,
  OidcIssuerParts,
  getOidcDiscoveryUrl,
  includesRequiredOidcScope,
  isDefaultOidcDiscoveryUrl,
  isOidcIssuerUrl,
  splitOidcDiscoveryUrl,
} from "../../../Types/SSO/OidcProviderDefaults";
import {
  isBlankSsoValue,
  isDefaultSsoProviderDescription,
} from "../../../Types/SSO/SsoProviderDefaults";
import SelectFormFields from "../../Types/SelectEntityField";
import { translationKey } from "../../Utils/TranslateTemplate";
import Field, { FormFieldCollapsibleSection } from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import { getAdvancedFormSection } from "../Forms/Utils/AdvancedFormSection";
import { translateValidationMessage } from "../Forms/Validation";
import {
  SSO_GLOBAL_ADVANCED_DEFAULTS_SUMMARY,
  SSO_GLOBAL_DISABLE_SIGN_UP_DESCRIPTION,
  SSO_GLOBAL_RESTRICT_DESCRIPTION,
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
 * ADDING AN OPENID CONNECT PROVIDER ASKS FOR THE ISSUER, THE CLIENT ID AND THE
 * SECRET; THE REST IS FILLED IN.
 *
 * The three OIDC provider forms - Settings > OIDC, a status page's OIDC and
 * the Admin Dashboard's Global OIDC - each walked four steps and asked for
 * eleven things, a description among them, and both a discovery URL and an
 * issuer, although the first is the second plus
 * /.well-known/openid-configuration. Scopes and claim names came as fields
 * nearly everyone left alone, and the Global form did not even fill them in.
 * They are now one form, built here, in two steps:
 *
 *   Provider   Name, Issuer URL, Client ID, Client Secret - what the identity
 *              provider gives you. A discovery URL pasted as the issuer is
 *              split into the two.
 *   Sign-in    The teams newcomers join (a project's provider), Enabled, and
 *              one folded Advanced section: the discovery URL, which follows
 *              the issuer; the scopes and the two claim names, at their usual
 *              values; the description, which follows the name; and, on the
 *              Global form, its two sign-up and access switches. While all
 *              of it is at those defaults the folded header says so in a
 *              sentence; once something differs it says "Configured".
 *
 * The Sign-in step needs nothing typed (Teams starts on the members team
 * where the project has one), so the dialog can be finished from the first
 * step. The edit dialogs use the same layout, and a rename or a new issuer
 * moves the description and the discovery URL along only while they are the
 * ones the old name and issuer gave.
 *
 * What the form fills in is what the services fill in for an API caller who
 * leaves it out (Types/SSO/OidcProviderDefaults), so the form shows what is
 * saved either way.
 */

export interface OidcProviderFormOptions {
  // A project's provider: the teams people join when they first sign in.
  withTeams?: boolean | undefined;
  /*
   * The instance-wide provider (Admin Dashboard > Global OIDC): its
   * "Disable Sign Up with SSO" and "Restrict to Attached Projects" switches,
   * folded under Advanced.
   */
  withGlobalAccessSwitches?: boolean | undefined;
}

export const OIDC_ISSUER_DESCRIPTION: string = translationKey(
  "Your identity provider's issuer, exactly as the provider shows it. Pasting its discovery URL works too.",
);

export const OIDC_DISCOVERY_URL_DESCRIPTION: string = translationKey(
  "Where OneUptime finds the provider's endpoints. It follows the issuer; change it only if your provider publishes its discovery document somewhere else.",
);

export const OIDC_ISSUER_URL_ERROR: string = translationKey(
  "Enter the issuer as a URL that starts with https://.",
);

export const OIDC_SCOPES_WITHOUT_OPENID_ERROR: string = translationKey(
  "The scopes must include openid.",
);

/*
 * What the folded Advanced section says while everything in it is at its
 * default, in place of the "Configured" badge.
 */
export const OIDC_ADVANCED_DEFAULTS_SUMMARY: string = translationKey(
  "Endpoints are found from the issuer, and sign-in asks for the openid, email and profile scopes.",
);

/*
 * The instance-wide provider's switches and what its folded section says
 * about them are the same for SAML and OIDC (SsoProviderFormFields).
 */
export const GLOBAL_OIDC_ADVANCED_DEFAULTS_SUMMARY: string =
  SSO_GLOBAL_ADVANCED_DEFAULTS_SUMMARY;

export const GLOBAL_OIDC_DISABLE_SIGN_UP_DESCRIPTION: string =
  SSO_GLOBAL_DISABLE_SIGN_UP_DESCRIPTION;

export const GLOBAL_OIDC_RESTRICT_DESCRIPTION: string =
  SSO_GLOBAL_RESTRICT_DESCRIPTION;

type IsAtDefaultFunction = (value: unknown, defaultValue: string) => boolean;

const isAtDefault: IsAtDefaultFunction = (
  value: unknown,
  defaultValue: string,
): boolean => {
  return (
    isBlankSsoValue(value) || ssoFormValueAsText(value).trim() === defaultValue
  );
};

/**
 * Whether everything the Advanced section folds is what the form would fill
 * in on its own: the discovery URL the issuer gives, the usual scopes and
 * claim names, the description the name gives, and (on the Global form) both
 * switches off.
 */
export const isOidcAdvancedAtDefaults: (
  values: unknown,
  options?: OidcProviderFormOptions,
) => boolean = (
  values: unknown,
  options?: OidcProviderFormOptions,
): boolean => {
  const read: (key: string) => unknown = (key: string): unknown => {
    return readSsoFormValue(values, key);
  };

  if (
    !isDefaultOidcDiscoveryUrl({
      discoveryURL: ssoFormValueAsText(read("discoveryURL")),
      issuerURL: ssoFormValueAsText(read("issuerURL")),
    })
  ) {
    return false;
  }

  if (
    !isAtDefault(read("scopes"), DEFAULT_OIDC_SCOPES) ||
    !isAtDefault(read("emailClaimName"), DEFAULT_OIDC_EMAIL_CLAIM_NAME) ||
    !isAtDefault(read("nameClaimName"), DEFAULT_OIDC_NAME_CLAIM_NAME)
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

export type GetOidcAdvancedSectionFunction = <TEntity>(
  options?: OidcProviderFormOptions,
) => FormFieldCollapsibleSection<TEntity>;

/*
 * The Sign-in step's Advanced section: folded on Create and Edit; while
 * everything in it is at its default its header says what that default
 * does, and once something differs it says "Configured".
 */
export const getOidcAdvancedSection: GetOidcAdvancedSectionFunction = <TEntity>(
  options?: OidcProviderFormOptions,
): FormFieldCollapsibleSection<TEntity> => {
  return getAdvancedFormSection<TEntity>({
    isConfigured: (values: FormValues<TEntity>): boolean => {
      return !isOidcAdvancedAtDefaults(values, options);
    },
    getSummary: (values: FormValues<TEntity>): Array<string> | undefined => {
      if (!isOidcAdvancedAtDefaults(values, options)) {
        return undefined;
      }

      return options?.withGlobalAccessSwitches
        ? [
            OIDC_ADVANCED_DEFAULTS_SUMMARY,
            GLOBAL_OIDC_ADVANCED_DEFAULTS_SUMMARY,
          ]
        : [OIDC_ADVANCED_DEFAULTS_SUMMARY];
    },
  });
};

export interface OidcIssuerChange {
  // The values to put in the form.
  values: { issuerURL?: string; discoveryURL?: string };
  /*
   * The change replaces what was typed into the issuer field itself (a
   * discovery URL pasted there), so it has to land after the form has stored
   * the typed text.
   */
  replacesTypedIssuer: boolean;
}

/**
 * What else changes when the issuer is changed to `issuer`:
 *
 *   - a discovery URL pasted as the issuer is split: the issuer in front of
 *     it goes in the issuer field, and the URL is the discovery URL;
 *   - otherwise the discovery URL follows the issuer.
 *
 * The discovery URL moves only while it is the one the old issuer gave (or
 * empty): one set by hand stays. Null when nothing else changes.
 */
export const getOidcIssuerChange: (data: {
  // The form's values before the change.
  values: unknown;
  issuer: unknown;
}) => OidcIssuerChange | null = (data: {
  values: unknown;
  issuer: unknown;
}): OidcIssuerChange | null => {
  const typed: string = ssoFormValueAsText(data.issuer);
  const currentDiscoveryUrl: string = ssoFormValueAsText(
    readSsoFormValue(data.values, "discoveryURL"),
  );
  const discoveryFollowsIssuer: boolean = isDefaultOidcDiscoveryUrl({
    discoveryURL: currentDiscoveryUrl,
    issuerURL: ssoFormValueAsText(readSsoFormValue(data.values, "issuerURL")),
  });

  const split: OidcIssuerParts | null = splitOidcDiscoveryUrl(typed);

  if (split) {
    return {
      replacesTypedIssuer: true,
      values: discoveryFollowsIssuer
        ? { issuerURL: split.issuerURL, discoveryURL: split.discoveryURL }
        : { issuerURL: split.issuerURL },
    };
  }

  if (!discoveryFollowsIssuer) {
    return null;
  }

  const discoveryURL: string = getOidcDiscoveryUrl(typed);

  if (discoveryURL === currentDiscoveryUrl) {
    return null;
  }

  return { replacesTypedIssuer: false, values: { discoveryURL } };
};

// The issuer field's own check: an issuer is an http(s) URL.
export const getOidcIssuerError: (values: unknown) => string | null = (
  values: unknown,
): string | null => {
  const issuer: string = ssoFormValueAsText(
    readSsoFormValue(values, "issuerURL"),
  );

  if (!issuer.trim() || isOidcIssuerUrl(issuer)) {
    return null;
  }

  return translateValidationMessage(OIDC_ISSUER_URL_ERROR);
};

// The scopes' own check: every OIDC sign-in asks for openid.
export const getOidcScopesError: (values: unknown) => string | null = (
  values: unknown,
): string | null => {
  const scopes: string = ssoFormValueAsText(readSsoFormValue(values, "scopes"));

  if (!scopes.trim() || includesRequiredOidcScope(scopes)) {
    return null;
  }

  return translateValidationMessage(OIDC_SCOPES_WITHOUT_OPENID_ERROR);
};

export type GetOidcProviderFormFieldsFunction = <TEntity>(
  options?: OidcProviderFormOptions,
) => Array<Field<TEntity>>;

/**
 * The fields of an OIDC provider form, create and edit alike, on the steps
 * getSsoProviderFormSteps() declares.
 */
export const getOidcProviderFormFields: GetOidcProviderFormFieldsFunction = <
  TEntity,
>(
  options?: OidcProviderFormOptions,
): Array<Field<TEntity>> => {
  const advancedSection: FormFieldCollapsibleSection<TEntity> =
    getOidcAdvancedSection<TEntity>(options);

  return [
    getSsoProviderNameField<TEntity>({ stepId: "provider" }),
    {
      field: { issuerURL: true } as unknown as SelectFormFields<TEntity>,
      title: "Issuer URL",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      description: OIDC_ISSUER_DESCRIPTION,
      placeholder: "https://accounts.example.com",
      stepId: "provider",
      disableSpellCheck: true,
      customValidation: (values: FormValues<TEntity>): string | null => {
        return getOidcIssuerError(values);
      },
      onChange: (
        value: unknown,
        currentValues: FormValues<TEntity>,
        setNewFormValues: (values: FormValues<TEntity>) => void,
      ): void => {
        const change: OidcIssuerChange | null = getOidcIssuerChange({
          values: currentValues,
          issuer: value,
        });

        if (!change) {
          return;
        }

        const apply: () => void = (): void => {
          setNewFormValues({
            ...currentValues,
            ...change.values,
          } as FormValues<TEntity>);
        };

        if (change.replacesTypedIssuer) {
          /*
           * The form stores what was typed once this returns, over anything
           * set now; the issuer goes in its place right after.
           */
          queueMicrotask(apply);
          return;
        }

        apply();
      },
    },
    {
      field: { clientId: true } as unknown as SelectFormFields<TEntity>,
      title: "Client ID",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      description: "OIDC client ID issued by your identity provider.",
      placeholder: "abc123-client-id",
      stepId: "provider",
      disableSpellCheck: true,
    },
    {
      field: { clientSecret: true } as unknown as SelectFormFields<TEntity>,
      title: "Client Secret",
      fieldType: FormFieldSchemaType.EncryptedText,
      required: true,
      description:
        "OIDC client secret issued by your identity provider. Stored encrypted at rest.",
      placeholder: "client-secret-value",
      stepId: "provider",
    },
    ...(options?.withTeams
      ? [getSsoProviderTeamsField<TEntity>({ stepId: "sign-in" })]
      : []),
    getSsoProviderEnabledField<TEntity>({ stepId: "sign-in" }),
    {
      field: { discoveryURL: true } as unknown as SelectFormFields<TEntity>,
      title: "Discovery URL",
      fieldType: FormFieldSchemaType.URL,
      required: true,
      description: OIDC_DISCOVERY_URL_DESCRIPTION,
      placeholder:
        "https://accounts.example.com/.well-known/openid-configuration",
      stepId: "sign-in",
      disableSpellCheck: true,
      collapsibleSection: advancedSection,
    },
    /*
     * The scopes and the two claim names start at their usual values and
     * are never required: sign-in reads an empty one as its usual value
     * (Identity/API/OIDC, StatusPageOIDC, GlobalOIDC), and the services fill
     * one left out of a new provider. A status page provider made before
     * this may have no name claim at all, and editing it must not stop on a
     * field nobody asked for. The placeholder shows the value an empty one
     * stands for.
     */
    {
      field: { scopes: true } as unknown as SelectFormFields<TEntity>,
      title: "Scopes",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      description:
        "Space-separated list of OIDC scopes to request. Must include 'openid'.",
      placeholder: DEFAULT_OIDC_SCOPES,
      defaultValue: DEFAULT_OIDC_SCOPES,
      stepId: "sign-in",
      disableSpellCheck: true,
      customValidation: (values: FormValues<TEntity>): string | null => {
        return getOidcScopesError(values);
      },
      collapsibleSection: advancedSection,
    },
    {
      field: { emailClaimName: true } as unknown as SelectFormFields<TEntity>,
      title: "Email Claim Name",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      description:
        "Name of the ID token / userinfo claim that contains the user's email address.",
      placeholder: DEFAULT_OIDC_EMAIL_CLAIM_NAME,
      defaultValue: DEFAULT_OIDC_EMAIL_CLAIM_NAME,
      stepId: "sign-in",
      disableSpellCheck: true,
      collapsibleSection: advancedSection,
    },
    {
      field: { nameClaimName: true } as unknown as SelectFormFields<TEntity>,
      title: "Name Claim Name",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      description:
        "Name of the ID token / userinfo claim that contains the user's display name.",
      placeholder: DEFAULT_OIDC_NAME_CLAIM_NAME,
      defaultValue: DEFAULT_OIDC_NAME_CLAIM_NAME,
      stepId: "sign-in",
      disableSpellCheck: true,
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
