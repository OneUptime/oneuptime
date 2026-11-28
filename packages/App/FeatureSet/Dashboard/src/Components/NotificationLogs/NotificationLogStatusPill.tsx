import {
  getNotificationLogStatusWords,
  NOTIFICATION_LOG_STATUS_TONES,
  NotificationLogKind,
  NotificationLogStatusLine,
  NotificationLogStatusWords,
} from "./NotificationLogStatus";
import ExplainedPill from "Common/UI/Components/Pill/ExplainedPill";
import { PillSize } from "Common/UI/Components/Pill/Pill";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { joinSentences } from "Common/UI/Utils/SentenceSeparator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A NOTIFICATION LOG'S STATUS, SAYING WHAT IT MEANS (#11138, #11416).
 *
 * Its pill, in the colour of where the message stands, and - on hover, a
 * tap, or focus, and to a screen reader always - what the status means and
 * what comes next (NotificationLogStatus): "The carrier accepted the SMS.
 * It moves to Delivered or Undelivered once the carrier reports back."
 * Every sentence is looked up on its own and run together the way the
 * reader's script writes a paragraph. A log with no status draws the quiet
 * dash.
 *
 * Every page that says what became of a message draws it so, in the log's
 * own words: the eight logs, an incident's or an alert's Who Was Told, a
 * test page's result and a person's On-Call Logs. A page away from the log
 * (isAwayFromItsLog) leaves out the sentence that names one of the log's
 * own columns or buttons ("Error Code says why."), which it has not got.
 */

export const NOTIFICATION_LOG_STATUS_TEST_ID: string =
  "notification-log-status";

export interface ComponentProps {
  kind: NotificationLogKind;
  status: string | null | undefined;
  /*
   * The log's message, which tells two meanings of one status apart - an
   * SMS's Sent the server's own gateway took for good, a call's Success
   * that was answered - or, from a page that does not carry the message,
   * what it says (`line`).
   */
  statusMessage?: string | null | undefined;
  line?: NotificationLogStatusLine | null | undefined;
  isAwayFromItsLog?: boolean | undefined;
  size?: PillSize | undefined;
  dataTestId?: string | undefined;
}

// What the pill's explanation says, a whole sentence at a time, each a key.
export function getNotificationLogStatusExplanation(
  words: NotificationLogStatusWords,
  isAwayFromItsLog?: boolean | undefined,
): Array<string> {
  return [
    ...words.explanation,
    ...(words.inTheLog && !isAwayFromItsLog ? [words.inTheLog] : []),
  ];
}

const NotificationLogStatusPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const words: NotificationLogStatusWords | null =
    getNotificationLogStatusWords({
      kind: props.kind,
      status: props.status,
      statusMessage: props.statusMessage,
      line: props.line,
    });

  if (!words) {
    return <TableEmptyValue />;
  }

  return (
    <ExplainedPill
      text={words.text}
      isUserContent={words.isTextAsWritten}
      tone={NOTIFICATION_LOG_STATUS_TONES[words.meaning]}
      size={props.size}
      explanation={joinSentences(
        getNotificationLogStatusExplanation(words, props.isAwayFromItsLog).map(
          (sentence: string): string => {
            return translator.translateText(sentence) || sentence;
          },
        ),
      )}
      isExplanationTranslated={true}
      dataTestId={props.dataTestId || NOTIFICATION_LOG_STATUS_TEST_ID}
    />
  );
};

export default NotificationLogStatusPill;
