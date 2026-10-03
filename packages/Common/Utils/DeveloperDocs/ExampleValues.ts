import { JSONValue } from "../../Types/JSON";
import {
  TerraformAttributeDescriptor,
  TerraformValueKind,
} from "./TerraformSchema";

/*
 * What the Developer pages' examples share: where the API key comes from,
 * and the example values a new resource is started from.
 */

/*
 * The environment variable every example reads the API key from. It is the
 * one the Terraform provider reads, so a single `export` serves the
 * Terraform, API and AI pages alike, and no key is ever written into a
 * command or a configuration.
 */
export const ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE: string =
  "ONEUPTIME_API_KEY";

/*
 * Product and technology names that keep their capital in a sentence:
 * "Kubernetes cluster", not "kubernetes cluster".
 */
const PROPER_NOUNS: ReadonlyArray<string> = [
  "Docker",
  "Swarm",
  "Kubernetes",
  "Podman",
  "Proxmox",
  "Ceph",
  "VMware",
  "OneUptime",
];

// A word written the ordinary way: a capital, then lower case ("Policy", "On").
const TITLE_CASE_WORD: RegExp = /^[A-Z][a-z0-9']*$/;

/*
 * A resource's name for use inside a sentence: "Status Page" -> "status
 * page", "On-Call Policy" -> "on-call policy", while acronyms and names keep
 * their capitals: "AI insight", "SLOs", "IoT fleet", "Kubernetes cluster",
 * "vCenter".
 */
export function toSentenceCaseName(name: string): string {
  return name
    .split(" ")
    .map((word: string): string => {
      return word
        .split("-")
        .map((part: string): string => {
          return TITLE_CASE_WORD.test(part) && !PROPER_NOUNS.includes(part)
            ? part.toLowerCase()
            : part;
        })
        .join("-");
    })
    .join(" ");
}

/*
 * Words that start with a vowel letter but a consonant sound ("a user", "a
 * unique name", "a one-off job"), and the acronyms people read as a word
 * rather than letter by letter ("a RUM application", not "an R-U-M").
 */
const VOWEL_LETTER_CONSONANT_SOUND: ReadonlyArray<string> = [
  "one",
  "once",
  "uniform",
  "union",
  "unique",
  "unit",
  "universal",
  "url",
  "usage",
  "use",
  "used",
  "user",
  "users",
  "usual",
  "utility",
  "uuid",
];

const ACRONYMS_READ_AS_WORDS: ReadonlyArray<string> = ["RUM", "SAML", "SCIM"];

/*
 * Letters whose name starts with a vowel sound, for acronyms read letter by
 * letter: "an SLO" (es-el-oh), "an HTTP monitor", "an MCP tool", but "a
 * DNS record", "a TLS certificate".
 */
const VOWEL_SOUND_LETTERS: string = "AEFHILMNORSX";

// A word made of capitals (and digits), at least two letters: "SLO", "IoT" is not one.
const ACRONYM: RegExp = /^[A-Z][A-Z0-9]+$/;

// "IoT", "vCenter": a lower-case letter where a word would have a capital.
const MIXED_CASE_ACRONYM: RegExp = /^[A-Za-z][a-z]?[A-Z]/;

/*
 * The indefinite article for a phrase: "an incident", "a monitor", "an
 * on-call policy", "an SLO", "an IoT fleet", "a RUM application", "a user".
 */
export function getIndefiniteArticle(phrase: string): "a" | "an" {
  const firstWord: string = phrase.trim().split(/[\s-]+/)[0] || "";

  if (!firstWord) {
    return "a";
  }

  if (ACRONYMS_READ_AS_WORDS.includes(firstWord)) {
    return "a";
  }

  /*
   * Read letter by letter, so the name of the first letter decides: "an
   * SLO", "an IoT fleet", "a vCenter" (vee-center), "a URL" (you-are-el).
   */
  if (ACRONYM.test(firstWord) || MIXED_CASE_ACRONYM.test(firstWord)) {
    return VOWEL_SOUND_LETTERS.includes(firstWord.charAt(0).toUpperCase())
      ? "an"
      : "a";
  }

  const lower: string = firstWord.toLowerCase();

  if (
    VOWEL_LETTER_CONSONANT_SOUND.some((word: string): boolean => {
      return lower === word || lower.startsWith(`${word}-`);
    })
  ) {
    return "a";
  }

  return "aeiou".includes(lower.charAt(0)) ? "an" : "a";
}

// "an incident", "a monitor", "an SLO".
export function withIndefiniteArticle(phrase: string): string {
  return `${getIndefiniteArticle(phrase)} ${phrase}`;
}

// `export ONEUPTIME_API_KEY="your-api-key"`.
export function getApiKeyExportCommand(): string {
  return `export ${ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE}="your-api-key"`;
}

/*
 * An example value for a field a new resource must have: "My workflow" for
 * its name, the field's default or documented example when it has one, and
 * a placeholder to replace otherwise ("<incident severity id>").
 */
export function getExampleJsonValue(data: {
  descriptor: TerraformAttributeDescriptor;
  singularName: string;
  isNameColumn: boolean;
}): JSONValue {
  const { descriptor } = data;

  if (data.isNameColumn) {
    return `My ${toSentenceCaseName(data.singularName)}`;
  }

  if (descriptor.defaultValue !== undefined) {
    return descriptor.defaultValue;
  }

  switch (descriptor.kind) {
    case TerraformValueKind.Number:
      return typeof descriptor.example === "number" ? descriptor.example : 1;
    case TerraformValueKind.Bool:
      return true;
    case TerraformValueKind.DateTime:
      return "2030-01-01T00:00:00.000Z";
    case TerraformValueKind.IdSet:
    case TerraformValueKind.StringSet:
      return [];
    case TerraformValueKind.Json:
      return {};
    default:
      break;
  }

  if (descriptor.columnName.endsWith("Id")) {
    return `<${descriptor.title.replace(/\s*ID$/i, "").toLowerCase()} id>`;
  }

  if (typeof descriptor.example === "string" && descriptor.example.length > 0) {
    return descriptor.example;
  }

  return `<${descriptor.title.toLowerCase()}>`;
}
