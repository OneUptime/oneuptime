import Dictionary from "../../Types/Dictionary";
import JSONFunctions from "../../Types/JSONFunctions";
import MetricQueryConfigData from "../../Types/Metrics/MetricQueryConfigData";
import MetricMonitorResponse from "../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import { TelemetryQuery } from "../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../Types/Telemetry/TelemetryType";
import MetricQueryServices from "../Metrics/MetricQueryServices";
import MonitorStepMetricQueries from "./MonitorStepMetricQueries";

/*
 * WHAT AN INCIDENT OR ALERT KEEPS OF A METRIC CHECK (issue #6265).
 *
 * When a metric monitor opens an incident or alert, the event keeps a
 * snapshot of what the check read, and its metric card charts it. That was
 * the step's queries as the step keeps them: a metric name and the filters
 * someone wrote. But an infrastructure monitor (Host, Kubernetes, Proxmox,
 * ...) reads every query narrowed to the resource it watches - its cluster,
 * host, vCenter, array or fleet, and its resource filters - so the card of
 * a Proxmox monitor's incident charted the metric for every cluster in the
 * project.
 *
 * The worker says what it read each query with
 * (MetricMonitorResponse.queryAttributes): the query's own filters and the
 * ones it added. The snapshot now keeps, beside each query, the filters the
 * monitor added (TelemetryQuery.metricQueryScopes), and the card charts the
 * query with them (applyScopes).
 *
 * Kept beside the queries, not in them: the event's Logs, Traces and
 * Exceptions tabs take the metric queries' own equality filters as their
 * scope (TelemetryCompanionSignals), and most of what an infrastructure
 * monitor adds are labels only its metrics carry (a Proxmox `pve.id`, a
 * Ceph daemon, a container runtime, a vCenter's name): carried to the logs,
 * they would match none, and the tab would say nothing was logged.
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
 * Pure: the monitor pipeline, the event's card and their tests read it the
 * same way.
 */

type Attributes = Dictionary<unknown>;

// A map of attribute filters, or none when it is not one.
const asAttributes: (value: unknown) => Attributes = (
  value: unknown,
): Attributes => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Attributes;
};

const getOwnAttributes: (queryConfig: MetricQueryConfigData) => Attributes = (
  queryConfig: MetricQueryConfigData,
): Attributes => {
  return asAttributes(queryConfig.metricQueryData?.filterData?.attributes);
};

export default class MetricTelemetrySnapshot {
  /*
   * The event's snapshot of a metric check: the window it read, its queries
   * and formulas as the step keeps them, and beside each query the filters
   * the monitor added to it (see getQueryScopes). A response that does not
   * say what it read its queries with keeps no scopes, as before.
   */
  public static fromResponse(response: MetricMonitorResponse): TelemetryQuery {
    const queryConfigs: Array<MetricQueryConfigData> =
      response.metricViewConfig.queryConfigs;

    const scopes: Array<Attributes | null> | null =
      MetricTelemetrySnapshot.getQueryScopes({
        queryConfigs: queryConfigs,
        queryAttributes: response.queryAttributes,
      });

    // A Metrics monitor limited to some services read every query for them.
    const serviceIds: Array<string> = MetricQueryServices.normalize(
      response.queryServiceIds,
    );

    return {
      telemetryQuery: null,
      telemetryType: TelemetryType.Metric,
      metricViewData: {
        startAndEndDate: response.startAndEndDate || null,
        queryConfigs: queryConfigs,
        formulaConfigs: response.metricViewConfig.formulaConfigs,
      },
      ...(scopes ? { metricQueryScopes: scopes } : {}),
      ...(serviceIds.length > 0 ? { metricServiceIds: serviceIds } : {}),
    };
  }

  /*
   * The services a stored snapshot says every query was read for (issue
   * #6266): none for every service, and for any snapshot that does not say.
   */
  public static getStoredServiceIds(
    telemetryQuery: TelemetryQuery | null | undefined,
  ): Array<string> {
    if (
      !telemetryQuery ||
      telemetryQuery.telemetryType !== TelemetryType.Metric
    ) {
      return [];
    }

    return MetricQueryServices.normalize(telemetryQuery.metricServiceIds);
  }

  /*
   * Each query read for these services only, as the check read it: the
   * very same list when there are none, or every query reads for them
   * already.
   */
  public static applyServices(input: {
    queryConfigs: Array<MetricQueryConfigData>;
    serviceIds: Array<string>;
  }): Array<MetricQueryConfigData> {
    if (input.serviceIds.length === 0) {
      return input.queryConfigs;
    }

    let didApplyAny: boolean = false;

    const queryConfigs: Array<MetricQueryConfigData> = input.queryConfigs.map(
      (queryConfig: MetricQueryConfigData): MetricQueryConfigData => {
        if (!queryConfig || typeof queryConfig !== "object") {
          return queryConfig;
        }

        const scoped: MetricQueryConfigData =
          MetricQueryServices.withServiceIds(queryConfig, input.serviceIds);

        didApplyAny = didApplyAny || scoped !== queryConfig;

        return scoped;
      },
    );

    return didApplyAny ? queryConfigs : input.queryConfigs;
  }

  /*
   * For each query, the filters it was read with that it does not say
   * itself (queryAttributes, in query order: its own and what the monitor
   * added): what the monitor added, and any filter of its own it read with
   * another value. Null for a query read with exactly its own filters - every
   * query of a Metrics monitor. Null as a whole when the reads do not say
   * what each query was read with: none were given, or not one per query.
   */
  public static getQueryScopes(input: {
    queryConfigs: Array<MetricQueryConfigData> | null | undefined;
    queryAttributes: Array<Dictionary<unknown> | undefined> | null | undefined;
  }): Array<Attributes | null> | null {
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
      (
        queryConfig: MetricQueryConfigData,
        index: number,
      ): Attributes | null => {
        const own: Attributes =
          queryConfig && typeof queryConfig === "object"
            ? getOwnAttributes(queryConfig)
            : {};
        const read: Attributes = asAttributes(queryAttributes[index]);
        const scope: Attributes = {};

        for (const key of Object.keys(read)) {
          if (
            !Object.prototype.hasOwnProperty.call(own, key) ||
            !JSONFunctions.deepEqual(own[key], read[key])
          ) {
            scope[key] = read[key];
          }
        }

        return Object.keys(scope).length > 0 ? scope : null;
      },
    );
  }

  /*
   * The scopes a stored snapshot keeps, one per query of its metric view:
   * null when it keeps none (a snapshot stored before #6265, or one whose
   * scopes do not line up with its queries).
   */
  public static getStoredScopes(
    telemetryQuery: TelemetryQuery | null | undefined,
  ): Array<Attributes | null> | null {
    if (
      !telemetryQuery ||
      telemetryQuery.telemetryType !== TelemetryType.Metric
    ) {
      return null;
    }

    const scopes: unknown = telemetryQuery.metricQueryScopes;
    const queryConfigs: unknown = telemetryQuery.metricViewData?.queryConfigs;

    if (
      !Array.isArray(scopes) ||
      !Array.isArray(queryConfigs) ||
      scopes.length !== queryConfigs.length
    ) {
      return null;
    }

    return (scopes as Array<unknown>).map(
      (scope: unknown): Attributes | null => {
        const attributes: Attributes = asAttributes(scope);
        return Object.keys(attributes).length > 0 ? attributes : null;
      },
    );
  }

  /*
   * Each query with the filters its monitor added (scopes, one per query):
   * the query's own filters - and whatever it was narrowed to since, such as
   * the event's own series - with the scope over them, as the check read
   * them. A query with no scope is kept as it is, the same object; so is the
   * list when no query has one.
   */
  public static applyScopes(input: {
    queryConfigs: Array<MetricQueryConfigData>;
    scopes: Array<Dictionary<unknown> | null>;
  }): Array<MetricQueryConfigData> {
    let didApplyAny: boolean = false;

    const queryConfigs: Array<MetricQueryConfigData> = input.queryConfigs.map(
      (queryConfig: MetricQueryConfigData, index: number) => {
        const scope: Attributes = asAttributes(input.scopes[index]);

        if (
          !queryConfig ||
          typeof queryConfig !== "object" ||
          Object.keys(scope).length === 0
        ) {
          return queryConfig;
        }

        const attributes: Attributes = getOwnAttributes(queryConfig);
        const scoped: Attributes = { ...attributes, ...scope };

        if (JSONFunctions.deepEqual(scoped, attributes)) {
          return queryConfig;
        }

        didApplyAny = true;

        return MonitorStepMetricQueries.withAttributes(queryConfig, scoped);
      },
    );

    return didApplyAny ? queryConfigs : input.queryConfigs;
  }
}
