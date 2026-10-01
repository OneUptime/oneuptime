import Color from "../../../Types/Color";
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
}

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

const DropdownValueBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const color: Color | undefined = getColor(props.color);
  /*
   * A coloured value is painted the way a Pill is (PillColors.ts): a dot in
   * the exact colour, a pale wash and ring of it, and text in a shade of it
   * that reads - in both themes, through Theme.css's [data-ou-pill] rules.
   */
  const colors: PillColors | undefined = color
    ? getPillColors(color)
    : undefined;

  return (
    <span
      data-dropdown-value-badge="true"
      data-dropdown-value-color={color?.toString()}
      data-ou-pill={colors ? "" : undefined}
      className={`inline-flex items-center gap-x-1.5 rounded-md px-2 py-1 text-xs font-medium ${
        colors
          ? ""
          : "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-700/10"
      }`}
      style={colors ? getPillToneStyle(colors) : undefined}
    >
      <span
        aria-hidden="true"
        data-ou-pill-dot={colors ? "" : undefined}
        className={`h-1.5 w-1.5 rounded-full ${colors ? "" : "bg-indigo-500"}`}
        style={colors ? getPillDotStyle(colors) : undefined}
      ></span>
      {props.label}
    </span>
  );
};

export default DropdownValueBadge;
