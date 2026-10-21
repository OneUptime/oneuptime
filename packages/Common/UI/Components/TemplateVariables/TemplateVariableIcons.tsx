/*
 * The two small icons the template variable pickers draw inside a <summary>
 * and a <span>. They are bare <svg>s: the shared Icon component wraps its
 * svg in a <div>, which is not allowed inside either.
 */

import React, { FunctionComponent, ReactElement } from "react";

export interface TemplateVariableIconProps {
  className?: string | undefined;
}

export const SearchIcon: FunctionComponent<TemplateVariableIconProps> = (
  props: TemplateVariableIconProps,
): ReactElement => {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={props.className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  );
};

export const ChevronDownIcon: FunctionComponent<TemplateVariableIconProps> = (
  props: TemplateVariableIconProps,
): ReactElement => {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={props.className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m19.5 8.25-7.5 7.5-7.5-7.5"
      />
    </svg>
  );
};
