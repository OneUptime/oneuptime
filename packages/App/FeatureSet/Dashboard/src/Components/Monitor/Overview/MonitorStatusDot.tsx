import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // A CSS colour. Undefined draws a plain grey dot, so rows still line up.
  color: string | undefined;
  // Replaces the default size (h-2 w-2) and adds any spacing.
  className?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * A small status or severity dot. The colour comes from the project's own
 * status settings, which can be any colour, so it is applied inline rather
 * than as a class. The name always sits next to it in text, so the dot is
 * hidden from assistive technology.
 */
const MonitorStatusDot: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const sizeClassName: string = props.className || "h-2 w-2";

  return (
    <span
      aria-hidden="true"
      data-testid={props.dataTestId}
      className={`inline-block flex-shrink-0 rounded-full ${sizeClassName}${
        props.color ? "" : " bg-gray-300"
      }`}
      style={props.color ? { backgroundColor: props.color } : undefined}
    />
  );
};

export default MonitorStatusDot;
