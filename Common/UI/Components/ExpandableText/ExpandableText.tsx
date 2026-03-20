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

  if (!isLong) {
    return (
      <span className={props.className || "text-gray-600"}>{props.text}</span>
    );
  }

  return (
    <span className={props.className || "text-gray-600"}>
      {isExpanded ? props.text : props.text.substring(0, maxLength) + "..."}
      <button
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}
        className="ml-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
      >
        {isExpanded ? "Less" : "More"}
      </button>
    </span>
  );
};

export default ExpandableText;
