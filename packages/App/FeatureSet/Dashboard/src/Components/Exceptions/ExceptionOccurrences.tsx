import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import IconProp from "Common/Types/Icon/IconProp";
import { ExceptionSpanScope } from "Common/Types/Telemetry/ExceptionSpanScope";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import { getExceptionSpansDefaultTimeRange } from "../../Utils/ExceptionDetailPresentation";
import TracesViewer from "../Traces/TracesViewer";
import ExceptionSegmentedControl from "./ExceptionSegmentedControl";
import OccouranceTable from "./OccuranceTable";

export enum ExceptionOccurrencesView {
  Spans = "spans",
  Details = "details",
}

export interface ComponentProps {
  exception: TelemetryException;
  // Occurrences page always has a fingerprint; the explorer guards for it.
  fingerprint: string;
}

/*
 * The exception's Occurrences page. "Spans" is the Traces explorer — search,
 * facets, histogram, span details — scoped server-side to exactly the spans
 * this exception was raised in. "Occurrence details" keeps the per-occurrence
 * table (release, environment, logs and replay links) for what a span row
 * does not carry.
 */
const ExceptionOccurrences: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [view, setView] = useState<ExceptionOccurrencesView>(
    ExceptionOccurrencesView.Spans,
  );
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    (): RangeStartAndEndDateTime => {
      return {
        range: getExceptionSpansDefaultTimeRange(props.exception.lastSeenAt),
      };
    },
  );

  const primaryEntityId: string | undefined =
    props.exception.primaryEntityId?.toString();

  const exceptionScope: ExceptionSpanScope = useMemo(() => {
    return {
      fingerprint: props.fingerprint,
      ...(primaryEntityId ? { primaryEntityId } : {}),
    };
  }, [props.fingerprint, primaryEntityId]);

  return (
    <div data-testid="exception-occurrences">
      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm md:flex-row md:items-center md:px-6">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50">
            <Icon
              icon={
                view === ExceptionOccurrencesView.Spans
                  ? IconProp.Waterfall
                  : IconProp.List
              }
              className="h-5 w-5 text-indigo-600"
            />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">
              {view === ExceptionOccurrencesView.Spans
                ? "Spans that raised this exception"
                : "Occurrence details"}
            </h2>
            <p
              className="mt-0.5 text-sm text-gray-600"
              data-testid="exception-occurrences-description"
            >
              {view === ExceptionOccurrencesView.Spans
                ? "Search, filter and chart every span this exception was recorded in. Open a span to see its whole trace."
                : "Each recorded occurrence with its release, environment, and links to its logs and session replay."}
            </p>
          </div>
        </div>
        <ExceptionSegmentedControl<ExceptionOccurrencesView>
          label="Occurrences view"
          testId="exception-occurrences-view"
          value={view}
          onChange={setView}
          options={[
            { value: ExceptionOccurrencesView.Spans, label: "Spans" },
            {
              value: ExceptionOccurrencesView.Details,
              label: "Occurrence details",
            },
          ]}
        />
      </div>

      {view === ExceptionOccurrencesView.Spans ? (
        <TracesViewer
          exceptionScope={exceptionScope}
          exceptionScopeLabel={
            props.exception.exceptionType || "This exception"
          }
          {...(props.exception.primaryEntityId
            ? {
                primaryEntityId: props.exception.primaryEntityId,
                ...(props.exception.primaryEntityType
                  ? { scopeEntityType: props.exception.primaryEntityType }
                  : {}),
              }
            : {})}
          // The exception page owns the URL; the window is lifted to keep it.
          disableUrlSync={true}
          timeRangeOverride={timeRange}
          onTimeRangeChange={setTimeRange}
          limit={25}
          emptyMessage="No spans raised this exception in the selected time range. Exceptions captured from logs have no span; try a longer time range or the Occurrence details view."
        />
      ) : (
        <OccouranceTable
          exceptionFingerprint={props.fingerprint}
          primaryEntityId={props.exception.primaryEntityId}
        />
      )}
    </div>
  );
};

export default ExceptionOccurrences;
