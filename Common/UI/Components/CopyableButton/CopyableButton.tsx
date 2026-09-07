import Icon, { SizeProp, ThickProp } from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  textToBeCopied: string;
}

type CopyState = "idle" | "copying" | "copied" | "failed" | "unavailable";

const CopyableButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const requestId: React.MutableRefObject<number> = useRef<number>(0);
  const isCopying: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const resetTimer: React.MutableRefObject<
    ReturnType<typeof setTimeout> | undefined
  > = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setCopyState("idle");
    isCopying.current = false;

    return () => {
      // Ignore a pending write when its value changes or the button unmounts.
      requestId.current += 1;
      clearTimeout(resetTimer.current);
    };
  }, [props.textToBeCopied]);

  const handleCopy: () => Promise<void> = async (): Promise<void> => {
    if (isCopying.current) {
      return;
    }

    clearTimeout(resetTimer.current);
    const currentRequest: number = ++requestId.current;

    if (typeof navigator.clipboard?.writeText !== "function") {
      setCopyState("unavailable");
      return;
    }

    isCopying.current = true;
    setCopyState("copying");

    try {
      await navigator.clipboard.writeText(props.textToBeCopied);

      if (currentRequest !== requestId.current) {
        return;
      }

      setCopyState("copied");
      resetTimer.current = setTimeout(() => {
        setCopyState("idle");
      }, 2000);
    } catch {
      if (currentRequest === requestId.current) {
        setCopyState("failed");
      }
    } finally {
      if (currentRequest === requestId.current) {
        isCopying.current = false;
      }
    }
  };

  const messages: Record<CopyState, string> = {
    idle: "Copy to clipboard",
    copying: "Copying...",
    copied: "Copied to clipboard",
    failed: "Copy failed. Try again.",
    unavailable: "Copy unavailable. Select and copy the text.",
  };
  const message: string =
    translateString(messages[copyState]) || messages[copyState];
  const hasError: boolean =
    copyState === "failed" || copyState === "unavailable";

  return (
    <span className="ml-1 inline-flex items-center">
      <Tooltip text={message}>
        <button
          type="button"
          className={`inline-flex items-center rounded p-0.5 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-wait ${
            hasError ? "text-red-600" : "text-gray-500"
          }`}
          onClick={handleCopy}
          disabled={copyState === "copying"}
          aria-label={message}
          aria-busy={copyState === "copying"}
        >
          {copyState === "idle" ? (
            <Icon
              className="h-4 w-4"
              data-testid="copy-to-clipboard-icon"
              icon={IconProp.Copy}
              size={SizeProp.Small}
              thick={ThickProp.Thick}
            />
          ) : (
            message
          )}
        </button>
      </Tooltip>
      <span role="status" aria-live="polite" className="sr-only">
        {copyState === "idle" ? "" : message}
      </span>
    </span>
  );
};

export default CopyableButton;
