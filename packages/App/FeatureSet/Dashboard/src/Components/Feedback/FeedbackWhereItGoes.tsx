import { BILLING_ENABLED } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Where an answer goes, said where it is given (issue #6832): to this
 * server's admins on a self-hosted server, where nothing leaves it, and to
 * the OneUptime team on OneUptime Cloud - with the page and the version,
 * and nothing else.
 *
 * Said before the answer is given. Once it is, the card says where it went
 * instead (FeedbackSentLine, #7462): this line, left under a link to a
 * public GitHub issue, read as if "nothing leaves this server" were about
 * the link.
 */

export const FEEDBACK_WHERE_IT_GOES_TEST_ID: string = "feedback-where-it-goes";
export const FEEDBACK_SENT_LINE_TEST_ID: string = "feedback-sent-line";

export interface ComponentProps {
  className?: string | undefined;
}

const FeedbackWhereItGoes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <p
      className={`text-xs text-gray-500 ${props.className || ""}`}
      data-testid={FEEDBACK_WHERE_IT_GOES_TEST_ID}
    >
      {BILLING_ENABLED
        ? translator.translateText(
            "Goes to the OneUptime team, with the page you are on and the OneUptime version. Nothing else is sent.",
          )
        : translator.translateText(
            "Goes to this server's admins, with the page you are on and the OneUptime version. Nothing else is sent, and nothing leaves this server.",
          )}
    </p>
  );
};

/*
 * The thanks for an answer: "us" on OneUptime Cloud, where the OneUptime
 * team reads it, and no "us" on a self-hosted server, whose admins read it
 * (#7462): there "Thanks for telling us." read as thanks from OneUptime.
 */
export const getFeedbackThanks: (translator: Translator) => string = (
  translator: Translator,
): string => {
  return (
    (BILLING_ENABLED
      ? translator.translateText("Thanks for telling us.")
      : translator.translateText("Thanks for your answer.")) || ""
  );
};

// Where an answer went, once it was given (#7462).
export const FeedbackSentLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <p
      className={`text-sm text-gray-600 ${props.className || ""}`}
      data-testid={FEEDBACK_SENT_LINE_TEST_ID}
    >
      {BILLING_ENABLED
        ? translator.translateText("Sent to the OneUptime team.")
        : translator.translateText(
            "This server's admins can read it in the Admin Dashboard, under Feedback.",
          )}
    </p>
  );
};

export default FeedbackWhereItGoes;
