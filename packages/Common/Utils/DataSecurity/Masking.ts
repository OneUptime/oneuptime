import DataCategory from "../../Types/DataSecurity/DataCategory";
import {
  DataTypeInfo,
  getBuiltInDataType,
} from "../../Types/DataSecurity/DataTypeCatalog";

/*
 * MASKED EVIDENCE: ENOUGH OF A VALUE TO RECOGNISE IT, NEVER ENOUGH TO USE IT.
 *
 * A finding keeps up to three samples so a person can tell a real customer
 * email from a test fixture, and a card number from an order ID. Every
 * sample is masked here, in the scanner, before it leaves the scan - so no
 * screen, notification or database row of OneUptime ever holds a raw value.
 *
 * What each kind keeps:
 *
 *  - Email: the first character of the name and of the domain, and the
 *    top-level label - j***@e******.com.
 *  - Card number: the last four digits only, as PCI DSS allows a card to be
 *    displayed - **** **** **** 4242.
 *  - Secrets: the first four and last four characters of a long secret (the
 *    prefix says which kind; the suffix tells two apart), two of a short
 *    one, and nothing of a private key's body.
 *  - A URL or connection string: everything except the password.
 *  - Any other value: its last two to four characters, with separators kept
 *    so the shape still reads (***-**-6789).
 */

const MASK: string = "*";

function isAlphanumeric(character: string): boolean {
  const code: number = character.charCodeAt(0);

  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code > 127
  );
}

function maskAllButLast(value: string, keep: number): string {
  let alphanumericSeen: number = 0;
  let total: number = 0;

  for (const character of value) {
    if (isAlphanumeric(character)) {
      total++;
    }
  }

  let masked: string = "";

  for (const character of value) {
    if (isAlphanumeric(character)) {
      alphanumericSeen++;
      masked += alphanumericSeen > total - keep ? character : MASK;
    } else {
      masked += character;
    }
  }

  return masked;
}

// A name or label: its first character, then a fixed-width mask.
function maskWord(value: string): string {
  return value.length === 0 ? "" : value[0] + MASK.repeat(4);
}

export function maskEmail(email: string): string {
  const at: number = email.lastIndexOf("@");

  if (at < 1) {
    return maskAllButLast(email, 2);
  }

  const local: string = email.slice(0, at);
  const domain: string = email.slice(at + 1);
  const lastDot: number = domain.lastIndexOf(".");
  const host: string = lastDot > 0 ? domain.slice(0, lastDot) : domain;
  const topLevel: string = lastDot > 0 ? domain.slice(lastDot) : "";

  return (
    local[0] +
    MASK.repeat(3) +
    "@" +
    host[0] +
    MASK.repeat(Math.max(2, Math.min(host.length - 1, 8))) +
    topLevel
  );
}

export function maskCardNumber(value: string): string {
  const digits: string = value.replace(/[^0-9]/g, "");

  return "**** **** **** " + digits.slice(-4);
}

export function maskSecret(value: string): string {
  if (value.includes("-----BEGIN")) {
    const header: RegExpMatchArray | null = value.match(
      /-----BEGIN [A-Z0-9 ]{1,40}-----/,
    );

    return (header ? header[0] : "-----BEGIN PRIVATE KEY-----") + " (hidden)";
  }

  if (value.length >= 16) {
    return (
      value.slice(0, 4) +
      MASK.repeat(Math.min(value.length - 8, 12)) +
      value.slice(-4)
    );
  }

  return value.slice(0, 2) + MASK.repeat(Math.max(value.length - 2, 3));
}

/*
 * scheme://user:password@host -> scheme://user:****@host (the user may be
 * empty, as in redis://:password@host), and Password=****.
 */
export function maskCredentialsInText(value: string): string {
  return value
    .replace(
      /(:\/\/[^\s:@/]{0,64}:)[^\s@/]{1,128}(@)/g,
      (_match: string, before: string, after: string) => {
        return before + MASK.repeat(4) + after;
      },
    )
    .replace(
      /((?:password|pwd)\s{0,3}=\s{0,3})[^;\s]{1,128}/gi,
      (_match: string, before: string) => {
        return before + MASK.repeat(4);
      },
    );
}

// The longest a masked sample may be, so one sample cannot carry a document.
export const MAX_MASKED_SAMPLE_LENGTH: number = 96;

export function maskValue(dataTypeId: string, value: string): string {
  const info: DataTypeInfo | undefined = getBuiltInDataType(dataTypeId);
  const bounded: string = value.slice(0, 512);
  let masked: string;

  if (dataTypeId === "email-address") {
    masked = maskEmail(bounded);
  } else if (dataTypeId === "credit-card-number") {
    masked = maskCardNumber(bounded);
  } else if (
    dataTypeId === "password-in-url" ||
    dataTypeId === "connection-string-password"
  ) {
    const withoutCredentials: string = maskCredentialsInText(bounded);

    // A value that is the password alone - a detector's value group - is a secret.
    masked =
      withoutCredentials === bounded ? maskSecret(bounded) : withoutCredentials;
  } else if (info?.category === DataCategory.SecretsAndCredentials) {
    masked = maskSecret(bounded);
  } else if (dataTypeId === "ip-address") {
    // Keep the first part of the address: the network, not the host.
    const separator: string = bounded.includes(":") ? ":" : ".";
    const parts: Array<string> = bounded.split(separator);

    masked = [
      parts[0],
      ...parts.slice(1).map(() => {
        return MASK.repeat(3);
      }),
    ].join(separator);
  } else if (info?.category === DataCategory.BusinessConfidential) {
    // A marking is what the document says about itself, not a secret.
    masked = bounded;
  } else if (info?.foundBy === "name") {
    masked = maskWord(bounded);
  } else {
    masked = maskAllButLast(bounded, bounded.length > 8 ? 4 : 2);
  }

  return masked.length > MAX_MASKED_SAMPLE_LENGTH
    ? masked.slice(0, MAX_MASKED_SAMPLE_LENGTH - 1) + "…"
    : masked;
}
