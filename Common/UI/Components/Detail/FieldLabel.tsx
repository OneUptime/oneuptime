import Link from "../Link/Link";
import { DetailSideLink } from "./Field";
import React, { FunctionComponent, ReactElement } from "react";

export enum Size {
  Normal = "text-sm",
  Medium = "text-base",
  Large = "text-lg",
}

export interface ComponentProps {
  title?: string | undefined;
  description?: string | ReactElement | undefined;
  alignClassName?: string | undefined;
  sideLink?: DetailSideLink | undefined;
  size?: Size | undefined;
  isCardStyle?: boolean | undefined;
}

const FieldLabelElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isCardStyle: boolean = props.isCardStyle || false;

  return (
    <div className="space-y-0.5">
      {props.title && (
        <label
          className={`${props.size || "text-xs"} font-semibold uppercase tracking-wider ${
            isCardStyle ? "text-gray-500" : "text-gray-400"
          } flex items-center gap-2`}
        >
          <span className={props.alignClassName}>{props.title}</span>
          {props.sideLink && props.sideLink?.text && props.sideLink?.url && (
            <Link
              to={props.sideLink?.url}
              className="text-indigo-500 hover:text-indigo-600 transition-colors duration-150 font-medium normal-case tracking-normal text-xs"
            >
              {props.sideLink?.text}
            </Link>
          )}
        </label>
      )}
      {props.description && (
        <p
          className={`${props.alignClassName} text-xs text-gray-400 leading-relaxed`}
        >
          {props.description}
        </p>
      )}
    </div>
  );
};

export default FieldLabelElement;
