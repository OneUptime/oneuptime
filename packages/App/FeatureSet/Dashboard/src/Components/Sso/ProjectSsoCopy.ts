import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * PROJECT SETTINGS -> SECURITY -> SSO: WHAT THE PAGE CALLS ITS PROVIDERS.
 *
 * The page lists the project's SAML providers and its OpenID Connect
 * providers, one card each. Their buttons read "Create SSO" and "Create
 * OIDC" - you do not create an SSO - and an empty card said "No SSO
 * configuration found.", the words of a search that missed, while a status
 * page's SSO and OIDC lists already said "Add SSO Provider" and "No SSO
 * providers yet" (StatusPageSignInCopy). Each card now names what it holds:
 * "Add SAML Provider" and "Add OIDC Provider", and "No SAML providers yet"
 * with the card's line under it. SAML, not SSO: both cards hold single
 * sign-on providers, side by side on one page.
 *
 * Under both cards, the project's SSO sign-in link (#9918, its card
 * ProjectSsoSignInLinkCard): the Accounts page that lists the project's
 * providers by the project's id alone, for people "Sign in with SSO" cannot
 * find them for by their email's domain. It was "Test Single Sign On (SSO)",
 * a link to the Dashboard's project sign-in page that only someone signed
 * in could open; the same link now tests a provider and is the one to share.
 * Drawn in the card's body - a card's description is hidden on a phone, and
 * the link is what the card is for - and only once the project has a
 * provider to try.
 *
 * Over the cards, while a provider that is on lists no verified domain, the
 * notice that "Sign in with SSO" finds it by nobody's email, and what to do
 * (SsoProvidersNotOfferedNotice, #9918).
 *
 * Kept free of React so the page, its components and App/Tests read these
 * exact strings. Every phrase is wrapped in translationKey() so npm run
 * i18n:extract finds it, and a count-dependent sentence is an object of its
 * two forms, which the extractor reads as one plural key.
 */

export const PROJECT_SSO_SIGN_IN_LINK_CARD_TEST_ID: string =
  "project-sso-sign-in-link";

export const SSO_PROVIDERS_NOT_OFFERED_NOTICE_TEST_ID: string =
  "sso-providers-not-offered";

export const SSO_PROVIDER_DOMAINS_TEST_ID: string = "sso-provider-domains";

export const ProjectSsoCopy: {
  samlProvider: string;
  samlProviders: string;
  addSamlProvider: string;
  addNewSamlProvider: string;
  oidcProvider: string;
  oidcProviders: string;
  addOidcProvider: string;
  addNewOidcProvider: string;
  // The column of the teams a provider's newcomers join.
  teamsColumn: string;
  // The column of the verified domains a provider is found by.
  domainsColumn: string;
  // A provider that lists no verified domain, in its Domains column.
  noVerifiedDomain: string;
  // A domain a provider lists that is not verified, in its Domains column.
  domainNotVerified: string;
  signInLinkTitle: string;
  signInLinkSentence: string;
  /*
   * The notice, when the project has a verified domain the providers could
   * list, and when it has none yet (then with Verify a Domain).
   */
  notOfferedNotice: PluralTemplate;
  notOfferedUntilVerifiedNotice: PluralTemplate;
  verifyDomainAction: string;
} = {
  samlProvider: translationKey("SAML Provider"),
  samlProviders: translationKey("SAML Providers"),
  addSamlProvider: translationKey("Add SAML Provider"),
  addNewSamlProvider: translationKey("Add New SAML Provider"),
  oidcProvider: translationKey("OIDC Provider"),
  oidcProviders: translationKey("OIDC Providers"),
  addOidcProvider: translationKey("Add OIDC Provider"),
  addNewOidcProvider: translationKey("Add New OIDC Provider"),
  teamsColumn: translationKey("Teams"),
  domainsColumn: translationKey("Domains"),
  noVerifiedDomain: translationKey("No verified domain"),
  domainNotVerified: translationKey("{{domain}} (not verified)"),
  signInLinkTitle: translationKey("SSO Sign-in Link"),
  signInLinkSentence: translationKey(
    "Share this link so people can sign in with these providers, whatever their email's domain. Try it before you require SSO.",
  ),
  notOfferedNotice: {
    one: "People cannot find this provider by their email on Sign in with SSO, because it lists no verified domain: {{names}}. Edit it and pick one under Domains.",
    other:
      "People cannot find these providers by their email on Sign in with SSO, because they list no verified domain: {{names}}. Edit each one and pick a domain under Domains.",
  },
  notOfferedUntilVerifiedNotice: {
    one: "People cannot find this provider by their email on Sign in with SSO until your project verifies a domain: {{names}}. Verify one, then pick it under the provider's Domains.",
    other:
      "People cannot find these providers by their email on Sign in with SSO until your project verifies a domain: {{names}}. Verify one, then pick it under each provider's Domains.",
  },
  verifyDomainAction: translationKey("Verify a Domain"),
};

export default ProjectSsoCopy;
