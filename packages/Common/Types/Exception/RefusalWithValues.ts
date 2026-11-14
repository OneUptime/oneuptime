import { fillTemplate, TemplateValues, translatableTerm } from "../Translator";

/*
 * A REFUSAL WITH VALUES IN IT, IN THE READER'S LANGUAGE (#7678).
 *
 * The server refuses in English sentences: an API client, the CLI and
 * Terraform read them as they are, and the Dashboard says a fixed one in
 * its reader's language by looking it up - the sentence is a key of its
 * locales (EpisodeMembersAdd's reasons, a monitor template's link
 * refusals). A sentence with a value in it is no key once the value is in:
 * "Monitor type "Ping" does not match template type "API"" read in English
 * in every language.
 *
 * Such a refusal is kept as its sentence with {{placeholders}}, a key of
 * the Dashboard's locales. The server fills it in English
 * (getRefusalText); the Dashboard reads the values back out of the English
 * it gets (readRefusalValues) and says the sentence in the reader's
 * language with them (Common/UI/Utils/ErrorInSentence). A value that is
 * one of the product's own words - a monitor type - is said as the
 * reader's word for it.
 *
 * Read with indexOf, never a regular expression built from the sentence:
 * a message is outside text.
 *
 * React-free and server-safe.
 */
export interface RefusalWithValues {
  // The English sentence, with its {{placeholders}}: a key of the locales.
  template: string;
  /*
   * The placeholders whose values are the product's own words, said in the
   * reader's language with the sentence (translatableTerm). Any other value
   * goes in as written.
   */
  terms: ReadonlyArray<string>;
}

// A {{placeholder}}, read as Common/Types/Translator fills one.
const PLACEHOLDER: RegExp = /\{\{\s*([\w.]+)\s*\}\}/g;

/*
 * The sentence cut at its placeholders: the words before each one, and the
 * words after the last (so one more piece of words than placeholders).
 */
const cutAtPlaceholders: (template: string) => {
  words: Array<string>;
  placeholders: Array<string>;
} = (
  template: string,
): {
  words: Array<string>;
  placeholders: Array<string>;
} => {
  const words: Array<string> = [];
  const placeholders: Array<string> = [];
  let wordsStart: number = 0;

  for (const match of template.matchAll(PLACEHOLDER)) {
    const start: number = match.index || 0;

    words.push(template.slice(wordsStart, start));
    placeholders.push(match[1] || "");
    wordsStart = start + match[0].length;
  }

  words.push(template.slice(wordsStart));

  return { words: words, placeholders: placeholders };
};

// The refusal as the server answers it: in English, with its values in it.
export const getRefusalText: (
  refusal: RefusalWithValues,
  values: Record<string, string>,
) => string = (
  refusal: RefusalWithValues,
  values: Record<string, string>,
): string => {
  return fillTemplate(refusal.template, values);
};

/*
 * The values of `refusal` that `message` holds, as the sentence's values -
 * each of `terms` a word to say in the reader's language - or null when
 * `message` is not that refusal. Each value is the text between the words
 * around its placeholder; a placeholder the sentence names twice reads the
 * same text both times, and no value is empty.
 */
export const readRefusalValues: (
  refusal: RefusalWithValues,
  message: string | null | undefined,
) => TemplateValues | null = (
  refusal: RefusalWithValues,
  message: string | null | undefined,
): TemplateValues | null => {
  const text: string = (message || "").trim();
  const { words, placeholders } = cutAtPlaceholders(refusal.template);
  const first: string = words[0] || "";

  if (placeholders.length === 0 || !text.startsWith(first)) {
    return null;
  }

  const read: Record<string, string> = {};
  let position: number = first.length;

  for (let index: number = 0; index < placeholders.length; index++) {
    const placeholder: string = placeholders[index] || "";
    const after: string = words[index + 1] || "";
    const isLast: boolean = index === placeholders.length - 1;
    let end: number = -1;

    if (isLast) {
      end = text.endsWith(after) ? text.length - after.length : -1;
    } else if (after) {
      end = text.indexOf(after, position);
    }

    // Two placeholders with no words between them cannot be told apart.
    if (end <= position) {
      return null;
    }

    const value: string = text.slice(position, end);

    if (read[placeholder] !== undefined && read[placeholder] !== value) {
      return null;
    }

    read[placeholder] = value;
    position = end + after.length;
  }

  const values: TemplateValues = {};

  for (const placeholder of Object.keys(read)) {
    const value: string = read[placeholder] || "";

    values[placeholder] = refusal.terms.includes(placeholder)
      ? translatableTerm(value)
      : value;
  }

  return values;
};
