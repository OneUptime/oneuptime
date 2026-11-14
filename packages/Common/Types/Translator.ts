import escapeRegExp from "../Utils/RegExpEscape";
import { getEnglishOf, getNumberLocale } from "./DateLanguage";
import {
  FIRST_STRONG_ISOLATE,
  getReadingDirection,
  isNumberJoinedToASign,
  LEFT_TO_RIGHT,
  POP_DIRECTIONAL_ISOLATE,
  ReadingDirection,
  RIGHT_TO_LEFT,
  setApartInSentence,
} from "./ReadingDirection";

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
 * A value built from other translated strings - clauses joined into one,
 * names joined with "or" - is passed as a composedValue(), which builds it
 * with the translator the sentence is filled with: the reader's when their
 * language words the sentence, English otherwise.
 *
 * Where no translation is set up (a front end without locales, a unit test,
 * a translator made with no lookup) the English template is filled in
 * directly, so a placeholder is never shown.
 *
 * A date, a time or a duration goes into a sentence as text written in the
 * reader's language ("vor 5 Stunden", Common/Types/DateLanguage). When the
 * sentence itself is read in English - the reader's language has no wording
 * of it yet - the English of that text goes in instead, so "Checked
 * {{time}}" never reads "Checked vor 5 Stunden".
 *
 * It needs nothing but Common's Types - no i18next, no browser, no server:
 * a translator is handed its lookup (createTranslator). A front end's comes
 * from i18next (Common/UI/Utils/TranslateTemplate, which re-exports all of
 * this beside the global i18next instance's translator), the server's from
 * its locale files (Common/Server/Utils/ServerTranslation). A module of
 * Types/, Utils/ or Models/ that npm users should get imports it from here,
 * not from UI/: npm's @oneuptime/common leaves out every module that loads
 * UI/ or Server/ code (Scripts/NpmPackage/BuildNpmPackage.js), and the
 * status page's state names and messages (Types/StatusPage) are in it.
 */

/*
 * A word or phrase that goes into a sentence and is translated with it - a
 * model's singular or plural name, a verb. `inSentence` asks for the casing a
 * word takes in the middle of a sentence in the reader's language: "No
 * incidents yet." in English and French, "Noch keine Vorfälle." in German,
 * whose nouns keep their capital. Where the reader's sentence starts with
 * it, it starts with a capital ("Incidents are raised...").
 */
export interface TranslatableTerm {
  readonly translatableTerm: string;
  readonly inSentence: boolean;
}

/*
 * A value put together from other translated strings: the protections
 * clauses as one sentence, a list of names joined with "or". `compose` is
 * called with the translator the sentence is filled with, so the value is in
 * the sentence's language - English while the reader's language has no
 * wording of the sentence, even where it has wordings of the pieces.
 */
export interface ComposedValue {
  readonly compose: (translator: Translator) => string;
}

export type TemplateValue = string | number | TranslatableTerm | ComposedValue;

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
 * A plural form a locale holds, with the plural category of the key it is
 * held under: "one" for the key plus "_one", "few" for "_few", and "other"
 * for the key itself - the language's general form.
 */
interface StoredPluralForm {
  text: string;
  category: string;
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

/*
 * How a sentence is filled.
 *
 * setsValuesApart: each value is set apart from the sentence in a Unicode
 * isolate where it could move the words around it (fillSettingValuesApart) -
 * a name in Latin letters and the time or the count after it in a Persian
 * sentence, a Persian name in an English one - so the browser draws every
 * word where the sentence puts it; a number written against a sign of its
 * own ("{{online}}/{{count}}", "#{{number}}") is left with it, so "3/5" stays
 * "3/5" in an Arabic sentence. Only for a sentence that is drawn on the
 * page and nothing else (TranslatedSentence, translateTemplateAround): the
 * isolate's marks are characters, and a sentence that becomes a record's
 * name, a field's value or a request would carry them.
 */
export interface SentenceOptions {
  setsValuesApart?: boolean | undefined;
  /*
   * With setsValuesApart, a slot (TranslatedSentence, translateTemplateAround)
   * is set apart too, in a sentence read right to left: what is drawn there
   * is not known, so it is set apart whatever it holds. Not for a sentence
   * whose pieces are drawn as boxes of their own (TranslatedSentence's
   * renderText, a flex row): an isolate's marks would be pieces of their own.
   */
  setsSlotsApart?: boolean | undefined;
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

export const composedValue: (
  compose: (translator: Translator) => string,
) => ComposedValue = (
  compose: (translator: Translator) => string,
): ComposedValue => {
  return { compose };
};

export const isComposedValue: (value: unknown) => value is ComposedValue = (
  value: unknown,
): value is ComposedValue => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ComposedValue).compose === "function"
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
 *
 * Among them every vendor the product names (issue #7692): the cloud vendors
 * of CloudPlatform, the network vendors of the device catalog (the SNMP
 * vendor templates, the traffic and events setups, the Meraki dashboard) and
 * the integrations - a name said in a sentence ("Meraki devices") is never
 * "meraki". A word that is also a word of its own ("Extreme", "Elastic",
 * "Alto" - "high" in Spanish and Italian) is not listed: it would keep its
 * capital as that word too.
 */
const PROPER_NOUNS: Array<string> = [
  "Alertmanager",
  "Alibaba",
  "Arista",
  "Aruba",
  "Azure",
  "Cambium",
  "Ceph",
  "Cisco",
  "Datadog",
  "Dell",
  "Discord",
  "Docker",
  "Fortinet",
  "Google",
  "Grafana",
  "Huawei",
  "Huntress",
  "Jira",
  "Juniper",
  "Kubernetes",
  "Linux",
  "Mattermost",
  "Meraki",
  "Microsoft",
  "Okta",
  "OpenTelemetry",
  "Opsgenie",
  "Podman",
  "Prometheus",
  "Proxmox",
  "OpenStack",
  "Slack",
  "Sophos",
  "Splunk",
  "Swarm",
  "Telegram",
  "Tencent",
  "Terraform",
  "Twilio",
  "Ubiquiti",
  "Vercel",
  "Windows",
  "Zabbix",
];

/*
 * Proper nouns of two words: the second keeps its capital after the first
 * ("Google Cloud project", but "cloud resources").
 */
const PROPER_NOUN_PAIRS: Array<[string, string]> = [
  ["Alibaba", "Cloud"],
  ["Google", "Cloud"],
  ["Microsoft", "Teams"],
  ["Tencent", "Cloud"],
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
    .map((word: string, index: number): string => {
      const previous: string | undefined = words[index - 1];

      /*
       * The second word of a two-word name keeps its capital, alone or as
       * the first part of a compound ("Google Cloud-projekt" in Danish).
       */
      const followsPairStart: (part: string) => boolean = (
        part: string,
      ): boolean => {
        return (
          previous !== undefined &&
          PROPER_NOUN_PAIRS.some((pair: [string, string]): boolean => {
            return pair[0] === previous && pair[1] === part;
          })
        );
      };

      return word
        .split("-")
        .map((part: string, partIndex: number): string => {
          if (
            keepsItsCase(part) ||
            (partIndex === 0 && followsPairStart(part))
          ) {
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

// A lower-case letter at the very start: the "c" of "clúster de Kubernetes".
const LOWER_CASE_START: RegExp = /^\p{Ll}/u;

/*
 * A word or name as it starts a label - a row's name, a chip, a line of a
 * card - in `language`: its first letter upper-cased the way the language
 * writes a capital. A locale words a name the way the sentences that say it
 * take it ("Este clúster de Kubernetes...", "Этот кластер Kubernetes..."),
 * so where the same key names a row it starts lower-case; drawn through
 * this, it reads "Clúster de Kubernetes", "Кластер Kubernetes". The
 * counterpart of toSentenceTerm, which writes a label for the middle of a
 * sentence.
 *
 * Unchanged when the text starts with anything but a lower-case letter - a
 * capital, a digit, a sign, a letter of a script without case (Chinese,
 * Japanese, Korean, Persian, Arabic, Hindi) - and when its first word keeps
 * its own case ("vCenter", "iOS", "eBPF"). For a label of words, never a
 * code or a name someone typed.
 */
export const toLabelTerm: (text: string, language?: string) => string = (
  text: string,
  language?: string,
): string => {
  const first: string | undefined = LOWER_CASE_START.exec(text)?.[0];

  if (!first || keepsItsCase(text.split(/[\s-]/)[0] || "")) {
    return text;
  }

  let capital: string;

  try {
    capital = first.toLocaleUpperCase(language || DEFAULT_LANGUAGE);
  } catch {
    capital = first.toUpperCase();
  }

  return `${capital}${text.slice(first.length)}`;
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
 * Slot markers are private-use characters, which no translation or name
 * contains: "\uE000" + the slot's index + "\uE000" (getSentenceParts).
 */
const SLOT_PATTERN: RegExp = /\uE000(\d+)\uE000/;

// One slot's marker, alone.
const WHOLE_SLOT_PATTERN: RegExp = /^\uE000\d+\uE000$/;

/*
 * A marker no name contains, put where the slot goes so the translated
 * sentence can be cut around it (translateTemplateAround).
 */
const SLOT_MARKER: string = "\u0000";

/*
 * Whether a value is where a caller draws an element of its own - a name in
 * bold, a link - between the pieces of the sentence.
 */
const isSlotMarker: (value: string) => boolean = (value: string): boolean => {
  return value === SLOT_MARKER || WHOLE_SLOT_PATTERN.test(value);
};

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

/*
 * Whether a plural's one form says exactly one: its English other form
 * names the count and its one form does not - "Fired once" beside "Fired
 * {{count}} times", "Show the host" beside "Show every host ({{count}})".
 * A language's "one" form is said for every count it calls one (21 and 31
 * in Russian, 0 in French), so such a one form is said for one only
 * (translatePlural).
 *
 * Not a pair that names the count in neither form: a word drawn beside a
 * number shown on its own ("day", "metric" under "21") or a number another
 * value holds ("{{number}} event") - its one form is the language's form
 * for that number ("21 день", never "21 дней").
 */
export const isOneFormOnlyForOne: (template: PluralTemplate) => boolean = (
  template: PluralTemplate,
): boolean => {
  return (
    getTemplatePlaceholders(template.other).includes("count") &&
    !getTemplatePlaceholders(template.one).includes("count")
  );
};

// Whether a template has words of its own besides its placeholders.
const LETTER: RegExp = /\p{L}/u;

const hasWords: (template: string) => boolean = (template: string): boolean => {
  return LETTER.test(template.replace(PLACEHOLDER, ""));
};

/*
 * WHERE A VALUE STARTS A SENTENCE.
 *
 * A word cased for the middle of a sentence (an inSentence term: "le
 * collecteur OneUptime", "monitors") takes a capital where the reader's
 * sentence starts with it: French says "Configurez le collecteur OneUptime"
 * and "Le collecteur OneUptime ne remonte plus de données", Dutch "Monitors
 * zoeken…" (issue #7692). A language puts a value where its grammar wants
 * it, so only the filled sentence knows where it starts one.
 *
 * A placeholder starts a sentence where, past any opening quote, bracket or
 * Spanish opening mark, a line starts, or a sentence's end - ". ", "! ",
 * "? ", "… ", with any closing quote or bracket - comes right before it; or
 * where it starts the template, and the template reads as a sentence: it
 * ends as one does (". ! ? … :"), or holds a sentence's end before more
 * words. A template that does neither is a piece of another sentence -
 * "{{kind}} {{name}}", "{{names}} and {{count}} more" - whose values are
 * cased where that sentence puts them. The full stop of an abbreviation
 * ends no sentence (NOT_A_SENTENCE_END).
 */

/*
 * The words a language shortens before the value they introduce, in lower
 * case: "pr. time" (per hour), "kl. 12" (at 12 o'clock), "ca. 5", "z. B.",
 * "bijv.", "máx. 10", "Serienr. 123". Their full stop never ends a
 * sentence: Danish fixes one resource "pr. hændelse", never with a capital.
 * Not a unit after a number ("5 min.", "3 Std."), whose full stop may end
 * one: "Checked every 5 min. 2 more checks are off."
 */
const SHORTENED_BEFORE_A_VALUE: ReadonlyArray<string> = [
  "ad es", // Italian: for example ("es" alone is Spanish "is")
  "aprox", // Spanish: about
  "bijv", // Dutch: for example
  "ca", // Danish: about
  "col", // Spanish: column
  "ex", // French, Portuguese: for example ("par ex.", "por ex.")
  "gem", // Dutch: on average
  "gns", // Danish: on average
  "kl", // Danish, Norwegian, Swedish: at (a time)
  "lín", // Spanish: line
  "maks", // Danish, Norwegian: at most
  "max", // German, French, Dutch: at most
  "máx", // Spanish, Portuguese: at most
  "moy", // French: on average
  "n", // Italian: number
  "nr", // Dutch: number
  "pr", // Danish: per
  "prom", // Spanish: on average
  "serienr", // Danish, Dutch, Norwegian: serial number
  "seriennr", // German: serial number
  "z. b", // German: for example ("B." alone may end a sentence: "plan B.")
  "админ", // Russian: administrative
  "макс", // Russian: at most
  "сред", // Russian: on average
];

// Those words as a pattern.
const SHORTENED_WORDS: string =
  SHORTENED_BEFORE_A_VALUE.map(escapeRegExp).join("|");

/*
 * Right before a full stop that ends no sentence: an abbreviation with a
 * full stop inside ("e.g.", "z.B.", "f.eks.", "т.е."), or one of the words
 * above as a word of its own, in either case ("Ca. 5 timer").
 */
const NOT_A_SENTENCE_END: string = `(?<!\\p{L}\\.\\p{L}{1,3})(?<!(?:^|\\P{L})(?:${SHORTENED_WORDS}))`;

const SENTENCE_END: string = `(?:${NOT_A_SENTENCE_END}\\.|[!?…])["'»”’)\\]]*`;

// What a sentence may open with before its first word.
const OPENING_MARKS_AT_END: RegExp = /["'«“„‘‚([¿¡]+$/u;

// A sentence's end and a space, or a line break, right before a placeholder.
const SENTENCE_END_BEFORE: RegExp = new RegExp(
  `(?:${SENTENCE_END}\\s|\\n)\\s*$`,
  "iu",
);

// A template ending as a sentence does.
const ENDS_AS_A_SENTENCE: RegExp = new RegExp(
  `(?:${SENTENCE_END}|:)\\s*$`,
  "iu",
);

// A sentence's end before more words, inside a template.
const SENTENCE_END_INSIDE: RegExp = new RegExp(`${SENTENCE_END}\\s+\\S`, "iu");

const startsASentence: (template: string, at: number) => boolean = (
  template: string,
  at: number,
): boolean => {
  const before: string = template
    .slice(0, at)
    .replace(OPENING_MARKS_AT_END, "");

  if (before.trim() === "") {
    return (
      ENDS_AS_A_SENTENCE.test(template) || SENTENCE_END_INSIDE.test(template)
    );
  }

  return SENTENCE_END_BEFORE.test(before);
};

/*
 * A value as text where it goes into a sentence: as the middle of one takes
 * it, and as it reads where it starts one (startsASentence); and whether it
 * is a term, OneUptime's own words (closeSpacesBesideTerms).
 */
interface SentenceValue {
  text: string;
  atSentenceStart: string;
  isTerm: boolean;
}

/*
 * `text`, the value as the middle of a sentence in `language` takes it, with
 * its form where it starts one: an inSentence term takes a capital there
 * (toLabelTerm); anything else - a name, a number, a term as written, a
 * composed value - is the same wherever it goes.
 */
const toSentenceValue: (
  value: TemplateValue,
  text: string,
  language: string,
) => SentenceValue = (
  value: TemplateValue,
  text: string,
  language: string,
): SentenceValue => {
  return {
    text,
    atSentenceStart:
      isTranslatableTerm(value) && value.inSentence
        ? toLabelTerm(text, language)
        : text,
    isTerm: isTranslatableTerm(value),
  };
};

/*
 * WHERE A TERM MEETS CHINESE OR JAPANESE WORDS.
 *
 * Chinese and Japanese write no space between their words. The Dashboard's
 * zh-CN, zh-TW and ja files put one between their words and Latin text, a
 * number or a {{placeholder}} (Dashboard/src/Locales/README.md), which reads
 * right beside a name in Latin letters - "请设置 OneUptime Kubernetes
 * Agent，只需几分钟。" - and wrong beside a term the language words in its
 * own script: "请设置 设备或网关上的 OpenTelemetry 导出器，", "此操作会撤销
 * 数据库 AI 代理 的密钥。" (issue #7864). One key can take a name of either
 * kind - a host's collector is "OpenTelemetry Collector" or "OneUptime
 * 收集器" - so no spacing written into the key reads right for both.
 *
 * So in a sentence of a language that writes no space between its words, a
 * space the template puts between a term (translatableTerm) and a Chinese or
 * Japanese letter is dropped where the term's own letter on that side is
 * Chinese or Japanese too: "请设置设备或网关上的 OpenTelemetry 导出器，",
 * "OneUptime 收集器已不再上报数据", "撤销数据库 AI 代理的密钥". A space
 * beside a Latin letter, a digit or a sign stays ("请设置 OneUptime
 * 收集器"), and so does one beside any other value - a name someone typed, a
 * number, a date, a slot - which the space sets apart as the template wrote
 * it. Two terms side by side meet the same way: "{{action}} {{itemName}}"
 * reads "更新监控器". No space is ever added: a key that writes none reads
 * as it is written.
 */

// The languages that write no space between their words: Chinese, Japanese.
const LANGUAGES_WITHOUT_WORD_SPACES: ReadonlyArray<string> = ["ja", "zh"];

/*
 * One letter of Chinese or Japanese - a Han character or a kana - by the
 * scripts that use it (its script extensions), as ReadingDirection reads a
 * right-to-left letter: the prolonged sound mark that ends "コレクター"
 * (U+30FC) is a letter of both kana scripts and of neither alone. Not their
 * punctuation ("。", "、", "「"): the space beside it is the template's.
 */
const CHINESE_OR_JAPANESE_LETTER: RegExp =
  /^(?=[\p{L}\p{Nl}])[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]$/u;

// Whether `text` starts with a letter of Chinese or Japanese.
const startsInChineseOrJapanese: (text: string) => boolean = (
  text: string,
): boolean => {
  const first: number | undefined = text.codePointAt(0);

  return (
    first !== undefined &&
    CHINESE_OR_JAPANESE_LETTER.test(String.fromCodePoint(first))
  );
};

// Whether `text` ends with a letter of Chinese or Japanese.
const endsInChineseOrJapanese: (text: string) => boolean = (
  text: string,
): boolean => {
  // Its last character, whole where it is a surrogate pair ("𠀀").
  const last: string = Array.from(text.slice(-2)).pop() || "";

  return CHINESE_OR_JAPANESE_LETTER.test(last);
};

// How many spaces `text` starts with, and how many it ends with.
const countLeadingSpaces: (text: string) => number = (text: string): number => {
  let count: number = 0;

  while (text[count] === " ") {
    count++;
  }

  return count;
};

const countTrailingSpaces: (text: string) => number = (
  text: string,
): number => {
  let count: number = 0;

  while (count < text.length && text[text.length - 1 - count] === " ") {
    count++;
  }

  return count;
};

// A piece of a filled template: its own words, or a value where it goes.
interface FilledPiece {
  text: string;
  isValue: boolean;
  // A value that is a term (SentenceValue's isTerm).
  isTerm: boolean;
}

/*
 * The pieces of a filled template (fillPieces), in `language`: in one that
 * writes no space between its words, each space its words put between a
 * term and a letter of Chinese or Japanese is dropped where the term's own
 * letter on that side is one too (WHERE A TERM MEETS CHINESE OR JAPANESE
 * WORDS). The words beside any other value keep their spaces.
 */
const closeSpacesBesideTerms: (
  pieces: Array<FilledPiece>,
  language: string,
) => Array<FilledPiece> = (
  pieces: Array<FilledPiece>,
  language: string,
): Array<FilledPiece> => {
  if (!LANGUAGES_WITHOUT_WORD_SPACES.includes(getBaseLanguage(language))) {
    return pieces;
  }

  return pieces.map((piece: FilledPiece, index: number): FilledPiece => {
    if (piece.isValue || !piece.text) {
      return piece;
    }

    // The values either side of these words: pieces take turns.
    const before: FilledPiece | undefined = pieces[index - 1];
    const after: FilledPiece | undefined = pieces[index + 1];
    const leading: number = countLeadingSpaces(piece.text);

    // Spaces and nothing else, between two values: two terms meet.
    if (leading === piece.text.length) {
      const termsMeet: boolean = Boolean(
        before?.isTerm &&
          after?.isTerm &&
          endsInChineseOrJapanese(before.text) &&
          startsInChineseOrJapanese(after.text),
      );

      return termsMeet ? { ...piece, text: "" } : piece;
    }

    let text: string = piece.text;

    if (
      leading > 0 &&
      before?.isTerm &&
      endsInChineseOrJapanese(before.text) &&
      startsInChineseOrJapanese(text.slice(leading))
    ) {
      text = text.slice(leading);
    }

    const trailing: number = countTrailingSpaces(text);
    const words: string = text.slice(0, text.length - trailing);

    if (
      trailing > 0 &&
      after?.isTerm &&
      startsInChineseOrJapanese(after.text) &&
      endsInChineseOrJapanese(words)
    ) {
      text = words;
    }

    return text === piece.text ? piece : { ...piece, text };
  });
};

/*
 * `template` filled with `values`, in pieces: its words and its values by
 * turns, words first and last (empty where a value starts or ends it). Each
 * value goes in the form its place takes (startsASentence), literally; a
 * placeholder with no value is left among the words as it is. Beside a
 * term, the words keep only the spaces `language` writes
 * (closeSpacesBesideTerms).
 */
const fillPieces: (
  template: string,
  values: Record<string, SentenceValue>,
  language: string,
) => Array<FilledPiece> = (
  template: string,
  values: Record<string, SentenceValue>,
  language: string,
): Array<FilledPiece> => {
  const pieces: Array<FilledPiece> = [];
  let words: string = "";
  let at: number = 0;

  for (const match of template.matchAll(PLACEHOLDER)) {
    const start: number = match.index ?? 0;
    const name: string = match[1] || "";

    words += template.slice(at, start);
    at = start + match[0].length;

    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      words += match[0];
      continue;
    }

    const value: SentenceValue = values[name] as SentenceValue;

    pieces.push({ text: words, isValue: false, isTerm: false });
    pieces.push({
      text: startsASentence(template, start)
        ? value.atSentenceStart
        : value.text,
      isValue: true,
      isTerm: value.isTerm,
    });
    words = "";
  }

  pieces.push({
    text: words + template.slice(at),
    isValue: false,
    isTerm: false,
  });

  return closeSpacesBesideTerms(pieces, language);
};

/*
 * `template` with each {{placeholder}} filled from `values`, in the form its
 * place takes (startsASentence), as a sentence in `language` holds it
 * (closeSpacesBesideTerms). A placeholder with no value is left as it is,
 * and each value goes in literally.
 */
const fillSentenceValues: (
  template: string,
  values: Record<string, SentenceValue>,
  language: string,
) => string = (
  template: string,
  values: Record<string, SentenceValue>,
  language: string,
): string => {
  return fillPieces(template, values, language)
    .map((piece: FilledPiece): string => {
      return piece.text;
    })
    .join("");
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

  if (isComposedValue(value)) {
    return value.compose(getEnglishTranslator());
  }

  return String(value);
};

/*
 * The values as an English sentence takes them: a date, a time or a duration
 * written in the reader's language goes back to its English.
 */
const englishDateValues: (values: TemplateValues) => TemplateValues = (
  values: TemplateValues,
): TemplateValues => {
  const result: TemplateValues = {};

  for (const key of Object.keys(values)) {
    const value: TemplateValue = values[key] as TemplateValue;

    result[key] =
      typeof value === "string" ? getEnglishOf(value) ?? value : value;
  }

  return result;
};

/*
 * Every value as the English sentence shows it, as text: a date in the
 * reader's language goes back to its English (englishDateValues).
 */
const englishTextValues: (
  values: TemplateValues,
) => Record<string, SentenceValue> = (
  values: TemplateValues,
): Record<string, SentenceValue> => {
  const dated: TemplateValues = englishDateValues(values);
  const result: Record<string, SentenceValue> = {};

  for (const key of Object.keys(dated)) {
    const value: TemplateValue = dated[key] as TemplateValue;

    result[key] = toSentenceValue(value, englishValue(value), DEFAULT_LANGUAGE);
  }

  return result;
};

/*
 * `template` filled with `values` as a sentence that reads `direction`
 * holds them: each set apart in a Unicode isolate where it could move the
 * words around it (ReadingDirection's setApartInSentence) - in a Persian
 * sentence a name in Latin letters, an address, a time or a count; in an
 * English one a Persian name.
 *
 * A number the sentence writes against a sign the bidi algorithm reads
 * with it - "{{online}}/{{count}}", "{{hours}}:{{minutes}}", Persian's
 * "#{{number}}" behind its right-to-left mark - is left as it is: set
 * apart, it was cut off from its sign, and "3/5" was drawn "5/3"
 * (ReadingDirection's isNumberJoinedToASign, read on the sentence with
 * every value as it is).
 *
 * A slot's marker (TranslatedSentence, translateTemplateAround) is set
 * apart in a sentence read right to left when asked to (SentenceOptions'
 * setsSlotsApart), so what is drawn there as an element is too; otherwise
 * it is left as it is. As in fillSentenceValues, each value goes in the
 * form its place takes (startsASentence), with the spaces beside a term
 * that `language` writes (closeSpacesBesideTerms), a placeholder with no
 * value is left as it is, and each value goes in literally.
 */
const fillSettingValuesApart: (
  template: string,
  values: Record<string, SentenceValue>,
  direction: ReadingDirection,
  setsSlotsApart: boolean,
  language: string,
) => string = (
  template: string,
  values: Record<string, SentenceValue>,
  direction: ReadingDirection,
  setsSlotsApart: boolean,
  language: string,
): string => {
  const pieces: Array<FilledPiece> = fillPieces(template, values, language);
  // The sentence with every value as it is: what a number's signs are read in.
  let filled: string = "";
  // Where each piece starts in it.
  const starts: Array<number> = [];

  for (const piece of pieces) {
    starts.push(filled.length);
    filled += piece.text;
  }

  return pieces
    .map((piece: FilledPiece, index: number): string => {
      if (!piece.isValue) {
        return piece.text;
      }

      if (isSlotMarker(piece.text)) {
        return setsSlotsApart && direction === RIGHT_TO_LEFT
          ? `${FIRST_STRONG_ISOLATE}${piece.text}${POP_DIRECTIONAL_ISOLATE}`
          : piece.text;
      }

      const start: number = starts[index] as number;
      const end: number = start + piece.text.length;

      if (
        direction === RIGHT_TO_LEFT &&
        isNumberJoinedToASign(
          piece.text,
          filled.slice(Math.max(0, start - 2), start),
          filled.slice(end, end + 2),
        )
      ) {
        return piece.text;
      }

      return setApartInSentence(piece.text, direction);
    })
    .join("");
};

/*
 * Fills {{key}} placeholders from values, as an English sentence takes them:
 * a word cased for the middle of a sentence takes a capital where it starts
 * one (startsASentence). A placeholder with no value is left as it is, which
 * a test notices and a reader at least recognises as a slot. Each value goes
 * in literally: braces or "$t(" inside a name are never looked up again.
 */
export const fillTemplate: (
  template: string,
  values?: TemplateValues,
) => string = (template: string, values: TemplateValues = {}): string => {
  return template.replace(
    PLACEHOLDER,
    (match: string, key: string, at: number): string => {
      if (!Object.prototype.hasOwnProperty.call(values, key)) {
        return match;
      }

      const value: TemplateValue = values[key] as TemplateValue;
      const text: string = englishValue(value);

      return startsASentence(template, at)
        ? toSentenceValue(value, text, DEFAULT_LANGUAGE).atSentenceStart
        : text;
    },
  );
};

/*
 * Everything a component or a utility needs to put a translated string on
 * the screen, bound to one lookup and the reader's language. useTranslator()
 * builds one per render from react-i18next, so a language switch re-renders;
 * Common/UI/Utils/TranslateTemplate's functions use the global i18next
 * instance, for code that runs outside React; and the server builds one for
 * each reader's language (Common/Server/Utils/ServerTranslation).
 */
export interface Translator {
  // The reader's language code: "en", "de", "zh-CN".
  language: string;
  // A fixed string looked up by its English text; undefined stays undefined.
  translateText: (text: string | undefined) => string | undefined;
  // True when the reader's language has its own wording for the text.
  hasTranslation: (text: string) => boolean;
  // A whole sentence with {{placeholders}}, filled after it is translated.
  translateTemplate: (
    template: string,
    values?: TemplateValues,
    options?: SentenceOptions,
  ) => string;
  // A count-dependent sentence, in the form the reader's language uses.
  translatePlural: (
    template: PluralTemplate,
    count: number,
    values?: TemplateValues,
    options?: SentenceOptions,
  ) => string;
  // A word or name, as written on its own or in the middle of a sentence.
  translateTerm: (text: string | undefined, options?: TermOptions) => string;
  // A number as the reader's language writes it: 1,234 / 1.234 / 1 234.
  formatNumber: (value: number) => string;
}

/*
 * WHAT STANDS BETWEEN TWO FACTS ON ONE LINE.
 *
 * A middle dot with a space either side: "12 incidents · 3 alerts", "Uptime
 * · 24 hours". Persian writes its zero as a dot ("۰"), about the size of a
 * middle dot and at its height, so beside Persian digits the separator read
 * as a digit: "۱۲ حادثه · ۳ هشدار" looked like "۳ ۰", and "زمان کارکرد ·
 * ۲۴ ساعت" like "۰۲۴". A language whose zero is a dot takes a bullet there,
 * " • ", larger than any digit and read as the separator it is.
 */
export const INLINE_SEPARATOR: string = " \u{00B7} ";

export const DOT_ZERO_INLINE_SEPARATOR: string = " \u{2022} ";

// The zeros written as a dot: Persian's ("۰") and Arabic-Indic's ("٠").
const DOT_ZEROS: ReadonlyArray<string> = ["\u{06F0}", "\u{0660}"];

const dotZeroCache: Map<string, boolean> = new Map<string, boolean>();

/*
 * Whether `language` writes its zero as a dot, as Persian does ("۰"). Arabic
 * writes Latin digits in OneUptime (DateLanguage's LATIN_DIGIT_LANGUAGES), so
 * its zero is a "0" and its line takes the middle dot.
 */
export const writesZeroAsADot: (language: string | undefined) => boolean = (
  language: string | undefined,
): boolean => {
  const code: string = language || DEFAULT_LANGUAGE;
  const cached: boolean | undefined = dotZeroCache.get(code);

  if (cached !== undefined) {
    return cached;
  }

  let isDot: boolean = false;

  try {
    isDot = DOT_ZEROS.includes((0).toLocaleString(getNumberLocale(code)));
  } catch {
    isDot = false;
  }

  dotZeroCache.set(code, isDot);

  return isDot;
};

// What a line in `language` puts between two facts: " · ", or " • " in Persian.
export const getInlineSeparator: (language: string | undefined) => string = (
  language: string | undefined,
): string => {
  return writesZeroAsADot(language)
    ? DOT_ZERO_INLINE_SEPARATOR
    : INLINE_SEPARATOR;
};

/*
 * OneUptime's own words as `language` punctuates a line: each " · " the
 * words hold is a bullet in a language whose zero is a dot. Never a value's:
 * a monitor named "API · EU" is named as written.
 */
const punctuateInLanguage: (words: string, language: string) => string = (
  words: string,
  language: string,
): string => {
  if (!writesZeroAsADot(language) || !words.includes(INLINE_SEPARATOR)) {
    return words;
  }

  return words.split(INLINE_SEPARATOR).join(DOT_ZERO_INLINE_SEPARATOR);
};

export const createTranslator: (
  lookup: TextLookup | undefined,
  language?: string | undefined,
) => Translator = (
  lookup: TextLookup | undefined,
  language?: string | undefined,
): Translator => {
  const activeLanguage: string = language || DEFAULT_LANGUAGE;

  // OneUptime's words, punctuated as the reader's language punctuates a line.
  const punctuate: (words: string) => string = (words: string): string => {
    return punctuateInLanguage(words, activeLanguage);
  };

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

    // A text with no wording of its own may be a value: as it is.
    const stored: string | undefined = find(text);

    return stored === undefined ? text : punctuate(stored);
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
  const translatedValues: (
    values: TemplateValues,
  ) => Record<string, SentenceValue> = (
    values: TemplateValues,
  ): Record<string, SentenceValue> => {
    const result: Record<string, SentenceValue> = {};

    for (const key of Object.keys(values)) {
      const value: TemplateValue = values[key] as TemplateValue;
      let text: string;

      if (isTranslatableTerm(value)) {
        text = translateTerm(value.translatableTerm, {
          inSentence: value.inSentence,
        });
      } else if (isComposedValue(value)) {
        text = value.compose(translator);
      } else {
        text = String(value);
      }

      result[key] = toSentenceValue(value, text, activeLanguage);
    }

    return result;
  };

  // The way the reader's language reads: its sentences', and their values'.
  const readerDirection: ReadingDirection = getReadingDirection(activeLanguage);

  /*
   * The sentence is translated when its stored wording differs from the
   * English one; then its terms are translated too. Otherwise the English
   * sentence is filled with the English terms - except for a template with no
   * words of its own ("{{action}} {{itemName}}"), which belongs to no
   * language and always takes the reader's words. A word cased for the
   * middle of a sentence takes a capital where the sentence starts with it
   * (startsASentence).
   *
   * Asked to (SentenceOptions), each value is set apart from the sentence
   * where it could move the words around it (fillSettingValuesApart), by the
   * way the sentence reads: the reader's language's, or English's.
   */
  const fill: (
    stored: string | undefined,
    english: string,
    values: TemplateValues,
    options?: SentenceOptions | undefined,
  ) => string = (
    stored: string | undefined,
    english: string,
    values: TemplateValues,
    options?: SentenceOptions | undefined,
  ): string => {
    const setsValuesApart: boolean = Boolean(options?.setsValuesApart);
    const setsSlotsApart: boolean = Boolean(options?.setsSlotsApart);

    if (stored === undefined || stored === english) {
      /*
       * An English sentence on a Persian page holds Persian digits too (its
       * counts are written the reader's way): its separators are punctuated
       * the reader's way, its values never.
       */
      if (hasWords(english)) {
        return setsValuesApart
          ? fillSettingValuesApart(
              punctuate(english),
              englishTextValues(values),
              LEFT_TO_RIGHT,
              setsSlotsApart,
              DEFAULT_LANGUAGE,
            )
          : fillTemplate(punctuate(english), englishDateValues(values));
      }

      // No words of its own: the reader's words, as their sentence holds them.
      return setsValuesApart
        ? fillSettingValuesApart(
            punctuate(english),
            translatedValues(values),
            readerDirection,
            setsSlotsApart,
            activeLanguage,
          )
        : fillSentenceValues(
            punctuate(english),
            translatedValues(values),
            activeLanguage,
          );
    }

    return setsValuesApart
      ? fillSettingValuesApart(
          punctuate(stored),
          translatedValues(values),
          readerDirection,
          setsSlotsApart,
          activeLanguage,
        )
      : fillSentenceValues(
          punctuate(stored),
          translatedValues(values),
          activeLanguage,
        );
  };

  const translateTemplate: (
    template: string,
    values?: TemplateValues,
    options?: SentenceOptions,
  ) => string = (
    template: string,
    values: TemplateValues = {},
    options?: SentenceOptions,
  ): string => {
    return fill(find(template), template, values, options);
  };

  const formatNumber: (value: number) => string = (value: number): string => {
    try {
      // In the digits the language writes: Latin ones in Arabic too.
      return value.toLocaleString(getNumberLocale(activeLanguage));
    } catch {
      return value.toLocaleString();
    }
  };

  /*
   * The form for `count` the way i18next resolves it: the language's own
   * category ("few" for 3 in Russian) under the key plus "_few", else the key
   * itself, which holds the language's general (other) form - with the
   * category of the key it came from ("other" for the key itself).
   *
   * A language's "one" form is said for every count its language calls one
   * - 21 and 31 in Russian, 0 in French. A one form that says exactly one
   * (oneFormSaysOnlyOne: "Fired once" beside "Fired {{count}} times") is
   * said for one only: any other count of that category reads the general
   * form instead, which names the count ("Срабатываний: 21", not
   * "Сработало один раз").
   */
  const findPlural: (
    key: string,
    count: number,
    oneFormSaysOnlyOne?: boolean,
  ) => StoredPluralForm | undefined = (
    key: string,
    count: number,
    oneFormSaysOnlyOne: boolean = false,
  ): StoredPluralForm | undefined => {
    const category: string = getPluralCategory(activeLanguage, count);
    const saysOnlyOne: boolean =
      category === "one" && oneFormSaysOnlyOne && count !== 1;

    if (category !== "other" && !saysOnlyOne) {
      const form: string | undefined = find(`${key}_${category}`);

      if (form !== undefined) {
        return { text: form, category };
      }
    }

    const general: string | undefined = find(key);

    return general === undefined
      ? undefined
      : { text: general, category: "other" };
  };

  /*
   * Whether a plural form a locale holds is English left in it - a
   * placeholder, not a translation. A form is read against the English text
   * of its own key, never the other form's: a language's plural can read
   * like English's singular - Italian's "{{count}} host" for 3 hosts, the
   * "{{count}} VM" of French, Spanish, Hindi and Persian for 3 VMs.
   *
   * - A "_one" form is English left in the locale when it reads as
   *   English's one form, en.json's text for that key: Russian puts 21 in
   *   its "one" form, French puts 0 there, and neither may borrow the
   *   English "1 row" for it. Unless the language's general form reads the
   *   same: the language then words the sentence alike for every count, and
   *   the form is its own - French's "0 VM". A general form left English is
   *   never that witness: the lookup gives nothing for a key that maps to
   *   itself.
   * - Every other form - the general one, and a "_few", "_many", "_two" or
   *   "_zero" one, which en.json has none of - is English left in the
   *   locale when it reads as English's other form, what English writes for
   *   every count but one. English's one form there is the language's own,
   *   as in its general form.
   */
  const isEnglishPlaceholder: (
    form: StoredPluralForm,
    template: PluralTemplate,
  ) => boolean = (
    form: StoredPluralForm,
    template: PluralTemplate,
  ): boolean => {
    if (form.category !== "one") {
      return form.text === template.other;
    }

    return form.text === template.one && find(template.other) !== form.text;
  };

  const translatePlural: (
    template: PluralTemplate,
    count: number,
    values?: TemplateValues,
    options?: SentenceOptions,
  ) => string = (
    template: PluralTemplate,
    count: number,
    values: TemplateValues = {},
    options?: SentenceOptions,
  ): string => {
    // English has two forms: exactly one, and everything else.
    const english: string = count === 1 ? template.one : template.other;
    const stored: StoredPluralForm | undefined = findPlural(
      template.other,
      count,
      isOneFormOnlyForOne(template),
    );

    /*
     * An English form left in a locale is a placeholder, not a translation
     * (isEnglishPlaceholder): the sentence is English, in English's form for
     * the count.
     */
    const translated: string | undefined =
      stored === undefined || isEnglishPlaceholder(stored, template)
        ? undefined
        : stored.text;

    // {{count}} is written the reader's way unless the caller passes its own.
    return fill(
      translated,
      english,
      {
        count: formatNumber(count),
        ...values,
      },
      options,
    );
  };

  // A composed value in a translated sentence is built with this translator.
  const translator: Translator = {
    language: activeLanguage,
    translateText,
    hasTranslation,
    translateTemplate,
    translatePlural,
    translateTerm,
    formatNumber,
  };

  return translator;
};

/*
 * The translator an English sentence's composed values are built with: no
 * lookup, so every piece is English too.
 */
let englishTranslator: Translator | null = null;

const getEnglishTranslator: () => Translator = (): Translator => {
  if (!englishTranslator) {
    englishTranslator = createTranslator(undefined, DEFAULT_LANGUAGE);
  }

  return englishTranslator;
};

// How a language separates a list's items, where it is not a comma.
const LIST_SEPARATORS: Record<string, string> = {
  ar: "، ",
  fa: "، ",
  ja: "、",
  zh: "、",
};

/*
 * What a language puts between two items of a list with no "and" or "or":
 * ", " in most, "، " in Persian and Arabic, "、" in Japanese and Chinese. For a list
 * drawn item by item (IsolatedTextList), which formatList cannot join.
 */
export const getListSeparator: (language: string | undefined) => string = (
  language: string | undefined,
): string => {
  return LIST_SEPARATORS[getBaseLanguage(language)] || ", ";
};

/*
 * Names listed with the language's own separator and no "and" or "or": "a, b,
 * c", "a、b、c". For a list that says what is left out rather than a clause.
 */
export const formatList: (
  names: ReadonlyArray<string>,
  translator: Translator,
) => string = (
  names: ReadonlyArray<string>,
  translator: Translator,
): string => {
  return names.join(getListSeparator(translator.language));
};

/*
 * Facts on one line, each set off from the next as the reader's language
 * does (getInlineSeparator): "12 incidents · 3 alerts", "۱۲ حادثه • ۳ هشدار".
 */
export const formatInline: (
  parts: ReadonlyArray<string>,
  translator: Translator,
) => string = (
  parts: ReadonlyArray<string>,
  translator: Translator,
): string => {
  return parts.join(getInlineSeparator(translator.language));
};

/*
 * The language a sentence is drawn in: the reader's when their language has
 * its own wording of it, or when it has no words of its own ("{{label}}
 * {{time}}"), and English otherwise. A date drawn inside the sentence (a
 * TranslatedSentence slot) is written in it.
 */
export const getSentenceLanguage: (
  translator: Translator,
  template: string | PluralTemplate,
) => string = (
  translator: Translator,
  template: string | PluralTemplate,
): string => {
  const english: string =
    typeof template === "string" ? template : template.other;

  if (!hasWords(english) || translator.hasTranslation(english)) {
    return translator.language;
  }

  return DEFAULT_LANGUAGE;
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

export interface SentenceParts {
  parts: Array<SentencePart>;
  /*
   * The language the sentence is drawn in (getSentenceLanguage): the slots'
   * dates are written in it. English when the translation could not be used.
   */
  language: string;
}

export interface SentencePartsInput {
  translator: Translator;
  template: string | PluralTemplate;
  slots: ReadonlyArray<string>;
  values?: TemplateValues | undefined;
  count?: number | undefined;
  /*
   * Whether the slots are set apart from the sentence in a right-to-left
   * language (SentenceOptions' setsSlotsApart): yes for a sentence drawn as
   * one line of text, no for one whose pieces are boxes of their own.
   */
  setsSlotsApart?: boolean | undefined;
}

/*
 * A translated sentence in pieces, for a caller that draws some of its values
 * itself - a field name in bold, a link - between the pieces of text.
 * `slots` are the placeholders the caller draws; `values` fill the rest.
 *
 * A translation that lost one of the slots or repeated it cannot be drawn
 * whole, so the English sentence is used instead.
 */
export const getSentenceParts: (
  data: SentencePartsInput,
) => Array<SentencePart> = (data: SentencePartsInput): Array<SentencePart> => {
  return getSentencePartsAndLanguage(data).parts;
};

// getSentenceParts, with the language the sentence came out in.
export const getSentencePartsAndLanguage: (
  data: SentencePartsInput,
) => SentenceParts = (data: SentencePartsInput): SentenceParts => {
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

  /*
   * Drawn on the page and nothing else: its values (and its slots, in a
   * sentence read right to left) are set apart from its words
   * (SentenceOptions).
   */
  const options: SentenceOptions = {
    setsValuesApart: true,
    setsSlotsApart: Boolean(data.setsSlotsApart),
  };
  const translated: string =
    typeof data.template === "string"
      ? data.translator.translateTemplate(data.template, withMarkers, options)
      : data.translator.translatePlural(
          data.template,
          count,
          withMarkers,
          options,
        );

  const englishValues: TemplateValues = isPlural
    ? { count: data.translator.formatNumber(count), ...withMarkers }
    : withMarkers;

  const translatedParts: Array<SentencePart> | null = split(translated);

  if (translatedParts) {
    return {
      parts: translatedParts,
      language: getSentenceLanguage(data.translator, data.template),
    };
  }

  return {
    parts: split(
      fillSettingValuesApart(
        englishTemplate,
        englishTextValues(englishValues),
        LEFT_TO_RIGHT,
        false,
        DEFAULT_LANGUAGE,
      ),
    ) || [
      {
        kind: "text",
        text: fillTemplate(
          englishTemplate,
          englishDateValues({
            ...(isPlural ? { count: data.translator.formatNumber(count) } : {}),
            ...(data.values || {}),
          }),
        ),
      },
    ],
    language: DEFAULT_LANGUAGE,
  };
};

export interface TemplateAround {
  before: string;
  after: string;
}

export interface TemplateAroundOptions {
  /*
   * Whether the slot is set apart from the words around it in a sentence
   * read right to left (SentenceOptions' setsSlotsApart): yes, the default,
   * for halves drawn as text with the slot's element inline between them -
   * a name in bold in a line of the page. No for halves drawn as boxes of
   * their own - a flex row, a number box between two labels - where an
   * isolate's mark at the end of a half is a piece of its own: "Wait
   * {{minutes}} minutes" is "{{minutes}} دقیقه صبر کن" in Persian, and its
   * empty first half, holding the mark alone, was drawn as one more item
   * of the row, a gap before the box.
   */
  setsSlotApart?: boolean | undefined;
}

/*
 * The translated sentence cut in two around one {{slot}}, for a caller that
 * draws the slot's value itself - in bold, say - between the two halves,
 * in `translator`'s language (translateTemplateAround, outside React: the
 * global i18next instance's).
 *
 * The value never goes through the translation: whatever a name contains
 * (braces, "$t(", markup), it is drawn as text by the caller.
 */
export const getTemplateAround: (
  translator: Translator,
  template: string,
  slot: string,
  values?: TemplateValues,
  options?: TemplateAroundOptions,
) => TemplateAround = (
  translator: Translator,
  template: string,
  slot: string,
  values: TemplateValues = {},
  options?: TemplateAroundOptions,
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
   *
   * Drawn on the page and nothing else: the values, and the slot in a
   * sentence read right to left unless its halves are boxes of their own
   * (TemplateAroundOptions), set apart from its words (SentenceOptions).
   */
  return (
    split(
      translator.translateTemplate(template, withMarker, {
        setsValuesApart: true,
        setsSlotsApart: options?.setsSlotApart !== false,
      }),
    ) ||
    split(fillTemplate(template, englishDateValues(withMarker))) || {
      before: fillTemplate(template, englishDateValues(values)),
      after: "",
    }
  );
};
