import OneUptimeDate from "Common/Types/Date";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  date?: Date | null | undefined;
}

export const RELATIVE_TIME_CELL_TEST_ID: string = "relative-time-cell";

/*
 * One time is one unit: never "2" at the end of a line and "minutes ago"
 * on the next. Folded under another value with its column's name before it
 * (Last Polled under Last Event Imported, where a connection's row does not
 * fit), the time goes whole onto the line after the name.
 */
export const RELATIVE_TIME_CELL_CLASS_NAME: string = "whitespace-nowrap";

/*
 * When something last happened, as a list of Security Events says it:
 * "5 minutes ago", with the date and time under the pointer, or "Never" in
 * the grey of a value that is not there.
 *
 * A column of full dates ("Oct 14 2026, 08:00 AM GMT", some 210px each)
 * pushed Detection Rules past its card at a laptop's width, and "how long
 * ago" is what an analyst reads a Last Match for.
 */
const RelativeTimeCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.date) {
    return (
      <span
        className={`${RELATIVE_TIME_CELL_CLASS_NAME} text-gray-400`}
        data-testid={RELATIVE_TIME_CELL_TEST_ID}
      >
        {translator.translateText("Never")}
      </span>
    );
  }

  return (
    <span
      className={RELATIVE_TIME_CELL_CLASS_NAME}
      title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        props.date,
      )}
      data-testid={RELATIVE_TIME_CELL_TEST_ID}
    >
      {OneUptimeDate.fromNow(props.date)}
    </span>
  );
};

export default RelativeTimeCell;
