import SubscriberNotificationTemplateCompiler from "../StatusPage/SubscriberNotificationTemplateCompiler";

/*
 * The key an incident custom field is reached by in a template:
 * {{incident.customFields.<key>}} in an incident note template and in a
 * status page's custom subscriber notification template, and in anything
 * else that fills placeholders the same way.
 *
 * Why a key at all, rather than the field's name: values are stored under
 * the display name ("Expected Resolution"), and a name can hold anything a
 * person types - spaces, hyphens, accents, emoji, other scripts. The template
 * compiler only fills placeholders made of ASCII word characters and dots
 * (SubscriberNotificationTemplateCompiler.isPlaceholderName), so a name is
 * not something a template can refer to. The key is made from the name once,
 * when the field is created, and never changes: renaming a field must not
 * silently break every template that already uses it.
 *
 * Why not Slug.getSlug: it joins words with hyphens and appends a random
 * number, and a hyphen is exactly what the placeholder pattern rejects.
 *
 * The shape: lowercase letters and digits in runs joined by single
 * underscores - "expected_resolution" - with no leading, trailing or doubled
 * underscore. A key already taken in the project gets "_2", "_3", ... in the
 * order fields were created.
 *
 * Pure, and free of database and React imports, so the service that stamps a
 * new field, the migration that stamps the existing ones and the dashboard
 * all produce the same key from the same name.
 */

/*
 * Long enough for any name a person would give a field, short enough to type
 * into a template. The column itself allows 100 characters.
 */
export const CUSTOM_FIELD_VARIABLE_KEY_MAX_LENGTH: number = 64;

/*
 * What a name with nothing usable in it becomes: "!!!", or a name written
 * wholly in a script with no Latin transliteration here, such as "影响" or
 * "Влияние". Numbered like any other collision, so a project with several
 * gets field, field_2, field_3.
 */
export const CUSTOM_FIELD_VARIABLE_KEY_FALLBACK: string = "field";

/*
 * Where a key sits among the template variables:
 * {{incident.customFields.<key>}}. The fields are the incident's, so their
 * variables start with "incident." like every other incident value a note
 * template offers ({{incident.title}}, {{incident.severity}}, ...). This is
 * the one name shown, documented and offered everywhere: the custom field
 * settings, the note template form, the subscriber template reference and
 * the docs.
 */
export const CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX: string =
  "incident.customFields.";

/*
 * The prefix the variables had before they were named after the incident:
 * {{customFields.<key>}}. Templates saved with it keep working - everything
 * that fills the variables fills this name with the same value, and the
 * subscriber template checks treat it as the same placeholder - but it is
 * never shown or offered. Stored templates are not rewritten: a template is
 * text its author (or Terraform, or an API client) owns, and rewriting it
 * would show up as a change nobody made.
 */
export const LEGACY_CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX: string =
  "customFields.";

// Every prefix a template reaches a field by, the documented one first.
export const CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIXES: ReadonlyArray<string> = [
  CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX,
  LEGACY_CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX,
];

const VARIABLE_KEY_PATTERN: RegExp = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/*
 * Latin letters that Unicode normalisation does not take apart into a base
 * letter and an accent, so stripping accents alone would lose them: "Größe"
 * would become "gr_e". Everything else accented (é, ñ, å, ç, ő, ...) is
 * handled by NFKD below.
 */
const LETTERS_WITHOUT_DECOMPOSITION: Record<string, string> = {
  ß: "ss",
  ẞ: "ss",
  æ: "ae",
  Æ: "ae",
  œ: "oe",
  Œ: "oe",
  ø: "o",
  Ø: "o",
  đ: "d",
  Đ: "d",
  ð: "d",
  Ð: "d",
  þ: "th",
  Þ: "th",
  ł: "l",
  Ł: "l",
  ı: "i",
  ħ: "h",
  Ħ: "h",
  ŧ: "t",
  Ŧ: "t",
  ŋ: "ng",
  Ŋ: "ng",
  ĸ: "k",
};

type TransliterateFunction = (name: string) => string;

const transliterate: TransliterateFunction = (name: string): string => {
  let result: string = "";

  for (const character of name) {
    result += LETTERS_WITHOUT_DECOMPOSITION[character] ?? character;
  }

  /*
   * NFKD splits "é" into "e" plus a combining accent, and also folds
   * compatibility forms: full-width "Ａ" to "A", "ﬁ" to "fi", "①" to "1".
   * Dropping the combining marks then leaves the base letters.
   */
  return result.normalize("NFKD").replace(/\p{M}/gu, "");
};

type TrimToLengthFunction = (key: string, maxLength: number) => string;

// Cut to a length without leaving a dangling underscore at the end.
const trimToLength: TrimToLengthFunction = (
  key: string,
  maxLength: number,
): string => {
  return key.slice(0, Math.max(maxLength, 0)).replace(/_+$/, "");
};

export type GetCustomFieldVariableKeyBaseFunction = (name: string) => string;

/**
 * The key a field of this name gets when nothing else in the project has it.
 * Never empty, and always a valid key.
 */
export const getCustomFieldVariableKeyBase: GetCustomFieldVariableKeyBaseFunction =
  (name: string): string => {
    const words: string = transliterate(typeof name === "string" ? name : "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    const key: string = trimToLength(
      words,
      CUSTOM_FIELD_VARIABLE_KEY_MAX_LENGTH,
    );

    return key || CUSTOM_FIELD_VARIABLE_KEY_FALLBACK;
  };

export type IsValidCustomFieldVariableKeyFunction = (key: unknown) => boolean;

/**
 * Whether a key has the generator's shape and can be used as
 * {{incident.customFields.<key>}} (or the older {{customFields.<key>}}) in a
 * template the compiler fills.
 */
export const isValidCustomFieldVariableKey: IsValidCustomFieldVariableKeyFunction =
  (key: unknown): boolean => {
    if (
      typeof key !== "string" ||
      key.length === 0 ||
      key.length > CUSTOM_FIELD_VARIABLE_KEY_MAX_LENGTH ||
      !VARIABLE_KEY_PATTERN.test(key)
    ) {
      return false;
    }

    return CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIXES.every(
      (prefix: string): boolean => {
        return SubscriberNotificationTemplateCompiler.isPlaceholderName(
          `${prefix}${key}`,
        );
      },
    );
  };

export type GenerateCustomFieldVariableKeyFunction = (data: {
  name: string;
  /*
   * Keys the other fields of the same project already hold. Compared exactly:
   * every key this module produces is lowercase already.
   */
  existingKeys: Iterable<string | null | undefined>;
}) => string;

/**
 * The key for a new field: its name's key, or the first of name_2, name_3,
 * ... that no other field in the project holds.
 */
export const generateCustomFieldVariableKey: GenerateCustomFieldVariableKeyFunction =
  (data: {
    name: string;
    existingKeys: Iterable<string | null | undefined>;
  }): string => {
    const taken: Set<string> = new Set<string>();

    for (const key of data.existingKeys) {
      if (typeof key === "string" && key.length > 0) {
        taken.add(key);
      }
    }

    const base: string = getCustomFieldVariableKeyBase(data.name);

    if (!taken.has(base)) {
      return base;
    }

    /*
     * One more than there are keys is always enough: at most that many of the
     * candidates can be taken.
     */
    for (let suffix: number = 2; suffix <= taken.size + 2; suffix++) {
      const ending: string = `_${suffix}`;
      const candidate: string = `${trimToLength(
        base,
        CUSTOM_FIELD_VARIABLE_KEY_MAX_LENGTH - ending.length,
      )}${ending}`;

      if (!taken.has(candidate)) {
        return candidate;
      }
    }

    // Unreachable (see the loop bound); kept so the function always returns.
    return `${CUSTOM_FIELD_VARIABLE_KEY_FALLBACK}_${taken.size + 2}`;
  };

export type GetCustomFieldTemplateVariableNameFunction = (
  key: string,
) => string;

/**
 * The name a template places the field by, as it is shown and documented:
 * "expected_resolution" -> "incident.customFields.expected_resolution".
 */
export const getCustomFieldTemplateVariableName: GetCustomFieldTemplateVariableNameFunction =
  (key: string): string => {
    return `${CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX}${key}`;
  };

export type GetCustomFieldTemplateVariableNamesFunction = (
  key: string,
) => Array<string>;

/**
 * Every name a template reaches the field by: the documented one, then the
 * older one templates saved before the rename may still hold. Whatever fills
 * the variables gives each of them the same value.
 */
export const getCustomFieldTemplateVariableNames: GetCustomFieldTemplateVariableNamesFunction =
  (key: string): Array<string> => {
    return CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIXES.map(
      (prefix: string): string => {
        return `${prefix}${key}`;
      },
    );
  };

export type GetCustomFieldVariableKeyFromTemplateVariableNameFunction = (
  name: string,
) => string | null;

/**
 * The key a template variable reaches, written either way
 * ("incident.customFields.impact" or "customFields.impact" -> "impact"), or
 * null when the name is not a custom field variable at all. The key's shape
 * is not checked: a mistyped or guessed key still names a custom field.
 */
export const getCustomFieldVariableKeyFromTemplateVariableName: GetCustomFieldVariableKeyFromTemplateVariableNameFunction =
  (name: string): string | null => {
    if (typeof name !== "string") {
      return null;
    }

    for (const prefix of CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIXES) {
      if (name.startsWith(prefix)) {
        return name.slice(prefix.length);
      }
    }

    return null;
  };

export type IsCustomFieldTemplateVariableNameFunction = (
  name: string,
) => boolean;

/**
 * Whether a placeholder reads an incident custom field, by either prefix -
 * what the subscriber template checks must count, whatever the key.
 */
export const isCustomFieldTemplateVariableName: IsCustomFieldTemplateVariableNameFunction =
  (name: string): boolean => {
    return getCustomFieldVariableKeyFromTemplateVariableName(name) !== null;
  };

export type NormalizeCustomFieldTemplateVariableNameFunction = (
  name: string,
) => string;

/**
 * A custom field variable written the older way, in the documented form
 * ("customFields.impact" -> "incident.customFields.impact"), so the two
 * spellings of one field compare equal. Any other name is returned as it is.
 */
export const normalizeCustomFieldTemplateVariableName: NormalizeCustomFieldTemplateVariableNameFunction =
  (name: string): string => {
    const key: string | null =
      getCustomFieldVariableKeyFromTemplateVariableName(name);

    return key === null ? name : getCustomFieldTemplateVariableName(key);
  };
