import LeaveGuard from "../../Utils/LeaveGuard";
import Navigation from "../../Utils/Navigation";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import useTranslateValue from "../../Utils/Translation";
import { ReadingDirection } from "../../../Types/ReadingDirection";

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
  /*
   * Its hover tip and its name for a screen reader, in English: looked up
   * here. One in the reader's words already - a front end's own keyed
   * text, a sentence built around a name - is said so with
   * isTitleTranslated and drawn as given (#7790).
   */
  title?: string | undefined;
  isTitleTranslated?: boolean | undefined;
  dataTestId?: string | undefined;
  /*
   * The link is to the page (or the section) the user is on, as the nav
   * bar's lit item is: announced as "current page" (aria-current).
   */
  isCurrentPage?: boolean | undefined;
  /*
   * Which current item this link is, said in aria-current, when it is one:
   * "page" for a link to the very page the user is on, "true" for the one
   * that holds it (a list whose record is open, a section's entry). A side
   * menu marks its entry by colour, and this says the same thing to a
   * screen reader. It wins over isCurrentPage.
   */
  ariaCurrent?: LinkAriaCurrent | undefined;
  /*
   * The way its words read when that is not the page's (getIsolatedLine): a
   * link that is a name on a line of its own, cut short at its own end.
   */
  dir?: ReadingDirection | undefined;
}

export type LinkAriaCurrent = "page" | "true";

const Link: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const title: string | undefined = props.isTitleTranslated
    ? props.title
    : translateString(props.title);
  const ariaCurrent: LinkAriaCurrent | undefined =
    props.ariaCurrent || (props.isCurrentPage ? "page" : undefined);
  let children: ReactNode;

  if (
    typeof props.children === "string" ||
    typeof props.children === "number"
  ) {
    children = <span>{props.children}</span>;
  } else {
    children = props.children;
  }

  /*
   * Neither a destination nor an action: this is static text, not a link or a
   * button. Render a <span> rather than an <a> with no href, which is
   * ambiguous to assistive technology (is it a link, a button, or just text?
   * WCAG 4.1.2 Name, Role, Value).
   */
  if (!props.to && !props.onClick) {
    return (
      <span
        id={props.id}
        data-testid={props.dataTestId}
        dir={props.dir}
        className={`cursor-default ${props.className || ""}`}
        onMouseOver={props.onMouseOver}
        onMouseOut={props.onMouseOut}
        onMouseLeave={props.onMouseLeave}
        style={props.style}
        title={title}
        aria-current={ariaCurrent}
      >
        {children}
      </span>
    );
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

  return (
    <a
      id={props.id}
      data-testid={props.dataTestId}
      dir={props.dir}
      className={`${cursorClassName} ${props.className || ""}`}
      onMouseOver={props.onMouseOver}
      onMouseOut={props.onMouseOut}
      onMouseLeave={props.onMouseLeave}
      style={props.style}
      title={title}
      aria-label={title}
      aria-current={ariaCurrent}
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
        const isModifiedClick: boolean =
          event.metaKey || event.ctrlKey || event.shiftKey;

        /*
         * A page of this app, while the page shown holds work nobody has
         * saved (LeaveGuard): the whole click waits for the page's answer -
         * what it does first (a side menu's scroll to the top), the step,
         * and what follows it. Keep Editing leaves the page exactly as it
         * was; Discard Changes does all of it, as a click always did.
         */
        if (
          props.to instanceof Route &&
          !isModifiedClick &&
          !props.openInNewTab &&
          LeaveGuard.asksBeforeGoingTo(props.to.toString())
        ) {
          event.preventDefault();

          const to: Route = props.to;

          LeaveGuard.whenLeaving(to.toString(), () => {
            if (props.onClick) {
              props.onClick();
            }

            Navigation.navigate(to);

            if (props.onNavigateComplete) {
              props.onNavigateComplete();
            }
          });
          return;
        }

        if (props.onClick) {
          props.onClick();
        }

        // Let the browser handle modifier-key clicks natively (open in new tab/window).
        if (isModifiedClick) {
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
