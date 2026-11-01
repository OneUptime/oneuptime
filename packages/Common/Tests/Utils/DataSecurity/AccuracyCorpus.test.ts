import { describe, expect, test } from "@jest/globals";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../../Types/DataSecurity/DataTypeCatalog";
import { DataTypeDetector } from "../../../Utils/DataSecurity/Detector";
import { getBuiltInDetectorsOf } from "../../../Utils/DataSecurity/Detectors/Index";
import { sha256 } from "../../../Utils/DataSecurity/Sha256";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";
import CharacterSet from "../../../Utils/LinearRegExp/CharacterSet";
import { parsePattern } from "../../../Utils/LinearRegExp/Parser";
import { SyntaxNode } from "../../../Utils/LinearRegExp/Syntax";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * HOW OFTEN THE SCANNER IS RIGHT: A LABELLED CORPUS OF EVERY TYPE.
 *
 * For every built-in type found by value, two values in realistic text (a
 * log line and a JSON document) and two near misses: the same text with the
 * value a check digit off, a character longer, inside a longer token, or
 * without the words it needs. Every built-in detector then scans every
 * text, and each High or Medium finding is right only when it is the
 * labelled type on the labelled value. Per type, precision - right findings
 * over all High and Medium findings of that type - must be at least 0.95;
 * over the corpus, recall - labelled values found as their type - at least
 * 0.9.
 *
 * Values are made here, never copied from anyone: drawn at random from the
 * shape of a type's own detector, with the check characters its validator
 * asks for found by trying them, and the structured ones (IBANs, Bitcoin
 * keys, JWTs, connection strings...) put together from random parts. No
 * secret is written in this file; each is assembled when the test runs, so
 * no scanner reading the source sees one.
 */

interface Labelled {
  dataTypeId: string;
  text: string;
  value: string;
}

interface CorpusEntry {
  positives: Array<Labelled>;
  nearMisses: Array<Labelled>;
}

const random: SeededRandom = seededRandom(20_261_027);

const DIGITS: string = "0123456789";
const UPPER: string = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER: string = "abcdefghijklmnopqrstuvwxyz";
const ALNUM: string = UPPER + LOWER + DIGITS;
const URL_SAFE: string = ALNUM + "-_";
const BASE64_ALPHABET: string = ALNUM + "+/";
const HEX: string = "0123456789abcdef";
const ALPHANUMERIC_CHARACTER: RegExp = /[A-Za-z0-9]/;
const KEYWORD_OF_WORDS: RegExp = /^[a-z][a-z ]*[a-z]$/;
const BASE58_ALPHABET: string =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function fake(alphabet: string, length: number): string {
  let text: string = "";

  for (let index: number = 0; index < length; index++) {
    text += alphabet[random(alphabet.length)];
  }

  return text;
}

function randomBytes(length: number): Uint8Array {
  const bytes: Uint8Array = new Uint8Array(length);

  for (let index: number = 0; index < length; index++) {
    bytes[index] = random(256);
  }

  return bytes;
}

function base64Url(text: string): string {
  return btoa(text)
    .split("+")
    .join("-")
    .split("/")
    .join("_")
    .split("=")
    .join("");
}

function base58(bytes: Uint8Array): string {
  const digits: Array<number> = [];

  for (const byte of bytes) {
    let carry: number = byte;

    for (let index: number = 0; index < digits.length; index++) {
      carry += digits[index]! * 256;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }

    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let text: string = "";

  for (
    let index: number = 0;
    index < bytes.length && bytes[index] === 0;
    index++
  ) {
    text += "1";
  }

  for (let index: number = digits.length - 1; index >= 0; index--) {
    text += BASE58_ALPHABET[digits[index]!];
  }

  return text;
}

// Base58Check: the payload and the first four bytes of its double SHA-256.
function base58Check(payload: Uint8Array): string {
  const checksum: Uint8Array = sha256(sha256(payload)).slice(0, 4);

  return base58(
    Uint8Array.from([...Array.from(payload), ...Array.from(checksum)]),
  );
}

// A country's IBAN with the check digits ISO 13616 gives its BBAN.
function iban(country: string, bban: string): string {
  let digits: string = "";

  for (const character of bban + country + "00") {
    const code: number = character.charCodeAt(0);

    digits += code >= 65 && code <= 90 ? String(code - 55) : character;
  }

  let remainder: number = 0;

  for (const digit of digits) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }

  return country + String(98 - remainder).padStart(2, "0") + bban;
}

function percentEncoded(base64: string): string {
  return base64
    .split("+")
    .join("%2B")
    .split("/")
    .join("%2F")
    .split("=")
    .join("%3D");
}

function logLine(key: string, value: string): string {
  return `2026-10-27T10:15:02Z INFO record updated ${key}=${value} status=ok`;
}

function jsonDocument(key: string, value: string): string {
  return `{"${key}": "${value}", "batch": "nightly"}`;
}

function labelled(dataTypeId: string, text: string, value: string): Labelled {
  return { dataTypeId, text, value };
}

/*
 * A random string of the shape a pattern matches. Look-arounds and
 * assertions add nothing - the detector itself then says whether the
 * string, in its text, is the thing.
 */
const PREFERRED_CHARACTERS: string = ALNUM;

function charactersOf(set: CharacterSet, negate: boolean): Array<string> {
  const has: (code: number) => boolean = (code: number): boolean => {
    return set.has(code) !== negate;
  };
  const preferred: Array<string> = PREFERRED_CHARACTERS.split("").filter(
    (character: string) => {
      return has(character.charCodeAt(0));
    },
  );

  if (preferred.length > 0) {
    return preferred;
  }

  const printable: Array<string> = [];

  for (let code: number = 0x20; code < 0x7f; code++) {
    if (has(code)) {
      printable.push(String.fromCharCode(code));
    }
  }

  return printable;
}

function draw(node: SyntaxNode): string {
  switch (node.kind) {
    case "Empty":
    case "Assertion":
    case "Lookaround":
      return "";
    case "Character":
      return String.fromCharCode(node.codeUnit);
    case "Set": {
      const characters: Array<string> = charactersOf(node.set, node.negate);

      return characters.length > 0
        ? characters[random(characters.length)]!
        : "";
    }
    case "Group":
      return draw(node.body);
    case "Repeat": {
      const most: number = Number.isFinite(node.max) ? node.max : node.min + 8;
      const times: number = node.min + random(most - node.min + 1);
      let text: string = "";

      for (let index: number = 0; index < times; index++) {
        text += draw(node.body);
      }

      return text;
    }
    case "Alternation":
      return draw(node.options[random(node.options.length)]!);
    case "Sequence":
      return node.items.map(draw).join("");
  }

  return "";
}

// Whether the type's own detectors find exactly this value, sure enough to count.
function isFoundAlone(
  dataTypeId: string,
  text: string,
  value: string,
): boolean {
  const start: number = text.indexOf(value);

  return findSensitiveValues(text, {
    detectors: getBuiltInDetectorsOf(dataTypeId),
  }).some((match: TextMatch) => {
    return (
      match.dataTypeId === dataTypeId &&
      match.start <= start &&
      match.end >= start + value.length &&
      match.confidence !== DataConfidence.Low &&
      !match.isTestValue
    );
  });
}

// Whether the type's own detectors find anything at all in the text.
function isRefusedAlone(dataTypeId: string, text: string): boolean {
  return findSensitiveValues(text, {
    detectors: getBuiltInDetectorsOf(dataTypeId),
  }).every((match: TextMatch) => {
    return match.dataTypeId !== dataTypeId || match.isTestValue;
  });
}

function classOf(character: string): string {
  if (DIGITS.includes(character)) {
    return DIGITS;
  }

  return UPPER.includes(character) ? UPPER : LOWER;
}

// The value, and the value with its last one or two characters tried in turn.
function withCheckCharacters(value: string): Array<string> {
  const places: Array<number> = [];

  for (
    let index: number = value.length - 1;
    index >= 0 && places.length < 2;
    index--
  ) {
    if (ALPHANUMERIC_CHARACTER.test(value[index]!)) {
      places.push(index);
    }
  }

  const tried: Array<string> = [value];
  const last: number | undefined = places[0];
  const before: number | undefined = places[1];

  if (last === undefined) {
    return tried;
  }

  for (const character of classOf(value[last]!)) {
    tried.push(value.slice(0, last) + character + value.slice(last + 1));
  }

  if (
    before !== undefined &&
    DIGITS.includes(value[last]!) &&
    DIGITS.includes(value[before]!)
  ) {
    for (const first of DIGITS) {
      for (const second of DIGITS) {
        const characters: Array<string> = value.split("");

        characters[before] = first;
        characters[last] = second;
        tried.push(characters.join(""));
      }
    }
  }

  return tried;
}

// A keyword its detectors look for, written as words; "value" for one with none.
const KEYWORD_OVERRIDES: Readonly<Record<string, string>> = {
  // Its pattern needs one of these words right before the date.
  "card-expiration-date": "expiry",
};

function keywordOf(dataTypeId: string): string {
  if (KEYWORD_OVERRIDES[dataTypeId]) {
    return KEYWORD_OVERRIDES[dataTypeId]!;
  }

  for (const detector of getBuiltInDetectorsOf(dataTypeId)) {
    for (const keyword of detector.keywords || []) {
      if (KEYWORD_OF_WORDS.test(keyword)) {
        return keyword;
      }
    }
  }

  return "value";
}

const TEXT_FORMS: Array<(key: string, value: string) => string> = [
  logLine,
  jsonDocument,
];

// Two values of the type drawn from its detectors' shapes.
function drawnPositives(info: DataTypeInfo): Array<Labelled> {
  const keyword: string = keywordOf(info.id);
  const shapes: Array<SyntaxNode> = [];

  for (const detector of getBuiltInDetectorsOf(info.id)) {
    try {
      shapes.push(
        parsePattern(detector.pattern.source, {
          ignoreCase: detector.pattern.ignoreCase,
          multiline: detector.pattern.multiline,
          dotAll: detector.pattern.dotAll,
        }).root,
      );
    } catch {
      // A back-reference LinearRegExp cannot read: the other shapes serve.
    }
  }

  const positives: Array<Labelled> = [];

  for (
    let attempt: number = 0;
    attempt < 400 && positives.length < 2 && shapes.length > 0;
    attempt++
  ) {
    const drawn: string = draw(shapes[random(shapes.length)]!);
    const form: (key: string, value: string) => string =
      TEXT_FORMS[positives.length]!;

    if (drawn.length === 0) {
      continue;
    }

    for (const value of withCheckCharacters(drawn)) {
      const text: string = form(keyword, value);

      if (
        !positives.some((positive: Labelled) => {
          return positive.value === value;
        }) &&
        isFoundAlone(info.id, text, value)
      ) {
        positives.push(labelled(info.id, text, value));
        break;
      }
    }
  }

  return positives;
}

// The next character of the same kind, so a check digit is off by one.
function nextOfClass(character: string, step: number): string {
  const kind: string = classOf(character);

  return kind[(kind.indexOf(character) + step) % kind.length]!;
}

/*
 * Near misses a type's checks are about, tried before the general ones:
 * an email on an image asset's "domain", a coordinate too imprecise to
 * find a building, a webhook missing its secret.
 */
const NEAR_MISSES_OF: Readonly<
  Record<string, (value: string) => Array<string>>
> = {
  "email-address": (value: string): Array<string> => {
    return [
      value.replace(/\.[A-Za-z]{2,24}$/, ".png"),
      value[0] + ".." + value.slice(1),
    ];
  },
  geolocation: (value: string): Array<string> => {
    return [
      value.replace(/\.([0-9]{2})[0-9]{2,8}/g, ".$1"),
      value.replace(/^-?[0-9]{1,3}/, "91"),
    ];
  },
  "slack-webhook-url": (value: string): Array<string> => {
    return [
      value.replace(/\/[A-Za-z0-9]{20,120}$/, "/" + "x".repeat(8)),
      value.replace("hooks.slack.com", "hooks.slack.example"),
    ];
  },
};

/*
 * Near misses of a drawn value, in a fixed order: the type's own, a check
 * character off, one character longer, inside a longer token, one shorter,
 * and - for a type that needs them - without its words. The first its own
 * detectors refuse is kept for each value.
 */
function drawnNearMisses(
  info: DataTypeInfo,
  positives: Array<Labelled>,
): Array<Labelled> {
  const nearMisses: Array<Labelled> = [];
  const keyword: string = keywordOf(info.id);
  const needsWords: boolean = getBuiltInDetectorsOf(info.id).some(
    (detector: DataTypeDetector) => {
      return Boolean(detector.requiresContext);
    },
  );

  positives.forEach((positive: Labelled, index: number) => {
    const form: (key: string, value: string) => string = TEXT_FORMS[index]!;
    const value: string = positive.value;
    const lastPlace: number = value.search(/[A-Za-z0-9][^A-Za-z0-9]*$/);
    const last: string = value[lastPlace] || "0";
    const candidates: Array<string> = (
      NEAR_MISSES_OF[info.id]?.(value) || []
    ).map((nearMiss: string) => {
      return form(keyword, nearMiss);
    });

    for (let step: number = 1; step < classOf(last).length; step++) {
      candidates.push(
        form(
          keyword,
          value.slice(0, lastPlace) +
            nextOfClass(last, step) +
            value.slice(lastPlace + 1),
        ),
      );
    }

    candidates.push(form(keyword, value + nextOfClass(last, 3)));
    candidates.push(form(keyword, nextOfClass(value[0] || "0", 5) + value));
    candidates.push(
      form(keyword, value.slice(0, lastPlace) + value.slice(lastPlace + 1)),
    );

    if (needsWords) {
      candidates.push(form("ref", value));
    }

    const refused: string | undefined = candidates.find((text: string) => {
      return isRefusedAlone(info.id, text);
    });

    if (refused !== undefined) {
      nearMisses.push(labelled(info.id, refused, ""));
    }
  });

  return nearMisses;
}

/*
 * The types whose values have structure a random draw cannot hit - a
 * checksum over the whole value, JSON inside base64 - put together from
 * random parts, with near misses that break exactly that structure.
 */
const BUILT: Readonly<Record<string, () => CorpusEntry>> = {
  "credit-card-number": (): CorpusEntry => {
    const card: (prefix: string) => string = (prefix: string): string => {
      const digits: string = prefix + fake(DIGITS, 15 - prefix.length);

      for (const check of DIGITS) {
        const number: string = digits + check;
        let sum: number = 0;

        for (let index: number = 0; index < 16; index++) {
          let digit: number = Number(number[15 - index]);

          if (index % 2 === 1) {
            digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
          }

          sum += digit;
        }

        if (sum % 10 === 0) {
          return number;
        }
      }

      return digits + "0";
    };
    const visa: string = card("4");
    const mastercard: string = card("53");
    const grouped: string = visa.replace(/([0-9]{4})(?=[0-9])/g, "$1 ");
    const off: string = visa.slice(0, 15) + String((Number(visa[15]) + 1) % 10);

    return {
      positives: [
        labelled(
          "credit-card-number",
          `2026-10-27T10:15:02Z INFO charged card ${grouped} amount=42.50`,
          grouped,
        ),
        labelled(
          "credit-card-number",
          jsonDocument("pan", mastercard),
          mastercard,
        ),
      ],
      nearMisses: [
        labelled(
          "credit-card-number",
          `2026-10-27T10:15:02Z INFO charged card ${off} amount=42.50`,
          "",
        ),
        labelled(
          "credit-card-number",
          jsonDocument("pan", "9" + mastercard),
          "",
        ),
      ],
    };
  },
  iban: (): CorpusEntry => {
    const german: string = iban("DE", fake(DIGITS, 18));
    const british: string = iban("GB", fake(UPPER, 4) + fake(DIGITS, 14));
    const offCheck: string =
      german.slice(0, 2) +
      String((Number(german.slice(2, 4)) + 1) % 100).padStart(2, "0") +
      german.slice(4);

    return {
      positives: [
        labelled("iban", logLine("iban", german), german),
        labelled("iban", jsonDocument("iban", british), british),
      ],
      nearMisses: [
        labelled("iban", logLine("iban", offCheck), ""),
        labelled("iban", jsonDocument("iban", british.slice(0, -1)), ""),
      ],
    };
  },
  "bitcoin-address": (): CorpusEntry => {
    const legacy: string = base58Check(
      Uint8Array.from([0, ...Array.from(randomBytes(20))]),
    );
    const script: string = base58Check(
      Uint8Array.from([5, ...Array.from(randomBytes(20))]),
    );
    const middle: number = Math.floor(legacy.length / 2);
    const corrupted: string =
      legacy.slice(0, middle) +
      (legacy[middle] === "z" ? "y" : "z") +
      legacy.slice(middle + 1);

    return {
      positives: [
        labelled("bitcoin-address", logLine("btc", legacy), legacy),
        labelled("bitcoin-address", jsonDocument("wallet", script), script),
      ],
      nearMisses: [
        labelled("bitcoin-address", logLine("btc", corrupted), ""),
        labelled("bitcoin-address", jsonDocument("wallet", "x" + script), ""),
      ],
    };
  },
  "google-service-account-key": (): CorpusEntry => {
    const keyId: string = fake(HEX, 40);
    const keyFile: (id: string) => string = (id: string): string => {
      return JSON.stringify({
        type: "service_account",
        project_id: "demo-project",
        private_key_id: id,
      });
    };
    const secondId: string = fake(HEX, 40);

    return {
      positives: [
        labelled("google-service-account-key", keyFile(keyId), keyId),
        labelled(
          "google-service-account-key",
          JSON.stringify({ credentials: keyFile(secondId) }),
          secondId,
        ),
      ],
      nearMisses: [
        labelled("google-service-account-key", keyFile(keyId.slice(0, 39)), ""),
        labelled(
          "google-service-account-key",
          keyFile(keyId.toUpperCase().replace(/[0-9]/g, "G")),
          "",
        ),
      ],
    };
  },
  "azure-sas-token": (): CorpusEntry => {
    const token: (date: string, signature: string) => string = (
      date: string,
      signature: string,
    ): string => {
      return `sv=${date}&ss=b&srt=o&sp=r&se=2030-01-01T00%3A00%3A00Z&spr=https&sig=${signature}`;
    };
    const first: string = token(
      "2022-11-02",
      percentEncoded(fake(BASE64_ALPHABET, 43) + "="),
    );
    const second: string = token(
      "2021-06-08",
      percentEncoded(fake(BASE64_ALPHABET, 43) + "="),
    );
    const url: (query: string) => string = (query: string): string => {
      return `GET https://demostore.blob.core.windows.net/backups/db.bak?${query} 200`;
    };

    return {
      positives: [
        labelled("azure-sas-token", url(first), first),
        labelled(
          "azure-sas-token",
          `{"sasUrl": "https://demostore.blob.core.windows.net/c?${second}"}`,
          second,
        ),
      ],
      nearMisses: [
        labelled(
          "azure-sas-token",
          url(
            token(
              "2022-13-02",
              percentEncoded(fake(BASE64_ALPHABET, 43) + "="),
            ),
          ),
          "",
        ),
        labelled(
          "azure-sas-token",
          url(
            token(
              "2022-11-02",
              percentEncoded(fake(BASE64_ALPHABET, 22) + "=="),
            ),
          ),
          "",
        ),
      ],
    };
  },
  "openai-api-key": (): CorpusEntry => {
    const marker: string = ["T3Blbk", "FJ"].join("");
    const legacy: string = `sk-${fake(ALNUM, 20)}${marker}${fake(ALNUM, 20)}`;
    const project: string = `sk-proj-${fake(URL_SAFE, 74)}${marker}${fake(URL_SAFE, 74)}`;

    return {
      positives: [
        labelled("openai-api-key", logLine("openai", legacy), legacy),
        labelled("openai-api-key", jsonDocument("openai", project), project),
      ],
      nearMisses: [
        labelled("openai-api-key", logLine("ref", `sk-${fake(ALNUM, 48)}`), ""),
        labelled(
          "openai-api-key",
          jsonDocument("ref", `sk-proj-${fake(URL_SAFE, 20)}`),
          "",
        ),
      ],
    };
  },
  "json-web-token": (): CorpusEntry => {
    const header: string = base64Url('{"alg":"HS256","typ":"JWT"}');
    const jwt: (subject: string) => string = (subject: string): string => {
      return `${header}.${base64Url(`{"sub":"${subject}","iat":1700000000}`)}.${fake(URL_SAFE, 43)}`;
    };
    const first: string = jwt("user-42");
    const second: string = jwt("user-77");

    return {
      positives: [
        labelled(
          "json-web-token",
          `{"id_token":"${first}","expires_in":3600}`,
          first,
        ),
        labelled(
          "json-web-token",
          `Set-Cookie: session=${second}; HttpOnly; Secure`,
          second,
        ),
      ],
      nearMisses: [
        labelled(
          "json-web-token",
          `{"id_token":"${base64Url('{"typ":"JWT"}')}.${base64Url('{"sub":"user-42"}')}.${fake(URL_SAFE, 43)}","expires_in":3600}`,
          "",
        ),
        labelled(
          "json-web-token",
          `Set-Cookie: session=${header}.${base64Url('{"sub":"user-77"}')}.${fake(URL_SAFE, 10)}; HttpOnly`,
          "",
        ),
      ],
    };
  },
  "private-key": (): CorpusEntry => {
    const body: string = `MIIEpAIBAAKCAQEA${fake(BASE64_ALPHABET, 48)}`;
    const block: (kind: string) => string = (kind: string): string => {
      return `-----BEGIN ${kind}-----\n${body}\n-----END ${kind}-----`;
    };

    return {
      positives: [
        labelled(
          "private-key",
          block("RSA PRIVATE KEY"),
          "-----BEGIN RSA PRIVATE KEY-----",
        ),
        labelled(
          "private-key",
          `{"private_key": "-----BEGIN PRIVATE KEY-----\\n${body}\\n-----END PRIVATE KEY-----\\n"}`,
          "-----BEGIN PRIVATE KEY-----",
        ),
      ],
      nearMisses: [
        labelled("private-key", block("PUBLIC KEY"), ""),
        labelled("private-key", block("CERTIFICATE"), ""),
      ],
    };
  },
  "connection-string-password": (): CorpusEntry => {
    const first: string = `${fake(ALNUM, 14)}!`;
    const second: string = `${fake(ALNUM, 12)}#7`;

    return {
      positives: [
        labelled(
          "connection-string-password",
          `Server=sql.internal;Database=orders;User Id=svc_orders;Password=${first};Encrypt=True`,
          first,
        ),
        labelled(
          "connection-string-password",
          `Driver={ODBC Driver 18 for SQL Server};Server=tcp:sql.internal,1433;Uid=svc;Pwd={${second}};`,
          second,
        ),
      ],
      nearMisses: [
        labelled(
          "connection-string-password",
          "Server=sql.internal;Database=orders;User Id=svc_orders;Password=;Encrypt=True",
          "",
        ),
        labelled(
          "connection-string-password",
          "Server=sql.internal;Database=orders;User Id=svc_orders;Password=<password>;Encrypt=True",
          "",
        ),
      ],
    };
  },
  "authorization-header": (): CorpusEntry => {
    const basic: string = btoa(`svc-backup:${fake(ALNUM, 18)}`);
    const bearer: string = fake(URL_SAFE, 40);

    return {
      positives: [
        labelled(
          "authorization-header",
          `Authorization: Basic ${basic}`,
          basic,
        ),
        labelled(
          "authorization-header",
          `curl -H 'Authorization: Bearer ${bearer}' https://api.acme.io/v1/orders`,
          bearer,
        ),
      ],
      nearMisses: [
        labelled("authorization-header", "Authorization: Basic notbase64", ""),
        labelled(
          "authorization-header",
          "curl -H 'Authorization: Bearer <token>' https://api.acme.io/v1/orders",
          "",
        ),
      ],
    };
  },
  "generic-secret": (): CorpusEntry => {
    const password: string = `${fake(ALNUM, 12)}#${fake(DIGITS, 3)}`;
    const apiKey: string = fake(ALNUM, 24);

    return {
      positives: [
        labelled("generic-secret", `DB_PASSWORD=${password}`, password),
        labelled(
          "generic-secret",
          `{"name": "billing", "api_key": "${apiKey}"}`,
          apiKey,
        ),
      ],
      nearMisses: [
        labelled("generic-secret", "DB_PASSWORD=${DB_PASSWORD}", ""),
        labelled(
          "generic-secret",
          '{"name": "billing", "api_key": "your-api-key-here"}',
          "",
        ),
      ],
    };
  },
  "bitcoin-private-key": (): CorpusEntry => {
    const key: Uint8Array = randomBytes(32);
    const uncompressed: string = base58Check(
      Uint8Array.from([0x80, ...Array.from(key)]),
    );
    const compressed: string = base58Check(
      Uint8Array.from([0x80, ...Array.from(randomBytes(32)), 0x01]),
    );
    const middle: number = Math.floor(uncompressed.length / 2);
    const corrupted: string =
      uncompressed.slice(0, middle) +
      (uncompressed[middle] === "z" ? "y" : "z") +
      uncompressed.slice(middle + 1);
    const otherCoin: string = base58Check(
      Uint8Array.from([0xb0, ...Array.from(key)]),
    );

    return {
      positives: [
        labelled(
          "bitcoin-private-key",
          `wallet.importPrivKey("${uncompressed}")`,
          uncompressed,
        ),
        labelled("bitcoin-private-key", `wif: ${compressed}`, compressed),
      ],
      nearMisses: [
        labelled(
          "bitcoin-private-key",
          `wallet.importPrivKey("${corrupted}")`,
          "",
        ),
        labelled("bitcoin-private-key", `wif: ${otherCoin}`, ""),
      ],
    };
  },
};

const VALUE_TYPES: Array<DataTypeInfo> = DATA_TYPE_CATALOG.filter(
  (info: DataTypeInfo) => {
    return info.foundBy === "value";
  },
);

function buildCorpus(): Record<string, CorpusEntry> {
  const corpus: Record<string, CorpusEntry> = {};

  for (const info of VALUE_TYPES) {
    if (BUILT[info.id]) {
      corpus[info.id] = BUILT[info.id]!();
      continue;
    }

    const positives: Array<Labelled> = drawnPositives(info);

    corpus[info.id] = {
      positives,
      nearMisses: drawnNearMisses(info, positives),
    };
  }

  return corpus;
}

const CORPUS: Record<string, CorpusEntry> = buildCorpus();

/*
 * Types the engine cannot tell apart by design - the same shape next to
 * the same words. A finding of `found` on an example labelled `label`
 * counts neither for nor against `found`; the label's own recall still
 * counts the example as missed. Each is a known limit, with why.
 */
const KNOWN_CONFUSIONS: ReadonlyArray<{
  found: string;
  label: string;
  reason: string;
}> = [
  {
    found: "phone-number",
    label: "uk-nhs-number",
    reason:
      "An NHS number written 3-3-4 with dashes has a North American phone number's shape, so one whose check digit fails is still that shape.",
  },
];

function isKnownConfusion(found: string, label: string): boolean {
  return KNOWN_CONFUSIONS.some(
    (confusion: { found: string; label: string }) => {
      return confusion.found === found && confusion.label === label;
    },
  );
}

interface Tally {
  right: number;
  wrong: Array<string>;
}

interface Scores {
  byType: Map<string, Tally>;
  found: number;
  positives: number;
  missed: Array<string>;
}

function isSure(match: TextMatch): boolean {
  return match.confidence !== DataConfidence.Low && !match.isTestValue;
}

function score(): Scores {
  const byType: Map<string, Tally> = new Map();
  const tallyOf: (dataTypeId: string) => Tally = (
    dataTypeId: string,
  ): Tally => {
    let tally: Tally | undefined = byType.get(dataTypeId);

    if (!tally) {
      tally = { right: 0, wrong: [] };
      byType.set(dataTypeId, tally);
    }

    return tally;
  };
  const scores: Scores = { byType, found: 0, positives: 0, missed: [] };

  for (const entry of Object.values(CORPUS)) {
    for (const positive of entry.positives) {
      const start: number = positive.text.indexOf(positive.value);
      const end: number = start + positive.value.length;
      let found: boolean = false;

      scores.positives++;

      for (const match of findSensitiveValues(positive.text).filter(isSure)) {
        if (
          match.dataTypeId === positive.dataTypeId &&
          match.start < end &&
          start < match.end
        ) {
          tallyOf(match.dataTypeId).right++;
          found = true;
        } else if (!isKnownConfusion(match.dataTypeId, positive.dataTypeId)) {
          tallyOf(match.dataTypeId).wrong.push(
            `${positive.dataTypeId} example: ${positive.text}`,
          );
        }
      }

      if (found) {
        scores.found++;
      } else {
        scores.missed.push(`${positive.dataTypeId}: ${positive.text}`);
      }
    }

    for (const nearMiss of entry.nearMisses) {
      for (const match of findSensitiveValues(nearMiss.text).filter(isSure)) {
        if (!isKnownConfusion(match.dataTypeId, nearMiss.dataTypeId)) {
          tallyOf(match.dataTypeId).wrong.push(
            `${nearMiss.dataTypeId} near miss: ${nearMiss.text}`,
          );
        }
      }
    }
  }

  return scores;
}

describe("the accuracy corpus", () => {
  test("has two values and two near misses of every type found by value", () => {
    const short: Array<string> = VALUE_TYPES.filter((info: DataTypeInfo) => {
      return (
        CORPUS[info.id]!.positives.length < 2 ||
        CORPUS[info.id]!.nearMisses.length < 2
      );
    }).map((info: DataTypeInfo) => {
      return `${info.id}: ${CORPUS[info.id]!.positives.length} values, ${CORPUS[info.id]!.nearMisses.length} near misses`;
    });

    expect(short).toEqual([]);
  });

  test("writes down why each confusion it forgives is one the engine cannot avoid", () => {
    for (const confusion of KNOWN_CONFUSIONS) {
      expect(confusion.reason.length).toBeGreaterThan(60);
      expect(
        VALUE_TYPES.map((info: DataTypeInfo) => {
          return info.id;
        }),
      ).toEqual(expect.arrayContaining([confusion.found, confusion.label]));
    }
  });

  test("is made of values each type's own detectors take, and near misses they refuse", () => {
    const wrong: Array<string> = [];

    for (const [dataTypeId, entry] of Object.entries(CORPUS)) {
      for (const positive of entry.positives) {
        if (!isFoundAlone(dataTypeId, positive.text, positive.value)) {
          wrong.push(`not found alone: ${positive.text}`);
        }
      }

      for (const nearMiss of entry.nearMisses) {
        if (!isRefusedAlone(dataTypeId, nearMiss.text)) {
          wrong.push(`found alone: ${nearMiss.text}`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  const scores: Scores = score();

  test("finds what every type finds with a precision of at least 0.95", () => {
    const belowThreshold: Array<string> = [];

    for (const [dataTypeId, tally] of scores.byType) {
      const all: number = tally.right + tally.wrong.length;
      const precision: number = tally.right / all;

      if (precision < 0.95) {
        belowThreshold.push(
          `${dataTypeId}: precision ${precision.toFixed(2)} (${tally.right} right of ${all}); wrong in ${tally.wrong.join(" | ")}`,
        );
      }
    }

    expect(belowThreshold).toEqual([]);
  });

  test("finds at least 90% of the labelled values as their type", () => {
    const recall: number = scores.found / scores.positives;

    expect({
      recall: Number(recall.toFixed(3)),
      found: scores.found,
      positives: scores.positives,
      missed: recall >= 0.9 ? [] : scores.missed,
    }).toEqual({
      recall: expect.any(Number),
      found: expect.any(Number),
      positives: VALUE_TYPES.length * 2,
      missed: [],
    });
    expect([
      `recall ${recall.toFixed(3)}: missed ${scores.missed.join(" | ")}`,
      recall >= 0.9,
    ]).toEqual([expect.any(String), true]);
  });
});
