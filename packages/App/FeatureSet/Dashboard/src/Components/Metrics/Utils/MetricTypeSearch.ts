import MetricTypeSearch, {
  METRIC_TYPE_SEARCH_DEBOUNCE_MS,
  METRIC_TYPE_SEARCH_LIMIT,
  METRIC_TYPE_SELECT,
} from "./MetricTypeReads";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import { MutableRefObject, useEffect, useRef, useState } from "react";

/*
 * The metric pickers' hooks (#10646). The reads they run are MetricTypeReads,
 * which imports no React, so the metric loader every page's queries go
 * through can read with them and keep React out of the tests that reach it.
 * They are handed on from here too, so a picker imports one module.
 */
export {
  METRIC_TYPE_SEARCH_DEBOUNCE_MS,
  METRIC_TYPE_SEARCH_LIMIT,
  METRIC_TYPE_SELECT,
};
export default MetricTypeSearch;

/*
 * The metrics a page's queries chart that its list does not have, read by
 * their names as the queries change (#10691): a dashboard or the Metrics
 * explorer read the project's first 10,000 by name, and a charted metric
 * past them had no unit, no kind of counter and no attributes. Each name
 * is asked for once - never one the page's own load asked for already
 * (`asked`: loadAllMetricsTypes' metricNames) - and `onRead` hands the
 * page what was found, to merge into its list. `isEnabled` false (a public
 * dashboard, whose metrics its own route reads) asks nothing.
 */
export function useMetricTypesHeldIn(data: {
  holder: unknown;
  known: Array<MetricType>;
  onRead: (found: Array<MetricType>) => void;
  asked?: Array<string> | undefined;
  isEnabled?: boolean | undefined;
}): void {
  const askedRef: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );
  const isEnabled: boolean = data.isEnabled !== false;
  const known: Set<string> = new Set<string>([
    ...data.known.map((metric: MetricType): string => {
      return metric.name || "";
    }),
    ...(data.asked || []),
  ]);
  const missing: Array<string> = isEnabled
    ? MetricTypeSearch.getMetricNamesIn(data.holder).filter(
        (name: string): boolean => {
          return !known.has(name) && !askedRef.current.has(name);
        },
      )
    : [];
  const missingKey: string = [...missing].sort().join("\n");

  useEffect(() => {
    if (!missingKey) {
      return;
    }

    const names: Array<string> = missingKey.split("\n");

    for (const name of names) {
      askedRef.current.add(name);
    }

    MetricTypeSearch.readByNames(names)
      .then((found: Array<MetricType>) => {
        if (found.length > 0) {
          data.onRead(found);
        }
      })
      .catch(() => {
        // Unknown still: the queries chart them without a unit.
      });
  }, [missingKey]);
}

export interface MetricTypeSearchState {
  // What the newest search found.
  found: Array<MetricType>;
  // Hand the picker's onSearchTextChange this.
  onSearchTextChange: (text: string) => void;
}

/*
 * The search a picker runs as it is typed in: debounced, the newest answer
 * winning, nothing asked for an empty box. `isEnabled` false (a public
 * dashboard, which reads no metric list of its own) asks nothing.
 */
export function useMetricTypeSearch(
  isEnabled: boolean = true,
): MetricTypeSearchState {
  const [found, setFound] = useState<Array<MetricType>>([]);
  const timerRef: MutableRefObject<number | null> = useRef<number | null>(null);
  const sequenceRef: MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const onSearchTextChange: (text: string) => void = (text: string): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }

    if (!isEnabled || !text.trim()) {
      return;
    }

    const sequence: number = ++sequenceRef.current;

    timerRef.current = window.setTimeout(() => {
      MetricTypeSearch.search(text)
        .then((metrics: Array<MetricType>) => {
          if (sequence === sequenceRef.current) {
            setFound(metrics);
          }
        })
        .catch(() => {
          // The list read already is still offered.
        });
    }, METRIC_TYPE_SEARCH_DEBOUNCE_MS);
  };

  return { found, onSearchTextChange };
}

/*
 * The metric a picker holds, when the list it read does not have it: read
 * by its name, so its unit and its kind of counter are known. Undefined
 * while it is read, or when the list has it.
 */
export function useHeldMetricType(data: {
  name: string;
  known: Array<MetricType>;
  isEnabled?: boolean | undefined;
}): MetricType | undefined {
  const [held, setHeld] = useState<MetricType | undefined>(undefined);
  const isKnown: boolean = data.known.some((metric: MetricType): boolean => {
    return metric.name === data.name;
  });
  const isEnabled: boolean = data.isEnabled !== false;

  useEffect(() => {
    let isCurrent: boolean = true;

    if (!data.name || isKnown || !isEnabled) {
      setHeld(undefined);
      return;
    }

    MetricTypeSearch.readByName(data.name)
      .then((metric: MetricType | null) => {
        if (isCurrent) {
          setHeld(metric || undefined);
        }
      })
      .catch(() => {
        // Unknown: the picker still shows the name it holds.
      });

    return () => {
      isCurrent = false;
    };
  }, [data.name, isKnown, isEnabled]);

  return held;
}
