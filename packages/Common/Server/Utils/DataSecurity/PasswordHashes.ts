import { getFieldNameWords } from "../../../Utils/DataSecurity/FieldNameHints";

/*
 * PASSWORDS KEPT AS PASSWORDS.
 *
 * A column or key named for a password should hold a hash - bcrypt,
 * argon2, scrypt, PBKDF2, a crypt(3) string, at worst a bare digest. One
 * that holds anything else holds the passwords themselves, which no
 * detector can see: "hunter2" looks like nothing. So a scan reads the
 * values of every field whose name says password, sets aside the empty,
 * the placeholders ("********", "!", a ${VAR} reference) and the
 * encrypted, and reports the field when most of what is left is not a
 * hash.
 *
 * Every pattern here is anchored, bounded, and run on at most
 * MAX_HASH_LENGTH characters: a hash is never longer, and a value that is
 * is not one.
 */

// The longest a password hash is; anything longer is not one.
const MAX_HASH_LENGTH: number = 1024;

// The most values of one field read.
const MAX_VALUES_PER_FIELD: number = 1_000;

const BCRYPT: RegExp = /^\$2[abxy]?\$[0-9]{2}\$[./A-Za-z0-9]{53}$/;
const CRYPT64: RegExp = /^[./A-Za-z0-9]{1,1024}$/;
const BASE64ISH: RegExp = /^[A-Za-z0-9+/._=-]{1,1024}$/;
const HEX: RegExp = /^[0-9a-fA-F]{1,1024}$/;
const DIGITS: RegExp = /^[0-9]{1,12}$/;
const SHA_CRYPT_ROUNDS: RegExp = /^rounds=[0-9]{1,10}$/;
const ARGON2_PARAMETERS: RegExp = /^m=[0-9]{1,10},t=[0-9]{1,10},p=[0-9]{1,3}/;
const ARGON2_VERSION: RegExp = /^v=[0-9]{1,3}$/;
const SCRYPT_PARAMETERS: RegExp = /^ln=[0-9]{1,3},r=[0-9]{1,3},p=[0-9]{1,3}$/;
const PHPASS: RegExp = /^\$[PH]\$[./A-Za-z0-9]{31}$/;
const MYSQL_NATIVE: RegExp = /^\*[0-9A-Fa-f]{40}$/;
const POSTGRES_MD5: RegExp = /^md5[0-9a-f]{32}$/;
const POSTGRES_SCRAM: RegExp =
  /^SCRAM-SHA-256\$[0-9]{1,10}:[A-Za-z0-9+/=]{4,256}\$[A-Za-z0-9+/=]{4,256}:[A-Za-z0-9+/=]{4,256}$/;
const SQL_SERVER_HASH: RegExp = /^0x0[12]00[0-9A-Fa-f]{40,256}$/;
const LDAP_SCHEME: RegExp = /^\{([A-Za-z0-9-]{2,24})\}/;
const WERKZEUG_METHOD: RegExp =
  /^(?:pbkdf2:[a-z0-9]{1,12}(?::[0-9]{1,10})?|scrypt(?::[0-9]{1,10}){0,3}|sha1|sha224|sha256|sha384|sha512|md5)$/;
const VARIABLE_REFERENCE: RegExp = /^\$[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const JASYPT: RegExp = /^ENC\(.{1,1000}\)$/;
const DOLLAR_SIGNS: RegExp = /\$/g;

// A digest's length in hex: MD5 or NTLM, SHA-1, SHA-256, SHA-512.
const HEX_DIGEST_LENGTHS: ReadonlySet<number> = new Set([32, 40, 64, 128]);

/*
 * A digest in base64: padded MD5, SHA-1, SHA-256, SHA-512, and the
 * unpadded SHA-256 and SHA-512 (shorter unpadded ones are as likely to be a
 * generated password).
 */
const BASE64_DIGEST_LENGTHS: ReadonlyMap<number, number> = new Map([
  [24, 2],
  [28, 1],
  [44, 1],
  [88, 2],
  [43, 0],
  [86, 0],
]);

// Django's hashers, named before the first "$".
const DJANGO_ALGORITHMS: ReadonlySet<string> = new Set([
  "pbkdf2_sha256",
  "pbkdf2_sha1",
  "argon2",
  "bcrypt_sha256",
  "bcrypt",
  "scrypt",
  "sha1",
  "md5",
  "unsalted_sha1",
  "crypt",
]);

// LDAP userPassword schemes that keep the password as it is.
const LDAP_PLAINTEXT_SCHEMES: ReadonlySet<string> = new Set([
  "CLEARTEXT",
  "CLEAR",
  "PLAIN",
  "PLAINTEXT",
]);

/*
 * Values that stand in for a password rather than being one: shadow's
 * locked and empty markers, masks, and the words exports write instead.
 */
const PLACEHOLDER_WORDS: ReadonlySet<string> = new Set([
  "x",
  "*lk*",
  "np",
  "locked",
  "null",
  "none",
  "nil",
  "n/a",
  "na",
  "undefined",
  "redacted",
  "[redacted]",
  "<redacted>",
  "filtered",
  "[filtered]",
  "hidden",
  "masked",
  "[hidden]",
  "[masked]",
  // A flag's value read as text: must_change_password = true.
  "true",
  "false",
  "yes",
  "no",
  "on",
  "off",
]);

// Prefixes of a value held somewhere else: a secret manager, a vault.
const REFERENCE_PREFIXES: ReadonlyArray<string> = [
  "vault:",
  "arn:aws:secretsmanager:",
  "arn:aws:ssm:",
  "secretsmanager:",
  "sm://",
  "op://",
  "keyvault:",
  "azurekeyvault:",
];

function isBase64Digest(value: string): boolean {
  const padding: number | undefined = BASE64_DIGEST_LENGTHS.get(value.length);

  if (padding === undefined) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);
    const isPadding: boolean = index >= value.length - padding;

    if (isPadding) {
      if (code !== 61) {
        return false;
      }

      continue;
    }

    const isBase64Character: boolean =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 43 ||
      code === 47 ||
      code === 45 ||
      code === 95;

    if (!isBase64Character) {
      return false;
    }
  }

  return true;
}

// A crypt(3) string: $id$[parameters$]salt$hash.
function isModularCrypt(value: string): boolean {
  if (BCRYPT.test(value) || PHPASS.test(value)) {
    return true;
  }

  const parts: Array<string> = value.split("$");
  const id: string = parts[1] || "";
  const last: string = parts[parts.length - 1] || "";

  switch (id) {
    case "1":
    case "apr1":
      // MD5-crypt: $1$salt$22 characters.
      return parts.length === 4 && last.length === 22 && CRYPT64.test(last);
    case "5":
    case "6": {
      // SHA-crypt: $5$[rounds=N$]salt$43 or 86 characters.
      const expected: number = id === "5" ? 43 : 86;
      const hasRounds: boolean = SHA_CRYPT_ROUNDS.test(parts[2] || "");

      return (
        parts.length === (hasRounds ? 5 : 4) &&
        last.length === expected &&
        CRYPT64.test(last)
      );
    }
    case "argon2id":
    case "argon2i":
    case "argon2d": {
      // $argon2id$[v=19$]m=..,t=..,p=..$salt$hash
      const hasVersion: boolean = ARGON2_VERSION.test(parts[2] || "");
      const parameters: string = parts[hasVersion ? 3 : 2] || "";

      return (
        parts.length === (hasVersion ? 6 : 5) &&
        ARGON2_PARAMETERS.test(parameters) &&
        last.length >= 16 &&
        BASE64ISH.test(last) &&
        BASE64ISH.test(parts[parts.length - 2] || "")
      );
    }
    case "scrypt":
      // passlib: $scrypt$ln=16,r=8,p=1$salt$hash
      return (
        parts.length === 5 &&
        SCRYPT_PARAMETERS.test(parts[2] || "") &&
        last.length >= 16 &&
        BASE64ISH.test(last)
      );
    case "7":
      // scrypt in crypt(3): $7$parameters-and-salt$hash
      return (
        parts.length === 4 &&
        (parts[2] || "").length >= 14 &&
        CRYPT64.test(parts[2] || "") &&
        last.length >= 43 &&
        CRYPT64.test(last)
      );
    case "y":
    case "gy":
      // yescrypt, Linux's default: $y$parameters$salt$hash
      return (
        parts.length === 5 &&
        last.length >= 43 &&
        CRYPT64.test(last) &&
        CRYPT64.test(parts[2] || "")
      );
    case "pbkdf2":
    case "pbkdf2-sha1":
    case "pbkdf2-sha256":
    case "pbkdf2-sha512":
      // passlib: $pbkdf2-sha256$rounds$salt$hash
      return (
        parts.length === 5 &&
        DIGITS.test(parts[2] || "") &&
        last.length >= 16 &&
        BASE64ISH.test(last)
      );
    case "bcrypt-sha256":
    case "sha1":
      return parts.length >= 5 && last.length >= 16 && BASE64ISH.test(last);
    case "A":
      // MySQL caching_sha2_password: $A$005$salt-and-hash
      return parts.length >= 4 && value.length >= 20;
    default:
      return false;
  }
}

// Django's algorithm$...$hash.
function isDjangoHash(value: string): boolean {
  const separator: number = value.indexOf("$");

  if (separator <= 0) {
    return false;
  }

  const algorithm: string = value.slice(0, separator);

  if (!DJANGO_ALGORITHMS.has(algorithm)) {
    return false;
  }

  const rest: string = value.slice(separator + 1);

  // bcrypt and bcrypt_sha256 wrap a bcrypt string: bcrypt$$2b$12$...
  if (algorithm === "bcrypt" || algorithm === "bcrypt_sha256") {
    return BCRYPT.test(rest);
  }

  // argon2 wraps an argon2 string without its leading "$".
  if (algorithm === "argon2") {
    return isModularCrypt("$" + rest);
  }

  const parts: Array<string> = rest.split("$");
  const last: string = parts[parts.length - 1] || "";

  return parts.length >= 2 && last.length >= 16 && BASE64ISH.test(last);
}

// Werkzeug's method$salt$hexhash; its "plain" method keeps the password.
function isWerkzeugHash(value: string): boolean {
  const parts: Array<string> = value.split("$");

  if (parts.length !== 3) {
    return false;
  }

  const method: string = parts[0] || "";
  const hash: string = parts[2] || "";

  return (
    WERKZEUG_METHOD.test(method) &&
    (parts[1] || "").length > 0 &&
    hash.length >= 32 &&
    HEX.test(hash)
  );
}

// An LDAP userPassword value: {SSHA}..., {CRYPT}$6$..., never {CLEARTEXT}.
function isLdapHash(value: string): boolean {
  const scheme: RegExpExecArray | null = LDAP_SCHEME.exec(value);

  if (!scheme) {
    return false;
  }

  const name: string = (scheme[1] || "").toUpperCase();
  const rest: string = value.slice(scheme[0].length);

  if (LDAP_PLAINTEXT_SCHEMES.has(name)) {
    return false;
  }

  if (name === "CRYPT") {
    return isModularCrypt(rest);
  }

  return rest.length >= 16 && BASE64ISH.test(rest.replace(DOLLAR_SIGNS, ""));
}

/*
 * Whether a value is a password hash - of any scheme a store is likely to
 * hold - rather than a password. A hash behind a locked-account marker
 * ("!$6$...") is still a hash.
 */
export function isPasswordHash(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  let hash: string = value.trim();

  if (hash.length === 0 || hash.length > MAX_HASH_LENGTH) {
    return false;
  }

  if (hash.startsWith("!!")) {
    hash = hash.slice(2);
  } else if (hash.startsWith("!")) {
    hash = hash.slice(1);
  }

  if (hash.startsWith("$")) {
    return isModularCrypt(hash);
  }

  if (hash.startsWith("{")) {
    return isLdapHash(hash);
  }

  if (
    MYSQL_NATIVE.test(hash) ||
    POSTGRES_MD5.test(hash) ||
    POSTGRES_SCRAM.test(hash) ||
    SQL_SERVER_HASH.test(hash)
  ) {
    return true;
  }

  if (hash.includes("$")) {
    return isDjangoHash(hash) || isWerkzeugHash(hash);
  }

  if (HEX_DIGEST_LENGTHS.has(hash.length) && HEX.test(hash)) {
    return true;
  }

  return isBase64Digest(hash);
}

// One character over and over: "********", "xxxx", "!".
function isOneCharacterRepeated(value: string): boolean {
  for (let index: number = 1; index < value.length; index++) {
    if (value[index] !== value[0]) {
      return false;
    }
  }

  return true;
}

function isWrapped(value: string, open: string, close: string): boolean {
  return (
    value.length > open.length + close.length &&
    value.startsWith(open) &&
    value.endsWith(close)
  );
}

/*
 * A value that is not the password itself: a mask, a marker, a word an
 * export writes instead, or a reference to where the secret is kept
 * (${DB_PASSWORD}, {{ vault }}, %PASSWORD%, ENC(...), vault:...).
 */
function isPlaceholder(value: string): boolean {
  const lower: string = value.toLowerCase();

  if (isOneCharacterRepeated(value) || PLACEHOLDER_WORDS.has(lower)) {
    return true;
  }

  if (
    isWrapped(value, "${", "}") ||
    isWrapped(value, "{{", "}}") ||
    isWrapped(value, "$(", ")") ||
    isWrapped(value, "%", "%") ||
    isWrapped(value, "<", ">") ||
    VARIABLE_REFERENCE.test(value) ||
    (value.length <= 1024 && JASYPT.test(value))
  ) {
    return true;
  }

  return REFERENCE_PREFIXES.some((prefix: string) => {
    return lower.startsWith(prefix);
  });
}

/*
 * A long opaque token - encrypted, not hashed, but no more a password a
 * person chose: 44 or more base64 characters with digits and both cases.
 */
function isEncryptedLooking(value: string): boolean {
  if (value.length < 44 || value.length > MAX_HASH_LENGTH) {
    return false;
  }

  if (!BASE64ISH.test(value)) {
    return false;
  }

  let hasDigit: boolean = false;
  let hasUpper: boolean = false;
  let hasLower: boolean = false;

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code >= 48 && code <= 57) {
      hasDigit = true;
    } else if (code >= 65 && code <= 90) {
      hasUpper = true;
    } else if (code >= 97 && code <= 122) {
      hasLower = true;
    }
  }

  return hasDigit && hasUpper && hasLower;
}

// Words that name a password, wherever they sit in a field's name.
const PASSWORD_WORDS: ReadonlyArray<string> = [
  "password",
  "passwort",
  "passwd",
  "passphrase",
  "passcode",
  "pswd",
  "pword",
  "pwd",
];

// Short words that name a password only alone or before one of AFTER_WORDS.
const SHORT_PASSWORD_WORDS: ReadonlySet<string> = new Set(["pass", "pw"]);

/*
 * What may follow the password word in a name that still holds the
 * password, or its hash: password_hash, hashed_password, password2,
 * password_confirmation. Anything else - password_changed_at,
 * password_reset_token, password_hint - is about the password, not it.
 */
const AFTER_WORDS: ReadonlySet<string> = new Set([
  "hash",
  "hashed",
  "digest",
  "crypt",
  "crypted",
  "encrypted",
  "enc",
  "value",
  "val",
  "text",
  "plain",
  "plaintext",
  "clear",
  "cleartext",
  "raw",
  "str",
  "string",
  "md5",
  "sha1",
  "sha256",
  "sha512",
  "bcrypt",
  "argon2",
  "scrypt",
  "pbkdf2",
  "b64",
  "base64",
  "hex",
  "old",
  "new",
  "current",
  "prev",
  "previous",
  "confirm",
  "confirmation",
  "repeat",
  "again",
  "word",
  "phrase",
]);

function isAfterWord(word: string): boolean {
  return AFTER_WORDS.has(word) || DIGITS.test(word);
}

/*
 * Whether a field's name says it holds a password: `password`,
 * `user_password`, `passwordHash`, `hashed_password`, `pwd`, `DB_PASSWORD`,
 * `pass_hash` - and not `password_changed_at` or `boarding_pass`.
 */
export function isPasswordFieldName(fieldPath: string): boolean {
  const words: Array<string> = getFieldNameWords(fieldPath);

  for (let index: number = 0; index < words.length; index++) {
    const word: string = words[index]!;
    const following: Array<string> = words.slice(index + 1);
    const restIsAfterWords: boolean = following.every(isAfterWord);

    if (SHORT_PASSWORD_WORDS.has(word)) {
      // `pass` alone or `pass_hash`, never `boarding_pass`.
      if ((words.length === 1 || following.length > 0) && restIsAfterWords) {
        return true;
      }

      continue;
    }

    for (const passwordWord of PASSWORD_WORDS) {
      const at: number = word.indexOf(passwordWord);

      if (at < 0) {
        continue;
      }

      // "passwordhash", "hashedpassword": the rest of the word counts too.
      const suffix: string = word.slice(at + passwordWord.length);

      if ((suffix === "" || isAfterWord(suffix)) && restIsAfterWords) {
        return true;
      }
    }
  }

  return false;
}

export type PasswordValueKind =
  | "empty"
  | "placeholder"
  | "hash"
  | "encrypted"
  | "plaintext";

// What one value of a password field is.
export function getPasswordValueKind(value: unknown): PasswordValueKind {
  if (value === null || value === undefined) {
    return "empty";
  }

  // Binary: a digest stored as bytes.
  if (value instanceof Uint8Array) {
    return value.length === 0 ? "empty" : "hash";
  }

  if (typeof value !== "string") {
    // Booleans, numbers, dates, objects: about a password, not one.
    return "placeholder";
  }

  const trimmed: string = value.trim();

  if (trimmed.length === 0) {
    return "empty";
  }

  if (isPasswordHash(trimmed)) {
    return "hash";
  }

  if (isPlaceholder(trimmed)) {
    return "placeholder";
  }

  if (isEncryptedLooking(trimmed)) {
    return "encrypted";
  }

  return "plaintext";
}

/*
 * The fields, of those given, whose name says password and whose values
 * are mostly not hashes: the passwords themselves.
 */
export function findPlaintextPasswordFields(
  fields: Array<{ path: string; values: Array<unknown> }>,
): Array<string> {
  const found: Array<string> = [];

  for (const field of fields) {
    if (!isPasswordFieldName(field.path)) {
      continue;
    }

    let plaintext: number = 0;
    let protectedValues: number = 0;

    for (const value of field.values.slice(0, MAX_VALUES_PER_FIELD)) {
      const kind: PasswordValueKind = getPasswordValueKind(value);

      if (kind === "plaintext") {
        plaintext++;
      } else if (kind === "hash" || kind === "encrypted") {
        protectedValues++;
      }
    }

    if (plaintext > 0 && plaintext > protectedValues) {
      found.push(field.path);
    }
  }

  return found;
}
