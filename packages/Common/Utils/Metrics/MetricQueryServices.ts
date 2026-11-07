import Includes from "../../Types/BaseDatabase/Includes";
import MetricQueryConfigData from "../../Types/Metrics/MetricQueryConfigData";

/*
 * A METRIC QUERY READ FOR SOME SERVICES ONLY (issue #6266).
 *
 * A metric row belongs to the telemetry service that sent it
 * (primaryEntityId), a dimension no attribute filter can name. A Metrics
 * monitor limited to some services reads every query for those services
 * only (MonitorStepMetricMonitor.telemetryServiceIds), so a chart of its
 * queries showed every service's series. A query now says which services it
 * reads for (MetricsQuery.telemetryServiceIds); this reads that filter, sets
 * it, and turns it into the query the metric store runs. Pure and safe in
 * the browser.
 */

// One service id as stored and sent: a trimmed string.
const toServiceId: (value: unknown) => string = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  // An ObjectID, say, is its id; a list or a plain map is none.
  if (typeof value === "object" && !Array.isArray(value)) {
    const text: string = String(value);
    return text === "[object Object]" ? "" : text.trim();
  }

  return typeof value === "number" ? String(value) : "";
};

export default class MetricQueryServices {
  /*
   * The services these ids name: each once, in order, without blanks. A
   * value that is not a list names none.
   */
  public static normalize(serviceIds: unknown): Array<string> {
    if (!Array.isArray(serviceIds)) {
      return [];
    }

    const ids: Array<string> = [];

    for (const value of serviceIds) {
      const id: string = toServiceId(value);

      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    }

    return ids;
  }

  // The services a query reads its metric for; none for every service.
  public static getServiceIds(
    queryConfig: MetricQueryConfigData | null | undefined,
  ): Array<string> {
    return MetricQueryServices.normalize(
      queryConfig?.metricQueryData?.filterData?.telemetryServiceIds,
    );
  }

  /*
   * A copy of the query that reads for these services only, or for every
   * service when there are none (the filter is then taken out). The very
   * same query when it already reads for exactly these.
   */
  public static withServiceIds(
    queryConfig: MetricQueryConfigData,
    serviceIds: Array<string> | null | undefined,
  ): MetricQueryConfigData {
    const ids: Array<string> = MetricQueryServices.normalize(serviceIds);
    const filterData: Record<string, unknown> = {
      ...((queryConfig.metricQueryData?.filterData as unknown as
        | Record<string, unknown>
        | undefined) || {}),
    };

    const current: unknown = filterData["telemetryServiceIds"];
    const isUnchanged: boolean =
      ids.length === 0
        ? current === undefined
        : Array.isArray(current) &&
          current.length === ids.length &&
          ids.every((id: string, index: number): boolean => {
            return current[index] === id;
          });

    if (isUnchanged) {
      return queryConfig;
    }

    if (ids.length > 0) {
      filterData["telemetryServiceIds"] = ids;
    } else {
      delete filterData["telemetryServiceIds"];
    }

    return {
      ...queryConfig,
      metricQueryData: {
        ...queryConfig.metricQueryData,
        filterData:
          filterData as unknown as MetricQueryConfigData["metricQueryData"]["filterData"],
      },
    };
  }

  /*
   * The services these queries read for, all together, and the queries
   * without them: what a Metrics monitor made from them keeps on its step
   * (MonitorStepMetricMonitor.telemetryServiceIds), since its worker reads
   * every query for the step's services, never a query's own. Queries that
   * name other services each are read for all of them: no narrower than any
   * query asked for.
   */
  public static takeServiceIds(queryConfigs: Array<MetricQueryConfigData>): {
    queryConfigs: Array<MetricQueryConfigData>;
    serviceIds: Array<string>;
  } {
    const serviceIds: Array<string> = [];

    for (const queryConfig of queryConfigs) {
      for (const serviceId of MetricQueryServices.getServiceIds(queryConfig)) {
        if (!serviceIds.includes(serviceId)) {
          serviceIds.push(serviceId);
        }
      }
    }

    return {
      queryConfigs: queryConfigs.map(
        (queryConfig: MetricQueryConfigData): MetricQueryConfigData => {
          return queryConfig && typeof queryConfig === "object"
            ? MetricQueryServices.withServiceIds(queryConfig, [])
            : queryConfig;
        },
      ),
      serviceIds: serviceIds,
    };
  }

  /*
   * What the metric store reads the query's rows with for its services: the
   * rows' service among them, or nothing when it reads for every service -
   * as the Metrics monitor's worker reads it.
   */
  public static getServiceQuery(
    queryConfig: MetricQueryConfigData | null | undefined,
  ): { primaryEntityId?: Includes } {
    const ids: Array<string> = MetricQueryServices.getServiceIds(queryConfig);

    return ids.length > 0 ? { primaryEntityId: new Includes(ids) } : {};
  }
}
