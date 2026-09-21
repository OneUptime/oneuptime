/*
 * The Ed25519 public keys whose signatures this build accepts on a OneUptime
 * Enterprise license.
 *
 * `kid` is the RFC 7638 JWK thumbprint of the key (LicenseToken.computeKeyId);
 * a token names its signing key by it. Tests/Server/License/LicenseToken.test.ts
 * asserts every entry parses, is Ed25519, and has kid === thumbprint.
 *
 * The ceremony order matters, and this file is its first step: release a build
 * that trusts the new key, deploy it to the license server, and only then give
 * the license server the private key
 * (ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY). The license server refuses to sign
 * with a key its own build does not trust, and installs verify offline against
 * the keys in their own build, so a key has to ship in a release before
 * anything is signed with it.
 *
 * Adding a key here does not, on its own, change how any existing license
 * classifies: legacy HS256 licenses stay "unverified" until
 * ACCEPT_UNVERIFIED_LEGACY_LICENSES is turned off in a separate, announced
 * release (see ee/README.md, "Sunsetting unverified legacy licenses").
 *
 * To rotate: add the new key beside the old one, and remove a key only once no
 * supported release trusts that key alone.
 *
 * This file is pure data and imports nothing: the PEMs are parsed lazily, with
 * errors caught, when a license is classified. A malformed entry can never
 * stop the Enterprise Edition from booting.
 */
export interface TrustedLicenseKey {
  kid: string;
  publicKeyPem: string;
}

const PRODUCTION_TRUSTED_LICENSE_KEYS: ReadonlyArray<TrustedLicenseKey> = [
  // The OneUptime Cloud license signing key, generated 2026-09-21.
  {
    kid: "vvbOO2N2qmM6A7D1L5NK7NHaAEauC42jGJcqO6mdLmM",
    publicKeyPem:
      "-----BEGIN PUBLIC KEY-----\n" +
      "MCowBQYDK2VwAyEAAZ3zYqvNcRKJ0ZyZ88zOPlv6LTZ7ULV0WOXKZO8NoSY=\n" +
      "-----END PUBLIC KEY-----\n",
  },
];

let trustedLicenseKeysForTests: ReadonlyArray<TrustedLicenseKey> | null = null;

export const getProductionTrustedLicenseKeys: () => ReadonlyArray<TrustedLicenseKey> =
  (): ReadonlyArray<TrustedLicenseKey> => {
    return PRODUCTION_TRUSTED_LICENSE_KEYS;
  };

// The keys in effect: the production list, unless a test replaced it.
export const getTrustedLicenseKeys: () => ReadonlyArray<TrustedLicenseKey> =
  (): ReadonlyArray<TrustedLicenseKey> => {
    return trustedLicenseKeysForTests || PRODUCTION_TRUSTED_LICENSE_KEYS;
  };

/*
 * Test-only: replace the trusted keys (null restores the production list).
 * Refuses to run outside jest, so no code path in a running server can make
 * it trust an extra key.
 */
export const setTrustedLicenseKeysForTests: (
  keys: ReadonlyArray<TrustedLicenseKey> | null,
) => void = (keys: ReadonlyArray<TrustedLicenseKey> | null): void => {
  if (!process.env["JEST_WORKER_ID"]) {
    throw new Error(
      "setTrustedLicenseKeysForTests can only be used from tests.",
    );
  }

  trustedLicenseKeysForTests = keys;
};
