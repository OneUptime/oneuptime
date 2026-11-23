import MetricType from "Common/Models/DatabaseModels/MetricType";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import RecordsById from "Common/UI/Utils/RecordsById";
import { MutableRefObject, useEffect, useRef, useState } from "react";

/*
 * A PROJECT'S METRIC NAMES, SEARCHED ON THE SERVER (#10646).
 *
 * The metric pickers - a metric query's (Metrics, dashboards, a metric
 * monitor's step) and an SLO's - offered the project's first metric names
 * by name, read once: 10,000 for a query, 500 for an SLO. One Kubernetes
 * cluster sends more names than that. A metric past the list could not be
 * found, and one a query already charted showed as no metric at all.
 *
 * What is typed into a picker is asked of the server, 50 by name, and what
 * it finds is offered beside the list it read; a metric a query holds that
 * the list does not have is read by its name, so it is named, with its
 * unit and its kind of counter.
 */

export const METRIC_TYPE_SEARCH_LIMIT: number = 50;
export const METRIC_TYPE_SEARCH_DEBOUNCE_MS: number = 250;

// What a picker reads of a metric: its name, unit and kind of counter.
export const METRIC_TYPE_SELECT: Record<string, true> = {
  name: true,
  unit: true,
  isMonotonic: true,
  aggregationTemporality: true,
};

export default class MetricTypeSearch {
  // The project's metrics whose name holds the text, 50 by name.
  public static async search(text: string): Promise<Array<MetricType>> {
    const trimmed: string = text.trim();

    if (!trimmed) {
      return [];
    }

    const result: ListResult<MetricType> = await ModelAPI.getList<MetricType>({
      modelType: MetricType,
      query: { name: new Search(trimmed) } as never,
      select: METRIC_TYPE_SELECT as never,
      sort: { name: SortOrder.Ascending },
      limit: METRIC_TYPE_SEARCH_LIMIT,
      skip: 0,
    });

    return result.data || [];
  }

  // The metric of one name, read by it; null when the project has none.
  public static async readByName(name: string): Promise<MetricType | null> {
    if (!name.trim()) {
      return null;
    }

    const result: ListResult<MetricType> = await ModelAPI.getList<MetricType>({
      modelType: MetricType,
      query: { name: name } as never,
      select: METRIC_TYPE_SELECT as never,
      sort: {},
      limit: 1,
      skip: 0,
    });

    return result.data[0] || null;
  }

  /*
   * The metrics of these names, read by them however they sort (#10691):
   * the ones a page's queries chart that its first read of the list did
   * not have. A name the project has no metric of is left out.
   */
  public static async readByNames(
    names: Array<string>,
  ): Promise<Array<MetricType>> {
    const wanted: Array<string> = Array.from(
      new Set(
        names
          .map((name: string): string => {
            return name.trim();
          })
          .filter((name: string): boolean => {
            return Boolean(name);
          }),
      ),
    );

    if (wanted.length === 0) {
      return [];
    }

    return await RecordsById.read<MetricType>({
      modelType: MetricType,
      ids: wanted,
      column: "name",
      select: METRIC_TYPE_SELECT as never,
    });
  }

  /*
   * Every metric name a page's queries hold, wherever it is kept: a query
   * config's filterData, a dashboard widget's arguments, a table's columns.
   */
  public static getMetricNamesIn(value: unknown): Array<string> {
    const names: Set<string> = new Set<string>();
    const seen: Set<unknown> = new Set<unknown>();

    const walk: (node: unknown) => void = (node: unknown): void => {
      if (!node || typeof node !== "object" || seen.has(node)) {
        return;
      }

      seen.add(node);

      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item);
        }

        return;
      }

      for (const [key, child] of Object.entries(
        node as Record<string, unknown>,
      )) {
        if (key === "metricName" && typeof child === "string") {
          if (child.trim()) {
            names.add(child.trim());
          }

          continue;
        }

        walk(child);
      }
    };

    walk(value);

    return Array.from(names);
  }

  // Each metric once, by its name, the ones read later added in name order.
  public static merge(
    known: Array<MetricType>,
    read: Array<MetricType>,
  ): Array<MetricType> {
    const names: Set<string> = new Set<string>(
      known.map((metric: MetricType): string => {
        return metric.name || "";
      }),
    );
    const added: Array<MetricType> = read.filter(
      (metric: MetricType): boolean => {
        return Boolean(metric.name) && !names.has(metric.name!);
      },
    );

    if (added.length === 0) {
      return known;
    }

    return [...known, ...added].sort((a: MetricType, b: MetricType): number => {
      return (a.name || "").localeCompare(b.name || "");
    });
  }
}

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
