import Text from "../../Types/Text";
import { toGsm7Text, toOneLine } from "./Gsm7Text";
import { countSmsSegments, SmsSegmentCount } from "./SmsSegments";

/*
 * THE TEXT MESSAGE A PAGE SENDS.
 *
 * Somebody paged by SMS reads the text on a locked phone, often at night,
 * and every part of an SMS is billed (SmsSegments). So a page's text says
 * only what they need - who sends it, what happened and the one link to
 * acknowledge the page or escalate it - in one part of 160 characters
 * wherever it can:
 *
 *   OneUptime: Critical Incident INC-42 in Acme Prod: Checkout API is down.
 *   Ack or escalate: https://oneuptime.com/l/XJlaZRsd
 *
 * (one line when sent). In order: the product, the severity with what
 * happened (an incident, an alert or an episode of either), its number, the
 * project, the title and the link. A severity named after what it rates
 * ("Critical Incident") is not followed by the word again.
 *
 * A PAGE AGAIN - a policy paging again because a record acknowledged a while
 * ago is still not resolved (OnCallAcknowledgementTimeout) - says so after
 * the project, where a first page goes straight on to the title:
 *
 *   OneUptime: Critical Incident INC-42 in Acme Prod is still not resolved:
 *   Checkout API is down. Ack or escalate: https://oneuptime.com/l/XJlaZRsd
 *
 * The person paged acknowledged it once already; worded as a first page,
 * the text read like a second alarm about something new.
 *
 * THE FITTING RULE. The text takes the fewest parts it can, trying for one
 * part, then two, and so on. For each number of parts:
 *
 *   1. everything, if it fits;
 *   2. else without the project, the first thing to go - the title says what
 *      happened, the project only where;
 *   3. else the title cut, ending with "...", as long as at least
 *      MIN_TITLE_CHARACTERS of it are left - fewer no longer say what
 *      happened, so then the text takes one more part instead.
 *
 * The product name, the severity, the number and the link are never cut:
 * they say who sends it, how bad it is, which one it is and where to act -
 * and nor is a page again's "is still not resolved", which says why.
 *
 * Every value is written in the characters an SMS carries cheaply
 * (Gsm7Text): a curly quote or an emoji in a title no longer makes the page
 * go out in UCS-2, whose parts hold 70 characters. A title in another
 * script is sent as written, in UCS-2, so it takes two parts or more - the
 * link and the words around it alone pass 70.
 *
 * The text is measured as it is sent: the send path may change it once
 * more (the Notification service puts the installation's own name in place
 * of OneUptime), and `sentAs` says how.
 *
 * Pure, with no Node or browser APIs.
 */

export enum OnCallPageSmsKind {
  Incident = "Incident",
  Alert = "Alert",
  IncidentEpisode = "IncidentEpisode",
  AlertEpisode = "AlertEpisode",
}

// What a page is about, as the text names it.
export const ON_CALL_PAGE_SMS_KIND_WORDS: Readonly<
  Record<OnCallPageSmsKind, ReadonlyArray<string>>
> = {
  [OnCallPageSmsKind.Incident]: ["incident"],
  [OnCallPageSmsKind.Alert]: ["alert"],
  [OnCallPageSmsKind.IncidentEpisode]: ["incident", "episode"],
  [OnCallPageSmsKind.AlertEpisode]: ["alert", "episode"],
};

/*
 * The words before the link, which opens the page to acknowledge or escalate
 * it: the same word as every other place says (OnCallPagePassOn).
 */
export const ON_CALL_PAGE_SMS_ACTION: string = "Ack or escalate:";

// What a page again says after the project: the record is still open.
export const ON_CALL_PAGE_SMS_STILL_NOT_RESOLVED: string =
  "is still not resolved";

// What a cut title ends with: three full stops, which GSM-7 has (… it has not).
export const ON_CALL_PAGE_SMS_CUT_MARK: string = "...";

// The fewest characters of a title a cut leaves.
export const MIN_TITLE_CHARACTERS: number = 20;

/*
 * The most parts the fitting rule tries for. Far beyond anything real: the
 * longest title, project, severity, number prefix, product name and address
 * still fit, with the title cut, in fewer.
 */
export const MAX_PAGE_SMS_SEGMENTS: number = 10;

/*
 * Characters that already end a sentence, so the title gets no full stop:
 * the ones GSM-7 has, and those of the scripts a title is kept in -
 * Chinese and Japanese (also half and full width), Devanagari, Arabic and
 * Urdu.
 */
const SENTENCE_ENDS: ReadonlySet<string> = new Set<string>([
  ".",
  "!",
  "?",
  "\u{3002}",
  "\u{FF61}",
  "\u{FF0E}",
  "\u{FF01}",
  "\u{FF1F}",
  "\u{FE12}",
  "\u{0964}",
  "\u{0965}",
  "\u{061F}",
  "\u{06D4}",
]);

/*
 * Characters a cut title does not end on before the cut mark: a space or a
 * mark that would read as a stray before "...".
 */
const TRAILING_BEFORE_CUT: ReadonlySet<string> = new Set<string>([
  " ",
  ",",
  ";",
  ":",
  "-",
  ".",
  "(",
  "[",
  "/",
]);

/*
 * A cut that ends inside a word moves back to the space before it, if one
 * is this close: "is do..." reads worse than "is...".
 */
const WORD_CUT_BACKOFF: number = 10;

const MARK: RegExp = /\p{M}/u;
const LETTER: RegExp = /\p{L}/u;
const JOINERS: ReadonlySet<number> = new Set<number>([0x200c, 0x200d]);

export interface OnCallPageSmsInput {
  kind: OnCallPageSmsKind;
  /*
   * Who sends it, first in the text. Pass OneUptime: the Notification
   * service puts the installation's own name in when it goes by one, and
   * `sentAs` lets the fitting count it.
   */
  productName: string;
  severityName?: string | null | undefined;
  // INC-42, or #42 without a prefix; none for a record without a number.
  number?: string | null | undefined;
  projectName?: string | null | undefined;
  title?: string | null | undefined;
  // The page that acknowledges it or escalates it. Never cut.
  link: string;
  /*
   * A page again (OnCallAcknowledgementTimeout): the text says the record is
   * still not resolved. Never cut.
   */
  isPageAgain?: boolean | undefined;
  // What the send path does to the text before the provider gets it.
  sentAs?: ((text: string) => string) | undefined;
}

export interface OnCallPageSms {
  // The text to send.
  text: string;
  // How it goes out, as sent (after `sentAs`).
  sent: SmsSegmentCount;
  // What the fitting rule gave up.
  isProjectLeftOut: boolean;
  isTitleCut: boolean;
}

interface PageParts {
  productName: string;
  what: string;
  number: string;
  projectName: string;
  // The title's characters (code points), as written for an SMS.
  title: Array<string>;
  link: string;
  isPageAgain: boolean;
}

// A value on one line, in the characters an SMS carries cheaply.
const toSmsValue: (value: string | null | undefined) => string = (
  value: string | null | undefined,
): string => {
  return toOneLine(toGsm7Text(value || ""));
};

// The letters of a word, lower case: "(Incident)" is "incident".
const lettersOf: (word: string) => string = (word: string): string => {
  let letters: string = "";

  for (const character of word) {
    if (LETTER.test(character)) {
      letters += character;
    }
  }

  return letters.toLowerCase();
};

/*
 * The severity and what happened: "High alert", "Critical Incident" (a
 * severity already named after what it rates), "Incident episode" (no
 * severity).
 */
export const describeWhatHappened: (data: {
  kind: OnCallPageSmsKind;
  severityName: string;
}) => string = (data: {
  kind: OnCallPageSmsKind;
  severityName: string;
}): string => {
  const kindWords: ReadonlyArray<string> =
    ON_CALL_PAGE_SMS_KIND_WORDS[data.kind];

  if (!data.severityName) {
    return Text.uppercaseFirstLetter(kindWords.join(" "));
  }

  const severityWords: Array<string> = data.severityName.split(" ");
  const lastSeverityWord: string = lettersOf(
    severityWords[severityWords.length - 1] || "",
  );

  if (lastSeverityWord === kindWords[0]) {
    return [data.severityName, ...kindWords.slice(1)].join(" ");
  }

  return [data.severityName, ...kindWords].join(" ");
};

// The text from its parts, with or without the project and with this much title.
const compose: (
  parts: PageParts,
  options: { withProject: boolean; title: string; isTitleCut: boolean },
) => string = (
  parts: PageParts,
  options: { withProject: boolean; title: string; isTitleCut: boolean },
): string => {
  let head: string = `${parts.productName}: ${parts.what}`;

  if (parts.number) {
    head += ` ${parts.number}`;
  }

  if (options.withProject && parts.projectName) {
    head += ` in ${parts.projectName}`;
  }

  if (parts.isPageAgain) {
    head += ` ${ON_CALL_PAGE_SMS_STILL_NOT_RESOLVED}`;
  }

  let sentence: string = head;

  if (options.title) {
    sentence += `: ${options.title}`;
  }

  if (options.isTitleCut) {
    sentence += ON_CALL_PAGE_SMS_CUT_MARK;
  } else if (!SENTENCE_ENDS.has(Array.from(sentence).pop() || "")) {
    sentence += ".";
  }

  return `${sentence} ${ON_CALL_PAGE_SMS_ACTION} ${parts.link}`;
};

/*
 * The first `count` characters of a title, never parting a letter from its
 * marks or ending on a joiner.
 */
const getWholeCharacterCount: (
  title: ReadonlyArray<string>,
  count: number,
) => number = (title: ReadonlyArray<string>, count: number): number => {
  let end: number = Math.min(count, title.length);

  while (end > 0 && end < title.length && MARK.test(title[end]!)) {
    end--;
  }

  while (end > 0 && JOINERS.has(title[end - 1]!.codePointAt(0) || 0)) {
    end--;
  }

  return end;
};

/*
 * The title cut to its first `count` characters, read well: back to the
 * space before a word the cut would split, if one is close, and without
 * spaces or stray punctuation before the mark - null when that would leave
 * fewer than `minimum` characters.
 */
const getReadableCut: (
  title: ReadonlyArray<string>,
  count: number,
  minimum: number,
) => string | null = (
  title: ReadonlyArray<string>,
  count: number,
  minimum: number,
): string | null => {
  let end: number = getWholeCharacterCount(title, count);

  const splitsWord: boolean =
    end < title.length && title[end] !== " " && title[end - 1] !== " ";

  if (splitsWord) {
    for (
      let space: number = end - 1;
      space >= Math.max(minimum, end - WORD_CUT_BACKOFF);
      space--
    ) {
      if (title[space] === " ") {
        end = space;
        break;
      }
    }
  }

  while (end > 0 && TRAILING_BEFORE_CUT.has(title[end - 1]!)) {
    end--;
  }

  return end >= minimum ? title.slice(0, end).join("") : null;
};

/*
 * The page's text, fitted to the fewest parts by the fitting rule above,
 * with how it goes out.
 */
export const buildOnCallPageSms: (
  input: OnCallPageSmsInput,
) => OnCallPageSms = (input: OnCallPageSmsInput): OnCallPageSms => {
  const sentAs: (text: string) => string =
    input.sentAs ||
    ((text: string): string => {
      return text;
    });

  const parts: PageParts = {
    productName: toOneLine(input.productName),
    what: describeWhatHappened({
      kind: input.kind,
      severityName: toSmsValue(input.severityName),
    }),
    number: toSmsValue(input.number),
    projectName: toSmsValue(input.projectName),
    title: Array.from(toSmsValue(input.title)),
    link: input.link.trim(),
    isPageAgain: input.isPageAgain === true,
  };

  const wholeTitle: string = parts.title.join("");

  const measure: (text: string) => SmsSegmentCount = (
    text: string,
  ): SmsSegmentCount => {
    return countSmsSegments(sentAs(text));
  };

  const fitted: (
    text: string,
    isProjectLeftOut: boolean,
    isTitleCut: boolean,
  ) => OnCallPageSms = (
    text: string,
    isProjectLeftOut: boolean,
    isTitleCut: boolean,
  ): OnCallPageSms => {
    return {
      text: text,
      sent: measure(text),
      isProjectLeftOut: isProjectLeftOut,
      isTitleCut: isTitleCut,
    };
  };

  // The text with the title cut to its first `count` characters, as is.
  const withTitleCutTo: (count: number) => string = (count: number): string => {
    return compose(parts, {
      withProject: false,
      title: parts.title
        .slice(0, getWholeCharacterCount(parts.title, count))
        .join(""),
      isTitleCut: true,
    });
  };

  // 1. Everything, and 2. without the project: each measured once.
  const everything: string = compose(parts, {
    withProject: true,
    title: wholeTitle,
    isTitleCut: false,
  });
  const everythingSegments: number = measure(everything).segments;
  const withoutProject: string | null = parts.projectName
    ? compose(parts, {
        withProject: false,
        title: wholeTitle,
        isTitleCut: false,
      })
    : null;
  const withoutProjectSegments: number | null =
    withoutProject === null ? null : measure(withoutProject).segments;

  for (
    let segments: number = 1;
    segments <= MAX_PAGE_SMS_SEGMENTS;
    segments++
  ) {
    const fits: (text: string) => boolean = (text: string): boolean => {
      return measure(text).segments <= segments;
    };

    // 1. Everything.
    if (everythingSegments <= segments) {
      return fitted(everything, false, false);
    }

    // 2. Without the project.
    if (
      withoutProject !== null &&
      withoutProjectSegments !== null &&
      withoutProjectSegments <= segments
    ) {
      return fitted(withoutProject, true, false);
    }

    // 3. The title cut, as long as at least MIN_TITLE_CHARACTERS are left.
    if (parts.title.length > MIN_TITLE_CHARACTERS) {
      let longest: number = -1;
      let low: number = MIN_TITLE_CHARACTERS;
      let high: number = parts.title.length - 1;

      /*
       * The most characters that fit: a longer cut never takes fewer
       * places, so the answer is found by halving.
       */
      while (low <= high) {
        const middle: number = Math.floor((low + high) / 2);

        if (fits(withTitleCutTo(middle))) {
          longest = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }

      if (longest >= 0) {
        const readableTitle: string | null = getReadableCut(
          parts.title,
          longest,
          MIN_TITLE_CHARACTERS,
        );
        const plainTitle: string = parts.title
          .slice(0, getWholeCharacterCount(parts.title, longest))
          .join("")
          .trimEnd();

        /*
         * Reading well never costs a part: the cut at a word if it fits,
         * else the plain cut without trailing spaces. Either keeps at least
         * MIN_TITLE_CHARACTERS, or it is no cut at all: a cut that ends
         * after a space, or before a letter's marks, can keep fewer than
         * the characters it was measured with - and a shorter cut keeps
         * fewer still, so then the text takes one more part instead.
         */
        const best: string | undefined = [readableTitle, plainTitle]
          .filter((title: string | null): title is string => {
            return (
              title !== null && Array.from(title).length >= MIN_TITLE_CHARACTERS
            );
          })
          .map((title: string): string => {
            return compose(parts, {
              withProject: false,
              title: title,
              isTitleCut: true,
            });
          })
          .find((candidate: string): boolean => {
            return fits(candidate);
          });

        if (best !== undefined) {
          return fitted(best, Boolean(parts.projectName), true);
        }
      }
    }
  }

  // Nothing fits in that many parts: as short as the rule allows.
  return parts.title.length > MIN_TITLE_CHARACTERS
    ? fitted(
        withTitleCutTo(MIN_TITLE_CHARACTERS),
        Boolean(parts.projectName),
        true,
      )
    : fitted(
        compose(parts, {
          withProject: false,
          title: wholeTitle,
          isTitleCut: false,
        }),
        Boolean(parts.projectName),
        false,
      );
};
