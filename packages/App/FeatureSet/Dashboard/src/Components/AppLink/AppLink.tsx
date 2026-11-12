import Route from "Common/Types/API/Route";
import { ReadingDirection } from "Common/Types/ReadingDirection";
import LeaveGuard from "Common/UI/Utils/LeaveGuard";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, useContext } from "react";
import { Link } from "react-router-dom";
import { AppLinkAsTextContext, getAppLinkTextClassName } from "./AppLinkAsText";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement> | string;
  className?: undefined | string;
  to?: Route;
  onNavigateComplete?: (() => void) | undefined;
  // Shown under the pointer: a link with no words of its own (an icon) says what it does.
  title?: string | undefined;
  dataTestId?: string | undefined;
  /*
   * The link is to the page the reader is on, as a lit tab is: announced
   * as the current page (aria-current).
   */
  isCurrentPage?: boolean | undefined;
  /*
   * A link that is a line of its own and holds only a name someone typed
   * reads the way the name does (getIsolatedLine's dir): an English monitor
   * name on an Arabic page, its lines from its own start. Left out, the
   * link reads the page's way.
   */
  dir?: ReadingDirection | undefined;
}

const ReactDomLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isText: boolean = useContext(AppLinkAsTextContext);

  let children: ReactElement | Array<ReactElement>;

  if (typeof props.children === "string") {
    children = <span>{props.children}</span>;
  } else {
    children = props.children;
  }

  if (isText) {
    return (
      <span
        className={getAppLinkTextClassName(props.className) || undefined}
        title={props.title}
        data-testid={props.dataTestId}
        dir={props.dir}
      >
        {children}
      </span>
    );
  }

  const cursorClassName: string = props.to
    ? "cursor-pointer"
    : "cursor-default";

  /*
   * A click the router would take, to another page, while the page shown
   * holds work nobody has saved (LeaveGuard): the router leaves it alone,
   * and the step waits for the page's answer. A click with a modifier key
   * (a new tab or window) never asks: the page stays where it is.
   */
  const onClick: (event: React.MouseEvent<HTMLAnchorElement>) => void = (
    event: React.MouseEvent<HTMLAnchorElement>,
  ): void => {
    const to: Route | undefined = props.to;

    if (
      to &&
      event.button === 0 &&
      !event.metaKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      LeaveGuard.asksBeforeGoingTo(to.toString())
    ) {
      event.preventDefault();

      LeaveGuard.whenLeaving(to.toString(), () => {
        props.onNavigateComplete?.();
        Navigation.navigate(to);
      });
      return;
    }

    props.onNavigateComplete?.();
  };

  return (
    <Link
      to={props.to?.toString() || ""}
      className={`${cursorClassName} ${props.className || ""}`}
      onClick={onClick}
      title={props.title}
      data-testid={props.dataTestId}
      aria-current={props.isCurrentPage ? "page" : undefined}
      dir={props.dir}
    >
      {children}
    </Link>
  );
};

export default ReactDomLink;
