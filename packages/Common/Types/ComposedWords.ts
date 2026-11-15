/*
 * WORDS BUILT FROM A NAME, LOOKED UP AS THE SENTENCE THEY WERE BUILT FROM
 * (#8642).
 *
 * Some words are built in code from a name: a workflow's record step is
 * "Find One Incident", "On Create Alert", "Query that selects which
 * Monitors this component acts on...", one for every model a workflow can
 * use. The English is what everything stores, searches and logs, but no
 * locale can have a key for every model's copy of it, so the builder drew
 * each in English in every language.
 *
 * composeWords builds the English as before and remembers the sentence it
 * came from: its template ("Find One {{itemName}}", a key of the
 * Dashboard's locales) and the names filled into it. A Translator that has
 * no wording of its own for the English then looks the template up and
 * fills it with the names as terms of the sentence (Types/Translator's
 * find), so the reader reads "Einen Vorfall finden". Where the language has
 * not worded the template yet, the English stays, word for word.
 */

export interface ComposedWords {
  // The sentence the words were built from: a key of the locales.
  template: string;
  // The names filled into it, each looked up as a term of the sentence.
  terms: Record<string, string>;
  /*
   * Whether the names stand inside a sentence, where a language that
   * lowers a noun mid-sentence lowers them; a title keeps their case.
   */
  inSentence: boolean;
}

export interface ComposeWordsOptions {
  inSentence?: boolean | undefined;
}

const PLACEHOLDER: RegExp = /\{\{\s*(\w+)\s*\}\}/g;

const COMPOSED: Map<string, ComposedWords> = new Map<string, ComposedWords>();

// The English a template reads with these names, filled in as written.
export const fillComposedWords: (
  template: string,
  terms: Record<string, string>,
) => string = (template: string, terms: Record<string, string>): string => {
  return template.replace(
    PLACEHOLDER,
    (placeholder: string, name: string): string => {
      return Object.prototype.hasOwnProperty.call(terms, name)
        ? (terms[name] as string)
        : placeholder;
    },
  );
};

/*
 * The English the template reads with the names, remembered as built from
 * it, so a Translator can word it in the reader's language. The first
 * sentence that builds an English wins: the same English is the same words.
 */
export const composeWords: (
  template: string,
  terms: Record<string, string>,
  options?: ComposeWordsOptions,
) => string = (
  template: string,
  terms: Record<string, string>,
  options?: ComposeWordsOptions,
): string => {
  const english: string = fillComposedWords(template, terms);

  if (english !== template && !COMPOSED.has(english)) {
    COMPOSED.set(english, {
      template: template,
      terms: { ...terms },
      inSentence: Boolean(options?.inSentence),
    });
  }

  return english;
};

// The sentence an English was built from, when composeWords built it.
export const composedWordsOf: (text: string) => ComposedWords | undefined = (
  text: string,
): ComposedWords | undefined => {
  return COMPOSED.get(text);
};
