import Tippy from "@tippyjs/react";
import React, { FunctionComponent, ReactElement } from "react";
import "tippy.js/dist/tippy.css";
import "tippy.js/themes/light-border.css";
import "tippy.js/animations/shift-away-subtle.css";

export interface ComponentProps {
  text?: string | undefined;
  children: ReactElement;
  richContent?: ReactElement | undefined;
}

const Tooltip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.text && !props.richContent) {
    return props.children;
  }

  const tooltipContent: ReactElement = props.richContent ? (
    props.richContent
  ) : (
    <span>{props.text}</span>
  );

  const isRich: boolean = Boolean(props.richContent);

  const themeProps: { theme: string } | Record<string, never> = isRich
    ? { theme: "light-border" }
    : {};

  const animationProps: { animation: string } | Record<string, never> = isRich
    ? { animation: "shift-away-subtle" }
    : {};

  return (
    <Tippy
      key={Math.random()}
      content={tooltipContent}
      interactive={isRich}
      trigger="mouseenter focus"
      hideOnClick={false}
      maxWidth={isRich ? 380 : 350}
      delay={isRich ? [120, 80] : [0, 0]}
      duration={[200, 150]}
      placement={isRich ? "top" : "top"}
      {...themeProps}
      {...animationProps}
      aria={{
        content: "describedby",
        expanded: "auto",
      }}
    >
      {props.children}
    </Tippy>
  );
};

export default Tooltip;
