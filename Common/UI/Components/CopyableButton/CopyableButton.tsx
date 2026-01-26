import Icon, { SizeProp, ThickProp } from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import IconProp from "../../../Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  textToBeCopied: string;
}

const CopyableButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [copiedToClipboard, setCopyToClipboard] = useState<boolean>(false);

  const refreshCopyToClipboardState: VoidFunction = (): void => {
    setCopyToClipboard(true);
    setTimeout(() => {
      setCopyToClipboard(false);
    }, 2000);
  };

  const handleCopy = async (): Promise<void> => {
    refreshCopyToClipboardState();
    await navigator.clipboard?.writeText(props.textToBeCopied);
  };

  const handleKeyDown = async (event: React.KeyboardEvent): Promise<void> => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      await handleCopy();
    }
  };

  return (
    <div
      className={`${
        copiedToClipboard ? "" : "cursor-pointer mt-0.5"
      } flex ml-1 text-gray-500`}
      onClick={handleCopy}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={copiedToClipboard ? "Copied to clipboard" : "Copy to clipboard"}
      aria-live="polite"
    >
      {" "}
      {copiedToClipboard ? (
        "Copied to Clipboard"
      ) : (
        <Tooltip text="Copy to Clipboard">
          <Icon
            className="h-4 w-4"
            data-testid="copy-to-clipboard-icon"
            icon={IconProp.Copy}
            size={SizeProp.Small}
            thick={ThickProp.Thick}
          />
        </Tooltip>
      )}{" "}
    </div>
  );
};

export default CopyableButton;
