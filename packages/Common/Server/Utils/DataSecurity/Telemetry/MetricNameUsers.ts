import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataSecurityMetricUser,
  DataSecurityMetricUserWidget,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import ObjectID from "../../../../Types/ObjectID";
import {
  findMetricReaders,
  MetricNameReference,
  MetricReader,
  MetricReaderKind,
  MetricReaders,
  MetricReaderWidget,
  MetricReadersOfKind,
} from "../../Telemetry/MetricReaders";

/*
 * WHAT READS THE METRICS A DROP WOULD EMPTY (issues #9757, #9946).
 *
 * Dropping a metric's new data points at ingest leaves whatever reads the
 * metric without new data: a monitor that watches it goes quiet, a
 * dashboard's chart of it goes flat, a Metric SLO counts none of its events,
 * a recording rule computes nothing from it. Before Data Security drops the
 * metrics whose names hold a finding's data, it says which ones would - the
 * project's records that read metrics, found by the shared lookup
 * (Telemetry/MetricReaders), here asked which read a name the drop rule
 * drops, of its service.
 */

// The walk Drop This Metric has read monitors and dashboards with since #9757.
export { findMetricNameReferences } from "../../Telemetry/MetricReaders";
export type { MetricNameReference } from "../../Telemetry/MetricReaders";

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
  slos: Array<DataSecurityMetricUser>;
  recordingRules: Array<DataSecurityMetricUser>;
  // False when they could not be read just now: nothing is known of them.
  monitorsChecked: boolean;
  dashboardsChecked: boolean;
  slosChecked: boolean;
  recordingRulesChecked: boolean;
  // How many more read them that the reader may not read: never named.
  monitorsHidden: number;
  dashboardsHidden: number;
  slosHidden: number;
  recordingRulesHidden: number;
}

function toUser(reader: MetricReader): DataSecurityMetricUser {
  const user: DataSecurityMetricUser = { id: reader.id, name: reader.name };

  if (reader.widgets) {
    user.widgets = reader.widgets.map(
      (widget: MetricReaderWidget): DataSecurityMetricUserWidget => {
        return { id: widget.id, title: widget.title, type: widget.type };
      },
    );
  }

  if (reader.outputMetricName !== undefined) {
    user.outputMetricName = reader.outputMetricName;
  }

  return user;
}

function usersOf(kind: MetricReadersOfKind): Array<DataSecurityMetricUser> {
  return kind.readers.map(toUser);
}

/*
 * The monitors, dashboards, SLOs and recording rules of a project that read
 * a metric a rule for one service drops: named where the reader may read
 * them, counted where they may not.
 */
export async function findMetricUsers(data: {
  projectId: ObjectID;
  serviceId: string;
  isNameDropped: (metricName: string) => boolean;
  props: DatabaseCommonInteractionProps;
}): Promise<MetricUsers> {
  const readers: MetricReaders = await findMetricReaders({
    projectId: data.projectId,
    reads: (reference: MetricNameReference): boolean => {
      return isReferenceDropped(reference, data);
    },
    props: data.props,
  });
  const monitors: MetricReadersOfKind = readers[MetricReaderKind.Monitor];
  const dashboards: MetricReadersOfKind = readers[MetricReaderKind.Dashboard];
  const slos: MetricReadersOfKind =
    readers[MetricReaderKind.ServiceLevelObjective];
  const recordingRules: MetricReadersOfKind =
    readers[MetricReaderKind.MetricRecordingRule];

  return {
    monitors: usersOf(monitors),
    dashboards: usersOf(dashboards),
    slos: usersOf(slos),
    recordingRules: usersOf(recordingRules),
    monitorsChecked: monitors.isChecked,
    dashboardsChecked: dashboards.isChecked,
    slosChecked: slos.isChecked,
    recordingRulesChecked: recordingRules.isChecked,
    monitorsHidden: monitors.hiddenCount,
    dashboardsHidden: dashboards.hiddenCount,
    slosHidden: slos.hiddenCount,
    recordingRulesHidden: recordingRules.hiddenCount,
  };
}
