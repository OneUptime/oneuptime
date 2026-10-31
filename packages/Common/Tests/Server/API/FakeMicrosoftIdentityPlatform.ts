import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import MicrosoftTeamsCloudUtil, {
  MicrosoftTeamsCloud,
  MicrosoftTeamsCloudHosts,
} from "../../../Types/Workspace/MicrosoftTeamsCloud";
import { makeUnsignedJwt } from "./WorkspaceOAuthTestHelpers";

/*
 * A fake Microsoft identity platform (login.microsoftonline.com) and the part
 * of Microsoft Graph a Microsoft Teams sign-in reads (/v1.0/me, /v1.0/teams), to drive
 * OneUptime's sign-ins end to end without Microsoft.
 *
 * It holds app registrations and directories, and answers the way Microsoft
 * does where OneUptime depends on it:
 *
 *  - An app registered for one organization ("Accounts in this
 *    organizational directory only", signInAudience AzureADMyOrg) is refused
 *    at Microsoft's endpoints for every organization with AADSTS50194: sent
 *    back to the redirect URI as error=invalid_request, which is what issue
 *    #5202's server log shows for `common`. The
 *    fake refuses `organizations` the same way, which Microsoft documents
 *    for multitenant apps only - stricter than needed is safe for a test.
 *  - At a tenant's own endpoint, the tenant's members and guests sign in.
 *    A guest signs in as the guest account the tenant holds for them: its
 *    object id there, not their home tenant's. Anybody else is stopped on
 *    Microsoft's own page (AADSTS50020) and never sent back.
 *  - An app registered for one organization does not exist in any other
 *    (AADSTS700016, on Microsoft's own page).
 *  - At `common` or `organizations`, a multitenant app signs a person in
 *    to their home tenant.
 *  - A code is exchanged once, by the app it was issued to, with its secret
 *    and the same redirect URI - and, stricter than Microsoft needs to be,
 *    only at the authority that issued it, which is where OneUptime
 *    exchanges it.
 *  - The access token reads /me as the account the code was issued for.
 *  - A token answer carries a refresh token and an ID token naming the
 *    account (aud, tid, oid, preferred_username), as a sign-in that asks
 *    for openid and offline_access gets; tokenFromFetch answers a form
 *    posted with fetch, as the Teams meetings app posts its code
 *    (VideoCallHttpClient).
 *  - It is one Microsoft cloud's (the commercial one unless it is made for
 *    another: GCC High, DoD), and answers on that cloud's hosts only, as
 *    Microsoft does: a sign-in host of another cloud knows none of its apps
 *    (AADSTS700016), a Graph of another cloud none of its tokens, and its
 *    Graph scopes are its own Graph's - a scope on another cloud's Graph is
 *    refused (AADSTS500011). ID tokens name the cloud's issuer.
 *  - Admin consent (adminConsent) sends the admin back with the tenant they
 *    consented for, and a client credentials grant gives the app a token
 *    that reads the tenant's teams (/v1.0/teams).
 *
 * Codes and tokens are counters, not random: nothing here is a secret.
 */

// Microsoft Graph's /me in the commercial cloud, where the fake is unless made for another.
export const FAKE_GRAPH_ME_URL: string = "https://graph.microsoft.com/v1.0/me";

// A team a tenant holds, as Graph's /teams lists it.
export interface FakeTeam {
  id: string;
  displayName: string;
}

// The endpoints for every organization, which name no tenant.
const ENDPOINTS_FOR_EVERY_ORGANIZATION: Array<string> = [
  "common",
  "organizations",
  "consumers",
];

export enum FakeSignInAudience {
  // "Accounts in this organizational directory only (Single tenant)".
  SingleTenant = "AzureADMyOrg",
  // "Accounts in any organizational directory (Multitenant)".
  MultiTenant = "AzureADMultipleOrgs",
}

export interface FakeAppRegistration {
  name: string;
  clientId: string;
  clientSecret: string;
  // The tenant the app is registered in: its Directory (tenant) ID.
  homeTenantId: string;
  signInAudience: FakeSignInAudience;
  redirectUris: Array<string>;
}

// A person's account in one tenant: a member of it, or a guest in it.
export interface FakeAccount {
  // Who the person is, across tenants.
  person: string;
  tenantId: string;
  // Their object id in this tenant (Teams' aadObjectId there).
  objectId: string;
  displayName: string;
  mail: string;
  userPrincipalName: string;
  isGuest: boolean;
}

/*
 * What a browser at Microsoft's authorize URL ends with: sent back to the
 * app, or stopped on an error page Microsoft shows itself.
 */
export interface FakeAuthorizeOutcome {
  // Where Microsoft sends the browser back to; null when it does not.
  redirectTo: string | null;
  // The AADSTS code of the page Microsoft stops the browser on, if it does.
  errorPage: string | null;
}

interface IssuedCode {
  clientId: string;
  redirectUri: string;
  // The authority's path segment the code was issued at.
  authority: string;
  account: FakeAccount;
  isRedeemed: boolean;
  // The nonce the sign-in asked for, echoed in the ID token.
  nonce: string;
}

// What the fake was asked, for tests to read.
export interface FakeTokenRequest {
  authority: string;
  grantType: string;
  clientId: string;
  status: number;
}

const AUTHORIZE_PATH: RegExp = /^\/([^/]+)\/oauth2\/v2\.0\/authorize$/;
const TOKEN_PATH: RegExp = /^\/([^/]+)\/oauth2\/v2\.0\/token$/;
const ADMIN_CONSENT_PATH: RegExp = /^\/([^/]+)\/v2\.0\/adminconsent$/;

export default class FakeMicrosoftIdentityPlatform {
  public readonly authorizeRequests: Array<{
    authority: string;
    clientId: string;
    person: string;
  }> = [];
  public readonly tokenRequests: Array<FakeTokenRequest> = [];
  // Graph reads, by the account they answered as.
  public readonly profileReads: Array<FakeAccount> = [];
  // Every address OneUptime called, sign-in and Graph alike, in order.
  public readonly calledUrls: Array<string> = [];

  // The Microsoft cloud this fake is, and its hosts.
  public readonly hosts: MicrosoftTeamsCloudHosts;

  private apps: Array<FakeAppRegistration> = [];
  private accounts: Array<FakeAccount> = [];
  private teams: Map<string, Array<FakeTeam>> = new Map<
    string,
    Array<FakeTeam>
  >();
  private codes: Map<string, IssuedCode> = new Map<string, IssuedCode>();
  private accessTokens: Map<string, FakeAccount> = new Map<
    string,
    FakeAccount
  >();
  // App tokens, by the tenant each reads.
  private appTokens: Map<string, string> = new Map<string, string>();
  private counter: number = 0;

  public constructor(options?: { cloud?: MicrosoftTeamsCloud | undefined }) {
    this.hosts = MicrosoftTeamsCloudUtil.getHosts(
      options?.cloud || MicrosoftTeamsCloud.Commercial,
    );
  }

  // Microsoft Graph's /me in this cloud.
  public get graphMeUrl(): string {
    return `${this.hosts.graphOrigin}/v1.0/me`;
  }

  // A team the tenant holds, as Graph lists it to an app token of the tenant.
  public addTeam(tenantId: string, team: FakeTeam): void {
    const key: string = tenantId.toLowerCase();

    this.teams.set(key, [...(this.teams.get(key) || []), team]);
  }

  public registerApp(app: FakeAppRegistration): void {
    this.apps = this.apps.filter((existing: FakeAppRegistration) => {
      return existing.clientId !== app.clientId;
    });
    this.apps.push(app);
  }

  public addAccount(account: FakeAccount): void {
    this.accounts.push(account);
  }

  // The account `person` has in `tenantId`, member or guest.
  public accountOf(person: string, tenantId: string): FakeAccount | undefined {
    return this.accounts.find((account: FakeAccount) => {
      return (
        account.person === person &&
        account.tenantId.toLowerCase() === tenantId.toLowerCase()
      );
    });
  }

  // The tenant `person` is a member of.
  public homeAccountOf(person: string): FakeAccount | undefined {
    return this.accounts.find((account: FakeAccount) => {
      return account.person === person && !account.isGuest;
    });
  }

  /*
   * A browser at `url`, Microsoft's authorize endpoint, signing in as
   * `person`.
   */
  public authorize(url: string, person: string): FakeAuthorizeOutcome {
    const parsed: globalThis.URL = new globalThis.URL(url);
    const match: RegExpExecArray | null = AUTHORIZE_PATH.exec(parsed.pathname);

    this.calledUrls.push(url);

    if (!match) {
      throw new Error(`Not Microsoft's authorize endpoint: ${url}`);
    }

    // Another cloud's sign-in knows none of this cloud's apps.
    if (parsed.origin !== this.hosts.signInOrigin) {
      return FakeMicrosoftIdentityPlatform.errorPage("AADSTS700016");
    }

    const authority: string = decodeURIComponent(match[1]!).toLowerCase();
    const clientId: string = parsed.searchParams.get("client_id") || "";
    const redirectUri: string = parsed.searchParams.get("redirect_uri") || "";
    const state: string = parsed.searchParams.get("state") || "";
    const nonce: string = parsed.searchParams.get("nonce") || "";

    this.authorizeRequests.push({ authority, clientId, person });

    const app: FakeAppRegistration | undefined = this.findApp(clientId);

    if (!app) {
      return FakeMicrosoftIdentityPlatform.errorPage("AADSTS700016");
    }

    if (!app.redirectUris.includes(redirectUri)) {
      return FakeMicrosoftIdentityPlatform.errorPage("AADSTS50011");
    }

    /*
     * Back to the redirect URI exactly as registered - written out, not
     * parsed: a test server's URL may have no host.
     */
    const back: (params: Record<string, string>) => FakeAuthorizeOutcome = (
      params: Record<string, string>,
    ): FakeAuthorizeOutcome => {
      return {
        redirectTo: `${redirectUri}?${new URLSearchParams({
          ...params,
          state,
        }).toString()}`,
        errorPage: null,
      };
    };

    let account: FakeAccount | undefined;

    if (ENDPOINTS_FOR_EVERY_ORGANIZATION.includes(authority)) {
      if (app.signInAudience === FakeSignInAudience.SingleTenant) {
        return back({
          error: "invalid_request",
          error_description: FakeMicrosoftIdentityPlatform.aadsts50194(app),
        });
      }

      // A multitenant app: the person signs in to their home tenant.
      account = this.homeAccountOf(person);
    } else {
      if (
        app.signInAudience === FakeSignInAudience.SingleTenant &&
        authority !== app.homeTenantId.toLowerCase()
      ) {
        return FakeMicrosoftIdentityPlatform.errorPage("AADSTS700016");
      }

      account = this.accountOf(person, authority);
    }

    if (!account) {
      return FakeMicrosoftIdentityPlatform.errorPage("AADSTS50020");
    }

    const code: string = `fake-code-${this.next()}`;

    this.codes.set(code, {
      clientId,
      redirectUri,
      authority,
      account,
      isRedeemed: false,
      nonce,
    });

    return back({ code });
  }

  /*
   * A browser at `url`, Microsoft's admin consent endpoint, consented to as
   * `person`, a Microsoft 365 administrator: sent back with the tenant the
   * consent is for, which is the administrator's own.
   */
  public adminConsent(url: string, person: string): FakeAuthorizeOutcome {
    const parsed: globalThis.URL = new globalThis.URL(url);
    const match: RegExpExecArray | null = ADMIN_CONSENT_PATH.exec(
      parsed.pathname,
    );

    this.calledUrls.push(url);

    if (!match) {
      throw new Error(`Not Microsoft's admin consent endpoint: ${url}`);
    }

    if (parsed.origin !== this.hosts.signInOrigin) {
      return FakeMicrosoftIdentityPlatform.errorPage("AADSTS700016");
    }

    const authority: string = decodeURIComponent(match[1]!).toLowerCase();
    const clientId: string = parsed.searchParams.get("client_id") || "";
    const redirectUri: string = parsed.searchParams.get("redirect_uri") || "";
    const state: string = parsed.searchParams.get("state") || "";
    const scope: string = parsed.searchParams.get("scope") || "";
    const app: FakeAppRegistration | undefined = this.findApp(clientId);

    if (!app) {
      return FakeMicrosoftIdentityPlatform.errorPage("AADSTS700016");
    }

    if (!app.redirectUris.includes(redirectUri)) {
      return FakeMicrosoftIdentityPlatform.errorPage("AADSTS50011");
    }

    const back: (params: Record<string, string>) => FakeAuthorizeOutcome = (
      params: Record<string, string>,
    ): FakeAuthorizeOutcome => {
      return {
        redirectTo: `${redirectUri}?${new URLSearchParams({
          ...params,
          state,
        }).toString()}`,
        errorPage: null,
      };
    };

    // Consent is asked for this cloud's Graph, or for nothing it has.
    if (scope !== `${this.hosts.graphOrigin}/.default`) {
      return back({
        error: "invalid_request",
        error_description: `AADSTS500011: The resource principal named ${scope} was not found in the tenant.`,
      });
    }

    const account: FakeAccount | undefined = ENDPOINTS_FOR_EVERY_ORGANIZATION.includes(
      authority,
    )
      ? this.homeAccountOf(person)
      : this.accountOf(person, authority);

    if (!account) {
      return FakeMicrosoftIdentityPlatform.errorPage("AADSTS50020");
    }

    return back({
      admin_consent: "True",
      tenant: account.tenantId,
      scope: scope,
    });
  }

  // Microsoft's token endpoint, as OneUptime's API.post calls it.
  public token(
    url: string,
    form: JSONObject,
  ): HTTPResponse<JSONObject> | HTTPErrorResponse {
    const parsed: globalThis.URL = new globalThis.URL(url);
    const match: RegExpExecArray | null = TOKEN_PATH.exec(parsed.pathname);

    this.calledUrls.push(url);

    if (!match) {
      throw new Error(`Not Microsoft's token endpoint: ${url}`);
    }

    const authority: string = decodeURIComponent(match[1]!).toLowerCase();
    const grantType: string = String(form["grant_type"] || "");
    const clientId: string = String(form["client_id"] || "");

    const answer: (
      status: number,
      body: JSONObject,
    ) => HTTPResponse<JSONObject> | HTTPErrorResponse = (
      status: number,
      body: JSONObject,
    ): HTTPResponse<JSONObject> | HTTPErrorResponse => {
      this.tokenRequests.push({ authority, grantType, clientId, status });

      return status === 200
        ? new HTTPResponse<JSONObject>(status, body, {})
        : new HTTPErrorResponse(status, body, {});
    };

    // Another cloud's sign-in knows none of this cloud's apps.
    if (parsed.origin !== this.hosts.signInOrigin) {
      return answer(400, {
        error: "unauthorized_client",
        error_description: `AADSTS700016: Application with identifier '${clientId}' was not found in the directory.`,
      });
    }

    const app: FakeAppRegistration | undefined = this.findApp(clientId);

    if (!app || form["client_secret"] !== app.clientSecret) {
      return answer(401, {
        error: "invalid_client",
        error_description: "AADSTS7000215: Invalid client secret provided.",
      });
    }

    // A scope on another cloud's Graph names nothing this cloud has.
    const graphScopes: Array<string> = String(form["scope"] || "")
      .split(" ")
      .filter((scope: string): boolean => {
        return scope.startsWith("https://");
      });

    if (
      graphScopes.some((scope: string): boolean => {
        return !scope.startsWith(`${this.hosts.graphOrigin}/`);
      })
    ) {
      return answer(400, {
        error: "invalid_scope",
        error_description: `AADSTS500011: The resource principal named ${graphScopes.join(
          " ",
        )} was not found in the tenant.`,
      });
    }

    if (grantType === "client_credentials") {
      if (ENDPOINTS_FOR_EVERY_ORGANIZATION.includes(authority)) {
        return answer(400, { error: "invalid_request" });
      }

      const appToken: string = `fake-app-token-${this.next()}`;
      this.appTokens.set(appToken, authority);

      return answer(200, {
        token_type: "Bearer",
        expires_in: 3599,
        access_token: appToken,
      });
    }

    if (
      ENDPOINTS_FOR_EVERY_ORGANIZATION.includes(authority) &&
      app.signInAudience === FakeSignInAudience.SingleTenant
    ) {
      return answer(400, {
        error: "invalid_request",
        error_description: FakeMicrosoftIdentityPlatform.aadsts50194(app),
      });
    }

    if (grantType !== "authorization_code") {
      return answer(400, { error: "unsupported_grant_type" });
    }

    const issued: IssuedCode | undefined = this.codes.get(
      String(form["code"] || ""),
    );

    if (
      !issued ||
      issued.isRedeemed ||
      issued.clientId !== clientId ||
      issued.redirectUri !== form["redirect_uri"] ||
      issued.authority !== authority
    ) {
      return answer(400, {
        error: "invalid_grant",
        error_description:
          "The code is unknown, was used already, or was issued to another app, redirect URI or authority.",
      });
    }

    issued.isRedeemed = true;

    const accessToken: string = `fake-access-token-${this.next()}`;
    this.accessTokens.set(accessToken, issued.account);

    return answer(200, {
      token_type: "Bearer",
      scope: String(form["scope"] || ""),
      expires_in: 3599,
      access_token: accessToken,
      refresh_token: `fake-refresh-token-${this.next()}`,
      id_token: makeUnsignedJwt({
        aud: clientId,
        iss: `${this.hosts.signInOrigin}/${issued.account.tenantId.toLowerCase()}/v2.0`,
        tid: issued.account.tenantId,
        oid: issued.account.objectId,
        preferred_username: issued.account.userPrincipalName,
        nonce: issued.nonce,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    });
  }

  /*
   * Microsoft's token endpoint, as a form posted with fetch reaches it
   * (application/x-www-form-urlencoded): the same answers as token().
   */
  public tokenFromFetch(
    url: string,
    body: string | undefined,
  ): { ok: boolean; status: number; text: () => Promise<string> } {
    const form: JSONObject = {};

    new URLSearchParams(body || "").forEach(
      (value: string, key: string): void => {
        form[key] = value;
      },
    );

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse = this.token(
      url,
      form,
    );
    const text: string = JSON.stringify(response.data);

    return {
      ok: response.statusCode === 200,
      status: response.statusCode,
      text: async (): Promise<string> => {
        return text;
      },
    };
  }

  /*
   * Microsoft Graph, as OneUptime's API.get calls it: /me for a person's
   * token, and /teams for an app token of a tenant - on this cloud's Graph,
   * which no other cloud's token reads.
   */
  public graph(
    url: string,
    headers: Record<string, string> | undefined,
  ): HTTPResponse<JSONObject> | HTTPErrorResponse {
    const parsed: globalThis.URL = new globalThis.URL(url);

    this.calledUrls.push(url);

    if (parsed.origin !== this.hosts.graphOrigin) {
      return new HTTPErrorResponse(
        401,
        { error: { code: "InvalidAuthenticationToken" } },
        {},
      );
    }

    if (parsed.pathname === "/v1.0/me") {
      return this.readProfile(url, headers);
    }

    if (parsed.pathname !== "/v1.0/teams") {
      throw new Error(`Not a Graph read this fake answers: ${url}`);
    }

    const authorization: string = (headers || {})["Authorization"] || "";
    const tenant: string | undefined = authorization.startsWith("Bearer ")
      ? this.appTokens.get(authorization.substring("Bearer ".length))
      : undefined;

    if (!tenant) {
      return new HTTPErrorResponse(
        401,
        { error: { code: "InvalidAuthenticationToken" } },
        {},
      );
    }

    return new HTTPResponse<JSONObject>(
      200,
      {
        value: (this.teams.get(tenant) || []).map(
          (team: FakeTeam): JSONObject => {
            return { id: team.id, displayName: team.displayName };
          },
        ),
      },
      {},
    );
  }

  // Microsoft Graph's /me, as OneUptime's API.get calls it.
  public readProfile(
    url: string,
    headers: Record<string, string> | undefined,
  ): HTTPResponse<JSONObject> | HTTPErrorResponse {
    if (url !== this.graphMeUrl) {
      throw new Error(`Not Microsoft Graph's /me: ${url}`);
    }

    const authorization: string = (headers || {})["Authorization"] || "";
    const bearer: string = "Bearer ";
    const account: FakeAccount | undefined = authorization.startsWith(bearer)
      ? this.accessTokens.get(authorization.substring(bearer.length))
      : undefined;

    if (!account) {
      return new HTTPErrorResponse(
        401,
        { error: { code: "InvalidAuthenticationToken" } },
        {},
      );
    }

    this.profileReads.push(account);

    return new HTTPResponse<JSONObject>(
      200,
      {
        id: account.objectId,
        displayName: account.displayName,
        mail: account.mail,
        userPrincipalName: account.userPrincipalName,
      },
      {},
    );
  }

  private findApp(clientId: string): FakeAppRegistration | undefined {
    return this.apps.find((app: FakeAppRegistration) => {
      return app.clientId === clientId;
    });
  }

  private next(): number {
    this.counter++;
    return this.counter;
  }

  // Microsoft's words for a single-tenant app at an endpoint for every organization.
  public static aadsts50194(app: FakeAppRegistration): string {
    return `AADSTS50194: Application '${app.clientId}'(${app.name}) is not configured as a multi-tenant application. Usage of the /common endpoint is not supported for such applications created after '10/15/2018'. Use a tenant-specific endpoint or configure the application to be multi-tenant.`;
  }

  private static errorPage(code: string): FakeAuthorizeOutcome {
    return { redirectTo: null, errorPage: code };
  }
}
