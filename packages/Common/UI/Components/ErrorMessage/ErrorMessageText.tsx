import ErrorExplanation, {
  isUnexplainedErrorMessage,
} from "./ErrorExplanation";
import IsolatedText from "../IsolatedText/IsolatedText";
import { getTranslatedLineDirection } from "../../Utils/LineDirection";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslateValue from "../../Utils/Translation";
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
  /*
   * The lines around these words are centred: the reference's row of an
   * error nobody explained is centred under them too (ErrorExplanation).
   */
  isCentered?: boolean | undefined;
}

/*
 * THE WORDS OF AN ERROR, AS A PERSON SHOULD READ THEM, WHEREVER A PAGE
 * DRAWS THEM.
 *
 * An error nobody explained (#6836) says what failed, why, what to do next
 * and, when the server failed, the reference to give, with a copy button
 * (ErrorExplanation). Any other message is in the reader's language, and
 * words that read the other way from the page - a failed read's answer from
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
 * leave out what failed (hideWhatFailed): their heading says it.
 */
const ErrorMessageText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateValue } = useTranslateValue();
  // The page's language: the way its lines read.
  const translator: Translator = useTranslator();

  if (isUnexplainedErrorMessage(props.message)) {
    return (
      <ErrorExplanation
        message={props.message as string}
        whatFailed={props.whatFailed}
        hideWhatFailed={props.hideWhatFailed}
        isCentered={props.isCentered}
      />
    );
  }

  const translatedMessage: string | ReactElement =
    typeof props.message === "string"
      ? (translateValue(props.message) as string | ReactElement | undefined) ??
        props.message
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
