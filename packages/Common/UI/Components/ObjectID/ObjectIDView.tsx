import Icon, { SizeProp, ThickProp } from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import IconProp from "../../../Types/Icon/IconProp";
import Clipboard from "../../Utils/Clipboard";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * An ID drawn as a field: the whole ID in a pill, copied on a click. A
 * details card draws a record's own ID on its small ID line instead
 * (Detail/DetailIdLine.tsx); this is for the IDs that stay fields - a card
 * whose point is the ID, or an ID that is not the record's own.
 */

export interface ComponentProps {
  objectId: string;
}

const COPIED_FEEDBACK_MS: number = 2000;

const ObjectIDView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [copied, setCopied] = useState<boolean>(false);
  const resetTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleCopy: () => Promise<void> = async (): Promise<void> => {
    /*
     * A refused or missing clipboard (a plain-http self-hosted install, an
     * unfocused document) used to say "Copied!" all the same.
     */
    const hasCopied: boolean = await Clipboard.copyToClipboard(props.objectId);

    if (!hasCopied) {
      return;
    }

    setCopied(true);

    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }

    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;
      setCopied(false);
    }, COPIED_FEEDBACK_MS);
  };

  return (
    <div
      className="inline-flex items-center gap-2 group/objectid cursor-pointer"
      onClick={handleCopy}
      role="button"
      tabIndex={0}
      onKeyDown={async (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          // Space would otherwise scroll the page as well.
          e.preventDefault();
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
