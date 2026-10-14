import React, { FunctionComponent, ReactElement } from "react";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import {
  TelemetryLoadError,
  TelemetryLoadErrorKind,
} from "../../../Utils/Telemetry/TelemetryLoadError";

/*
 * What the `@key:` dropdown says when the values of a key could not be
 * loaded (issue #4708), in place of a spinner that never ends or an empty
 * dropdown that reads as "this key has no values": which key, why in a word
 * (it took too long, or it failed), that a value can still be typed, and a
 * way to ask again.
 *
 * Shared by the logs search bar (LogSearchSuggestions) and the other
 * explorers' (TelemetrySearchSuggestions).
 */

export const ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID: string =
  "attribute-values-load-error";
export const ATTRIBUTE_VALUES_RETRY_TEST_ID: string = "attribute-values-retry";

export interface AttributeValuesLoadErrorProps {
  attributeKey: string;
  error: TelemetryLoadError;
  // Asks for the values again. Without it there is no button.
  onRetry?: (() => void) | undefined;
}

const AttributeValuesLoadError: FunctionComponent<
  AttributeValuesLoadErrorProps
> = (props: AttributeValuesLoadErrorProps): ReactElement => {
  const translator: Translator = useTranslator();
  const isTimedOut: boolean =
    props.error.kind === TelemetryLoadErrorKind.TimedOut;

  const title: string = isTimedOut
    ? translator.translateTemplate(
        "Values for {{key}} took too long to load.",
        { key: props.attributeKey },
      )
    : translator.translateTemplate("Could not load values for {{key}}.", {
        key: props.attributeKey,
      });

  return (
    <div
      role="status"
      data-testid={ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID}
      data-kind={props.error.kind}
      className="flex items-start gap-2 px-3 py-2 text-sm"
    >
      <div className="mt-0.5 flex-none">
        <Icon
          icon={IconProp.Alert}
          className={`h-4 w-4 ${isTimedOut ? "text-amber-500" : "text-red-500"}`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="break-words text-gray-700">{title}</p>
        <p className="mt-0.5 text-xs text-gray-500">
          {translator.translateText(
            "You can still type a value and press Enter.",
          )}
        </p>
      </div>
      {props.onRetry && (
        <button
          type="button"
          data-testid={ATTRIBUTE_VALUES_RETRY_TEST_ID}
          /*
           * Pressed without taking the focus from the search box, as the
           * suggestions themselves are: the reader goes on typing.
           */
          onMouseDown={(event: React.MouseEvent<HTMLButtonElement>): void => {
            event.preventDefault();
          }}
          onClick={(): void => {
            props.onRetry?.();
          }}
          className="inline-flex flex-none items-center gap-1 rounded-sm px-1 py-0.5 text-xs font-medium text-indigo-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Icon icon={IconProp.Refresh} className="h-3 w-3" />
          <span>{translator.translateText("Try again")}</span>
        </button>
      )}
    </div>
  );
};

export default AttributeValuesLoadError;
