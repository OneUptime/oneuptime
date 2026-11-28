import {
  getNotificationLogStatusWords,
  NOTIFICATION_LOG_STATUS_TONES,
  NotificationLogKind,
  NotificationLogStatusWords,
} from "./NotificationLogStatus";
import ExplainedPill from "Common/UI/Components/Pill/ExplainedPill";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { joinSentences } from "Common/UI/Utils/SentenceSeparator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A NOTIFICATION LOG'S STATUS, SAYING WHAT IT MEANS (#11138).
 *
 * Its pill, in the colour of where the message stands, and - on hover, a
 * tap, or focus, and to a screen reader always - what the status means and
 * what comes next (NotificationLogStatus): "The carrier accepted the SMS.
 * It moves to Delivered or Undelivered once the carrier reports back."
 * Every sentence is looked up on its own and run together the way the
 * reader's script writes a paragraph. A log with no status draws the quiet
 * dash.
 */

export const NOTIFICATION_LOG_STATUS_TEST_ID: string =
  "notification-log-status";

export interface ComponentProps {
  kind: NotificationLogKind;
  status: string | null | undefined;
  statusMessage?: string | null | undefined;
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
    });

  if (!words) {
    return <TableEmptyValue />;
  }

  return (
    <ExplainedPill
      text={words.text}
      isUserContent={words.isTextAsWritten}
      tone={NOTIFICATION_LOG_STATUS_TONES[words.meaning]}
      explanation={joinSentences(
        words.explanation.map((sentence: string): string => {
          return translator.translateText(sentence) || sentence;
        }),
      )}
      isExplanationTranslated={true}
      dataTestId={NOTIFICATION_LOG_STATUS_TEST_ID}
    />
  );
};

export default NotificationLogStatusPill;
