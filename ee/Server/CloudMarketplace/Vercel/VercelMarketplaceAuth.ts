import { VercelMarketplaceClientId } from "Common/Server/EnvironmentConfig";
import RemoteJwtVerifier, {
  JwtVerificationError,
} from "Common/Server/Utils/Marketplace/RemoteJwtVerifier";

/*
 * Who is calling: every request Vercel makes to OneUptime's provider API
 * carries an OIDC token Vercel signed (Authorization: Bearer ...), and so
 * does the ID token a sign-in from Vercel is exchanged for.
 *
 * The token is RS256, signed with a key Vercel publishes at
 * https://marketplace.vercel.com/.well-known/jwks, issued by
 * https://marketplace.vercel.com for the integration's client ID - its
 * audience. A token Vercel sends on a person's behalf (user auth) names the
 * person, their role in the team and their email address; one it sends on
 * its own (system auth: renewals, sync, an account being deleted) names only
 * the team and the installation.
 *
 * https://vercel.com/docs/integrations/create-integration/marketplace-api
 */

export const VERCEL_MARKETPLACE_ISSUER: string =
  "https://marketplace.vercel.com";
export const VERCEL_MARKETPLACE_JWKS_URL: string =
  "https://marketplace.vercel.com/.well-known/jwks";

// ADMIN: may install integrations and manage resources. USER: Vercel's read-only (Billing, Viewer) roles.
export type VercelUserRole = "ADMIN" | "USER";

/*
 * What a token is for, in its "type" claim: calls to the provider API carry
 * an access token, and a sign-in is exchanged for an ID token. One is never
 * accepted for the other.
 */
export type VercelTokenType = "access_token" | "id_token";

export interface VercelMarketplaceCaller {
  kind: "user" | "system";
  /*
   * The Vercel team. Null only on a system token for something no team has
   * yet: the plans Vercel shows before anyone installs OneUptime.
   */
  accountId: string | null;
  // Null only on a system token for something no installation is part of yet.
  installationId: string | null;
  userId?: string | undefined;
  userRole?: VercelUserRole | undefined;
  userEmail?: string | undefined;
  isUserEmailVerified?: boolean | undefined;
  userName?: string | undefined;
}

// A request OneUptime will not act on: Vercel is answered 403, as its example provider does.
export class VercelAuthError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "VercelAuthError";
  }
}

const BEARER_PATTERN: RegExp = /^bearer\s+(\S+)$/i;
const USER_SUBJECT_PATTERN: RegExp = /^account:[0-9a-fA-F]+:user:[0-9a-fA-F]+$/;

export default class VercelMarketplaceAuth {
  private verifier: RemoteJwtVerifier;
  private clientId: string | null;

  public constructor(options?: {
    verifier?: RemoteJwtVerifier | undefined;
    clientId?: string | null | undefined;
  }) {
    this.verifier = options?.verifier || VercelMarketplaceAuth.getVerifier();
    this.clientId =
      options?.clientId !== undefined
        ? options.clientId
        : VercelMarketplaceClientId;
  }

  // One verifier for the process, so Vercel's keys are fetched once an hour, not per request.
  private static sharedVerifier: RemoteJwtVerifier | null = null;

  private static getVerifier(): RemoteJwtVerifier {
    if (!VercelMarketplaceAuth.sharedVerifier) {
      VercelMarketplaceAuth.sharedVerifier = new RemoteJwtVerifier();
    }

    return VercelMarketplaceAuth.sharedVerifier;
  }

  // The caller of a provider API request, from its Authorization header.
  public async verifyAuthorizationHeader(
    header: unknown,
  ): Promise<VercelMarketplaceCaller> {
    const value: string =
      typeof header === "string"
        ? header
        : Array.isArray(header) && typeof header[0] === "string"
          ? header[0]
          : "";

    const match: RegExpMatchArray | null = value.trim().match(BEARER_PATTERN);

    if (!match) {
      throw new VercelAuthError("The request carries no Vercel token.");
    }

    return await this.verifyToken(match[1]!, "access_token");
  }

  // The caller a Vercel token names, once it is known to be Vercel's and for this integration.
  public async verifyToken(
    token: string,
    expectedType: VercelTokenType,
  ): Promise<VercelMarketplaceCaller> {
    if (!this.clientId) {
      throw new VercelAuthError(
        "Vercel Marketplace is not set up on this server.",
      );
    }

    let claims: Record<string, unknown>;

    try {
      claims = await this.verifier.verify(token, {
        keySource: { kind: "jwks", url: VERCEL_MARKETPLACE_JWKS_URL },
        issuer: VERCEL_MARKETPLACE_ISSUER,
        audience: this.clientId,
      });
    } catch (err) {
      if (err instanceof JwtVerificationError) {
        throw new VercelAuthError(err.message);
      }

      throw err;
    }

    return VercelMarketplaceAuth.readCaller(claims, expectedType);
  }

  public static readCaller(
    claims: Record<string, unknown>,
    expectedType: VercelTokenType,
  ): VercelMarketplaceCaller {
    const type: unknown = claims["type"];

    if (type !== undefined && type !== expectedType) {
      throw new VercelAuthError(
        `The token is ${String(type)}, not ${expectedType}.`,
      );
    }

    const accountId: unknown = claims["account_id"];
    const installationId: unknown = claims["installation_id"];
    const userId: unknown = claims["user_id"];
    const subject: unknown = claims["sub"];

    const caller: VercelMarketplaceCaller = {
      kind: "system",
      accountId: typeof accountId === "string" && accountId ? accountId : null,
      installationId:
        typeof installationId === "string" && installationId
          ? installationId
          : null,
    };

    /*
     * A user token names a person in its subject and in user_id; a system
     * token has neither. A token that names a person but no role is neither
     * one, and is refused rather than read as a system call - which would
     * let it do what only Vercel itself may.
     */
    const namesUser: boolean =
      (typeof userId === "string" && Boolean(userId)) ||
      (typeof subject === "string" && USER_SUBJECT_PATTERN.test(subject));

    if (!namesUser) {
      return caller;
    }

    const role: unknown = claims["user_role"];

    if (typeof userId !== "string" || !userId) {
      throw new VercelAuthError("The token names no Vercel user.");
    }

    // A person is always someone in a team.
    if (!caller.accountId) {
      throw new VercelAuthError("The token names no Vercel account.");
    }

    if (role !== "ADMIN" && role !== "USER") {
      throw new VercelAuthError("The token names no role for its user.");
    }

    const email: unknown = claims["user_email"];
    const verified: unknown =
      claims["user_email_verified"] !== undefined
        ? claims["user_email_verified"]
        : claims["email_verified"];
    const name: unknown = claims["user_name"];

    return {
      ...caller,
      kind: "user",
      userId: userId,
      userRole: role,
      userEmail:
        typeof email === "string" && email.trim()
          ? email.trim().toLowerCase()
          : undefined,
      isUserEmailVerified: verified === true,
      userName:
        typeof name === "string" && name.trim() ? name.trim() : undefined,
    };
  }
}
