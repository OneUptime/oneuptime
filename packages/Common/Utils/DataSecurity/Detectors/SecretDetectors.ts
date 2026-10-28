import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  containsAny,
  DataTypeDetector,
  digitsOnly,
  isPlaceholderDigits,
} from "../Detector";
import {
  base58Check,
  base58Decode,
  isRealDate,
  shannonEntropy,
} from "../Validators";

/*
 * SECRETS AND CREDENTIALS: WHAT UNLOCKS ANOTHER SYSTEM.
 *
 * A leaked key is the one finding that is an incident on its own: whoever
 * reads it can spend the account, read the bucket, push to the repository.
 * Most providers now mint keys with a fixed prefix (ghp_, xoxb-, sk_live_,
 * AKIA) so that scanners can find them, and the prefix with the provider's
 * length and alphabet is proof enough on its own. A key without one - an
 * AWS secret, a Datadog key, 32 hex characters - counts only next to words
 * that say whose it is. A value assigned to a field called "password" or
 * "api_key" counts when it is random enough to be real and is none of the
 * placeholders documentation is full of.
 *
 * Documented examples (AKIAIOSFODNN7EXAMPLE), test-mode keys (sk_test_) and
 * placeholders (ghp_xxxx...) are test values: counted apart, never
 * findings.
 *
 * Every value group ends its match, so a value's place in the text is the
 * match's end less the value's length.
 */

/*
 * What follows a key's prefix is filler, not a key, when it is this
 * predictable (bits per character) or repeats one character this many
 * times in a row: "xxxxxxxx", "00000000". A real key's random part sits
 * near 4 to 6 bits per character and never runs one character eight times.
 */
const FILLER_ENTROPY: number = 2;
const FILLER_RUN: number = 8;

// The longest run of one character repeated: 5 in "abxxxxxc".
function longestRun(value: string): number {
  let longest: number = 0;
  let run: number = 0;

  for (let index: number = 0; index < value.length; index++) {
    run = index > 0 && value[index] === value[index - 1] ? run + 1 : 1;

    if (run > longest) {
      longest = run;
    }
  }

  return longest;
}

/*
 * Whether a key is a documented example or a placeholder rather than one
 * someone holds: it says EXAMPLE, as AWS's do (AKIAIOSFODNN7EXAMPLE), or
 * what follows its prefix is filler - "ghp_xxxx...", "T00000000".
 */
export function isExampleToken(
  value: string,
  prefixes: ReadonlyArray<string> = [],
): boolean {
  if (value.includes("EXAMPLE")) {
    return true;
  }

  let body: string = value;

  for (const prefix of prefixes) {
    if (
      value.startsWith(prefix) &&
      value.length - prefix.length < body.length
    ) {
      body = value.slice(prefix.length);
    }
  }

  return (
    body.length === 0 ||
    shannonEntropy(body) < FILLER_ENTROPY ||
    longestRun(body) >= FILLER_RUN
  );
}

interface CharacterKinds {
  upper: boolean;
  lower: boolean;
  digit: boolean;
  // Anything but a letter, a digit and the separators of names (. _ -).
  symbol: boolean;
}

function characterKinds(value: string): CharacterKinds {
  const kinds: CharacterKinds = {
    upper: false,
    lower: false,
    digit: false,
    symbol: false,
  };

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code >= 65 && code <= 90) {
      kinds.upper = true;
    } else if (code >= 97 && code <= 122) {
      kinds.lower = true;
    } else if (code >= 48 && code <= 57) {
      kinds.digit = true;
    } else if (code !== 46 && code !== 95 && code !== 45) {
      kinds.symbol = true;
    }
  }

  return kinds;
}

// The value of one base64 digit, standard (+ /) or URL-safe (- _), or -1.
function base64Digit(code: number): number {
  if (code >= 65 && code <= 90) {
    return code - 65;
  }

  if (code >= 97 && code <= 122) {
    return code - 71;
  }

  if (code >= 48 && code <= 57) {
    return code + 4;
  }

  if (code === 43 || code === 45) {
    return 62;
  }

  if (code === 47 || code === 95) {
    return 63;
  }

  return -1;
}

/*
 * Decodes base64 in either alphabet, with or without its "=" padding, or
 * returns null when the text is not base64. Written out rather than taken
 * from Node's Buffer, which the browser does not have.
 */
export function decodeBase64(value: string): Uint8Array | null {
  let end: number = value.length;

  while (end > 0 && value.charCodeAt(end - 1) === 61) {
    end--;
  }

  const padding: number = value.length - end;

  if (padding > 2 || end % 4 === 1 || (padding > 0 && value.length % 4 !== 0)) {
    return null;
  }

  const bytes: Array<number> = [];
  let buffer: number = 0;
  let bits: number = 0;

  for (let index: number = 0; index < end; index++) {
    const digit: number = base64Digit(value.charCodeAt(index));

    if (digit < 0) {
      return null;
    }

    // At most 14 bits are ever pending, so 24 hold them all.
    buffer = ((buffer << 6) | digit) & 0xffffff;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return Uint8Array.from(bytes);
}

// Bytes as text, one character per byte: enough for JSON and "user:pass".
function bytesToText(bytes: Uint8Array): string {
  let text: string = "";

  for (let index: number = 0; index < bytes.length; index++) {
    text += String.fromCharCode(bytes[index]!);
  }

  return text;
}

/*
 * Words a placeholder is made of, compared after the digits and marks a
 * placeholder is dressed in are taken off ("password123!", "_secret_").
 */
const PLACEHOLDER_WORDS: ReadonlySet<string> = new Set([
  "password",
  "passwd",
  "passw0rd",
  "p@ssw0rd",
  "p@ssword",
  "pass",
  "pwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "api-key",
  "key",
  "changeme",
  "change_me",
  "change-me",
  "changeit",
  "example",
  "sample",
  "test",
  "testing",
  "dummy",
  "fake",
  "placeholder",
  "redacted",
  "removed",
  "hidden",
  "masked",
  "null",
  "nil",
  "none",
  "undefined",
  "true",
  "false",
  "empty",
  "default",
  "unknown",
  "todo",
  "tbd",
  "fixme",
  "foo",
  "bar",
  "foobar",
  "qwerty",
  "letmein",
  "admin",
  "root",
  "guest",
  "user",
  "username",
  "value",
  "string",
  "required",
  "notset",
  "not_set",
  "unset",
  "xxx",
  "pw",
  "pa$$w0rd",
  "pa55word",
  "hunter2",
  "demo",
  "mock",
]);

// Words a placeholder holds between its separators: "sk-smoke-test-0123".
const PLACEHOLDER_SEGMENTS: ReadonlySet<string> = new Set([
  "test",
  "testing",
  "example",
  "sample",
  "dummy",
  "fake",
  "placeholder",
  "changeme",
  "mock",
  "fixture",
]);

// How a placeholder starts: "your-api-key", "test_secret", "changeme123".
const PLACEHOLDER_STARTS: ReadonlyArray<string> = [
  "your",
  "test",
  "example",
  "sample",
  "dummy",
  "fake",
  "placeholder",
  "changeme",
  "change-me",
  "change_me",
  "redacted",
  "replace",
  "insert",
  "enter",
];

/*
 * What a template, a masked value or a placeholder holds anywhere:
 * "${DB_PASSWORD}", "{{ secret }}", "#{token}", "$(cat key)", "%(pw)s",
 * "********", "sk-xxxx", "<your key>", "abc...", and the straight runs
 * people type for a value that does not matter ("123456", "abcdef").
 */
const PLACEHOLDER_MARKERS: ReadonlyArray<string> = [
  "${",
  "{{",
  "#{",
  "$(",
  "%(",
  "***",
  "xxxx",
  "...",
  "\u2026",
  "<",
  ">",
  "123456",
  "654321",
  "987654",
  "abcdef",
];

// How a value made of a placeholder's words is split: "sk-smoke-test-0123".
const SEGMENT_SEPARATORS: string = "-_.:/ ";

function hasPlaceholderSegment(lower: string): boolean {
  let segment: string = "";

  for (let index: number = 0; index <= lower.length; index++) {
    const character: string = lower[index] || " ";

    if (!SEGMENT_SEPARATORS.includes(character)) {
      segment += character;
      continue;
    }

    if (PLACEHOLDER_SEGMENTS.has(segment)) {
      return true;
    }

    segment = "";
  }

  return false;
}

// Marks a placeholder ends in: "password123!", "secret_".
const TRAILING_MARKS: string = "0123456789!@#$%^&*._-?";

function isIdentifierText(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (
      !(
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 95
      )
    ) {
      return false;
    }
  }

  return true;
}

// A lower-cased value without the marks it is dressed in.
function placeholderCore(lower: string): string {
  let start: number = 0;
  let end: number = lower.length;

  while (start < end && "_.-".includes(lower[start]!)) {
    start++;
  }

  while (end > start && TRAILING_MARKS.includes(lower[end - 1]!)) {
    end--;
  }

  return lower.slice(start, end);
}

/*
 * Whether a secret is a placeholder rather than one: a word documentation
 * and templates write ("changeme", "your-password", "<password>"), a
 * template or a variable that holds it ("${DB_PASSWORD}", "$PASSWORD",
 * "%DB_PASS%"), or a masked value ("********"). A value that says EXAMPLE
 * is a documented example, counted as a test value, so it is not refused
 * here.
 */
export function isPlaceholderSecret(value: string): boolean {
  if (value.includes("EXAMPLE")) {
    return false;
  }

  const lower: string = value.toLowerCase();

  if (lower.length === 0 || longestRun(lower) === lower.length) {
    return true;
  }

  for (const marker of PLACEHOLDER_MARKERS) {
    if (lower.includes(marker)) {
      return true;
    }
  }

  const first: string = lower[0]!;
  const last: string = lower[lower.length - 1]!;

  if (
    first === "%" ||
    (first === "[" && last === "]") ||
    (first === "(" && last === ")") ||
    (first === "{" && last === "}") ||
    (lower.startsWith("__") && lower.endsWith("__")) ||
    (first === "$" && isIdentifierText(value.slice(1)))
  ) {
    return true;
  }

  const core: string = placeholderCore(lower);

  if (PLACEHOLDER_WORDS.has(lower) || PLACEHOLDER_WORDS.has(core)) {
    return true;
  }

  if (
    lower.startsWith("my") &&
    PLACEHOLDER_WORDS.has(placeholderCore(core.slice(2)))
  ) {
    return true;
  }

  for (const start of PLACEHOLDER_STARTS) {
    if (lower.startsWith(start)) {
      return true;
    }
  }

  return (
    hasPlaceholderSegment(lower) ||
    lower.endsWith("_here") ||
    lower.endsWith("-here") ||
    lower.endsWith(".here")
  );
}

/*
 * Code that reads a secret, not the secret: a property path
 * ("options.password", "config.db2", TypeScript's "monitor.id!"), optional
 * chaining ("req.body?."), a pointer or a scope ("$this->pw",
 * "Config::KEY"), a member access cut short ("settings.").
 */
function isCodeReference(value: string): boolean {
  if (
    value.endsWith(".") ||
    value.includes("?.") ||
    value.includes("->") ||
    value.includes("::")
  ) {
    return true;
  }

  let path: string = value;

  while (path.endsWith("!")) {
    path = path.slice(0, -1);
  }

  if (!path.includes(".")) {
    return false;
  }

  return path.split(".").every((segment: string) => {
    const code: number = segment.charCodeAt(0);

    return (
      isIdentifierText(segment) &&
      ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95)
    );
  });
}

// A mark a password is made with: anything but letters, digits and . _ - /.
function hasPasswordMark(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (
      !(
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 46 ||
        code === 95 ||
        code === 45 ||
        code === 47
      )
    ) {
      return true;
    }
  }

  return false;
}

// A path on disk: what PWD= holds in a shell's environment.
function isPathLike(value: string): boolean {
  if (value.includes("+") || value.includes("=")) {
    return false;
  }

  if (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("~/")
  ) {
    return true;
  }

  const code: number = value.charCodeAt(0);

  return (
    value.length > 2 &&
    ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) &&
    value[1] === ":" &&
    (value[2] === "\\" || value[2] === "/")
  );
}

/*
 * What a config holds in place of a secret: where to read it (an
 * environment variable, a vault path, an ARN), or code that reads it.
 */
const SECRET_REFERENCE_STARTS: ReadonlyArray<string> = [
  "process.env",
  "os.environ",
  "os.getenv",
  "getenv",
  "system.getenv",
  "env.",
  "env:",
  "this.",
  "self.",
  "config.",
  "settings.",
  "secrets.",
  "vault:",
  "arn:",
  "projects/",
  "op://",
  "ref+",
  "file:",
  "keyvault:",
  "@microsoft.keyvault",
];

// How a password hash starts: bcrypt, argon2, scrypt, crypt(3), Django, LDAP.
const PASSWORD_HASH_STARTS: ReadonlyArray<string> = [
  "$2a$",
  "$2b$",
  "$2x$",
  "$2y$",
  "$argon2",
  "$scrypt$",
  "$7$",
  "$1$",
  "$5$",
  "$6$",
  "$apr1$",
  "$pbkdf2",
  "$sha1$",
  "pbkdf2_",
  "pbkdf2:",
  "scrypt:",
  "argon2$",
  "bcrypt$",
  "bcrypt_sha256$",
  "sha1$",
  "md5$",
  "{ssha}",
  "{sha}",
  "{ssha256}",
  "{ssha512}",
  "{bcrypt}",
  "{crypt}",
  "{md5}",
  "{pbkdf2}",
];

// Words that make a value the name of a secret, not the secret: "db-password".
const SECRET_NAME_WORDS: ReadonlyArray<string> = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "api-key",
  "credential",
];

function hasSecretNameWord(lower: string): boolean {
  return SECRET_NAME_WORDS.some((word: string) => {
    return lower.includes(word);
  });
}

// A date or a timestamp: 2024-03-15, 2024-03-15T14:27:39Z.
const ISO_DATE_START: RegExp = /^[0-9]{4}-[0-9]{2}-[0-9]{2}/;

const GENERIC_SECRET_MIN_LENGTH: number = 8;
const GENERIC_SECRET_MAX_LENGTH: number = 128;
const GENERIC_SECRET_ENTROPY: number = 3;
// A value of lower-case letters, digits and separators reads like a name ...
const GENERIC_NAME_LIKE_ENTROPY: number = 3.5;

/*
 * Whether a value assigned to a password, secret or API key is one: long
 * enough, random enough (3 bits per character - "Tr0ub4dor&3" passes,
 * "password1" does not), and none of the things that stand in for one - a
 * placeholder, a reference, a path, a URL, a password hash, a date, code
 * that reads it ("config.password"), the secret's name ("db-password").
 */
export function isGenericSecretValue(value: string): boolean {
  if (
    value.length < GENERIC_SECRET_MIN_LENGTH ||
    value.length > GENERIC_SECRET_MAX_LENGTH ||
    isPlaceholderSecret(value) ||
    isPathLike(value) ||
    ISO_DATE_START.test(value)
  ) {
    return false;
  }

  const lower: string = value.toLowerCase();

  if (lower.includes("://")) {
    return false;
  }

  for (const start of [...SECRET_REFERENCE_STARTS, ...PASSWORD_HASH_STARTS]) {
    if (lower.startsWith(start)) {
      return false;
    }
  }

  if (hasSecretNameWord(lower) || isCodeReference(value)) {
    return false;
  }

  const kinds: CharacterKinds = characterKinds(value);

  // Letters and separators only: a word, an identifier, "Username/Passwort".
  if (!kinds.digit && !hasPasswordMark(value)) {
    return false;
  }

  if (
    !kinds.upper &&
    !kinds.lower &&
    !kinds.symbol &&
    isPlaceholderDigits(value)
  ) {
    return false;
  }

  // ... or a path of names: "prod/db/postgres".
  if (!kinds.upper && value.includes("/")) {
    return false;
  }

  const entropy: number = shannonEntropy(value);

  if (!kinds.upper && !kinds.symbol) {
    return entropy >= GENERIC_NAME_LIKE_ENTROPY;
  }

  return entropy >= GENERIC_SECRET_ENTROPY;
}

// Documentation's own domains (RFC 2606, RFC 6761).
const RESERVED_HOSTS: ReadonlySet<string> = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example.edu",
]);

const RESERVED_HOST_SUFFIXES: ReadonlyArray<string> = [
  ".example",
  ".test",
  ".invalid",
  ".example.com",
  ".example.org",
  ".example.net",
];

function isReservedHost(host: string): boolean {
  const lower: string = host.toLowerCase();

  return (
    RESERVED_HOSTS.has(lower) ||
    RESERVED_HOST_SUFFIXES.some((suffix: string) => {
      return lower.endsWith(suffix);
    })
  );
}

/*
 * A token with a provider's fixed prefix: the prefix, the provider's
 * length and alphabet are the proof, so it is High on its own. The prefixes
 * are the quick check, and what a placeholder's filler follows.
 */
interface PrefixedTokenOptions {
  dataTypeId: string;
  prefixes: ReadonlyArray<string>;
  pattern: RegExp;
  keywords: ReadonlyArray<string>;
  validate?: ((normalized: string) => boolean) | undefined;
  // Test values beyond examples and placeholders: sk_test_ keys.
  isTestValue?: ((normalized: string) => boolean) | undefined;
}

function prefixedToken(options: PrefixedTokenOptions): DataTypeDetector {
  const isOtherTestValue: ((normalized: string) => boolean) | undefined =
    options.isTestValue;

  return {
    dataTypeId: options.dataTypeId,
    quickCheck: containsAny(options.prefixes),
    pattern: options.pattern,
    validate: options.validate,
    keywords: options.keywords,
    confidenceWithoutContext: DataConfidence.High,
    specificity: 3,
    isTestValue: (normalized: string): boolean => {
      return (
        isExampleToken(normalized, options.prefixes) ||
        Boolean(isOtherTestValue && isOtherTestValue(normalized))
      );
    },
  };
}

/*
 * AWS access key ID: one of the four prefixes AWS mints keys with - AKIA
 * (a user's long-term key), ASIA (a temporary STS key), ABIA (an STS
 * bearer token), ACCA (a context-specific credential) - and sixteen
 * base-32 characters.
 */
const AWS_ACCESS_KEY_ID_PATTERN: RegExp =
  /(?<![A-Za-z0-9])(?:AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}(?![A-Za-z0-9])/g;

const awsAccessKeyIdDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "aws-access-key-id",
  prefixes: ["AKIA", "ASIA", "ABIA", "ACCA"],
  pattern: AWS_ACCESS_KEY_ID_PATTERN,
  keywords: ["aws", "access key", "access_key", "accesskeyid", "key id"],
});

/*
 * AWS secret access key: 40 base64 characters, exactly - not part of a
 * longer run, nor a part of a dotted token - mixing upper and lower case
 * with a digit or a mark, as 30 random bytes do (a SHA-1's 40 hex
 * characters never have upper case). On its shape alone it is any random
 * value, so it counts only next to words that name it.
 */
const AWS_SECRET_ACCESS_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9+/_-]|[A-Za-z0-9_-]\.)[A-Za-z0-9+/]{40}(?![A-Za-z0-9+/=_-]|\.[A-Za-z0-9_-])/g;

const AWS_SECRET_ENTROPY: number = 3.5;

const awsSecretAccessKeyDetector: DataTypeDetector = {
  dataTypeId: "aws-secret-access-key",
  pattern: AWS_SECRET_ACCESS_KEY_PATTERN,
  validate: (normalized: string): boolean => {
    const kinds: CharacterKinds = characterKinds(normalized);

    return (
      kinds.upper &&
      kinds.lower &&
      (kinds.digit || kinds.symbol) &&
      shannonEntropy(normalized) >= AWS_SECRET_ENTROPY
    );
  },
  keywords: [
    "aws",
    "secret_access_key",
    "secret-access-key",
    "secret access key",
    "secretaccesskey",
    "awssecretaccesskey",
    "aws_secret",
    "secret_key",
    "secretkey",
    "awssecretkey",
  ],
  requiresContext: true,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
  isTestValue: (normalized: string): boolean => {
    return isExampleToken(normalized);
  },
};

// Google API key: "AIza" and 35 URL-safe base64 characters.
const GOOGLE_API_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g;

const googleApiKeyDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "google-api-key",
  prefixes: ["AIza"],
  pattern: GOOGLE_API_KEY_PATTERN,
  keywords: [
    "google",
    "api key",
    "api_key",
    "apikey",
    "gcp",
    "firebase",
    "maps",
  ],
});

/*
 * Google service account key file: its "private_key_id" field, 40 hex
 * characters - the JSON Google hands out with the private key beside it.
 * The field's name is only Google's, so the key ID is the finding, also
 * when the JSON is escaped inside a string (\"private_key_id\").
 */
const GOOGLE_SERVICE_ACCOUNT_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9_])private_key_id\\?["']?\s{0,4}[:=]\s{0,4}\\?["']?([0-9a-f]{40})(?![A-Za-z0-9])/g;

const googleServiceAccountKeyDetector: DataTypeDetector = {
  dataTypeId: "google-service-account-key",
  quickCheck: containsAny(["private_key_id"]),
  pattern: GOOGLE_SERVICE_ACCOUNT_KEY_PATTERN,
  valueGroup: 1,
  keywords: [
    "service_account",
    "service account",
    "gserviceaccount.com",
    "client_email",
    "private_key",
  ],
  confidenceWithoutContext: DataConfidence.High,
  specificity: 3,
  isTestValue: (normalized: string): boolean => {
    return isExampleToken(normalized);
  },
};

// Google OAuth client secret: "GOCSPX-" and 28 URL-safe characters.
const GOOGLE_OAUTH_CLIENT_SECRET_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-])GOCSPX-[A-Za-z0-9_-]{28}(?![A-Za-z0-9_-])/g;

const googleOAuthClientSecretDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "google-oauth-client-secret",
  prefixes: ["GOCSPX-"],
  pattern: GOOGLE_OAUTH_CLIENT_SECRET_PATTERN,
  keywords: ["google", "client_secret", "client secret", "oauth"],
});

/*
 * Azure storage account key: 64 bytes in base64 - 86 characters and "==" -
 * next to words that name it, as a connection string does
 * (DefaultEndpointsProtocol=...;AccountKey=...) and as the portal, the CLI
 * and Terraform state do.
 */
const AZURE_STORAGE_ACCOUNT_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{86}==(?![A-Za-z0-9+/=])/g;

const AZURE_STORAGE_KEY_BYTES: number = 64;

const azureStorageAccountKeyDetector: DataTypeDetector = {
  dataTypeId: "azure-storage-account-key",
  quickCheck: containsAny(["=="]),
  pattern: AZURE_STORAGE_ACCOUNT_KEY_PATTERN,
  validate: (normalized: string): boolean => {
    const bytes: Uint8Array | null = decodeBase64(normalized);

    return bytes !== null && bytes.length === AZURE_STORAGE_KEY_BYTES;
  },
  keywords: [
    "accountkey",
    "account_key",
    "account-key",
    "account key",
    "storageaccountkey",
    "storage_key",
    "storagekey",
    "storage key",
    "primary_access_key",
    "secondary_access_key",
    "defaultendpointsprotocol",
    "azure",
    "windows.net",
  ],
  requiresContext: true,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
  isTestValue: (normalized: string): boolean => {
    return isExampleToken(normalized);
  },
};

/*
 * Azure shared access signature: a signed version that is a real date
 * (sv=2022-11-02), the token's other fields, and a signature (sig=) that is
 * an HMAC-SHA256 - 32 bytes - in URL-encoded base64. The whole query is the
 * value; sig is always written last.
 */
const AZURE_SAS_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_])sv=20[1-9][0-9]-[01][0-9]-[0-3][0-9][A-Za-z0-9%&=:._~-]{0,400}?&sig=[A-Za-z0-9%+/]{30,128}={0,2}(?![A-Za-z0-9%+/=])/g;

const SAS_SIGNATURE_BYTES: number = 32;
const SAS_FIRST_YEAR: number = 2012;

// URL-encoded base64 as base64: "%2B" is "+", "%2F" "/", "%3D" "=".
function percentDecodedBase64(value: string): string | null {
  let decoded: string = "";

  for (let index: number = 0; index < value.length; index++) {
    const character: string = value[index]!;

    if (character !== "%") {
      decoded += character;
      continue;
    }

    const code: string = value.slice(index + 1, index + 3).toUpperCase();

    if (code === "2B") {
      decoded += "+";
    } else if (code === "2F") {
      decoded += "/";
    } else if (code === "3D") {
      decoded += "=";
    } else {
      return null;
    }

    index += 2;
  }

  return decoded;
}

function sasSignature(token: string): string | null {
  const at: number = token.lastIndexOf("&sig=");

  return at < 0 ? null : percentDecodedBase64(token.slice(at + 5));
}

export function isAzureSasToken(token: string): boolean {
  const year: number = Number(token.slice(3, 7));
  const month: number = Number(token.slice(8, 10));
  const day: number = Number(token.slice(11, 13));

  if (year < SAS_FIRST_YEAR || !isRealDate(year, month, day)) {
    return false;
  }

  const signature: string | null = sasSignature(token);
  const bytes: Uint8Array | null = signature ? decodeBase64(signature) : null;

  return bytes !== null && bytes.length === SAS_SIGNATURE_BYTES;
}

const azureSasTokenDetector: DataTypeDetector = {
  dataTypeId: "azure-sas-token",
  quickCheck: (text: string): boolean => {
    return text.includes("sv=") && text.includes("&sig=");
  },
  pattern: AZURE_SAS_TOKEN_PATTERN,
  validate: isAzureSasToken,
  keywords: [
    "sas",
    "sastoken",
    "sas_token",
    "sharedaccesssignature",
    "windows.net",
  ],
  confidenceWithoutContext: DataConfidence.High,
  specificity: 3,
  isTestValue: (normalized: string): boolean => {
    const signature: string = sasSignature(normalized) || "";

    return normalized.includes("EXAMPLE") || isExampleToken(signature);
  },
};

/*
 * Microsoft Entra ID client secret, as the portal mints them since 2021:
 * three characters, a digit, "Q~", and 31 to 34 more of a URL-safe
 * alphabet with "~" and ".". The "Q~" is all that is fixed, so it counts
 * next to words that name it.
 */
const AZURE_CLIENT_SECRET_PATTERN: RegExp =
  /(?<![A-Za-z0-9_~.-])[A-Za-z0-9_~.-]{3}[0-9]Q~[A-Za-z0-9_~.-]{31,34}(?![A-Za-z0-9_~.-])/g;

const AZURE_CLIENT_SECRET_ENTROPY: number = 3.5;

const azureClientSecretDetector: DataTypeDetector = {
  dataTypeId: "azure-client-secret",
  quickCheck: containsAny(["Q~"]),
  pattern: AZURE_CLIENT_SECRET_PATTERN,
  validate: (normalized: string): boolean => {
    return shannonEntropy(normalized) >= AZURE_CLIENT_SECRET_ENTROPY;
  },
  keywords: [
    "azure",
    "azurerm",
    "client_secret",
    "client-secret",
    "clientsecret",
    "client secret",
    "aad",
    "entra",
    "tenant",
    "tenant_id",
    "msal",
    "app_secret",
  ],
  requiresContext: true,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
  isTestValue: (normalized: string): boolean => {
    return isExampleToken(normalized);
  },
};

/*
 * GitHub token: ghp_ (personal), gho_ (OAuth), ghu_ (app user), ghs_ (app
 * installation), ghr_ (refresh) and 36 characters, or a fine-grained
 * github_pat_ and 82.
 */
const GITHUB_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})(?![A-Za-z0-9_])/g;

const githubTokenDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "github-token",
  prefixes: ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"],
  pattern: GITHUB_TOKEN_PATTERN,
  keywords: ["github", "gh_token", "github_token", "personal access token"],
});

/*
 * GitLab token: glpat- and 20 characters (or a longer routable token
 * ending in its version and checksum), and the deploy (gldt-), runner
 * (glrt-), feed (glft-), SCIM (glsoat-), pipeline trigger (glptt-) and
 * OAuth application (gloas-) tokens.
 */
const GITLAB_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-])(?:glpat-[A-Za-z0-9_-]{20}|glpat-[A-Za-z0-9_-]{27,300}\.[0-9a-z]{2}\.?[0-9a-z]{7}|gl(?:dt|rt|ft|soat)-[A-Za-z0-9_-]{20,64}|glptt-[0-9a-f]{40}|gloas-[A-Za-z0-9_-]{64})(?![A-Za-z0-9_-])/g;

const gitlabTokenDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "gitlab-token",
  prefixes: [
    "glpat-",
    "gldt-",
    "glrt-",
    "glft-",
    "glsoat-",
    "glptt-",
    "gloas-",
  ],
  pattern: GITLAB_TOKEN_PATTERN,
  keywords: ["gitlab", "private-token", "private_token", "gitlab_token"],
});

/*
 * Slack token: xoxb- (bot), xoxp- (user), xoxa- and xoxo- (legacy
 * workspace), xoxr- and xoxe- (refresh), xoxs- (session), xoxc- (client):
 * the team's number and the token's other parts; or an app-level token,
 * xapp-.
 */
const SLACK_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-])(?:xox[abceoprs]-[0-9]{1,13}-[A-Za-z0-9-]{10,250}|xapp-[0-9]-[A-Z0-9]{8,14}-[0-9]{8,16}-[A-Za-z0-9]{32,80})(?![A-Za-z0-9_-])/g;

const slackTokenDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "slack-token",
  prefixes: [
    "xoxa-",
    "xoxb-",
    "xoxc-",
    "xoxe-",
    "xoxo-",
    "xoxp-",
    "xoxr-",
    "xoxs-",
    "xapp-",
  ],
  pattern: SLACK_TOKEN_PATTERN,
  keywords: ["slack", "slack_token", "slack_bot_token", "bot token"],
});

/*
 * Slack incoming webhook: hooks.slack.com/services/ with the team's ID
 * (T...), the hook's (B...) and its 24-character secret, or a workflow or
 * trigger webhook. Anyone who has it can post to the channel.
 */
const SLACK_WEBHOOK_URL_PATTERN: RegExp =
  /(?<![A-Za-z0-9.-])(?:https:\/\/|http:\/\/)?hooks\.slack\.com\/(?:services\/T[A-Z0-9]{6,12}\/B[A-Z0-9]{6,12}\/[A-Za-z0-9]{20,32}|(?:workflows|triggers)\/T[A-Z0-9]{6,12}\/[A-Za-z0-9/]{20,120})(?![A-Za-z0-9])/g;

const slackWebhookUrlDetector: DataTypeDetector = {
  dataTypeId: "slack-webhook-url",
  quickCheck: containsAny(["hooks.slack.com/"]),
  pattern: SLACK_WEBHOOK_URL_PATTERN,
  keywords: ["slack", "webhook", "incoming webhook"],
  confidenceWithoutContext: DataConfidence.High,
  specificity: 3,
  // Slack's own example: T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX.
  isTestValue: (normalized: string): boolean => {
    const services: number = normalized.indexOf("/T");

    return isExampleToken(normalized.slice(services + 1));
  },
};

/*
 * Stripe secret or restricted key: sk_ or rk_, live_ or test_, and the
 * key. A test-mode key (sk_test_) moves no money: a test value.
 */
const STRIPE_SECRET_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9_])(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,247}(?![A-Za-z0-9_])/g;

const stripeSecretKeyDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "stripe-secret-key",
  prefixes: ["sk_live_", "rk_live_", "sk_test_", "rk_test_"],
  pattern: STRIPE_SECRET_KEY_PATTERN,
  keywords: ["stripe", "secret key", "secret_key", "restricted key"],
  isTestValue: (normalized: string): boolean => {
    return (
      normalized.startsWith("sk_test_") || normalized.startsWith("rk_test_")
    );
  },
});

/*
 * Twilio API key SID: "SK" and 32 hex characters. Any hex digest could
 * follow an "SK", so it counts next to words that say it is Twilio's.
 */
const TWILIO_API_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9])SK[0-9a-fA-F]{32}(?![A-Za-z0-9])/g;

const twilioApiKeyDetector: DataTypeDetector = {
  dataTypeId: "twilio-api-key",
  quickCheck: containsAny(["SK"]),
  pattern: TWILIO_API_KEY_PATTERN,
  validate: (normalized: string): boolean => {
    const kinds: CharacterKinds = characterKinds(normalized.slice(2));

    return kinds.digit && (kinds.lower || kinds.upper);
  },
  keywords: [
    "twilio",
    "api_key_sid",
    "apikeysid",
    "api key sid",
    "key_sid",
    "keysid",
    "account_sid",
    "accountsid",
    "api_key",
    "apikey",
    "api key",
  ],
  requiresContext: true,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
  isTestValue: (normalized: string): boolean => {
    return isExampleToken(normalized, ["SK"]);
  },
};

// SendGrid API key: "SG.", a 22-character ID, ".", a 43-character secret.
const SENDGRID_API_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-])SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;

const sendgridApiKeyDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "sendgrid-api-key",
  prefixes: ["SG."],
  pattern: SENDGRID_API_KEY_PATTERN,
  keywords: ["sendgrid", "api key", "api_key", "smtp"],
});

/*
 * Mailgun API key: "key-" and 32 lower-case letters and digits (the
 * original form), or 32 hex characters, "-", 8 and 8 more (the private key
 * of today). "key-" is a prefix many things have, so on its own it is
 * Medium, and High next to the word Mailgun.
 */
const MAILGUN_API_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-])(?:key-[0-9a-z]{32}|[0-9a-f]{32}-[0-9a-f]{8}-[0-9a-f]{8})(?![A-Za-z0-9_-])/g;

const mailgunApiKeyDetector: DataTypeDetector = {
  dataTypeId: "mailgun-api-key",
  quickCheck: containsAny(["-"]),
  pattern: MAILGUN_API_KEY_PATTERN,
  validate: (normalized: string): boolean => {
    const kinds: CharacterKinds = characterKinds(
      normalized.startsWith("key-") ? normalized.slice(4) : normalized,
    );

    return kinds.digit && kinds.lower;
  },
  keywords: ["mailgun", "mailgun_api_key", "mg_api_key", "api.mailgun.net"],
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
  isTestValue: (normalized: string): boolean => {
    return isExampleToken(normalized, ["key-"]);
  },
};

// Mailchimp API key: 32 hex characters and the data centre, "-us" and 1-2 digits.
const MAILCHIMP_API_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-])[0-9a-f]{32}-us[0-9]{1,2}(?![A-Za-z0-9_-])/g;

const mailchimpApiKeyDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "mailchimp-api-key",
  prefixes: ["-us"],
  pattern: MAILCHIMP_API_KEY_PATTERN,
  keywords: ["mailchimp", "api key", "api_key", "apikey"],
});

/*
 * OpenAI API key: "sk-" with "T3BlbkFJ" - "OpenAI" in base64 - inside it,
 * which every user and project key carries, or a project, service account
 * or admin key's own prefix (sk-proj-, sk-svcacct-, sk-admin-).
 */
const OPENAI_API_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,250}(?![A-Za-z0-9_-])/g;

const OPENAI_KEY_MARKER: string = "T3BlbkFJ";
const OPENAI_KEY_PREFIXES: ReadonlyArray<string> = [
  "sk-proj-",
  "sk-svcacct-",
  "sk-admin-",
];
const OPENAI_PREFIXED_KEY_MIN_LENGTH: number = 40;

const openaiApiKeyDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "openai-api-key",
  prefixes: [OPENAI_KEY_MARKER, ...OPENAI_KEY_PREFIXES],
  pattern: OPENAI_API_KEY_PATTERN,
  validate: (normalized: string): boolean => {
    if (normalized.startsWith("sk-ant-")) {
      return false;
    }

    return (
      normalized.includes(OPENAI_KEY_MARKER) ||
      (normalized.length >= OPENAI_PREFIXED_KEY_MIN_LENGTH &&
        OPENAI_KEY_PREFIXES.some((prefix: string) => {
          return normalized.startsWith(prefix);
        }))
    );
  },
  keywords: ["openai", "openai_api_key", "chatgpt", "gpt"],
});

/*
 * Anthropic API key: "sk-ant-", the key's kind and version (api03, admin01,
 * oat01) and the key.
 */
const ANTHROPIC_API_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-])sk-ant-[a-z]{3,6}[0-9]{2}-[A-Za-z0-9_-]{32,200}(?![A-Za-z0-9_-])/g;

const anthropicApiKeyDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "anthropic-api-key",
  prefixes: ["sk-ant-"],
  pattern: ANTHROPIC_API_KEY_PATTERN,
  keywords: ["anthropic", "anthropic_api_key", "claude"],
});

/*
 * Hugging Face token: hf_ (a user's) or api_org_ (an organization's) and
 * 34 characters of both cases.
 */
const HUGGINGFACE_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_])(?:hf|api_org)_[A-Za-z0-9]{34}(?![A-Za-z0-9_])/g;

const huggingfaceTokenDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "huggingface-token",
  prefixes: ["hf_", "api_org_"],
  pattern: HUGGINGFACE_TOKEN_PATTERN,
  validate: (normalized: string): boolean => {
    const kinds: CharacterKinds = characterKinds(normalized);

    return kinds.upper && kinds.lower;
  },
  keywords: [
    "hugging face",
    "huggingface",
    "hf_token",
    "hugging_face_hub_token",
  ],
});

// npm access token: "npm_" and 36 characters.
const NPM_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9_])/g;

const npmTokenDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "npm-token",
  prefixes: ["npm_"],
  pattern: NPM_TOKEN_PATTERN,
  keywords: ["npm", "npmrc", "npm_token", "_authtoken", "registry.npmjs.org"],
});

/*
 * PyPI upload token: "pypi-" and a macaroon whose first field names the
 * index it is for - pypi.org, or test.pypi.org, whose tokens upload to the
 * test index only: test values.
 */
const PYPI_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-])pypi-AgE(?:IcHlwaS5vcmc|NdGVzdC5weXBpLm9yZw)[A-Za-z0-9_-]{50,1000}(?![A-Za-z0-9_-])/g;

const TEST_PYPI_TOKEN_PREFIX: string = "pypi-AgENdGVzdC5weXBpLm9yZw";

const pypiTokenDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "pypi-token",
  prefixes: ["pypi-AgEIcHlwaS5vcmc", TEST_PYPI_TOKEN_PREFIX],
  pattern: PYPI_TOKEN_PATTERN,
  keywords: ["pypi", "twine", "pypirc", "upload"],
  isTestValue: (normalized: string): boolean => {
    return normalized.startsWith(TEST_PYPI_TOKEN_PREFIX);
  },
});

// Docker Hub access token: dckr_pat_ (personal) or dckr_oat_ (organization).
const DOCKER_HUB_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-])dckr_(?:pat|oat)_[A-Za-z0-9_-]{24,64}(?![A-Za-z0-9_-])/g;

const dockerHubTokenDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "docker-hub-token",
  prefixes: ["dckr_pat_", "dckr_oat_"],
  pattern: DOCKER_HUB_TOKEN_PATTERN,
  keywords: ["docker", "docker hub", "dockerhub", "docker_password"],
});

/*
 * Shopify token: shpat_ (admin API), shpca_ (custom app), shppa_ (private
 * app), shpss_ (shared secret) and 32 hex characters.
 */
const SHOPIFY_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_])shp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}(?![A-Za-z0-9_])/g;

const shopifyTokenDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "shopify-token",
  prefixes: ["shpat_", "shpca_", "shppa_", "shpss_"],
  pattern: SHOPIFY_TOKEN_PATTERN,
  keywords: ["shopify", "x-shopify-access-token", "access token"],
});

/*
 * Square token: an OAuth access token (sq0atp-), an application secret
 * (sq0csp-), or a 64-character access token starting "EAAA". "EAAA" is
 * also what base64 of binary data is full of, so that form must stand
 * apart from any base64 around it and mix both cases with digits.
 */
const SQUARE_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_+/-])(?:sq0atp-[A-Za-z0-9_-]{22}|sq0csp-[A-Za-z0-9_-]{43}|EAAA[A-Za-z0-9_-]{60})(?![A-Za-z0-9_+/=-])/g;

const squareTokenDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "square-token",
  prefixes: ["sq0atp-", "sq0csp-", "EAAA"],
  pattern: SQUARE_TOKEN_PATTERN,
  validate: (normalized: string): boolean => {
    if (!normalized.startsWith("EAAA")) {
      return true;
    }

    const kinds: CharacterKinds = characterKinds(normalized.slice(4));

    return kinds.upper && kinds.lower && kinds.digit;
  },
  keywords: ["square", "squareup", "square_access_token", "access token"],
});

/*
 * Braintree access token: access_token$production$, the merchant's ID and
 * 32 hex characters. A sandbox token reaches the sandbox only: a test
 * value.
 */
const BRAINTREE_ACCESS_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_])access_token\$(?:production|sandbox)\$[0-9a-z]{16}\$[0-9a-f]{32}(?![A-Za-z0-9])/g;

const braintreeAccessTokenDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "braintree-access-token",
  prefixes: ["access_token$production$", "access_token$sandbox$"],
  pattern: BRAINTREE_ACCESS_TOKEN_PATTERN,
  keywords: ["braintree", "paypal", "access token"],
  isTestValue: (normalized: string): boolean => {
    return normalized.includes("$sandbox$");
  },
});

/*
 * DigitalOcean token: dop_v1_ (personal), doo_v1_ (OAuth) or dor_v1_
 * (refresh) and 64 hex characters.
 */
const DIGITALOCEAN_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_])do[opr]_v1_[a-f0-9]{64}(?![A-Za-z0-9_])/g;

const digitaloceanTokenDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "digitalocean-token",
  prefixes: ["dop_v1_", "doo_v1_", "dor_v1_"],
  pattern: DIGITALOCEAN_TOKEN_PATTERN,
  keywords: ["digitalocean", "digital ocean", "doctl", "do_token"],
});

/*
 * New Relic key: a user API key (NRAK- and 27 characters) or an insert key
 * (NRII- and 32).
 */
const NEW_RELIC_API_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-])(?:NRAK-[A-Z0-9]{27}|NRII-[A-Za-z0-9_-]{32})(?![A-Za-z0-9_-])/g;

const newRelicApiKeyDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "new-relic-api-key",
  prefixes: ["NRAK-", "NRII-"],
  pattern: NEW_RELIC_API_KEY_PATTERN,
  keywords: ["new relic", "newrelic", "new_relic", "api-key"],
});

/*
 * Datadog key: an API key (32 hex characters) or an application key (40).
 * Every MD5 and SHA-1 has that shape, so it counts only next to words that
 * name Datadog's keys, and drops a level next to words that say it is a
 * digest.
 */
const DATADOG_API_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-]|[A-Za-z0-9]\.)(?:[a-f0-9]{32}|[a-f0-9]{40})(?![A-Za-z0-9_-]|\.[A-Za-z0-9])/g;

const datadogApiKeyDetector: DataTypeDetector = {
  dataTypeId: "datadog-api-key",
  pattern: DATADOG_API_KEY_PATTERN,
  validate: (normalized: string): boolean => {
    const kinds: CharacterKinds = characterKinds(normalized);

    return kinds.digit && kinds.lower;
  },
  keywords: [
    "datadog",
    "datadoghq",
    "datadoghq.com",
    "dd_api_key",
    "dd-api-key",
    "dd_app_key",
    "dd-application-key",
    "dd_application_key",
    "ddapikey",
    "ddappkey",
    "datadog_api_key",
    "datadog_app_key",
  ],
  negativeKeywords: [
    "md5",
    "sha1",
    "sha256",
    "checksum",
    "digest",
    "hash",
    "etag",
    "commit",
  ],
  requiresContext: true,
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
  isTestValue: (normalized: string): boolean => {
    return isExampleToken(normalized);
  },
};

/*
 * HashiCorp Vault token: hvs. (service), hvb. (batch) or hvr. (recovery)
 * and the token - at least 24 characters, mixing cases or digits.
 */
const VAULT_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_.-])hv[sbr]\.[A-Za-z0-9_-]{24,400}(?![A-Za-z0-9_-])/g;

const VAULT_TOKEN_ENTROPY: number = 3;

const vaultTokenDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "vault-token",
  prefixes: ["hvs.", "hvb.", "hvr."],
  pattern: VAULT_TOKEN_PATTERN,
  validate: (normalized: string): boolean => {
    const body: string = normalized.slice(4);
    const kinds: CharacterKinds = characterKinds(body);

    return (
      (kinds.digit || (kinds.upper && kinds.lower)) &&
      shannonEntropy(body) >= VAULT_TOKEN_ENTROPY
    );
  },
  keywords: ["vault", "vault_token", "x-vault-token", "hashicorp"],
});

/*
 * Terraform Cloud / Enterprise API token: 14 characters, ".atlasv1." and
 * 60 to 70 more.
 */
const TERRAFORM_CLOUD_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-])[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9_=-]{60,70}(?![A-Za-z0-9_=-])/g;

const terraformCloudTokenDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "terraform-cloud-token",
  prefixes: [".atlasv1."],
  pattern: TERRAFORM_CLOUD_TOKEN_PATTERN,
  keywords: [
    "terraform",
    "tfe_token",
    "tf_token",
    "credentials",
    "app.terraform.io",
  ],
});

// Atlassian API token: "ATATT3" and the token (about 186 characters).
const ATLASSIAN_API_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-])ATATT3[A-Za-z0-9_=-]{150,250}(?![A-Za-z0-9_=-])/g;

const atlassianApiTokenDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "atlassian-api-token",
  prefixes: ["ATATT3"],
  pattern: ATLASSIAN_API_TOKEN_PATTERN,
  keywords: ["atlassian", "jira", "confluence", "bitbucket", "api token"],
});

// Linear API key: lin_api_ and 40 characters, or an OAuth token, lin_oauth_.
const LINEAR_API_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9_])lin_(?:api_[A-Za-z0-9]{40}|oauth_[a-f0-9]{64})(?![A-Za-z0-9_])/g;

const linearApiKeyDetector: DataTypeDetector = prefixedToken({
  dataTypeId: "linear-api-key",
  prefixes: ["lin_api_", "lin_oauth_"],
  pattern: LINEAR_API_KEY_PATTERN,
  keywords: ["linear", "linear_api_key"],
});

/*
 * JSON web token: three base64url parts, the first a JSON header that
 * names its signing algorithm ({"alg": ...}) and the last a signature.
 * The sample jwt.io and every tutorial sign - John Doe, subject
 * "1234567890" - is a test value.
 */
const JSON_WEB_TOKEN_PATTERN: RegExp =
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,1000}\.[A-Za-z0-9_-]{2,8000}\.[A-Za-z0-9_-]{16,1024}(?![A-Za-z0-9_-])/g;

function decodedJwtPart(token: string, part: number): string | null {
  const parts: Array<string> = token.split(".");
  const bytes: Uint8Array | null =
    parts[part] === undefined ? null : decodeBase64(parts[part]!);

  return bytes ? bytesToText(bytes) : null;
}

export function isJwtWithHeader(token: string): boolean {
  const header: string | null = decodedJwtPart(token, 0);

  if (header === null) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(header);

    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>)["alg"] === "string"
    );
  } catch {
    return false;
  }
}

export function isSampleJwt(token: string): boolean {
  const payload: string | null = decodedJwtPart(token, 1);

  return (
    payload !== null &&
    payload.includes("1234567890") &&
    payload.includes("John Doe")
  );
}

const jsonWebTokenDetector: DataTypeDetector = {
  dataTypeId: "json-web-token",
  quickCheck: containsAny(["eyJ"]),
  pattern: JSON_WEB_TOKEN_PATTERN,
  validate: isJwtWithHeader,
  keywords: [
    "jwt",
    "bearer",
    "token",
    "id_token",
    "access_token",
    "authorization",
  ],
  confidenceWithoutContext: DataConfidence.High,
  specificity: 3,
  isTestValue: (normalized: string): boolean => {
    return normalized.includes("EXAMPLE") || isSampleJwt(normalized);
  },
};

/*
 * Private key: the header line of a PEM private key - RSA, EC, DSA,
 * OpenSSH, encrypted PKCS #8 or plain - of a PGP private key block, of an
 * SSH.com key or of a PuTTY key file, with the key's own text after it
 * (base64, or the Proc-Type / Version / Comment lines some formats start
 * with). A header with nothing after it - "-----BEGIN RSA PRIVATE KEY-----"
 * in the code that reads one - is the name of a key, not a key. Only the
 * header is matched, so the pattern never reads the block.
 */
const PRIVATE_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9-])(?:-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----|---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----|PuTTY-User-Key-File-[1-3]: [a-z0-9-]{3,40})(?=(?:\\r|\\n|[\s"',]){0,8}(?:[A-Za-z0-9+/]{16}|Proc-Type:|Version:|Comment:|Subject:|Encryption:))/g;

// What a key made for a test or a document calls itself: "BEGIN FAKE RSA PRIVATE KEY".
const TEST_KEY_LABELS: ReadonlyArray<string> = [
  "EXAMPLE",
  "FAKE",
  "TEST",
  "DUMMY",
  "SAMPLE",
];

// The words between "BEGIN " and "PRIVATE KEY": "RSA", "OPENSSH", "".
function pemLabel(header: string): string | null {
  if (!header.startsWith("-----BEGIN ")) {
    return null;
  }

  return header.slice("-----BEGIN ".length, header.indexOf("PRIVATE KEY"));
}

const privateKeyDetector: DataTypeDetector = {
  dataTypeId: "private-key",
  quickCheck: containsAny(["PRIVATE KEY", "PuTTY-User-Key-File-"]),
  pattern: PRIVATE_KEY_PATTERN,
  // A PEM label is words of capitals and digits, one space apart.
  validate: (normalized: string): boolean => {
    const label: string | null = pemLabel(normalized);

    return (
      label === null ||
      label === "" ||
      (!label.startsWith(" ") && !label.includes("  ") && label.endsWith(" "))
    );
  },
  keywords: ["private key", "private_key", "privatekey", "pem", "ssh", "pgp"],
  confidenceWithoutContext: DataConfidence.High,
  specificity: 3,
  isTestValue: (normalized: string): boolean => {
    const words: Array<string> = (pemLabel(normalized) || "").split(" ");

    return words.some((word: string) => {
      return TEST_KEY_LABELS.includes(word);
    });
  },
};

/*
 * A URL with a password in it: scheme://user:password@host - a database
 * connection string, a git remote with a token, a proxy. The password may
 * hold ":" and "@" (taken up to the last "@" before the host), must not be
 * empty, and must not be a placeholder ("user:password@", "${DB_PASS}").
 * The URL up to the host is the value; a host of documentation's own
 * domains (example.com) makes it a test value.
 */
const PASSWORD_IN_URL_PATTERN: RegExp =
  /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{1,20}:\/\/[^\s:@/?#'"<>]{0,128}:[^\s/?#'"<>]{1,256}@(?:[A-Za-z0-9._~-]{1,253}|\[[0-9A-Fa-f:.]{2,45}\])(?![A-Za-z0-9._~-])/g;

interface UrlCredentials {
  user: string;
  password: string;
  host: string;
}

function urlCredentials(url: string): UrlCredentials | null {
  const scheme: number = url.indexOf("://");
  const at: number = url.lastIndexOf("@");

  if (scheme < 0 || at < scheme) {
    return null;
  }

  const userInfo: string = url.slice(scheme + 3, at);
  const colon: number = userInfo.indexOf(":");

  if (colon < 0) {
    return null;
  }

  return {
    user: userInfo.slice(0, colon),
    password: userInfo.slice(colon + 1),
    host: url.slice(at + 1),
  };
}

function percentDecoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// The most digits a port has: "host.example:8080@" is a host and its port.
const MAX_PORT_DIGITS: number = 5;

const passwordInUrlDetector: DataTypeDetector = {
  dataTypeId: "password-in-url",
  quickCheck: (text: string): boolean => {
    return text.includes("://") && text.includes("@");
  },
  pattern: PASSWORD_IN_URL_PATTERN,
  validate: (normalized: string): boolean => {
    const credentials: UrlCredentials | null = urlCredentials(normalized);

    if (!credentials || credentials.password.length === 0) {
      return false;
    }

    const password: string = percentDecoded(credentials.password);
    const isPort: boolean =
      credentials.user.includes(".") &&
      password.length <= MAX_PORT_DIGITS &&
      digitsOnly(password) === password;

    return !isPort && !isPlaceholderSecret(password);
  },
  keywords: [
    "url",
    "uri",
    "dsn",
    "connection",
    "database_url",
    "jdbc",
    "postgres",
    "mysql",
    "mongodb",
    "redis",
    "amqp",
  ],
  confidenceWithoutContext: DataConfidence.High,
  specificity: 2,
  isTestValue: (normalized: string): boolean => {
    const credentials: UrlCredentials | null = urlCredentials(normalized);

    return (
      normalized.includes("EXAMPLE") ||
      (credentials !== null && isReservedHost(credentials.host))
    );
  },
};

/*
 * A Password= or Pwd= value in a connection string: ADO.NET, ODBC, JDBC
 * for SQL Server, OLE DB. It counts among the string's other Key=Value
 * pairs only - one ending in ";" just before the key, or one starting just
 * after the value's ";", on the same line - so a statement of code
 * ("config.password = options.password;") is no connection string. The
 * value may be bare, in quotes or in ODBC's braces ({...}). Medium alone,
 * High next to the string's other keys (Server=, Database=, User Id=).
 */
const CONNECTION_STRING_PASSWORD_PATTERN: RegExp =
  /(?<![A-Za-z0-9_.$>-])(?:password|pwd)(?:(?<=;[ \t]{0,4}(?:password|pwd))|(?=[ \t]{0,2}=[^;\r\n]{1,160};[ \t]{0,4}[A-Za-z][A-Za-z0-9 _.-]{0,40}=))[ \t]{0,2}=[ \t]{0,2}(\{[^}\r\n]{1,128}\}|"[^"\r\n]{1,128}"|'[^'\r\n]{1,128}'|[^\s;"'{}][^\s;"']{0,127})(?![^\s;"'])/gi;

const connectionStringPasswordDetector: DataTypeDetector = {
  dataTypeId: "connection-string-password",
  quickCheck: (text: string): boolean => {
    return (
      text.includes(";") && (text.includes("password") || text.includes("pwd"))
    );
  },
  quickCheckLowerCase: true,
  pattern: CONNECTION_STRING_PASSWORD_PATTERN,
  valueGroup: 1,
  // The value without the quotes or braces it is written in.
  normalize: (value: string): string => {
    const first: string = value[0] || "";
    const last: string = value[value.length - 1] || "";
    const wrapped: boolean =
      value.length >= 2 &&
      ((first === "{" && last === "}") ||
        (first === '"' && last === '"') ||
        (first === "'" && last === "'"));

    return (wrapped ? value.slice(1, -1) : value).trim();
  },
  // No placeholder, no path, no code, and not the secret's name.
  validate: (normalized: string): boolean => {
    return (
      normalized.length > 0 &&
      !isPlaceholderSecret(normalized) &&
      !isPathLike(normalized) &&
      !isCodeReference(normalized) &&
      !hasSecretNameWord(normalized.toLowerCase())
    );
  },
  keywords: [
    "server",
    "data source",
    "database",
    "initial catalog",
    "user id",
    "userid",
    "uid",
    "user",
    "host",
    "driver",
    "provider",
    "dsn",
    "connectionstring",
    "connection string",
  ],
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 2,
  isTestValue: (normalized: string): boolean => {
    return normalized.includes("EXAMPLE");
  },
};

/*
 * An HTTP Authorization header's credential, as a request dump, a curl
 * command, a HAR file or a JSON log writes it ("Authorization: ...",
 * "authorization":"...", Header.Set("Authorization", "...")).
 *
 * Basic: valid base64 of "user:password", with a password. The examples
 * of the RFCs and documentation ("Aladdin:open sesame", "user:pass") are
 * test values.
 */
const AUTHORIZATION_BASIC_PATTERN: RegExp =
  /(?<![A-Za-z0-9_])authorization\\?["']?\s{0,4}[:=,]\s{0,4}\\?["']?\s{0,4}basic\s{1,4}([A-Za-z0-9+/]{4,1024}={0,2})(?![A-Za-z0-9+/=])/gi;

const DOCUMENTED_BASIC_CREDENTIALS: ReadonlySet<string> = new Set([
  "aladdin:open sesame",
  "aladdin:opensesame",
  "user:pass",
  "user:password",
  "username:password",
  "admin:admin",
  "admin:password",
  "test:test",
  "foo:bar",
  "demo:demo",
]);

// The "user:password" a Basic credential holds, or null.
export function basicCredentials(value: string): string | null {
  const bytes: Uint8Array | null = decodeBase64(value);

  if (!bytes) {
    return null;
  }

  const text: string = bytesToText(bytes);

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 32 || code === 127) {
      return null;
    }
  }

  const colon: number = text.indexOf(":");

  return colon < 0 || colon === text.length - 1 ? null : text;
}

const authorizationBasicDetector: DataTypeDetector = {
  dataTypeId: "authorization-header",
  quickCheck: containsAny(["authorization"]),
  quickCheckLowerCase: true,
  pattern: AUTHORIZATION_BASIC_PATTERN,
  valueGroup: 1,
  validate: (normalized: string): boolean => {
    const credentials: string | null = basicCredentials(normalized);

    return (
      credentials !== null &&
      !isPlaceholderSecret(credentials.slice(credentials.indexOf(":") + 1))
    );
  },
  keywords: ["authorization", "basic"],
  confidenceWithoutContext: DataConfidence.High,
  specificity: 2,
  isTestValue: (normalized: string): boolean => {
    const credentials: string = basicCredentials(normalized) || "";

    return (
      credentials.includes("EXAMPLE") ||
      DOCUMENTED_BASIC_CREDENTIALS.has(credentials.toLowerCase())
    );
  },
};

/*
 * Bearer (and "Token", as GitHub and Django REST Framework write it): a
 * token of at least 16 characters that is no placeholder and is random
 * enough to be one. A JWT or a provider's token here is also found by its
 * own, more specific detector, which wins.
 */
const AUTHORIZATION_BEARER_PATTERN: RegExp =
  /(?<![A-Za-z0-9_])authorization\\?["']?\s{0,4}[:=,]\s{0,4}\\?["']?\s{0,4}(?:bearer|token)\s{1,4}([A-Za-z0-9._~+/-]{16,4096}={0,2})(?![A-Za-z0-9._~+/=-])/gi;

const BEARER_TOKEN_ENTROPY: number = 3;

const authorizationBearerDetector: DataTypeDetector = {
  dataTypeId: "authorization-header",
  quickCheck: containsAny(["authorization"]),
  quickCheckLowerCase: true,
  pattern: AUTHORIZATION_BEARER_PATTERN,
  valueGroup: 1,
  validate: (normalized: string): boolean => {
    return (
      !isPlaceholderSecret(normalized) &&
      shannonEntropy(normalized) >= BEARER_TOKEN_ENTROPY
    );
  },
  keywords: ["authorization", "bearer"],
  confidenceWithoutContext: DataConfidence.High,
  specificity: 2,
  isTestValue: (normalized: string): boolean => {
    return isExampleToken(normalized) || isSampleJwt(normalized);
  },
};

/*
 * A value assigned to a password, a secret, an API key or an access, auth,
 * refresh or private token, in any of the ways configs and code write
 * one: PASSWORD=..., "api_key": "...", secret: ..., password => '...',
 * token := "...", --password=... The key may be part of a longer name
 * (DB_PASSWORD, stripeApiKey, client_secret, SECRET_KEY) but not of a word
 * (secretary, passwordless). The value sits on the key's own line ("key:"
 * with nothing after it does not take the next line's text), is printable
 * ASCII up to a quote, a space or a delimiter, and is not followed by "("
 * or "[" (code that reads it: getPassword(), env["KEY"]) nor by " =" (a
 * type, not a value: const API_TOKEN: OAuth2Token = ...). The value - only
 * the value - must pass isGenericSecretValue.
 *
 * Medium on its own: the key's name is all the context it has, and it
 * says "a secret" without saying whose. A provider's key assigned this way
 * is also found, at High, by its own detector, which wins.
 */
const GENERIC_SECRET_PATTERN: RegExp =
  /(?<![A-Za-z0-9])[A-Za-z0-9_.-]{0,32}?(?:pass(?:word|wd|phrase)|pwd|secret|api[_.-]?key|(?:access|auth|refresh|private)[_.-]?token)(?:[_.-](?:key|token|value|string|[0-9])|key|token|value|[0-9])?\\?["']?[ \t]{0,4}(?:=>|:=|=|:)[ \t]{0,4}\\?["']?([!#$%*+./0-9:=?@A-Z^_a-z|~-]{8,128})(?![!#$%*+./0-9:=?@A-Z^_a-z|~([\u00a0-\uffff-]|[ \t]{1,4}=)/gi;

/*
 * Secrets documentation hands out as examples: Google Authenticator's
 * sample TOTP seed.
 */
const DOCUMENTED_EXAMPLE_SECRETS: ReadonlySet<string> = new Set([
  "JBSWY3DPEHPK3PXP",
]);

const genericSecretDetector: DataTypeDetector = {
  dataTypeId: "generic-secret",
  quickCheck: containsAny(["pass", "pwd", "secret", "api", "token"]),
  quickCheckLowerCase: true,
  pattern: GENERIC_SECRET_PATTERN,
  valueGroup: 1,
  validate: isGenericSecretValue,
  negativeKeywords: [
    "example",
    "sample",
    "placeholder",
    "dummy",
    "fake",
    "mock",
  ],
  confidenceWithoutContext: DataConfidence.Medium,
  specificity: 1,
  isTestValue: (normalized: string): boolean => {
    return (
      normalized.includes("EXAMPLE") ||
      longestRun(normalized) >= FILLER_RUN ||
      DOCUMENTED_EXAMPLE_SECRETS.has(normalized)
    );
  },
  // A field named password, secret or api_key holding the value alone.
  fieldValuePattern: /^\S{8,128}$/,
};

/*
 * Bitcoin private key in wallet import format: Base58Check of version byte
 * 0x80, the 32-byte key and - for a compressed key - 0x01: 51 characters
 * starting "5", or 52 starting "K" or "L". A testnet key (version 0xEF,
 * "9" or "c") holds no money: a test value, as is the Bitcoin wiki's
 * example key.
 */
const BITCOIN_PRIVATE_KEY_PATTERN: RegExp =
  /(?<![A-Za-z0-9])(?:[59][1-9A-HJ-NP-Za-km-z]{50}|[KLc][1-9A-HJ-NP-Za-km-z]{51})(?![A-Za-z0-9])/g;

const WIF_MAINNET_VERSION: number = 0x80;
const WIF_TESTNET_VERSION: number = 0xef;

// The wiki's "Wallet import format" page converts this key.
const WIF_WIKI_EXAMPLE_KEY: string =
  "0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d";

// The decoded key with its version byte and checksum, or null.
function walletImportBytes(value: string): Uint8Array | null {
  const bytes: Uint8Array | null = base58Decode(value);

  if (
    !bytes ||
    !(bytes.length === 37 || (bytes.length === 38 && bytes[33] === 0x01))
  ) {
    return null;
  }

  return bytes;
}

function hex(bytes: Uint8Array): string {
  let text: string = "";

  for (let index: number = 0; index < bytes.length; index++) {
    text += bytes[index]!.toString(16).padStart(2, "0");
  }

  return text;
}

const bitcoinPrivateKeyDetector: DataTypeDetector = {
  dataTypeId: "bitcoin-private-key",
  pattern: BITCOIN_PRIVATE_KEY_PATTERN,
  validate: (normalized: string): boolean => {
    const bytes: Uint8Array | null = walletImportBytes(normalized);

    return (
      bytes !== null &&
      (bytes[0] === WIF_MAINNET_VERSION || bytes[0] === WIF_TESTNET_VERSION) &&
      base58Check(normalized)
    );
  },
  keywords: ["bitcoin", "btc", "wif", "private key", "wallet"],
  confidenceWithoutContext: DataConfidence.High,
  specificity: 3,
  isTestValue: (normalized: string): boolean => {
    const bytes: Uint8Array | null = walletImportBytes(normalized);

    return (
      bytes !== null &&
      (bytes[0] === WIF_TESTNET_VERSION ||
        hex(bytes.slice(1, 33)) === WIF_WIKI_EXAMPLE_KEY)
    );
  },
};

export const SECRET_DETECTORS: ReadonlyArray<DataTypeDetector> = [
  awsAccessKeyIdDetector,
  awsSecretAccessKeyDetector,
  googleApiKeyDetector,
  googleServiceAccountKeyDetector,
  googleOAuthClientSecretDetector,
  azureStorageAccountKeyDetector,
  azureSasTokenDetector,
  azureClientSecretDetector,
  githubTokenDetector,
  gitlabTokenDetector,
  slackTokenDetector,
  slackWebhookUrlDetector,
  stripeSecretKeyDetector,
  twilioApiKeyDetector,
  sendgridApiKeyDetector,
  mailgunApiKeyDetector,
  mailchimpApiKeyDetector,
  openaiApiKeyDetector,
  anthropicApiKeyDetector,
  huggingfaceTokenDetector,
  npmTokenDetector,
  pypiTokenDetector,
  dockerHubTokenDetector,
  shopifyTokenDetector,
  squareTokenDetector,
  braintreeAccessTokenDetector,
  digitaloceanTokenDetector,
  newRelicApiKeyDetector,
  datadogApiKeyDetector,
  vaultTokenDetector,
  terraformCloudTokenDetector,
  atlassianApiTokenDetector,
  linearApiKeyDetector,
  jsonWebTokenDetector,
  privateKeyDetector,
  passwordInUrlDetector,
  connectionStringPasswordDetector,
  authorizationBasicDetector,
  authorizationBearerDetector,
  genericSecretDetector,
  bitcoinPrivateKeyDetector,
];

export default SECRET_DETECTORS;
