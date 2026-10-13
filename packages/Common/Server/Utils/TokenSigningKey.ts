import crypto from "crypto";
import {
  EncryptionSecret,
  IsEncryptionSecretInsecure,
} from "../EnvironmentConfig";

/*
 * THE KEY THIS SERVER SIGNS ITS OWN TOKENS WITH
 *
 * Everything OneUptime hands out and later takes back as proof of who is
 * asking is signed with this key:
 *
 *   - every JWT (JSONWebToken): a user's access token, the project and global
 *     SSO tokens, a status page private user's session, the master-password
 *     cookies of a status page or a public dashboard, a sign-in in flight
 *     through an identity provider, a phone call's keypad answer, a realtime
 *     subscription;
 *   - the tokens that are deliberately not JWTs, each under a key derived
 *     from this one for its purpose alone: the MCP server's authorization
 *     requests and delegation tokens (McpOAuthSignedToken) and the
 *     verification-email resend token;
 *   - the project SSO sign-in confirmation link's signature.
 *
 * Whoever holds this key can mint any of them - a master admin's session
 * included, for any user id they like - so it has to be a secret that only
 * this installation knows.
 *
 * ENCRYPTION_SECRET, WHEN THE OPERATOR CHOSE ONE
 *
 * It is ENCRYPTION_SECRET, exactly as it always was, so an installation that
 * set its own secret signs and checks with the same key across the upgrade
 * and nobody is signed out.
 *
 * NEVER A VALUE THIS REPOSITORY SHIPS
 *
 * Not when ENCRYPTION_SECRET is unset or still one of the placeholders this
 * repository ships (IsEncryptionSecretInsecure): "secret", the fallback in
 * EnvironmentConfig, or the "please-change-this-to-random-value" that
 * config.example.env sets and the README's Docker Compose install copies
 * as it is. That key is public, and signing with it let anybody who could
 * reach the server sign a token of their own and be taken for whoever it
 * named. Such an installation signs with a key of its own instead: 256 bits
 * from the CSPRNG, made by the first process to start and kept in Postgres
 * (InstanceTokenSigningKey), so every app and worker process, and every
 * restart, signs and checks with the same key
 * (InstanceTokenSigningKeyService.loadTokenSigningKey, which App/Index.ts
 * awaits right after it connects to Postgres, before it mounts a route or
 * starts a worker).
 *
 * ENCRYPTION_SECRET still encrypts the stored secrets and peppers the stored
 * hashes on such an installation: those have to stay readable, and the boot
 * warning (EncryptionSecretWarning) says what that costs. Only signing moves.
 *
 * A PROCESS THAT HAS NOT LOADED IT
 *
 * A test, or a one-off script, signs with a random key made once for its
 * own process. What it signs verifies only within that process, which is
 * all a test needs - and it is never a key anybody else knows.
 */

// 256 bits, written as 64 lowercase hex characters.
const INSTALLATION_KEY_BYTES: number = 32;
const INSTALLATION_KEY_PATTERN: RegExp = /^[0-9a-f]{64}$/;

export default class TokenSigningKey {
  /*
   * The installation's own key, once loaded from Postgres. Only ever used
   * when ENCRYPTION_SECRET is one this repository ships.
   */
  private static installationKey: string | null = null;

  // A key of this process's own, until the installation's is loaded.
  private static processKey: string | null = null;

  /*
   * Whether tokens are signed with ENCRYPTION_SECRET itself: true when the
   * operator set one of their own, false when it is unset or a shipped
   * placeholder.
   */
  public static isEncryptionSecretUsed(): boolean {
    return !IsEncryptionSecretInsecure;
  }

  /*
   * The key to sign with, and to check every signed token against. Read per
   * call rather than captured, so the moment the installation's key is
   * loaded every signer and checker uses it.
   */
  public static get(): string {
    if (TokenSigningKey.isEncryptionSecretUsed()) {
      return EncryptionSecret.toString();
    }

    if (TokenSigningKey.installationKey) {
      return TokenSigningKey.installationKey;
    }

    if (!TokenSigningKey.processKey) {
      TokenSigningKey.processKey = TokenSigningKey.generateInstallationKey();
    }

    return TokenSigningKey.processKey;
  }

  /*
   * A key derived from this one for a single purpose, so a signature made
   * for that purpose verifies nowhere else and no signature made elsewhere
   * verifies there.
   */
  public static deriveKey(label: string): Buffer {
    return crypto
      .createHmac("sha256", TokenSigningKey.get())
      .update(label)
      .digest();
  }

  /*
   * Signs with the installation's own key from now on. Refuses anything
   * that is not 256 bits of hex, so a damaged or hand-edited row can never
   * become a short or guessable signing key.
   */
  public static useInstallationKey(key: string): void {
    if (!TokenSigningKey.isWellFormedInstallationKey(key)) {
      throw new Error(
        "The stored token signing key is not 64 hexadecimal characters, so OneUptime will not sign with it. Delete the row in the InstanceTokenSigningKey table and restart every OneUptime app and worker to generate a new one (everybody signs in again), or set ENCRYPTION_SECRET to a long random value.",
      );
    }

    TokenSigningKey.installationKey = key;
  }

  public static isInstallationKeyLoaded(): boolean {
    return TokenSigningKey.installationKey !== null;
  }

  // 256 bits from the CSPRNG.
  public static generateInstallationKey(): string {
    return crypto.randomBytes(INSTALLATION_KEY_BYTES).toString("hex");
  }

  public static isWellFormedInstallationKey(key: unknown): key is string {
    return typeof key === "string" && INSTALLATION_KEY_PATTERN.test(key);
  }
}
