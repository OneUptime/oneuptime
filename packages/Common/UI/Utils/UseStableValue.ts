import { useMemo } from "react";

/*
 * `value`, with the identity it had the last time its value changed.
 *
 * Pages hand components objects that hold the same thing again on every
 * render: `serviceIds={[modelId]}`, an ObjectID read from the URL in the
 * render, a stored query re-read on every background refresh of an incident
 * page, a list that answered with the same rows. Anything a component keys on
 * the identity of such a value - a memoized query, a fetch callback, an
 * effect - runs again although nothing changed, and on a telemetry explorer
 * that sends its list, chart and facet reads out again (issue #4709). Read
 * through this, they run only when the value does.
 *
 * "The same value" is the same JSON. The query operators (Includes,
 * InBetween, Search, ...) and ObjectID serialize with their type, and Dates as
 * ISO strings, so two values that would build the same request compare equal
 * and two that would not, do not. Functions do not serialize: pass data only.
 */
export function getStableValueKey(value: unknown): string {
  if (value === undefined) {
    // JSON.stringify(undefined) is undefined, not a string.
    return "undefined";
  }

  return JSON.stringify(value);
}

export default function useStableValue<T>(value: T): T {
  const key: string = getStableValueKey(value);

  /*
   * Keyed on the serialization alone, on purpose: an equal value handed over
   * again must come back as the object first handed over.
   */
  return useMemo((): T => {
    return value;
  }, [key]);
}
