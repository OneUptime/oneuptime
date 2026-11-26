import InBetween from "Common/Types/BaseDatabase/InBetween";
import Dictionary from "Common/Types/Dictionary";
import {
  SECURITY_EVENTS_ARRIVED_AFTER_PARAM,
  SECURITY_EVENTS_ARRIVED_UNTIL_PARAM,
  SECURITY_EVENT_ARRIVAL_QUERY_KEY,
  SecurityEventArrivalRange,
  toSecurityEventArrivalQueryValue,
} from "Common/Types/SecurityEvent/SecurityEventArrival";
import TimeRange from "Common/Types/Time/TimeRange";
import { getTimeRangeButtonLabel } from "Common/UI/Components/Date/TimeRangePickerDropdown";
import { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import { ARRIVED_CHIP_KEY } from "./Hunts/HuntsCopy";

/*
 * THE EVENTS THAT ARRIVED IN A RANGE, AS A CHIP ON EVENTS (#10488).
 *
 * A scheduled hunt counts the events that ARRIVED in its run's window,
 * whenever they happened in the day before, so its notification, its last
 * find and its Run History open its page on exactly those: the run's
 * arrivals, in the address (arrivedAfter, arrivedUntil), become a chip -
 * "Arrived: Nov 20, 10:00 AM – 11:00 AM" - over a time range wide enough to
 * hold every one of them. The list, its chart and its facets read the chip
 * by the condition the run counted with (SecurityEventArrival), so they
 * show what the run counted and nothing else; its x shows everything in the
 * time range again.
 *
 * React-free, so a plain test pins it.
 */

// The chip's field, as the reader reads it: when the events reached OneUptime.
export { ARRIVED_CHIP_KEY };

/*
 * What the chip is to the list's chips: no facet of the sidebar is keyed
 * so, so taking it off never touches a facet's values.
 */
export const SECURITY_EVENTS_ARRIVAL_CHIP_FACET_KEY: string =
  SECURITY_EVENT_ARRIVAL_QUERY_KEY;
export const SECURITY_EVENTS_ARRIVAL_CHIP_VALUE: string = "arrived";

export function isSecurityEventsArrivalChip(facetKey: string): boolean {
  return facetKey === SECURITY_EVENTS_ARRIVAL_CHIP_FACET_KEY;
}

// The chip: its field, and its range as the time range button writes one.
export function getSecurityEventsArrivalChip(
  range: SecurityEventArrivalRange,
): ActiveFilter {
  return {
    facetKey: SECURITY_EVENTS_ARRIVAL_CHIP_FACET_KEY,
    value: SECURITY_EVENTS_ARRIVAL_CHIP_VALUE,
    displayKey: ARRIVED_CHIP_KEY,
    displayValue: getTimeRangeButtonLabel({
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(
        range.arrivedAfter,
        range.arrivedUntil,
      ),
    }),
  };
}

// The address's params for the range, or none: a range taken off leaves the address.
export function getSecurityEventsArrivalParams(
  range: SecurityEventArrivalRange | null,
): Dictionary<string | null> {
  if (!range) {
    return {
      [SECURITY_EVENTS_ARRIVED_AFTER_PARAM]: null,
      [SECURITY_EVENTS_ARRIVED_UNTIL_PARAM]: null,
    };
  }

  const value: { arrivedAfter: string; arrivedUntil: string } =
    toSecurityEventArrivalQueryValue(range);

  return {
    [SECURITY_EVENTS_ARRIVED_AFTER_PARAM]: value.arrivedAfter,
    [SECURITY_EVENTS_ARRIVED_UNTIL_PARAM]: value.arrivedUntil,
  };
}

/*
 * A query with the range on it, under its own key, which the server
 * compiles: nothing the search bar or a chip of the sidebar writes can
 * take it off.
 */
export function applySecurityEventsArrival<T>(
  query: T,
  range: SecurityEventArrivalRange | null,
): T {
  if (!range) {
    return query;
  }

  return {
    ...(query as Record<string, unknown>),
    [SECURITY_EVENT_ARRIVAL_QUERY_KEY]: toSecurityEventArrivalQueryValue(range),
  } as T;
}
