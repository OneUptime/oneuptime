import Domain from "Common/Models/DatabaseModels/Domain";

/*
 * WHETHER "SIGN IN WITH SSO" FINDS A PROJECT'S PROVIDER BY AN ADDRESS
 * (#9918).
 *
 * "Sign in with SSO" (/accounts/sso) finds a project's SAML or OIDC
 * provider by the address's domain alone: a provider that is on is offered
 * to every address on a verified domain of its project that it lists under
 * Domains (Common/Server/Utils/ProjectSsoDiscovery, #9824). One that lists
 * no verified domain is found by nobody's email - it still signs people in
 * from the identity provider, and from the project's SSO sign-in link - so
 * Settings > SSO says so: each provider's Domains column, and a notice over
 * the cards naming the providers that are on and found by no email, with
 * what to do (SsoProvidersNotOfferedNotice).
 *
 * React-free, so the page, its components and their tests read one rule.
 */

// A provider as Settings > SSO reads it: its name, whether it is on, its domains.
export interface SsoProviderDomainsRow {
  name?: string | undefined;
  isEnabled?: boolean | undefined;
  domains?: Array<Domain> | undefined;
}

// What the Domains column and the notice read of each provider.
export const SSO_PROVIDER_DOMAINS_SELECT: {
  _id: true;
  name: true;
  isEnabled: true;
  domains: { _id: true; domain: true; isVerified: true };
} = {
  _id: true,
  name: true,
  isEnabled: true,
  domains: {
    _id: true,
    domain: true,
    isVerified: true,
  },
};

// The domains a provider lists that are verified: the ones it is found by.
export const getVerifiedDomains: (
  provider: SsoProviderDomainsRow,
) => Array<Domain> = (provider: SsoProviderDomainsRow): Array<Domain> => {
  return (provider.domains || []).filter((domain: Domain): boolean => {
    return domain.isVerified === true;
  });
};

/*
 * Whether "Sign in with SSO" finds the provider by anybody's email: it is on
 * and lists a verified domain.
 */
export const isFoundByEmail: (provider: SsoProviderDomainsRow) => boolean = (
  provider: SsoProviderDomainsRow,
): boolean => {
  return provider.isEnabled === true && getVerifiedDomains(provider).length > 0;
};

/*
 * The providers the notice names: on, and found by no email. One that is
 * off is offered nowhere, and says so in its Enabled column.
 */
export const getProvidersNotFoundByEmail: (
  providers: Array<SsoProviderDomainsRow>,
) => Array<SsoProviderDomainsRow> = (
  providers: Array<SsoProviderDomainsRow>,
): Array<SsoProviderDomainsRow> => {
  return providers.filter((provider: SsoProviderDomainsRow): boolean => {
    return provider.isEnabled === true && !isFoundByEmail(provider);
  });
};

// A provider's name as the notice names it: as its admin wrote it, trimmed.
export const getProviderName: (provider: SsoProviderDomainsRow) => string = (
  provider: SsoProviderDomainsRow,
): string => {
  return (provider.name || "").trim();
};
