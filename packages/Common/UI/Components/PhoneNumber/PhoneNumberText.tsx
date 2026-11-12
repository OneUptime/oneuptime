import Phone from "../../../Types/Phone";
import {
  getPhoneNumberDirection,
  getPhoneNumberValueText,
} from "../../../Types/PhoneNumberDirection";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  /*
   * The number as it is stored - a Phone, or its text - or the name given
   * in its place (a Twilio number's friendly name).
   */
  phoneNumber: Phone | string | null | undefined;
  className?: string | undefined;
  title?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * A PHONE NUMBER, READ +447700900123 IN EVERY LANGUAGE.
 *
 * On a page read right to left a number printed as it is put its "+" at
 * the end of its digits ("447700900123+": PhoneNumberDirection). Drawn
 * here, it is an isolate that reads left to right (bdi dir="ltr", as an
 * ID, a hidden value and code are drawn), so its "+" stays in front, and
 * the isolate still sits where the page's line puts it: after an icon at
 * the line's start, at the right of an Arabic table's cell.
 *
 * Every number the product prints goes through it, table cells and detail
 * fields of FieldType.Phone included (Common Tests/UI/PhoneNumberTextGuard
 * finds one printed as it is). A name in a number's place reads the way
 * most of its letters do (getPhoneNumberDirection). Nothing is drawn for
 * no number.
 *
 * Its start and end are its own, as its isolate reads left to right: a
 * start margin (ml-2, or space-x-2 on the row it sits in) is its left on a
 * Persian page too, where it should be its right. A row that holds one is
 * spaced by its gap (flex gap-2), and the guard finds one spaced by a side.
 */
const PhoneNumberText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const text: string = getPhoneNumberValueText(props.phoneNumber);

  if (!text) {
    return <></>;
  }

  return (
    <bdi
      dir={getPhoneNumberDirection(text)}
      className={props.className}
      title={props.title}
      data-testid={props.dataTestId}
    >
      {text}
    </bdi>
  );
};

export default PhoneNumberText;
