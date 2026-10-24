import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";

/*
 * A fake Microsoft identity platform (login.microsoftonline.com) and the part
 * of Microsoft Graph a Microsoft Teams sign-in reads (/v1.0/me), to drive
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
 *
 * Codes and tokens are counters, not random: nothing here is a secret.
 */

export const FAKE_MICROSOFT_LOGIN_ORIGIN: string =
  "https://login.microsoftonline.com";
export const FAKE_GRAPH_ME_URL: string = "https://graph.microsoft.com/v1.0/me";

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

export default class FakeMicrosoftIdentityPlatform {
  public readonly authorizeRequests: Array<{
    authority: string;
    clientId: string;
    person: string;
  }> = [];
  public readonly tokenRequests: Array<FakeTokenRequest> = [];
  // Graph reads, by the account they answered as.
  public readonly profileReads: Array<FakeAccount> = [];

  private apps: Array<FakeAppRegistration> = [];
  private accounts: Array<FakeAccount> = [];
  private codes: Map<string, IssuedCode> = new Map<string, IssuedCode>();
  private accessTokens: Map<string, FakeAccount> = new Map<
    string,
    FakeAccount
  >();
  private counter: number = 0;

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

    if (parsed.origin !== FAKE_MICROSOFT_LOGIN_ORIGIN || !match) {
      throw new Error(`Not Microsoft's authorize endpoint: ${url}`);
    }

    const authority: string = decodeURIComponent(match[1]!).toLowerCase();
    const clientId: string = parsed.searchParams.get("client_id") || "";
    const redirectUri: string = parsed.searchParams.get("redirect_uri") || "";
    const state: string = parsed.searchParams.get("state") || "";

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
    });

    return back({ code });
  }

  // Microsoft's token endpoint, as OneUptime's API.post calls it.
  public token(
    url: string,
    form: JSONObject,
  ): HTTPResponse<JSONObject> | HTTPErrorResponse {
    const parsed: globalThis.URL = new globalThis.URL(url);
    const match: RegExpExecArray | null = TOKEN_PATH.exec(parsed.pathname);

    if (parsed.origin !== FAKE_MICROSOFT_LOGIN_ORIGIN || !match) {
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

    const app: FakeAppRegistration | undefined = this.findApp(clientId);

    if (!app || form["client_secret"] !== app.clientSecret) {
      return answer(401, {
        error: "invalid_client",
        error_description: "AADSTS7000215: Invalid client secret provided.",
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
    });
  }

  // Microsoft Graph's /me, as OneUptime's API.get calls it.
  public readProfile(
    url: string,
    headers: Record<string, string> | undefined,
  ): HTTPResponse<JSONObject> | HTTPErrorResponse {
    if (url !== FAKE_GRAPH_ME_URL) {
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
