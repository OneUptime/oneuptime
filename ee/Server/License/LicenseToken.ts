import crypto, { KeyObject } from "crypto";
import EnterpriseFeature, {
  ENTERPRISE_FEATURE_WILDCARD,
  parseEnterpriseFeature,
} from "Common/Server/Enterprise/EnterpriseFeature";
import {
  EnterpriseLicenseFeatures,
  EnterpriseLicenseGraceReason,
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseStatus,
  EnterpriseLicenseVerification,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import type { TrustedLicenseKey } from "./TrustedLicenseKeys";

/*
 * The signed OneUptime Enterprise license: a compact JWS signed with Ed25519
 * ("EdDSA"), verifiable offline against the public keys in
 * TrustedLicenseKeys.ts. Shared by the license client (verify + classify) and
 * the license server (sign).
 *
 * The parser is deliberately strict. A license token is attacker-controlled
 * input (it can be pasted into the product for offline activation) and it
 * lands in a UNIQUE text column, so anything that is not exactly the canonical
 * shape this module produces is rejected rather than interpreted:
 *
 *   - at most 4 KB (the largest real token is under 1 KB);
 *   - exactly three segments, each non-empty base64url with no padding;
 *   - every segment must re-encode to itself (Node's decoder silently ignores
 *     trailing junk, which would make token strings non-canonical);
 *   - alg must be exactly "EdDSA"; the signature must be exactly 64 bytes;
 *   - headers that point at other keys (jku, jwk, x5u, x5c) or demand
 *     extensions (crit) are refused - keys are never fetched;
 *   - no nbf, and iat is never compared with the local clock (clock skew must
 *     never invalidate a license). exp is compared by the classifier only.
 */

export const LICENSE_TOKEN_MAX_LENGTH: number = 4096;

export const LICENSE_TOKEN_ALGORITHM: string = "EdDSA";

export const LEGACY_LICENSE_TOKEN_ALGORITHM: string = "HS256";

export const LICENSE_TOKEN_ISSUER: string = "https://oneuptime.com";

/*
 * Stops any other JWT the ecosystem issues (a session token, say) from being
 * accepted as a license. (A license can never be used as a session either:
 * jsonwebtoken rejects EdDSA.)
 */
export const LICENSE_TOKEN_AUDIENCE: string = "oneuptime-enterprise-license";

const ED25519_SIGNATURE_LENGTH_IN_BYTES: number = 64;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const BASE64URL_SEGMENT: RegExp = /^[A-Za-z0-9_-]+$/;

const FORBIDDEN_HEADER_PARAMETERS: ReadonlyArray<string> = [
  "crit",
  "jku",
  "jwk",
  "x5u",
  "x5c",
];

export interface LicenseTokenClaims {
  iss: string;
  aud: string;
  // The license id.
  sub: string;
  licenseKey: string;
  companyName: string;
  // Null means no seat limit.
  userLimit: number | null;
  isEvaluation: boolean;
  // ["*"] for every feature, or a subset of EnterpriseFeature values.
  features: Array<string>;
  // When present, the license is valid only on the instance with this id.
  instanceId?: string | undefined;
  // Seconds since the epoch. Informational only.
  iat?: number | undefined;
  // Seconds since the epoch.
  exp: number;
}

export type LicenseTokenErrorCode =
  | "not-a-string"
  | "too-large"
  | "malformed"
  | "unsupported-algorithm"
  | "forbidden-header"
  | "missing-key-id"
  | "bad-signature-encoding"
  | "bad-claims"
  | "bad-key";

export class LicenseTokenError extends Error {
  public readonly code: LicenseTokenErrorCode;

  public constructor(code: LicenseTokenErrorCode, message: string) {
    super(message);
    this.name = "LicenseTokenError";
    this.code = code;
  }
}

export interface DecodedLicenseTokenHeader {
  header: Record<string, unknown>;
  alg: string;
  kid: string | null;
}

export interface ParsedLicenseToken {
  header: Record<string, unknown>;
  kid: string;
  payload: Record<string, unknown>;
  // "<header>.<payload>", the bytes the signature covers.
  signingInput: string;
  signature: Buffer;
}

type JsonRecord = Record<string, unknown>;

const isPlainObject: (value: unknown) => value is JsonRecord = (
  value: unknown,
): value is JsonRecord => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toBase64Url: (value: Buffer | string) => string = (
  value: Buffer | string,
): string => {
  return Buffer.from(value).toString("base64url");
};

export default class LicenseToken {
  /*
   * Decodes one segment, refusing anything but canonical, unpadded base64url
   * (the re-encode check is what rejects trailing characters).
   */
  public static decodeSegment(segment: string, name: string): Buffer {
    if (!segment || !BASE64URL_SEGMENT.test(segment)) {
      throw new LicenseTokenError(
        "malformed",
        `The license token's ${name} is not base64url.`,
      );
    }

    const decoded: Buffer = Buffer.from(segment, "base64url");

    if (decoded.toString("base64url") !== segment) {
      throw new LicenseTokenError(
        "malformed",
        `The license token's ${name} is not canonical base64url.`,
      );
    }

    return decoded;
  }

  public static decodeJsonSegment(segment: string, name: string): JsonRecord {
    const decoded: Buffer = LicenseToken.decodeSegment(segment, name);

    let value: unknown = undefined;

    try {
      value = JSON.parse(decoded.toString("utf8"));
    } catch {
      throw new LicenseTokenError(
        "malformed",
        `The license token's ${name} is not JSON.`,
      );
    }

    if (!isPlainObject(value)) {
      throw new LicenseTokenError(
        "malformed",
        `The license token's ${name} is not a JSON object.`,
      );
    }

    return value;
  }

  /*
   * The checks every token gets whatever its algorithm - including legacy
   * HS256 tokens, which are recognised but cannot be verified here: size,
   * three canonical base64url segments, and a JSON-object header with a
   * string "alg".
   */
  public static decodeHeader(token: unknown): DecodedLicenseTokenHeader {
    if (typeof token !== "string") {
      throw new LicenseTokenError(
        "not-a-string",
        "The license token is not a string.",
      );
    }

    if (token.length > LICENSE_TOKEN_MAX_LENGTH) {
      throw new LicenseTokenError(
        "too-large",
        `The license token is longer than ${LICENSE_TOKEN_MAX_LENGTH} characters.`,
      );
    }

    const segments: Array<string> = token.split(".");

    if (segments.length !== 3) {
      throw new LicenseTokenError(
        "malformed",
        "The license token must have exactly three segments.",
      );
    }

    for (const segment of segments) {
      if (!BASE64URL_SEGMENT.test(segment)) {
        throw new LicenseTokenError(
          "malformed",
          "Every segment of the license token must be non-empty base64url.",
        );
      }
    }

    const header: JsonRecord = LicenseToken.decodeJsonSegment(
      segments[0] as string,
      "header",
    );

    if (typeof header["alg"] !== "string") {
      throw new LicenseTokenError(
        "malformed",
        'The license token header has no "alg".',
      );
    }

    return {
      header,
      alg: header["alg"],
      kid:
        typeof header["kid"] === "string" && header["kid"].length > 0
          ? header["kid"]
          : null,
    };
  }

  /*
   * The full strict parse of an EdDSA license token. Does NOT check the
   * signature (see verifySignature) or any claim.
   */
  public static parse(token: unknown): ParsedLicenseToken {
    const decoded: DecodedLicenseTokenHeader = LicenseToken.decodeHeader(token);
    const segments: Array<string> = (token as string).split(".");

    if (decoded.alg !== LICENSE_TOKEN_ALGORITHM) {
      throw new LicenseTokenError(
        "unsupported-algorithm",
        `The license token is signed with "${decoded.alg}"; only "${LICENSE_TOKEN_ALGORITHM}" is accepted.`,
      );
    }

    for (const parameter of FORBIDDEN_HEADER_PARAMETERS) {
      if (Object.prototype.hasOwnProperty.call(decoded.header, parameter)) {
        throw new LicenseTokenError(
          "forbidden-header",
          `The license token header carries "${parameter}", which is not accepted.`,
        );
      }
    }

    if (!decoded.kid) {
      throw new LicenseTokenError(
        "missing-key-id",
        'The license token header has no "kid".',
      );
    }

    const payload: JsonRecord = LicenseToken.decodeJsonSegment(
      segments[1] as string,
      "payload",
    );

    let signature: Buffer;

    try {
      signature = LicenseToken.decodeSegment(
        segments[2] as string,
        "signature",
      );
    } catch {
      throw new LicenseTokenError(
        "bad-signature-encoding",
        "The license token signature is not canonical base64url.",
      );
    }

    if (signature.length !== ED25519_SIGNATURE_LENGTH_IN_BYTES) {
      throw new LicenseTokenError(
        "bad-signature-encoding",
        `The license token signature is ${signature.length} bytes; an Ed25519 signature is ${ED25519_SIGNATURE_LENGTH_IN_BYTES}.`,
      );
    }

    return {
      header: decoded.header,
      kid: decoded.kid,
      payload,
      signingInput: `${segments[0]}.${segments[1]}`,
      signature,
    };
  }

  // Never throws: a key of the wrong type or a bad signature is simply false.
  public static verifySignature(
    parsed: ParsedLicenseToken,
    publicKey: KeyObject,
  ): boolean {
    try {
      if (publicKey.asymmetricKeyType !== "ed25519") {
        return false;
      }

      return crypto.verify(
        null,
        Buffer.from(parsed.signingInput, "utf8"),
        publicKey,
        parsed.signature,
      );
    } catch {
      return false;
    }
  }

  /*
   * RFC 7638 JWK thumbprint (SHA-256, base64url) of an Ed25519 key: the hash of
   * {"crv":"Ed25519","kty":"OKP","x":"..."} with the members in that order and
   * no whitespace. Accepts the private key too (its public half is used).
   */
  public static computeKeyId(key: KeyObject): string {
    /*
     * The public half of a private key, derived through its PKCS#8 export
     * (this @types/node does not type createPublicKey(KeyObject)).
     */
    const publicKey: KeyObject =
      key.type === "private"
        ? crypto.createPublicKey(key.export({ type: "pkcs8", format: "pem" }))
        : key;

    if (publicKey.asymmetricKeyType !== "ed25519") {
      throw new LicenseTokenError(
        "bad-key",
        `License keys must be Ed25519, not ${publicKey.asymmetricKeyType || "unknown"}.`,
      );
    }

    const jwk: JsonRecord = publicKey.export({ format: "jwk" }) as JsonRecord;

    if (typeof jwk["x"] !== "string") {
      throw new LicenseTokenError("bad-key", "The Ed25519 key has no x.");
    }

    const canonicalJwk: string = `{"crv":"Ed25519","kty":"OKP","x":"${jwk["x"]}"}`;

    return crypto
      .createHash("sha256")
      .update(canonicalJwk, "utf8")
      .digest("base64url");
  }

  /*
   * Checks and narrows a verified payload's claims. Throws bad-claims. The
   * token's own expiry is NOT judged here (see classifyLicenseToken).
   */
  public static validateClaims(payload: JsonRecord): LicenseTokenClaims {
    const fail: (message: string) => never = (message: string): never => {
      throw new LicenseTokenError("bad-claims", message);
    };

    if (payload["iss"] !== LICENSE_TOKEN_ISSUER) {
      fail(`The license was not issued by ${LICENSE_TOKEN_ISSUER}.`);
    }

    if (payload["aud"] !== LICENSE_TOKEN_AUDIENCE) {
      fail("The token is not a OneUptime Enterprise license.");
    }

    const sub: unknown = payload["sub"];
    const licenseKey: unknown = payload["licenseKey"];
    const companyName: unknown = payload["companyName"];
    const userLimit: unknown = payload["userLimit"];
    const isEvaluation: unknown = payload["isEvaluation"];
    const features: unknown = payload["features"];
    const instanceId: unknown = payload["instanceId"];
    const iat: unknown = payload["iat"];
    const exp: unknown = payload["exp"];

    if (typeof sub !== "string" || sub.length === 0) {
      fail('The license has no license id ("sub").');
    }

    if (typeof licenseKey !== "string" || licenseKey.length === 0) {
      fail("The license has no license key.");
    }

    if (typeof companyName !== "string") {
      fail("The license has no company name.");
    }

    if (
      userLimit !== null &&
      (typeof userLimit !== "number" ||
        !Number.isFinite(userLimit) ||
        userLimit < 0)
    ) {
      fail("The license's user limit is not a non-negative number or null.");
    }

    if (typeof isEvaluation !== "boolean") {
      fail("The license does not say whether it is an evaluation license.");
    }

    if (
      !Array.isArray(features) ||
      !features.every((feature: unknown): boolean => {
        return typeof feature === "string";
      })
    ) {
      fail("The license's features are not a list of names.");
    }

    if (
      instanceId !== undefined &&
      (typeof instanceId !== "string" || instanceId.length === 0)
    ) {
      fail("The license's instance id is not a string.");
    }

    if (typeof exp !== "number" || !Number.isFinite(exp)) {
      fail("The license has no expiry.");
    }

    return {
      iss: LICENSE_TOKEN_ISSUER,
      aud: LICENSE_TOKEN_AUDIENCE,
      sub: sub as string,
      licenseKey: licenseKey as string,
      companyName: companyName as string,
      userLimit: userLimit as number | null,
      isEvaluation: isEvaluation as boolean,
      features: features as Array<string>,
      instanceId: instanceId as string | undefined,
      iat: typeof iat === "number" && Number.isFinite(iat) ? iat : undefined,
      exp: exp as number,
    };
  }

  // ["*"] (anywhere in the list) is everything; unknown names are ignored.
  public static toSnapshotFeatures(
    features: Array<string>,
  ): EnterpriseLicenseFeatures {
    if (features.includes(ENTERPRISE_FEATURE_WILDCARD)) {
      return "all";
    }

    const parsed: Array<EnterpriseFeature> = [];

    for (const feature of features) {
      const known: EnterpriseFeature | null = parseEnterpriseFeature(feature);

      if (known && !parsed.includes(known)) {
        parsed.push(known);
      }
    }

    return parsed;
  }

  /*
   * Signs a license. The kid is derived from the key, so a token can never
   * name a key other than the one that signed it. The claims are validated
   * first: the license server must never issue a token its own clients would
   * reject.
   */
  public static sign(claims: LicenseTokenClaims, privateKey: KeyObject): string {
    if (
      privateKey.type !== "private" ||
      privateKey.asymmetricKeyType !== "ed25519"
    ) {
      throw new LicenseTokenError(
        "bad-key",
        "License tokens are signed with an Ed25519 private key.",
      );
    }

    LicenseToken.validateClaims(claims as unknown as JsonRecord);

    const header: JsonRecord = {
      alg: LICENSE_TOKEN_ALGORITHM,
      typ: "JWT",
      kid: LicenseToken.computeKeyId(privateKey),
    };

    const payload: JsonRecord = {};

    for (const [key, value] of Object.entries(claims)) {
      if (value !== undefined) {
        payload[key] = value;
      }
    }

    const signingInput: string = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`;
    const signature: Buffer = crypto.sign(
      null,
      Buffer.from(signingInput, "utf8"),
      privateKey,
    );
    const token: string = `${signingInput}.${signature.toString("base64url")}`;

    if (token.length > LICENSE_TOKEN_MAX_LENGTH) {
      throw new LicenseTokenError(
        "too-large",
        `The signed license token is longer than ${LICENSE_TOKEN_MAX_LENGTH} characters.`,
      );
    }

    return token;
  }
}

export interface TrustedKeyProblem {
  kid: string;
  problem: string;
}

export interface ResolvedTrustedLicenseKeys {
  keys: Map<string, KeyObject>;
  problems: Array<TrustedKeyProblem>;
}

/*
 * Parses the trusted-key list, skipping (and reporting) any entry that is not
 * an Ed25519 public key whose kid is its thumbprint. Never throws.
 */
export const resolveTrustedLicenseKeys: (
  trustedKeys: ReadonlyArray<TrustedLicenseKey>,
) => ResolvedTrustedLicenseKeys = (
  trustedKeys: ReadonlyArray<TrustedLicenseKey>,
): ResolvedTrustedLicenseKeys => {
  const keys: Map<string, KeyObject> = new Map<string, KeyObject>();
  const problems: Array<TrustedKeyProblem> = [];

  for (const trustedKey of trustedKeys) {
    const kid: string = String(trustedKey?.kid || "");

    /*
     * createPublicKey would happily derive a public key from a PRIVATE key
     * PEM. A private key must never sit in source, so such an entry is
     * refused rather than quietly working.
     */
    if (String(trustedKey?.publicKeyPem || "").includes("PRIVATE KEY")) {
      problems.push({ kid, problem: "is a private key, not a public key" });
      continue;
    }

    try {
      const publicKey: KeyObject = crypto.createPublicKey(
        trustedKey.publicKeyPem,
      );

      if (publicKey.asymmetricKeyType !== "ed25519") {
        problems.push({
          kid,
          problem: `is ${publicKey.asymmetricKeyType || "unknown"}, not ed25519`,
        });
        continue;
      }

      const thumbprint: string = LicenseToken.computeKeyId(publicKey);

      if (thumbprint !== kid) {
        problems.push({
          kid,
          problem: `kid does not match the key's thumbprint (${thumbprint})`,
        });
        continue;
      }

      keys.set(kid, publicKey);
    } catch (err) {
      problems.push({
        kid,
        problem: `could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return { keys, problems };
};

export interface LicenseStoredColumns {
  // GlobalConfig.enterpriseLicenseExpiresAt
  expiresAt?: Date | null | undefined;
  // GlobalConfig.enterpriseCompanyName
  companyName?: string | null | undefined;
  // GlobalConfig.enterpriseLicenseUserLimit
  userLimit?: number | null | undefined;
  // GlobalConfig.enterpriseLicenseIsEvaluation
  isEvaluation?: boolean | null | undefined;
  // GlobalConfig.enterpriseEditionFirstSeenAt
  enterpriseEditionFirstSeenAt?: Date | null | undefined;
}

export interface ClassifyLicenseTokenInput {
  token: string | null | undefined;
  storedColumns: LicenseStoredColumns;
  now: Date;
  trustedKeys: ReadonlyArray<TrustedLicenseKey>;
  localInstanceId: string | null | undefined;
  graceDays: number;
  // AcceptUnverifiedLegacyLicenses: legacy HS256 and unknown-kid tokens.
  acceptUnverified: boolean;
}

export type LicenseClassificationReason =
  | "no-token"
  | "unlicensed-grace"
  | "unlicensed-grace-over"
  | "verified"
  | "unverified"
  | "unverified-not-accepted"
  | "unverified-without-expiry"
  | "malformed"
  | "unsupported-algorithm"
  | "bad-signature"
  | "bad-claims"
  | "instance-mismatch";

export interface LicenseTokenClassification extends EnterpriseLicenseSnapshot {
  reason: LicenseClassificationReason;
  // The key that signed a verified token, or the unknown kid of an unverified one.
  kid?: string | undefined;
  // The license id ("sub") of a verified token.
  licenseId?: string | undefined;
  // The instance a verified token is bound to, if any.
  instanceId?: string | undefined;
}

interface ExpiryVerdict {
  status: EnterpriseLicenseStatus;
  graceReason?: EnterpriseLicenseGraceReason | undefined;
  graceEndsAt?: Date | undefined;
}

const isValidDate: (value: unknown) => value is Date = (
  value: unknown,
): value is Date => {
  return value instanceof Date && !Number.isNaN(value.getTime());
};

/*
 * valid while now < expiresAt; grace until expiresAt + graceDays (inclusive);
 * expired after that.
 */
const judgeExpiry: (
  expiresAt: Date,
  now: Date,
  graceDays: number,
) => ExpiryVerdict = (
  expiresAt: Date,
  now: Date,
  graceDays: number,
): ExpiryVerdict => {
  if (now.getTime() < expiresAt.getTime()) {
    return { status: "valid" };
  }

  const graceEndsAt: Date = new Date(
    expiresAt.getTime() + graceDays * DAY_IN_MS,
  );

  if (now.getTime() <= graceEndsAt.getTime()) {
    return { status: "grace", graceReason: "expired", graceEndsAt };
  }

  return { status: "expired", graceEndsAt };
};

const describeStatus: (status: EnterpriseLicenseStatus) => string = (
  status: EnterpriseLicenseStatus,
): string => {
  switch (status) {
    case "valid":
      return "The OneUptime Enterprise license is valid.";
    case "grace":
      return "The OneUptime Enterprise license has expired and is in its grace period.";
    case "expired":
      return "The OneUptime Enterprise license has expired.";
    case "missing":
      return "No OneUptime Enterprise license is installed.";
    case "invalid":
    default:
      return "The OneUptime Enterprise license is not valid.";
  }
};

const invalid: (
  reason: LicenseClassificationReason,
  verification: EnterpriseLicenseVerification,
  message: string,
  kid?: string | null | undefined,
) => LicenseTokenClassification = (
  reason: LicenseClassificationReason,
  verification: EnterpriseLicenseVerification,
  message: string,
  kid?: string | null | undefined,
): LicenseTokenClassification => {
  return {
    status: "invalid",
    verification,
    userLimit: null,
    isEvaluation: false,
    features: [],
    message,
    reason,
    kid: kid || undefined,
  };
};

const classifyMissingToken: (
  input: ClassifyLicenseTokenInput,
) => LicenseTokenClassification = (
  input: ClassifyLicenseTokenInput,
): LicenseTokenClassification => {
  const firstSeenAt: Date | null | undefined =
    input.storedColumns.enterpriseEditionFirstSeenAt;

  if (!isValidDate(firstSeenAt)) {
    return {
      status: "missing",
      verification: "none",
      userLimit: null,
      isEvaluation: false,
      features: [],
      message: describeStatus("missing"),
      reason: "no-token",
    };
  }

  const graceEndsAt: Date = new Date(
    firstSeenAt.getTime() + input.graceDays * DAY_IN_MS,
  );

  if (input.now.getTime() <= graceEndsAt.getTime()) {
    return {
      status: "grace",
      verification: "none",
      graceReason: "unlicensed",
      graceEndsAt,
      userLimit: null,
      isEvaluation: false,
      features: "all",
      message:
        "No OneUptime Enterprise license is installed. Enterprise features are available during a grace period after this installation first ran the Enterprise Edition.",
      reason: "unlicensed-grace",
    };
  }

  return {
    status: "missing",
    verification: "none",
    graceEndsAt,
    userLimit: null,
    isEvaluation: false,
    features: [],
    message: describeStatus("missing"),
    reason: "unlicensed-grace-over",
  };
};

const classifyUnverified: (
  input: ClassifyLicenseTokenInput,
  kid: string | null,
  why: string,
) => LicenseTokenClassification = (
  input: ClassifyLicenseTokenInput,
  kid: string | null,
  why: string,
): LicenseTokenClassification => {
  if (!input.acceptUnverified) {
    return invalid(
      "unverified-not-accepted",
      "unverified",
      `${why} This build no longer accepts unverified licenses.`,
      kid,
    );
  }

  const expiresAt: Date | null | undefined = input.storedColumns.expiresAt;

  if (!isValidDate(expiresAt)) {
    return invalid(
      "unverified-without-expiry",
      "unverified",
      `${why} No expiry is recorded for it.`,
      kid,
    );
  }

  const verdict: ExpiryVerdict = judgeExpiry(
    expiresAt,
    input.now,
    input.graceDays,
  );
  const userLimit: number | null | undefined = input.storedColumns.userLimit;

  return {
    status: verdict.status,
    verification: "unverified",
    graceReason: verdict.graceReason,
    graceEndsAt: verdict.graceEndsAt,
    companyName: input.storedColumns.companyName || undefined,
    expiresAt,
    userLimit:
      typeof userLimit === "number" && Number.isFinite(userLimit)
        ? userLimit
        : null,
    isEvaluation: input.storedColumns.isEvaluation === true,
    features: "all",
    message: `${describeStatus(verdict.status)} ${why}`,
    reason: "unverified",
    kid: kid || undefined,
  };
};

/*
 * Classifies the stored license into the snapshot the rest of the product
 * reads. Pure: everything it depends on is an argument.
 *
 *   no token                  -> missing, or grace ("unlicensed") within
 *                                graceDays of enterpriseEditionFirstSeenAt
 *   EdDSA, trusted kid        -> signature, iss/aud and claim shape must hold,
 *                                else invalid; an instanceId claim must match
 *                                the local instance, else invalid; then valid /
 *                                grace (<= graceDays after exp) / expired, with
 *                                every limit taken from the signed claims only
 *   EdDSA, unknown kid        -> unverified
 *   legacy HS256              -> unverified
 *   unverified                -> accepted only when acceptUnverified; expiry
 *                                from the stored column with the same grace
 *   anything else / malformed -> invalid
 */
export const classifyLicenseToken: (
  input: ClassifyLicenseTokenInput,
) => LicenseTokenClassification = (
  input: ClassifyLicenseTokenInput,
): LicenseTokenClassification => {
  if (input.token === null || input.token === undefined || input.token === "") {
    return classifyMissingToken(input);
  }

  let decoded: DecodedLicenseTokenHeader;

  try {
    decoded = LicenseToken.decodeHeader(input.token);
  } catch (err) {
    return invalid(
      "malformed",
      "none",
      `The stored license token is malformed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (decoded.alg === LEGACY_LICENSE_TOKEN_ALGORITHM) {
    return classifyUnverified(
      input,
      decoded.kid,
      "The license was issued before signed licenses and cannot be verified offline.",
    );
  }

  if (decoded.alg !== LICENSE_TOKEN_ALGORITHM) {
    return invalid(
      "unsupported-algorithm",
      "none",
      `The license token uses the "${decoded.alg}" algorithm, which is not accepted.`,
      decoded.kid,
    );
  }

  let parsed: ParsedLicenseToken;

  try {
    parsed = LicenseToken.parse(input.token);
  } catch (err) {
    return invalid(
      "malformed",
      "none",
      `The license token is malformed: ${err instanceof Error ? err.message : String(err)}`,
      decoded.kid,
    );
  }

  const trustedKey: KeyObject | undefined = resolveTrustedLicenseKeys(
    input.trustedKeys,
  ).keys.get(parsed.kid);

  if (!trustedKey) {
    return classifyUnverified(
      input,
      parsed.kid,
      "The license is signed by a key this build does not know.",
    );
  }

  if (!LicenseToken.verifySignature(parsed, trustedKey)) {
    return invalid(
      "bad-signature",
      "verified",
      "The license token's signature does not verify.",
      parsed.kid,
    );
  }

  let claims: LicenseTokenClaims;

  try {
    claims = LicenseToken.validateClaims(parsed.payload);
  } catch (err) {
    return invalid(
      "bad-claims",
      "verified",
      err instanceof Error ? err.message : String(err),
      parsed.kid,
    );
  }

  if (
    claims.instanceId !== undefined &&
    claims.instanceId !== (input.localInstanceId || undefined)
  ) {
    return {
      ...invalid(
        "instance-mismatch",
        "verified",
        "The license is bound to a different OneUptime instance.",
        parsed.kid,
      ),
      licenseId: claims.sub,
      instanceId: claims.instanceId,
    };
  }

  const expiresAt: Date = new Date(claims.exp * 1000);
  const verdict: ExpiryVerdict = judgeExpiry(
    expiresAt,
    input.now,
    input.graceDays,
  );

  return {
    status: verdict.status,
    verification: "verified",
    graceReason: verdict.graceReason,
    graceEndsAt: verdict.graceEndsAt,
    companyName: claims.companyName,
    expiresAt,
    userLimit: claims.userLimit,
    isEvaluation: claims.isEvaluation,
    features: LicenseToken.toSnapshotFeatures(claims.features),
    message: describeStatus(verdict.status),
    reason: "verified",
    kid: parsed.kid,
    licenseId: claims.sub,
    instanceId: claims.instanceId,
  };
};
