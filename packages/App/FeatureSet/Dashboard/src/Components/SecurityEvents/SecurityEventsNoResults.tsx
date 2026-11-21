import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EmptyState, {
  EmptyStateSize,
} from "Common/UI/Components/EmptyState/EmptyState";
import { getTimeRangeLabel } from "Common/UI/Components/Date/TimeRangePickerDropdown";
import {
  Translator,
  translatableTerm,
  translateTemplate,
} from "Common/UI/Utils/TranslateTemplate";
import { getTimeRangeCovering } from "./SecurityEventsTimeRange";
import { NO_EVENTS_BUT_REFUSED } from "./RefusedTelemetry/RefusedTelemetryCopy";
import { isPeriodRefused } from "./RefusedTelemetry/RefusedTelemetryModel";
import useProjectRefusedTelemetry from "./RefusedTelemetry/useProjectRefusedTelemetry";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { RefusedTelemetry } from "Common/Utils/SecurityEvent/RefusedTelemetry";

export const SECURITY_EVENTS_NO_RESULTS_ID: string =
  "security-events-no-results";
// What an ingestion budget or rate refused in the window, under the message.
export const SECURITY_EVENTS_NO_RESULTS_REFUSED_ID: string =
  "security-events-no-results-refused";

export interface ComponentProps {
  /*
   * When the project's newest event arrived, if that is known. Leave it unset
   * while it is being looked up (or when the lookup failed): the message then
   * says only what is certain.
   */
  latestEventTime?: Date | undefined;
  // Start of the window on screen.
  windowStartDate: Date;
  /*
   * Its end: what an ingestion budget or rate refused in the window is said
   * under the message (#10431). Left out, the window runs until now.
   */
  windowEndDate?: Date | undefined;
  onShowTimeRange?: ((timeRange: RangeStartAndEndDateTime) => void) | undefined;
}

export function getShowTimeRangeButtonTitle(
  timeRange: RangeStartAndEndDateTime,
): string {
  if (timeRange.range === TimeRange.CUSTOM && timeRange.startAndEndDate) {
    return translateTemplate("Show events since {{date}}", {
      date: OneUptimeDate.getDateAsLocalFormattedString(
        new Date(timeRange.startAndEndDate.startValue),
        true,
      ),
    });
  }

  /*
   * One sentence with the range in it, as the time range picker names the
   * range: "Show past 1 week", "Letzte Woche anzeigen".
   */
  return translateTemplate("Show {{range}}", {
    range: translatableTerm(getTimeRangeLabel(timeRange.range), {
      inSentence: true,
    }),
  });
}

/*
 * The Security Events table with nothing in it, for a project that *does*
 * have events - just none in the window on screen, or none the table's
 * filters let through. SecurityEventsEmptyState is for the project that has
 * never received one; offering its setup guide here would send someone who is
 * already ingesting off to set up ingest.
 *
 * "No security events" over a window in which an ingestion budget or rate
 * refused some of the logs or traces Security Events reads would say nothing
 * happened where it could not look (#10431): it says, under the message,
 * that events from then are missing.
 */
const SecurityEventsNoResults: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const latest: Date | undefined = props.latestEventTime;
  const refusals: Array<RefusedTelemetry> = useProjectRefusedTelemetry();
  const now: Date = OneUptimeDate.getCurrentDate();
  const refusedNote: ReactElement | undefined = isPeriodRefused({
    refusals,
    from: props.windowStartDate,
    to: props.windowEndDate || now,
    now,
  }) ? (
    <p
      className="flex items-start justify-center gap-1.5 text-sm text-amber-800"
      data-testid={SECURITY_EVENTS_NO_RESULTS_REFUSED_ID}
    >
      <Icon
        icon={IconProp.SignalSlash}
        className="mt-0.5 h-4 w-4 flex-none text-amber-600"
      />
      <span className="text-pretty">
        {translator.translateText(NO_EVENTS_BUT_REFUSED) ||
          NO_EVENTS_BUT_REFUSED}
      </span>
    </p>
  ) : undefined;

  // Their newest event is inside the window, so it is the filters that emptied it.
  if (latest && latest.getTime() >= props.windowStartDate.getTime()) {
    return (
      <EmptyState
        id={SECURITY_EVENTS_NO_RESULTS_ID}
        icon={IconProp.Filter}
        size={EmptyStateSize.Inline}
        title="No security events match these filters"
        description="Events have arrived in this time range, but none of them match the filters applied to the table. Clear or loosen a filter to see them."
        footer={refusedNote}
      />
    );
  }

  if (!latest) {
    return (
      <EmptyState
        id={SECURITY_EVENTS_NO_RESULTS_ID}
        icon={IconProp.Search}
        size={EmptyStateSize.Inline}
        title="No security events in this time range"
        description="Try a wider time range, or clear the filters applied to the table."
        footer={refusedNote}
      />
    );
  }

  const coveringRange: RangeStartAndEndDateTime = getTimeRangeCovering(
    latest,
    OneUptimeDate.getCurrentDate(),
  );

  return (
    <EmptyState
      id={SECURITY_EVENTS_NO_RESULTS_ID}
      icon={IconProp.Clock}
      size={EmptyStateSize.Inline}
      title="No security events in this time range"
      description={translateTemplate(
        "The most recent security event arrived {{time}} ({{date}}).",
        {
          time: OneUptimeDate.fromNow(latest),
          date: OneUptimeDate.getDateAsLocalFormattedString(latest),
        },
      )}
      footer={
        props.onShowTimeRange || refusedNote ? (
          <div className="space-y-3">
            {refusedNote}
            {props.onShowTimeRange ? (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Button
                  title={getShowTimeRangeButtonTitle(coveringRange)}
                  icon={IconProp.Clock}
                  buttonStyle={ButtonStyleType.NORMAL}
                  dataTestId={`${SECURITY_EVENTS_NO_RESULTS_ID}-show-range`}
                  onClick={() => {
                    props.onShowTimeRange?.(coveringRange);
                  }}
                />
              </div>
            ) : (
              <></>
            )}
          </div>
        ) : undefined
      }
    />
  );
};

export default SecurityEventsNoResults;
