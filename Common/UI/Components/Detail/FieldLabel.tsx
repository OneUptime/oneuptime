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
    <div className="space-y-1">
      {props.title && (
        <label
          className={`${props.size || "text-xs"} font-semibold uppercase tracking-widest ${
            isCardStyle ? "text-gray-500" : "text-gray-500"
          } flex items-center gap-2`}
        >
          <span className={`${props.alignClassName} flex items-center gap-1.5`}>
            <span className="w-1 h-1 rounded-full bg-gray-300"></span>
            {props.title}
          </span>
          {props.sideLink && props.sideLink?.text && props.sideLink?.url && (
            <Link
              to={props.sideLink?.url}
              className="inline-flex items-center gap-1 text-indigo-500 hover:text-indigo-600 transition-all duration-200 font-medium normal-case tracking-normal text-xs hover:underline underline-offset-2"
            >
              {props.sideLink?.text}
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </Link>
          )}
        </label>
      )}
      {props.description && (
        <p
          className={`${props.alignClassName} text-xs text-gray-400 leading-relaxed mt-0.5`}
        >
          {props.description}
        </p>
      )}
    </div>
  );
};

export default FieldLabelElement;
