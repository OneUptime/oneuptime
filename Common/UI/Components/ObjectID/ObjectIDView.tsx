import Icon, { SizeProp, ThickProp } from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  objectId: string;
}

const ObjectIDView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy: () => Promise<void> = async (): Promise<void> => {
    await navigator.clipboard?.writeText(props.objectId);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div
      className="inline-flex items-center gap-2 group/objectid cursor-pointer"
      onClick={handleCopy}
      role="button"
      tabIndex={0}
      onKeyDown={async (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          await handleCopy();
        }
      }}
    >
      <Tooltip text={copied ? "Copied!" : "Click to copy"}>
        <div
          className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md font-mono text-sm transition-all duration-200 ${
            copied
              ? "bg-green-50 border border-green-200 text-green-700"
              : "bg-gray-50 border border-gray-200 text-gray-700 hover:bg-gray-100 hover:border-gray-300"
          }`}
        >
          <code className="break-all">{props.objectId}</code>
          <div
            className={`flex-shrink-0 transition-all duration-200 ${
              copied
                ? "text-green-500"
                : "text-gray-400 group-hover/objectid:text-gray-600"
            }`}
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
        </div>
      </Tooltip>
    </div>
  );
};

export default ObjectIDView;
