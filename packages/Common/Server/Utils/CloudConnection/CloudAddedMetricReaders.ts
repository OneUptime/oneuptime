import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CloudAddedMetricKeepBlock,
  CloudAddedMetricKeepFor,
  CloudAddedMetricReader,
  CloudAddedMetricReaderKind,
  CloudAddedMetricReaders,
  sortCloudAddedMetricReaders,
} from "../../../Types/Cloud/CloudAddedMetricReaders";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
  resolveCloudMonitoredResource,
} from "../../../Types/Cloud/CloudMonitoredResource";
import { MetricOutputReaders } from "../../../Types/Metrics/MetricOutputReaders";
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
 *
 * For a type's addition (#10078), which resources of the type its readers
 * read it of - hidden readers' too, never named - and which of them read
 * it of every resource: what it can be kept for alone instead of removed.
 *
 * A recording rule among them is followed to what reads the metric it
 * writes, and on down the chain (#10085): those read the rule's output,
 * not the added metric, so they name what removing it leaves without data,
 * never which resources it can be kept for.
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
    widgets: (reader.widgets || []).map((widget: MetricReaderWidget) => {
      return { id: widget.id, title: widget.title, type: widget.type };
    }),
  };

  if (reader.outputMetricName) {
    found.outputMetricName = reader.outputMetricName;
  }

  if (reader.outputReaders) {
    found.outputReaders = reader.outputReaders;
  }

  return found;
}

/*
 * What references that read an added metric say of the resources they read
 * it of: the identifiers of the ones they name (lower case), and whether
 * one names none, which reads it of every resource.
 */
export function getCloudResourcesRead(
  references: ReadonlyArray<MetricNameReference>,
): { identifiers: Set<string>; isEveryResource: boolean } {
  const identifiers: Set<string> = new Set<string>();
  let isEveryResource: boolean = false;

  for (const reference of references) {
    const resource: CloudMonitoredResource | null =
      getNamedCloudResource(reference);

    if (resource) {
      identifiers.add(
        buildCloudMonitoredResourceIdentifier(resource).toLowerCase(),
      );
    } else {
      isEveryResource = true;
    }
  }

  return { identifiers, isEveryResource };
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
  /*
   * A type's addition (#10078): the resources of its type the connection
   * reads, by their identifiers (any case) - which of them its readers
   * read it of is what it can be kept for alone (keepFor).
   */
  keepForResources?:
    | ReadonlyArray<{ id: string; name: string; identifier: string }>
    | undefined;
}): Promise<CloudAddedMetricReaders> {
  const isKeepFor: boolean = Boolean(data.keepForResources);
  const found: MetricReaders = await findMetricReaders({
    projectId: data.projectId,
    reads: (reference: MetricNameReference): boolean => {
      return readsCloudAddedMetric(reference, data);
    },
    props: data.props,
    keepsReferences: isKeepFor,
    // A recording rule that reads it writes its output without it: what reads that is named (#10085).
    followsOutputMetrics: true,
  });
  const readers: Array<CloudAddedMetricReader> = [];
  const uncheckedKinds: Array<CloudAddedMetricReaderKind> = [];
  const hiddenByKind: Partial<Record<CloudAddedMetricReaderKind, number>> = {};
  // The resources every reader reads it of, hidden or not; and whether one reads it of all.
  const named: Set<string> = new Set<string>();
  let isEveryResource: boolean = false;
  let hidden: number = 0;

  const note: (references: ReadonlyArray<MetricNameReference>) => boolean = (
    references: ReadonlyArray<MetricNameReference>,
  ): boolean => {
    const read: { identifiers: Set<string>; isEveryResource: boolean } =
      getCloudResourcesRead(references);

    for (const identifier of read.identifiers) {
      named.add(identifier);
    }

    isEveryResource = isEveryResource || read.isEveryResource;

    return read.isEveryResource;
  };

  for (const { from, kind } of READER_KINDS) {
    const ofKind: MetricReadersOfKind = found[from];

    if (!ofKind.isChecked) {
      uncheckedKinds.push(kind);
    }

    hidden += ofKind.hiddenCount;

    if (ofKind.hiddenCount > 0) {
      hiddenByKind[kind] = ofKind.hiddenCount;
    }

    for (const reader of ofKind.readers) {
      const cloudReader: CloudAddedMetricReader = toCloudReader(kind, reader);

      if (isKeepFor && note(reader.references || [])) {
        cloudReader.readsEveryResource = true;
      }

      readers.push(cloudReader);
    }

    if (isKeepFor) {
      note(ofKind.hiddenReferences || []);
    }
  }

  const answer: CloudAddedMetricReaders = {
    readers: sortCloudAddedMetricReaders(readers),
    hidden,
    uncheckedKinds,
    hiddenByKind,
  };
  const hiddenOutputReaders: MetricOutputReaders | undefined =
    found[MetricReaderKind.MetricRecordingRule].hiddenOutputReaders;

  if (hiddenOutputReaders) {
    answer.hiddenOutputReaders = hiddenOutputReaders;
  }

  // Something reads a type's addition: the resources it can be kept for alone.
  if (data.keepForResources && (readers.length > 0 || hidden > 0)) {
    const keepFor: CloudAddedMetricKeepFor = {
      resources: data.keepForResources
        .filter((resource: { identifier: string }): boolean => {
          return named.has(resource.identifier.toLowerCase());
        })
        .map((resource: { id: string; name: string }) => {
          return { id: resource.id, name: resource.name };
        })
        .sort(
          (
            a: { id: string; name: string },
            b: { id: string; name: string },
          ): number => {
            return (
              a.name.localeCompare(b.name) ||
              (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
            );
          },
        ),
    };

    if (uncheckedKinds.length > 0) {
      keepFor.blockedBy = CloudAddedMetricKeepBlock.Unchecked;
    } else if (isEveryResource) {
      keepFor.blockedBy = CloudAddedMetricKeepBlock.EveryResource;
    }

    answer.keepFor = keepFor;
  }

  return answer;
}
