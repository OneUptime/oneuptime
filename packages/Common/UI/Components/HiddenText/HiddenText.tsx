import Icon, { SizeProp, ThickProp } from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import IconProp from "../../../Types/Icon/IconProp";
import Clipboard from "../../Utils/Clipboard";
import { Translator } from "../../Utils/TranslateTemplate";
import useClipboardCopy, { ClipboardCopy } from "../../Utils/UseClipboardCopy";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  text: string;
  isCopyable?: boolean;
}

/*
 * A secret (an API key, a client secret) behind "Click to reveal". Its copy
 * button says "Copied!" only once the secret is on the clipboard - it used
 * to say so over an empty clipboard on a plain-http install (issue #5132) -
 * and "Copy failed" otherwise, with the revealed secret selected so it can
 * be copied by hand.
 *
 * Reveal, Copy and Hide are buttons, so a keyboard reaches each and a screen
 * reader names each in the reader's language (#7339). Reveal and Hide used
 * to be clickable boxes nothing could focus: a keyboard could not reveal a
 * secret at all, and Hide had no name. The focus follows the toggle: from
 * the reveal button to the first control of the revealed secret, and from
 * Hide back to the reveal button, never left on a button that is gone.
 *
 * Neither box grows wider than its cell (max-w-full): a long secret wraps
 * inside it, and Copy and Hide stay in sight beside it.
 */
const HiddenText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showText, setShowText] = useState<boolean>(false);
  const clipboard: ClipboardCopy = useClipboardCopy();
  const copied: boolean = clipboard.isCopied;
  const failed: boolean = clipboard.isFailed;
  const revealedTextRef: React.RefObject<HTMLElement> =
    useRef<HTMLElement>(null);
  const rootRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const revealButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const copyButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const hideButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  /*
   * Set when the toggle pressed held the focus: the button drawn in its
   * place takes the focus.
   */
  const isFocusFollowingRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const toggle: (show: boolean) => void = (show: boolean): void => {
    const focused: Element | null = document.activeElement;

    isFocusFollowingRef.current = Boolean(
      focused && rootRef.current?.contains(focused),
    );
    setShowText(show);
  };

  useEffect(() => {
    if (!isFocusFollowingRef.current) {
      return;
    }

    isFocusFollowingRef.current = false;

    if (showText) {
      (copyButtonRef.current || hideButtonRef.current)?.focus();
    } else {
      revealButtonRef.current?.focus();
    }
  }, [showText]);

  const handleCopy: () => Promise<void> = async (): Promise<void> => {
    const hasCopied: boolean = await clipboard.copy(props.text);

    if (!hasCopied) {
      Clipboard.selectForManualCopy(revealedTextRef.current);
    }
  };

  let copyLabel: string = translator.translateText("Copy") || "Copy";
  const hideLabel: string = translator.translateText("Hide") || "Hide";

  if (copied) {
    copyLabel = translator.translateText("Copied!") || "Copied!";
  } else if (failed) {
    copyLabel = translator.translateText("Copy failed") || "Copy failed";
  }

  if (!showText) {
    /*
     * The box keeps role="hidden-text", which tests and the end-to-end specs
     * find the reveal button by; the button inside is what a person presses,
     * and its click reaches the box.
     */
    return (
      <div
        ref={rootRef}
        role="hidden-text"
        className="inline-flex max-w-full"
        onClick={() => {
          toggle(true);
        }}
      >
        <button
          ref={revealButtonRef}
          type="button"
          className="inline-flex max-w-full items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer transition-all duration-200 bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:border-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 group"
          data-testid="hidden-text-reveal"
        >
          <Icon
            icon={IconProp.Lock}
            size={SizeProp.Small}
            thick={ThickProp.Thick}
            className="h-3.5 w-3.5 flex-shrink-0 text-gray-400 group-hover:text-gray-500"
          />
          <span className="text-start text-sm text-gray-500 group-hover:text-gray-600">
            {translator.translateText("Click to reveal")}
          </span>
          <Icon
            icon={IconProp.ChevronRight}
            size={SizeProp.Small}
            thick={ThickProp.Thick}
            className="h-3 w-3 flex-shrink-0 text-gray-400 group-hover:text-gray-500 transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`inline-flex max-w-full items-center gap-2 px-3 py-1.5 rounded-md transition-all duration-200 ${
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
        ref={revealedTextRef}
        role="revealed-text"
        dir="ltr"
        className={`font-mono text-sm break-all ${copied ? "text-green-700" : "text-amber-800"}`}
      >
        {props.text}
      </code>
      <div className="flex items-center gap-1 ml-1 flex-shrink-0">
        {props.isCopyable && (
          <Tooltip
            text={copied ? "Copied!" : failed ? "Copy failed" : "Copy"}
            isShownOnKeyboardFocusOnly={true}
          >
            <button
              ref={copyButtonRef}
              type="button"
              aria-label={copyLabel}
              className={`p-1 rounded cursor-pointer transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                copied
                  ? "text-green-500"
                  : failed
                    ? "text-red-600 hover:bg-amber-100"
                    : "text-amber-400 hover:text-amber-600 hover:bg-amber-100"
              }`}
              data-testid="copy-to-clipboard-icon"
              data-copy-state={clipboard.status}
              onClick={() => {
                void handleCopy();
              }}
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
            </button>
          </Tooltip>
        )}
        <Tooltip text="Hide" isShownOnKeyboardFocusOnly={true}>
          <button
            ref={hideButtonRef}
            type="button"
            aria-label={hideLabel}
            className={`p-1 rounded cursor-pointer transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
              copied
                ? "text-green-400 hover:text-green-600 hover:bg-green-100"
                : "text-amber-400 hover:text-amber-600 hover:bg-amber-100"
            }`}
            data-testid="hide-text-icon"
            onClick={() => {
              toggle(false);
            }}
          >
            <Icon
              icon={IconProp.Hide}
              size={SizeProp.Small}
              thick={ThickProp.Thick}
              className="h-3.5 w-3.5"
            />
          </button>
        </Tooltip>
      </div>
      {/* What the copy did, said to a screen reader. */}
      <span
        className="sr-only"
        role="status"
        data-testid="hidden-text-copy-status"
      >
        {copied || failed ? copyLabel : ""}
      </span>
    </div>
  );
};

export default HiddenText;
