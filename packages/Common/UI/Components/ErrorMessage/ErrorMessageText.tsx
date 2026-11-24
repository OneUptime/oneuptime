import ErrorExplanation, {
  isUnexplainedErrorMessage,
} from "./ErrorExplanation";
import IsolatedText from "../IsolatedText/IsolatedText";
import { sayErrorMessage } from "../../Utils/ErrorInSentence";
import { getTranslatedLineDirection } from "../../Utils/LineDirection";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // API.getFriendlyMessage's answer, or words the page drew itself.
  message: string | ReactElement;
  /*
   * What failed, in the reader's language - "The monitors could not be
   * loaded." - said first when the error is one nobody explained.
   */
  whatFailed?: string | undefined;
  /*
   * Leave that first line out where the page's own heading already says
   * what failed - the notes feed's "Notes could not be loaded", a table's
   * title over a load that failed - so the reader is not told it twice.
   */
  hideWhatFailed?: boolean | undefined;
}

/*
 * THE WORDS OF AN ERROR, AS A PERSON SHOULD READ THEM, WHEREVER A PAGE
 * DRAWS THEM.
 *
 * An error nobody explained (#6836) says what failed, why, what to do next
 * and, when the server failed, the reference to give, with a copy button
 * (ErrorExplanation). Any other message is in the reader's language (a
 * refusal with a value in it said around its value), and words that read
 * the other way from the page - a failed read's answer from
 * the server is in English - are set apart in an isolate of their own
 * (IsolatedText), so on a Persian page they keep their full stop at their
 * end. Words in the page's own way, and a message drawn as an element, are
 * drawn as they always were.
 *
 * ErrorMessage draws these words in the middle of a list that did not load,
 * with Refresh? or Try again under them. A piece that lays out its own
 * failure draws them where its lines are, beside its own Try again: the
 * note composer's Templates menu; the notes feed, under its heading; a
 * table's empty state (TableEmptyState), under its title. The last two
 * leave out what failed (hideWhatFailed): their heading says it. The
 * reference's line is placed as the lines around the words are - centred
 * in all three but the menu - with nothing to say so (ErrorReference).
 */
const ErrorMessageText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // The reader's words, and the page's language: the way its lines read.
  const translator: Translator = useTranslator();

  if (isUnexplainedErrorMessage(props.message)) {
    return (
      <ErrorExplanation
        message={props.message as string}
        whatFailed={props.whatFailed}
        hideWhatFailed={props.hideWhatFailed}
      />
    );
  }

  /*
   * A message somebody wrote, in the reader's language: looked up, and a
   * refusal of the server's with a value in it - a monitor's type beside a
   * template's, why a data check could not be written - said around its
   * value (sayErrorMessage, as ErrorLine and ErrorInSentence say it). Looked
   * up whole, such a refusal is no key once its value is in, and read
   * English on every page here while a card's own sentence said it in the
   * reader's language (#8280).
   */
  const translatedMessage: string | ReactElement =
    typeof props.message === "string"
      ? sayErrorMessage(props.message, translator)
      : props.message;

  if (
    typeof translatedMessage === "string" &&
    getTranslatedLineDirection(translatedMessage, translator.language)
  ) {
    return <IsolatedText text={translatedMessage} />;
  }

  return <>{translatedMessage}</>;
};

export default ErrorMessageText;
