import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
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
  findMetricReaders,
  MetricNameReference,
  MetricReader,
  MetricReaderKind,
  MetricReaders,
  MetricReadersOfKind,
  MetricReaderWidget,
} from "../Telemetry/MetricReaders";

/*
 * WHAT READS AN ADDED CLOUD METRIC, SAID BEFORE IT IS REMOVED (#9807).
 *
 * The records that read a metric are found by the lookup every change that
 * takes a metric away asks (Telemetry/MetricReaders): monitors, dashboards
 * widget by widget, Metric SLOs and metric recording rules, named where the
 * asker may read them and counted where they may not. Here it is asked
 * which of their queries read this metric's points once it stops being
 * read: its stored name, of the connection's service - the one its points
 * are stored under - or of every service, and of a resource its removal
 * stops reading it for, or of every resource (a filter that names none).
 */

const READER_KINDS: ReadonlyArray<{
  from: MetricReaderKind;
  kind: CloudAddedMetricReaderKind;
}> = [
  { from: MetricReaderKind.Monitor, kind: CloudAddedMetricReaderKind.Monitor },
  {
    from: MetricReaderKind.Dashboard,
    kind: CloudAddedMetricReaderKind.Dashboard,
  },
  {
    from: MetricReaderKind.ServiceLevelObjective,
    kind: CloudAddedMetricReaderKind.Slo,
  },
  {
    from: MetricReaderKind.MetricRecordingRule,
    kind: CloudAddedMetricReaderKind.RecordingRule,
  },
];

/*
 * The one resource a query's filter names, or null when it names none: a
 * filter of every resource, of attributes no resource is known by, or one
 * whose values are not all text (an operator, a list).
 */
export function getNamedCloudResource(
  reference: Pick<MetricNameReference, "metricName" | "attributes">,
): CloudMonitoredResource | null {
  const text: Record<string, string> = {};

  for (const [key, value] of Object.entries(reference.attributes || {})) {
    if (typeof value !== "string") {
      return null;
    }

    text[key] = value;
  }

  if (Object.keys(text).length === 0) {
    return null;
  }

  return resolveCloudMonitoredResource({
    metricName: reference.metricName,
    attributes: text,
  });
}

/*
 * Whether a query reads the added metric of what its removal stops reading:
 * its stored name (whatever its case, or the spaces around it), of the
 * connection's service or every service, and of an affected resource or of
 * every resource. A connection that has no service yet stores nothing, so
 * a query of any service is taken to read it.
 */
export function readsCloudAddedMetric(
  reference: MetricNameReference,
  data: {
    storedName: string;
    serviceId: string | null;
    readsResource: (resource: CloudMonitoredResource) => boolean;
  },
): boolean {
  if (
    reference.metricName.trim().toLowerCase() !==
    data.storedName.trim().toLowerCase()
  ) {
    return false;
  }

  if (
    reference.serviceIds &&
    data.serviceId &&
    !reference.serviceIds.includes(data.serviceId.toLowerCase())
  ) {
    return false;
  }

  const resource: CloudMonitoredResource | null =
    getNamedCloudResource(reference);

  return !resource || data.readsResource(resource);
}

function toCloudReader(
  kind: CloudAddedMetricReaderKind,
  reader: MetricReader,
): CloudAddedMetricReader {
  const found: CloudAddedMetricReader = {
    kind,
    id: reader.id,
    name: reader.name,
    widgets: (reader.widgets || []).map(
      (widget: MetricReaderWidget): string => {
        return widget.title;
      },
    ),
  };

  if (reader.outputMetricName) {
    found.outputMetricName = reader.outputMetricName;
  }

  return found;
}

export async function findCloudAddedMetricReaders(data: {
  projectId: ObjectID;
  // The name the metric is stored under (getCloudAddedMetricStoredName).
  storedName: string;
  // The service the connection stores its metrics under; null when it has none yet.
  serviceId: string | null;
  /*
   * Whether a resource a query names is one the removal stops reading the
   * metric for: the resource, or one of its type the connection reads.
   */
  readsResource: (resource: CloudMonitoredResource) => boolean;
  props: DatabaseCommonInteractionProps;
}): Promise<CloudAddedMetricReaders> {
  const found: MetricReaders = await findMetricReaders({
    projectId: data.projectId,
    reads: (reference: MetricNameReference): boolean => {
      return readsCloudAddedMetric(reference, data);
    },
    props: data.props,
  });
  const readers: Array<CloudAddedMetricReader> = [];
  const uncheckedKinds: Array<CloudAddedMetricReaderKind> = [];
  let hidden: number = 0;

  for (const { from, kind } of READER_KINDS) {
    const ofKind: MetricReadersOfKind = found[from];

    if (!ofKind.isChecked) {
      uncheckedKinds.push(kind);
    }

    hidden += ofKind.hiddenCount;

    for (const reader of ofKind.readers) {
      readers.push(toCloudReader(kind, reader));
    }
  }

  return {
    readers: sortCloudAddedMetricReaders(readers),
    hidden,
    uncheckedKinds,
  };
}
