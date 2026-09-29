import Color from "../../../Types/Color";
import React, { CSSProperties, FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
  color: Color;
  style?: CSSProperties;
  shouldAnimate: boolean;
}

const Statusbubble: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const backgroundColor: string = props.color
    ? props.color.toString()
    : "var(--ou-text-subtle, #9ca3af)";

  return (
    <div
      className="flex"
      style={props.style}
      role="status"
      aria-label={`Status: ${props.text}`}
    >
      <div className="-mr-2 ml-5" aria-hidden="true">
        <span className="relative -left-1 -translate-x-full top-1/2 -translate-y-1/2 flex h-3.5 w-3.5">
          <span
            className={`${
              props.shouldAnimate ? "motion-safe:animate-ping" : ""
            } absolute inline-flex h-full w-full rounded-full`}
            style={{
              backgroundColor: backgroundColor,
            }}
          ></span>
          <span
            className="relative inline-flex rounded-full h-3.5 w-3.5"
            style={{
              backgroundColor: backgroundColor,
              boxShadow: "0 0 0 1px var(--ou-border-strong, #d1d5db)",
            }}
          ></span>
        </span>
      </div>
      <div
        className="text-sm font-medium"
        style={{
          color: "var(--ou-text-secondary, #4b5563)",
        }}
      >
        {props.text}
      </div>
    </div>
  );
};

export default Statusbubble;
