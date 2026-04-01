import Tippy from "@tippyjs/react";
import React, { FunctionComponent, ReactElement } from "react";
import "tippy.js/dist/tippy.css";
import "tippy.js/themes/light-border.css";

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

  const themeProps: { theme: string } | Record<string, never> =
    props.richContent ? { theme: "light-border" } : {};

  return (
    <Tippy
      key={Math.random()}
      content={tooltipContent}
      interactive={true}
      trigger="mouseenter focus"
      hideOnClick={false}
      maxWidth={props.richContent ? 380 : 350}
      delay={[80, 0]}
      duration={[150, 100]}
      {...themeProps}
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
