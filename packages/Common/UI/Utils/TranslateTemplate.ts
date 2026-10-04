import i18next from "i18next";

/*
 * Translating a sentence that has a value in it.
 *
 * Translation looks a string up by its English text, which works for fixed
 * copy and fails for "Are you sure you want to delete Notify on-call?": no
 * locale file can hold an entry for every name. Building the sentence from
 * translated pieces instead ("delete" + name + "?") reads the words out of
 * context and fixes English word order on every language.
 *
 * So the key is the whole English sentence with a {{placeholder}} for the
 * value - "Are you sure you want to delete {{name}}?" - and a locale maps it
 * to a whole sentence of its own that puts {{name}} where its grammar wants
 * it. Scripts/I18n/ValidateLocales.js checks that every translation keeps
 * every placeholder.
 *
 * A sentence whose wording depends on a number ("1 incident", "5 incidents")
 * is a PluralTemplate: the English "other" sentence is the key and holds the
 * locale's general wording, and the "one" form is stored under the key plus
 * "_one" - used for the counts the language calls "one" (Intl.PluralRules: 1
 * in German, 21 in Russian, 0 and 1 in French). A language with more forms
 * words its general sentence so it reads right for any count ("Строк:
 * {{count}}"). i18next's other suffixes ("_few", "_many") are read when a
 * dictionary has them, but the Dashboard's locale files hold exactly
 * en.json's keys (see App/FeatureSet/Dashboard/src/Locales/README.md).
 *
 * A value that is itself a word to translate - a model's name, "Incidents" -
 * is passed as a translatableTerm(). It is translated along with the sentence,
 * and only then: a sentence is either wholly in the reader's language or
 * wholly in English, never English words around a translated name or the
 * other way round.
 *
 * Where i18next is not set up (a front end without locales, a unit test) the
 * English template is filled in directly, so a placeholder is never shown.
 */

/*
 * A word or phrase that goes into a sentence and is translated with it - a
 * model's singular or plural name, a verb. `inSentence` asks for the casing a
 * word takes in the middle of a sentence in the reader's language: "No
 * incidents yet." in English and French, "Noch keine Vorfälle." in German,
 * whose nouns keep their capital.
 */
export interface TranslatableTerm {
  readonly translatableTerm: string;
  readonly inSentence: boolean;
}

export type TemplateValue = string | number | TranslatableTerm;

export type TemplateValues = Record<string, TemplateValue>;

/*
 * The English sentences of a count-dependent template. `other` is the
 * translation key; `one` is stored under the key plus "_one". {{count}} in
 * either is filled with the count, written the way the reader's language
 * writes numbers.
 */
export interface PluralTemplate {
  one: string;
  other: string;
}

/*
 * Looks a fixed string up by its English text and answers with the reader's
 * wording, or with the text itself when there is none - useTranslateValue()'s
 * translateString, or i18next's t() with keySeparator and nsSeparator off.
 * Undefined means "no translation set up": everything stays English.
 */
export type TextLookup = (text: string) => string | undefined;

export interface TermOptions {
  inSentence?: boolean | undefined;
}

export const translatableTerm: (
  text: string,
  options?: TermOptions,
) => TranslatableTerm = (
  text: string,
  options?: TermOptions,
): TranslatableTerm => {
  return {
    translatableTerm: text,
    inSentence: Boolean(options?.inSentence),
  };
};

export const isTranslatableTerm: (
  value: unknown,
) => value is TranslatableTerm = (
  value: unknown,
): value is TranslatableTerm => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TranslatableTerm).translatableTerm === "string"
  );
};

/*
 * Declares a string as a translation key without translating it yet - for a
 * constant or a map of sentences that are looked up later. It returns the
 * text unchanged; its only job is to let the Dashboard's extraction script
 * (npm run i18n:extract) find the string and add it to en.json.
 */
export const translationKey: <T extends string>(text: T) => T = <
  T extends string,
>(
  text: T,
): T => {
  return text;
};

export const DEFAULT_LANGUAGE: string = "en";

// The language part of a code: "zh-CN" -> "zh", "pt" -> "pt".
const getBaseLanguage: (language: string | undefined) => string = (
  language: string | undefined,
): string => {
  return (language || DEFAULT_LANGUAGE).split(/[-_]/)[0]!.toLowerCase();
};

/*
 * Languages that capitalize every noun, so a name keeps its capital in the
 * middle of a sentence. Languages without letter case (Japanese, Chinese,
 * Korean, Hindi, Persian) are unaffected by lower-casing either way.
 */
const LANGUAGES_THAT_CAPITALIZE_NOUNS: Array<string> = ["de", "lb"];

/*
 * Proper nouns that keep their capital wherever they appear. Acronyms
 * ("API", "SLOs") and words with a capital inside them ("OneUptime",
 * "GitHub", "IoT") are kept without being listed.
 */
const PROPER_NOUNS: Array<string> = [
  "Ceph",
  "Discord",
  "Docker",
  "Grafana",
  "Jira",
  "Kubernetes",
  "Linux",
  "Microsoft",
  "Okta",
  "OpenTelemetry",
  "Podman",
  "Prometheus",
  "Proxmox",
  "Slack",
  "Swarm",
  "Telegram",
  "Terraform",
  "Twilio",
  "Windows",
];

// "API", "SLOs": two capitals in a row.
const ACRONYM_PATTERN: RegExp = /\p{Lu}{2,}/u;

// "OneUptime", "GitHub", "iOS": a capital after the first letter.
const INNER_CAPITAL_PATTERN: RegExp = /^.+\p{Lu}/u;

const keepsItsCase: (part: string) => boolean = (part: string): boolean => {
  return (
    ACRONYM_PATTERN.test(part) ||
    INNER_CAPITAL_PATTERN.test(part) ||
    PROPER_NOUNS.includes(part)
  );
};

/*
 * A label as it is written in the middle of a sentence in `language`:
 * "On-Call Duty Policies" -> "on-call duty policies", "API Keys" -> "API
 * keys", "Kubernetes Clusters" -> "Kubernetes clusters"; unchanged in German.
 * Runs of spaces collapse and the ends are trimmed.
 */
export const toSentenceTerm: (text: string, language?: string) => string = (
  text: string,
  language?: string,
): string => {
  const words: Array<string> = text.trim().split(/\s+/).filter(Boolean);

  if (LANGUAGES_THAT_CAPITALIZE_NOUNS.includes(getBaseLanguage(language))) {
    return words.join(" ");
  }

  return words
    .map((word: string): string => {
      return word
        .split("-")
        .map((part: string): string => {
          if (keepsItsCase(part)) {
            return part;
          }

          try {
            return part.toLocaleLowerCase(language || DEFAULT_LANGUAGE);
          } catch {
            return part.toLowerCase();
          }
        })
        .join("-");
    })
    .join(" ");
};

/*
 * The CLDR plural category of `count` in `language` - "one", "few",
 * "many", "other"... - which is also i18next's key suffix for that form.
 */
export const getPluralCategory: (language: string, count: number) => string = (
  language: string,
  count: number,
): string => {
  try {
    return new Intl.PluralRules(language).select(count);
  } catch {
    return count === 1 ? "one" : "other";
  }
};

const PLACEHOLDER: RegExp = /\{\{\s*([\w.]+)\s*\}\}/g;

/*
 * The {{placeholders}} a template names, each once, in the order they first
 * appear - read with the same rule fillTemplate fills them by. A caller that
 * draws some of them as elements (TranslatedSentence's slots) passes exactly
 * these: a slot the sentence lacks, or one left over, falls back to English.
 */
export const getTemplatePlaceholders: (template: string) => Array<string> = (
  template: string,
): Array<string> => {
  const names: Array<string> = [];

  for (const match of template.matchAll(PLACEHOLDER)) {
    const name: string = match[1] || "";

    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  return names;
};

// Whether a template has words of its own besides its placeholders.
const LETTER: RegExp = /\p{L}/u;

const hasWords: (template: string) => boolean = (template: string): boolean => {
  return LETTER.test(template.replace(PLACEHOLDER, ""));
};

// A value as the English sentence shows it.
const englishValue: (value: TemplateValue) => string = (
  value: TemplateValue,
): string => {
  if (isTranslatableTerm(value)) {
    return value.inSentence
      ? toSentenceTerm(value.translatableTerm, DEFAULT_LANGUAGE)
      : value.translatableTerm.trim();
  }

  return String(value);
};

/*
 * Fills {{key}} placeholders from values. A placeholder with no value is left
 * as it is, which a test notices and a reader at least recognises as a slot.
 * Each value goes in literally: braces or "$t(" inside a name are never
 * looked up again.
 */
export const fillTemplate: (
  template: string,
  values?: TemplateValues,
) => string = (template: string, values: TemplateValues = {}): string => {
  return template.replace(PLACEHOLDER, (match: string, key: string) => {
    return Object.prototype.hasOwnProperty.call(values, key)
      ? englishValue(values[key] as TemplateValue)
      : match;
  });
};

/*
 * Everything a component or a utility needs to put a translated string on
 * the screen, bound to one lookup and the reader's language. useTranslator()
 * builds one per render from react-i18next, so a language switch re-renders;
 * the functions exported below use the global i18next instance, for code that
 * runs outside React.
 */
export interface Translator {
  // The reader's language code: "en", "de", "zh-CN".
  language: string;
  // A fixed string looked up by its English text; undefined stays undefined.
  translateText: (text: string | undefined) => string | undefined;
  // True when the reader's language has its own wording for the text.
  hasTranslation: (text: string) => boolean;
  // A whole sentence with {{placeholders}}, filled after it is translated.
  translateTemplate: (template: string, values?: TemplateValues) => string;
  // A count-dependent sentence, in the form the reader's language uses.
  translatePlural: (
    template: PluralTemplate,
    count: number,
    values?: TemplateValues,
  ) => string;
  // A word or name, as written on its own or in the middle of a sentence.
  translateTerm: (text: string | undefined, options?: TermOptions) => string;
  // A number as the reader's language writes it: 1,234 / 1.234 / 1 234.
  formatNumber: (value: number) => string;
}

export const createTranslator: (
  lookup: TextLookup | undefined,
  language?: string | undefined,
) => Translator = (
  lookup: TextLookup | undefined,
  language?: string | undefined,
): Translator => {
  const activeLanguage: string = language || DEFAULT_LANGUAGE;

  // The stored wording for `key`, or undefined when nothing has one.
  const find: (key: string) => string | undefined = (
    key: string,
  ): string | undefined => {
    if (!lookup || !key) {
      return undefined;
    }

    try {
      const result: string | undefined = lookup(key);

      return typeof result === "string" && result.length > 0 && result !== key
        ? result
        : undefined;
    } catch {
      return undefined;
    }
  };

  const translateText: (text: string | undefined) => string | undefined = (
    text: string | undefined,
  ): string | undefined => {
    if (typeof text !== "string" || text.length === 0) {
      return text;
    }

    return find(text) ?? text;
  };

  const hasTranslation: (text: string) => boolean = (text: string): boolean => {
    return find(text) !== undefined;
  };

  const translateTerm: (
    text: string | undefined,
    options?: TermOptions,
  ) => string = (text: string | undefined, options?: TermOptions): string => {
    if (!text) {
      return "";
    }

    const translated: string = find(text) ?? text;

    if (!options?.inSentence) {
      return translated.trim();
    }

    /*
     * Cased the reader's way, translated or not: a German noun spelled as in
     * English ("Labels", "Monitor") keeps its capital in a German sentence.
     * An English sentence never comes here - it is filled by fillTemplate.
     */
    return toSentenceTerm(translated, activeLanguage);
  };

  // Every value as the translated sentence shows it.
  const translatedValues: (values: TemplateValues) => Record<string, string> = (
    values: TemplateValues,
  ): Record<string, string> => {
    const result: Record<string, string> = {};

    for (const key of Object.keys(values)) {
      const value: TemplateValue = values[key] as TemplateValue;

      result[key] = isTranslatableTerm(value)
        ? translateTerm(value.translatableTerm, {
            inSentence: value.inSentence,
          })
        : String(value);
    }

    return result;
  };

  /*
   * The sentence is translated when its stored wording differs from the
   * English one; then its terms are translated too. Otherwise the English
   * sentence is filled with the English terms - except for a template with no
   * words of its own ("{{action}} {{itemName}}"), which belongs to no
   * language and always takes the reader's words.
   */
  const fill: (
    stored: string | undefined,
    english: string,
    values: TemplateValues,
  ) => string = (
    stored: string | undefined,
    english: string,
    values: TemplateValues,
  ): string => {
    if (stored === undefined || stored === english) {
      return hasWords(english)
        ? fillTemplate(english, values)
        : fillTemplate(english, translatedValues(values));
    }

    return fillTemplate(stored, translatedValues(values));
  };

  const translateTemplate: (
    template: string,
    values?: TemplateValues,
  ) => string = (template: string, values: TemplateValues = {}): string => {
    return fill(find(template), template, values);
  };

  const formatNumber: (value: number) => string = (value: number): string => {
    try {
      return value.toLocaleString(activeLanguage);
    } catch {
      return value.toLocaleString();
    }
  };

  /*
   * The form for `count` the way i18next resolves it: the language's own
   * category ("few" for 3 in Russian) under the key plus "_few", else the key
   * itself, which holds the language's general (other) form.
   */
  const findPlural: (key: string, count: number) => string | undefined = (
    key: string,
    count: number,
  ): string | undefined => {
    const category: string = getPluralCategory(activeLanguage, count);

    if (category !== "other") {
      const form: string | undefined = find(`${key}_${category}`);

      if (form !== undefined) {
        return form;
      }
    }

    return find(key);
  };

  const translatePlural: (
    template: PluralTemplate,
    count: number,
    values?: TemplateValues,
  ) => string = (
    template: PluralTemplate,
    count: number,
    values: TemplateValues = {},
  ): string => {
    // English has two forms: exactly one, and everything else.
    const english: string = count === 1 ? template.one : template.other;
    const stored: string | undefined = findPlural(template.other, count);

    /*
     * An English form left in a locale is a placeholder, not a translation:
     * the sentence is English, in English's form for the count. Russian puts
     * 21 in its "one" form, French puts 0 there - neither may borrow the
     * English "1 row" for it.
     */
    const translated: string | undefined =
      stored === template.one || stored === template.other ? undefined : stored;

    // {{count}} is written the reader's way unless the caller passes its own.
    return fill(translated, english, {
      count: formatNumber(count),
      ...values,
    });
  };

  return {
    language: activeLanguage,
    translateText,
    hasTranslation,
    translateTemplate,
    translatePlural,
    translateTerm,
    formatNumber,
  };
};

/*
 * The translator for the global i18next instance - the one each front end
 * initializes in its Utils/i18n.ts. Before (or without) that, it answers in
 * English.
 */
export const getGlobalTranslator: () => Translator = (): Translator => {
  if (!i18next.isInitialized) {
    return createTranslator(undefined, DEFAULT_LANGUAGE);
  }

  return createTranslator(
    (text: string): string | undefined => {
      const translated: unknown = i18next.t(text, {
        defaultValue: text,
        keySeparator: false,
        nsSeparator: false,
      });

      return typeof translated === "string" ? translated : undefined;
    },
    i18next.resolvedLanguage || i18next.language || DEFAULT_LANGUAGE,
  );
};

// A fixed string in the reader's language, outside React.
export const translateText: (text: string | undefined) => string | undefined = (
  text: string | undefined,
): string | undefined => {
  return getGlobalTranslator().translateText(text);
};

// A word or name in the reader's language, outside React.
export const translateTerm: (
  text: string | undefined,
  options?: TermOptions,
) => string = (text: string | undefined, options?: TermOptions): string => {
  return getGlobalTranslator().translateTerm(text, options);
};

/*
 * The sentence in the reader's language, with its values filled in.
 */
export const translateTemplate: (
  template: string,
  values?: TemplateValues,
) => string = (template: string, values: TemplateValues = {}): string => {
  return getGlobalTranslator().translateTemplate(template, values);
};

/*
 * The count-dependent sentence in the reader's language, outside React.
 */
export const translatePlural: (
  template: PluralTemplate,
  count: number,
  values?: TemplateValues,
) => string = (
  template: PluralTemplate,
  count: number,
  values: TemplateValues = {},
): string => {
  return getGlobalTranslator().translatePlural(template, count, values);
};

/*
 * An action on a named kind of thing - "Create Incident", "Edit Monitor",
 * "Delete Status Page" - from a template with an {{itemName}} slot. The whole
 * English phrase is looked up first, so a locale can word one model's button
 * its own way (gender, case); otherwise the template is filled with the
 * locale's word for the name. `values` fill any other placeholder - the verb
 * of "{{action}} {{itemName}}", for one.
 */
export const translateNamedAction: (
  translator: Translator,
  data: { template: string; itemName: string; values?: TemplateValues },
) => string = (
  translator: Translator,
  data: { template: string; itemName: string; values?: TemplateValues },
): string => {
  // The slot is {{itemName}}, or {{itemsName}} for a plural name.
  const phrase: string = fillTemplate(data.template, {
    ...(data.values || {}),
    itemName: data.itemName.trim(),
    itemsName: data.itemName.trim(),
  });

  if (translator.hasTranslation(phrase)) {
    return translator.translateText(phrase) || phrase;
  }

  return translator.translateTemplate(data.template, {
    ...(data.values || {}),
    itemName: translatableTerm(data.itemName),
    itemsName: translatableTerm(data.itemName),
  });
};

export type SentencePart =
  | { kind: "text"; text: string }
  | { kind: "slot"; slot: string };

/*
 * Slot markers are private-use characters, which no translation or name
 * contains: "\uE000" + the slot's index + "\uE000".
 */
const SLOT_PATTERN: RegExp = /\uE000(\d+)\uE000/;

/*
 * A translated sentence in pieces, for a caller that draws some of its values
 * itself - a field name in bold, a link - between the pieces of text.
 * `slots` are the placeholders the caller draws; `values` fill the rest.
 *
 * A translation that lost one of the slots or repeated it cannot be drawn
 * whole, so the English sentence is used instead.
 */
export const getSentenceParts: (data: {
  translator: Translator;
  template: string | PluralTemplate;
  slots: ReadonlyArray<string>;
  values?: TemplateValues | undefined;
  count?: number | undefined;
}) => Array<SentencePart> = (data: {
  translator: Translator;
  template: string | PluralTemplate;
  slots: ReadonlyArray<string>;
  values?: TemplateValues | undefined;
  count?: number | undefined;
}): Array<SentencePart> => {
  const withMarkers: TemplateValues = { ...(data.values || {}) };

  data.slots.forEach((slot: string, index: number): void => {
    withMarkers[slot] = `\uE000${index}\uE000`;
  });

  const split: (sentence: string) => Array<SentencePart> | null = (
    sentence: string,
  ): Array<SentencePart> | null => {
    const pieces: Array<string> = sentence.split(SLOT_PATTERN);
    const parts: Array<SentencePart> = [];
    const seen: Array<number> = [];

    pieces.forEach((piece: string, index: number): void => {
      if (index % 2 === 1) {
        const slotIndex: number = Number(piece);

        seen.push(slotIndex);
        parts.push({ kind: "slot", slot: data.slots[slotIndex] as string });
      } else if (piece) {
        parts.push({ kind: "text", text: piece });
      }
    });

    const isWhole: boolean =
      seen.length === data.slots.length &&
      data.slots.every((_slot: string, index: number): boolean => {
        return seen.includes(index);
      });

    return isWhole ? parts : null;
  };

  const count: number = data.count ?? 0;
  const isPlural: boolean = typeof data.template !== "string";
  const englishTemplate: string =
    typeof data.template === "string"
      ? data.template
      : count === 1
        ? data.template.one
        : data.template.other;

  const translated: string =
    typeof data.template === "string"
      ? data.translator.translateTemplate(data.template, withMarkers)
      : data.translator.translatePlural(data.template, count, withMarkers);

  const englishValues: TemplateValues = isPlural
    ? { count: data.translator.formatNumber(count), ...withMarkers }
    : withMarkers;

  return (
    split(translated) ||
    split(fillTemplate(englishTemplate, englishValues)) || [
      {
        kind: "text",
        text: fillTemplate(englishTemplate, {
          ...(isPlural ? { count: data.translator.formatNumber(count) } : {}),
          ...(data.values || {}),
        }),
      },
    ]
  );
};

export interface TemplateAround {
  before: string;
  after: string;
}

/*
 * A marker no name contains, put where the slot goes so the translated
 * sentence can be cut around it.
 */
const SLOT_MARKER: string = "\u0000";

/*
 * The translated sentence cut in two around one {{slot}}, for a caller that
 * draws the slot's value itself - in bold, say - between the two halves.
 *
 * The value never goes through the translation: whatever a name contains
 * (braces, "$t(", markup), it is drawn as text by the caller.
 */
export const translateTemplateAround: (
  template: string,
  slot: string,
  values?: TemplateValues,
) => TemplateAround = (
  template: string,
  slot: string,
  values: TemplateValues = {},
): TemplateAround => {
  const withMarker: TemplateValues = { ...values, [slot]: SLOT_MARKER };

  const split: (sentence: string) => TemplateAround | null = (
    sentence: string,
  ): TemplateAround | null => {
    const parts: Array<string> = sentence.split(SLOT_MARKER);

    if (parts.length !== 2) {
      return null;
    }

    return { before: parts[0]!, after: parts[1]! };
  };

  /*
   * A translation that lost its slot, or repeated it, cannot be drawn with the
   * name in it - fall back to English rather than drop the name.
   */
  return (
    split(translateTemplate(template, withMarker)) ||
    split(fillTemplate(template, withMarker)) || {
      before: fillTemplate(template, values),
      after: "",
    }
  );
};
