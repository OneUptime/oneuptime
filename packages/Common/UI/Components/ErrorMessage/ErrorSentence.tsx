import CopyTextButton from "../CopyTextButton/CopyTextButton";
import IsolatedText from "../IsolatedText/IsolatedText";
import Link from "../Link/Link";
import TranslatedSentence from "../TranslatedSentence/TranslatedSentence";
import WhereToLookWords from "./WhereToLookWords";
import {
  ErrorInSentenceWords,
  getErrorInSentenceWords,
  isServerFailureKind,
} from "../../Utils/ErrorInSentence";
import { registerPageErrorReader } from "../../Utils/ErrorReader";
import { getTranslatedLineDirection } from "../../Utils/LineDirection";
import {
  getOneUptimeHealthUrl,
  isOnOneUptimeHealth,
} from "../../Utils/OneUptimeHealthLink";
import { useSentenceLanguage } from "../../Utils/SentenceLanguage";
import useTranslator from "../../Utils/UseTranslator";
import {
  UnexplainedErrorReader,
  UnexplainedErrorWords,
} from "../../../Types/Exception/UnexplainedError";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  getSentenceLanguage,
  PluralTemplate,
  TemplateValues,
  Translator,
} from "../../../Types/Translator";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * A card's own sentence with an error in it: "Couldn't work out who is told.
 * {{error}}" (#7307).
 *
 * The sentence is drawn in the reader's language (TranslatedSentence), and
 * {{error}} with ErrorInSentence: an error nobody explained (a gateway's 502
 * or 504, a server failure with its reference, OneUptime unreachable, the
 * page failing) says why and what to do next in the same language, with the
 * reference and its copy button; any other message is the message, in the
 * reader's language where it has words of its own.
 *
 * The one way a Dashboard sentence draws an error (ErrorSentenceGuard): a
 * sentence that has to be text uses errorInSentence(message) as the value
 * (Common/UI/Utils/ErrorInSentence) instead.
 */

// The English words, for a sentence the reader's language has no wording of.
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

// The page's reader, for the words of an error nobody explained.
registerPageErrorReader();

/*
 * Where a self-hosted master admin looks for a server failure, with
 * OneUptime Health beside it as ErrorExplanation has it (Health answers
 * while the server does, and a server failure is one that answered) - or
 * nothing, for anyone else and any other error (getErrorInSentenceWords).
 *
 * A line of its own after the sentence, never inside it: it is advice for
 * one reader, not part of what the card says, and a card's words after
 * {{error}} ("{{error}} Showing the last known status.") would otherwise
 * run on after "Open OneUptime Health". In the language of the sentence
 * it follows (English while the reader's language has no wording of it),
 * so a card never says one thing in two languages; on its own, in the
 * page's.
 */
export interface ErrorWhereToLookProps {
  message: string | null | undefined;
  reader?: UnexplainedErrorReader | undefined;
  // The language of the sentence this line follows (getSentenceLanguage).
  sentenceLanguage?: string | undefined;
}

export const ErrorWhereToLook: FunctionComponent<ErrorWhereToLookProps> = (
  props: ErrorWhereToLookProps,
): ReactElement => {
  const pageTranslator: Translator = useTranslator();

  const translator: Translator =
    props.sentenceLanguage !== undefined &&
    props.sentenceLanguage !== pageTranslator.language
      ? ENGLISH
      : pageTranslator;

  const words: ErrorInSentenceWords = getErrorInSentenceWords({
    message: props.message,
    translator: translator,
    reader: props.reader,
  });

  if (!words.isUnexplained || !words.whereToLook) {
    return <></>;
  }

  /*
   * OneUptime Health beside the logs of a server failure. What was too
   * large is a proxy's limit (#8278), which Health does not show; and on
   * OneUptime Health itself, a link to it would only reload the page.
   */
  if (!isServerFailureKind(words.kind) || isOnOneUptimeHealth()) {
    return (
      <span className="mt-1 block" data-testid="error-where-to-look">
        <WhereToLookWords text={words.whereToLook} />
      </span>
    );
  }

  return (
    <span className="mt-1 block" data-testid="error-where-to-look">
      {/* The command in it drawn as a command, with a copy button (#7539). */}
      <WhereToLookWords text={words.whereToLook} />{" "}
      <Link
        className="underline"
        to={getOneUptimeHealthUrl()}
        dataTestId="error-open-health"
      >
        {translator.translateText(UnexplainedErrorWords.openHealth) ||
          UnexplainedErrorWords.openHealth}
      </Link>
    </span>
  );
};

export interface ErrorInSentenceProps {
  // API.getFriendlyMessage's answer, or any other message.
  message: string | null | undefined;
  /*
   * Who reads it: by default the page's reader (ErrorReader). A test, or a
   * page that knows better, says.
   */
  reader?: UnexplainedErrorReader | undefined;
  /*
   * Also say where to look (ErrorWhereToLook), on a line of its own after
   * the words: for an error drawn on its own, with no sentence around it -
   * an empty state's description. ErrorSentence says it after its whole
   * sentence instead.
   */
  showWhereToLook?: boolean | undefined;
}

/*
 * The error, as the words that go where a sentence puts it. Drawn in the
 * language of the sentence around it: English while the reader's language
 * has no wording of that sentence, so a sentence never mixes two.
 */
export const ErrorInSentence: FunctionComponent<ErrorInSentenceProps> = (
  props: ErrorInSentenceProps,
): ReactElement => {
  const pageTranslator: Translator = useTranslator();
  const sentenceLanguage: string | null = useSentenceLanguage();

  const translator: Translator =
    sentenceLanguage !== null && sentenceLanguage !== pageTranslator.language
      ? ENGLISH
      : pageTranslator;

  const words: ErrorInSentenceWords = getErrorInSentenceWords({
    message: props.message,
    translator: translator,
    reader: props.reader,
  });

  const whereToLook: ReactElement = props.showWhereToLook ? (
    <ErrorWhereToLook message={props.message} reader={props.reader} />
  ) : (
    <></>
  );

  if (!words.isUnexplained) {
    /*
     * A message somebody wrote, drawn with no sentence of the page's around
     * it - on its own under a button, or after words a card put before it
     * by hand: when it reads the other way from the page (the server's
     * English on an Arabic or Persian page, or a Persian message on an
     * English one), it is set apart in an isolate of its own, so it keeps
     * its full stop at its end (#8279), as ErrorMessageText and ErrorLine
     * draw theirs. Inside a TranslatedSentence the sentence sets its slots
     * apart itself; a message in the page's own way is drawn as it was.
     */
    if (
      sentenceLanguage === null &&
      getTranslatedLineDirection(words.text, pageTranslator.language)
    ) {
      return <IsolatedText text={words.text} />;
    }

    return <>{words.text}</>;
  }

  return (
    <>
      <span data-testid="error-in-sentence" data-error-kind={words.kind}>
        {words.text}
        {/*
         * The reference closes the sentence that asks for it, with the full
         * stop of its language, and its copy button after it: an icon whose
         * name ("Copy") and state ("Copied!") a screen reader hears, so no
         * word of the button's runs into the card's sentence.
         */}
        {words.reference ? (
          <>
            {" "}
            <span
              className="inline-flex items-center gap-1 whitespace-nowrap align-middle"
              data-testid="error-reference"
            >
              <span>
                <code
                  dir="ltr"
                  className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-900"
                >
                  {words.reference}
                </code>
                {words.fullStop}
              </span>
              <CopyTextButton
                textToBeCopied={words.reference}
                size="xs"
                iconOnly={true}
              />
            </span>
          </>
        ) : (
          <></>
        )}
      </span>
      {whereToLook}
    </>
  );
};

export interface ComponentProps {
  // The English sentence (the translation key), with {{error}} in it.
  template: string | PluralTemplate;
  // API.getFriendlyMessage's answer, or any other message.
  error: string | null | undefined;
  /*
   * The placeholder the error goes in, when the sentence calls it something
   * else: {{message}}, {{reason}}.
   */
  errorPlaceholder?: string | undefined;
  // The sentence's other values and slots, as TranslatedSentence takes them.
  values?: TemplateValues | undefined;
  slots?: Record<string, ReactNode> | undefined;
  count?: number | undefined;
  reader?: UnexplainedErrorReader | undefined;
}

const ErrorSentence: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <>
      <TranslatedSentence
        template={props.template}
        count={props.count}
        values={props.values}
        slots={{
          ...(props.slots || {}),
          [props.errorPlaceholder || "error"]: (
            <ErrorInSentence message={props.error} reader={props.reader} />
          ),
        }}
      />
      <ErrorWhereToLook
        message={props.error}
        reader={props.reader}
        sentenceLanguage={getSentenceLanguage(translator, props.template)}
      />
    </>
  );
};

export default ErrorSentence;
