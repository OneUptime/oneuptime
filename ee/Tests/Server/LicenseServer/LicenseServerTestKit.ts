import crypto, { KeyObject } from "crypto";
import LicenseToken from "../../../Server/License/LicenseToken";
import { TrustedLicenseKey } from "../../../Server/License/TrustedLicenseKeys";

/*
 * Keys and helpers for the license-server suites. Keys are generated per run;
 * no private key material is committed.
 */

export interface TestKeyPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
}

export const generateEd25519KeyPair: () => TestKeyPair = (): TestKeyPair => {
  return crypto.generateKeyPairSync("ed25519");
};

export const toPrivatePem: (keyPair: TestKeyPair) => string = (
  keyPair: TestKeyPair,
): string => {
  return keyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
};

export const toPublicPem: (keyPair: TestKeyPair) => string = (
  keyPair: TestKeyPair,
): string => {
  return keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
};

export const toTrustedKey: (keyPair: TestKeyPair) => TrustedLicenseKey = (
  keyPair: TestKeyPair,
): TrustedLicenseKey => {
  return {
    kid: LicenseToken.computeKeyId(keyPair.publicKey),
    publicKeyPem: toPublicPem(keyPair),
  };
};

// The PEM as a single-line environment value, newlines written as "\n".
export const toEscapedPem: (pem: string) => string = (pem: string): string => {
  return pem.trim().split("\n").join("\\n");
};

export const toBase64Pem: (pem: string) => string = (pem: string): string => {
  return Buffer.from(pem, "utf8").toString("base64");
};

export const LEGACY_TEST_SECRET: string = "license-server-test-secret";

/*
 * Stands in for JSONWebToken.signJsonPayload (which needs the server's
 * ENCRYPTION_SECRET): a real HS256 JWT, so a legacy token can be fed to
 * classifyLicenseToken exactly as an installation would receive it.
 */
export const signLegacyHs256: (
  payload: Record<string, unknown>,
  expiresInSeconds: number,
) => string = (
  payload: Record<string, unknown>,
  expiresInSeconds: number,
): string => {
  const nowInSeconds: number = Math.floor(Date.now() / 1000);
  const header: string = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body: string = Buffer.from(
    JSON.stringify({
      ...payload,
      iat: nowInSeconds,
      exp: nowInSeconds + expiresInSeconds,
    }),
  ).toString("base64url");
  const signature: string = crypto
    .createHmac("sha256", LEGACY_TEST_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");

  return `${header}.${body}.${signature}`;
};

export const decodeTokenPart: (
  token: string,
  index: 0 | 1,
) => Record<string, unknown> = (
  token: string,
  index: 0 | 1,
): Record<string, unknown> => {
  return JSON.parse(
    Buffer.from(token.split(".")[index] as string, "base64url").toString(
      "utf8",
    ),
  ) as Record<string, unknown>;
};

/*
 * Every string passed to a mocked logger method, flattened, so a suite can
 * assert that no secret ever reached a log line.
 */
export const collectLoggedText: (
  mocks: Array<{ mock: { calls: Array<Array<unknown>> } }>,
) => string = (
  mocks: Array<{ mock: { calls: Array<Array<unknown>> } }>,
): string => {
  const parts: Array<string> = [];

  for (const mockFunction of mocks) {
    for (const call of mockFunction.mock.calls) {
      for (const argument of call) {
        parts.push(
          argument instanceof Error
            ? `${argument.message} ${argument.stack || ""}`
            : typeof argument === "string"
              ? argument
              : JSON.stringify(argument),
        );
      }
    }
  }

  return parts.join("\n");
};
