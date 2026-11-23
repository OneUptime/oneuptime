import DataCategory from "../../../../../Types/DataSecurity/DataCategory";
import DataSensitivity, {
  DATA_SENSITIVITY_RANK,
} from "../../../../../Types/DataSecurity/DataSensitivity";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../../../../Types/DataSecurity/DataTypeCatalog";
import {
  getFieldNameWords,
  splitFieldName,
} from "../../../../../Utils/DataSecurity/FieldNameHints";

/*
 * WHAT A NAME IN CODE SAYS IT HOLDS (#10376).
 *
 * Data Security's catalog names each kind of data by the field names that
 * hint at it (DataTypeCatalog.nameHints, read by FieldNameHints): a column
 * `customer_email` holds an email address. Code is full of names that only
 * look like that - `emailTemplate`, `passwordPolicy`, `tokenCount`,
 * `isEmailVerified` - and a pull request's comment that calls each of them
 * a leak would be turned off within a week. So a name in code is read
 * stricter than a column's:
 *
 *   - its HEAD names the data: the hint's words come last, or followed
 *     only by words that keep it the same thing (`emailAddress`,
 *     `phoneNumber`, `passwordPlain`, `ssnValue`). `emailVerified`,
 *     `passwordLength` and `tokenCount` name something else;
 *   - nothing before it says it was changed or is about it rather than it:
 *     `hashedPassword`, `maskedEmail`, `hasEmail`, `isPasswordSet`,
 *     `numEmails`;
 *   - a hint too short or too common in code to mean the data is left out
 *     of code alone (CODE_AMBIGUOUS_HINTS): `ip`, `address`, `run`, `sin`,
 *     `condition`, `treatment`, `expiry`... - each a field name Data
 *     Security still reads in a store, where it means the data;
 *   - only kinds a leak of which is worth a point: every Restricted kind,
 *     and the Confidential kinds that are personal data people regret
 *     logging (CODE_CONFIDENTIAL_TYPE_IDS). An IP address or a user name
 *     in a log is how most services are run.
 *
 * And a few names of secrets code uses that a store's field rarely does
 * (CODE_SECRET_HINTS): a `token`, a `refreshToken`, `credentials`, a
 * `cookie`. The project's own data types are read by their own hints, the
 * same way.
 *
 * Pure: the catalog and the project's types are all it reads.
 */

// A kind of data a name points at.
export interface NamedDataType {
  // A built-in type's id, or "custom:<row id>" for one of the project's.
  id: string;
  name: string;
  sensitivity: DataSensitivity;
  category: DataCategory | null;
}

// One of the project's own data types, as the rules read it.
export interface ProjectDataTypeHints {
  id: string;
  name: string;
  sensitivity: DataSensitivity;
  category?: DataCategory | null | undefined;
  nameHints: ReadonlyArray<string>;
}

/*
 * The Confidential kinds a name in code is a point for: personal data
 * that says who someone is and how to reach them. The rest - an IP or MAC
 * address, an advertising id, a location, a user name, a gender - are left
 * to the scans, which read the values.
 */
export const CODE_CONFIDENTIAL_TYPE_IDS: ReadonlySet<string> = new Set<string>(
  [
    "email-address",
    "phone-number",
    "person-name",
    "postal-address",
    "date-of-birth",
  ],
);

/*
 * Hints that, in code, name something else as often as the data: a word
 * of the language, of a framework, or of the code's own business. Matched
 * as the hint is written in the catalog.
 */
export const CODE_AMBIGUOUS_HINTS: ReadonlySet<string> = new Set<string>([
  // Contact and identity.
  "cell",
  "tel",
  "mobile",
  "address",
  "addr",
  "fname",
  "lname",
  // Government ids that are words, or a framework's names.
  "run",
  "rut",
  "sin",
  "cf",
  "pan",
  "inn",
  "nie",
  "nik",
  "fin",
  "rfc",
  "cnp",
  "egn",
  "oib",
  "cpr",
  "pps",
  "eid",
  "avs",
  "ird",
  "secu",
  "rrn",
  "id number",
  "id card",
  "resident id",
  "citizen id",
  "license number",
  "licence number",
  /*
   * One country's id by its hint, though every country has one: code's
   * `taxId` is no more Germany's than its `nationalId` is Saudi Arabia's.
   */
  "tax id",
  "national id",
  "national number",
  // Financial.
  "account number",
  "acct number",
  "acct no",
  "security code",
  "expiry",
  "expiration",
  "wallet",
  // Health.
  "member id",
  "subscriber id",
  "policy number",
  "dx",
  "icd",
  "diagnosis",
  "condition",
  "treatment",
  "symptom",
  "symptoms",
  "disease",
  "medication",
  "prescription",
  "allergy",
  "allergies",
  "disability",
  "pregnancy",
  // Special categories, named after common words.
  "race",
  "religious",
  "faith",
  "belief",
  "orientation",
  "political",
  "union member",
  "iris",
  "retina",
  "snp",
  "genetic",
  "fingerprint",
  "conviction",
  "convictions",
  "offence",
  "offense",
]);

// Names of secrets code uses, as the catalog's generic secret.
const CODE_SECRET_HINTS: ReadonlyArray<string> = [
  "token",
  "refresh token",
  "session token",
  "bearer token",
  "reset token",
  "csrf token",
  "api token",
  "credentials",
  "credential",
  "passphrase",
  "pass phrase",
  "passcode",
  "otp",
  "one time password",
  "recovery code",
  "recovery codes",
  "backup codes",
  "mfa secret",
  "totp secret",
  "signing key",
  "secret key",
  "encryption key",
  "master key",
  "cookie",
  "cookies",
  "session cookie",
];

const GENERIC_SECRET_TYPE_ID: string = "generic-secret";

// More names of a card's security code, a column name's as much as code's.
const CODE_CARD_SECURITY_CODE_HINTS: ReadonlyArray<string> = [
  "card security code",
  "cvv2",
];

const CARD_SECURITY_CODE_TYPE_ID: string = "card-verification-code";

/*
 * Words that may follow a hint and leave it naming the same data: a value
 * of it, a list of it, its number, its header.
 */
const SAME_THING_AFTER: ReadonlySet<string> = new Set<string>([
  "value",
  "values",
  "val",
  "raw",
  "plain",
  "plaintext",
  "clear",
  "cleartext",
  "text",
  "str",
  "string",
  "input",
  "param",
  "field",
  "number",
  "num",
  "no",
  "nr",
  "list",
  "arr",
  "array",
  "data",
  "header",
  "headers",
]);

/*
 * Words before a hint that make the name about something else: the data
 * changed into something that is no longer it (hashed, masked, encrypted),
 * a question about it (has, is, should), or a count of it.
 */
const SOMETHING_ELSE_BEFORE: ReadonlySet<string> = new Set<string>([
  "hash",
  "hashed",
  "sha",
  "sha1",
  "sha256",
  "sha512",
  "md5",
  "hmac",
  "digest",
  "encrypted",
  "enc",
  "crypted",
  "bcrypt",
  "scrypt",
  "argon",
  "argon2",
  "pbkdf2",
  "masked",
  "redacted",
  "obfuscated",
  "anonymized",
  "anonymised",
  "pseudonymized",
  "pseudonymised",
  "tokenized",
  "tokenised",
  "salted",
  "salt",
  "has",
  "is",
  "should",
  "can",
  "needs",
  "need",
  "require",
  "requires",
  "required",
  "valid",
  "invalid",
  "num",
  "count",
  "total",
  "max",
  "min",
  "no",
]);

/*
 * Words before a lone "token" that make it no secret: a page of results,
 * a cancellation, a count of a model's tokens, a design system's.
 */
const TOKEN_NOT_SECRET_BEFORE: ReadonlySet<string> = new Set<string>([
  "page",
  "next",
  "prev",
  "previous",
  "continuation",
  "cancel",
  "cancellation",
  "sync",
  "resume",
  "pagination",
  "cursor",
  "prompt",
  "completion",
  "input",
  "output",
  "design",
  "lexer",
  "parse",
  "parser",
  "css",
  "stop",
  "special",
  "padding",
  "pad",
  "eos",
  "bos",
  "unk",
  "start",
  "end",
  "first",
  "last",
  "word",
  "chunk",
  "stream",
  "usage",
  "budget",
  "limit",
]);

// What several kinds of a category one hint names are called together.
const CATEGORY_GROUP_NAMES: Readonly<Record<DataCategory, string>> = {
  [DataCategory.ContactAndIdentity]: "Personal identifier",
  [DataCategory.GovernmentId]: "Government ID",
  [DataCategory.Financial]: "Financial account number",
  [DataCategory.Health]: "Health record number",
  [DataCategory.SecretsAndCredentials]: "Secret",
  [DataCategory.SpecialCategory]: "Special category data",
  [DataCategory.BusinessConfidential]: "Confidential document",
};

// The longest name read: longer is a sentence, not a name.
const MAX_NAME_LENGTH: number = 120;

interface CompiledHint {
  type: NamedDataType;
  words: ReadonlyArray<string>;
  // A lone "token" is a secret only under its own rule.
  isLoneToken: boolean;
}

function toNamedType(info: DataTypeInfo): NamedDataType {
  return {
    id: info.id,
    name: info.name,
    sensitivity: info.sensitivity,
    category: info.category,
  };
}

// Whether a built-in kind of data makes a point when code names it.
export function isCodeLeakType(info: DataTypeInfo): boolean {
  if (info.sensitivity === DataSensitivity.Restricted) {
    return true;
  }

  return (
    info.sensitivity === DataSensitivity.Confidential &&
    CODE_CONFIDENTIAL_TYPE_IDS.has(info.id)
  );
}

let builtInHints: Array<CompiledHint> | null = null;

function getBuiltInHints(): Array<CompiledHint> {
  if (builtInHints) {
    return builtInHints;
  }

  const hints: Array<CompiledHint> = [];

  for (const info of DATA_TYPE_CATALOG) {
    if (!isCodeLeakType(info)) {
      continue;
    }

    for (const hint of info.nameHints) {
      if (CODE_AMBIGUOUS_HINTS.has(hint)) {
        continue;
      }

      hints.push({
        type: toNamedType(info),
        words: hint.split(" "),
        isLoneToken: false,
      });
    }
  }

  const genericSecret: DataTypeInfo | undefined = DATA_TYPE_CATALOG.find(
    (info: DataTypeInfo): boolean => {
      return info.id === GENERIC_SECRET_TYPE_ID;
    },
  );

  if (genericSecret) {
    for (const hint of CODE_SECRET_HINTS) {
      hints.push({
        type: toNamedType(genericSecret),
        words: hint.split(" "),
        isLoneToken: hint === "token",
      });
    }
  }

  const cardSecurityCode: DataTypeInfo | undefined = DATA_TYPE_CATALOG.find(
    (info: DataTypeInfo): boolean => {
      return info.id === CARD_SECURITY_CODE_TYPE_ID;
    },
  );

  if (cardSecurityCode) {
    for (const hint of CODE_CARD_SECURITY_CODE_HINTS) {
      hints.push({
        type: toNamedType(cardSecurityCode),
        words: hint.split(" "),
        isLoneToken: false,
      });
    }
  }

  builtInHints = hints;

  return hints;
}

// Whether `word` is `hintWord`, or its plural.
function isWordOrPlural(
  word: string,
  hintWord: string,
  allowsPlural: boolean,
): boolean {
  if (word === hintWord) {
    return true;
  }

  return (
    allowsPlural &&
    !hintWord.endsWith("s") &&
    (word === `${hintWord}s` || word === `${hintWord}es`)
  );
}

/*
 * Whether `hint` is the head of `words`: its words in order, the last of
 * them perhaps a plural, followed only by words that keep it the same
 * thing, with nothing before it that makes it something else.
 */
export function isHeadOf(
  words: ReadonlyArray<string>,
  hint: ReadonlyArray<string>,
  options: { allowsPlural: boolean } = { allowsPlural: true },
): boolean {
  if (hint.length === 0 || hint.length > words.length) {
    return false;
  }

  for (let start: number = 0; start + hint.length <= words.length; start++) {
    let isRun: boolean = true;

    for (let offset: number = 0; offset < hint.length; offset++) {
      const isLast: boolean = offset === hint.length - 1;
      const word: string = words[start + offset]!;
      const hintWord: string = hint[offset]!;

      if (
        isLast
          ? !isWordOrPlural(word, hintWord, options.allowsPlural)
          : word !== hintWord
      ) {
        isRun = false;
        break;
      }
    }

    if (!isRun) {
      continue;
    }

    const before: ReadonlyArray<string> = words.slice(0, start);
    const after: ReadonlyArray<string> = words.slice(start + hint.length);

    if (
      after.every((word: string): boolean => {
        return SAME_THING_AFTER.has(word);
      }) &&
      !before.some((word: string): boolean => {
        return SOMETHING_ELSE_BEFORE.has(word);
      })
    ) {
      return true;
    }
  }

  return false;
}

// A lone "token" names a secret: the last word, and no page or count of one.
function isSecretToken(words: ReadonlyArray<string>): boolean {
  const last: string | undefined = words[words.length - 1];

  if (last !== "token") {
    return false;
  }

  const before: ReadonlyArray<string> = words.slice(0, -1);

  return !before.some((word: string): boolean => {
    return (
      TOKEN_NOT_SECRET_BEFORE.has(word) || SOMETHING_ELSE_BEFORE.has(word)
    );
  });
}

function rankOf(type: NamedDataType): number {
  return DATA_SENSITIVITY_RANK[type.sensitivity] ?? 0;
}

/*
 * The kinds of data a name points at, the most sensitive first - none for
 * most names. Reads the catalog's hints and the project's own.
 */
export class SensitiveNameMatcher {
  private readonly projectHints: Array<CompiledHint>;

  public constructor(projectTypes: ReadonlyArray<ProjectDataTypeHints> = []) {
    this.projectHints = [];

    for (const type of projectTypes) {
      if (
        type.sensitivity !== DataSensitivity.Restricted &&
        type.sensitivity !== DataSensitivity.Confidential
      ) {
        continue;
      }

      for (const hint of type.nameHints || []) {
        const words: Array<string> = splitFieldName(hint || "");

        if (words.length === 0) {
          continue;
        }

        this.projectHints.push({
          type: {
            id: type.id,
            name: type.name,
            sensitivity: type.sensitivity,
            category: type.category || null,
          },
          words,
          isLoneToken: false,
        });
      }
    }
  }

  // The words a name is read as: its last part, as FieldNameHints reads one.
  public static wordsOf(name: string): Array<string> {
    if (!name || name.length > MAX_NAME_LENGTH) {
      return [];
    }

    return getFieldNameWords(name);
  }

  public match(name: string): Array<NamedDataType> {
    const words: Array<string> = SensitiveNameMatcher.wordsOf(name);

    if (words.length === 0) {
      return [];
    }

    // The kinds each hint that matched points at, by the hint's words.
    const byHint: Map<string, Array<NamedDataType>> = new Map<
      string,
      Array<NamedDataType>
    >();

    for (const hint of [...this.projectHints, ...getBuiltInHints()]) {
      const isMatch: boolean = hint.isLoneToken
        ? isSecretToken(words)
        : isHeadOf(words, hint.words);

      if (!isMatch) {
        continue;
      }

      const key: string = hint.words.join(" ");
      const types: Array<NamedDataType> = byHint.get(key) || [];

      if (
        !types.some((type: NamedDataType): boolean => {
          return type.id === hint.type.id;
        })
      ) {
        types.push(hint.type);
      }

      byHint.set(key, types);
    }

    const found: Map<string, NamedDataType> = new Map<string, NamedDataType>();
    let hasSecret: boolean = false;

    for (const types of byHint.values()) {
      const named: NamedDataType = SensitiveNameMatcher.oneNameFor(types);
      const isSecret: boolean =
        named.category === DataCategory.SecretsAndCredentials;

      // A name of a secret is one secret, however many hints name it.
      if (found.has(named.id) || (isSecret && hasSecret)) {
        continue;
      }

      hasSecret = hasSecret || isSecret;
      found.set(named.id, named);
    }

    return Array.from(found.values()).sort(
      (a: NamedDataType, b: NamedDataType): number => {
        return rankOf(b) - rankOf(a);
      },
    );
  }

  /*
   * The kind one hint names. A hint several kinds share - a `medicare`, a
   * `personnummer`, an `nric`, an `accessToken` - names none of them: the
   * point is named by what they are together ("Government ID",
   * CATEGORY_GROUP_NAMES), as sensitive as the most sensitive of them.
   */
  private static oneNameFor(types: Array<NamedDataType>): NamedDataType {
    const first: NamedDataType = types[0]!;

    if (types.length === 1) {
      return first;
    }

    const categories: Set<string> = new Set<string>(
      types.map((type: NamedDataType): string => {
        return type.category || "";
      }),
    );

    if (categories.size !== 1 || !first.category) {
      return first;
    }

    return {
      id: first.id,
      name: CATEGORY_GROUP_NAMES[first.category] || first.name,
      sensitivity: highestSensitivity(types),
      category: first.category,
    };
  }
}

// The most sensitive of the kinds a point names.
export function highestSensitivity(
  types: ReadonlyArray<NamedDataType>,
): DataSensitivity {
  let highest: DataSensitivity = DataSensitivity.Public;

  for (const type of types) {
    if (rankOf(type) > DATA_SENSITIVITY_RANK[highest]) {
      highest = type.sensitivity;
    }
  }

  return highest;
}

// Whether one of the kinds is a secret: a password, a key, a token.
export function isAnySecret(types: ReadonlyArray<NamedDataType>): boolean {
  return types.some((type: NamedDataType): boolean => {
    return type.category === DataCategory.SecretsAndCredentials;
  });
}
