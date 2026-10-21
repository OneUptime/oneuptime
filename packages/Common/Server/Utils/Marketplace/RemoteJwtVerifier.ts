import crypto from "crypto";
import jwt from "jsonwebtoken";
import {
  MarketplaceHttp,
  MarketplaceHttpClient,
  MarketplaceHttpResponse,
  defaultMarketplaceHttpClient,
} from "./MarketplaceHttp";

/*
 * Verifies an RS256 JSON Web Token signed by somebody else, with the signing
 * keys they publish:
 *
 *   - Microsoft Entra ID, which signs the bearer token on every Microsoft
 *     Marketplace webhook call, and the ID token of Sign in with Microsoft
 *     (a JWKS document);
 *   - Google Cloud Marketplace, which signs the token a buyer arrives with
 *     (a map of key ID to X.509 certificate);
 *   - Google, which signs the OIDC token on each Pub/Sub push delivery (a
 *     JWKS document).
 *
 * Only RS256 is accepted, whatever the token's header says - the "alg: none"
 * and HMAC-with-the-public-key confusions both start by letting the token
 * choose. The key is chosen by the token's "kid" among the issuer's keys and
 * nowhere else.
 *
 * Keys are cached per document for an hour. A token signed with a key not in
 * the cached set - the issuer rotated its keys - refetches the document, at
 * most once every five minutes, so a stream of tokens with made-up key IDs
 * cannot turn every request into a fetch.
 */

export type JwtKeySource =
  | { kind: "jwks"; url: string }
  | { kind: "x509"; url: string };

export interface VerifyJwtOptions {
  keySource: JwtKeySource;
  audience?: string | Array<string> | undefined;
  issuer?: string | Array<string> | undefined;
  clockToleranceInSeconds?: number | undefined;
}

export class JwtVerificationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "JwtVerificationError";
  }
}

interface CachedKeys {
  keys: Map<string, crypto.KeyObject>;
  fetchedAtInMs: number;
}

const KEYS_TTL_IN_MS: number = 60 * 60 * 1000;
const MIN_REFETCH_INTERVAL_IN_MS: number = 5 * 60 * 1000;
const DEFAULT_CLOCK_TOLERANCE_IN_SECONDS: number = 60;
// A compact JWS from these issuers is a few kilobytes; anything far larger is not one.
const MAX_TOKEN_LENGTH: number = 16 * 1024;

export default class RemoteJwtVerifier {
  private cache: Map<string, CachedKeys> = new Map();
  private httpClient: MarketplaceHttpClient;
  private now: () => number;

  public constructor(options?: {
    httpClient?: MarketplaceHttpClient | undefined;
    now?: (() => number) | undefined;
  }) {
    this.httpClient = options?.httpClient || defaultMarketplaceHttpClient;
    this.now =
      options?.now ||
      ((): number => {
        return Date.now();
      });
  }

  // The token's claims when it is genuine; throws JwtVerificationError otherwise.
  public async verify(
    token: string,
    options: VerifyJwtOptions,
  ): Promise<Record<string, unknown>> {
    if (
      typeof token !== "string" ||
      !token ||
      token.length > MAX_TOKEN_LENGTH
    ) {
      throw new JwtVerificationError("The token is missing or malformed.");
    }

    const header: Record<string, unknown> = RemoteJwtVerifier.readHeader(token);

    if (header["alg"] !== "RS256") {
      throw new JwtVerificationError("The token is not signed with RS256.");
    }

    const keyId: unknown = header["kid"];

    if (typeof keyId !== "string" || !keyId) {
      throw new JwtVerificationError("The token does not name its key.");
    }

    const key: crypto.KeyObject = await this.getKey(options.keySource, keyId);
    const publicKeyPem: string = key
      .export({ type: "spki", format: "pem" })
      .toString();

    let payload: string | jwt.JwtPayload;

    try {
      payload = jwt.verify(token, publicKeyPem, {
        algorithms: ["RS256"],
        clockTolerance:
          options.clockToleranceInSeconds ?? DEFAULT_CLOCK_TOLERANCE_IN_SECONDS,
        clockTimestamp: Math.floor(this.now() / 1000),
        ...(options.audience !== undefined
          ? {
              audience: options.audience as string | [string, ...Array<string>],
            }
          : {}),
        ...(options.issuer !== undefined
          ? { issuer: options.issuer as string | [string, ...Array<string>] }
          : {}),
      });
    } catch (err) {
      throw new JwtVerificationError(
        `The token is not valid: ${(err as Error).message}`,
      );
    }

    if (!payload || typeof payload !== "object") {
      throw new JwtVerificationError("The token has no claims.");
    }

    // jsonwebtoken checks exp only when present; every token here must expire.
    if (typeof payload.exp !== "number") {
      throw new JwtVerificationError("The token does not expire.");
    }

    return payload as Record<string, unknown>;
  }

  public static readHeader(token: string): Record<string, unknown> {
    const firstDot: number = token.indexOf(".");

    if (firstDot <= 0) {
      throw new JwtVerificationError("The token is malformed.");
    }

    try {
      const decoded: unknown = JSON.parse(
        Buffer.from(token.substring(0, firstDot), "base64url").toString("utf8"),
      );

      if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
        return decoded as Record<string, unknown>;
      }
    } catch {
      // Falls through to the refusal below.
    }

    throw new JwtVerificationError("The token header is malformed.");
  }

  private async getKey(
    source: JwtKeySource,
    keyId: string,
  ): Promise<crypto.KeyObject> {
    const cached: CachedKeys | undefined = this.cache.get(source.url);
    const nowInMs: number = this.now();

    if (cached && nowInMs - cached.fetchedAtInMs < KEYS_TTL_IN_MS) {
      const key: crypto.KeyObject | undefined = cached.keys.get(keyId);

      if (key) {
        return key;
      }

      if (nowInMs - cached.fetchedAtInMs < MIN_REFETCH_INTERVAL_IN_MS) {
        throw new JwtVerificationError(
          "The token is signed with an unknown key.",
        );
      }
    }

    const keys: Map<string, crypto.KeyObject> = await this.fetchKeys(source);
    this.cache.set(source.url, { keys: keys, fetchedAtInMs: nowInMs });

    const key: crypto.KeyObject | undefined = keys.get(keyId);

    if (!key) {
      throw new JwtVerificationError(
        "The token is signed with an unknown key.",
      );
    }

    return key;
  }

  private async fetchKeys(
    source: JwtKeySource,
  ): Promise<Map<string, crypto.KeyObject>> {
    let response: MarketplaceHttpResponse;

    try {
      response = await this.httpClient({
        method: "GET",
        url: source.url,
        timeoutInMs: 10_000,
      });
    } catch (err) {
      throw new JwtVerificationError(
        `The signing keys could not be fetched: ${(err as Error).message}`,
      );
    }

    if (!MarketplaceHttp.isSuccess(response.status)) {
      throw new JwtVerificationError(
        `The signing keys could not be fetched (HTTP ${response.status}).`,
      );
    }

    const document: Record<string, unknown> | null =
      MarketplaceHttp.parseJsonObject(response.body);

    if (!document) {
      throw new JwtVerificationError("The signing keys document is not JSON.");
    }

    return source.kind === "jwks"
      ? RemoteJwtVerifier.keysFromJwks(document)
      : RemoteJwtVerifier.keysFromX509Map(document);
  }

  // RSA signing keys of a JWKS document, by key ID. Anything else in it is skipped.
  public static keysFromJwks(
    document: Record<string, unknown>,
  ): Map<string, crypto.KeyObject> {
    const keys: Map<string, crypto.KeyObject> = new Map();
    const entries: unknown = document["keys"];

    if (!Array.isArray(entries)) {
      return keys;
    }

    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const jwk: Record<string, unknown> = entry as Record<string, unknown>;

      if (
        jwk["kty"] !== "RSA" ||
        typeof jwk["kid"] !== "string" ||
        typeof jwk["n"] !== "string" ||
        typeof jwk["e"] !== "string" ||
        (jwk["use"] !== undefined && jwk["use"] !== "sig")
      ) {
        continue;
      }

      try {
        keys.set(
          jwk["kid"],
          crypto.createPublicKey({
            key: { kty: "RSA", n: jwk["n"], e: jwk["e"] },
            format: "jwk",
          }),
        );
      } catch {
        // A key Node cannot read cannot have signed anything we accept.
      }
    }

    return keys;
  }

  // A {"key id": "-----BEGIN CERTIFICATE-----..."} document, by key ID.
  public static keysFromX509Map(
    document: Record<string, unknown>,
  ): Map<string, crypto.KeyObject> {
    const keys: Map<string, crypto.KeyObject> = new Map();

    for (const [keyId, certificate] of Object.entries(document)) {
      if (typeof certificate !== "string") {
        continue;
      }

      try {
        keys.set(keyId, crypto.createPublicKey(certificate));
      } catch {
        // Skipped, as above.
      }
    }

    return keys;
  }
}
