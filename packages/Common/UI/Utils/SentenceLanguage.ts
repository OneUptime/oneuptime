import React, { useContext } from "react";
import {
  getDateDisplayLanguage,
  withDateDisplayLanguage,
} from "../../Types/DateLanguage";

/*
 * The language of the sentence an element is drawn inside.
 *
 * TranslatedSentence draws its slots - a time, a duration, a link - inside a
 * sentence that is in the reader's language when their language words it,
 * and in English while it does not. A date in a slot is written in that
 * sentence's language, never a German date inside an English sentence, so a
 * TranslatedSentence tells its slots which language it came out in. Null
 * outside any sentence.
 */
export const SentenceLanguageContext: React.Context<string | null> =
  React.createContext<string | null>(null);

// The language of the sentence around this element, or null outside one.
export const useSentenceLanguage: () => string | null = (): string | null => {
  return useContext(SentenceLanguageContext);
};

/*
 * The language a date drawn here is written in: the sentence's inside a
 * TranslatedSentence, the page's (OneUptimeDate's display language)
 * everywhere else.
 */
export const useDateLanguage: () => string = (): string => {
  return useSentenceLanguage() ?? getDateDisplayLanguage();
};

/*
 * `write`'s dates in the language of the sentence around this element:
 * OneUptimeDate's helpers (fromNow, getDateAs...String) read the display
 * language, which a sentence still in English sets to English for them.
 */
export const useWriteDatesInSentenceLanguage: () => <T>(
  write: () => T,
) => T = (): (<T>(write: () => T) => T) => {
  const sentenceLanguage: string | null = useSentenceLanguage();

  return <T>(write: () => T): T => {
    return sentenceLanguage === null
      ? write()
      : withDateDisplayLanguage(sentenceLanguage, write);
  };
};
