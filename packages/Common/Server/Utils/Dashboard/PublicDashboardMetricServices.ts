import Includes from "../../../Types/BaseDatabase/Includes";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import MetricQueryServices from "../../../Utils/Metrics/MetricQueryServices";
import PublicDashboardViewConfig from "./PublicDashboardViewConfig";

/*
 * THE SERVICES A PUBLIC DASHBOARD'S CHARTS READ (issue #6280).
 *
 * A metric query can be read for some telemetry services only
 * (MetricsQuery.telemetryServiceIds, issue #6266): the rows' service,
 * primaryEntityId, among them. A chart saved that way - Open in Metric
 * Explorer on a Metrics monitor limited to some services, then Add to
 * dashboard - charts those services and no other, and a public dashboard
 * charts exactly that for a viewer who is not signed in.
 *
 * The services come from the saved dashboard, never from the request. The
 * public metrics endpoint serves the whole dashboard and is not told which
 * chart asks, so the saved dashboard says which services each metric it
 * charts is read for: the services of each of its queries of that metric,
 * and every service for a query saved without any (getSavedServices). A
 * request picks one of those - the client sends a query's own services as
 * `primaryEntityId: Includes(ids)` (MetricQueryServices.getServiceQuery),
 * and nothing for every service - and is read for that pick as the
 * dashboard saved it (getServiceQuery). Anything else is refused, so a
 * viewer can neither widen a chart nor narrow it to read a service on its
 * own that the chart only shows among others:
 *
 *   - services no query of that metric is saved with, some of them, or more
 *     than them - another metric's services among them;
 *   - every service, when each query of the metric is saved with some;
 *   - any other filter on the column: one id, IncludesNone, a search, a list
 *     of anything but service ids, or one that names a service twice.
 *
 * A dashboard saved without services - every dashboard saved before #6266 -
 * reads every service of every metric, and its requests, which never name
 * one, are read exactly as before. The route pins the project, so even a
 * saved id of another project's service reads nothing of that project.
 *
 * A query saved with something that is not a service id among its services
 * (only a config or an explorer link written by hand has one; signed in, it
 * matches no row) is not read on the public page: no request can name it.
 * It is never read for every service instead.
 */

/*
 * For each metric a dashboard charts, the services its queries of that
 * metric are saved with: one entry per distinct set, an empty one for every
 * service. A Map, so a metric named like an Object property is a metric.
 */
export type PublicDashboardMetricSavedServices = Map<
  string,
  Array<Array<string>>
>;

export const PUBLIC_DASHBOARD_SERVICES_REFUSED_MESSAGE: string =
  "This dashboard does not chart this metric for these services.";

/*
 * The services one saved query is read for, as the public page reads them:
 * its filter as the page draws it - each widget deserialized, so an id
 * stored as ObjectID JSON is that id, or left as stored when it cannot be
 * (PublicDashboardViewConfig.getDrawnConfig) - read with
 * MetricQueryServices, as the page's chart reads it. Empty for every
 * service. Never deserialized again here: what the page could not revive,
 * it reads as stored, and so is it read here (issue #6297).
 */
const readSavedServiceIds: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  return MetricQueryServices.normalize(value);
};

/*
 * The services a request names: none for no filter (absent or null - a
 * query saved without services sends none), the ids of an Includes of
 * service ids, and null for anything else. The page sends a saved query's
 * services as it reads them (MetricQueryServices): ids, each once. So a list
 * that names a service twice or holds anything but an id - a padded or blank
 * id, a number, an ObjectID, a list - is no list a page sends, and is
 * refused rather than tidied into one.
 */
const readRequestedServiceIds: (value: unknown) => Set<string> | null = (
  value: unknown,
): Set<string> | null => {
  if (value === undefined || value === null) {
    return new Set<string>();
  }

  /*
   * An Includes itself: a class built on it some day could read the column
   * another way (IncludesNone reads every OTHER service), and is refused.
   */
  if (
    !(value instanceof Includes) ||
    Object.getPrototypeOf(value) !== Includes.prototype
  ) {
    return null;
  }

  const values: unknown = value.values;

  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const ids: Set<string> = new Set<string>();

  for (const id of values) {
    if (typeof id !== "string" || !ObjectID.isValidUUID(id) || ids.has(id)) {
      return null;
    }

    ids.add(id);
  }

  return ids;
};

// Whether a saved set of services is exactly the set a request names.
const isSameServices: (
  savedServiceIds: Array<string>,
  requestedServiceIds: Set<string>,
) => boolean = (
  savedServiceIds: Array<string>,
  requestedServiceIds: Set<string>,
): boolean => {
  return (
    savedServiceIds.length === requestedServiceIds.size &&
    savedServiceIds.every((serviceId: string): boolean => {
      return requestedServiceIds.has(serviceId);
    })
  );
};

export default class PublicDashboardMetricServices {
  /*
   * Walk the settings of the widgets a public dashboard's page draws that
   * chart metrics (DashboardAPI.getPublicMetricSources: their `arguments`,
   * as PublicDashboardViewConfig.getDrawnConfig reads them) and collect,
   * for every metric they chart, the services each query of it is saved
   * with. It reads exactly where the public metric allowlist reads metric
   * names - every `metricName` in the same settings, through the same walk
   * (PublicDashboardViewConfig.forEachSettingsObject,
   * DashboardAPI.collectDashboardMetricNames) - and a query's services sit
   * beside its metric name in its filter data
   * (`filterData.telemetryServiceIds`), so every metric the page may read
   * has its services here: a chart's queries, a fallback query, a table's
   * columns. A place that names a metric without services - a table
   * column, a query saved before #6266 - reads it for every service, as
   * the dashboard draws it.
   */
  public static getSavedServices(
    metricWidgetSettings: unknown,
  ): PublicDashboardMetricSavedServices {
    const savedServices: PublicDashboardMetricSavedServices = new Map<
      string,
      Array<Array<string>>
    >();
    const seenKeys: Map<string, Set<string>> = new Map<string, Set<string>>();

    const addServices: (
      metricName: string,
      serviceIds: Array<string>,
    ) => void = (metricName: string, serviceIds: Array<string>): void => {
      const key: string = JSON.stringify([...serviceIds].sort());
      let keys: Set<string> | undefined = seenKeys.get(metricName);

      if (!keys) {
        keys = new Set<string>();
        seenKeys.set(metricName, keys);
        savedServices.set(metricName, []);
      }

      if (keys.has(key)) {
        return;
      }

      keys.add(key);
      savedServices.get(metricName)!.push(serviceIds);
    };

    PublicDashboardViewConfig.forEachSettingsObject(
      metricWidgetSettings,
      (settings: Record<string, unknown>): void => {
        const metricName: unknown = settings["metricName"];

        if (typeof metricName === "string" && metricName.trim().length > 0) {
          addServices(
            metricName,
            readSavedServiceIds(settings["telemetryServiceIds"]),
          );
        }
      },
    );

    return savedServices;
  }

  /*
   * The service filter a public read of this metric runs with, from the
   * saved dashboard: `primaryEntityId` among the services of the saved
   * query the request names, in the order they are saved, or nothing when
   * it names a query saved for every service. `requestedServiceFilter` is
   * the request query's `primaryEntityId`, deserialized. A request that
   * names no saved query of this metric is refused, with words that say
   * nothing about the services the dashboard saves.
   */
  public static getServiceQuery(data: {
    savedServices: PublicDashboardMetricSavedServices;
    metricName: string;
    requestedServiceFilter: unknown;
  }): { primaryEntityId?: Includes } {
    const requestedServiceIds: Set<string> | null = readRequestedServiceIds(
      data.requestedServiceFilter,
    );

    const savedServiceIds: Array<string> | undefined = requestedServiceIds
      ? (data.savedServices.get(data.metricName) || []).find(
          (serviceIds: Array<string>): boolean => {
            return isSameServices(serviceIds, requestedServiceIds);
          },
        )
      : undefined;

    if (!savedServiceIds) {
      throw new BadDataException(PUBLIC_DASHBOARD_SERVICES_REFUSED_MESSAGE);
    }

    return savedServiceIds.length > 0
      ? { primaryEntityId: new Includes([...savedServiceIds]) }
      : {};
  }
}
