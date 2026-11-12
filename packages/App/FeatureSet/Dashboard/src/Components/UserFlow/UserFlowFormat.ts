import { UserFlowScope } from "./UserFlowScope";
import { translationKey, Translator } from "Common/Types/Translator";
import { getNumberLocale } from "Common/Types/DateLanguage";

/*
 * Number formatting for the User Flows page. Pure, so the copy the page
 * prints is pinned by node tests. Given the reader's Translator, a count and
 * a sentence read in the reader's language; without one they read in
 * English, as the tests pin them.
 */

/*
 * The map's own name for the pages it folds together at a step: Common's
 * OTHER_PAGES_LABEL, which the map, its tooltips and the detail panel look
 * up by its English. Named here, where the Dashboard's locales are drawn
 * from, so each language words it (a test pins the two equal); before, no
 * locale held it and every reader saw "Other pages".
 */
export const USER_FLOW_OTHER_PAGES_NAME: string = translationKey("Other pages");

export function formatUserFlowCount(
  value: number,
  translator?: Translator | undefined,
): string {
  if (!Number.isFinite(value)) {
    return translator ? translator.formatNumber(0) : "0";
  }

  if (translator) {
    return translator.formatNumber(Math.round(value));
  }

  return Math.round(value).toLocaleString("en-US");
}

/*
 * A share below the smallest one the page writes, 1%. English writes the
 * sign, "<1%", as its tables always have, and the code writes it so for any
 * language without words of its own. Each language says it the way it reads
 * in a table cell and at the start of a sentence alike: the sign in German,
 * French or Russian ("<1 %", where a word would want a capital there), words
 * in Persian and Arabic ("کمتر از ۱٪": a "<" beside a number read from the
 * right is drawn mirrored, and easily taken the wrong way round), and in
 * Japanese, Korean, Chinese and Hindi, which say it so ("1%未満").
 */
export const USER_FLOW_SHARE_UNDER_ONE_PERCENT: string = translationKey(
  "less than {{percent}}",
);

/*
 * A percent as the reader's language writes it: "4.5%", "4,5 %" in German
 * and French, "۴٫۵٪" in Persian, Latin digits in Arabic (getNumberLocale).
 * `percent` is already rounded to `decimals` places.
 */
function writeUserFlowPercent(
  percent: number,
  decimals: number,
  language: string,
): string {
  const options: Intl.NumberFormatOptions = {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  };

  try {
    return new Intl.NumberFormat(getNumberLocale(language), options).format(
      percent / 100,
    );
  } catch {
    return new Intl.NumberFormat("en", options).format(percent / 100);
  }
}

// How far from a whole percent floating point's error leaves a share.
const WHOLE_PERCENT_TOLERANCE: number = 1e-9;

/*
 * A share of sessions: 0.4567 -> "46%", 0.045 -> "4.5%", 0.004 -> "<1%",
 * 0 -> "0%". Given the reader's Translator, in the reader's language - the
 * counts beside it already are, so a Persian row no longer puts "۱۲"
 * beside "46%" (issue #6907); without one, in English, as the tests pin it.
 */
export function formatUserFlowShare(
  share: number,
  translator?: Translator | undefined,
): string {
  const language: string = translator?.language || "en";

  if (!Number.isFinite(share) || share <= 0) {
    return writeUserFlowPercent(0, 0, language);
  }

  const percent: number = share * 100;

  if (percent < 1) {
    const onePercent: string = writeUserFlowPercent(1, 0, language);

    return translator &&
      translator.hasTranslation(USER_FLOW_SHARE_UNDER_ONE_PERCENT)
      ? translator.translateTemplate(USER_FLOW_SHARE_UNDER_ONE_PERCENT, {
          percent: onePercent,
        })
      : `<${onePercent}`;
  }

  /*
   * One decimal below 10%, where it tells 4.5% from 5%; whole percents
   * above, and for a share that is a whole percent. 14 of 200 sessions is
   * 7.000000000000001 percent in floating point, and reads "7%" as 10 of
   * 200 reads "5%", not "7.0%".
   */
  const isWholePercent: boolean =
    Math.abs(percent - Math.round(percent)) < WHOLE_PERCENT_TOLERANCE;

  if (percent < 10 && !isWholePercent) {
    return writeUserFlowPercent(Math.round(percent * 10) / 10, 1, language);
  }

  return writeUserFlowPercent(Math.round(percent), 0, language);
}

export function formatUserFlowDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "—";
  }

  const seconds: number = Math.round(ms / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes: number = Math.floor(seconds / 60);
  const rest: number = seconds % 60;

  if (minutes < 60) {
    return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  }

  const hours: number = Math.floor(minutes / 60);
  const restMinutes: number = minutes % 60;

  return restMinutes > 0 ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

/*
 * A label that fits a node box: keep the END of a path, which is the part
 * that names the page ("…/orders/:id/refund"), not the start.
 */
export function truncateUserFlowLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) {
    return label;
  }

  if (maxChars <= 1) {
    return "…";
  }

  return `…${label.slice(label.length - (maxChars - 1))}`;
}

export function pluralizeSessions(
  count: number,
  translator?: Translator | undefined,
): string {
  if (translator) {
    return translator.translatePlural(
      { one: "{{count}} session", other: "{{count}} sessions" },
      Number.isFinite(count) ? Math.round(count) : 0,
    );
  }

  return `${formatUserFlowCount(count)} session${count === 1 ? "" : "s"}`;
}

/*
 * The line under "Sessions analysed". It says whose sessions they are, so a
 * person's numbers never read as everyone's, wherever the banner that names
 * them has scrolled to. A read the server cut to the newest sessions says so
 * instead, for anyone: how many it read of how many there were. That is the
 * read, before the page's filters, which the number above already applies.
 */
export function formatUserFlowSessionsHint(
  input: {
    /* Sessions the read answered with. */
    sessionsRead: number;
    sessionsInWindow: number;
    isSampled: boolean;
    /* Null or absent for everyone. */
    scopeKind?: UserFlowScope["kind"] | null | undefined;
  },
  translator?: Translator | undefined,
): string {
  const say: (text: string) => string = (text: string): string => {
    return translator?.translateText(text) || text;
  };

  if (input.isSampled) {
    if (translator) {
      return translator.translateTemplate(
        "newest {{read}} of {{total}} recorded",
        {
          read: formatUserFlowCount(input.sessionsRead, translator),
          total: formatUserFlowCount(input.sessionsInWindow, translator),
        },
      );
    }

    return `newest ${formatUserFlowCount(
      input.sessionsRead,
    )} of ${formatUserFlowCount(input.sessionsInWindow)} recorded`;
  }

  if (!input.scopeKind) {
    return say(translationKey("recorded sessions in range"));
  }

  switch (input.scopeKind) {
    case "user":
      return say(translationKey("this user's sessions in range"));
    case "visitor":
      return say(translationKey("this visitor's sessions in range"));
    case "session":
      return say(translationKey("this session only"));
  }
}
