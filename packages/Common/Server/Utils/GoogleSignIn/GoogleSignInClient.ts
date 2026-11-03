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
 * Continue with Google: the OpenID Connect authorization-code flow (with
 * PKCE) against Google's accounts, which takes Gmail accounts and Google
 * Workspace accounts alike. It is offered on the sign-in and sign-up pages
 * so a visitor with a Google account - a team on Google Workspace above all -
 * signs up in two clicks rather than with the whole form.
 *
 * WHO IT SIGNS IN
 *
 * A Google account is matched to a OneUptime user by email address, so the
 * address has to be one Google not only verified but is authoritative for:
 * anyone can make a Google account with an address at another provider, and
 * Google's email_verified only says the address was verified once, when the
 * account was made - the address may have changed hands since. Google says
 * it is authoritative, and its user is the address's owner, when:
 *
 *   - the address is a Gmail address (@gmail.com, or @googlemail.com, the
 *     name Gmail had in some countries); or
 *   - the ID token names a hosted domain (hd): the account is a Google
 *     Workspace or Cloud Identity account, and the organization has verified
 *     the domain with Google.
 *
 * Every address must also be one Google says is verified (email_verified).
 * Anything else is refused, and the person signs in with their password.
 *
 * https://developers.google.com/identity/openid-connect/openid-connect
 * https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
 */

const AUTHORIZATION_URL: string =
  "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: string = "https://oauth2.googleapis.com/token";
const JWKS_URL: string = "https://www.googleapis.com/oauth2/v3/certs";
// The issuers Google's ID tokens name, with and without the scheme.
export const GOOGLE_ISSUERS: ReadonlyArray<string> = [
  "https://accounts.google.com",
  "accounts.google.com",
];
// Gmail's domains: an address on them is a Gmail account, Google's own.
export const GMAIL_DOMAINS: ReadonlyArray<string> = [
  "gmail.com",
  "googlemail.com",
];
const SCOPES: string = "openid email profile";

export interface GoogleSignInRequest {
  authorizationUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface GoogleIdentity {
  email: Email;
  name: string | null;
  // The Google account's own ID (sub), which never changes.
  subject: string;
  // The Google Workspace domain the account belongs to, or null for Gmail.
  hostedDomain: string | null;
}

export class GoogleSignInError extends Error {
  // Words for the person signing in.
  public readonly userMessage: string;

  public constructor(message: string, userMessage?: string | undefined) {
    super(message);
    this.name = "GoogleSignInError";
    this.userMessage =
      userMessage ||
      "We could not sign you in with Google. Please try again, or sign in with your email and password.";
  }
}

export default class GoogleSignInClient {
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
  public createSignInRequest(): GoogleSignInRequest {
    const state: string = GoogleSignInClient.base64Url(crypto.randomBytes(32));
    const nonce: string = GoogleSignInClient.base64Url(crypto.randomBytes(32));
    const codeVerifier: string = GoogleSignInClient.base64Url(
      crypto.randomBytes(48),
    );
    const codeChallenge: string = GoogleSignInClient.base64Url(
      crypto.createHash("sha256").update(codeVerifier, "ascii").digest(),
    );

    const params: URLSearchParams = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.redirectUri,
      scope: SCOPES,
      state: state,
      nonce: nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      // Lets someone signed in to several Google accounts choose which.
      prompt: "select_account",
    });

    return {
      authorizationUrl: `${AUTHORIZATION_URL}?${params.toString()}`,
      state: state,
      nonce: nonce,
      codeVerifier: codeVerifier,
    };
  }

  /*
   * Trade the authorization code for an ID token, verify it, and return
   * who it names - only when Google vouches for their email address.
   */
  public async completeSignIn(data: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<GoogleIdentity> {
    let response: MarketplaceHttpResponse;

    try {
      response = await this.httpClient({
        method: "POST",
        url: TOKEN_URL,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "authorization_code",
          code: data.code,
          redirect_uri: this.redirectUri,
          code_verifier: data.codeVerifier,
        }).toString(),
        timeoutInMs: 15_000,
      });
    } catch (err) {
      throw new GoogleSignInError(
        `Google's token endpoint did not answer: ${(err as Error).message}`,
      );
    }

    const body: Record<string, unknown> | null =
      MarketplaceHttp.parseJsonObject(response.body);
    const idToken: unknown = body?.["id_token"];

    if (
      !MarketplaceHttp.isSuccess(response.status) ||
      typeof idToken !== "string"
    ) {
      throw new GoogleSignInError(
        `Google refused the authorization code (HTTP ${response.status}): ${String(body?.["error"] || "")}`,
      );
    }

    return await this.verifyIdToken({ idToken: idToken, nonce: data.nonce });
  }

  public async verifyIdToken(data: {
    idToken: string;
    nonce: string;
  }): Promise<GoogleIdentity> {
    let claims: Record<string, unknown>;

    try {
      claims = await this.verifier.verify(data.idToken, {
        keySource: { kind: "jwks", url: JWKS_URL },
        audience: this.clientId,
      });
    } catch (err) {
      throw new GoogleSignInError(
        `The Google ID token is not valid: ${(err as Error).message}`,
      );
    }

    return GoogleSignInClient.readIdentity(claims, data.nonce);
  }

  // Who verified claims name, and whether Google vouches for their address.
  public static readIdentity(
    claims: Record<string, unknown>,
    expectedNonce: string,
  ): GoogleIdentity {
    const issuer: unknown = claims["iss"];
    const subject: unknown = claims["sub"];

    if (typeof issuer !== "string" || !GOOGLE_ISSUERS.includes(issuer)) {
      throw new GoogleSignInError(
        "The Google ID token was not issued by Google.",
      );
    }

    if (
      typeof claims["nonce"] !== "string" ||
      !GoogleSignInClient.safeEqual(claims["nonce"], expectedNonce)
    ) {
      throw new GoogleSignInError(
        "The Google ID token does not belong to this sign-in.",
      );
    }

    if (typeof subject !== "string" || !subject) {
      throw new GoogleSignInError("The Google ID token names no user.");
    }

    const emailClaim: unknown = claims["email"];

    if (typeof emailClaim !== "string" || !Email.isValid(emailClaim)) {
      throw new GoogleSignInError(
        "The Google ID token carries no email address.",
        "Your Google account did not share an email address with OneUptime. Please sign in with your email and password.",
      );
    }

    // A boolean in Google's ID tokens; older ones sent the string.
    const isEmailVerified: boolean =
      claims["email_verified"] === true || claims["email_verified"] === "true";

    if (!isEmailVerified) {
      throw new GoogleSignInError(
        "Google has not verified the email address in this ID token (email_verified is not true).",
        "Google has not verified your Google account's email address, so OneUptime cannot sign you in with it. Please sign in with your email and password.",
      );
    }

    const hostedDomainClaim: unknown = claims["hd"];
    const hostedDomain: string | null =
      typeof hostedDomainClaim === "string" && hostedDomainClaim.trim()
        ? hostedDomainClaim.trim()
        : null;
    const emailDomain: string = emailClaim
      .slice(emailClaim.lastIndexOf("@") + 1)
      .toLowerCase();

    if (!hostedDomain && !GMAIL_DOMAINS.includes(emailDomain)) {
      throw new GoogleSignInError(
        "Google is not authoritative for the email address in this ID token (no hd, and not a Gmail address).",
        "Your Google account uses an email address from another provider, which Google cannot confirm is still yours, so OneUptime cannot sign you in with it. Please sign in with your email and password.",
      );
    }

    const name: unknown = claims["name"];

    return {
      email: new Email(emailClaim),
      name: typeof name === "string" && name.trim() ? name.trim() : null,
      subject: subject,
      hostedDomain: hostedDomain,
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
