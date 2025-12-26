import "highlight.js/styles/a11y-dark.css";
import React, { FunctionComponent, ReactElement, useState } from "react";
import Highlight from "react-highlight";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";

export interface ComponentProps {
  code: string | ReactElement;
  language: string;
  maxHeight?: string | undefined;
  showCopyButton?: boolean | undefined;
}

const CodeBlock: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy: () => void = (): void => {
    if (typeof props.code === "string") {
      navigator.clipboard.writeText(props.code).catch(() => {
        /* ignore clipboard errors */
      });
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    }
  };

  const maxHeight: string = props.maxHeight || "500px";
  const showCopyButton: boolean = props.showCopyButton !== false;

  return (
    <div className="relative group">
      {showCopyButton && typeof props.code === "string" && (
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 p-2 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-all opacity-0 group-hover:opacity-100 z-10"
          title={copied ? "Copied!" : "Copy to clipboard"}
          type="button"
        >
          <Icon
            icon={copied ? IconProp.Check : IconProp.Copy}
            className="h-4 w-4"
          />
        </button>
      )}
      <div
        className="overflow-auto rounded-lg border border-gray-700"
        style={{ maxHeight: maxHeight }}
      >
        <Highlight
          className={`p-4 language-${props.language} text-sm leading-relaxed`}
        >
          {props.code}
        </Highlight>
      </div>
    </div>
  );
};

export default CodeBlock;
