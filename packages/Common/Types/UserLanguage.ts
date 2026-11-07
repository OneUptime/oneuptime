import {
  DEFAULT_READER_LANGUAGE,
  READER_LANGUAGE_CODES,
  toSupportedLanguage,
} from "./ReaderLanguage";

/*
 * THE LANGUAGE ONEUPTIME WRITES TO A PERSON IN.
 *
 * Everybody reads the Dashboard in a language of their own - the one
 * their browser asks for, or the one they picked in the language menu at
 * the bottom of every page. What OneUptime sends them was English whatever
 * that language was. A person's language is now part of their account
 * (User.language), so it follows them to every browser and to what
 * OneUptime sends them:
 *
 *   - set on User Profile, Basic Info's Language, or by picking a language
 *     in the Dashboard's language menu while signed in;
 *   - the Dashboard starts in it on every browser they sign in on;
 *   - their on-call pages - email, text message, push notification,
 *     Telegram, and their own Slack, Microsoft Teams and Mattermost
 *     messages - are written in it (Server/Utils/Notification/UserLanguage).
 *
 * A person who never picked one has none: the Dashboard starts in their
 * browser's language, as it always did, and what OneUptime sends them is
 * English, as it always was. Nothing changes for anybody until they pick a
 * language.
 *
 * The language is one of the codes OneUptime writes in ("de", "zh-TW",
 * "fa": Types/ReaderLanguage); "en" is a choice of its own - it keeps the
 * Dashboard in English on a browser that asks for another language.
 *
 * Pure, with no Node, browser or database APIs.
 */

/*
 * What somebody is told who sets a language OneUptime does not write in
 * (through the API): the codes it takes.
 */
export const UNSUPPORTED_USER_LANGUAGE_MESSAGE: string = `Language must be one of: ${READER_LANGUAGE_CODES.join(", ")}. Leave it empty to be written to in English.`;

export interface UserWithLanguage {
  language?: string | null | undefined;
}

/*
 * A language somebody gives a person, as it is stored: one of the codes
 * OneUptime writes in ("de-AT" is "de", "zh-HK" is "zh-TW"), null for none
 * (an empty value), and undefined when it names no language OneUptime
 * writes in - which the write is refused for.
 */
export const normalizeUserLanguageToStore: (
  language: unknown,
) => string | null | undefined = (
  language: unknown,
): string | null | undefined => {
  if (language === null || language === undefined) {
    return null;
  }

  if (typeof language !== "string") {
    return undefined;
  }

  const trimmed: string = language.trim();

  if (!trimmed) {
    return null;
  }

  return toSupportedLanguage(trimmed, READER_LANGUAGE_CODES) || undefined;
};

/*
 * The language a person picked, as one of the codes OneUptime writes in,
 * or "" when they picked none (or what is stored is no language OneUptime
 * writes in).
 */
export const getUserChosenLanguage: (
  user: UserWithLanguage | null | undefined,
) => string = (user: UserWithLanguage | null | undefined): string => {
  const stored: unknown = user?.language;

  if (typeof stored !== "string") {
    return "";
  }

  return toSupportedLanguage(stored.trim(), READER_LANGUAGE_CODES);
};

/*
 * The language OneUptime writes to a person in: the one they picked, else
 * English.
 */
export const getUserWritingLanguage: (
  user: UserWithLanguage | null | undefined,
) => string = (user: UserWithLanguage | null | undefined): string => {
  return getUserChosenLanguage(user) || DEFAULT_READER_LANGUAGE;
};
