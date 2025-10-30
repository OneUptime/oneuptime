import Navigation from "../../Utils/Navigation";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement> | string;
  className?: undefined | string;
  to?: Route | URL | null | undefined;
  onClick?: undefined | (() => void);
  onNavigateComplete?: (() => void) | undefined;
  openInNewTab?: boolean | undefined;
  style?: React.CSSProperties | undefined;
  onMouseOver?: (() => void) | undefined;
  onMouseOut?: (() => void) | undefined;
  onMouseLeave?: (() => void) | undefined;
  id?: string | undefined;
  title?: string | undefined;
}

const Link: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let children: ReactElement | Array<ReactElement>;

  if (typeof props.children === "string") {
    children = <span>{props.children}</span>;
  } else {
    children = props.children;
  }

  const linkProps: JSONObject = {};

  if (props.openInNewTab) {
    linkProps["target"] = "_blank";
    linkProps["href"] = props.to?.toString();
  }

  const cursorClassName: string = props.to
    ? "cursor-pointer"
    : "cursor-default";

  return (
    <a
      id={props.id}
      className={`${cursorClassName} ${props.className || ""}`}
      onMouseOver={props.onMouseOver}
      onMouseOut={props.onMouseOut}
      onMouseLeave={props.onMouseLeave}
      style={props.style}
      title={props.title}
      onAuxClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
        // middle click
        if (event.button === 1) {
          if (props.to) {
            Navigation.navigate(props.to, {
              openInNewTab: true,
            });

            if (props.onNavigateComplete) {
              props.onNavigateComplete();
            }
          }
        }
      }}
      onClick={() => {
        if (props.onClick) {
          props.onClick();
        }

        if (props.openInNewTab) {
          return;
        }

        if (props.to) {
          Navigation.navigate(props.to);
        }

        if (props.onNavigateComplete) {
          props.onNavigateComplete();
        }
      }}
      {...linkProps}
    >
      {children}
    </a>
  );
};

export default Link;
