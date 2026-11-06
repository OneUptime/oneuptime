import OneUptimeDate from "../../../Types/Date";
import { translationKey, Translator } from "../../../Types/Translator";
import { writeInLanguage } from "../ServerTranslation";
import SubscriberLanguage, {
  StatusPageWithLanguage,
} from "./SubscriberLanguage";
import SubscriberMessageText from "./SubscriberMessageText";

/*
 * THE VALUES A CUSTOM TEMPLATE IS FILLED WITH, IN ITS PAGE'S LANGUAGE.
 *
 * A status page's custom notification template is the team's own text,
 * written once - most often in the page's default language (Default
 * Language, on its Branding page). It reads as written, to every
 * subscriber. Some of the values OneUptime fills it with are OneUptime's
 * own words, though, and those are written in that same language, so a
 * German template does not read "Status: Resolved":
 *
 *   - OneUptime's default names of states and severities ("Resolved",
 *     "Major Incident", "Ongoing"; Types/StatusPage/DefaultStatusNames) -
 *     a project's own names read as written;
 *   - a fixed word, such as "None" for a resource list that lists none, and
 *     "Yes" or "No" for a Yes / No custom field;
 *   - a date and time, as the notifications write one (when a note was
 *     posted, when an event is scheduled) - and every other date written
 *     while the values are worked out (writeInLanguage).
 *
 * Titles, descriptions, notes, names, addresses and every other value read
 * as they are. A page with no default language is written in English,
 * exactly as before. A subscriber's own language is for OneUptime's default
 * messages (SubscriberLanguage): a custom template is one text for all.
 */

// A value: as it is, or OneUptime's words written in the page's language.
export type SubscriberTemplateValue =
  | string
  | ((translator: Translator) => string);

export type SubscriberTemplateValueMap = Record<
  string,
  SubscriberTemplateValue
>;

// The words a Yes / No custom field reads as.
export const SubscriberTemplateValueText: {
  readonly yes: string;
  readonly no: string;
} = {
  yes: translationKey("Yes"),
  no: translationKey("No"),
};

export default class SubscriberTemplateValues {
  /*
   * A state's or a severity's name: OneUptime's default ones in the page's
   * language, a project's own as written, `whenEmpty` for none.
   */
  public static stateName(
    name: string | null | undefined,
    whenEmpty: string = "",
  ): SubscriberTemplateValue {
    return (translator: Translator): string => {
      return name
        ? SubscriberMessageText.nameInLanguage(translator, name)
        : whenEmpty;
    };
  }

  // A fixed word or sentence (a translationKey) in the page's language.
  public static text(key: string): SubscriberTemplateValue {
    return (translator: Translator): string => {
      return SubscriberMessageText.text(translator, key);
    };
  }

  /*
   * A date and time as the subscriber notifications write one ("Oct 16,
   * 2026, 10:12 AM UTC", OneUptimeDate.getDateAsUserFriendlyFormattedString),
   * in the page's language; nothing for none.
   */
  public static date(date: Date | null | undefined): SubscriberTemplateValue {
    return (): string => {
      return date
        ? OneUptimeDate.getDateAsUserFriendlyFormattedString(date)
        : "";
    };
  }

  /*
   * A Yes / No value as it reads in `translator`'s language: "Ja" in German.
   * Only the two words a Yes / No field is written as; any other text reads
   * as it is.
   */
  public static yesOrNo(text: string, translator: Translator): string {
    if (
      text !== SubscriberTemplateValueText.yes &&
      text !== SubscriberTemplateValueText.no
    ) {
      return text;
    }

    return SubscriberMessageText.text(translator, text);
  }

  // Each value written with `translator`: its words in its language.
  public static write(
    values: SubscriberTemplateValueMap,
    translator: Translator,
  ): Record<string, string> {
    const written: Record<string, string> = {};

    for (const [name, value] of Object.entries(values)) {
      written[name] = typeof value === "function" ? value(translator) : value;
    }

    return written;
  }

  /*
   * The values of a page's custom templates, written in its default
   * language (SubscriberLanguage.getStatusPageLanguage): English for a page
   * with none.
   */
  public static inPageLanguage(
    statusPage: StatusPageWithLanguage | null | undefined,
    values: SubscriberTemplateValueMap,
  ): Record<string, string> {
    return this.workInPageLanguage(
      statusPage,
      (translator: Translator): Record<string, string> => {
        return this.write(values, translator);
      },
    );
  }

  // A fixed word or sentence (a translationKey) in the page's language.
  public static textInPageLanguage(
    statusPage: StatusPageWithLanguage | null | undefined,
    key: string,
  ): string {
    return this.workInPageLanguage(
      statusPage,
      (translator: Translator): string => {
        return SubscriberMessageText.text(translator, key);
      },
    );
  }

  /*
   * `work` in the page's default language: its translator, and its dates
   * written in that language while it runs (writeInLanguage). Synchronous.
   */
  public static workInPageLanguage<T>(
    statusPage: StatusPageWithLanguage | null | undefined,
    work: (translator: Translator) => T,
  ): T {
    return writeInLanguage(
      SubscriberLanguage.getStatusPageLanguage(statusPage),
      work,
    );
  }
}
