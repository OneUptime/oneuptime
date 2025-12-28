import Icon, { SizeProp, ThickProp } from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  text: string;
  isCopyable?: boolean;
}

const HiddenText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showText, setShowText] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy: () => Promise<void> = async (): Promise<void> => {
    await navigator.clipboard?.writeText(props.text);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  if (!showText) {
    return (
      <div
        role="hidden-text"
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer transition-all duration-200 bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:border-gray-300 group"
        onClick={() => {
          setShowText(true);
        }}
      >
        <Icon
          icon={IconProp.Lock}
          size={SizeProp.Small}
          thick={ThickProp.Thick}
          className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-500"
        />
        <span className="text-sm text-gray-500 group-hover:text-gray-600">
          Click to reveal
        </span>
        <Icon
          icon={IconProp.ChevronRight}
          size={SizeProp.Small}
          thick={ThickProp.Thick}
          className="h-3 w-3 text-gray-400 group-hover:text-gray-500 transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md transition-all duration-200 ${
        copied
          ? "bg-green-50 border border-green-200"
          : "bg-amber-50 border border-amber-200"
      }`}
    >
      <Icon
        icon={IconProp.Lock}
        size={SizeProp.Small}
        thick={ThickProp.Thick}
        className={`h-3.5 w-3.5 flex-shrink-0 ${copied ? "text-green-500" : "text-amber-500"}`}
      />
      <code
        role="revealed-text"
        className={`font-mono text-sm break-all ${copied ? "text-green-700" : "text-amber-800"}`}
      >
        {props.text}
      </code>
      <div className="flex items-center gap-1 ml-1 flex-shrink-0">
        {props.isCopyable && (
          <Tooltip text={copied ? "Copied!" : "Copy"}>
            <div
              className={`p-1 rounded cursor-pointer transition-all duration-200 ${
                copied
                  ? "text-green-500"
                  : "text-amber-400 hover:text-amber-600 hover:bg-amber-100"
              }`}
              onClick={handleCopy}
            >
              {copied ? (
                <Icon
                  icon={IconProp.CheckCircle}
                  size={SizeProp.Small}
                  thick={ThickProp.Thick}
                  className="h-3.5 w-3.5"
                />
              ) : (
                <Icon
                  icon={IconProp.Copy}
                  size={SizeProp.Small}
                  thick={ThickProp.Thick}
                  className="h-3.5 w-3.5"
                />
              )}
            </div>
          </Tooltip>
        )}
        <Tooltip text="Hide">
          <div
            className={`p-1 rounded cursor-pointer transition-all duration-200 ${
              copied
                ? "text-green-400 hover:text-green-600 hover:bg-green-100"
                : "text-amber-400 hover:text-amber-600 hover:bg-amber-100"
            }`}
            data-testid="hide-text-icon"
            onClick={() => {
              setShowText(false);
            }}
          >
            <Icon
              icon={IconProp.Hide}
              size={SizeProp.Small}
              thick={ThickProp.Thick}
              className="h-3.5 w-3.5"
            />
          </div>
        </Tooltip>
      </div>
    </div>
  );
};

export default HiddenText;
