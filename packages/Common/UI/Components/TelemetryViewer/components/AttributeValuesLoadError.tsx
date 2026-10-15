import React, { FunctionComponent, ReactElement } from "react";
import { Translator, translationKey } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import {
  TelemetryLoadError,
  TelemetryLoadErrorKind,
} from "../../../Utils/Telemetry/TelemetryLoadError";
import AttributeKeySentence from "./AttributeKeySentence";

/*
 * What the `@key:` dropdown says when the values of a key could not be
 * loaded (issue #4708), in place of a spinner that never ends or an empty
 * dropdown that reads as "this key has no values": which key, why in a word
 * (it took too long - a clock, as the explorer's own "took too long" message
 * has - or it failed), that a value can still be typed, and a way to ask
 * again.
 *
 * Try again sits under the sentence, beside the hint, rather than at the far
 * end of the row: the dropdown is as wide as the search box, so on a wide
 * screen the far end is a long way from the words, and on a narrow one a
 * button there squeezes them into a column.
 *
 * Shared by the logs search bar (LogSearchSuggestions) and the other
 * explorers' (TelemetrySearchSuggestions).
 */

export const ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID: string =
  "attribute-values-load-error";
export const ATTRIBUTE_VALUES_RETRY_TEST_ID: string = "attribute-values-retry";

const TIMED_OUT_SENTENCE: string = translationKey(
  "Values for {{key}} took too long to load.",
);
const FAILED_SENTENCE: string = translationKey(
  "Could not load values for {{key}}.",
);

// Said under every `@key:` notice: the dropdown is a shortcut, never a gate.
export const TYPE_A_VALUE_HINT: string = translationKey(
  "You can still type a value and press Enter.",
);

export interface AttributeValuesLoadErrorProps {
  attributeKey: string;
  error: TelemetryLoadError;
  // Asks for the values again. Without it there is no button.
  onRetry?: (() => void) | undefined;
  /*
   * Try again is the dropdown's selected item: the reader moved to it with
   * the down arrow, and Enter presses it. Drawn like a selected suggestion.
   */
  isRetrySelected?: boolean | undefined;
}

const AttributeValuesLoadError: FunctionComponent<
  AttributeValuesLoadErrorProps
> = (props: AttributeValuesLoadErrorProps): ReactElement => {
  const translator: Translator = useTranslator();
  const isTimedOut: boolean =
    props.error.kind === TelemetryLoadErrorKind.TimedOut;

  return (
    <div
      role="status"
      data-testid={ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID}
      data-kind={props.error.kind}
      className="flex items-start gap-2.5 px-3 py-2.5 text-sm"
    >
      <div className="mt-0.5 flex-none">
        <Icon
          icon={isTimedOut ? IconProp.Clock : IconProp.Alert}
          className={`h-4 w-4 ${isTimedOut ? "text-amber-500" : "text-red-500"}`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="break-words text-gray-700">
          <AttributeKeySentence
            template={isTimedOut ? TIMED_OUT_SENTENCE : FAILED_SENTENCE}
            attributeKey={props.attributeKey}
          />
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs text-gray-500">
            {translator.translateText(TYPE_A_VALUE_HINT)}
          </p>
          {props.onRetry && (
            <button
              type="button"
              data-testid={ATTRIBUTE_VALUES_RETRY_TEST_ID}
              data-selected={props.isRetrySelected ? "true" : "false"}
              /*
               * Pressed without taking the focus from the search box, as the
               * suggestions themselves are: the reader goes on typing.
               */
              onMouseDown={(
                event: React.MouseEvent<HTMLButtonElement>,
              ): void => {
                event.preventDefault();
              }}
              onClick={(): void => {
                props.onRetry?.();
              }}
              className={`-mx-1 inline-flex flex-none items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-indigo-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                props.isRetrySelected
                  ? "bg-indigo-50 ring-1 ring-indigo-200"
                  : ""
              }`}
            >
              <Icon icon={IconProp.Refresh} className="h-3 w-3" />
              <span>{translator.translateText("Try again")}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AttributeValuesLoadError;
