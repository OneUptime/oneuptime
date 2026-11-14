import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import { getProbeFailureCauseText } from "Common/Utils/Monitor/ProbeFailureReading";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A PROBE'S MESSAGE ON A CHECK'S SUMMARY: why the check failed (its Error),
 * what the failure means (Error Details), a query's or a connection's own
 * error.
 *
 * The probe's own sentences read in the reader's language - its timeout
 * sentence, with the count in the reader's digits
 * (ProbeFailureReading.getProbeFailureCauseText). Every other message is
 * the network's, the runtime's or a server's own, and stays as written:
 * on an Arabic or Persian page it reads left to right in a line of its
 * own (IsolatedLine), so its full stop and its brackets stay at its end,
 * lined up where the page's lines start. A message in the page's own
 * direction is drawn exactly as before.
 *
 * It breaks between words, never inside one, unless one word (an address,
 * a path) is longer than the line: then after the word's own dots and
 * slashes first (BreakableName), as every other value of a summary does -
 * "getaddrinfo ENOTFOUND status." / "internal.example.com", not at
 * whatever letter fills the line.
 */
export const PROBE_MESSAGE_LINE_CLASS_NAME: string = "block break-words";

export const PROBE_MESSAGE_LINE_TEST_ID: string =
  "monitor-summary-probe-message";

export interface ComponentProps {
  // The message as the probe stored it.
  message: string;
  dataTestId?: string | undefined;
}

const ProbeMessageLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const text: string = getProbeFailureCauseText({
    translator: translator,
    failureCause: props.message,
  });

  return (
    <IsolatedLine
      as="span"
      className={PROBE_MESSAGE_LINE_CLASS_NAME}
      text={text}
      dataTestId={props.dataTestId || PROBE_MESSAGE_LINE_TEST_ID}
    >
      <BreakableName text={text} />
    </IsolatedLine>
  );
};

export default ProbeMessageLine;
