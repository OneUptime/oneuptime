import Dashboard from "../../../../Models/DatabaseModels/Dashboard";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import { DataSecurityMetricUser } from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import ObjectID from "../../../../Types/ObjectID";
import StoredDashboardViewConfig from "../../../../Utils/Dashboard/StoredDashboardViewConfig";
import DashboardService from "../../../Services/DashboardService";
import MonitorService from "../../../Services/MonitorService";
import logger from "../../Logger";

/*
 * WHICH MONITORS AND DASHBOARDS READ A METRIC (issue #9757).
 *
 * Dropping a metric's new data points at ingest leaves whatever reads the
 * metric without new data: a monitor that watches it goes quiet, a
 * dashboard's chart of it goes flat. Before Data Security drops the metrics
 * whose names hold a finding's data, it says which ones would.
 *
 * A metric is read by name, in a query (MetricsQuery.metricName) that may be
 * limited to some services (telemetryServiceIds, on the query or on the
 * monitor step around it). Monitors keep their queries in their steps -
 * a Metrics monitor's, and the Kubernetes, host, Docker, cloud and data
 * monitors' own - and dashboards in their widgets, under keys of every
 * shape, so both are walked whole, as JSON, for every metricName in them:
 * a monitor type or a widget added tomorrow is read without anyone
 * remembering to add it here. Only the monitors and dashboards the reader
 * may read are read, with the reader's own permissions.
 */

// How deep, and how many values, a monitor's steps or a dashboard's widgets are walked.
const MAX_DEPTH: number = 64;
const MAX_VALUES: number = 100_000;

// A metric a monitor or dashboard reads, and the services it reads it of.
export interface MetricNameReference {
  metricName: string;
  // The services the query is limited to, in lower case; none for every service.
  serviceIds: Array<string> | null;
}

// An id as JSON writes one: its text, or ObjectID's { _type, value }.
function readId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const inner: unknown = (value as Record<string, unknown>)["value"];

    return typeof inner === "string" ? inner.trim().toLowerCase() : "";
  }

  return "";
}

// The services a query or a step is limited to: none when it names none.
function readServiceScope(value: unknown): Array<string> | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const ids: Array<string> = value.map(readId).filter((id: string) => {
    return ObjectID.isValidUUID(id);
  });

  return ids.length > 0 ? ids : null;
}

/*
 * Every metric name a monitor's steps or a dashboard's widgets query, each
 * with the services its query is limited to - its own, or the nearest
 * around it that names some.
 */
export function findMetricNameReferences(
  value: unknown,
): Array<MetricNameReference> {
  const references: Array<MetricNameReference> = [];
  let plain: unknown;

  try {
    // As stored: a column's own classes (MonitorSteps) write their JSON.
    plain = JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return references;
  }

  let visited: number = 0;

  const walk: (
    node: unknown,
    scope: Array<string> | null,
    depth: number,
  ) => void = (
    node: unknown,
    scope: Array<string> | null,
    depth: number,
  ): void => {
    if (visited++ >= MAX_VALUES || depth > MAX_DEPTH || !node) {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, scope, depth + 1);
      }

      return;
    }

    if (typeof node !== "object") {
      return;
    }

    const entries: Record<string, unknown> = node as Record<string, unknown>;
    const ownScope: Array<string> | null =
      readServiceScope(entries["telemetryServiceIds"]) || scope;
    const metricName: unknown = entries["metricName"];

    if (typeof metricName === "string" && metricName.trim()) {
      references.push({ metricName, serviceIds: ownScope });
    }

    for (const [key, child] of Object.entries(entries)) {
      if (key !== "metricName" && key !== "telemetryServiceIds") {
        walk(child, ownScope, depth + 1);
      }
    }
  };

  walk(plain, null, 0);

  return references;
}

/*
 * Whether a query reads a metric a rule for one service drops: a name the
 * rule's filter matches, of that service or of every service.
 */
export function isReferenceDropped(
  reference: MetricNameReference,
  data: { serviceId: string; isNameDropped: (metricName: string) => boolean },
): boolean {
  if (
    reference.serviceIds &&
    !reference.serviceIds.includes(data.serviceId.toLowerCase())
  ) {
    return false;
  }

  return data.isNameDropped(reference.metricName);
}

export interface MetricUsers {
  monitors: Array<DataSecurityMetricUser>;
  dashboards: Array<DataSecurityMetricUser>;
  // False when the reader may read none of them, so none could be checked.
  monitorsChecked: boolean;
  dashboardsChecked: boolean;
}

function usersOf<T extends Monitor | Dashboard>(
  records: Array<T>,
  readValue: (record: T) => unknown,
  data: { serviceId: string; isNameDropped: (metricName: string) => boolean },
): Array<DataSecurityMetricUser> {
  const users: Array<DataSecurityMetricUser> = [];

  for (const record of records) {
    const id: string = record.id?.toString() || "";
    const reads: boolean = findMetricNameReferences(readValue(record)).some(
      (reference: MetricNameReference): boolean => {
        return isReferenceDropped(reference, data);
      },
    );

    if (id && reads) {
      users.push({ id, name: record.name || "" });
    }
  }

  return users.sort(
    (a: DataSecurityMetricUser, b: DataSecurityMetricUser): number => {
      return a.name.localeCompare(b.name);
    },
  );
}

/*
 * The monitors and dashboards of a project that read a metric a rule for
 * one service drops, read with the reader's own permissions: a reader who
 * may not read monitors (or dashboards) is told they were not checked,
 * rather than that none reads them.
 */
export async function findMetricUsers(data: {
  projectId: ObjectID;
  serviceId: string;
  isNameDropped: (metricName: string) => boolean;
  props: DatabaseCommonInteractionProps;
}): Promise<MetricUsers> {
  const users: MetricUsers = {
    monitors: [],
    dashboards: [],
    monitorsChecked: false,
    dashboardsChecked: false,
  };

  try {
    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: { projectId: data.projectId },
      select: { _id: true, name: true, monitorSteps: true },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: data.props,
    });

    users.monitors = usersOf(
      monitors,
      (monitor: Monitor): unknown => {
        return monitor.monitorSteps;
      },
      data,
    );
    users.monitorsChecked = true;
  } catch (error) {
    logger.debug(
      `DataSecurity: the monitors of project ${data.projectId.toString()} could not be read for this reader:`,
    );
    logger.debug(error);
  }

  try {
    const dashboards: Array<Dashboard> = await DashboardService.findBy({
      query: { projectId: data.projectId },
      select: { _id: true, name: true, dashboardViewConfig: true },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: data.props,
    });

    users.dashboards = usersOf(
      dashboards,
      (dashboard: Dashboard): unknown => {
        /*
         * As every board reads it (#4571), so a widget stored as JSON text,
         * or with its arguments as JSON text, has its queries walked too.
         */
        return StoredDashboardViewConfig.read(dashboard.dashboardViewConfig);
      },
      data,
    );
    users.dashboardsChecked = true;
  } catch (error) {
    logger.debug(
      `DataSecurity: the dashboards of project ${data.projectId.toString()} could not be read for this reader:`,
    );
    logger.debug(error);
  }

  return users;
}
