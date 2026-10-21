import Icon, { SizeProp, ThickProp } from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import IconProp from "../../../Types/Icon/IconProp";
import Clipboard from "../../Utils/Clipboard";
import { Translator } from "../../Utils/TranslateTemplate";
import useClipboardCopy, {
  ClipboardCopy,
} from "../../Utils/UseClipboardCopy";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useRef } from "react";

/*
 * An ID drawn as a field: the whole ID in a pill, copied on a click. A
 * details card draws a record's own ID on its small ID line instead
 * (Detail/DetailIdLine.tsx); this is for the IDs that stay fields - a card
 * whose point is the ID, or an ID that is not the record's own.
 *
 * "Copied!" only once the ID is on the clipboard. A refused or missing
 * clipboard (a plain-http self-hosted install, an unfocused document) used
 * to say "Copied!" all the same, then to say nothing at all; it says "Copy
 * failed" now, and the ID is selected so it can be copied by hand.
 */

export interface ComponentProps {
  objectId: string;
}

const ObjectIDView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const clipboard: ClipboardCopy = useClipboardCopy();
  const copied: boolean = clipboard.isCopied;
  const failed: boolean = clipboard.isFailed;
  const idRef: React.RefObject<HTMLElement> = useRef<HTMLElement>(null);

  const handleCopy: () => Promise<void> = async (): Promise<void> => {
    const hasCopied: boolean = await clipboard.copy(props.objectId);

    if (!hasCopied) {
      Clipboard.selectForManualCopy(idRef.current);
    }
  };

  let pillClassName: string =
    "bg-gray-50 border border-gray-200 text-gray-700 hover:bg-gray-100 hover:border-gray-300";
  let iconClassName: string = "text-gray-400 group-hover/objectid:text-gray-600";

  if (copied) {
    pillClassName = "bg-green-50 border border-green-200 text-green-700";
    iconClassName = "text-green-500";
  } else if (failed) {
    pillClassName = "bg-red-50 border border-red-200 text-gray-700";
    iconClassName = "text-red-600";
  }

  return (
    <div
      className="inline-flex items-center gap-2 group/objectid cursor-pointer"
      onClick={handleCopy}
      role="button"
      tabIndex={0}
      // Named by the ID alone: the status below is said, not part of it.
      aria-label={props.objectId}
      data-copy-state={clipboard.status}
      onKeyDown={async (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          // Space would otherwise scroll the page as well.
          e.preventDefault();
          await handleCopy();
        }
      }}
    >
      <Tooltip
        text={copied ? "Copied!" : failed ? "Copy failed" : "Click to copy"}
      >
        <div
          className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md font-mono text-sm transition-all duration-200 ${pillClassName}`}
        >
          <code ref={idRef} className="break-all">
            {props.objectId}
          </code>
          <div
            className={`flex-shrink-0 transition-all duration-200 ${iconClassName}`}
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
                icon={failed ? IconProp.Alert : IconProp.Copy}
                size={SizeProp.Small}
                thick={ThickProp.Thick}
                className="h-3.5 w-3.5"
              />
            )}
          </div>
        </div>
      </Tooltip>
      {/* What the copy did, said to a screen reader. */}
      <span className="sr-only" role="status">
        {copied
          ? translator.translateText("Copied!")
          : failed
            ? translator.translateText("Copy failed")
            : ""}
      </span>
    </div>
  );
};

export default ObjectIDView;
