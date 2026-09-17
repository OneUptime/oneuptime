import React, { FunctionComponent, ReactElement } from "react";
import AIRunStatus, { AIRunStatusHelper } from "Common/Types/AI/AIRunStatus";
import OneUptimeDate from "Common/Types/Date";

export interface ComponentProps {
  status: AIRunStatus | undefined;
  startedAt: Date | undefined;
  completedAt: Date | undefined;
}

/*
 * How long a code-fix run took, or how long it has been going. A run that is
 * still live counts up from startedAt, so a stuck task reads as "42m" rather
 * than as a blank cell.
 */
const CodeFixRunDuration: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.startedAt) {
    return <span className="text-gray-400">-</span>;
  }

  const isTerminal: boolean = Boolean(
    props.status && AIRunStatusHelper.isTerminalStatus(props.status),
  );

  /*
   * A terminal run with no completedAt never recorded an end (it was killed
   * or swept). Counting up to "now" there would invent a duration that grows
   * every time the page is opened.
   */
  if (isTerminal && !props.completedAt) {
    return <span className="text-gray-400">-</span>;
  }

  const endsAt: Date = props.completedAt || OneUptimeDate.getCurrentDate();

  const duration: string =
    OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
      props.startedAt,
      endsAt,
    );

  /*
   * The formatter appends each unit only when it is > 0, so anything under a
   * second — and anything negative, which clock skew between the agent and
   * the server can produce — comes back as an empty string. Rendering that
   * raw would leave a blank cell, or a bare "so far".
   */
  if (!duration) {
    return (
      <span className="text-sm text-gray-600 whitespace-nowrap">
        {props.completedAt ? "< 1 sec" : "Just started"}
      </span>
    );
  }

  return (
    <span className="text-sm text-gray-600 whitespace-nowrap">
      {props.completedAt ? duration : `${duration} so far`}
    </span>
  );
};

export default CodeFixRunDuration;
