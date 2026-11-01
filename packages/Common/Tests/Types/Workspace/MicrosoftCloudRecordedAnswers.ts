/*
 * WHAT MICROSOFT'S OWN CLOUDS ANSWERED, RECORDED.
 *
 * OneUptime cannot sign in to a US Government tenant in a test, nor send to
 * one's Teams: that needs a tenant in GCC High or DoD. What anybody can do
 * is ask each cloud's public endpoints what they are. These are those
 * answers, as Microsoft gave them on 2026-10-31 (curl, no credentials),
 * cut to the fields OneUptime relies on - and the tests of
 * Types/Workspace/MicrosoftTeamsCloud hold the table of each cloud's hosts
 * to them, so a host spelled wrong in the table fails here, not in a
 * government customer's first sign-in.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export const RECORDED_ON: string = "2026-10-31";

export interface RecordedSignInDiscovery {
  // Where the document was read.
  source: string;
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

/*
 * Microsoft Entra ID's OpenID discovery, for any organization: where a
 * sign-in authorizes and exchanges its code, and the issuer every ID token
 * it signs names ({tenantid} stands for the tenant's id).
 */
export const RECORDED_SIGN_IN_DISCOVERY: ReadonlyArray<RecordedSignInDiscovery> =
  [
    {
      source:
        "https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration",
      issuer: "https://login.microsoftonline.com/{tenantid}/v2.0",
      authorization_endpoint:
        "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
      token_endpoint:
        "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
      jwks_uri:
        "https://login.microsoftonline.com/organizations/discovery/v2.0/keys",
    },
    {
      source:
        "https://login.microsoftonline.us/organizations/v2.0/.well-known/openid-configuration",
      issuer: "https://login.microsoftonline.us/{tenantid}/v2.0",
      authorization_endpoint:
        "https://login.microsoftonline.us/organizations/oauth2/v2.0/authorize",
      token_endpoint:
        "https://login.microsoftonline.us/organizations/oauth2/v2.0/token",
      jwks_uri:
        "https://login.microsoftonline.us/organizations/discovery/v2.0/keys",
    },
  ];

export interface RecordedBotFrameworkDiscovery {
  source: string;
  // Who signs the tokens Teams' requests to a bot carry.
  issuer: string;
  // Where the keys that sign them are.
  jwks_uri: string;
}

/*
 * The Bot Framework's OpenID discovery: what a bot checks every request
 * from Teams against - the commercial cloud's, and Azure Government's.
 */
export const RECORDED_BOT_FRAMEWORK_DISCOVERY: ReadonlyArray<RecordedBotFrameworkDiscovery> =
  [
    {
      source:
        "https://login.botframework.com/v1/.well-known/openidconfiguration",
      issuer: "https://api.botframework.com",
      jwks_uri: "https://login.botframework.com/v1/.well-known/keys",
    },
    {
      source:
        "https://login.botframework.azure.us/v1/.well-known/openidconfiguration",
      issuer: "https://api.botframework.us",
      jwks_uri: "https://login.botframework.azure.us/v1/.well-known/keys",
    },
  ];

/*
 * Microsoft Graph, asked for /v1.0/me without a token: each cloud's Graph
 * answers as Graph does, 401 with InvalidAuthenticationToken.
 */
export const RECORDED_GRAPH_ANSWERS: ReadonlyArray<{
  url: string;
  status: number;
  errorCode: string;
}> = [
  {
    url: "https://graph.microsoft.com/v1.0/me",
    status: 401,
    errorCode: "InvalidAuthenticationToken",
  },
  {
    url: "https://graph.microsoft.us/v1.0/me",
    status: 401,
    errorCode: "InvalidAuthenticationToken",
  },
  {
    url: "https://dod-graph.microsoft.us/v1.0/me",
    status: 401,
    errorCode: "InvalidAuthenticationToken",
  },
];

/*
 * Teams on the web, and Teams' services for bots, asked with a plain GET:
 * each is there (a redirect into the web app; a 404 for a GET where the
 * bot service takes POSTs). The Azure portals too (Azure's public one
 * answers a bare GET with 403).
 */
export const RECORDED_HOST_ANSWERS: ReadonlyArray<{
  url: string;
  status: number;
}> = [
  { url: "https://teams.microsoft.com/", status: 302 },
  { url: "https://gov.teams.microsoft.us/", status: 302 },
  { url: "https://dod.teams.microsoft.us/", status: 302 },
  { url: "https://smba.trafficmanager.net/teams/", status: 404 },
  { url: "https://smba.infra.gcc.teams.microsoft.com/teams/", status: 404 },
  { url: "https://smba.infra.gov.teams.microsoft.us/teams/", status: 404 },
  { url: "https://smba.infra.dod.teams.microsoft.us/teams/", status: 404 },
  { url: "https://portal.azure.com/", status: 403 },
  { url: "https://portal.azure.us/", status: 200 },
];
