import MetricType from "Common/Models/DatabaseModels/MetricType";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import RecordsById from "Common/UI/Utils/RecordsById";

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
 *
 * These are the reads, and they import no React: the metric loader every
 * page's queries go through (Metrics.ts) reads with them, and the tests
 * that reach it never reach React (FeatureSetImportsStayReactFree). The
 * pickers' hooks are MetricTypeSearch's, which hands these on as well.
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
