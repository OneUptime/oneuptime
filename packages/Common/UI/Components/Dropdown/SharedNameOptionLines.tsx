import IsolatedLine from "../IsolatedText/IsolatedLine";
import InlineSeparator from "../InlineSeparator/InlineSeparator";
import Pill from "../Pill/Pill";
import { PillTone } from "../Pill/PillTone";
import { SharedNameMark } from "../../Utils/SharedNameOptions";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * HOW A PICKER DRAWS ONE OF RECORDS THAT SHARE A NAME (#10064), one look
 * wherever the four kinds are picked or filtered - the Dropdown, the
 * EntityDropdown every form's record field is, the people picker and the
 * filter chips:
 *
 *   - in the open list, the pill the record's own list draws beside its
 *     name ("Same name as another label", #9746) and, under the name, what
 *     sets it apart (SharedNameOptions): its description as its owner wrote
 *     it, or when it was made;
 *   - once picked, that line after its name, quieter, so two picked twins
 *     read as two.
 *
 * The mark is worked out by SharedNameOptions.getSharedNameMarks.
 */

export const SHARED_NAME_PILL_TEST_ID: string = "shared-name-option-pill";
export const SHARED_NAME_DETAIL_TEST_ID: string = "shared-name-option-detail";
export const SHARED_NAME_VALUE_DETAIL_TEST_ID: string =
  "shared-name-value-detail";

// The pill beside the name, in the open list.
export const SharedNamePill: FunctionComponent<{
  mark: SharedNameMark;
}> = (props: { mark: SharedNameMark }): ReactElement => {
  return (
    <Pill
      text={props.mark.pill}
      tone={PillTone.Warning}
      dataTestId={SHARED_NAME_PILL_TEST_ID}
    />
  );
};

/*
 * What sets it apart, under its name in the open list: its owner's words
 * read their own way (IsolatedLine), OneUptime's in the page's.
 */
export const SharedNameDetail: FunctionComponent<{
  mark: SharedNameMark;
  className: string;
}> = (props: { mark: SharedNameMark; className: string }): ReactElement => {
  if (!props.mark.detail) {
    return <></>;
  }

  if (props.mark.isDetailAsWritten) {
    return (
      <IsolatedLine
        as="span"
        text={props.mark.detail}
        className={props.className}
        dataTestId={SHARED_NAME_DETAIL_TEST_ID}
      />
    );
  }

  return (
    <span className={props.className} data-testid={SHARED_NAME_DETAIL_TEST_ID}>
      {props.mark.detail}
    </span>
  );
};

/*
 * The same line after a picked value's name: set apart by the reader's
 * separator, a size smaller and quieter, and cut short before the name is.
 */
export const SHARED_NAME_VALUE_DETAIL_CLASS_NAME: string =
  "min-w-0 truncate text-xs font-normal text-gray-500";

export const SharedNameValueDetail: FunctionComponent<{
  mark: SharedNameMark;
  className?: string | undefined;
}> = (props: {
  mark: SharedNameMark;
  className?: string | undefined;
}): ReactElement => {
  if (!props.mark.detail) {
    return <></>;
  }

  return (
    <span
      className={props.className || SHARED_NAME_VALUE_DETAIL_CLASS_NAME}
      data-testid={SHARED_NAME_VALUE_DETAIL_TEST_ID}
    >
      <InlineSeparator markOnly={true} />{" "}
      {props.mark.isDetailAsWritten ? (
        <bdi>{props.mark.detail}</bdi>
      ) : (
        props.mark.detail
      )}
    </span>
  );
};
