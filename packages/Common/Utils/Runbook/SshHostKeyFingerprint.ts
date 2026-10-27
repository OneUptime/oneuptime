import { createHash } from "crypto";
import {
  ParsedSshHostKeys,
  SSH_FINGERPRINT_PREFIX,
  SshHostKeyEntry,
  decodeSshBase64,
  parseSshHostKeys,
  readSshKeyBlobType,
} from "../../Types/Runbook/SshHostKey";

/*
 * AN SSH HOST KEY'S FINGERPRINT, and the host keys a step names as the
 * Runner checks them.
 *
 * The fingerprint is OpenSSH's: SHA-256 of the key in its wire format, in
 * base64 without padding, after "SHA256:" - what `ssh-keygen -l` prints,
 * and what ssh says when it asks about a new machine.
 *
 * Node-only (crypto): read by the server, which hands a claimed SSH step
 * the fingerprints it checks (RunbookJobVariables), and by the Runner,
 * which works out the fingerprint of the key the machine presents
 * (SSHExecutor). The Steps page only reads the lines (Types/Runbook/
 * SshHostKey).
 */

// A key a step names, as the Runner checks it.
export interface SshPinnedHostKey {
  fingerprint: string;
  // Known when the key was written out, not when only its fingerprint was.
  keyType?: string | undefined;
}

// The fingerprint of a public key in its SSH wire format.
export function getSshHostKeyFingerprint(blob: Uint8Array): string {
  const digest: string = createHash("sha256").update(blob).digest("base64");

  let end: number = digest.length;

  while (end > 0 && digest[end - 1] === "=") {
    end--;
  }

  return `${SSH_FINGERPRINT_PREFIX}${digest.slice(0, end)}`;
}

// The key a machine presented: its fingerprint, and its type.
export function describeSshHostKey(blob: Uint8Array): SshPinnedHostKey {
  const keyType: string | null = readSshKeyBlobType(blob);

  return {
    fingerprint: getSshHostKeyFingerprint(blob),
    ...(keyType ? { keyType } : {}),
  };
}

/*
 * The host keys a step's Host key field names, each as a fingerprint (and
 * its type, when the line had the key), each once. Lines that are not a
 * key are left out: the caller refuses the step first
 * (getSshHostKeyProblem).
 */
export function getPinnedSshHostKeys(
  text: string | undefined,
): Array<SshPinnedHostKey> {
  const parsed: ParsedSshHostKeys = parseSshHostKeys(text);
  const keys: Array<SshPinnedHostKey> = [];

  for (const entry of parsed.entries) {
    const key: SshPinnedHostKey | null = toPinnedKey(entry);

    if (
      key &&
      !keys.some((known: SshPinnedHostKey): boolean => {
        return known.fingerprint === key.fingerprint;
      })
    ) {
      keys.push(key);
    }
  }

  return keys;
}

function toPinnedKey(entry: SshHostKeyEntry): SshPinnedHostKey | null {
  if (entry.kind === "fingerprint") {
    return { fingerprint: entry.fingerprint };
  }

  const blob: Uint8Array | null = decodeSshBase64(entry.keyBase64);

  if (!blob) {
    return null;
  }

  return {
    fingerprint: getSshHostKeyFingerprint(blob),
    keyType: entry.keyType,
  };
}

/*
 * The algorithms to ask the machine for, so it presents a key the step
 * names: when every key named has its type, only those; otherwise null,
 * and the machine presents the one it prefers. A machine has a key of
 * each type, and one named by its RSA key alone must not be asked for its
 * Ed25519 one.
 */
export function getSshHostKeyAlgorithms(
  keys: Array<SshPinnedHostKey>,
): Array<string> | null {
  if (
    keys.length === 0 ||
    keys.some((key: SshPinnedHostKey): boolean => {
      return !key.keyType;
    })
  ) {
    return null;
  }

  const algorithms: Array<string> = [];

  for (const key of keys) {
    // An RSA key signs with SHA-2 first; ssh-rsa (SHA-1) last, for old machines.
    const names: Array<string> =
      key.keyType === "ssh-rsa"
        ? ["rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"]
        : [key.keyType!];

    for (const name of names) {
      if (!algorithms.includes(name)) {
        algorithms.push(name);
      }
    }
  }

  return algorithms;
}
