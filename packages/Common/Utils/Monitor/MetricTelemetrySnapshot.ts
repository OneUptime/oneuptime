import Dictionary from "../../Types/Dictionary";
import JSONFunctions from "../../Types/JSONFunctions";
import MetricQueryConfigData from "../../Types/Metrics/MetricQueryConfigData";
import MetricMonitorResponse from "../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import { TelemetryQuery } from "../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../Types/Telemetry/TelemetryType";
import MonitorStepMetricQueries from "./MonitorStepMetricQueries";

/*
 * WHAT AN INCIDENT OR ALERT KEEPS OF A METRIC CHECK (issue #6265).
 *
 * When a metric monitor opens an incident or alert, the event keeps a
 * snapshot of what the check read, and its metric card charts it. That used
 * to be the step's queries as the step keeps them: a metric name and the
 * filters someone wrote. But an infrastructure monitor (Host, Kubernetes,
 * Proxmox, ...) reads every query narrowed to the resource it watches - its
 * cluster, host, vCenter, array or fleet, and its resource filters - so the
 * card of a Proxmox monitor's incident charted the metric for every cluster
 * in the project.
 *
 * The worker says what it read each query with
 * (MetricMonitorResponse.queryAttributes): the query's own filters and the
 * scope it added. The snapshot now keeps each query with those, and says so
 * (TelemetryQuery.metricQueriesAsRead), so the card charts what the monitor
 * evaluated, and a snapshot stored before can be told apart.
 *
 * Operators the worker reads with (a Docker Swarm image glob and an IoT
 * fleet are a Wildcard, Swarm's tasks-only filter a NotNull) are kept as
 * they are: the event's JSON column stores them as their {_type, value}
 * JSON, and the dashboard reads them back into the same operators
 * (JSONFunctions.deserialize). The pods a Kubernetes check leaves out
 * because they finished in its window are not part of what it says it read
 * (that list only describes that window), so a snapshot does not keep them
 * either.
 *
 * Pure: the monitor pipeline and its tests build the snapshot the same way.
 */

type Attributes = Dictionary<unknown>;

// A query's own attribute filters, or none when they are not a map.
const getOwnAttributes: (queryConfig: MetricQueryConfigData) => Attributes = (
  queryConfig: MetricQueryConfigData,
): Attributes => {
  const attributes: unknown =
    queryConfig.metricQueryData?.filterData?.attributes;

  if (
    !attributes ||
    typeof attributes !== "object" ||
    Array.isArray(attributes)
  ) {
    return {};
  }

  return attributes as Attributes;
};

// The filters a query was read with, or none when the worker read it with none.
const getReadAttributes: (read: unknown) => Attributes = (
  read: unknown,
): Attributes => {
  if (!read || typeof read !== "object" || Array.isArray(read)) {
    return {};
  }

  return read as Attributes;
};

export default class MetricTelemetrySnapshot {
  /*
   * The event's snapshot of a metric check: the window it read, its
   * queries each with what it was read with (see getReadQueryConfigs), and
   * its formulas. A response that does not say what it read its queries
   * with keeps them as the step does, and is not marked as read.
   */
  public static fromResponse(response: MetricMonitorResponse): TelemetryQuery {
    const queryConfigs: Array<MetricQueryConfigData> =
      response.metricViewConfig.queryConfigs;

    const readQueryConfigs: Array<MetricQueryConfigData> | null =
      MetricTelemetrySnapshot.getReadQueryConfigs({
        queryConfigs: queryConfigs,
        queryAttributes: response.queryAttributes,
      });

    return {
      telemetryQuery: null,
      telemetryType: TelemetryType.Metric,
      metricViewData: {
        startAndEndDate: response.startAndEndDate || null,
        queryConfigs: readQueryConfigs || queryConfigs,
        formulaConfigs: response.metricViewConfig.formulaConfigs,
      },
      ...(readQueryConfigs ? { metricQueriesAsRead: true } : {}),
    };
  }

  /*
   * Each query with the attribute filters the worker read it with in place
   * of its own (queryAttributes, in query order: its own and the scope the
   * monitor added). A query read with exactly its own filters - every query
   * of a Metrics monitor - is kept as it is, the same object. Null when the
   * reads do not say what each query was read with: none were given, or
   * not one for each query.
   */
  public static getReadQueryConfigs(input: {
    queryConfigs: Array<MetricQueryConfigData> | null | undefined;
    queryAttributes: Array<Dictionary<unknown> | undefined> | null | undefined;
  }): Array<MetricQueryConfigData> | null {
    const queryConfigs: unknown = input.queryConfigs;
    const queryAttributes: unknown = input.queryAttributes;

    if (
      !Array.isArray(queryConfigs) ||
      !Array.isArray(queryAttributes) ||
      queryAttributes.length !== queryConfigs.length
    ) {
      return null;
    }

    return (queryConfigs as Array<MetricQueryConfigData>).map(
      (queryConfig: MetricQueryConfigData, index: number) => {
        if (!queryConfig || typeof queryConfig !== "object") {
          return queryConfig;
        }

        const read: Attributes = getReadAttributes(queryAttributes[index]);

        if (JSONFunctions.deepEqual(getOwnAttributes(queryConfig), read)) {
          return queryConfig;
        }

        return MonitorStepMetricQueries.withAttributes(
          queryConfig,
          Object.keys(read).length > 0 ? { ...read } : undefined,
        );
      },
    );
  }

  // Whether a stored snapshot's queries are as its monitor read them.
  public static isAsRead(
    telemetryQuery: TelemetryQuery | null | undefined,
  ): boolean {
    return Boolean(
      telemetryQuery &&
        telemetryQuery.telemetryType === TelemetryType.Metric &&
        telemetryQuery.metricQueriesAsRead === true,
    );
  }
}
