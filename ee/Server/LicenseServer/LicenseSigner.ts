import crypto, { KeyObject } from "crypto";
import { ENTERPRISE_FEATURE_WILDCARD } from "Common/Server/Enterprise/EnterpriseFeature";
import { ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import logger from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";
import LicenseToken, {
  classifyLicenseToken,
  LICENSE_TOKEN_AUDIENCE,
  LICENSE_TOKEN_ISSUER,
  LicenseTokenClaims,
  LicenseTokenClassification,
  resolveTrustedLicenseKeys,
} from "../License/LicenseToken";
import {
  getTrustedLicenseKeys,
  TrustedLicenseKey,
} from "../License/TrustedLicenseKeys";

/*
 * How the license server (OneUptime Cloud) signs the token it hands to a
 * self-hosted Enterprise installation on /validate and /report-user-count, and
 * the offline tokens a master admin downloads.
 *
 * Two formats:
 *
 *   EdDSA         the signed license (ee/Server/License/LicenseToken.ts): a
 *                 compact JWS an installation verifies offline against the
 *                 public keys its build trusts.
 *   legacy HS256  what every release before signed licenses received: a JWT
 *                 signed with this server's own ENCRYPTION_SECRET that the
 *                 installation cannot verify and only checks is present.
 *
 * EdDSA is used ONLY when ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY holds an
 * Ed25519 private key whose key id (RFC 7638 thumbprint) is in THIS build's
 * TrustedLicenseKeys, and a token signed with it classifies as verified under
 * that same list. Anything else - no key, a key that does not parse, a key of
 * another type, a key this build does not trust - keeps the legacy format,
 * whose response shape is unchanged. The server therefore can never hand out
 * a token its own release would reject, and the key ceremony order is: ship a
 * release that trusts the public key, deploy it here, then set the variable.
 *
 * The private key is read once, at boot (LicenseServer area init), and then
 * deleted from process.env so child processes never inherit it. Neither the
 * key nor any token is ever logged.
 */

export const ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV: string =
  "ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY";

// Every enterprise feature. Per-feature licenses can narrow this later.
export const LICENSE_SERVER_TOKEN_FEATURES: ReadonlyArray<string> = [
  ENTERPRISE_FEATURE_WILDCARD,
];

export type LicenseSigningMode = "eddsa" | "legacy-hs256";

export type LicenseSigningKeyProblem =
  | "not-set"
  | "unparseable"
  | "not-ed25519"
  | "not-trusted"
  | "self-test-failed";

export interface LicenseSigningState {
  mode: LicenseSigningMode;
  // The signing key's id in EdDSA mode, and the id of a parsed key this build does not trust.
  kid?: string | undefined;
  // Why the legacy format is in use. Unset in EdDSA mode.
  problem?: LicenseSigningKeyProblem | undefined;
  // Safe to log and to show a master admin: never contains key material.
  message: string;
}

export interface ResolvedLicenseSigning {
  state: LicenseSigningState;
  // Only in EdDSA mode.
  privateKey: KeyObject | null;
}

// What a token is issued for, taken from the EnterpriseLicense row.
export interface LicenseTokenSubject {
  licenseId: string;
  licenseKey: string;
  companyName: string;
  // Null means no seat limit.
  userLimit: number | null;
  isEvaluation: boolean;
  expiresAt: Date | null | undefined;
}

export interface ParsedLicenseSigningKey {
  privateKey: KeyObject;
  kid: string;
}

export class LicenseSigningKeyError extends Error {
  public readonly problem: LicenseSigningKeyProblem;

  public constructor(problem: LicenseSigningKeyProblem, message: string) {
    super(message);
    this.name = "LicenseSigningKeyError";
    this.problem = problem;
  }
}

const PEM_BEGIN_MARKER: string = "-----BEGIN";

// Base64 (standard or url-safe alphabet), padding optional.
const BASE64_TEXT: RegExp = /^[A-Za-z0-9+/_-]+={0,2}$/;

const ESCAPED_CRLF: RegExp = /\\r\\n/g;

const ESCAPED_LF: RegExp = /\\n/g;

const WHITESPACE: RegExp = /\s+/g;

const SELF_TEST_TOKEN_LIFETIME_IN_SECONDS: number = 60 * 60;

/*
 * Only Node's error code - OpenSSL messages never quote the key, but a code is
 * all an operator needs and cannot leak anything by construction.
 */
const describeCryptoError: (err: unknown) => string = (
  err: unknown,
): string => {
  const code: unknown =
    err && typeof err === "object"
      ? (err as Record<string, unknown>)["code"]
      : undefined;

  return typeof code === "string" && code.length > 0 ? ` (${code})` : "";
};

const stripSurroundingQuotes: (value: string) => string = (
  value: string,
): string => {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.substring(1, value.length - 1).trim();
  }

  return value;
};

const unescapeNewlines: (value: string) => string = (value: string): string => {
  return value.replace(ESCAPED_CRLF, "\n").replace(ESCAPED_LF, "\n");
};

const toSeconds: (date: Date) => number = (date: Date): number => {
  return Math.floor(date.getTime() / 1000);
};

export default class LicenseSigner {
  private static state: LicenseSigningState | null = null;

  private static privateKey: KeyObject | null = null;

  /*
   * The PEM text inside an environment value. Accepts, in this order:
   *   - a PEM, including one whose newlines arrived as literal "\n" (a
   *     single-line env file or Helm value), optionally quoted;
   *   - a base64-encoded PEM (itself with real or escaped newlines).
   * Returns null when the value is empty. Anything else is returned as-is
   * and fails to parse, as it should.
   */
  public static decodeSigningKeyMaterial(
    raw: string | null | undefined,
  ): string | null {
    const trimmed: string = stripSurroundingQuotes((raw || "").trim());

    if (!trimmed) {
      return null;
    }

    if (trimmed.includes(PEM_BEGIN_MARKER)) {
      return unescapeNewlines(trimmed).trim();
    }

    const compact: string = trimmed.replace(WHITESPACE, "");

    if (BASE64_TEXT.test(compact)) {
      const decoded: string = Buffer.from(compact, "base64")
        .toString("utf8")
        .trim();

      if (decoded.includes(PEM_BEGIN_MARKER)) {
        return unescapeNewlines(decoded).trim();
      }
    }

    return trimmed;
  }

  /*
   * Parses the environment value into an Ed25519 private key and its key id.
   * Throws LicenseSigningKeyError; the message never contains key material.
   */
  public static parseSigningPrivateKey(
    raw: string | null | undefined,
  ): ParsedLicenseSigningKey {
    const pem: string | null = LicenseSigner.decodeSigningKeyMaterial(raw);

    if (!pem) {
      throw new LicenseSigningKeyError(
        "not-set",
        `${ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV} is not set.`,
      );
    }

    let privateKey: KeyObject;

    try {
      privateKey = crypto.createPrivateKey(pem);
    } catch (err) {
      throw new LicenseSigningKeyError(
        "unparseable",
        `${ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV} is set but is not a private key in PEM form${describeCryptoError(err)}. ` +
          'Accepted: a PKCS#8 PEM, the same PEM with its newlines written as "\\n", or a base64-encoded PEM.',
      );
    }

    if (privateKey.asymmetricKeyType !== "ed25519") {
      throw new LicenseSigningKeyError(
        "not-ed25519",
        `${ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV} holds a key of type ${privateKey.asymmetricKeyType || "unknown"}; license tokens are signed with Ed25519.`,
      );
    }

    return {
      privateKey,
      kid: LicenseToken.computeKeyId(privateKey),
    };
  }

  /*
   * Decides the signing mode. Pure: the environment value and the trusted-key
   * list are arguments. Never throws.
   */
  public static resolveSigning(input: {
    rawKey: string | null | undefined;
    trustedKeys: ReadonlyArray<TrustedLicenseKey>;
    now: Date;
  }): ResolvedLicenseSigning {
    let parsed: ParsedLicenseSigningKey;

    try {
      parsed = LicenseSigner.parseSigningPrivateKey(input.rawKey);
    } catch (err) {
      const problem: LicenseSigningKeyProblem =
        err instanceof LicenseSigningKeyError ? err.problem : "unparseable";

      return {
        state: {
          mode: "legacy-hs256",
          problem,
          message:
            err instanceof LicenseSigningKeyError
              ? err.message
              : `${ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV} could not be read.`,
        },
        privateKey: null,
      };
    }

    if (!resolveTrustedLicenseKeys(input.trustedKeys).keys.has(parsed.kid)) {
      return {
        state: {
          mode: "legacy-hs256",
          problem: "not-trusted",
          kid: parsed.kid,
          message: `The signing key (key id ${parsed.kid}) is not in this build's TrustedLicenseKeys, so installations running this release could not verify its tokens.`,
        },
        privateKey: null,
      };
    }

    /*
     * The last word: sign a throwaway token and classify it exactly the way an
     * installation running this build will. Only "verified and valid" enables
     * EdDSA.
     */
    const selfTest: LicenseTokenClassification | null =
      LicenseSigner.runSelfTest({
        privateKey: parsed.privateKey,
        trustedKeys: input.trustedKeys,
        now: input.now,
      });

    if (
      !selfTest ||
      selfTest.reason !== "verified" ||
      selfTest.status !== "valid"
    ) {
      return {
        state: {
          mode: "legacy-hs256",
          problem: "self-test-failed",
          kid: parsed.kid,
          message: `A token signed with the signing key (key id ${parsed.kid}) does not verify against this build's TrustedLicenseKeys${selfTest ? ` (${selfTest.reason})` : ""}.`,
        },
        privateKey: null,
      };
    }

    return {
      state: {
        mode: "eddsa",
        kid: parsed.kid,
        message: `License tokens are signed with EdDSA (key id ${parsed.kid}).`,
      },
      privateKey: parsed.privateKey,
    };
  }

  /*
   * Reads the signing key from the environment ONCE, removes it from
   * process.env, decides the mode and logs it. Later calls return the same
   * state.
   */
  public static init(): LicenseSigningState {
    if (LicenseSigner.state) {
      return LicenseSigner.state;
    }

    const rawKey: string | undefined =
      process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV];

    delete process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV];

    const resolved: ResolvedLicenseSigning = LicenseSigner.resolveSigning({
      rawKey,
      trustedKeys: getTrustedLicenseKeys(),
      now: new Date(),
    });

    LicenseSigner.state = resolved.state;
    LicenseSigner.privateKey = resolved.privateKey;

    LicenseSigner.logState(resolved.state);

    return resolved.state;
  }

  // The current mode, initialising on first use.
  public static getState(): LicenseSigningState {
    return LicenseSigner.state || LicenseSigner.init();
  }

  public static isEdDsaEnabled(): boolean {
    return (
      LicenseSigner.getState().mode === "eddsa" &&
      LicenseSigner.privateKey !== null
    );
  }

  /*
   * The claims of a signed license (design §7). exp is the license's own
   * expiry; instanceId binds the token to one installation.
   */
  public static buildClaims(data: {
    subject: LicenseTokenSubject;
    expiresAt: Date;
    now: Date;
    instanceId?: string | undefined;
  }): LicenseTokenClaims {
    return {
      iss: LICENSE_TOKEN_ISSUER,
      aud: LICENSE_TOKEN_AUDIENCE,
      sub: data.subject.licenseId,
      licenseKey: data.subject.licenseKey,
      companyName: data.subject.companyName,
      userLimit: data.subject.userLimit,
      isEvaluation: data.subject.isEvaluation,
      features: [...LICENSE_SERVER_TOKEN_FEATURES],
      instanceId: data.instanceId,
      iat: toSeconds(data.now),
      exp: toSeconds(data.expiresAt),
    };
  }

  /*
   * The token /validate and /report-user-count return. Null for a license
   * with no expiry or one that has expired - an expired license is still
   * answered (it must keep reporting) but never handed a fresh token.
   *
   * Not bound to an instance: one license key serves every installation of
   * the customer, exactly as the legacy token did.
   */
  public static signOnlineToken(
    subject: LicenseTokenSubject,
    now: Date = new Date(),
  ): string | null {
    const expiresAt: Date | null = LicenseSigner.getLiveExpiry(subject, now);

    if (!expiresAt) {
      return null;
    }

    if (LicenseSigner.isEdDsaEnabled()) {
      try {
        return LicenseToken.sign(
          LicenseSigner.buildClaims({ subject, expiresAt, now }),
          LicenseSigner.privateKey as KeyObject,
        );
      } catch (err) {
        /*
         * A license row the signed format cannot express (it validates its
         * claims first). Answer with the legacy token rather than failing the
         * installation's activation or daily report.
         */
        logger.error(
          `Enterprise license server: could not sign an EdDSA token for license ${subject.licenseId}; answering with the legacy format. ${err instanceof Error ? err.message : ""}`,
        );
      }
    }

    return LicenseSigner.signLegacyToken(subject, expiresAt, now);
  }

  /*
   * An EdDSA token bound to one installation, for an install that cannot
   * reach oneuptime.com. Throws BadDataException (400) when EdDSA signing is
   * not configured or the license is not live.
   */
  public static signOfflineToken(data: {
    subject: LicenseTokenSubject;
    instanceId: string;
    now?: Date | undefined;
  }): string {
    const now: Date = data.now || new Date();

    if (!LicenseSigner.isEdDsaEnabled()) {
      throw new BadDataException(LicenseSigner.getOfflineUnavailableMessage());
    }

    const expiresAt: Date | null = LicenseSigner.getLiveExpiry(
      data.subject,
      now,
    );

    if (!expiresAt) {
      throw new BadDataException(
        "This license has expired or has no expiry date. Renew it before issuing an offline license token.",
      );
    }

    return LicenseToken.sign(
      LicenseSigner.buildClaims({
        subject: data.subject,
        expiresAt,
        now,
        instanceId: data.instanceId,
      }),
      LicenseSigner.privateKey as KeyObject,
    );
  }

  public static getOfflineUnavailableMessage(): string {
    const state: LicenseSigningState = LicenseSigner.getState();

    return (
      "Offline license tokens need EdDSA license signing, which is not configured on this server: " +
      `${state.message} Set ${ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV} to an Ed25519 key that this release trusts.`
    );
  }

  // Test suites only: forget the mode so the next call reads the environment again.
  public static resetForTests(): void {
    if (!process.env["JEST_WORKER_ID"]) {
      throw new Error(
        "LicenseSigner.resetForTests can only be used from tests.",
      );
    }

    LicenseSigner.state = null;
    LicenseSigner.privateKey = null;
  }

  private static getLiveExpiry(
    subject: LicenseTokenSubject,
    now: Date,
  ): Date | null {
    const expiresAt: Date | null | undefined = subject.expiresAt;

    if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
      return null;
    }

    if (Math.floor((expiresAt.getTime() - now.getTime()) / 1000) <= 0) {
      return null;
    }

    return expiresAt;
  }

  /*
   * The pre-signed-license token, byte-for-byte the payload older releases
   * received: signed with this server's secret, opaque to the installation.
   */
  private static signLegacyToken(
    subject: LicenseTokenSubject,
    expiresAt: Date,
    now: Date,
  ): string {
    const secondsUntilExpiry: number = Math.floor(
      (expiresAt.getTime() - now.getTime()) / 1000,
    );

    return JSONWebToken.signJsonPayload(
      {
        companyName: subject.companyName,
        expiresAt: expiresAt.toISOString(),
        licenseKey: subject.licenseKey,
        userLimit: subject.userLimit,
      },
      Math.max(secondsUntilExpiry, 1),
    );
  }

  private static runSelfTest(data: {
    privateKey: KeyObject;
    trustedKeys: ReadonlyArray<TrustedLicenseKey>;
    now: Date;
  }): LicenseTokenClassification | null {
    try {
      const token: string = LicenseToken.sign(
        {
          iss: LICENSE_TOKEN_ISSUER,
          aud: LICENSE_TOKEN_AUDIENCE,
          sub: "license-server-self-test",
          licenseKey: "license-server-self-test",
          companyName: "",
          userLimit: null,
          isEvaluation: true,
          features: [...LICENSE_SERVER_TOKEN_FEATURES],
          iat: toSeconds(data.now),
          exp: toSeconds(data.now) + SELF_TEST_TOKEN_LIFETIME_IN_SECONDS,
        },
        data.privateKey,
      );

      return classifyLicenseToken({
        token,
        storedColumns: {},
        now: data.now,
        trustedKeys: data.trustedKeys,
        localInstanceId: null,
        graceDays: ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
        acceptUnverified: false,
      });
    } catch {
      return null;
    }
  }

  private static logState(state: LicenseSigningState): void {
    if (state.mode === "eddsa") {
      logger.info(`Enterprise license server: ${state.message}`);
      return;
    }

    const summary: string = `Enterprise license server: license tokens are signed with the legacy HS256 format. ${state.message}`;

    if (state.problem === "not-set") {
      logger.info(summary);
      return;
    }

    logger.warn(summary);
  }
}
