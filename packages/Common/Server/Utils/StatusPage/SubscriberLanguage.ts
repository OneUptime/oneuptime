import {
  DEFAULT_READER_LANGUAGE,
  getReaderLanguageFromAcceptLanguage,
  READER_LANGUAGE_CODES,
  toSupportedLanguage,
} from "../../../Types/ReaderLanguage";

/*
 * THE LANGUAGE A STATUS PAGE'S SUBSCRIBER IS WRITTEN TO IN.
 *
 * A status page is shown in its default language (Default Language, on its
 * Branding page), and a visitor can read it in another from its footer.
 * Its notifications - incidents, their notes and states, scheduled
 * maintenance, announcements, postmortems - and the messages about a
 * subscription (the link to confirm it, the welcome, the link to manage
 * it) are written in the subscriber's language: the one they read the
 * page in when they signed up, or last changed their subscription there,
 * when that was not the page's default, and otherwise the page's default
 * language. A subscriber the team added, and
 * one who signed up before this, has none of their own, and follows the
 * page's default language - also when it changes. The uptime report is
 * still written in English.
 *
 * OneUptime's own words are what change: the subjects, headings, labels,
 * buttons and sentences of its default messages, OneUptime's default names
 * of states and severities, and dates. What the team wrote - titles, notes,
 * descriptions, a custom template - reads as written.
 */

export interface SubscriberWithLanguage {
  language?: string | null | undefined;
}

export interface StatusPageWithLanguage {
  defaultLanguage?: string | null | undefined;
}

export default class SubscriberLanguage {
  // A status page's default language, or English.
  public static getStatusPageLanguage(
    statusPage: StatusPageWithLanguage | null | undefined,
  ): string {
    return (
      toSupportedLanguage(
        statusPage?.defaultLanguage?.trim(),
        READER_LANGUAGE_CODES,
      ) || DEFAULT_READER_LANGUAGE
    );
  }

  /*
   * The language a subscriber's messages are written in: their own, else
   * their page's default language, else English.
   */
  public static getLanguage(data: {
    subscriber: SubscriberWithLanguage | null | undefined;
    statusPage: StatusPageWithLanguage | null | undefined;
  }): string {
    const ownLanguage: string = toSupportedLanguage(
      data.subscriber?.language?.trim(),
      READER_LANGUAGE_CODES,
    );

    return ownLanguage || this.getStatusPageLanguage(data.statusPage);
  }

  /*
   * What a sign-up or a change on the status page stores as the
   * subscriber's language: the language the visitor reads the page in
   * (its request's Accept-Language, which the status page sets to it) when
   * that is not the page's default - null when it is, or when the request
   * names no language OneUptime writes in, so the subscriber follows the
   * page.
   */
  public static getLanguageToStore(data: {
    acceptLanguage: string | Array<string> | null | undefined;
    statusPage: StatusPageWithLanguage | null | undefined;
  }): string | null {
    const requested: string | null = getReaderLanguageFromAcceptLanguage(
      data.acceptLanguage,
    );

    if (!requested) {
      return null;
    }

    return requested === this.getStatusPageLanguage(data.statusPage)
      ? null
      : requested;
  }

  /*
   * A language the team gives a subscriber, as stored: one of the codes
   * OneUptime writes in ("de-AT" is "de"), null for none (the page's
   * default), and undefined when it names no language OneUptime writes in.
   */
  public static normalizeLanguageToStore(
    language: string | null | undefined,
  ): string | null | undefined {
    if (language === null || language === undefined) {
      return null;
    }

    const trimmed: string = String(language).trim();

    if (!trimmed) {
      return null;
    }

    return toSupportedLanguage(trimmed, READER_LANGUAGE_CODES) || undefined;
  }
}
