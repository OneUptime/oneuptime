import Route from "../../../Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Link as DomLink } from "react-router-dom";

export interface ComponentProps {
  children: ReactElement | Array<ReactElement> | string;
  className?: undefined | string;
  to?: Route;
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
    <DomLink
      to={props.to?.toString() || ""}
      className={`${cursorClassName} ${props.className || ""}`}
    >
      {children}
    </DomLink>
  );
};

export default ReactDomLink;
