import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { JSONObject } from "Common/Types/JSON";
import { Issuer, Client, generators, TokenSet } from "openid-client";

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
}

export default class OIDCUtil {
  public static async createClient(config: OidcClientConfig): Promise<Client> {
    const issuer: Issuer = await Issuer.discover(
      config.discoveryURL.toString(),
    );

    return new issuer.Client({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uris: [config.redirectUri.toString()],
      response_types: ["code"],
    });
  }

  public static generateAuthorizationUrl(data: {
    client: Client;
    scopes: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  }): URL {
    const url: string = data.client.authorizationUrl({
      scope: data.scopes,
      state: data.state,
      nonce: data.nonce,
      code_challenge: data.codeChallenge,
      code_challenge_method: "S256",
    });

    return URL.fromString(url);
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
    expectedIssuer: URL;
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

    if (claims["iss"] !== data.expectedIssuer.toString()) {
      throw new BadRequestException(
        `OIDC issuer mismatch. Expected ${data.expectedIssuer.toString()} but got ${claims["iss"]}`,
      );
    }

    let emailValue: unknown = claims[data.emailClaimName];
    let nameValue: unknown = claims[data.nameClaimName];

    // If email/name not in ID token claims, fall back to userinfo endpoint.
    if (!emailValue || !nameValue) {
      try {
        const userInfo: JSONObject = (await data.client.userinfo(
          tokenSet.access_token!,
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
    };
  }
}
