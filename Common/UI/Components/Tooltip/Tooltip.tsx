import Tippy from "@tippyjs/react";
import React, { FunctionComponent, ReactElement } from "react";
import "tippy.js/dist/tippy.css";

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

  return (
    <Tippy
      key={Math.random()}
      content={tooltipContent}
      interactive={true}
      trigger="mouseenter focus"
      hideOnClick={false}
      maxWidth={props.richContent ? 380 : 350}
      delay={[100, 0]}
      duration={[150, 100]}
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
