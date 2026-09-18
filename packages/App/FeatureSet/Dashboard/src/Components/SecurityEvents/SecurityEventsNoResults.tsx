import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import { getTimeRangeCovering } from "./SecurityEventsTimeRange";

export const SECURITY_EVENTS_NO_RESULTS_ID: string =
  "security-events-no-results";

export interface ComponentProps {
  /*
   * When the project's newest event arrived, if that is known. Leave it unset
   * while it is being looked up (or when the lookup failed): the message then
   * says only what is certain.
   */
  latestEventTime?: Date | undefined;
  // Start of the window on screen.
  windowStartDate: Date;
  onShowTimeRange?: ((timeRange: RangeStartAndEndDateTime) => void) | undefined;
}

export function getShowTimeRangeButtonTitle(
  timeRange: RangeStartAndEndDateTime,
): string {
  if (timeRange.range === TimeRange.CUSTOM && timeRange.startAndEndDate) {
    return `Show events since ${OneUptimeDate.getDateAsLocalFormattedString(
      new Date(timeRange.startAndEndDate.startValue),
      true,
    )}`;
  }

  return `Show ${timeRange.range.toLowerCase()}`;
}

/*
 * The Security Events table with nothing in it, for a project that *does*
 * have events - just none in the window on screen, or none the table's
 * filters let through. SecurityEventsEmptyState is for the project that has
 * never received one; offering its setup guide here would send someone who is
 * already ingesting off to set up ingest.
 */
const SecurityEventsNoResults: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const latest: Date | undefined = props.latestEventTime;

  // Their newest event is inside the window, so it is the filters that emptied it.
  if (latest && latest.getTime() >= props.windowStartDate.getTime()) {
    return (
      <EmptyState
        id={SECURITY_EVENTS_NO_RESULTS_ID}
        icon={IconProp.Filter}
        paddingClassName="py-4"
        title="No security events match these filters"
        description="Events have arrived in this time range, but none of them match the filters applied to the table. Clear or loosen a filter to see them."
      />
    );
  }

  if (!latest) {
    return (
      <EmptyState
        id={SECURITY_EVENTS_NO_RESULTS_ID}
        icon={IconProp.Search}
        paddingClassName="py-4"
        title="No security events in this time range"
        description="Try a wider time range, or clear the filters applied to the table."
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
      paddingClassName="py-4"
      title="No security events in this time range"
      description={`The most recent security event arrived ${OneUptimeDate.fromNow(
        latest,
      )} (${OneUptimeDate.getDateAsLocalFormattedString(latest)}).`}
      footer={
        props.onShowTimeRange ? (
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              title={getShowTimeRangeButtonTitle(coveringRange)}
              icon={IconProp.Clock}
              buttonStyle={ButtonStyleType.NORMAL}
              className="md:!ml-0"
              dataTestId={`${SECURITY_EVENTS_NO_RESULTS_ID}-show-range`}
              onClick={() => {
                props.onShowTimeRange?.(coveringRange);
              }}
            />
          </div>
        ) : undefined
      }
    />
  );
};

export default SecurityEventsNoResults;
