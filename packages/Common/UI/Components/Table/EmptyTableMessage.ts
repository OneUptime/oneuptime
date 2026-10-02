/*
 * The words an empty table shows when its page has not written its own.
 *
 * They are built from the table's plural noun - "No monitors yet." - and a
 * sentence built that way cannot be translated a word at a time: "No" is also
 * the answer to a question, so German read "Nein monitors yet.", and word
 * order and plural forms differ between languages anyway. So the whole
 * sentence is looked up first; a locale without it gets a sentence that needs
 * no noun ("Nothing here yet."); and only a locale that has neither - English,
 * where both look up to themselves - builds the sentence from the noun.
 */

export type TranslateFunction = (value: string) => string;

export const NOTHING_HERE_YET: string = "Nothing here yet.";

export const NOTHING_MATCHES_SEARCH_OR_FILTERS: string =
  "Nothing matches your search or filters.";

// What a failed load says when its locale has no sentence for the noun.
export const COULD_NOT_LOAD_THIS_LIST: string = "Couldn't load this list.";

// Two capitals in a row: "SLOs", "API". Such a word is kept as written.
const ACRONYM_PATTERN: RegExp = new RegExp("[A-Z]{2,}");

/*
 * "Monitors" -> "monitors", "On-Call Duty Policies" -> "on-call duty
 * policies", but "SLOs" and "API Keys" keep their acronyms ("SLOs", "API
 * keys") - lower-casing every letter, as the tables used to, gave "slos".
 */
export const toSentenceNoun: (pluralLabel: string) => string = (
  pluralLabel: string,
): string => {
  const words: Array<string> = pluralLabel.trim().split(" ");

  return words
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .map((word: string): string => {
      return ACRONYM_PATTERN.test(word) ? word : word.toLocaleLowerCase();
    })
    .join(" ");
};

interface NounSentence {
  // The sentence with the noun in it, in English: "No monitors yet."
  sentence: string;
  // The same thing said without a noun: "Nothing here yet."
  nounFreeSentence: string;
  translate: TranslateFunction;
}

/*
 * The whole sentence in the reader's language if the locale has it, else the
 * noun-free one if the locale has that, else (English) the sentence itself.
 */
const lookUpNounSentence: (options: NounSentence) => string = (
  options: NounSentence,
): string => {
  const translatedSentence: string = options.translate(options.sentence);

  if (translatedSentence && translatedSentence !== options.sentence) {
    return translatedSentence;
  }

  const translatedNounFreeSentence: string = options.translate(
    options.nounFreeSentence,
  );

  if (
    translatedNounFreeSentence &&
    translatedNounFreeSentence !== options.nounFreeSentence
  ) {
    return translatedNounFreeSentence;
  }

  return options.sentence;
};

export interface EmptyTableMessageOptions {
  // The table's plural noun, in English: "Monitors", "Status Pages".
  pluralLabel: string;
  // A search or filter emptied the table, not a project with nothing in it.
  isFiltered: boolean;
  translate: TranslateFunction;
}

export const getEmptyTableMessage: (
  options: EmptyTableMessageOptions,
) => string = (options: EmptyTableMessageOptions): string => {
  const noun: string = toSentenceNoun(options.pluralLabel) || "items";

  return lookUpNounSentence({
    sentence: options.isFiltered
      ? `No ${noun} match your search or filters.`
      : `No ${noun} yet.`,
    nounFreeSentence: options.isFiltered
      ? NOTHING_MATCHES_SEARCH_OR_FILTERS
      : NOTHING_HERE_YET,
    translate: options.translate,
  });
};

/*
 * A full stop ends a sentence, not a heading: the empty state's title reads
 * "No monitors yet", while the sentence it is looked up as keeps its stop so
 * the translations already written for it still match. Only a single stop
 * goes ("Loading..." keeps its dots), and "!" and "?" stay - they say
 * something.
 */
const FULL_STOPS: string = ".．。।";

export const toHeadline: (sentence: string) => string = (
  sentence: string,
): string => {
  const text: string = sentence.trim();
  const last: string = text.charAt(text.length - 1);
  const beforeLast: string = text.charAt(text.length - 2);

  if (!last || !FULL_STOPS.includes(last)) {
    return text;
  }

  if (beforeLast && FULL_STOPS.includes(beforeLast)) {
    return text;
  }

  return text.slice(0, -1).trim();
};

export const getEmptyTableTitle: (
  options: EmptyTableMessageOptions,
) => string = (options: EmptyTableMessageOptions): string => {
  return toHeadline(getEmptyTableMessage(options));
};

export interface LoadErrorTitleOptions {
  pluralLabel: string;
  translate: TranslateFunction;
}

// "Couldn't load monitors" - what a table whose load failed is headed with.
export const getLoadErrorTitle: (options: LoadErrorTitleOptions) => string = (
  options: LoadErrorTitleOptions,
): string => {
  const noun: string = toSentenceNoun(options.pluralLabel) || "items";

  return toHeadline(
    lookUpNounSentence({
      sentence: `Couldn't load ${noun}.`,
      nounFreeSentence: COULD_NOT_LOAD_THIS_LIST,
      translate: options.translate,
    }),
  );
};

export interface EmptyMessageParts {
  title: string;
  description?: string | undefined;
}

/*
 * Sentence ends. ". ! ?" (and the Devanagari and Arabic ones) end a sentence
 * when a space follows; the full-width marks of Chinese and Japanese end one
 * on their own, as no space follows them.
 */
const SPACED_SENTENCE_ENDS: string = ".!?।؟";
const UNSPACED_SENTENCE_ENDS: string = "。！？";
const WHITESPACE: RegExp = /\s/u;

/*
 * Whether a run of text starts a new sentence. Anything but a lower-case
 * letter does - a capital, a digit, a quote, or a letter of a script without
 * case - so "e.g. a probe" is not split after "e.g.".
 */
const startsSentence: (text: string) => boolean = (text: string): boolean => {
  const first: string = text.charAt(0);

  if (!first) {
    return false;
  }

  if (first.toLocaleLowerCase() === first.toLocaleUpperCase()) {
    return true;
  }

  return first === first.toLocaleUpperCase();
};

/*
 * Past this a first sentence is a paragraph, not a heading: the whole
 * message is then said under the table's own title instead.
 */
export const LONGEST_HEADLINE: number = 100;

/*
 * A page's own empty-state message, made into a title and a description:
 * the first sentence is the title and the rest, if there is any, the
 * description. "No site types yet. Add one to start describing your site
 * hierarchy." is headed "No site types yet". The message arrives already
 * translated, so it is split in the reader's language.
 */
export const splitEmptyMessage: (message: string) => EmptyMessageParts = (
  message: string,
): EmptyMessageParts => {
  const text: string = message.trim();

  for (let index: number = 0; index < text.length - 1; index++) {
    const character: string = text.charAt(index);

    const isSentenceEnd: boolean =
      UNSPACED_SENTENCE_ENDS.includes(character) ||
      (SPACED_SENTENCE_ENDS.includes(character) &&
        WHITESPACE.test(text.charAt(index + 1)));

    if (!isSentenceEnd) {
      continue;
    }

    const rest: string = text.slice(index + 1).trim();

    if (!rest) {
      break;
    }

    if (startsSentence(rest)) {
      return {
        title: toHeadline(text.slice(0, index + 1)),
        description: rest,
      };
    }
  }

  return { title: toHeadline(text) };
};

/*
 * A page's own message as an empty state: split as above, unless its first
 * sentence is too long to be a heading - then the table's own title heads it
 * and the whole message is its description.
 */
export const getEmptyMessageParts: (data: {
  message: string;
  defaultTitle: string;
}) => EmptyMessageParts = (data: {
  message: string;
  defaultTitle: string;
}): EmptyMessageParts => {
  const parts: EmptyMessageParts = splitEmptyMessage(data.message);

  if (parts.title.length > LONGEST_HEADLINE) {
    return { title: data.defaultTitle, description: data.message.trim() };
  }

  return parts;
};
