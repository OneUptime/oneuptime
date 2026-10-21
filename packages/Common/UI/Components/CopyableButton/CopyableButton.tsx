import Icon, { SizeProp, ThickProp } from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator } from "../../Utils/TranslateTemplate";
import useClipboardCopy, { ClipboardCopy } from "../../Utils/UseClipboardCopy";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  textToBeCopied: string;
}

/*
 * The copy icon beside a copyable value (a details card's field, a JSON
 * table's cell). It says "Copied to Clipboard" once the text is there - it
 * used to say so before even trying, so a plain-http page, where the
 * clipboard API is missing, showed it over an empty clipboard (issue #5132) -
 * and "Copy failed" when the browser refused.
 */
const CopyableButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const clipboard: ClipboardCopy = useClipboardCopy();

  const handleCopy: () => Promise<void> = async (): Promise<void> => {
    await clipboard.copy(props.textToBeCopied);
  };

  const handleKeyDown: (event: React.KeyboardEvent) => Promise<void> = async (
    event: React.KeyboardEvent,
  ): Promise<void> => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      await handleCopy();
    }
  };

  let ariaLabel: string =
    translator.translateText("Copy to clipboard") || "Copy to clipboard";
  // Clickable again after a failure, to try once more.
  let stateClassName: string = "cursor-pointer mt-0.5";

  if (clipboard.isCopied) {
    ariaLabel =
      translator.translateText("Copied to clipboard") || "Copied to clipboard";
    stateClassName = "";
  } else if (clipboard.isFailed) {
    ariaLabel = translator.translateText("Copy failed") || "Copy failed";
    stateClassName = "cursor-pointer";
  }

  let content: ReactElement | string = (
    /*
     * The tooltip holds on to an element of its own: Icon is a function
     * component that takes no ref, so handed the Icon the tooltip never
     * showed (React warned "Function components cannot be given refs").
     */
    <Tooltip text="Copy to Clipboard">
      <div className="flex">
        <Icon
          className="h-4 w-4"
          data-testid="copy-to-clipboard-icon"
          icon={IconProp.Copy}
          size={SizeProp.Small}
          thick={ThickProp.Thick}
        />
      </div>
    </Tooltip>
  );

  if (clipboard.isCopied) {
    content =
      translator.translateText("Copied to Clipboard") || "Copied to Clipboard";
  } else if (clipboard.isFailed) {
    content = (
      <span
        className="inline-flex items-center gap-1 text-red-600"
        data-testid="copy-to-clipboard-failed"
      >
        <Icon
          className="h-4 w-4"
          icon={IconProp.Alert}
          size={SizeProp.Small}
          thick={ThickProp.Thick}
        />
        {translator.translateText("Copy failed")}
      </span>
    );
  }

  return (
    <div
      className={`${stateClassName} flex ml-1 text-gray-500`}
      onClick={handleCopy}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-live="polite"
      data-copy-state={clipboard.status}
    >
      {" "}
      {content}{" "}
    </div>
  );
};

export default CopyableButton;
