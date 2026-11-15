import ErrorExplanation, {
  isUnexplainedErrorMessage,
} from "./ErrorExplanation";
import IsolatedLine from "../IsolatedText/IsolatedLine";
import { sayErrorMessage } from "../../Utils/ErrorInSentence";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // API.getFriendlyMessage's answer, or any other message.
  message: string;
  /*
   * What failed, in the reader's language - "The check was not written." -
   * said first when the error is one nobody explained.
   */
  whatFailed?: string | undefined;
  // The line's element: a paragraph by default.
  as?: "div" | "p" | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * A CARD'S RED LINE: WHY WHAT THE READER ASKED FOR DID NOT HAPPEN (#7530).
 *
 * A card that says why a button failed under its buttons - Write a Check
 * from a Sentence, Suggested Checks - draws API.getFriendlyMessage's answer
 * here, in the reader's language either way:
 *
 *   - An error nobody explained (a gateway's 502, a server failure with its
 *     reference, OneUptime not reached) is ErrorExplanation: what failed,
 *     why, what to do next and the reference with its copy button. It was
 *     the English sentence as plain text, with no reference to copy.
 *   - Any other message is the server's or the page's: looked up in the
 *     reader's language (a refusal with a value in it said around its
 *     value, Common/UI/Utils/ErrorInSentence) and otherwise drawn as it
 *     came, as a line of its own read the way its words are (IsolatedLine),
 *     so an English message on an Arabic or Persian page keeps its full
 *     stop at its end.
 */
const ErrorLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const Tag: "div" | "p" = props.as || "p";

  if (isUnexplainedErrorMessage(props.message)) {
    return (
      <Tag
        className={props.className}
        data-testid={props.dataTestId}
        data-error-kind="unexplained"
      >
        <ErrorExplanation
          message={props.message}
          whatFailed={props.whatFailed}
        />
      </Tag>
    );
  }

  return (
    <IsolatedLine
      as={Tag}
      text={sayErrorMessage(props.message, translator)}
      className={props.className}
      dataTestId={props.dataTestId}
    />
  );
};

export default ErrorLine;
