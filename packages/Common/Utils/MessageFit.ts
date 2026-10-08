import { cutToLength } from "./Markdown/OverLongText";

/*
 * TEXT HELD TO WHAT A CHANNEL TAKES.
 *
 * Every channel a notification goes out on refuses a message over its own
 * limit, and then the notification is lost: Twilio an SMS body of more than
 * 1,600 characters and a call's TwiML of more than 4,000, Expo a push
 * notification of more than 4,096 bytes, Meta a WhatsApp template whose
 * text comes to more than 1,024 characters, Telegram a message of more than
 * 4,096 characters, Discord a webhook message of more than 2,000
 * characters. A notification can carry any text a template placed in
 * it - a description, a response body, a log - so its text is held to the
 * channel's limit before it is sent, and a text that was cut ends with a
 * note that sends the reader to OneUptime for the rest. A message within the
 * limit is sent exactly as it always was.
 *
 * Pure, with no Node or browser APIs.
 */

// What a cut text ends with: the words a cut chat message ends with.
export const TRUNCATED_TEXT_NOTE: string =
  "… (truncated — see OneUptime for the full text)";

/*
 * The note in characters every SMS encoding has (GSM 7-bit): a single
 * character outside it makes every part of an SMS hold 70 characters
 * instead of 160 - and cost more than twice as much. Spoken, it reads the
 * same as the note above.
 */
export const TRUNCATED_TEXT_NOTE_PLAIN: string =
  "... (truncated - see OneUptime for the full text)";

// What a cut name or title ends with, where a whole note would not fit.
export const TRUNCATED_NAME_NOTE: string = "…";

// Twilio: an SMS body of at most 1,600 characters (error 21617).
export const MAX_SMS_LENGTH: number = 1600;

// Twilio: the TwiML a call is made with, of at most 4,000 characters.
export const MAX_CALL_TWIML_LENGTH: number = 4000;

/*
 * Meta: a WhatsApp template's text, once its variables are filled in, of at
 * most 1,024 characters.
 */
export const MAX_WHATSAPP_TEMPLATE_TEXT_LENGTH: number = 1024;

// Telegram: a message of at most 4,096 characters once its formatting is read.
export const MAX_TELEGRAM_MESSAGE_LENGTH: number = 4096;

// Discord: a webhook message's content of at most 2,000 characters.
export const MAX_DISCORD_MESSAGE_LENGTH: number = 2000;

/*
 * Expo (APNs and FCM behind it) and web push: a notification of at most
 * 4,096 bytes. Its title, body and data are held to this, as JSON writes
 * them in UTF-8; the rest of it - sound, channel, icon, actions - fits in
 * what is left.
 */
export const MAX_PUSH_TEXT_BYTES: number = 3072;

// How big a text is, as a channel counts it.
export type TextSizeFunction = (text: string) => number;

// How big the text at `index` of several is, as a channel counts it.
export type IndexedTextSizeFunction = (text: string, index: number) => number;

/*
 * fitTextsToBudget cuts texts that measure over the budget shorter at most
 * this many times, each time to this share of what would just fit.
 */
const MAX_FIT_ATTEMPTS: number = 5;
const FIT_MARGIN: number = 0.9;

const getLength: TextSizeFunction = (text: string): number => {
  return text.length;
};

const getSum: (sizes: ReadonlyArray<number>) => number = (
  sizes: ReadonlyArray<number>,
): number => {
  return sizes.reduce((total: number, size: number): number => {
    return total + size;
  }, 0);
};

/*
 * `text` as it is when it has at most `maxLength` characters (UTF-16 code
 * units, as JavaScript and most providers count them), else cut to fit with
 * `note` at its end: at the last line break in the second half of what
 * fits, else between whole characters - never inside an emoji
 * (cutToLength). A limit too small for the note gets the text cut alone.
 */
export const fitTextToLength: (
  text: string,
  maxLength: number,
  note?: string,
) => string = (
  text: string,
  maxLength: number,
  note: string = TRUNCATED_TEXT_NOTE,
): string => {
  if (text.length <= maxLength) {
    return text;
  }

  if (note.length >= maxLength) {
    return cutToLength(text, Math.max(0, maxLength));
  }

  return cutToLength(text, maxLength - note.length).trimEnd() + note;
};

/*
 * The largest level each of `sizes` can be held to so that together they
 * come to no more than `available` - the sizes under the level counted as
 * they are. Infinity when they all fit already. What the longest texts are
 * cut to, so the short ones (a title, a name) stay whole.
 */
export const getWaterLevel: (
  sizes: ReadonlyArray<number>,
  available: number,
) => number = (sizes: ReadonlyArray<number>, available: number): number => {
  const ascending: Array<number> = sizes.slice().sort((a: number, b: number) => {
    return a - b;
  });
  let remaining: number = Math.max(0, available);

  for (let index: number = 0; index < ascending.length; index++) {
    const share: number = remaining / (ascending.length - index);

    if (ascending[index]! > share) {
      return share;
    }

    remaining -= ascending[index]!;
  }

  return Number.POSITIVE_INFINITY;
};

export interface FitTextsOptions {
  // How big a text is as the channel counts it: its length by default.
  measure?: IndexedTextSizeFunction | undefined;
  // What the text at `index` ends with when it is cut: TRUNCATED_TEXT_NOTE.
  getNote?: ((index: number) => string) | undefined;
}

/*
 * `texts` held to `budget` together, each as `measure` counts it: as they
 * are when they fit; else the longest cut - all to about the same size
 * (getWaterLevel), so the short ones stay whole - each ending with its
 * note, measured again and cut shorter a few times at most. The result can
 * stay over a budget too small for even the short texts.
 */
export const fitTextsToBudget: (
  texts: ReadonlyArray<string>,
  budget: number,
  options?: FitTextsOptions,
) => Array<string> = (
  texts: ReadonlyArray<string>,
  budget: number,
  options: FitTextsOptions = {},
): Array<string> => {
  const measure: IndexedTextSizeFunction = options.measure || getLength;
  const getNote: (index: number) => string =
    options.getNote ||
    ((): string => {
      return TRUNCATED_TEXT_NOTE;
    });

  const sizes: Array<number> = texts.map(
    (text: string, index: number): number => {
      return measure(text, index);
    },
  );

  if (getSum(sizes) <= budget) {
    return texts.slice();
  }

  let available: number = budget * FIT_MARGIN;
  let fitted: Array<string> = texts.slice();

  for (let attempt: number = 0; attempt < MAX_FIT_ATTEMPTS; attempt++) {
    const level: number = getWaterLevel(sizes, available);

    fitted = texts.map((text: string, index: number): string => {
      const size: number = sizes[index]!;

      if (size <= level) {
        return text;
      }

      return fitTextToLength(
        text,
        Math.max(0, Math.floor((text.length * level) / size)),
        getNote(index),
      );
    });

    const total: number = getSum(
      fitted.map((text: string, index: number): number => {
        return measure(text, index);
      }),
    );

    if (total <= budget || available <= 0) {
      break;
    }

    available = available * (budget / total) * FIT_MARGIN;
  }

  return fitted;
};
