import { joinSentences } from "./SentenceSeparator";
import {
  composedValue,
  ComposedValue,
  TemplateValues,
  Translator,
} from "../../Types/Translator";
import {
  getExplanationWords,
  readUnexplainedError,
  UnexplainedError,
  UnexplainedErrorExplanation,
  UnexplainedErrorKind,
  UnexplainedErrorReader,
} from "../../Types/Exception/UnexplainedError";
import {
  readRefusalValues,
  RefusalWithValues,
} from "../../Types/Exception/RefusalWithValues";
import { MONITOR_TYPE_MISMATCH_REFUSAL } from "../../Utils/Monitor/MonitorTemplateLinkRefusal";

/*
 * AN ERROR INSIDE A SENTENCE A CARD WRITES (#7307).
 *
 * Many cards say what failed in a sentence of their own and put the error's
 * message in it: "Couldn't work out who is told. {{error}}", "Couldn't load
 * incidents. {{error}}", "Couldn't refresh. Showing what loaded at {{time}}.
 * {{error}}". The message is API.getFriendlyMessage's answer, and for a
 * failure nobody explained (#6836) that is one of a few fixed English
 * sentences (Common/Types/Exception/UnexplainedError). Two of them could not
 * be looked up in the reader's language: a gateway's 502 or 504
 * (SERVER_DOWN_MESSAGE, kept word for word for what quotes it, and not a
 * key) and a server failure with its reference (the sentence comes filled
 * in). So a German card read "Es konnte nicht ermittelt werden, wer
 * benachrichtigt wird. Error connecting to server. Please try again in few
 * minutes.", and the reference had no copy button.
 *
 * Here such a message is said the way ErrorExplanation says it - why it
 * failed and what to do next, in the reader's language, with the reference
 * - but as words that go where the card's sentence puts {{error}}. Any
 * other message (one the server or the page put into words) is looked up in
 * the reader's language and otherwise drawn as written, as before. A
 * refusal of the server's with values in it (REFUSALS_WITH_VALUES: why a
 * monitor cannot be linked to a template, with the two types) is read back
 * and said in the reader's language with its values (#7678).
 *
 * Two ways in, one set of words:
 *   - ErrorSentence (Common/UI/Components/ErrorMessage/ErrorSentence), for a
 *     sentence drawn on the page: the reference has its copy button there;
 *   - errorInSentence(message), a value for translateTemplate, for a
 *     sentence that has to be text (a title, a notice kept in state, a
 *     thrown error): the reference is written in the text.
 * The Dashboard's ErrorSentenceGuard holds every {{error}} and {{message}}
 * sentence to one of the two.
 *
 * Where to look (npm run doctor) is said only for a server failure, to a
 * master admin of a self-hosted server, and only where the card's sentence
 * is drawn (ErrorSentence). A gateway's error inside a page that loaded
 * means the server answered a moment ago and is restarting: the card says
 * to try again in a few minutes, and leaves the doctor to the page that did
 * not load.
 *
 * React-free and window-free: the Dashboard's React-free modules use
 * errorInSentence and are read by tests in plain Node. Who reads the page
 * (Cloud or not, a master admin, a visitor) comes from ErrorReader, which
 * reads the page's config: API and ErrorSentence tell this module of it
 * (setPageErrorReader), and until one does - in plain Node - the reader is
 * a member of a server somebody runs.
 */

// The full stops a sentence ends with, in the languages OneUptime speaks.
const FULL_STOPS: ReadonlyArray<string> = [".", "\u{3002}", "\u{0964}"];

/*
 * The full stop of the language `sentence` is written in: its own last
 * character when that is one (Japanese's and Chinese's, Hindi's), else ".".
 */
const fullStopOf: (sentence: string) => string = (sentence: string): string => {
  const last: string = sentence.trim().slice(-1);

  return FULL_STOPS.includes(last) ? last : ".";
};

// The words an error is said with inside a sentence.
export type ErrorInSentenceWords =
  | {
      // A message somebody put into words: as the reader reads it.
      isUnexplained: false;
      text: string;
    }
  | {
      isUnexplained: true;
      kind: UnexplainedErrorKind;
      // Why it failed and what to do next, as one run of sentences.
      text: string;
      // The server's reference, for ServerWithReference.
      reference: string | null;
      // Where a self-hosted master admin looks, for a server failure.
      whereToLook: string | null;
      /*
       * The full stop of the language the words are in, as its own why
       * sentence ends it (Japanese's, Chinese's and Hindi's are their own).
       * It closes the reference written as text.
       */
      fullStop: string;
    };

/*
 * The server's refusals with values in them (RefusalWithValues), which a
 * message may be: each read back out of the English it arrives in, and
 * said in the sentence's language with its values.
 */
const REFUSALS_WITH_VALUES: ReadonlyArray<RefusalWithValues> = [
  MONITOR_TYPE_MISMATCH_REFUSAL,
];

/*
 * A message somebody put into words, in `translator`'s language: a refusal
 * with values said with them, any other message looked up, or as written
 * where the language has no wording of it.
 */
const sayMessage: (message: string, translator: Translator) => string = (
  message: string,
  translator: Translator,
): string => {
  for (const refusal of REFUSALS_WITH_VALUES) {
    const values: TemplateValues | null = readRefusalValues(refusal, message);

    if (values) {
      return translator.translateTemplate(refusal.template, values);
    }
  }

  return translator.translateText(message) || message;
};

// A member of a server somebody runs: the reader until the page says.
const PLAIN_READER: UnexplainedErrorReader = {
  isCloud: false,
  isMasterAdmin: false,
  isVisitor: false,
};

let readPageErrorReader: () => UnexplainedErrorReader =
  (): UnexplainedErrorReader => {
    return PLAIN_READER;
  };

/*
 * How to read who reads the page (ErrorReader.getErrorReader): called each
 * time an error nobody explained is said, so a sign-in in between counts.
 */
export const setPageErrorReader: (
  read: () => UnexplainedErrorReader,
) => void = (read: () => UnexplainedErrorReader): void => {
  readPageErrorReader = read;
};

// Who reads the page, as the page last said (setPageErrorReader).
export const getPageErrorReader: () => UnexplainedErrorReader =
  (): UnexplainedErrorReader => {
    return readPageErrorReader();
  };

/*
 * `message` as words for a sentence in `translator`'s language: for an
 * error nobody explained, why it failed and what to do next (and the
 * reference); for any other, the message in that language (a refusal with
 * values with its values), or as written.
 * The reader is the page's (getPageErrorReader) unless given, and is read
 * only for an error nobody explained: any other message is the same to
 * anyone.
 */
export const getErrorInSentenceWords: (data: {
  message: string | null | undefined;
  translator: Translator;
  reader?: UnexplainedErrorReader | undefined;
}) => ErrorInSentenceWords = (data: {
  message: string | null | undefined;
  translator: Translator;
  reader?: UnexplainedErrorReader | undefined;
}): ErrorInSentenceWords => {
  const message: string = data.message || "";

  const say: (text: string) => string = (text: string): string => {
    return data.translator.translateText(text) || text;
  };

  const error: UnexplainedError | null = readUnexplainedError(message);

  if (!error) {
    return {
      isUnexplained: false,
      text: sayMessage(message, data.translator),
    };
  }

  const explanation: UnexplainedErrorExplanation = getExplanationWords({
    error: error,
    ...(data.reader || getPageErrorReader()),
  });

  const isServerFailure: boolean =
    error.kind === UnexplainedErrorKind.ServerWithReference ||
    error.kind === UnexplainedErrorKind.Server;

  const why: string = say(explanation.why);

  return {
    isUnexplained: true,
    kind: error.kind,
    text: joinSentences([why, say(explanation.next)]),
    reference: error.reference,
    whereToLook:
      isServerFailure && explanation.whereToLook
        ? say(explanation.whereToLook)
        : null,
    fullStop: fullStopOf(why),
  };
};

/*
 * The same words as text: the reference is written after what to do next
 * ("...give them this reference: 1f0c9a2b.") and closed with the full stop
 * of the sentence's language, so the card's words after {{error}} start a
 * sentence of their own. Where to look is left to the page's own error
 * places, as a title or a notice has no room for it.
 */
export const getErrorInSentenceText: (data: {
  message: string | null | undefined;
  translator: Translator;
  reader?: UnexplainedErrorReader | undefined;
}) => string = (data: {
  message: string | null | undefined;
  translator: Translator;
  reader?: UnexplainedErrorReader | undefined;
}): string => {
  const words: ErrorInSentenceWords = getErrorInSentenceWords({
    message: data.message,
    translator: data.translator,
    reader: data.reader,
  });

  if (!words.isUnexplained || !words.reference) {
    return words.text;
  }

  return `${words.text} ${words.reference}${words.fullStop}`;
};

/*
 * A template value for {{error}} (or {{message}}, {{reason}}): the error
 * said in the language the sentence comes out in - the reader's, or English
 * while their language has no wording of the sentence.
 *
 *   translator.translateTemplate("Couldn't load incidents. {{error}}", {
 *     error: errorInSentence(message),
 *   })
 */
export const errorInSentence: (
  message: string | null | undefined,
  reader?: UnexplainedErrorReader | undefined,
) => ComposedValue = (
  message: string | null | undefined,
  reader?: UnexplainedErrorReader | undefined,
): ComposedValue => {
  return composedValue((translator: Translator): string => {
    return getErrorInSentenceText({
      message: message,
      translator: translator,
      reader: reader,
    });
  });
};
