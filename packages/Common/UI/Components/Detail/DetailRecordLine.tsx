import Icon from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import DetailIdLine from "./DetailIdLine";
import {
  getRecordTimeFullText,
  getRecordTimeText,
  RecordTime,
  RecordTimeKind,
} from "./DetailRecordTime";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The small line a details card ends with: the record's own ID (DetailIdLine)
 * and when the record was created - and last updated, where the card says -
 * in place of the rows they used to take (DetailRecordId.ts and
 * DetailRecordTime.ts say why).
 *
 *   - Each piece is one unit: its icon, its word and its value. On a narrow
 *     card a piece that does not fit moves under the others whole, so the
 *     line wraps between pieces, never inside "Created Sep 30".
 *   - A time reads as the row it replaces did, in the reader's time zone;
 *     hovering it gives it to the second, and its dateTime attribute gives
 *     it to a machine.
 *   - Nothing on it is a field: no label element, no row, no divider of its
 *     own. Detail draws the one divider above it.
 */

export interface ComponentProps {
  recordId?: string | undefined;
  times?: Array<RecordTime> | undefined;
  className?: string | undefined;
}

export interface RecordTimeProps {
  time: RecordTime;
}

export const DetailRecordTimeElement: FunctionComponent<RecordTimeProps> = (
  props: RecordTimeProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const kind: RecordTimeKind = props.time.kind;
  const testId: string = `detail-${kind}-at`;

  // Each word written out, so the translation tooling finds it.
  const label: string =
    (kind === RecordTimeKind.Updated
      ? translator.translateText("Updated")
      : translator.translateText("Created")) || "";

  return (
    <div
      data-testid={testId}
      className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-gray-500"
    >
      <div className="inline-flex shrink-0 items-center gap-1.5 font-medium">
        <Icon icon={IconProp.Clock} className="h-3.5 w-3.5 text-gray-400" />
        <span data-testid={`${testId}-label`}>{label}</span>
      </div>
      <Tooltip text={getRecordTimeFullText(props.time.date)}>
        <time
          data-testid={`${testId}-value`}
          dateTime={props.time.date.toISOString()}
          className="min-w-0 text-gray-600"
        >
          {getRecordTimeText(props.time.date)}
        </time>
      </Tooltip>
    </div>
  );
};

const DetailRecordLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const times: Array<RecordTime> = props.times || [];

  return (
    <div
      data-testid="detail-record-line"
      className={`flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500 ${
        props.className || ""
      }`}
    >
      {props.recordId ? <DetailIdLine recordId={props.recordId} /> : <></>}
      {times.map((time: RecordTime): ReactElement => {
        return <DetailRecordTimeElement key={time.kind} time={time} />;
      })}
    </div>
  );
};

export default DetailRecordLine;
