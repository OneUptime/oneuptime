import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  text: string;
  maxLength?: number | undefined;
  className?: string | undefined;
}

const ExpandableText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const maxLength: number = props.maxLength || 80;

  if (!props.text || props.text === "-") {
    return <span className="text-gray-400">-</span>;
  }

  const isLong: boolean = props.text.length > maxLength;
  const baseTextClass: string = props.className || "text-sm text-gray-900";

  if (!isLong) {
    return <span className={baseTextClass}>{props.text}</span>;
  }

  const truncated: string =
    props.text.substring(0, maxLength).replace(/\s+$/u, "") + "…";

  return (
    <span className="inline align-baseline">
      <span className={`${baseTextClass} break-words align-baseline`}>
        {isExpanded ? props.text : truncated}
      </span>
      <button
        type="button"
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}
        aria-expanded={isExpanded}
        className="ml-2 inline-flex items-center gap-1 align-baseline rounded text-xs font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-colors"
      >
        <span>{isExpanded ? "Show less" : "Show more"}</span>
        <svg
          className={`w-3 h-3 transition-transform duration-200 ${
            isExpanded ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.25}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
    </span>
  );
};

export default ExpandableText;
