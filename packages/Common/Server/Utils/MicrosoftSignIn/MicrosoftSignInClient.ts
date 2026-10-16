import crypto from "crypto";
import Email from "../../../Types/Email";
import {
  MarketplaceHttp,
  MarketplaceHttpClient,
  MarketplaceHttpResponse,
  defaultMarketplaceHttpClient,
} from "../Marketplace/MarketplaceHttp";
import RemoteJwtVerifier from "../Marketplace/RemoteJwtVerifier";

/*
 * Sign in with Microsoft: the OpenID Connect authorization-code flow (with
 * PKCE) against Microsoft Entra ID's multi-tenant "common" endpoint, which
 * takes work and school accounts from any organization and personal
 * Microsoft accounts alike.
 *
 * Microsoft Marketplace requires it of a SaaS offer sold through Microsoft:
 * the buyer must be able to sign in to the product with the Microsoft
 * account they bought it with (certification policy 1000.3). It is offered
 * to everyone on the sign-in page, not only to buyers.
 *
 * WHO IT SIGNS IN
 *
 * A Microsoft account is matched to a OneUptime user by email address, so
 * the address has to be one Microsoft has verified. Matching on an address
 * Microsoft has not verified is the "nOAuth" account takeover: any Entra
 * tenant's administrator can put any address on a user of their own. An
 * address counts as verified when:
 *
 *   - the account is a personal Microsoft account (its tenant is Microsoft's
 *     consumer tenant), whose address Microsoft verified when it was made; or
 *   - the ID token's xms_edov claim (email domain owner verified) is true -
 *     the organization owns the address's domain. The app registration must
 *     ask for this optional claim (see Utils/Marketplace/RELEASING.md).
 *
 * Anything else is refused, and the person signs in with their password.
 *
 * https://learn.microsoft.com/entra/identity-platform/v2-protocols-oidc
 * https://learn.microsoft.com/entra/identity-platform/migrate-off-email-claim-authorization
 */

export const MICROSOFT_CONSUMER_TENANT_ID: string =
  "9188040d-6c67-4c5b-b112-36a304b66dad";
const AUTHORITY: string =
  "https://login.microsoftonline.com/common/oauth2/v2.0";
const JWKS_URL: string =
  "https://login.microsoftonline.com/common/discovery/v2.0/keys";
const SCOPES: string = "openid profile email";

export interface MicrosoftSignInRequest {
  authorizationUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface MicrosoftIdentity {
  email: Email;
  name: string | null;
  tenantId: string;
  objectId: string;
}

export class MicrosoftSignInError extends Error {
  // Words for the person signing in.
  public readonly userMessage: string;

  public constructor(message: string, userMessage?: string | undefined) {
    super(message);
    this.name = "MicrosoftSignInError";
    this.userMessage =
      userMessage ||
      "We could not sign you in with Microsoft. Please try again, or sign in with your email and password.";
  }
}

export default class MicrosoftSignInClient {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private httpClient: MarketplaceHttpClient;
  private verifier: RemoteJwtVerifier;

  public constructor(options: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    httpClient?: MarketplaceHttpClient | undefined;
    verifier?: RemoteJwtVerifier | undefined;
  }) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUri = options.redirectUri;
    this.httpClient = options.httpClient || defaultMarketplaceHttpClient;
    this.verifier =
      options.verifier ||
      new RemoteJwtVerifier({ httpClient: this.httpClient });
  }

  public static base64Url(buffer: Buffer): string {
    return buffer.toString("base64url");
  }

  // Where to send the browser, and what its callback has to match.
  public createSignInRequest(): MicrosoftSignInRequest {
    const state: string = MicrosoftSignInClient.base64Url(
      crypto.randomBytes(32),
    );
    const nonce: string = MicrosoftSignInClient.base64Url(
      crypto.randomBytes(32),
    );
    const codeVerifier: string = MicrosoftSignInClient.base64Url(
      crypto.randomBytes(48),
    );
    const codeChallenge: string = MicrosoftSignInClient.base64Url(
      crypto.createHash("sha256").update(codeVerifier, "ascii").digest(),
    );

    const params: URLSearchParams = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.redirectUri,
      response_mode: "query",
      scope: SCOPES,
      state: state,
      nonce: nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      // Lets someone signed in to several Microsoft accounts choose which.
      prompt: "select_account",
    });

    return {
      authorizationUrl: `${AUTHORITY}/authorize?${params.toString()}`,
      state: state,
      nonce: nonce,
      codeVerifier: codeVerifier,
    };
  }

  /*
   * Trade the authorization code for an ID token, verify it, and return
   * who it names - only when Microsoft vouches for their email address.
   */
  public async completeSignIn(data: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<MicrosoftIdentity> {
    let response: MarketplaceHttpResponse;

    try {
      response = await this.httpClient({
        method: "POST",
        url: `${AUTHORITY}/token`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "authorization_code",
          code: data.code,
          redirect_uri: this.redirectUri,
          code_verifier: data.codeVerifier,
          scope: SCOPES,
        }).toString(),
        timeoutInMs: 15_000,
      });
    } catch (err) {
      throw new MicrosoftSignInError(
        `Microsoft's token endpoint did not answer: ${(err as Error).message}`,
      );
    }

    const body: Record<string, unknown> | null =
      MarketplaceHttp.parseJsonObject(response.body);
    const idToken: unknown = body?.["id_token"];

    if (
      !MarketplaceHttp.isSuccess(response.status) ||
      typeof idToken !== "string"
    ) {
      throw new MicrosoftSignInError(
        `Microsoft refused the authorization code (HTTP ${response.status}): ${String(body?.["error"] || "")}`,
      );
    }

    return await this.verifyIdToken({ idToken: idToken, nonce: data.nonce });
  }

  public async verifyIdToken(data: {
    idToken: string;
    nonce: string;
  }): Promise<MicrosoftIdentity> {
    let claims: Record<string, unknown>;

    try {
      claims = await this.verifier.verify(data.idToken, {
        keySource: { kind: "jwks", url: JWKS_URL },
        audience: this.clientId,
      });
    } catch (err) {
      throw new MicrosoftSignInError(
        `The Microsoft ID token is not valid: ${(err as Error).message}`,
      );
    }

    return MicrosoftSignInClient.readIdentity(claims, data.nonce);
  }

  /*
   * Who verified claims name. The issuer of a multi-tenant token is the
   * signing-in user's own tenant, so it is checked against the token's tid
   * rather than against one fixed value.
   */
  public static readIdentity(
    claims: Record<string, unknown>,
    expectedNonce: string,
  ): MicrosoftIdentity {
    const tenantId: unknown = claims["tid"];
    const objectId: unknown = claims["oid"];

    if (typeof tenantId !== "string" || !tenantId) {
      throw new MicrosoftSignInError("The Microsoft ID token has no tenant.");
    }

    if (
      claims["iss"] !== `https://login.microsoftonline.com/${tenantId}/v2.0`
    ) {
      throw new MicrosoftSignInError(
        "The Microsoft ID token was not issued by the tenant it names.",
      );
    }

    if (
      typeof claims["nonce"] !== "string" ||
      !MicrosoftSignInClient.safeEqual(claims["nonce"], expectedNonce)
    ) {
      throw new MicrosoftSignInError(
        "The Microsoft ID token does not belong to this sign-in.",
      );
    }

    if (typeof objectId !== "string" || !objectId) {
      throw new MicrosoftSignInError("The Microsoft ID token names no user.");
    }

    const isPersonalAccount: boolean =
      tenantId === MICROSOFT_CONSUMER_TENANT_ID;
    const isDomainVerified: boolean =
      claims["xms_edov"] === true ||
      claims["xms_edov"] === 1 ||
      claims["xms_edov"] === "1" ||
      claims["xms_edov"] === "true";

    const emailClaim: unknown = claims["email"];

    if (typeof emailClaim !== "string" || !Email.isValid(emailClaim)) {
      throw new MicrosoftSignInError(
        "The Microsoft ID token carries no email address.",
        "Your Microsoft account did not share an email address with OneUptime. Please sign in with your email and password.",
      );
    }

    if (!isPersonalAccount && !isDomainVerified) {
      throw new MicrosoftSignInError(
        "Microsoft does not vouch for the email address in this ID token (no xms_edov).",
        "Your organization's Microsoft account does not confirm this email address, so OneUptime cannot sign you in with it. Please sign in with your email and password.",
      );
    }

    const name: unknown = claims["name"];

    return {
      email: new Email(emailClaim),
      name: typeof name === "string" && name.trim() ? name.trim() : null,
      tenantId: tenantId,
      objectId: objectId,
    };
  }

  private static safeEqual(a: string, b: string): boolean {
    const left: Buffer = crypto.createHash("sha256").update(a, "utf8").digest();
    const right: Buffer = crypto
      .createHash("sha256")
      .update(b, "utf8")
      .digest();
    return crypto.timingSafeEqual(left, right);
  }
}
