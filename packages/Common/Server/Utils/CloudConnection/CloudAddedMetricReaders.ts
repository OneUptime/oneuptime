import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CLOUD_ADDED_METRIC_READERS_MAX_ROWS,
  CloudAddedMetricReader,
  CloudAddedMetricReaderKind,
  CloudAddedMetricReaders,
  sortCloudAddedMetricReaders,
} from "../../../Types/Cloud/CloudAddedMetricReaders";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "../../../Types/Cloud/CloudMonitoredResource";
import ObjectID from "../../../Types/ObjectID";
import {
  MetricNameClassifier,
  MetricQueryRead,
  namedMetric,
  readDashboardMetricQueries,
  readMonitorStepsMetricQueries,
  readSloMetricQuery,
} from "../../../Utils/Metrics/SavedMetricQueryReads";
import QueryHelper from "../../Types/Database/QueryHelper";
import DashboardService from "../../Services/DashboardService";
import MonitorService from "../../Services/MonitorService";
import ServiceLevelObjectiveService from "../../Services/ServiceLevelObjectiveService";
import logger from "../Logger";
import {
  SavedMetricQueryRow,
  SavedMetricQueryRows,
  findSavedMetricQueryRows,
  getContainsPattern,
} from "./CloudSavedMetricQueries";

/*
 * WHICH MONITORS, DASHBOARD WIDGETS AND SLOS READ AN ADDED METRIC (#9807).
 *
 * The project's rows whose JSON names the metric's stored name
 * (CloudSavedMetricQueries, the lookup the deprecated metrics' reads use),
 * then each query of it in them (SavedMetricQueryReads). A query reads the
 * metric of what its filter names: of one resource, which the caller says
 * is one the removal stops reading it for or not (`readsResource`), or -
 * a filter that names none, every resource's - of all of them, these
 * among them. Only the monitors, dashboards and SLOs the asker may read are
 * named; the rest are counted.
 */

/*
 * The one resource a query's filter names, or null when it names none: a
 * filter of every resource, or of attributes no resource is known by.
 */
export function getNamedCloudResource(
  read: Pick<MetricQueryRead<unknown>, "metricName" | "attributes">,
): CloudMonitoredResource | null {
  const attributes: unknown = read.attributes;

  if (
    !attributes ||
    typeof attributes !== "object" ||
    Array.isArray(attributes)
  ) {
    return null;
  }

  const text: Record<string, string> = {};

  for (const [key, value] of Object.entries(
    attributes as Record<string, unknown>,
  )) {
    // A value that is no text (an operator, a list) names no one resource.
    if (typeof value !== "string") {
      return null;
    }

    text[key] = value;
  }

  if (Object.keys(text).length === 0) {
    return null;
  }

  return resolveCloudMonitoredResource({
    metricName: read.metricName,
    attributes: text,
  });
}

/*
 * Whether a query reads the metric of a resource the removal stops reading
 * it for: a query that names none reads every resource's.
 */
function readsAffected(
  read: MetricQueryRead<unknown>,
  readsResource: (resource: CloudMonitoredResource) => boolean,
): boolean {
  const resource: CloudMonitoredResource | null = getNamedCloudResource(read);

  return !resource || readsResource(resource);
}

interface Found {
  kind: CloudAddedMetricReaderKind;
  row: SavedMetricQueryRow;
  widgets: Array<string>;
}

// The rows' queries of the metric that read it of an affected resource, each row once.
export function findCloudAddedMetricReadersInRows(data: {
  rows: SavedMetricQueryRows;
  storedName: string;
  readsResource: (resource: CloudMonitoredResource) => boolean;
}): Array<Found> {
  const classify: MetricNameClassifier<true> = namedMetric(data.storedName);
  const found: Array<Found> = [];
  const affected: (read: MetricQueryRead<true>) => boolean = (
    read: MetricQueryRead<true>,
  ): boolean => {
    return readsAffected(read, data.readsResource);
  };

  for (const row of data.rows.monitors) {
    if (
      row.id &&
      readMonitorStepsMetricQueries(row.json, classify).some(affected)
    ) {
      found.push({
        kind: CloudAddedMetricReaderKind.Monitor,
        row,
        widgets: [],
      });
    }
  }

  for (const row of data.rows.dashboards) {
    const widgets: Map<string, string> = new Map<string, string>();

    for (const read of readDashboardMetricQueries(row.json, classify)) {
      if (affected(read)) {
        // A widget once, however many of its queries read it.
        widgets.set(
          read.widget?.componentId || `widget-${widgets.size}`,
          read.widget?.title || "",
        );
      }
    }

    if (row.id && widgets.size > 0) {
      found.push({
        kind: CloudAddedMetricReaderKind.Dashboard,
        row,
        widgets: Array.from(widgets.values()),
      });
    }
  }

  for (const row of data.rows.slos) {
    const read: MetricQueryRead<true> | null = readSloMetricQuery(
      row.json,
      classify,
    );

    if (row.id && read && affected(read)) {
      found.push({ kind: CloudAddedMetricReaderKind.Slo, row, widgets: [] });
    }
  }

  return found;
}

/*
 * Of `ids`, the ones the asker may read of a kind: none when their role may
 * read none of it.
 */
async function readableIds(data: {
  kind: CloudAddedMetricReaderKind;
  ids: Array<string>;
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<Set<string>> {
  const readable: Set<string> = new Set<string>();

  if (data.ids.length === 0) {
    return readable;
  }

  const query: Record<string, unknown> = {
    _id: QueryHelper.any(
      data.ids.map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
    ),
    projectId: data.projectId,
  };
  const find: {
    query: never;
    select: never;
    skip: number;
    limit: number;
    props: DatabaseCommonInteractionProps;
  } = {
    query: query as never,
    select: { _id: true } as never,
    skip: 0,
    limit: data.ids.length,
    props: data.props,
  };

  try {
    const rows: Array<{ id?: ObjectID | null }> =
      data.kind === CloudAddedMetricReaderKind.Monitor
        ? await MonitorService.findBy(find)
        : data.kind === CloudAddedMetricReaderKind.Dashboard
          ? await DashboardService.findBy(find)
          : await ServiceLevelObjectiveService.findBy(find);

    for (const row of rows) {
      if (row.id) {
        readable.add(row.id.toString());
      }
    }
  } catch (error) {
    logger.debug(
      `CloudAddedMetricReaders: the ${data.kind} rows of project ${data.projectId.toString()} could not be read for this asker:`,
    );
    logger.debug(error);
  }

  return readable;
}

export async function findCloudAddedMetricReaders(data: {
  projectId: ObjectID;
  // The name the metric is stored under (getCloudAddedMetricStoredName).
  storedName: string;
  /*
   * Whether a resource a query names is one the removal stops reading the
   * metric for: the resource, or one of its type the connection reads.
   */
  readsResource: (resource: CloudMonitoredResource) => boolean;
  props: DatabaseCommonInteractionProps;
}): Promise<CloudAddedMetricReaders> {
  const rows: SavedMetricQueryRows = await findSavedMetricQueryRows({
    projectId: data.projectId,
    namePatterns: [getContainsPattern(data.storedName)],
    limit: CLOUD_ADDED_METRIC_READERS_MAX_ROWS,
    includeSlos: true,
  });
  const found: Array<Found> = findCloudAddedMetricReadersInRows({
    rows,
    storedName: data.storedName,
    readsResource: data.readsResource,
  });
  const readers: Array<CloudAddedMetricReader> = [];
  let hidden: number = 0;

  for (const kind of Object.values(CloudAddedMetricReaderKind)) {
    const ofKind: Array<Found> = found.filter((entry: Found): boolean => {
      return entry.kind === kind;
    });
    const readable: Set<string> = await readableIds({
      kind,
      ids: ofKind.map((entry: Found): string => {
        return entry.row.id;
      }),
      projectId: data.projectId,
      props: data.props,
    });

    for (const entry of ofKind) {
      if (!readable.has(entry.row.id)) {
        hidden++;
        continue;
      }

      readers.push({
        kind,
        id: entry.row.id,
        name: entry.row.name,
        widgets: entry.widgets,
      });
    }
  }

  return {
    readers: sortCloudAddedMetricReaders(readers),
    hidden,
    isCapped:
      rows.monitors.length >= CLOUD_ADDED_METRIC_READERS_MAX_ROWS ||
      rows.dashboards.length >= CLOUD_ADDED_METRIC_READERS_MAX_ROWS ||
      rows.slos.length >= CLOUD_ADDED_METRIC_READERS_MAX_ROWS,
  };
}
