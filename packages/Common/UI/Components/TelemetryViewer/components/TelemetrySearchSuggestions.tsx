import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import AttributeValuesLoadError from "./AttributeValuesLoadError";
import AttributeValuesEmpty from "./AttributeValuesEmpty";
import { TelemetryLoadError } from "../../../Utils/Telemetry/TelemetryLoadError";

export interface TelemetrySearchSuggestionsProps {
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

const TelemetrySearchSuggestions: FunctionComponent<
  TelemetrySearchSuggestionsProps
> = (props: TelemetrySearchSuggestionsProps): ReactElement => {
  const translator: Translator = useTranslator();
  const visible: Array<string> = props.suggestions.slice(
    0,
    MAX_VISIBLE_SUGGESTIONS,
  );

  return (
    <div
      data-testid={SEARCH_SUGGESTIONS_TEST_ID}
      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
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
          <div className="px-3 py-2 text-sm text-gray-400">
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
                <span className="font-mono text-xs text-gray-400">
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
        <div className="px-3 py-1 text-[11px] text-gray-400">
          {translator.translatePlural(
            { one: "+{{count}} more...", other: "+{{count}} more..." },
            props.suggestions.length - MAX_VISIBLE_SUGGESTIONS,
          )}
        </div>
      )}
    </div>
  );
};

export default TelemetrySearchSuggestions;
