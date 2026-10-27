/*
 * AN SSH STEP'S HOST KEYS: the keys the machine it signs in to may present.
 *
 * An SSH step signed in to whatever answered at its host, without asking
 * whether it was that machine: someone between the Runner and the machine
 * could have taken the step's password, or run its script elsewhere. A step
 * may now name the machine's host keys (SSHStepConfig.hostKey), and the
 * Runner signs in only when the machine presents one of them - after
 * proving it holds that key, which ssh2 checks during the key exchange.
 *
 * Each line names one key, written as people copy it:
 *
 *   - its SHA256 fingerprint, as `ssh-keygen -l` and ssh's own "the
 *     fingerprint is" print it - "SHA256:" and 43 characters of base64,
 *     anywhere in the line, so a whole `ssh-keygen -l` line reads too;
 *   - or its public key, as a .pub file, `ssh-keyscan` or a known_hosts
 *     line has it: the key's type, then its base64, with anything before
 *     (the host names) or after (a comment) left out.
 *
 * Blank lines and lines that start with "#" (what `ssh-keyscan` prints
 * about the server) are skipped. An MD5 fingerprint is not read: ssh has
 * shown SHA256 by default since OpenSSH 6.8.
 *
 * React-free and Node-free: the Steps page reads it to say what is wrong
 * with a line, and the server and the Runner read it before they work out
 * a public key's fingerprint (Common/Utils/Runbook/SshHostKeyFingerprint,
 * which uses Node's crypto).
 */

// The host key types a machine presents, as OpenSSH writes them.
export const SSH_HOST_KEY_TYPES: ReadonlyArray<string> = [
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "ssh-rsa",
];

// The most host keys a step names: a machine has one of each type, at most.
export const MAX_SSH_HOST_KEYS: number = 16;

// The most text the field holds: a 16384-bit RSA key is under 3 KB a line.
export const MAX_SSH_HOST_KEY_TEXT_LENGTH: number = 50000;

export const SSH_FINGERPRINT_PREFIX: string = "SHA256:";

export type SshHostKeyEntry =
  // "SHA256:" and the hash's base64, without padding.
  | { kind: "fingerprint"; fingerprint: string }
  // The public key: its type, and its base64 (the SSH wire format).
  | { kind: "publicKey"; keyType: string; keyBase64: string };

export interface ParsedSshHostKeys {
  entries: Array<SshHostKeyEntry>;
  // The lines that are neither a fingerprint nor a public key, as written.
  invalidLines: Array<string>;
  // More keys than a step may name, or more text than the field holds.
  isTooLong: boolean;
}

/*
 * A SHA-256 fingerprint: "SHA256:" and the 32 bytes' base64 - 43
 * characters, and the one "=" of padding OpenSSH leaves out. Only base64
 * characters around it, so it is read out of a whole `ssh-keygen -l` line.
 */
const FINGERPRINT: RegExp = /^SHA256:([A-Za-z0-9+/]{42}[AEIMQUYcgkosw048])=?$/;

const BASE64_ALPHABET: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Base64 without the "=" that pads its end (a loop: no pattern backtracks).
function withoutPadding(text: string): string {
  let end: number = text.length;

  while (end > 0 && text[end - 1] === "=") {
    end--;
  }

  return text.slice(0, end);
}

/*
 * Base64 to bytes, or null when it is not base64. Written out rather than
 * read from atob or Buffer, so the browser and Node read it alike.
 */
export function decodeSshBase64(text: string): Uint8Array | null {
  const trimmed: string = withoutPadding(text);

  if (trimmed.length === 0 || trimmed.length % 4 === 1) {
    return null;
  }

  const bytes: Array<number> = [];
  let buffer: number = 0;
  let bits: number = 0;

  for (const character of trimmed) {
    const value: number = BASE64_ALPHABET.indexOf(character);

    if (value < 0) {
      return null;
    }

    buffer = (buffer << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return Uint8Array.from(bytes);
}

/*
 * The key type the SSH wire format of a public key starts with: a 4-byte
 * length, then that many bytes of name. Null when it does not.
 */
export function readSshKeyBlobType(blob: Uint8Array): string | null {
  if (blob.length < 4) {
    return null;
  }

  const length: number =
    ((blob[0]! << 24) | (blob[1]! << 16) | (blob[2]! << 8) | blob[3]!) >>> 0;

  if (length === 0 || length > 64 || blob.length < 4 + length) {
    return null;
  }

  let name: string = "";

  for (let index: number = 4; index < 4 + length; index++) {
    const code: number = blob[index]!;

    // A key type is printable ASCII.
    if (code < 0x21 || code > 0x7e) {
      return null;
    }

    name += String.fromCharCode(code);
  }

  return name;
}

// The fingerprint a line names, or null.
function readFingerprint(tokens: Array<string>): string | null {
  for (const token of tokens) {
    const match: RegExpExecArray | null = FINGERPRINT.exec(token);

    if (match) {
      return `${SSH_FINGERPRINT_PREFIX}${match[1]}`;
    }
  }

  return null;
}

// The public key a line holds, or null.
function readPublicKey(
  tokens: Array<string>,
): { keyType: string; keyBase64: string } | null {
  // A known_hosts marker (@cert-authority, @revoked) is not a host key.
  if (tokens[0]?.startsWith("@")) {
    return null;
  }

  for (let index: number = 0; index < tokens.length - 1; index++) {
    const keyType: string = tokens[index]!;

    if (!SSH_HOST_KEY_TYPES.includes(keyType)) {
      continue;
    }

    const keyBase64: string = tokens[index + 1]!;
    const blob: Uint8Array | null = decodeSshBase64(keyBase64);

    // The key says its own type: it must be the one the line says.
    if (!blob || readSshKeyBlobType(blob) !== keyType) {
      return null;
    }

    return { keyType, keyBase64: withoutPadding(keyBase64) };
  }

  return null;
}

// The host keys a step's Host key field names, read line by line.
export function parseSshHostKeys(text: string | undefined): ParsedSshHostKeys {
  const parsed: ParsedSshHostKeys = {
    entries: [],
    invalidLines: [],
    isTooLong: false,
  };

  if (!text) {
    return parsed;
  }

  if (text.length > MAX_SSH_HOST_KEY_TEXT_LENGTH) {
    parsed.isTooLong = true;
    return parsed;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line: string = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const tokens: Array<string> = line.split(/\s+/);
    const fingerprint: string | null = readFingerprint(tokens);

    if (fingerprint) {
      parsed.entries.push({ kind: "fingerprint", fingerprint });
      continue;
    }

    const publicKey: { keyType: string; keyBase64: string } | null =
      readPublicKey(tokens);

    if (publicKey) {
      parsed.entries.push({ kind: "publicKey", ...publicKey });
      continue;
    }

    parsed.invalidLines.push(line);
  }

  if (parsed.entries.length > MAX_SSH_HOST_KEYS) {
    parsed.isTooLong = true;
  }

  return parsed;
}

// Whether a step names host keys at all - a line that is not one counts.
export function hasSshHostKeys(text: string | undefined): boolean {
  return Boolean(text && text.trim());
}

/*
 * Why a step's Host key field cannot be used, or null when every line names
 * a key (or it is empty). Said by the server, in English, when it refuses
 * the step; the Steps page says its own words.
 */
export function getSshHostKeyProblem(text: string | undefined): string | null {
  const parsed: ParsedSshHostKeys = parseSshHostKeys(text);

  if (parsed.isTooLong) {
    return `This SSH step's Host key names more than ${MAX_SSH_HOST_KEYS} keys, so it was not run. A machine has one key of each type: name those.`;
  }

  if (parsed.invalidLines.length > 0) {
    return "This SSH step's Host key has a line that is neither a SHA256 fingerprint nor a public key, so it was not run. Open the step and put the machine's SHA256 fingerprint, or its public key as ssh-keyscan prints it, one per line.";
  }

  return null;
}
