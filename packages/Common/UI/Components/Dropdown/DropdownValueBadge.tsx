import { Indigo500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import {
  PillSize,
  WRAPPING_PILL_CLASS_NAME,
  WRAPPING_PILL_DOT_CLASS_NAME,
  PILL_DOT_CLASS_NAME,
} from "../Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";
import {
  getPillColors,
  getPillDotStyle,
  getPillToneStyle,
  PillColors,
} from "../Pill/PillColors";

export interface ComponentProps {
  label: string;
  color?: Color | string | undefined;
  /*
   * Classes added to the badge's own. A detail card's value sets align-top,
   * so the badge sits on the value's 24px line rather than on its baseline,
   * which stood it 2px lower than the values beside it and the row 2px
   * taller.
   */
  className?: string | undefined;
}

/*
 * A value without a colour of its own is drawn in the product's indigo, as
 * it always was - now through the same colour work as every other pill.
 */
export const DROPDOWN_VALUE_DEFAULT_COLOR: Color = Indigo500;

const getColor: (color: Color | string | undefined) => Color | undefined = (
  color: Color | string | undefined,
): Color | undefined => {
  if (!color) {
    return undefined;
  }

  const normalizedColor: Color =
    color instanceof Color ? color : Color.fromString(color);

  try {
    Color.colorToRgb(normalizedColor);
    return normalizedColor;
  } catch {
    return undefined;
  }
};

/*
 * A dropdown's value, shown as a pill: a monitor's status, a custom field's
 * choice, a related record in a detail card. It is the product's one pill
 * (Pill's shape and size, its colours worked out the way a Pill's are: a dot
 * in the exact colour, a pale wash and ring of it, text in a shade of it
 * that reads, in both themes through Theme.css's [data-ou-pill] rules). It
 * was a 12px badge with square-ish corners beside 13px round label pills.
 * A long value runs onto a next line inside it, as a wrapping Pill's does,
 * rather than being cut short.
 */
const DropdownValueBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const color: Color | undefined = getColor(props.color);
  const colors: PillColors = getPillColors(
    color || DROPDOWN_VALUE_DEFAULT_COLOR,
  );

  return (
    <span
      data-dropdown-value-badge="true"
      data-dropdown-value-color={color?.toString()}
      data-ou-pill=""
      className={`${WRAPPING_PILL_CLASS_NAME} [overflow-wrap:anywhere]${
        props.className ? ` ${props.className}` : ""
      }`}
      style={{ fontSize: PillSize.Normal, ...getPillToneStyle(colors) }}
    >
      <span
        aria-hidden="true"
        data-ou-pill-dot=""
        className={`${PILL_DOT_CLASS_NAME} ${WRAPPING_PILL_DOT_CLASS_NAME}`}
        style={getPillDotStyle(colors)}
      ></span>
      {props.label}
    </span>
  );
};

export default DropdownValueBadge;
