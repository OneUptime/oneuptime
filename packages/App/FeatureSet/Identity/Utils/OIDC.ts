import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { JSONObject } from "Common/Types/JSON";
import { Issuer, Client, custom, generators, TokenSet } from "openid-client";
import DataSourceEgressGuard, {
  AddressVerdict,
  EgressLookupFunction,
  GuardedNodeHttpAgents,
} from "Common/Server/Utils/DataSource/EgressGuard";
import BadDataException from "Common/Types/Exception/BadDataException";
import net, { LookupFunction } from "net";

const OIDC_EGRESS_LABEL: string = "OIDC provider";

/*
 * Google's issuer, and what Sign In Again asks it for: when the person
 * signed in (generateAuthorizationUrl), as Continue with Google does
 * (Common/Server/Utils/GoogleSignIn/GoogleSignInClient).
 */
const GOOGLE_ISSUER_HOSTNAME: string = "accounts.google.com";

const GOOGLE_AUTH_TIME_CLAIMS_REQUEST: string = JSON.stringify({
  id_token: { auth_time: { essential: true } },
});

/*
 * Put the egress guard on every socket openid-client opens.
 *
 * Validating discoveryURL on its own would be theatre: Issuer.discover fetches
 * a document from that URL and then adopts the authorization_endpoint,
 * token_endpoint, userinfo_endpoint and jwks_uri IT declares. Those are the
 * URLs that carry the client secret and the access token, and they are chosen
 * by the fetched document — that is, by whoever controls the tenant-writable
 * discovery URL. A guard has to sit where the connection is made, not where
 * the first URL is configured.
 *
 * It takes two hooks, because they cover different hosts:
 *
 *  - `lookup` is where a HOSTNAME is resolved. setHttpOptionsDefaults is
 *    process-wide and openid-client passes lookup straight to https.request,
 *    so every discovery, token, userinfo and JWKS request resolves through the
 *    guard and then connects to the address that was actually checked, with no
 *    rebind window in between.
 *
 *  - a literal IP never reaches `lookup` at all — Node skips resolution when
 *    the host is already an address — so "http://169.254.169.254/..." would
 *    sail straight past a lookup-only guard. custom.http_options runs per
 *    request with the parsed URL in hand, which is where those are caught.
 *
 * The same hook hands each request the agent it goes out on
 * (createGuardedAgentsForNodeHttp), so discovery, token, userinfo and JWKS
 * requests go through the outbound proxy the environment names
 * (HTTPS_PROXY, HTTP_PROXY, ALL_PROXY, apart from NO_PROXY's hosts), as
 * every axios request of the server does: Node's own client, which
 * openid-client sends with, reads none of them (#8932). Through a proxy,
 * the host is checked before the proxy is asked for it; without one, the
 * agent's lookup is the guarded one below.
 *
 * Private ranges stay reachable on self-hosted installs, where the identity
 * provider is often on the same private network; loopback, link-local and the
 * rest are refused everywhere.
 */
const egressGuardedLookup: EgressLookupFunction =
  DataSourceEgressGuard.createGuardedLookup({
    targetLabel: OIDC_EGRESS_LABEL,
  });

custom.setHttpOptionsDefaults({
  lookup: egressGuardedLookup as unknown as LookupFunction,
});

const oidcAgents: GuardedNodeHttpAgents =
  DataSourceEgressGuard.createGuardedAgentsForNodeHttp({
    targetLabel: OIDC_EGRESS_LABEL,
  });

type HttpOptionsHook = (
  url: globalThis.URL,
  options: Record<string, unknown>,
) => Record<string, unknown>;

const guardLiteralHost: HttpOptionsHook = (
  url: globalThis.URL,
  options: Record<string, unknown>,
): Record<string, unknown> => {
  const host: string = url.hostname.replace(/^\[|\]$/g, "");

  // A name is checked, with DNS, when the agent opens its socket.
  if (net.isIP(host) !== 0) {
    const verdict: AddressVerdict = DataSourceEgressGuard.checkAddress(host);

    if (verdict.blocked) {
      throw new BadDataException(
        `${OIDC_EGRESS_LABEL} host ${host} is not allowed: ${verdict.reason}.`,
      );
    }
  }

  return { ...options, agent: oidcAgents.agentFor(url) };
};

/*
 * The hook is read off whichever object made the request, so it has to be
 * installed on each: the Issuer class for discovery, the issuer instance for
 * JWKS, and the client for the token and userinfo calls.
 */
(Issuer as unknown as Record<symbol, HttpOptionsHook>)[custom.http_options] =
  guardLiteralHost;

export interface OidcClientConfig {
  discoveryURL: URL;
  clientId: string;
  clientSecret: string;
  redirectUri: URL;
  scopes: string;
}

export interface OidcCallbackResult {
  email: Email;
  name: Name | null;
  issuer: string;
  rawClaims: JSONObject;
  /*
   * The ID token the provider issued, as it came: the id_token_hint of a
   * sign-out at the provider (Types/SSO/IdentityProviderSignOut), kept only
   * when the provider asks for that. Null when the provider sent none.
   */
  idToken: string | null;
}

export default class OIDCUtil {
  public static async createClient(config: OidcClientConfig): Promise<Client> {
    const issuer: Issuer = await Issuer.discover(
      config.discoveryURL.toString(),
    );

    // JWKS fetches go through the issuer instance, not the class.
    (issuer as unknown as Record<symbol, HttpOptionsHook>)[
      custom.http_options
    ] = guardLiteralHost;

    const client: Client = new issuer.Client({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uris: [config.redirectUri.toString()],
      response_types: ["code"],
    });

    /*
     * Token and userinfo go through the client — and their URLs came out of
     * the discovery document, so this is the hook that matters most.
     */
    (client as unknown as Record<symbol, HttpOptionsHook>)[
      custom.http_options
    ] = guardLiteralHost;

    return client;
  }

  /*
   * Where a sign-in sends the browser. Sign In Again (#10217) asks the
   * provider to authenticate the person again: prompt=login, and max_age=0,
   * which also makes the ID token say when they authenticated (auth_time,
   * OpenID Connect Core 3.1.2.1) - OneUptime checks that time itself
   * (Utils/SignInAgain), so a provider that ignores both proves nothing.
   *
   * Google (Google Workspace as a provider, #10332) takes neither: its
   * prompt is none, consent or select_account, and it documents no
   * max_age. It sends auth_time only when the request asks for it with the
   * claims parameter and the OAuth client has Session age claims on
   * (developers.google.com/identity/openid-connect/openid-connect), so
   * without asking, its Sign In Again could never confirm anyone. Asked of
   * Google alone (isGoogleIssuer): the parameter is optional in OpenID
   * Connect, and another provider might refuse it.
   */
  public static generateAuthorizationUrl(data: {
    client: Client;
    scopes: string;
    state: string;
    nonce: string;
    codeChallenge: string;
    isSignInAgain?: boolean | undefined;
  }): URL {
    const url: string = data.client.authorizationUrl({
      scope: data.scopes,
      state: data.state,
      nonce: data.nonce,
      code_challenge: data.codeChallenge,
      code_challenge_method: "S256",
      ...(data.isSignInAgain ? { prompt: "login", max_age: 0 } : {}),
      ...(data.isSignInAgain && OIDCUtil.isGoogleIssuer(data.client)
        ? { claims: GOOGLE_AUTH_TIME_CLAIMS_REQUEST }
        : {}),
    });

    return URL.fromString(url);
  }

  // Whether the provider is Google: its issuer, https://accounts.google.com.
  public static isGoogleIssuer(client: Client): boolean {
    const issuer: unknown = (
      client as unknown as { issuer?: { issuer?: unknown } }
    ).issuer?.issuer;

    if (typeof issuer !== "string") {
      return false;
    }

    try {
      const hostname: string = new globalThis.URL(
        issuer.includes("://") ? issuer : `https://${issuer}`,
      ).hostname.toLowerCase();

      return hostname === GOOGLE_ISSUER_HOSTNAME;
    } catch {
      return false;
    }
  }

  public static generateState(): string {
    return generators.state();
  }

  public static generateNonce(): string {
    return generators.nonce();
  }

  public static generateCodeVerifier(): string {
    return generators.codeVerifier();
  }

  public static generateCodeChallenge(codeVerifier: string): string {
    return generators.codeChallenge(codeVerifier);
  }

  public static async exchangeCodeAndValidate(data: {
    client: Client;
    redirectUri: URL;
    expectedIssuer: string;
    expectedNonce: string;
    expectedState: string;
    codeVerifier: string;
    callbackParams: Record<string, string>;
    emailClaimName: string;
    nameClaimName: string;
  }): Promise<OidcCallbackResult> {
    const tokenSet: TokenSet = await data.client.callback(
      data.redirectUri.toString(),
      data.callbackParams,
      {
        state: data.expectedState,
        nonce: data.expectedNonce,
        code_verifier: data.codeVerifier,
      },
    );

    const claims: JSONObject = tokenSet.claims() as JSONObject;

    if (claims["iss"] !== data.expectedIssuer?.toString()) {
      throw new BadRequestException(
        `OIDC issuer mismatch. Expected ${data.expectedIssuer?.toString()} but got ${claims["iss"]}`,
      );
    }

    let emailValue: unknown = claims[data.emailClaimName];
    let nameValue: unknown = claims[data.nameClaimName];

    // If email/name not in ID token claims, fall back to userinfo endpoint.
    if (!emailValue || !nameValue) {
      try {
        /*
         * Pass the TokenSet, not the bare access_token string. openid-client
         * only applies the token_type and the DPoP/at_hash checks tied to the
         * issued token when it is handed the whole set; with a raw string it
         * falls back to a plain Bearer request.
         */
        const userInfo: JSONObject = (await data.client.userinfo(
          tokenSet,
        )) as unknown as JSONObject;

        if (!emailValue) {
          emailValue = userInfo[data.emailClaimName];
        }

        if (!nameValue) {
          nameValue = userInfo[data.nameClaimName];
        }
      } catch {
        // userinfo failure is non-fatal if claims already present in ID token
      }
    }

    if (!emailValue || typeof emailValue !== "string") {
      throw new BadRequestException(
        `OIDC response did not include a usable '${data.emailClaimName}' claim`,
      );
    }

    /*
     * The Email constructor includes invalid values in its error message,
     * which callers log. Keep provider-supplied personal data out of errors.
     */
    if (!Email.isValid(emailValue)) {
      throw new BadRequestException(
        "OIDC response did not include a valid email address",
      );
    }

    const email: Email = new Email(emailValue);

    let name: Name | null = null;
    if (nameValue && typeof nameValue === "string") {
      name = new Name(nameValue);
    }

    return {
      email,
      name,
      issuer: claims["iss"] as string,
      rawClaims: claims,
      idToken:
        typeof tokenSet.id_token === "string" && tokenSet.id_token
          ? tokenSet.id_token
          : null,
    };
  }

  /*
   * Where the provider ends its sessions (OpenID Connect RP-Initiated
   * Logout 1.0): the end_session_endpoint of the discovery document the
   * client was made from, or null when it names none - Google's does not.
   */
  public static getEndSessionEndpoint(client: Client): string | null {
    const endSessionEndpoint: unknown =
      client.issuer?.metadata?.["end_session_endpoint"];

    return typeof endSessionEndpoint === "string" && endSessionEndpoint
      ? endSessionEndpoint
      : null;
  }
}
