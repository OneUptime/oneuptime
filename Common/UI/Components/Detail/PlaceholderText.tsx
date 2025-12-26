import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  text: string;
}

const PlaceholderText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <span className="inline-flex items-center gap-1.5 text-gray-400 italic text-sm select-none px-2 py-0.5 rounded-md bg-gray-50 border border-dashed border-gray-200">
      <svg
        className="w-3.5 h-3.5 text-gray-300"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M20 12H4"
        />
      </svg>
      {props.text}
    </span>
  );
};

export default PlaceholderText;
