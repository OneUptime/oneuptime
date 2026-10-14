import React, { FunctionComponent, ReactElement } from "react";
import { Translator, translationKey } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import {
  TelemetryLoadError,
  TelemetryLoadErrorKind,
} from "../../../Utils/Telemetry/TelemetryLoadError";

/*
 * What a telemetry explorer shows where its results would be when the read
 * behind them did not come back (issue #4707): a search stopped at the query
 * time limit says it took too long and what to try; any other failure says
 * what the server said. Never a modal and never the whole page — the search
 * bar, the time range and the filters stay where they are, so the reader can
 * narrow the search — and one click tries it again.
 *
 *   - "list": the list or chart area of an explorer, a centred block.
 *   - "chart": inside a chart card's plot area, two short lines.
 *   - "note": the facet sidebar's counts, a small tinted note.
 */
export type TelemetryLoadErrorVariant = "list" | "chart" | "note";

// What the read was for, which names it in the title.
export type TelemetryLoadErrorSubject = "search" | "chart" | "counts";

export const TELEMETRY_LOAD_ERROR_TEST_ID: string = "telemetry-load-error";
export const TELEMETRY_LOAD_ERROR_RETRY_TEST_ID: string =
  "telemetry-load-error-retry";

const TIMED_OUT_TITLE: Record<TelemetryLoadErrorSubject, string> = {
  search: translationKey("This search took too long"),
  chart: translationKey("This chart took too long to load"),
  counts: translationKey("Filter counts took too long"),
};

const FAILED_TITLE: Record<TelemetryLoadErrorSubject, string> = {
  search: translationKey("This search could not finish"),
  chart: translationKey("This chart could not load"),
  counts: translationKey("Filter counts could not load"),
};

const TIMED_OUT_ADVICE: Record<TelemetryLoadErrorSubject, string> = {
  search: translationKey(
    "It was stopped before it finished. Try a shorter time range or more specific filters.",
  ),
  chart: translationKey(
    "It was stopped before it finished. Try a shorter time range or more specific filters.",
  ),
  counts: translationKey("Try a shorter time range or more specific filters."),
};

const FAILED_FALLBACK: string = translationKey(
  "Something went wrong. Try again in a moment.",
);

const RETRY_LABEL: string = translationKey("Try again");

export interface TelemetryLoadErrorMessageProps {
  error: TelemetryLoadError;
  subject?: TelemetryLoadErrorSubject | undefined;
  variant?: TelemetryLoadErrorVariant | undefined;
  // Runs the read again. Without it there is no button.
  onRetry?: (() => void) | undefined;
}

const TelemetryLoadErrorMessage: FunctionComponent<
  TelemetryLoadErrorMessageProps
> = (props: TelemetryLoadErrorMessageProps): ReactElement => {
  const translator: Translator = useTranslator();
  const subject: TelemetryLoadErrorSubject = props.subject || "search";
  const variant: TelemetryLoadErrorVariant = props.variant || "list";
  const isTimedOut: boolean =
    props.error.kind === TelemetryLoadErrorKind.TimedOut;

  const title: string =
    translator.translateText(
      isTimedOut ? TIMED_OUT_TITLE[subject] : FAILED_TITLE[subject],
    ) || "";

  /*
   * A time limit is explained in the reader's language. Any other failure
   * is the server's own sentence, which is the only one that knows what
   * went wrong.
   */
  const description: string = isTimedOut
    ? translator.translateText(TIMED_OUT_ADVICE[subject]) || ""
    : props.error.message || translator.translateText(FAILED_FALLBACK) || "";

  const retryLabel: string = translator.translateText(RETRY_LABEL) || "";

  if (variant === "note") {
    return (
      <div
        role="status"
        data-testid={TELEMETRY_LOAD_ERROR_TEST_ID}
        data-kind={props.error.kind}
        className={`mx-2 my-2 rounded-md px-2.5 py-2 text-[11px] leading-4 ${
          isTimedOut ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"
        }`}
      >
        <p className="font-medium">{title}</p>
        <p className="mt-0.5">{description}</p>
        {props.onRetry && (
          <button
            type="button"
            data-testid={TELEMETRY_LOAD_ERROR_RETRY_TEST_ID}
            className="mt-1.5 inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline"
            onClick={props.onRetry}
          >
            <Icon icon={IconProp.Refresh} className="h-3 w-3" />
            <span>{retryLabel}</span>
          </button>
        )}
      </div>
    );
  }

  const isChart: boolean = variant === "chart";

  return (
    <div
      role="alert"
      data-testid={TELEMETRY_LOAD_ERROR_TEST_ID}
      data-kind={props.error.kind}
      className={`flex flex-col items-center justify-center text-center ${
        isChart ? "gap-1.5 px-4 py-4" : "gap-3 px-6 py-12"
      }`}
    >
      {!isChart && (
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-full ${
            isTimedOut ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"
          }`}
        >
          <Icon
            icon={isTimedOut ? IconProp.Clock : IconProp.Alert}
            className="h-5 w-5"
          />
        </div>
      )}
      <div className={isChart ? "space-y-0.5" : "space-y-1"}>
        <p
          className={`font-semibold text-gray-900 ${
            isChart ? "text-xs" : "text-sm"
          }`}
        >
          {title}
        </p>
        <p
          className={`mx-auto max-w-md text-gray-500 ${
            isChart ? "text-xs" : "text-sm"
          }`}
        >
          {description}
        </p>
      </div>
      {props.onRetry && (
        <button
          type="button"
          data-testid={TELEMETRY_LOAD_ERROR_RETRY_TEST_ID}
          className={`inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 ${
            isChart
              ? "mt-1 px-2 py-1 text-[11px]"
              : "mt-1 px-2.5 py-1.5 text-xs"
          }`}
          onClick={props.onRetry}
        >
          <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
          <span>{retryLabel}</span>
        </button>
      )}
    </div>
  );
};

export default TelemetryLoadErrorMessage;
