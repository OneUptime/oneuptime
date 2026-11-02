import OneUptimeDate from "../../../Types/Date";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  value: Date | string;
  // A day, with no time of day: "Oct 22", "Oct 22, 2025".
  onlyShowDate?: boolean | undefined;
  dataTestId?: string | undefined;
}

export const TABLE_DATE_TEST_ID: string = "table-date";

// What a cell writes for a date, and what it says under the pointer.
export interface TableDateTexts {
  text: string;
  fullText: string;
  isoText: string;
}

/*
 * The cell's words for a date, or null for a value that is not one (or one
 * the formatters cannot write): the cell then shows the value as it was
 * written, which is what lets someone find and fix it.
 */
export const getTableDateTexts: (data: {
  value: Date | string;
  onlyShowDate?: boolean | undefined;
}) => TableDateTexts | null = (data: {
  value: Date | string;
  onlyShowDate?: boolean | undefined;
}): TableDateTexts | null => {
  try {
    const date: Date = OneUptimeDate.fromString(data.value);

    if (isNaN(date.getTime())) {
      return null;
    }

    return {
      text: OneUptimeDate.getDateAsCompactLocalString(date, {
        onlyShowDate: Boolean(data.onlyShowDate),
      }),
      fullText: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        date,
        Boolean(data.onlyShowDate),
      ),
      isoText: date.toISOString(),
    };
  } catch {
    return null;
  }
};

/*
 * A date in a list's cell, as every table writes one: short - "Oct 22,
 * 7:25 AM", with its year only when it is not this year's, and no zone
 * (OneUptimeDate.getDateAsCompactLocalString) - and whole under the
 * pointer: "Oct 22 2026, 07:25 AM BST". A <time> whose datetime is the
 * moment itself, for whatever reads the page rather than looks at it.
 *
 * "Oct 22 2026, 07:25 AM BST" in full took some 180px in every date column,
 * the widest value left in the lists that still ran past their card at a
 * laptop's width, and its year and its zone said the same on every row.
 */
const TableDate: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const texts: TableDateTexts | null = getTableDateTexts({
    value: props.value,
    onlyShowDate: props.onlyShowDate,
  });

  if (!texts) {
    return <span>{String(props.value)}</span>;
  }

  return (
    <time
      dateTime={texts.isoText}
      title={texts.fullText}
      data-testid={props.dataTestId || TABLE_DATE_TEST_ID}
    >
      {texts.text}
    </time>
  );
};

export default TableDate;
