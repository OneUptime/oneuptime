import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  className?: string | undefined;
}

/*
 * A divider between groups of a form or a card. Its colour is the one the
 * form's section headings draw their divider in (border-gray-200), which the
 * dark theme repaints (Theme.css). It was gray-700 at 10% opacity, a token
 * the dark theme has no rule for: on a dark surface the line all but
 * vanished, and only the gap it leaves was there.
 */
const HorizontalRule: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      className={`border-b border-gray-200 mb-8 mt-8 ${props.className || ""}`}
    ></div>
  );
};

export default HorizontalRule;
