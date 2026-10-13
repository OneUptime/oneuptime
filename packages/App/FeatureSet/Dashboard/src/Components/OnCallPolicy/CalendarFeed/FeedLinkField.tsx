import { MaskedFeedLink, maskFeedLink } from "./CalendarFeedUtil";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Clipboard from "Common/UI/Utils/Clipboard";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * A calendar link as one read-only field: the link, Show / Hide, and Copy
 * link, side by side the way a password field and its eye sit together.
 *
 * The URL IS the credential - anyone who has it can read the shifts - so it
 * is hidden until the reader asks: the field shows the server's address and
 * dots ending in the four characters the status names ("link ending in
 * …k3Qx"), never more of the token. Copy link copies the https link without
 * showing it. Shown, the link is a real read-only input, selected on focus,
 * so it can be copied by hand as well.
 *
 * A browser that will not let the page write to the clipboard (a self-hosted
 * install reached over plain http, a locked-down frame) used to fail
 * silently. Then the field shows the link, selected, and says to copy it
 * with the keyboard - the one way left that always works.
 */
export interface ComponentProps {
  // The https link - the secret.
  url: string;
  // The last four characters of the token, which the page already shows.
  tokenHint?: string | null | undefined;
  // Prefix for the data-testids, so two fields on one page stay distinct.
  idPrefix: string;
}

// How long "Copied!" stays on the button.
export const COPIED_FEEDBACK_MILLISECONDS: number = 2000;

type CopyState = "idle" | "copied" | "blocked";

const FeedLinkField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isRevealed, setIsRevealed] = useState<boolean>(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const inputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * A new link - after Regenerate link - starts hidden again: the reader
   * revealed the old one, not this one.
   */
  useEffect(() => {
    setIsRevealed(false);
    setCopyState("idle");
  }, [props.url]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  // Selected as soon as the link is shown because copying was blocked.
  useEffect(() => {
    if (isRevealed && copyState === "blocked" && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRevealed, copyState]);

  const copy: () => Promise<void> = async (): Promise<void> => {
    const isCopied: boolean = await Clipboard.copyToClipboard(props.url);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!isCopied) {
      setCopyState("blocked");
      setIsRevealed(true);
      return;
    }

    setCopyState("copied");
    timerRef.current = setTimeout(() => {
      setCopyState("idle");
      timerRef.current = null;
    }, COPIED_FEEDBACK_MILLISECONDS);
  };

  const isCopied: boolean = copyState === "copied";
  const masked: MaskedFeedLink = maskFeedLink(props.url, props.tokenHint);

  return (
    <div className="space-y-2">
      <div
        className="flex w-full min-w-0 items-stretch rounded-md border border-gray-300 bg-white shadow-sm"
        data-testid={`${props.idPrefix}-copy`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 pl-3 pr-2">
          <Icon
            icon={IconProp.Lock}
            className="h-4 w-4 flex-none text-gray-400"
          />
          {isRevealed ? (
            <input
              ref={inputRef}
              type="text"
              readOnly={true}
              value={props.url}
              aria-label={translator.translateText("Calendar link")}
              data-testid={`${props.idPrefix}-link-value`}
              spellCheck={false}
              onFocus={(event: React.FocusEvent<HTMLInputElement>) => {
                event.currentTarget.select();
              }}
              className="min-w-0 flex-1 border-0 bg-transparent px-0 py-2 font-mono text-sm text-gray-900 focus:outline-none focus:ring-0"
            />
          ) : (
            <div
              className="relative flex min-w-0 flex-1 items-center py-2 font-mono text-sm text-gray-500 select-none"
              data-testid={`${props.idPrefix}-link-masked`}
            >
              <span className="sr-only">
                {translator.translateText("Calendar link, hidden")}
              </span>
              <span className="min-w-0 truncate font-mono" aria-hidden="true">
                {masked.address}
              </span>
              <span
                className="flex-none font-mono text-gray-400"
                aria-hidden="true"
              >
                {masked.secret}
              </span>
            </div>
          )}
        </div>
        <button
          type="button"
          aria-pressed={isRevealed}
          aria-label={translator.translateText(
            isRevealed ? "Hide link" : "Show link",
          )}
          title={translator.translateText(
            isRevealed ? "Hide link" : "Show link",
          )}
          data-testid={`${props.idPrefix}-reveal`}
          onClick={() => {
            setIsRevealed(!isRevealed);
            setCopyState("idle");
          }}
          className="flex flex-none items-center gap-1.5 border-l border-gray-300 px-3 text-sm font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
        >
          <Icon
            icon={isRevealed ? IconProp.EyeSlash : IconProp.Eye}
            className="h-4 w-4 flex-none"
          />
          <span className="max-sm:sr-only">
            {translator.translateText(isRevealed ? "Hide" : "Show")}
          </span>
        </button>
        <button
          type="button"
          title={translator.translateText("Copy https link")}
          data-testid={`${props.idPrefix}-copy-button`}
          onClick={() => {
            copy().catch(() => {
              // copy routes every failure into the blocked state.
            });
          }}
          className={`flex flex-none items-center gap-1.5 rounded-r-md border-l border-gray-300 px-3 text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
            isCopied
              ? "bg-emerald-50 text-emerald-700"
              : "bg-gray-50 text-gray-700 hover:bg-gray-100"
          }`}
        >
          <Icon
            icon={isCopied ? IconProp.Check : IconProp.Copy}
            className="h-4 w-4 flex-none"
          />
          <span>
            {translator.translateText(isCopied ? "Copied!" : "Copy link")}
          </span>
        </button>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {isCopied ? translator.translateText("Link copied.") : ""}
      </div>
      {copyState === "blocked" && (
        <p
          className="text-xs leading-5 text-amber-700"
          data-testid={`${props.idPrefix}-copy-blocked`}
        >
          {translator.translateText(
            "This browser did not let the page copy the link, so it is shown and selected above. Copy it with Ctrl+C, or Cmd+C on a Mac.",
          )}
        </p>
      )}
    </div>
  );
};

export default FeedLinkField;
