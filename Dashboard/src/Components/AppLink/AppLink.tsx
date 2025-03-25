import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Link } from "react-router-dom";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement> | string;
  className?: undefined | string;
  to?: Route;
  onNavigateComplete?: (() => void) | undefined;
}

const ReactDomLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let children: ReactElement | Array<ReactElement>;

  if (typeof props.children === "string") {
    children = <span>{props.children}</span>;
  } else {
    children = props.children;
  }

  const cursorClassName: string = props.to
    ? "cursor-pointer"
    : "cursor-default";

  return (
    <Link
      to={props.to?.toString() || ""}
      className={`${cursorClassName} ${props.className || ""}`}
      onClick={props.onNavigateComplete}
    >
      {children}
    </Link>
  );
};

export default ReactDomLink;
