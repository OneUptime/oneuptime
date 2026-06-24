import Navigation from "../../Utils/Navigation";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

export interface ComponentProps {
  children: ReactNode;
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
  let children: ReactNode;

  if (
    typeof props.children === "string" ||
    typeof props.children === "number"
  ) {
    children = <span>{props.children}</span>;
  } else {
    children = props.children;
  }

  const linkProps: JSONObject = {};

  /*
   * Always set href when a destination is provided so the browser's native
   * right-click "Open in new tab" and Cmd/Ctrl+click behaviors work.
   */
  if (props.to) {
    linkProps["href"] = props.to.toString();
  } else if (props.onClick) {
    /*
     * An anchor with an onClick but no href is not reachable or operable via the
     * keyboard. Expose it as a button so it is focusable and activatable with
     * Enter/Space (WCAG 2.1.1). Purely visual — no appearance change.
     */
    linkProps["role"] = "button";
    linkProps["tabIndex"] = 0;
  }

  if (props.openInNewTab) {
    linkProps["target"] = "_blank";
  }

  const cursorClassName: string = props.to
    ? "cursor-pointer"
    : "cursor-default";

  /*
   * Button-like links (onClick but no href/to) are rendered as role="button" and
   * are keyboard-focusable. Give them a visible focus ring so keyboard users can
   * see where focus is. Normal href links are left untouched.
   */
  const focusClassName: string =
    !props.to && props.onClick
      ? " focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 rounded"
      : "";

  return (
    <a
      id={props.id}
      className={`${cursorClassName} ${props.className || ""}${focusClassName}`}
      onMouseOver={props.onMouseOver}
      onMouseOut={props.onMouseOut}
      onMouseLeave={props.onMouseLeave}
      style={props.style}
      title={props.title}
      aria-label={props.title}
      onKeyDown={(event: React.KeyboardEvent<HTMLAnchorElement>) => {
        /*
         * For onClick-only links (no href) we render role="button"; activate them
         * with Enter/Space like a native button. Links with an href are activated
         * natively by the browser, so we leave those alone.
         */
        if (
          !props.to &&
          props.onClick &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          props.onClick();
        }
      }}
      onAuxClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
        // middle click
        if (event.button === 1) {
          event.preventDefault();
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
      onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
        if (props.onClick) {
          props.onClick();
        }

        // Let the browser handle modifier-key clicks natively (open in new tab/window).
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          return;
        }

        if (props.openInNewTab) {
          // Let the browser handle the default behavior (open in new tab via href and target="_blank")
          return;
        }

        event.preventDefault();

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
