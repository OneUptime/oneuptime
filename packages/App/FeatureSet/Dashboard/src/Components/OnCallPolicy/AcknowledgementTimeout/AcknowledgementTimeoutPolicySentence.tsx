import {
  ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN,
  ACKNOWLEDGEMENT_TIMEOUT_TEST_ID,
  AcknowledgementTimeoutCopy,
} from "./AcknowledgementTimeout";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a policy that pages again says about it where it is summed up - the
 * Escalation summary on its Escalation Rules page, and Policy at a glance
 * on its Overview: "If it is acknowledged but not resolved within 30 min,
 * it pages again, up to 5 times." The setting itself waits, folded, under
 * More settings; while it is on, the policy's summaries say so, so nobody
 * reading the policy in a few seconds misses that it pages people again.
 *
 * The duration comes written as the summary writes its others ("30 min",
 * "1 hr 30 min"), and is drawn in bold, with the times, as the summary
 * draws its other numbers. Nothing is drawn for a policy that does not
 * page again: the caller leaves it out.
 */

export interface ComponentProps {
  // The policy's timeout, as the summary writes a duration: "30 min".
  duration: string;
  // How the summary draws a number in its sentences.
  boldClassName?: string | undefined;
}

export const ACKNOWLEDGEMENT_TIMEOUT_POLICY_SENTENCE_TEST_ID: string = `${ACKNOWLEDGEMENT_TIMEOUT_TEST_ID}-policy-sentence`;

const AcknowledgementTimeoutPolicySentence: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * Each number stays whole on a narrow screen: "up to 5" / "times" broke
   * across two lines on a phone.
   */
  const boldClassName: string = `${
    props.boldClassName || "font-semibold text-gray-900"
  } whitespace-nowrap`;

  return (
    <span data-testid={ACKNOWLEDGEMENT_TIMEOUT_POLICY_SENTENCE_TEST_ID}>
      <TranslatedSentence
        template={AcknowledgementTimeoutCopy.policySentence}
        slots={{
          duration: <span className={boldClassName}>{props.duration}</span>,
          times: (
            <span className={boldClassName}>
              {translator.translatePlural(
                AcknowledgementTimeoutCopy.policySentenceTimes,
                ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN,
              )}
            </span>
          ),
        }}
      />
    </span>
  );
};

export default AcknowledgementTimeoutPolicySentence;
