import PageMap from "../../Utils/PageMap";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardOIDC from "Common/Models/DatabaseModels/DashboardOidc";
import DashboardPrivateUser from "Common/Models/DatabaseModels/DashboardPrivateUser";
import DashboardSSO from "Common/Models/DatabaseModels/DashboardSso";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { HOST, HTTP_PROTOCOL, IDENTITY_URL } from "Common/UI/Config";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * ---------------------------------------------------------------------------
 * THE KINDS OF PUBLIC LINK WHOSE VISITORS SIGN IN (#10250, #10249).
 *
 * A dashboard - and a form after it - whose public link asks its visitors
 * to sign in lets in only its private users, and the people its SAML or
 * OIDC single sign-on lets in. Their pages - Private Users, Single Sign-On -
 * are the same for every kind: one table of private users
 * (PrivateUsersTable), one of each kind of provider (SamlProvidersTable,
 * OidcProvidersTable) and the Require SSO to Sign In switch
 * (RequireSsoCard). What differs is here, as the custom domains' kinds
 * keep theirs (CustomDomain/CustomDomainKinds).
 *
 * The SAML and OIDC values a kind shows - the Entity ID, the Reply URL, the
 * redirect URI - are the ones the server holds a sign-in to
 * (Identity/Utils/SamlServiceProvider, API/DashboardOIDC), built from the
 * same HOST and HTTP_PROTOCOL; SamlSignInRoutesGuard holds the two together.
 *
 * A status page's private users and single sign-on have pages of their own
 * (StatusPages/View/PrivateUser, SSO, OIDC), kept as they are.
 * ---------------------------------------------------------------------------
 */

export type PrivateUserModel = DashboardPrivateUser;
export type SamlProviderModel = DashboardSSO;
export type OidcProviderModel = DashboardOIDC;
export type SignInResourceModel = Dashboard;

export interface PrivateAccessTableNames {
  /*
   * The table's names: saved filters and column preferences are kept
   * under them.
   */
  tableId: string;
  tableName: string;
  userPreferencesKey: string;
  saveFilterTableId: string;
}

export interface PrivateAccessKind {
  // The column of a private user, and of a provider, that names its resource.
  parentColumn: "dashboardId";
  resourceModel: { new (): SignInResourceModel };
  privateUserModel: { new (): PrivateUserModel };
  samlModel: { new (): SamlProviderModel };
  oidcModel: { new (): OidcProviderModel };
  privateUsersTable: PrivateAccessTableNames;
  samlTable: PrivateAccessTableNames;
  oidcTable: PrivateAccessTableNames;
  // The page that holds the resource's Sharing choice, where sign-in is picked.
  accessPage: PageMap;
  copy: {
    // Beside the Private Users list's title.
    privateUsersDescription: string;
    // Under Require SSO to Sign In.
    requireSsoNote: string;
    requireSsoConfirmDescription: string;
    samlDescription: string;
    oidcDescription: string;
  };
  // The values an identity provider is given, as the server holds a sign-in to them.
  getSamlEntityId: (resourceId: ObjectID, providerId: string) => string;
  getSamlReplyUrl: (resourceId: ObjectID, providerId: string) => string;
  getOidcRedirectUri: (resourceId: ObjectID, providerId: string) => string;
  // The docs section that explains the kind's sign-in.
  docsPath: string;
}

export const DASHBOARD_PRIVATE_ACCESS: PrivateAccessKind = {
  parentColumn: "dashboardId",
  resourceModel: Dashboard,
  privateUserModel: DashboardPrivateUser,
  samlModel: DashboardSSO,
  oidcModel: DashboardOIDC,
  privateUsersTable: {
    tableId: "dashboard-private-users-table",
    tableName: "Dashboard > Private Users",
    userPreferencesKey: "dashboard-private-users-table",
    saveFilterTableId: "dashboard-private-users-table",
  },
  samlTable: {
    tableId: "dashboard-sso-table",
    tableName: "Dashboard > Single Sign-On > SAML",
    userPreferencesKey: "dashboard-sso-table",
    saveFilterTableId: "dashboard-sso-table",
  },
  oidcTable: {
    tableId: "dashboard-oidc-table",
    tableName: "Dashboard > Single Sign-On > OIDC",
    userPreferencesKey: "dashboard-oidc-table",
    saveFilterTableId: "dashboard-oidc-table",
  },
  accessPage: PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS,
  copy: {
    privateUsersDescription: translationKey(
      "People who can sign in to open this dashboard's public link. Each one is emailed an invitation when you add them.",
    ),
    requireSsoNote: translationKey(
      "It applies while only people who sign in can view this dashboard.",
    ),
    requireSsoConfirmDescription: translationKey(
      "Private users can no longer sign in with a password; only people your SSO provider lets in will see this dashboard. Test SSO first.",
    ),
    samlDescription: translationKey(
      "Visitors sign in with your SAML identity provider, such as Okta or Microsoft Entra ID.",
    ),
    oidcDescription: translationKey(
      "Visitors sign in with your OpenID Connect provider, such as Google or Okta.",
    ),
  },
  getSamlEntityId: (resourceId: ObjectID, providerId: string): string => {
    return `${HTTP_PROTOCOL}${HOST}/dashboard-sso/${resourceId.toString()}/${providerId}`;
  },
  getSamlReplyUrl: (resourceId: ObjectID, providerId: string): string => {
    return `${URL.fromString(IDENTITY_URL.toString()).addRoute(
      `/dashboard-idp-login/${resourceId.toString()}/${providerId}`,
    )}`;
  },
  getOidcRedirectUri: (resourceId: ObjectID, providerId: string): string => {
    return `${URL.fromString(IDENTITY_URL.toString()).addRoute(
      `/dashboard-oidc-callback/${resourceId.toString()}/${providerId}`,
    )}`;
  },
  docsPath: "/docs/dashboards/sharing#only-people-who-sign-in",
};
