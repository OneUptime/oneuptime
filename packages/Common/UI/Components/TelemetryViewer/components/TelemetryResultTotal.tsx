import React, { FunctionComponent, ReactElement } from "react";
import {
  ResultTotal,
  ResultTotalStatus,
  ResultTotalUnavailableReason,
} from "../../../Utils/Telemetry/ResultTotal";
import {
  TelemetryItemLabels,
  getTelemetryItemLabels,
} from "./TelemetryItemLabel";

export const TELEMETRY_RESULT_TOTAL_TEST_ID: string = "telemetry-result-total";

export interface TelemetryResultTotalProps {
  total: ResultTotal;
  /*
   * Rows the list has shown up to the end of this page. All an uncounted
   * total can still vouch for: "50+ spans".
   */
  rowsThroughPage: number;
  itemLabel?: string | undefined;
}

const UNAVAILABLE_EXPLANATION: Record<ResultTotalUnavailableReason, string> = {
  [ResultTotalUnavailableReason.TooManyToCount]:
    "Too many to count in time. Narrow the time range for an exact total.",
  [ResultTotalUnavailableReason.CountFailed]: "The total could not be counted.",
};

/*
 * The size of the result set, at the head of the list it describes: the
 * number a reader looks for to judge volume and to check that a filter did
 * what they meant (issue #4202). It never claims more than it knows — while
 * counting it says so, and a total that could not be counted is printed as
 * what the list has proven, with a "+".
 */
const TelemetryResultTotal: FunctionComponent<TelemetryResultTotalProps> = (
  props: TelemetryResultTotalProps,
): ReactElement => {
  const labels: TelemetryItemLabels = getTelemetryItemLabels(props.itemLabel);
  const status: ResultTotalStatus = props.total.status;

  let content: ReactElement;

  if (status === ResultTotalStatus.Exact) {
    const count: number = props.total.count || 0;

    content = (
      <>
        <span className="font-semibold tabular-nums text-gray-900">
          {count.toLocaleString()}
        </span>{" "}
        {count === 1 ? labels.singular : labels.plural}
      </>
    );
  } else if (status === ResultTotalStatus.Unavailable) {
    const reason: ResultTotalUnavailableReason =
      props.total.unavailableReason || ResultTotalUnavailableReason.CountFailed;

    content = (
      <>
        <span className="font-semibold tabular-nums text-gray-900">
          {`${props.rowsThroughPage.toLocaleString()}+`}
        </span>{" "}
        {labels.plural}
        <span className="text-gray-400">
          {` · ${UNAVAILABLE_EXPLANATION[reason]}`}
        </span>
      </>
    );
  } else {
    content = <>{`Counting ${labels.plural}…`}</>;
  }

  return (
    <p
      className="text-xs text-gray-500"
      data-testid={TELEMETRY_RESULT_TOTAL_TEST_ID}
      data-status={status}
    >
      {content}
    </p>
  );
};

export default TelemetryResultTotal;
