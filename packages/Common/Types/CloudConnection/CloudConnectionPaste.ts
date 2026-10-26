import { CloudProvider } from "../Cloud/CloudPlatform";
import {
  AZURE_SECRET_EXPIRES_AT_KEY,
  CloudConnectionAuthMethod,
} from "./CloudConnectionCatalog";

/*
 * WHAT THE SETUP COMMAND PRINTED, READ INTO THE FORM'S FIELDS.
 *
 * The setup step asks for one paste: everything the cloud's terminal
 * printed after the command ran (CloudConnectionSetupCommands). Terminals
 * print more than the values - a warning before Azure's JSON, the lines
 * gcloud writes as it goes - so the text is searched, not parsed whole:
 *
 *   - AWS, IAM role: the role's ARN;
 *   - AWS, access key: the AccessKey JSON create-access-key prints, or the
 *     two values on their own;
 *   - Azure: the appId, password and tenant JSON create-for-rbac prints,
 *     and the endDateTime the setup command adds to it;
 *   - Google Cloud: the service account key JSON.
 *
 * Every reader runs in time linear in the text, which is held to
 * MAX_PASTE_LENGTH first: it is what a person pasted, and nothing a
 * terminal prints for these commands comes near it.
 */

export const MAX_PASTE_LENGTH: number = 64 * 1024;

export interface CloudConnectionPasteResult {
  // Config keys and values found (catalog keys).
  config: Record<string, string>;
  // Secret keys and values found (catalog keys).
  secrets: Record<string, string>;
}

const EMPTY: CloudConnectionPasteResult = { config: {}, secrets: {} };

/*
 * Every top-level JSON object in the text, in order, parsed. One pass that
 * counts braces outside strings, so a brace inside a value (a private key,
 * a password) does not end the object early.
 */
export function findJsonObjects(text: string): Array<Record<string, unknown>> {
  const objects: Array<Record<string, unknown>> = [];
  let depth: number = 0;
  let start: number = -1;
  let inString: boolean = false;
  let escaped: boolean = false;

  for (let index: number = 0; index < text.length; index++) {
    const character: string = text[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      // Strings only count inside an object; a stray quote outside is text.
      if (depth > 0) {
        inString = true;
      }

      continue;
    }

    if (character === "{") {
      if (depth === 0) {
        start = index;
      }

      depth++;
      continue;
    }

    if (character === "}" && depth > 0) {
      depth--;

      if (depth === 0 && start >= 0) {
        try {
          const parsed: unknown = JSON.parse(text.slice(start, index + 1));

          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            objects.push(parsed as Record<string, unknown>);
          }
        } catch {
          // Not JSON after all: keep looking.
        }

        start = -1;
      }
    }
  }

  return objects;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Whitespace-separated words, without a regular expression.
function words(text: string): Array<string> {
  const result: Array<string> = [];
  let current: string = "";

  for (const character of text) {
    if (
      character === " " ||
      character === "\t" ||
      character === "\n" ||
      character === "\r"
    ) {
      if (current) {
        result.push(current);
        current = "";
      }

      continue;
    }

    current += character;
  }

  if (current) {
    result.push(current);
  }

  return result;
}

// Letters and digits only.
function isAlphanumeric(value: string): boolean {
  for (const character of value) {
    const code: number = character.charCodeAt(0);
    const isDigit: boolean = code >= 48 && code <= 57;
    const isUpper: boolean = code >= 65 && code <= 90;
    const isLower: boolean = code >= 97 && code <= 122;

    if (!isDigit && !isUpper && !isLower) {
      return false;
    }
  }

  return value.length > 0;
}

/*
 * An access key id as AWS prints it: AKIA (long-lived) or ASIA
 * (temporary) and 16 more letters or digits.
 */
export function looksLikeAwsAccessKeyId(value: string): boolean {
  return (
    value.length === 20 &&
    (value.startsWith("AKIA") || value.startsWith("ASIA")) &&
    isAlphanumeric(value)
  );
}

function readAwsAccessKey(text: string): CloudConnectionPasteResult {
  for (const object of findJsonObjects(text)) {
    const holder: Record<string, unknown> =
      object["AccessKey"] &&
      typeof object["AccessKey"] === "object" &&
      !Array.isArray(object["AccessKey"])
        ? (object["AccessKey"] as Record<string, unknown>)
        : object;
    const accessKeyId: string = readString(holder["AccessKeyId"]);
    const secretAccessKey: string = readString(holder["SecretAccessKey"]);

    if (accessKeyId || secretAccessKey) {
      return {
        config: accessKeyId ? { accessKeyId } : {},
        secrets: secretAccessKey ? { secretAccessKey } : {},
      };
    }
  }

  // The two values on their own: "AKIA... secret", as --output text prints.
  const parts: Array<string> = words(text);

  for (let index: number = 0; index < parts.length; index++) {
    const part: string = parts[index]!;

    if (looksLikeAwsAccessKeyId(part)) {
      const next: string = parts[index + 1] || "";

      return {
        config: { accessKeyId: part },
        // A secret is 40 characters; anything that short is not one.
        secrets: next.length >= 30 ? { secretAccessKey: next } : {},
      };
    }
  }

  return EMPTY;
}

/*
 * An IAM role ARN: arn:<partition>:iam::<12 digits>:role/<path and name>.
 * Checked piece by piece rather than with one pattern.
 */
export function isAwsRoleArn(value: string): boolean {
  const parts: Array<string> = value.split(":");

  if (parts.length !== 6 || parts[0] !== "arn" || parts[2] !== "iam") {
    return false;
  }

  const partition: string = parts[1]!;
  const accountId: string = parts[4]!;
  const resource: string = parts[5]!;

  if (
    partition !== "aws" &&
    partition !== "aws-us-gov" &&
    partition !== "aws-cn"
  ) {
    return false;
  }

  if (parts[3] !== "" || accountId.length !== 12) {
    return false;
  }

  for (const character of accountId) {
    if (character < "0" || character > "9") {
      return false;
    }
  }

  if (!resource.startsWith("role/") || resource.length <= 5) {
    return false;
  }

  // IAM names and paths: letters, digits and +=,.@_-/ - at most 512 long.
  if (resource.length > 517) {
    return false;
  }

  for (const character of resource.slice(5)) {
    if (!isAlphanumeric(character) && !"+=,.@_-/".includes(character)) {
      return false;
    }
  }

  return !resource.endsWith("/");
}

function readAwsRole(text: string): CloudConnectionPasteResult {
  for (const part of words(text)) {
    // Quotes and a trailing comma, as a JSON line would hold it.
    const candidate: string = part
      .split('"')
      .join("")
      .split(",")
      .join("")
      .trim();

    if (isAwsRoleArn(candidate)) {
      return { config: { roleArn: candidate }, secrets: {} };
    }
  }

  return EMPTY;
}

function readAzure(text: string): CloudConnectionPasteResult {
  for (const object of findJsonObjects(text)) {
    const tenantId: string =
      readString(object["tenant"]) || readString(object["tenantId"]);
    const clientId: string =
      readString(object["appId"]) || readString(object["clientId"]);
    const clientSecret: string =
      readString(object["password"]) || readString(object["clientSecret"]);

    if (tenantId || clientId || clientSecret) {
      const config: Record<string, string> = {};

      if (tenantId) {
        config["tenantId"] = tenantId;
      }

      if (clientId) {
        config["clientId"] = clientId;
      }

      // When the password stops working, as the setup command adds it.
      const expiresAt: number = Date.parse(readString(object["endDateTime"]));

      if (Number.isFinite(expiresAt)) {
        config[AZURE_SECRET_EXPIRES_AT_KEY] = new Date(expiresAt).toISOString();
      }

      return {
        config,
        secrets: clientSecret ? { clientSecret } : {},
      };
    }
  }

  return EMPTY;
}

function readGcp(text: string): CloudConnectionPasteResult {
  for (const object of findJsonObjects(text)) {
    if (
      readString(object["type"]) === "service_account" ||
      (readString(object["client_email"]) && readString(object["private_key"]))
    ) {
      // The key as a document of its own, whatever surrounded it.
      return {
        config: {},
        secrets: { serviceAccountJson: JSON.stringify(object, null, 2) },
      };
    }
  }

  return EMPTY;
}

/*
 * The fields a paste fills in, for a cloud and sign-in method. Empty when
 * nothing in it is recognised.
 */
export function readCloudConnectionPaste(
  provider: CloudProvider | string,
  method: CloudConnectionAuthMethod,
  pasted: string,
): CloudConnectionPasteResult {
  const text: string = (pasted || "").slice(0, MAX_PASTE_LENGTH);

  if (!text.trim()) {
    return EMPTY;
  }

  if (provider === CloudProvider.AWS) {
    return method === CloudConnectionAuthMethod.AwsRole
      ? readAwsRole(text)
      : readAwsAccessKey(text);
  }

  if (provider === CloudProvider.Azure) {
    return readAzure(text);
  }

  if (provider === CloudProvider.GCP) {
    return readGcp(text);
  }

  return EMPTY;
}
