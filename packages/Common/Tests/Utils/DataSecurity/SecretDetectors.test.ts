import { describe, expect, test } from "@jest/globals";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import DataConfidence, {
  DATA_CONFIDENCE_RANK,
} from "../../../Types/DataSecurity/DataConfidence";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../../Types/DataSecurity/DataTypeCatalog";
import {
  CONTEXT_AFTER,
  CONTEXT_BEFORE,
  DataTypeDetector,
} from "../../../Utils/DataSecurity/Detector";
import SECRET_DETECTORS, {
  basicCredentials,
  decodeBase64,
  isGenericSecretValue,
  isPlaceholderSecret,
} from "../../../Utils/DataSecurity/Detectors/SecretDetectors";
import { sha256 } from "../../../Utils/DataSecurity/Sha256";
import { parsePattern } from "../../../Utils/LinearRegExp/Parser";
import { SyntaxNode } from "../../../Utils/LinearRegExp/Syntax";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * SECRETS AND CREDENTIALS, AS THE SCANNER FINDS THEM.
 *
 * Every detector is run here the way TextScanner runs it: its quick check,
 * then every match of its pattern, the value (its group, or the whole
 * match) normalized and validated, its words looked for around it, its
 * test values set apart. Each type is found in the kind of text it leaks
 * into (a .env line, a log line, JSON, a curl command), refused when it is
 * nearly but not quite the thing (a character short, a prefix off, inside
 * a longer token, a placeholder), and its documented examples counted as
 * test values.
 *
 * No key here is real, and none is written whole: each is put together
 * when the test runs from a prefix and a run of an alphabet's characters,
 * so no scanner reading this file sees a key in it.
 */

// Obviously fake key material: an alphabet's characters in turn.
function fake(alphabet: string, length: number, from: number = 0): string {
  let text: string = "";

  for (let index: number = 0; index < length; index++) {
    text += alphabet[(from + index) % alphabet.length];
  }

  return text;
}

const ALNUM: string = "Fk7Qz2Lp9Xw4Rt6Hy3Nc8Vb5Jm1Gd0Sa";
const URL_SAFE: string = `${ALNUM}-_`;
const BASE64: string = `${ALNUM}+/`;
const HEX: string = "3f9a07c1e5b28d64";
const LOWER_ALNUM: string = "k7qz2lp9xw4rt6hy3nc8vb5jm1gd0sa";
const UPPER_ALNUM: string = "Q7Z2L9X4R6H3N8V5J1G0SAKTMPWD";
const BASE32: string = "QH3ZK7MR2XWD5TPL6JNB4VGCYSFE";
const AZURE_SECRET_ALPHABET: string = `${ALNUM}~._-`;

// Text as base64url, the way a JWT writes its parts.
function base64Url(text: string): string {
  return btoa(text)
    .split("+")
    .join("-")
    .split("/")
    .join("_")
    .split("=")
    .join("");
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

const BASE58_ALPHABET: string =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  // The number's base-58 digits, least significant first.
  const digits: Array<number> = [];

  for (let index: number = 0; index < bytes.length; index++) {
    let carry: number = bytes[index]!;

    for (let digit: number = 0; digit < digits.length; digit++) {
      carry += digits[digit]! * 256;
      digits[digit] = carry % 58;
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

  for (let digit: number = digits.length - 1; digit >= 0; digit--) {
    text += BASE58_ALPHABET[digits[digit]!];
  }

  return text;
}

function bytesOfText(text: string): Uint8Array {
  return Uint8Array.from(
    text.split("").map((character: string): number => {
      return character.charCodeAt(0);
    }),
  );
}

function bytesOfHex(hex: string): Uint8Array {
  const bytes: Array<number> = [];

  for (let index: number = 0; index < hex.length; index += 2) {
    bytes.push(parseInt(hex.slice(index, index + 2), 16));
  }

  return Uint8Array.from(bytes);
}

// A key in wallet import format: Base58Check of version, key and flag.
function walletImportKey(
  key: Uint8Array,
  compressed: boolean,
  version: number = 0x80,
): string {
  const payload: Uint8Array = Uint8Array.from([
    version,
    ...Array.from(key),
    ...(compressed ? [0x01] : []),
  ]);
  const checksum: Uint8Array = sha256(sha256(payload)).slice(0, 4);

  return base58(
    Uint8Array.from([...Array.from(payload), ...Array.from(checksum)]),
  );
}

/*
 * The scanner's run of one detector over one text, as TextScanner.ts does
 * it: context words are whole words (not inside a longer one) anywhere
 * from CONTEXT_BEFORE characters before the value to CONTEXT_AFTER after
 * it, the value included.
 */
interface Found {
  value: string;
  confidence: DataConfidence;
  isTestValue: boolean;
}

function isWordCharacter(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90)
  );
}

function containsWord(text: string, word: string): boolean {
  for (let from: number = 0; ; ) {
    const index: number = text.indexOf(word, from);

    if (index < 0) {
      return false;
    }

    const before: number = index > 0 ? text.charCodeAt(index - 1) : 32;
    const afterIndex: number = index + word.length;
    const after: number =
      afterIndex < text.length ? text.charCodeAt(afterIndex) : 32;

    if (
      (!isWordCharacter(word.charCodeAt(0)) || !isWordCharacter(before)) &&
      (!isWordCharacter(word.charCodeAt(word.length - 1)) ||
        !isWordCharacter(after))
    ) {
      return true;
    }

    from = index + 1;
  }
}

function anyWordNear(
  lowerText: string,
  start: number,
  end: number,
  words: ReadonlyArray<string> | undefined,
  before: number,
  after: number,
): boolean {
  const around: string = lowerText.slice(
    Math.max(0, start - before),
    end + after,
  );

  return (words || []).some((word: string) => {
    return containsWord(around, word);
  });
}

function raised(confidence: DataConfidence): DataConfidence {
  return confidence === DataConfidence.Low
    ? DataConfidence.Medium
    : DataConfidence.High;
}

function lowered(confidence: DataConfidence): DataConfidence {
  return confidence === DataConfidence.High
    ? DataConfidence.Medium
    : DataConfidence.Low;
}

function runDetector(detector: DataTypeDetector, text: string): Array<Found> {
  const lowerText: string = text.toLowerCase();

  if (
    detector.quickCheck &&
    !detector.quickCheck(detector.quickCheckLowerCase ? lowerText : text)
  ) {
    return [];
  }

  const found: Array<Found> = [];

  for (const match of text.matchAll(detector.pattern)) {
    const raw: string | undefined = match[detector.valueGroup || 0];

    if (raw === undefined || match.index === undefined) {
      continue;
    }

    const start: number = match.index + Math.max(0, match[0].indexOf(raw));
    const end: number = start + raw.length;
    const normalized: string = detector.normalize
      ? detector.normalize(raw)
      : raw;

    if (detector.validate && !detector.validate(normalized, raw)) {
      continue;
    }

    const hasContext: boolean = anyWordNear(
      lowerText,
      start,
      end,
      detector.keywords,
      detector.contextBefore ?? CONTEXT_BEFORE,
      detector.contextAfter ?? CONTEXT_AFTER,
    );

    if (detector.requiresContext && !hasContext) {
      continue;
    }

    let confidence: DataConfidence = detector.confidenceWithoutContext;

    if (hasContext) {
      confidence = raised(confidence);
    }

    if (
      anyWordNear(
        lowerText,
        start,
        end,
        detector.negativeKeywords,
        CONTEXT_BEFORE,
        CONTEXT_AFTER,
      )
    ) {
      confidence = lowered(confidence);
    }

    found.push({
      value: normalized,
      confidence: confidence,
      isTestValue: Boolean(detector.isTestValue?.(normalized)),
    });
  }

  return found;
}

function detectorsOf(dataTypeId: string): Array<DataTypeDetector> {
  return SECRET_DETECTORS.filter((detector: DataTypeDetector) => {
    return detector.dataTypeId === dataTypeId;
  });
}

function scan(dataTypeId: string, text: string): Array<Found> {
  const found: Array<Found> = [];

  for (const detector of detectorsOf(dataTypeId)) {
    found.push(...runDetector(detector, text));
  }

  return found;
}

/*
 * One type's cases: texts that hold a value (and the value and confidence
 * found), texts that hold none, texts whose value is a test value, and -
 * for a type that needs context - the value with no words around it.
 */
interface SecretCase {
  found: ReadonlyArray<[string, string, DataConfidence]>;
  refused: ReadonlyArray<string>;
  testValues: ReadonlyArray<string>;
  withoutContext?: ReadonlyArray<string> | undefined;
}

const HIGH: DataConfidence = DataConfidence.High;
const MEDIUM: DataConfidence = DataConfidence.Medium;
const LOW: DataConfidence = DataConfidence.Low;

const AWS_KEY_ID: string = `AKIA${fake(BASE32, 16)}`;
const AWS_SECRET: string = fake(BASE64, 40);
const GOOGLE_KEY: string = `AIza${fake(URL_SAFE, 35)}`;
const SERVICE_ACCOUNT_KEY_ID: string = fake(HEX, 40);
const AZURE_STORAGE_KEY: string = `${fake(BASE64, 86)}==`;
const SAS_SIGNATURE: string = percentEncoded(`${fake(BASE64, 43, 2)}=`);
const SAS_TOKEN: string = `sv=2022-11-02&ss=b&srt=o&sp=r&se=2030-01-01T00%3A00%3A00Z&spr=https&sig=${SAS_SIGNATURE}`;
const AZURE_CLIENT_SECRET: string = `${fake(ALNUM, 3)}8Q~${fake(AZURE_SECRET_ALPHABET, 34, 5)}`;
const GITHUB_TOKEN: string = `ghp_${fake(ALNUM, 36)}`;
const SLACK_TEAM: string = "2810384756";
const SLACK_USER: string = "2810384757";
const SLACK_BOT: string = "4029384756123";
const SLACK_BOT_TOKEN: string = `${"xoxb"}-${SLACK_TEAM}-${SLACK_BOT}-${fake(ALNUM, 24)}`;
const SLACK_USER_TOKEN: string = `${"xoxp"}-${SLACK_TEAM}-${SLACK_USER}-${SLACK_BOT}-${fake(HEX, 32)}`;
const SLACK_APP_TOKEN: string = `${"xapp"}-1-A0${fake(UPPER_ALNUM, 9)}-${SLACK_BOT}-${fake(HEX, 64)}`;
const SLACK_WEBHOOK: string = `https://hooks.slack.com/services/T${fake(UPPER_ALNUM, 8)}/B${fake(UPPER_ALNUM, 10, 4)}/${fake(ALNUM, 24)}`;
const TWILIO_KEY: string = `SK${fake(HEX, 32)}`;
const MAILGUN_KEY: string = `key-${fake(LOWER_ALNUM, 32)}`;
const DATADOG_API_KEY: string = fake(HEX, 32);
const DATADOG_APP_KEY: string = fake(HEX, 40, 5);

const JWT_HEADER: string = base64Url('{"alg":"HS256","typ":"JWT"}');
const JWT_PAYLOAD: string = base64Url('{"sub":"user-42","iat":1700000000}');
const JWT: string = `${JWT_HEADER}.${JWT_PAYLOAD}.${fake(URL_SAFE, 43)}`;
const JWT_IO_SAMPLE: string = `${JWT_HEADER}.${base64Url('{"sub":"1234567890","name":"John Doe","iat":1516239022}')}.${fake(URL_SAFE, 43, 9)}`;

const KEY_BODY: string = `MIIEpAIBAAKCAQEA${fake(BASE64, 48)}`;
const URL_PASSWORD: string = fake(ALNUM, 16);
const CONNECTION_PASSWORD: string = `${fake(ALNUM, 14, 3)}!`;
const BASIC_CREDENTIALS: string = btoa(`svc-backup:${fake(ALNUM, 18)}`);
const BEARER_TOKEN: string = fake(URL_SAFE, 40, 7);
const GENERIC_VALUE: string = fake(ALNUM, 24, 2);
const GENERIC_PASSWORD: string = `Tr0ub4dor!${fake(ALNUM, 6)}`;

const WALLET_KEY: Uint8Array = sha256(
  bytesOfText("oneuptime secret detector test key"),
);
const WIF: string = walletImportKey(WALLET_KEY, false);
const WIF_COMPRESSED: string = walletImportKey(WALLET_KEY, true);

const CASES: Readonly<Record<string, SecretCase>> = {
  "aws-access-key-id": {
    found: [
      [
        `2024-05-01T10:00:00Z INFO loaded credentials access_key_id=${AWS_KEY_ID} region=us-east-1`,
        AWS_KEY_ID,
        HIGH,
      ],
      [
        `{"Credentials": {"AccessKeyId": "ASIA${fake(BASE32, 16, 3)}"}}`,
        `ASIA${fake(BASE32, 16, 3)}`,
        HIGH,
      ],
    ],
    refused: [
      `access_key_id=AKIA${fake(BASE32, 15)}`,
      `access_key_id=AKIA${fake(BASE32, 17)}`,
      `access_key_id=X${AWS_KEY_ID}`,
      `access_key_id=AKIB${fake(BASE32, 16)}`,
      `access_key_id=AKIA${fake(BASE32, 15)}1`,
      `access_key_id=${AWS_KEY_ID.toLowerCase()}`,
    ],
    testValues: [
      `aws_access_key_id = AKIA${"IOSFODNN7"}${"EXAMPLE"}`,
      `aws_access_key_id = AKIA${"X".repeat(16)}`,
    ],
  },
  "aws-secret-access-key": {
    found: [
      [`aws_secret_access_key = ${AWS_SECRET}`, AWS_SECRET, HIGH],
      [
        `{"AccessKey": {"UserName": "ci", "SecretAccessKey": "${AWS_SECRET}"}}`,
        AWS_SECRET,
        HIGH,
      ],
      [`export AWS_SECRET_ACCESS_KEY="${AWS_SECRET}"`, AWS_SECRET, HIGH],
    ],
    refused: [
      `aws_secret_access_key = ${fake(BASE64, 39)}`,
      `aws_secret_access_key = ${AWS_SECRET}A`,
      `aws_secret_access_key = ${fake(HEX, 40)}`,
      `aws_secret_access_key = ${"a".repeat(20)}${"B".repeat(19)}7`,
      `aws session eyJhbGciOi.${AWS_SECRET}.c2lnbmF0dXJl`,
    ],
    withoutContext: [`checksum ${AWS_SECRET}`, `{"value": "${AWS_SECRET}"}`],
    testValues: [
      `aws_secret_access_key = ${"wJalrXUtnFEMI/K7MDENG/"}${"bPxRfiCY"}${"EXAMPLEKEY"}`,
    ],
  },
  "google-api-key": {
    found: [
      [
        `<script src="https://maps.googleapis.com/maps/api/js?key=${GOOGLE_KEY}&callback=init"></script>`,
        GOOGLE_KEY,
        HIGH,
      ],
    ],
    refused: [
      `key=AIza${fake(URL_SAFE, 34)}`,
      `key=${GOOGLE_KEY}x`,
      `key=AIzb${fake(URL_SAFE, 35)}`,
      `key=x${GOOGLE_KEY}`,
    ],
    testValues: [
      `key=AIza${"X".repeat(35)}`,
      `key=AIza${"EXAMPLE"}${fake(URL_SAFE, 28)}`,
    ],
  },
  "google-service-account-key": {
    found: [
      [
        JSON.stringify(
          {
            type: "service_account",
            project_id: "demo-project-1234",
            private_key_id: SERVICE_ACCOUNT_KEY_ID,
            private_key: `-----BEGIN PRIVATE KEY-----\n${KEY_BODY}\n-----END PRIVATE KEY-----\n`,
            client_email: "ci@demo-project-1234.iam.gserviceaccount.com",
          },
          null,
          2,
        ),
        SERVICE_ACCOUNT_KEY_ID,
        HIGH,
      ],
      [
        // The key file kept as a string inside other JSON.
        JSON.stringify({
          credentials: JSON.stringify({
            type: "service_account",
            private_key_id: SERVICE_ACCOUNT_KEY_ID,
          }),
        }),
        SERVICE_ACCOUNT_KEY_ID,
        HIGH,
      ],
      [
        `google_credentials:\n  private_key_id: ${SERVICE_ACCOUNT_KEY_ID}`,
        SERVICE_ACCOUNT_KEY_ID,
        HIGH,
      ],
    ],
    refused: [
      `{"private_key_id": "${fake(HEX, 39)}"}`,
      `{"private_key_id": "${SERVICE_ACCOUNT_KEY_ID.toUpperCase()}"}`,
      `{"private_key_id": "${SERVICE_ACCOUNT_KEY_ID}a"}`,
      `{"client_private_key_id": "${SERVICE_ACCOUNT_KEY_ID}"}`,
    ],
    testValues: [`{"private_key_id": "${"0".repeat(40)}"}`],
  },
  "google-oauth-client-secret": {
    found: [
      [
        `{"web":{"client_id":"1234.apps.googleusercontent.com","client_secret":"GOCSPX-${fake(URL_SAFE, 28)}"}}`,
        `GOCSPX-${fake(URL_SAFE, 28)}`,
        HIGH,
      ],
    ],
    refused: [
      `client_secret=GOCSPX-${fake(URL_SAFE, 27)}`,
      `client_secret=GOCSPX-${fake(URL_SAFE, 29)}`,
      `client_secret=gocspx-${fake(URL_SAFE, 28)}`,
    ],
    testValues: [`client_secret=GOCSPX-${"x".repeat(28)}`],
  },
  "azure-storage-account-key": {
    found: [
      [
        `DefaultEndpointsProtocol=https;AccountName=demostore;AccountKey=${AZURE_STORAGE_KEY};EndpointSuffix=core.windows.net`,
        AZURE_STORAGE_KEY,
        HIGH,
      ],
      [
        `resource "azurerm_storage_account" "logs" {\n  primary_access_key = "${AZURE_STORAGE_KEY}"\n}`,
        AZURE_STORAGE_KEY,
        HIGH,
      ],
      [`"storageAccountKey": "${AZURE_STORAGE_KEY}"`, AZURE_STORAGE_KEY, HIGH],
    ],
    refused: [
      `AccountName=demostore;AccountKey=${fake(BASE64, 85)}==;`,
      `AccountName=demostore;AccountKey=${fake(BASE64, 87)}==;`,
      `AccountName=demostore;AccountKey=${fake(BASE64, 86)}=;`,
      `AccountName=demostore;AccountKey=${fake(BASE64, 86)}===;`,
    ],
    withoutContext: [`blob ${AZURE_STORAGE_KEY}`],
    testValues: [`AccountName=demostore;AccountKey=${"A".repeat(86)}==;`],
  },
  "azure-sas-token": {
    found: [
      [
        `GET https://demostore.blob.core.windows.net/backups/db.bak?${SAS_TOKEN} 200`,
        SAS_TOKEN,
        HIGH,
      ],
      [
        `BlobEndpoint=https://demostore.blob.core.windows.net/;SharedAccessSignature=sv=2021-06-08&sp=rl&sr=c&sig=${fake(BASE64, 43, 6)}=`,
        `sv=2021-06-08&sp=rl&sr=c&sig=${fake(BASE64, 43, 6)}=`,
        HIGH,
      ],
    ],
    refused: [
      `?sv=2022-13-02&sp=r&sig=${SAS_SIGNATURE}`,
      `?sv=2009-07-17&sp=r&sig=${SAS_SIGNATURE}`,
      `?sv=2022-11-02&sp=r&sig=${percentEncoded(`${fake(BASE64, 22)}==`)}`,
      "?sv=2022-11-02&ss=b&srt=o&sp=r",
      `?xsv=2022-11-02&sp=r&sig=${SAS_SIGNATURE}`,
    ],
    testValues: [
      `?sv=2022-11-02&sp=r&sig=${percentEncoded(`${"A".repeat(43)}=`)}`,
    ],
  },
  "azure-client-secret": {
    found: [
      [`AZURE_CLIENT_SECRET=${AZURE_CLIENT_SECRET}`, AZURE_CLIENT_SECRET, HIGH],
      [
        `{"tenantId": "contoso", "clientSecret": "${AZURE_CLIENT_SECRET}"}`,
        AZURE_CLIENT_SECRET,
        HIGH,
      ],
    ],
    refused: [
      `AZURE_CLIENT_SECRET=${fake(ALNUM, 3)}8Q~${fake(AZURE_SECRET_ALPHABET, 30)}`,
      `AZURE_CLIENT_SECRET=${fake(ALNUM, 3)}xQ~${fake(AZURE_SECRET_ALPHABET, 34)}`,
      `AZURE_CLIENT_SECRET=${fake(ALNUM, 3)}8Q~${fake(AZURE_SECRET_ALPHABET, 35)}`,
      `AZURE_CLIENT_SECRET=x${AZURE_CLIENT_SECRET}`,
    ],
    withoutContext: [`value ${AZURE_CLIENT_SECRET}`],
    testValues: [
      `AZURE_CLIENT_SECRET=${fake(ALNUM, 3)}8Q~EXAMPLE${fake(AZURE_SECRET_ALPHABET, 27)}`,
    ],
  },
  "github-token": {
    found: [
      [`GITHUB_TOKEN=${GITHUB_TOKEN}`, GITHUB_TOKEN, HIGH],
      [
        `git clone https://x-access-token:ghs_${fake(ALNUM, 36, 7)}@github.com/acme/app.git`,
        `ghs_${fake(ALNUM, 36, 7)}`,
        HIGH,
      ],
      [
        `{"token": "github_pat_${fake(ALNUM, 22)}_${fake(ALNUM, 59, 5)}"}`,
        `github_pat_${fake(ALNUM, 22)}_${fake(ALNUM, 59, 5)}`,
        HIGH,
      ],
    ],
    refused: [
      `GITHUB_TOKEN=ghp_${fake(ALNUM, 35)}`,
      `GITHUB_TOKEN=ghp_${fake(ALNUM, 37)}`,
      `GITHUB_TOKEN=ghx_${fake(ALNUM, 36)}`,
      `GITHUB_TOKEN=x${GITHUB_TOKEN}`,
    ],
    testValues: [
      `GITHUB_TOKEN=ghp_${"x".repeat(36)}`,
      `GITHUB_TOKEN=ghp_EXAMPLE${fake(ALNUM, 29)}`,
    ],
  },
  "gitlab-token": {
    found: [
      [
        `curl --header "PRIVATE-TOKEN: glpat-${fake(URL_SAFE, 20)}" https://gitlab.com/api/v4/projects`,
        `glpat-${fake(URL_SAFE, 20)}`,
        HIGH,
      ],
      [
        `GITLAB_TOKEN=glpat-${fake(URL_SAFE, 40)}.01.${fake(LOWER_ALNUM, 7)}`,
        `glpat-${fake(URL_SAFE, 40)}.01.${fake(LOWER_ALNUM, 7)}`,
        HIGH,
      ],
      [
        `deploy token gldt-${fake(URL_SAFE, 20, 4)}`,
        `gldt-${fake(URL_SAFE, 20, 4)}`,
        HIGH,
      ],
      [`trigger glptt-${fake(HEX, 40)}`, `glptt-${fake(HEX, 40)}`, HIGH],
    ],
    refused: [
      `GITLAB_TOKEN=glpat-${fake(URL_SAFE, 19)}`,
      `GITLAB_TOKEN=glpat-${fake(URL_SAFE, 21)}`,
      `GITLAB_TOKEN=xglpat-${fake(URL_SAFE, 20)}`,
    ],
    testValues: [`GITLAB_TOKEN=glpat-${"x".repeat(20)}`],
  },
  "slack-token": {
    found: [
      [`SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}`, SLACK_BOT_TOKEN, HIGH],
      [`token: ${SLACK_USER_TOKEN}`, SLACK_USER_TOKEN, HIGH],
      [`app token ${SLACK_APP_TOKEN}`, SLACK_APP_TOKEN, HIGH],
    ],
    refused: [
      "SLACK_BOT_TOKEN=xoxb-abc-def",
      `SLACK_BOT_TOKEN=${"xoxb"}-${SLACK_TEAM}-${fake(ALNUM, 5)}`,
      `SLACK_BOT_TOKEN=${"xoxz"}-${SLACK_TEAM}-${SLACK_BOT}-${fake(ALNUM, 24)}`,
      `SLACK_BOT_TOKEN=a${SLACK_BOT_TOKEN}`,
    ],
    testValues: [
      `SLACK_BOT_TOKEN=${"xoxb"}-${SLACK_TEAM}-${SLACK_BOT}-${"x".repeat(24)}`,
    ],
  },
  "slack-webhook-url": {
    found: [
      [`SLACK_WEBHOOK_URL=${SLACK_WEBHOOK}`, SLACK_WEBHOOK, HIGH],
      [
        `{"url": "https://hooks.slack.com/workflows/T${fake(UPPER_ALNUM, 8)}/A${fake(UPPER_ALNUM, 10)}/482910374652918374/${fake(ALNUM, 32)}"}`,
        `https://hooks.slack.com/workflows/T${fake(UPPER_ALNUM, 8)}/A${fake(UPPER_ALNUM, 10)}/482910374652918374/${fake(ALNUM, 32)}`,
        HIGH,
      ],
    ],
    refused: [
      `https://hooks.slack.com/services/T${fake(UPPER_ALNUM, 8)}/B${fake(UPPER_ALNUM, 10)}/${fake(ALNUM, 10)}`,
      "https://hooks.slack.com/services/",
      `https://hooks.slack.com/services/t${fake(LOWER_ALNUM, 8)}/b${fake(LOWER_ALNUM, 10)}/${fake(ALNUM, 24)}`,
      `https://myhooks.slack.com/services/T${fake(UPPER_ALNUM, 8)}/B${fake(UPPER_ALNUM, 10)}/${fake(ALNUM, 24)}`,
    ],
    testValues: [
      `https://hooks.slack.com/services/T00000000/B00000000/${"X".repeat(24)}`,
    ],
  },
  "stripe-secret-key": {
    found: [
      [
        `STRIPE_SECRET_KEY=sk_live_${fake(ALNUM, 24)}`,
        `sk_live_${fake(ALNUM, 24)}`,
        HIGH,
      ],
      [
        `stripe.api_key = "rk_live_${fake(ALNUM, 99)}"`,
        `rk_live_${fake(ALNUM, 99)}`,
        HIGH,
      ],
    ],
    refused: [
      `STRIPE_PUBLISHABLE_KEY=pk_live_${fake(ALNUM, 24)}`,
      `STRIPE_SECRET_KEY=sk_live_${fake(ALNUM, 19)}`,
      `STRIPE_SECRET_KEY=sk_prod_${fake(ALNUM, 24)}`,
    ],
    testValues: [
      `STRIPE_SECRET_KEY=sk_test_${fake(ALNUM, 24)}`,
      `STRIPE_SECRET_KEY=rk_test_${fake(ALNUM, 24)}`,
    ],
  },
  "twilio-api-key": {
    found: [
      [`TWILIO_API_KEY=${TWILIO_KEY}`, TWILIO_KEY, HIGH],
      [`client = Client(api_key_sid="${TWILIO_KEY}")`, TWILIO_KEY, HIGH],
    ],
    refused: [
      `TWILIO_API_KEY=SK${fake(HEX, 31)}`,
      `TWILIO_API_KEY=SK${fake(HEX, 33)}`,
      `TWILIO_ACCOUNT_SID=AC${fake(HEX, 32)}`,
    ],
    withoutContext: [`id=${TWILIO_KEY}`],
    testValues: [`TWILIO_API_KEY=SK${"0a".repeat(16)}`],
  },
  "sendgrid-api-key": {
    found: [
      [
        `SENDGRID_API_KEY='SG.${fake(URL_SAFE, 22)}.${fake(URL_SAFE, 43, 9)}'`,
        `SG.${fake(URL_SAFE, 22)}.${fake(URL_SAFE, 43, 9)}`,
        HIGH,
      ],
    ],
    refused: [
      `SENDGRID_API_KEY=SG.${fake(URL_SAFE, 21)}.${fake(URL_SAFE, 43)}`,
      `SENDGRID_API_KEY=SG.${fake(URL_SAFE, 22)}.${fake(URL_SAFE, 42)}`,
      `SENDGRID_API_KEY=sg.${fake(URL_SAFE, 22)}.${fake(URL_SAFE, 43)}`,
    ],
    testValues: [`SENDGRID_API_KEY=SG.${"x".repeat(22)}.${"x".repeat(43)}`],
  },
  "mailgun-api-key": {
    found: [
      [`MAILGUN_API_KEY=${MAILGUN_KEY}`, MAILGUN_KEY, HIGH],
      [`api: ${MAILGUN_KEY}`, MAILGUN_KEY, MEDIUM],
      [
        `mailgun private key ${fake(HEX, 32)}-${fake(HEX, 8, 3)}-${fake(HEX, 8, 7)}`,
        `${fake(HEX, 32)}-${fake(HEX, 8, 3)}-${fake(HEX, 8, 7)}`,
        HIGH,
      ],
    ],
    refused: [
      `MAILGUN_API_KEY=key-${fake(LOWER_ALNUM, 31)}`,
      `MAILGUN_API_KEY=key-${"abcdefghijklmnopqrstuvwxyz"}${"abcdef"}`,
      `MAILGUN_API_KEY=api-key-${fake(LOWER_ALNUM, 32)}`,
    ],
    testValues: [`MAILGUN_API_KEY=key-${"0a".repeat(16)}`],
  },
  "mailchimp-api-key": {
    found: [
      [
        `MAILCHIMP_API_KEY=${fake(HEX, 32)}-us14`,
        `${fake(HEX, 32)}-us14`,
        HIGH,
      ],
    ],
    refused: [
      `MAILCHIMP_API_KEY=${fake(HEX, 31)}-us14`,
      `MAILCHIMP_API_KEY=${fake(HEX, 32)}-eu14`,
      `MAILCHIMP_API_KEY=${fake(HEX, 32)}-us123`,
    ],
    testValues: [`MAILCHIMP_API_KEY=${"0".repeat(32)}-us1`],
  },
  "openai-api-key": {
    found: [
      [
        `OPENAI_API_KEY=sk-${fake(ALNUM, 20)}T3BlbkFJ${fake(ALNUM, 20, 11)}`,
        `sk-${fake(ALNUM, 20)}T3BlbkFJ${fake(ALNUM, 20, 11)}`,
        HIGH,
      ],
      [
        `{"apiKey": "sk-proj-${fake(URL_SAFE, 74)}T3BlbkFJ${fake(URL_SAFE, 74, 5)}"}`,
        `sk-proj-${fake(URL_SAFE, 74)}T3BlbkFJ${fake(URL_SAFE, 74, 5)}`,
        HIGH,
      ],
      [
        `service account key sk-svcacct-${fake(URL_SAFE, 60)}`,
        `sk-svcacct-${fake(URL_SAFE, 60)}`,
        HIGH,
      ],
    ],
    refused: [
      `OPENAI_API_KEY=sk-${fake(ALNUM, 48)}`,
      `OPENAI_API_KEY=sk-proj-${fake(URL_SAFE, 20)}`,
      `task-${fake(ALNUM, 20)}T3BlbkFJ${fake(ALNUM, 20)}`,
    ],
    testValues: [`OPENAI_API_KEY=sk-proj-${"x".repeat(60)}`],
  },
  "anthropic-api-key": {
    found: [
      [
        `ANTHROPIC_API_KEY=sk-ant-api03-${fake(URL_SAFE, 93)}AA`,
        `sk-ant-api03-${fake(URL_SAFE, 93)}AA`,
        HIGH,
      ],
    ],
    refused: [
      `ANTHROPIC_API_KEY=sk-ant-api03-${fake(URL_SAFE, 20)}`,
      `ANTHROPIC_API_KEY=sk-ant-${fake(URL_SAFE, 60)}`,
    ],
    testValues: [`ANTHROPIC_API_KEY=sk-ant-api03-${"x".repeat(95)}`],
  },
  "huggingface-token": {
    found: [
      [`HF_TOKEN=hf_${fake(ALNUM, 34)}`, `hf_${fake(ALNUM, 34)}`, HIGH],
      [
        `org token api_org_${fake(ALNUM, 34, 3)}`,
        `api_org_${fake(ALNUM, 34, 3)}`,
        HIGH,
      ],
    ],
    refused: [
      `HF_TOKEN=hf_${fake(ALNUM, 33)}`,
      `HF_TOKEN=hf_${fake(ALNUM, 35)}`,
      `HF_TOKEN=hf_${fake(LOWER_ALNUM, 34)}`,
    ],
    testValues: [`HF_TOKEN=hf_EXAMPLE${fake(ALNUM, 27)}`],
  },
  "npm-token": {
    found: [
      [
        `//registry.npmjs.org/:_authToken=npm_${fake(ALNUM, 36)}`,
        `npm_${fake(ALNUM, 36)}`,
        HIGH,
      ],
    ],
    refused: [
      `//registry.npmjs.org/:_authToken=npm_${fake(ALNUM, 35)}`,
      `//registry.npmjs.org/:_authToken=npm_${fake(ALNUM, 37)}`,
    ],
    testValues: [`//registry.npmjs.org/:_authToken=npm_${"x".repeat(36)}`],
  },
  "pypi-token": {
    found: [
      [
        `[pypi]\n  username = __token__\n  password = pypi-AgEIcHlwaS5vcmc${fake(URL_SAFE, 120)}`,
        `pypi-AgEIcHlwaS5vcmc${fake(URL_SAFE, 120)}`,
        HIGH,
      ],
    ],
    refused: [
      `password = pypi-AgEIcHlwaS5vcmc${fake(URL_SAFE, 49)}`,
      `password = pypi-${fake(URL_SAFE, 120)}`,
    ],
    testValues: [
      `password = pypi-AgENdGVzdC5weXBpLm9yZw${fake(URL_SAFE, 120)}`,
    ],
  },
  "docker-hub-token": {
    found: [
      [
        `echo "dckr_pat_${fake(URL_SAFE, 27)}" | docker login -u acme --password-stdin`,
        `dckr_pat_${fake(URL_SAFE, 27)}`,
        HIGH,
      ],
    ],
    refused: [
      `echo "dckr_pat_${fake(URL_SAFE, 20)}"`,
      `echo "dckr_xyz_${fake(URL_SAFE, 27)}"`,
    ],
    testValues: [`echo "dckr_pat_${"x".repeat(27)}"`],
  },
  "shopify-token": {
    found: [
      [
        `X-Shopify-Access-Token: shpat_${fake(HEX, 32)}`,
        `shpat_${fake(HEX, 32)}`,
        HIGH,
      ],
      [
        `SHOPIFY_SHARED_SECRET=shpss_${fake(HEX, 32, 5)}`,
        `shpss_${fake(HEX, 32, 5)}`,
        HIGH,
      ],
    ],
    refused: [
      `X-Shopify-Access-Token: shpat_${fake(HEX, 31)}`,
      `X-Shopify-Access-Token: shpat_${fake(ALNUM, 32)}`,
      `X-Shopify-Access-Token: shpxx_${fake(HEX, 32)}`,
    ],
    testValues: [`X-Shopify-Access-Token: shpat_${"0".repeat(32)}`],
  },
  "square-token": {
    found: [
      [
        `SQUARE_ACCESS_TOKEN=EAAA${fake(URL_SAFE, 60)}`,
        `EAAA${fake(URL_SAFE, 60)}`,
        HIGH,
      ],
      [
        `token: sq0atp-${fake(URL_SAFE, 22)}`,
        `sq0atp-${fake(URL_SAFE, 22)}`,
        HIGH,
      ],
      [
        `secret: sq0csp-${fake(URL_SAFE, 43)}`,
        `sq0csp-${fake(URL_SAFE, 43)}`,
        HIGH,
      ],
    ],
    refused: [
      // Inside base64 of binary data, which is full of "EAAA".
      `data:application/octet-stream;base64,AAAA+EAAA${fake(URL_SAFE, 60)}/AAAA`,
      `SQUARE_ACCESS_TOKEN=EAAA${fake(URL_SAFE, 59)}`,
      `SQUARE_ACCESS_TOKEN=EAAA${fake(LOWER_ALNUM, 60)}`,
    ],
    testValues: [`token: sq0atp-${"x".repeat(22)}`],
  },
  "braintree-access-token": {
    found: [
      [
        `BRAINTREE_ACCESS_TOKEN=access_token$production$${fake(LOWER_ALNUM, 16)}$${fake(HEX, 32)}`,
        `access_token$production$${fake(LOWER_ALNUM, 16)}$${fake(HEX, 32)}`,
        HIGH,
      ],
    ],
    refused: [
      `access_token$production$${fake(LOWER_ALNUM, 15)}$${fake(HEX, 32)}`,
      `access_token$staging$${fake(LOWER_ALNUM, 16)}$${fake(HEX, 32)}`,
    ],
    testValues: [
      `access_token$sandbox$${fake(LOWER_ALNUM, 16)}$${fake(HEX, 32)}`,
    ],
  },
  "digitalocean-token": {
    found: [
      [
        `DIGITALOCEAN_TOKEN=dop_v1_${fake(HEX, 64)}`,
        `dop_v1_${fake(HEX, 64)}`,
        HIGH,
      ],
    ],
    refused: [
      `DIGITALOCEAN_TOKEN=dop_v1_${fake(HEX, 63)}`,
      `DIGITALOCEAN_TOKEN=dop_v2_${fake(HEX, 64)}`,
    ],
    testValues: [`DIGITALOCEAN_TOKEN=dop_v1_${"0".repeat(64)}`],
  },
  "new-relic-api-key": {
    found: [
      [
        `NEW_RELIC_API_KEY=NRAK-${fake(UPPER_ALNUM, 27)}`,
        `NRAK-${fake(UPPER_ALNUM, 27)}`,
        HIGH,
      ],
      [
        `insert key NRII-${fake(URL_SAFE, 32)}`,
        `NRII-${fake(URL_SAFE, 32)}`,
        HIGH,
      ],
    ],
    refused: [
      `NEW_RELIC_API_KEY=NRAK-${fake(UPPER_ALNUM, 26)}`,
      `NEW_RELIC_API_KEY=NRAK-${fake(LOWER_ALNUM, 27)}`,
    ],
    testValues: [`NEW_RELIC_API_KEY=NRAK-${"X".repeat(27)}`],
  },
  "datadog-api-key": {
    found: [
      [`DD_API_KEY=${DATADOG_API_KEY}`, DATADOG_API_KEY, HIGH],
      [`datadog:\n  app_key: "${DATADOG_APP_KEY}"`, DATADOG_APP_KEY, HIGH],
      // Next to a word that says it is a digest, a level lower.
      [`DD_API_KEY sha256 ${DATADOG_API_KEY}`, DATADOG_API_KEY, MEDIUM],
    ],
    refused: [
      `DD_API_KEY=${fake(HEX, 31)}`,
      `DD_API_KEY=${fake(HEX, 33)}`,
      `DD_API_KEY=${"a".repeat(32)}`,
      `DD_API_KEY=x${DATADOG_API_KEY}`,
    ],
    withoutContext: [`md5 ${DATADOG_API_KEY}`, `commit ${DATADOG_APP_KEY}`],
    testValues: [`DD_API_KEY=${"0a".repeat(16)}`],
  },
  "vault-token": {
    found: [
      [
        `export VAULT_TOKEN=hvs.${fake(URL_SAFE, 24)}`,
        `hvs.${fake(URL_SAFE, 24)}`,
        HIGH,
      ],
      [
        `X-Vault-Token: hvs.${fake(URL_SAFE, 90, 3)}`,
        `hvs.${fake(URL_SAFE, 90, 3)}`,
        HIGH,
      ],
      [`batch hvb.${fake(URL_SAFE, 140)}`, `hvb.${fake(URL_SAFE, 140)}`, HIGH],
    ],
    refused: [
      `export VAULT_TOKEN=hvs.${fake(URL_SAFE, 23)}`,
      "hvs.configuration_management_enabled",
    ],
    testValues: [`export VAULT_TOKEN=hvs.EXAMPLE${fake(URL_SAFE, 20)}`],
  },
  "terraform-cloud-token": {
    found: [
      [
        `credentials "app.terraform.io" {\n  token = "${fake(ALNUM, 14)}.atlasv1.${fake(URL_SAFE, 67)}"\n}`,
        `${fake(ALNUM, 14)}.atlasv1.${fake(URL_SAFE, 67)}`,
        HIGH,
      ],
    ],
    refused: [
      `token = "${fake(ALNUM, 13)}.atlasv1.${fake(URL_SAFE, 67)}"`,
      `token = "${fake(ALNUM, 14)}.atlasv2.${fake(URL_SAFE, 67)}"`,
      `token = "${fake(ALNUM, 14)}.atlasv1.${fake(URL_SAFE, 59)}"`,
    ],
    testValues: [`token = "${"x".repeat(14)}.atlasv1.${"x".repeat(67)}"`],
  },
  "atlassian-api-token": {
    found: [
      [
        `JIRA_API_TOKEN=ATATT3${fake(URL_SAFE, 186)}`,
        `ATATT3${fake(URL_SAFE, 186)}`,
        HIGH,
      ],
    ],
    refused: [`JIRA_API_TOKEN=ATATT3${fake(URL_SAFE, 100)}`],
    testValues: [`JIRA_API_TOKEN=ATATT3${"x".repeat(186)}`],
  },
  "linear-api-key": {
    found: [
      [
        `LINEAR_API_KEY=lin_api_${fake(ALNUM, 40)}`,
        `lin_api_${fake(ALNUM, 40)}`,
        HIGH,
      ],
      [`oauth lin_oauth_${fake(HEX, 64)}`, `lin_oauth_${fake(HEX, 64)}`, HIGH],
    ],
    refused: [
      `LINEAR_API_KEY=lin_api_${fake(ALNUM, 39)}`,
      `LINEAR_API_KEY=lin_api_${fake(ALNUM, 41)}`,
    ],
    testValues: [`LINEAR_API_KEY=lin_api_${"x".repeat(40)}`],
  },
  "json-web-token": {
    found: [
      [`Authorization: Bearer ${JWT}`, JWT, HIGH],
      [`{"id_token":"${JWT}","expires_in":3600}`, JWT, HIGH],
      [`GET /callback?access_token=${JWT}&state=xyz 302`, JWT, HIGH],
    ],
    refused: [
      // A header that is no JSON, one without "alg", a signature too short.
      `token=eyJ${fake(URL_SAFE, 20)}.${JWT_PAYLOAD}.${fake(URL_SAFE, 43)}`,
      `token=${base64Url('{"typ":"JWT"}')}.${JWT_PAYLOAD}.${fake(URL_SAFE, 43)}`,
      `token=${JWT_HEADER}.${JWT_PAYLOAD}.${fake(URL_SAFE, 10)}`,
      `token=${JWT_HEADER}.${JWT_PAYLOAD}`,
      `token=x${JWT}`,
    ],
    testValues: [`Authorization: Bearer ${JWT_IO_SAMPLE}`],
  },
  "private-key": {
    found: [
      [
        `-----BEGIN RSA PRIVATE KEY-----\n${KEY_BODY}\n-----END RSA PRIVATE KEY-----`,
        "-----BEGIN RSA PRIVATE KEY-----",
        HIGH,
      ],
      [
        `{"private_key": "-----BEGIN PRIVATE KEY-----\\n${KEY_BODY}\\n-----END PRIVATE KEY-----\\n"}`,
        "-----BEGIN PRIVATE KEY-----",
        HIGH,
      ],
      [
        `-----BEGIN OPENSSH PRIVATE KEY-----\r\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ\r\n`,
        "-----BEGIN OPENSSH PRIVATE KEY-----",
        HIGH,
      ],
      [
        `-----BEGIN EC PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,0123\n\n${KEY_BODY}`,
        "-----BEGIN EC PRIVATE KEY-----",
        HIGH,
      ],
      [
        `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${KEY_BODY}`,
        "-----BEGIN ENCRYPTED PRIVATE KEY-----",
        HIGH,
      ],
      [
        `-----BEGIN PGP PRIVATE KEY BLOCK-----\nVersion: GnuPG v2\n\nlQOYBF${fake(BASE64, 40)}`,
        "-----BEGIN PGP PRIVATE KEY BLOCK-----",
        HIGH,
      ],
      [
        "PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\nComment: deploy",
        "PuTTY-User-Key-File-3: ssh-ed25519",
        HIGH,
      ],
    ],
    refused: [
      `-----BEGIN PUBLIC KEY-----\n${KEY_BODY}\n-----END PUBLIC KEY-----`,
      `-----BEGIN CERTIFICATE-----\n${KEY_BODY}\n-----END CERTIFICATE-----`,
      // The name of a key in the code that reads one, with no key after it.
      'if (pem.startsWith("-----BEGIN RSA PRIVATE KEY-----")) {',
      `-----BEGIN rsa private key-----\n${KEY_BODY}`,
      `------BEGIN RSA PRIVATE KEY-----\n${KEY_BODY}`,
      `-----BEGIN RSAPRIVATE KEY-----\n${KEY_BODY}`,
    ],
    testValues: [`-----BEGIN FAKE RSA PRIVATE KEY-----\n${KEY_BODY}`],
  },
  "password-in-url": {
    found: [
      [
        `DATABASE_URL=postgres://app_user:${URL_PASSWORD}@db.internal.acme.io:5432/orders?sslmode=require`,
        `postgres://app_user:${URL_PASSWORD}@db.internal.acme.io`,
        HIGH,
      ],
      [
        `amqp://guest:${URL_PASSWORD}@rabbit:5672/`,
        `amqp://guest:${URL_PASSWORD}@rabbit`,
        HIGH,
      ],
      [
        `redis://:${URL_PASSWORD}@cache`,
        `redis://:${URL_PASSWORD}@cache`,
        HIGH,
      ],
      [
        // An "@" the password holds, not percent-encoded.
        `mongodb://admin:p@${URL_PASSWORD}@mongo.internal/admin`,
        `mongodb://admin:p@${URL_PASSWORD}@mongo.internal`,
        HIGH,
      ],
    ],
    refused: [
      "postgres://app_user@db.internal/orders",
      "postgres://app_user:@db.internal/orders",
      "postgres://user:password@db.internal/orders",
      "postgres://user:${DB_PASSWORD}@db.internal/orders",
      "https://user:****@git.internal/repo.git",
      "http://proxy.internal:8080@upstream",
      "postgres://app_user:<password>@db.internal/orders",
      // Examples documentation and code comments write.
      " * (\"'postgres://app:hunter2@db': enabled\")",
      " * URLs (`scheme://user:pw@host:port/db?x`)",
    ],
    testValues: [`https://deploy:${URL_PASSWORD}@example.com/repo.git`],
  },
  "connection-string-password": {
    found: [
      [
        `Server=sql.internal;Database=orders;User Id=svc_orders;Password=${CONNECTION_PASSWORD};Encrypt=True`,
        CONNECTION_PASSWORD,
        HIGH,
      ],
      [
        `Driver={ODBC Driver 18 for SQL Server};Server=tcp:sql.internal,1433;Uid=svc;Pwd={${CONNECTION_PASSWORD}};`,
        CONNECTION_PASSWORD,
        HIGH,
      ],
      [
        `Data Source=db;Initial Catalog=app;User ID=sa;Password=${CONNECTION_PASSWORD}`,
        CONNECTION_PASSWORD,
        HIGH,
      ],
      [
        `"ConnectionStrings": {"Default": "Host=pg;Username=app;Password='${CONNECTION_PASSWORD}';"}`,
        CONNECTION_PASSWORD,
        HIGH,
      ],
      [`Mode=fast;Pwd=${CONNECTION_PASSWORD};`, CONNECTION_PASSWORD, MEDIUM],
      [
        `Password=${CONNECTION_PASSWORD};Server=sql.internal;Database=orders`,
        CONNECTION_PASSWORD,
        HIGH,
      ],
    ],
    refused: [
      `Password=${CONNECTION_PASSWORD}`,
      `Password=${CONNECTION_PASSWORD};`,
      // Statements of code and SQL end in ";" too.
      "if (options.password) {\n  config.password = options.password;\n}",
      `  password = aiPassword;\n  usernameVariable = "${CONNECTION_PASSWORD}";`,
      `$password = "${CONNECTION_PASSWORD}"; $user = "svc";`,
      "CREATE LOGIN monitor WITH PASSWORD = 'a-strong-password'; GRANT VIEW SERVER STATE TO monitor;",
      "Server=sql.internal;Password=e.password;",
      "Server=sql.internal;Password=;",
      "Server=sql.internal;Password=myPassword;",
      "Server=sql.internal;Password=********;",
      "Server=sql.internal;Password=${DB_PASSWORD};",
      "Server=sql.internal;Password=%DB_PASS%;",
      `Server=sql.internal;UserPassword=${CONNECTION_PASSWORD};`,
    ],
    testValues: [`Server=sql.internal;Password=EXAMPLE${CONNECTION_PASSWORD};`],
  },
  "authorization-header": {
    found: [
      [`Authorization: Basic ${BASIC_CREDENTIALS}`, BASIC_CREDENTIALS, HIGH],
      [
        `curl -H 'Authorization: Bearer ${BEARER_TOKEN}' https://api.acme.io/v1/orders`,
        BEARER_TOKEN,
        HIGH,
      ],
      [
        `{"headers":{"authorization":"Bearer ${BEARER_TOKEN}"}}`,
        BEARER_TOKEN,
        HIGH,
      ],
      [
        `req.Header.Set("Authorization", "Token ${BEARER_TOKEN}")`,
        BEARER_TOKEN,
        HIGH,
      ],
      [
        `Proxy-Authorization: Basic ${BASIC_CREDENTIALS}`,
        BASIC_CREDENTIALS,
        HIGH,
      ],
    ],
    refused: [
      "Authorization: Basic notbase64",
      `Authorization: Basic ${btoa("no-colon-here")}`,
      `Authorization: Basic ${btoa("user:password")}`,
      "Authorization: Bearer short-token",
      `Authorization: Bearer ${"x".repeat(40)}`,
      "Authorization: Bearer $TOKEN",
      "Authorization: Bearer <token>",
      `Bearer ${BEARER_TOKEN}`,
    ],
    testValues: [
      `Authorization: Basic ${btoa("Aladdin:open sesame")}`,
      `Authorization: Bearer EXAMPLE${fake(URL_SAFE, 30)}`,
    ],
  },
  "generic-secret": {
    found: [
      [`DB_PASSWORD=${GENERIC_PASSWORD}`, GENERIC_PASSWORD, MEDIUM],
      [
        `{"name": "billing", "api_key": "${GENERIC_VALUE}"}`,
        GENERIC_VALUE,
        MEDIUM,
      ],
      [`client_secret: ${GENERIC_VALUE}`, GENERIC_VALUE, MEDIUM],
      [`  'smtpPassword' => '${GENERIC_PASSWORD}',`, GENERIC_PASSWORD, MEDIUM],
      [
        `./migrate --password=${GENERIC_PASSWORD} --host db`,
        GENERIC_PASSWORD,
        MEDIUM,
      ],
      [`SECRET_KEY = "${GENERIC_VALUE}"`, GENERIC_VALUE, MEDIUM],
      [`accessToken := "${GENERIC_VALUE}"`, GENERIC_VALUE, MEDIUM],
      [`{\\"password\\":\\"${GENERIC_PASSWORD}\\"}`, GENERIC_PASSWORD, MEDIUM],
      // Next to a word that says it is a sample, a level lower.
      [
        `# example settings\npassword=${GENERIC_PASSWORD}`,
        GENERIC_PASSWORD,
        LOW,
      ],
    ],
    refused: [
      "password=changeme",
      "password=changeme123!",
      "password: ${PASSWORD}",
      '"password": "********"',
      'password = "<your password>"',
      "password=Sh0rt!x",
      "secretary: Jane Smith",
      "passwordless=enabled-2024",
      `password: $2b$12$${fake(BASE64, 53)}`,
      "api_key = process.env.API_KEY",
      "PWD=/Users/someone/projects/app-2024",
      "password = aaaaaaaaaaaaaaaa1",
      `token=${GENERIC_VALUE}`,
      "secret: db-password-secret-v2",
      "password=https://vault.internal/v1/secret/db",
      "api_key: 2024-03-15T14:27:39.123Z",
      "secret_name: prod/db/postgres-2024",
      "password=correcthorsebatterystaple",
      `password=${fake(BASE64, 129)}`,
      // A key with nothing after it does not take the next line's text.
      "postgresql:\n  # Auto-generated if not provided\n  password:\n  architecture: standalone",
      "GITHUB_APP_CLIENT_SECRET=\nGITHUB_APP_PRIVATE_KEY=\nGITHUB_APP_WEBHOOK_SECRET=",
      // Interface text, in any language.
      '{"Change Password": "\u30d1\u30b9\u30ef\u30fc\u30c9\u3092\u5909\u66f4", "Signing secret": "\u7f72\u540d\u30b7\u30fc\u30af\u30ec\u30c3\u30c8"}',
      '{"Username/Password": "Benutzername/Passwort"}',
      '{"vCenter Password": "Contrase\u00f1a del vCenter"}',
      // Code that reads the secret.
      'await this.deliverEmail({ secretKey: req.body?.["secretKey"] });',
      "const password = getPassword(user);",
      'api_key = os.environ["API_KEY"]',
      "secret = settings.vault2",
      "data: { incomingRequestSecretKey: monitor.id!, }",
      "const DYNAMICS_ACCESS_TOKEN: WorkflowTemplateOAuth2Variable = {",
      // Placeholders in the code of tests and examples.
      'const API_KEY = "sk-smoke-test-0123456789";',
      'const hexSecret = "0123456789abcdef0123456789abcdef"',
      'const BROWSER_KEY_SECRET = "acme-browser-key-9876543210";',
    ],
    testValues: [
      `secret_key=EXAMPLE${fake(ALNUM, 16)}`,
      // Google Authenticator's sample seed.
      "otpauth://totp/OneUptime:alex?secret=JBSWY3DPEHPK3PXP&issuer=OneUptime",
    ],
  },
  "bitcoin-private-key": {
    found: [
      [`wallet.importPrivKey("${WIF}")`, WIF, HIGH],
      [`wif: ${WIF_COMPRESSED}`, WIF_COMPRESSED, HIGH],
    ],
    refused: [
      // One character changed: the checksum fails.
      `wif: ${WIF.slice(0, -1)}${WIF.endsWith("2") ? "3" : "2"}`,
      `wif: ${WIF.slice(0, -1)}`,
      `wif: x${WIF}`,
      // A key of another coin's version byte.
      `wif: ${walletImportKey(WALLET_KEY, false, 0xb0)}`,
    ],
    testValues: [
      `wif: ${walletImportKey(WALLET_KEY, false, 0xef)}`,
      `wif: ${walletImportKey(WALLET_KEY, true, 0xef)}`,
      `wif: ${walletImportKey(bytesOfHex("0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d"), false)}`,
    ],
  },
};

const SECRET_TYPES: Array<string> = DATA_TYPE_CATALOG.filter(
  (info: DataTypeInfo) => {
    return info.category === DataCategory.SecretsAndCredentials;
  },
).map((info: DataTypeInfo) => {
  return info.id;
});

describe("SECRET_DETECTORS", () => {
  test("finds every secrets-and-credentials type of the catalog, and only those", () => {
    const covered: Set<string> = new Set(
      SECRET_DETECTORS.map((detector: DataTypeDetector) => {
        return detector.dataTypeId;
      }),
    );

    expect(SECRET_TYPES).toHaveLength(40);
    expect([...covered].sort()).toEqual([...SECRET_TYPES].sort());
    expect(Object.keys(CASES).sort()).toEqual([...SECRET_TYPES].sort());
  });

  /*
   * Every quantifier bounded and none inside another's group: what keeps
   * V8's backtracking shallow on megabyte-long values (AGENTS.md). Read
   * with the parser LinearRegExp compiles patterns with.
   */
  function quantifierProblems(
    node: SyntaxNode,
    insideRepeat: boolean,
  ): Array<string> {
    switch (node.kind) {
      case "Repeat": {
        const problems: Array<string> = [];

        if (!Number.isFinite(node.max)) {
          problems.push(`unbounded {${node.min},}`);
        }

        if (insideRepeat) {
          problems.push("a quantifier inside a quantified group");
        }

        return [...problems, ...quantifierProblems(node.body, true)];
      }
      case "Group":
      case "Lookaround":
        return quantifierProblems(node.body, insideRepeat);
      case "Alternation":
      case "Sequence": {
        const problems: Array<string> = [];
        const children: Array<SyntaxNode> =
          node.kind === "Alternation" ? node.options : node.items;

        for (const child of children) {
          problems.push(...quantifierProblems(child, insideRepeat));
        }

        return problems;
      }
      default:
        return [];
    }
  }

  test.each(
    SECRET_DETECTORS.map((detector: DataTypeDetector, index: number) => {
      return [`${detector.dataTypeId} #${index}`, detector];
    }),
  )(
    "%s: its pattern is global, bounded, nests no quantifier and stands apart from longer tokens",
    (_name: string, detector: DataTypeDetector) => {
      const pattern: RegExp = detector.pattern;

      expect(pattern.global).toBe(true);

      const root: SyntaxNode = parsePattern(pattern.source, {
        ignoreCase: pattern.ignoreCase,
        multiline: pattern.multiline,
        dotAll: pattern.dotAll,
      }).root;

      expect(quantifierProblems(root, false)).toEqual([]);

      // It starts with a look-behind and ends with a look-ahead.
      expect(root.kind).toBe("Sequence");

      if (root.kind === "Sequence") {
        const first: SyntaxNode = root.items[0]!;
        const last: SyntaxNode = root.items[root.items.length - 1]!;

        expect(first.kind === "Lookaround" && first.behind).toBe(true);
        expect(last.kind === "Lookaround" && !last.behind).toBe(true);
      }
    },
  );

  test("puts a value group at the end of its match, so a value's place is the match's end less its length", () => {
    for (const [dataTypeId, cases] of Object.entries(CASES)) {
      for (const [text] of cases.found) {
        for (const detector of detectorsOf(dataTypeId)) {
          for (const match of text.matchAll(detector.pattern)) {
            const value: string | undefined = match[detector.valueGroup || 0];

            expect([
              dataTypeId,
              value !== undefined && match[0].endsWith(value),
            ]).toEqual([dataTypeId, true]);
          }
        }
      }
    }
  });

  describe.each(Object.entries(CASES))(
    "%s",
    (dataTypeId: string, cases: SecretCase) => {
      test("finds it where it leaks to", () => {
        for (const [text, value, confidence] of cases.found) {
          expect([text, scan(dataTypeId, text)]).toEqual([
            text,
            expect.arrayContaining([
              { value: value, confidence: confidence, isTestValue: false },
            ]),
          ]);
        }
      });

      test("refuses what is nearly, but not, the thing", () => {
        for (const text of cases.refused) {
          expect([text, scan(dataTypeId, text)]).toEqual([text, []]);
        }
      });

      test("counts documented examples and placeholders as test values", () => {
        for (const text of cases.testValues) {
          const found: Array<Found> = scan(dataTypeId, text);

          expect([
            text,
            found.length > 0,
            found.every((one: Found) => {
              return one.isTestValue;
            }),
          ]).toEqual([text, true, true]);
        }
      });

      const needsContext: boolean = detectorsOf(dataTypeId).some(
        (detector: DataTypeDetector) => {
          return Boolean(detector.requiresContext);
        },
      );

      test(
        needsContext
          ? "counts it only next to words that name it"
          : "counts it with no words around it",
        () => {
          if (!needsContext) {
            expect(cases.withoutContext).toBeUndefined();
            return;
          }

          expect((cases.withoutContext || []).length).toBeGreaterThan(0);

          for (const text of cases.withoutContext || []) {
            expect([text, scan(dataTypeId, text)]).toEqual([text, []]);
          }
        },
      );
    },
  );

  /*
   * A provider's key assigned to a field, or sent as a bearer token, is
   * claimed by two detectors; the scanner keeps the surer and more specific
   * (confidence first, then specificity).
   */
  test("lets a provider's own detector outrank the generic and header detectors on the same characters", () => {
    const score: (found: Found, dataTypeId: string) => number = (
      found: Found,
      dataTypeId: string,
    ): number => {
      return (
        DATA_CONFIDENCE_RANK[found.confidence] * 10 +
        detectorsOf(dataTypeId)[0]!.specificity
      );
    };

    const pairs: Array<[string, string, string]> = [
      [
        `STRIPE_API_KEY=sk_live_${fake(ALNUM, 24)}`,
        "stripe-secret-key",
        "generic-secret",
      ],
      [
        `Authorization: Bearer ${JWT}`,
        "json-web-token",
        "authorization-header",
      ],
      [
        `Authorization: token ${GITHUB_TOKEN}`,
        "github-token",
        "authorization-header",
      ],
      [
        `Server=sql.internal;User Id=svc;Password=${CONNECTION_PASSWORD};`,
        "connection-string-password",
        "generic-secret",
      ],
    ];

    for (const [text, winner, loser] of pairs) {
      const won: Found | undefined = scan(winner, text)[0];
      const lost: Found | undefined = scan(loser, text)[0];

      expect([text, Boolean(won), Boolean(lost)]).toEqual([text, true, true]);
      expect(score(won!, winner)).toBeGreaterThan(score(lost!, loser));
    }
  });

  test("judges a bare value in a field named for a secret by the same rules", () => {
    const detector: DataTypeDetector = detectorsOf("generic-secret")[0]!;
    const shape: RegExp = detector.fieldValuePattern!;

    expect(shape.global).toBe(false);

    for (const value of [GENERIC_PASSWORD, GENERIC_VALUE]) {
      expect([value, shape.test(value) && isGenericSecretValue(value)]).toEqual(
        [value, true],
      );
    }

    for (const value of [
      `$2b$12$${fake(BASE64, 53)}`,
      "2024-03-15T14:27:39.123Z",
      "What was the name of your first pet?",
      "changeme",
      "1234567890",
      "hunter2",
    ]) {
      expect([value, shape.test(value) && isGenericSecretValue(value)]).toEqual(
        [value, false],
      );
    }
  });
});

describe("decodeBase64", () => {
  test("reads both alphabets, padded or not, and refuses what is not base64", () => {
    expect(Array.from(decodeBase64(btoa("user:pass"))!)).toEqual(
      Array.from(bytesOfText("user:pass")),
    );
    expect(Array.from(decodeBase64(base64Url("\u00fb\u00ef\u00bf"))!)).toEqual([
      0xfb, 0xef, 0xbf,
    ]);
    expect(Array.from(decodeBase64("YQ")!)).toEqual([0x61]);
    expect(Array.from(decodeBase64("")!)).toEqual([]);

    for (const notBase64 of ["Y", "YQ=", "YQ===", "Y=Q=", "a!bc", "YWJj\n"]) {
      expect([notBase64, decodeBase64(notBase64)]).toEqual([notBase64, null]);
    }
  });

  test("gives the user and password a Basic credential holds", () => {
    expect(basicCredentials(btoa("svc:s3cret"))).toBe("svc:s3cret");
    expect(basicCredentials(btoa("svc:"))).toBeNull();
    expect(basicCredentials(btoa("svc\u0000:x"))).toBeNull();
  });
});

describe("isPlaceholderSecret", () => {
  test("knows the placeholders documentation and templates write", () => {
    for (const placeholder of [
      "password",
      "Password123!",
      "changeme",
      "your-api-key",
      "YOUR_SECRET_HERE",
      "put-your-token-here",
      "my_password",
      "<password>",
      "${DB_PASSWORD}",
      "{{ secret }}",
      "$DB_PASSWORD",
      "%DB_PASS%",
      "%s",
      "__PASSWORD__",
      "********",
      "sk-xxxx1234",
      "xxxxxxxx",
      "null",
      "undefined",
      "true",
      "test1234",
      "redacted",
      "hunter2",
      "sk-smoke-test-0123456789",
      "0123456789abcdef",
      "Pa$$w0rd!",
    ]) {
      expect([placeholder, isPlaceholderSecret(placeholder)]).toEqual([
        placeholder,
        true,
      ]);
    }
  });

  test("leaves real-looking secrets, and documented examples, to the detectors", () => {
    for (const secret of [
      GENERIC_PASSWORD,
      GENERIC_VALUE,
      "EXAMPLEpassword",
      "Kx9#mP2q",
    ]) {
      expect([secret, isPlaceholderSecret(secret)]).toEqual([secret, false]);
    }
  });
});

/*
 * Every pattern over two megabytes of text made of what secrets are made
 * of - prefixes, separators, long runs of token characters - in time in
 * line with its length. The scanner hands patterns 64 KB windows; this is
 * thirty times that, under every pattern at once.
 */
describe("SECRET_DETECTORS on megabytes", () => {
  const TWO_MEGABYTES: number = 2 * 1024 * 1024;

  const PIECES: ReadonlyArray<string> = [
    "a",
    "Z",
    "7",
    "x",
    "_",
    "-",
    ".",
    "/",
    "+",
    "=",
    "==",
    ":",
    ";",
    "&",
    "?",
    "@",
    "%",
    "$",
    "~",
    '"',
    "'",
    "\\",
    " ",
    "\n",
    "{",
    "}",
    "AKIA",
    "ghp_",
    "github_pat_",
    "xoxb-1234-",
    "sk-",
    "sk-ant-api03-",
    "sk_live_",
    "eyJ",
    "-----BEGIN ",
    "PRIVATE KEY-----",
    "://",
    "user:",
    "password=",
    "Password=",
    "PWD=",
    "api_key: ",
    "Authorization: Bearer ",
    "authorization: basic ",
    "sv=2024-01-01&",
    "&sig=",
    "AccountKey=",
    "hooks.slack.com/services/T",
    "AIza",
    "GOCSPX-",
    "glpat-",
    "SG.",
    "key-",
    "-us1",
    "T3BlbkFJ",
    "hf_",
    "npm_",
    "pypi-AgEIcHlwaS5vcmc",
    "dckr_pat_",
    "shpat_",
    "EAAA",
    "sq0atp-",
    "access_token$production$",
    "dop_v1_",
    "NRAK-",
    "hvs.",
    ".atlasv1.",
    "ATATT3",
    "lin_api_",
    'private_key_id": "',
    "8Q~",
    "SK",
    "PuTTY-User-Key-File-2: ",
    fake(ALNUM, 300),
    fake(BASE64, 200),
    fake(HEX, 120),
    fake(URL_SAFE, 500),
    "x".repeat(400),
    "A ".repeat(40),
  ];

  const text: string = generatedTexts(4000, 5150, PIECES, 120)
    .join("")
    .slice(0, TWO_MEGABYTES);

  test("is two megabytes long", () => {
    expect(text.length).toBe(TWO_MEGABYTES);
  });

  test.each(
    SECRET_DETECTORS.map((detector: DataTypeDetector, index: number) => {
      return [`${detector.dataTypeId} #${index}`, detector];
    }),
  )(
    "%s reads them in well under a second",
    (_name: string, detector: DataTypeDetector) => {
      const timed: FastestRun<number> = fastestRun({
        run: (): number => {
          return Array.from(text.matchAll(detector.pattern)).length;
        },
        limitInMs: 1000,
      });

      expect(timed.inMs).toBeLessThan(1000);
    },
  );
});
