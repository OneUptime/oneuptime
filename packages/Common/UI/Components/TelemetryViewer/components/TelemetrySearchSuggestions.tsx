import React, { FunctionComponent, ReactElement, RefObject } from "react";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import AttributeValuesLoadError from "./AttributeValuesLoadError";
import AttributeValuesEmpty from "./AttributeValuesEmpty";
import { TelemetryLoadError } from "../../../Utils/Telemetry/TelemetryLoadError";
import LayeredPopover, {
  LAYERED_POPOVER_AS_WIDE_AS_ANCHOR_CLASS_NAME,
} from "../../Tooltip/LayeredPopover";

export interface TelemetrySearchSuggestionsProps {
  /*
   * The search box the list hangs from, as wide as it: the list is drawn
   * on the tooltip layer against it (LayeredPopover), so a drawer or a card
   * the search sits in never cuts it off (#9909).
   */
  anchorRef: RefObject<HTMLElement | null>;
  /*
   * The list's id, for the search's aria-owns: a screen reader still reads
   * the list right after the search, where it was drawn before.
   */
  id?: string | undefined;
  suggestions: Array<string>;
  selectedIndex: number;
  onSelect: (suggestion: string) => void;
  fieldContext?: string | undefined;
  /*
   * When true, items are attribute keys (rendered with the @ prefix).
   * When false, items are top-level field names (no prefix).
   */
  isAttributeMode?: boolean | undefined;
  isLoading?: boolean | undefined;
  /*
   * Shown beside the spinner, already in the reader's language (the search
   * bar draws the key of "Loading values for <key>..." in monospace).
   */
  loadingMessage?: React.ReactNode | undefined;
  emptyMessage?: string | undefined;
  /*
   * The values of `fieldContext` could not be loaded: said in place of the
   * list, with Try again when `onRetryValues` is given (issue #4708).
   */
  valuesError?: TelemetryLoadError | undefined;
  onRetryValues?: (() => void) | undefined;
  // Try again is selected with the down arrow: Enter presses it.
  isRetrySelected?: boolean | undefined;
  /*
   * The lookup of `fieldContext`'s values came back with none: said in
   * place of the list, instead of the dropdown vanishing.
   */
  hasNoValues?: boolean | undefined;
}

const MAX_VISIBLE_SUGGESTIONS: number = 8;

// The dropdown under the search box, for tests that read what it offers.
export const SEARCH_SUGGESTIONS_TEST_ID: string = "search-suggestions";
// Its loading line ("Loading values for <key>...").
export const SEARCH_SUGGESTIONS_LOADING_TEST_ID: string =
  "search-suggestions-loading";

/*
 * The list's own look: as wide as its search box, as it was while it hung
 * from edge to edge of it in place, at most 14rem tall, scrolling inside.
 */
export const SEARCH_SUGGESTIONS_CLASS_NAME: string = `${LAYERED_POPOVER_AS_WIDE_AS_ANCHOR_CLASS_NAME} max-w-[calc(100vw-1rem)] max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg`;

/*
 * The explorers' and the logs search's suggestions: a combobox's list. The
 * focus stays in the search, whose keys move through it (the selected
 * index) and close it; a press on a suggestion keeps the focus there
 * (preventDefault) and picks it. Drawn on the tooltip layer as the popup of
 * its field (LayeredPopover's isFieldPopup), which leaves Tab, Escape and a
 * press to the search, as they were while the list was drawn in place.
 */
const TelemetrySearchSuggestions: FunctionComponent<
  TelemetrySearchSuggestionsProps
> = (props: TelemetrySearchSuggestionsProps): ReactElement => {
  const translator: Translator = useTranslator();
  const visible: Array<string> = props.suggestions.slice(
    0,
    MAX_VISIBLE_SUGGESTIONS,
  );

  return (
    <LayeredPopover anchorRef={props.anchorRef} isFieldPopup={true}>
      <div
        id={props.id}
        data-testid={SEARCH_SUGGESTIONS_TEST_ID}
        className={SEARCH_SUGGESTIONS_CLASS_NAME}
      >
        {/*
         * Spinner and words where the could-not-load and no-values rows put
         * their icon and sentence, so the sentence does not jump when the
         * line turns into one of them - and wraps as theirs does, a long key
         * included, instead of running out of the dropdown.
         */}
        {props.isLoading && (
          <div
            data-testid={SEARCH_SUGGESTIONS_LOADING_TEST_ID}
            className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm text-gray-500"
          >
            <svg
              className="mt-0.5 h-4 w-4 flex-none animate-spin text-indigo-500"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              ></path>
            </svg>
            <span className="min-w-0 break-words">
              {props.loadingMessage || translator.translateText("Loading...")}
            </span>
          </div>
        )}
        {!props.isLoading && props.valuesError && props.fieldContext && (
          <AttributeValuesLoadError
            attributeKey={props.fieldContext}
            error={props.valuesError}
            onRetry={props.onRetryValues}
            isRetrySelected={props.isRetrySelected}
          />
        )}
        {!props.isLoading &&
          !props.valuesError &&
          props.hasNoValues &&
          props.fieldContext && (
            <AttributeValuesEmpty attributeKey={props.fieldContext} />
          )}
        {!props.isLoading &&
          !props.valuesError &&
          !props.hasNoValues &&
          visible.length === 0 &&
          props.emptyMessage !== undefined && (
            <div className="px-3 py-2 text-sm text-gray-500">
              {props.emptyMessage}
            </div>
          )}
        {visible.map((suggestion: string, index: number) => {
          const isSelected: boolean = index === props.selectedIndex;

          return (
            <button
              key={suggestion}
              type="button"
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                isSelected
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
              onMouseDown={(e: React.MouseEvent) => {
                e.preventDefault();
                props.onSelect(suggestion);
              }}
            >
              {props.fieldContext ? (
                <>
                  <span className="font-mono text-xs text-gray-500">
                    {props.fieldContext}:
                  </span>
                  <span className="font-mono">{suggestion}</span>
                </>
              ) : props.isAttributeMode ? (
                <>
                  <span className="font-mono text-xs text-indigo-400">@</span>
                  <span className="font-mono">{suggestion}</span>
                </>
              ) : (
                <span className="font-mono">{suggestion}</span>
              )}
            </button>
          );
        })}
        {props.suggestions.length > MAX_VISIBLE_SUGGESTIONS && (
          <div className="px-3 py-1 text-xs text-gray-500">
            {translator.translatePlural(
              { one: "+{{count}} more...", other: "+{{count}} more..." },
              props.suggestions.length - MAX_VISIBLE_SUGGESTIONS,
            )}
          </div>
        )}
      </div>
    </LayeredPopover>
  );
};

export default TelemetrySearchSuggestions;
