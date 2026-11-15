import OneUptimeDate from "Common/Types/Date";
import React, { FunctionComponent, ReactElement } from "react";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";

export interface ComponentProps {
  value: Date | string | undefined | null;
  className?: string | undefined;
}

/*
 * A moment in a Data Security list: "3 days ago" in the reader's language,
 * the date and time under the pointer, or the table's quiet dash when there
 * is none.
 */
const IssueMoment: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.value) {
    return <TableEmptyValue />;
  }

  const date: Date = OneUptimeDate.fromString(props.value);

  return (
    <span
      className={props.className || "whitespace-nowrap text-sm text-gray-700"}
      title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date)}
    >
      {OneUptimeDate.fromNow(date)}
    </span>
  );
};

export default IssueMoment;
