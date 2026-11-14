import { BILLING_ENABLED } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Where an answer goes, said where it is given (issue #6832): to this
 * server's admins on a self-hosted server, where nothing leaves it, and to
 * the OneUptime team on OneUptime Cloud - with the page and the version,
 * and nothing else.
 */

export const FEEDBACK_WHERE_IT_GOES_TEST_ID: string = "feedback-where-it-goes";

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

export default FeedbackWhereItGoes;
