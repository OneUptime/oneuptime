import { translationKey } from "Common/UI/Utils/TranslateTemplate";

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
 * The test link, under both cards, is drawn in the card's body - a card's
 * description is hidden on a phone, and the link is what the card is for -
 * and only once the project has a provider to try (ProjectSignInTestCard).
 *
 * Kept free of React so the page, its components and App/Tests read these
 * exact strings. Every phrase is wrapped in translationKey() so npm run
 * i18n:extract finds it.
 */

export const PROJECT_SIGN_IN_TEST_CARD_TEST_ID: string = "project-sign-in-test";

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
  testTitle: string;
  testSentence: string;
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
  testTitle: translationKey("Test Single Sign On (SSO)"),
  testSentence: translationKey(
    "Sign in through one of these providers before you require SSO: {{link}}",
  ),
};

export default ProjectSsoCopy;
