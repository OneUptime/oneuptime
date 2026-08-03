import Color from "../../../Types/Color";
import React, { CSSProperties, FunctionComponent, ReactElement } from "react";

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
  const style: CSSProperties | undefined = color
    ? {
        backgroundColor: color.toString(),
        borderColor: color.toString(),
        color: Color.shouldUseDarkText(color) ? "#111827" : "#f9fafb",
      }
    : undefined;

  return (
    <span
      data-dropdown-value-badge="true"
      data-dropdown-value-color={color?.toString()}
      className={`inline-flex items-center gap-x-1.5 rounded-md px-2 py-1 text-xs font-medium ${
        color
          ? "border border-solid"
          : "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-700/10"
      }`}
      style={style}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          color ? "bg-current" : "bg-indigo-500"
        }`}
      ></span>
      {props.label}
    </span>
  );
};

export default DropdownValueBadge;
