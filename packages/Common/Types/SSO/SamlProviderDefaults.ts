import DigestMethod from "./DigestMethod";
import SignatureMethod from "./SignatureMethod";
import {
  SsoProviderDescriptionFields,
  fillSsoProviderDescription,
  isBlankSsoValue,
} from "./SsoProviderDefaults";

/*
 * WHAT A SAML PROVIDER IS GIVEN, AND WHAT IS FILLED IN.
 *
 * Adding a SAML provider - for a project, a status page or the whole
 * instance - walked four steps and asked for a description and for two
 * required dropdowns that started empty, the signature and digest methods,
 * whose help said "If you do not know what this is, please leave this to
 * RSA-SHA256" (and "SHA256"). What only the identity provider can give is
 * its sign-on URL, its issuer and its certificate. The rest has an answer:
 *
 *   - the signature method is RSA-SHA256 and the digest method SHA256, what
 *     nearly every identity provider uses. They are recorded with the
 *     provider and shown on its page; signing in verifies a response against
 *     the provider's certificate with the algorithm the signed response names
 *     (App/FeatureSet/Identity/Utils/SSO), so these two are not something a
 *     newcomer has to get right;
 *   - the description is "Sign in with <name>" (SsoProviderDefaults).
 *
 * The services (ProjectSsoService, StatusPageSsoService, GlobalSsoService)
 * fill these in when a provider is created without them, before the
 * required-field check runs, so the columns stay required and the API and
 * Terraform keep their contract while a caller may leave them out. The forms
 * start on the same values (Common/UI/Components/Sso/SamlProviderFormFields),
 * so what a form shows is what is saved. A provider that already exists keeps
 * what it has.
 *
 * React-free and server-safe: the API, the Dashboard, the Admin Dashboard
 * and their tests all read it.
 */

export const DEFAULT_SAML_SIGNATURE_METHOD: SignatureMethod =
  SignatureMethod.SHA256;

export const DEFAULT_SAML_DIGEST_METHOD: DigestMethod = DigestMethod.SHA256;

/*
 * A provider about to be created: the columns every SAML provider has that
 * are filled in here. ProjectSSO, StatusPageSSO and GlobalSSO all fit it.
 */
export interface SamlProviderDefaultFields
  extends SsoProviderDescriptionFields {
  signatureMethod?: SignatureMethod | undefined;
  digestMethod?: DigestMethod | undefined;
}

/**
 * What a provider created without them gets, in place:
 *
 *   - a missing signature method is RSA-SHA256;
 *   - a missing digest method is SHA256;
 *   - a missing description is "Sign in with <name>".
 *
 * Whatever the caller sent is kept. Nothing else is touched: the sign-on
 * URL, the issuer and the certificate come from the identity provider, so
 * the required-field check names any of them that is missing.
 */
export const fillSamlProviderDefaults: (
  provider: SamlProviderDefaultFields,
) => void = (provider: SamlProviderDefaultFields): void => {
  if (isBlankSsoValue(provider.signatureMethod)) {
    provider.signatureMethod = DEFAULT_SAML_SIGNATURE_METHOD;
  }

  if (isBlankSsoValue(provider.digestMethod)) {
    provider.digestMethod = DEFAULT_SAML_DIGEST_METHOD;
  }

  fillSsoProviderDescription(provider);
};
