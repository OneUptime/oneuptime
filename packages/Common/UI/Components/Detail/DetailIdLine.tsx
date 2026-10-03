import Icon from "../Icon/Icon";
import Tooltip from "../Tooltip/Tooltip";
import IconProp from "../../../Types/Icon/IconProp";
import Clipboard from "../../Utils/Clipboard";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import {
  RECORD_ID_COPIED_FEEDBACK_MS,
  SHORT_RECORD_ID_LENGTH,
  SHORT_RECORD_ID_WIDTH,
} from "./DetailRecordId";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The record's own ID, under a details card's fields: "ID", the first
 * characters of it and a copy button - in place of the full-width field it
 * used to be, often the first one on the page (see DetailRecordId.ts).
 *
 *   - The whole ID is the element's text, clipped to its first group and
 *     an ellipsis. So a copy, a select-all (one click selects it all) and
 *     the browser's find-in-page all see the full ID, and so does a screen
 *     reader.
 *   - Hovering the ID shows all of it. Clicking it copies it, as clicking
 *     the old ID pill did; the button beside it copies it too, and is what a
 *     keyboard reaches.
 *   - A copy the browser refuses says so instead of showing a tick, and
 *     unclips the ID so it can be read, selected and copied by hand.
 *   - The icon is the ID card "Show ID" wears in every table's ⋯ menu, so an
 *     ID looks the same wherever it is offered.
 */

export interface ComponentProps {
  recordId: string;
  className?: string | undefined;
}

enum CopyState {
  Idle = "idle",
  Copied = "copied",
  Failed = "failed",
}

const DetailIdLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [copyState, setCopyState] = useState<CopyState>(CopyState.Idle);

  const resetTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const recordIdRef: React.MutableRefObject<string> = useRef<string>(
    props.recordId,
  );

  type ClearResetTimerFunction = () => void;

  const clearResetTimer: ClearResetTimerFunction = (): void => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  };

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      clearResetTimer();
    };
  }, []);

  /*
   * The page moved to another record without remounting the card: what was
   * said about the last one's ID is not true of this one.
   */
  useEffect(() => {
    recordIdRef.current = props.recordId;
    clearResetTimer();
    setCopyState(CopyState.Idle);
  }, [props.recordId]);

  type CopyFunction = () => Promise<void>;

  const copy: CopyFunction = async (): Promise<void> => {
    const recordId: string = props.recordId;
    const hasCopied: boolean = await Clipboard.copyToClipboard(recordId);

    // Unmounted, or already showing another record, while the copy ran.
    if (!isMountedRef.current || recordIdRef.current !== recordId) {
      return;
    }

    clearResetTimer();

    if (!hasCopied) {
      setCopyState(CopyState.Failed);
      return;
    }

    setCopyState(CopyState.Copied);
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;

      if (isMountedRef.current) {
        setCopyState(CopyState.Idle);
      }
    }, RECORD_ID_COPIED_FEEDBACK_MS);
  };

  const isCopied: boolean = copyState === CopyState.Copied;
  const isFailed: boolean = copyState === CopyState.Failed;

  const isClipped: boolean =
    !isFailed && props.recordId.length > SHORT_RECORD_ID_LENGTH;

  /*
   * The ID and its ellipsis each name font-mono themselves: the Dashboard's
   * index.ejs sets Inter on `*`, which beats a font inherited from a parent.
   */
  const value: ReactElement = (
    <span
      data-testid="detail-id-value-wrapper"
      className="inline-flex min-w-0 cursor-pointer items-baseline text-gray-600 hover:text-gray-900"
      onClick={() => {
        void copy();
      }}
    >
      <code
        data-testid="detail-id-value"
        className={`min-w-0 select-all font-mono ${
          isFailed
            ? "whitespace-normal break-all"
            : "overflow-hidden whitespace-nowrap"
        }`}
        style={isFailed ? undefined : { maxWidth: SHORT_RECORD_ID_WIDTH }}
      >
        {props.recordId}
      </code>
      {isClipped ? (
        <span
          aria-hidden="true"
          data-testid="detail-id-ellipsis"
          className="font-mono"
        >
          …
        </span>
      ) : (
        <></>
      )}
    </span>
  );

  let statusText: string = "";

  if (isCopied) {
    statusText = translator.translateText("Copied to clipboard") || "";
  } else if (isFailed) {
    statusText = translator.translateText("Copy failed") || "";
  }

  return (
    <div
      data-testid="detail-id-line"
      className={`flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500 ${
        props.className || ""
      }`}
    >
      <div className="inline-flex shrink-0 items-center gap-1.5 font-medium">
        <Icon
          icon={IconProp.Identification}
          className="h-3.5 w-3.5 text-gray-400"
        />
        <span data-testid="detail-id-label">
          {translator.translateText("ID")}
        </span>
      </div>

      {/* Once unclipped, the ID itself is what there is to read. */}
      {isFailed ? value : <Tooltip text={props.recordId}>{value}</Tooltip>}

      <Tooltip
        text={isCopied ? "Copied!" : "Copy ID to clipboard"}
        // The button's own name already says it.
        isTriggerAlreadyDescribed={true}
      >
        <button
          type="button"
          data-testid="detail-id-copy"
          aria-label={translator.translateText("Copy ID to clipboard")}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          onClick={() => {
            void copy();
          }}
        >
          <Icon
            icon={isCopied ? IconProp.Check : IconProp.Copy}
            className={`h-3.5 w-3.5 ${isCopied ? "text-emerald-600" : ""}`}
          />
        </button>
      </Tooltip>

      {/*
       * Said to a screen reader either way; a failure is shown as well,
       * since the tick it replaces would otherwise be the only signal.
       */}
      <span
        role="status"
        data-testid="detail-id-status"
        className={isFailed ? "text-red-600" : "sr-only"}
      >
        {statusText}
      </span>
    </div>
  );
};

export default DetailIdLine;
