import MonitorGroupResource from "Common/Models/DatabaseModels/MonitorGroupResource";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LABEL_WITH_COLON } from "Common/UI/Utils/LabelWithColon";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { translateRecordName } from "Common/Utils/DefaultRecordNames";
import MonitoringOff, {
  MONITORED_SELECT,
} from "Common/Utils/Monitor/MonitoringOff";
import {
  MonitorStatusReason,
  readMonitorStatusReason,
} from "Common/Utils/Monitor/MonitorStatusReason";
import { StateListType } from "Common/Utils/StateOrder";
import { ResourceAttentionDialogRead } from "../ResourcePart/ResourceAttentionDialog";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  sortResourceAttention,
} from "../ResourcePart/ResourceAttention";

/*
 * WHICH MONITORS MAKE A GROUP OFFLINE OR DEGRADED, AND WHY (#9596).
 *
 * A monitor group's Current Status is its monitors' worst: a group that
 * read Offline never said which monitor. Pressed, it now opens the group's
 * monitors that are not operational, the most urgent first, each with its
 * status, what set it - the criteria that matched and what it found, or the
 * note of a person or an incident that set it (MonitorStatusReason, as the
 * monitor's own hero says it) - since when, and View, a step from the
 * monitor. Read when it is pressed: a group's status is rarely asked about.
 *
 * Only the monitors the group's status counts are listed: one archived or
 * with its monitoring off is not checked, and its frozen status does not
 * count (MonitoringOff.isMonitored, as the server reads the group).
 */

export const MONITOR_GROUP_STATUS_HINT: string = translationKey(
  "Show which monitors and why",
);

export const MONITOR_GROUP_STATUS_TITLE: string = translationKey(
  "Why is this group {{status}}?",
);

export const MONITOR_GROUP_STATUS_DESCRIPTION: string = translationKey(
  "The monitors of this group that are not operational now, and what set their status.",
);

export const MONITOR_GROUP_STATUS_EMPTY: string = translationKey(
  "Every monitor of this group is operational now.",
);

export const MONITOR_GROUP_STATUS_LOAD_FAILED: string = translationKey(
  "Couldn't read this group's monitors.",
);

const STARTED_TEMPLATE: string = translationKey("Started {{time}}");

// A group monitor, as the dialog reads it.
export interface MonitorGroupStatusRow {
  monitorId: string;
  name: string;
  statusName: string;
  isOperationalState: boolean;
  isOfflineState: boolean;
  // Whether the group's status counts it: not archived, monitoring on.
  isMonitored: boolean;
}

// A monitor's current status event: when it began, and what set it.
export interface MonitorGroupStatusEvent {
  monitorId: string;
  startsAt?: Date | undefined;
  rootCause?: string | undefined;
}

// What set a monitor's status, in one line: the criteria and its finding.
export function getStatusReasonText(
  reason: MonitorStatusReason | null,
  translator: Translator,
): string | undefined {
  if (!reason) {
    return undefined;
  }

  if (reason.note) {
    return reason.note;
  }

  const finding: string = reason.findings[0] || reason.cause || "";

  if (!reason.criteriaName) {
    return finding || undefined;
  }

  const criteria: string = translator.translateTemplate(LABEL_WITH_COLON, {
    label: reason.criteriaName,
  });

  return finding ? `${criteria} ${finding}` : criteria;
}

export function getMonitorGroupStatusItems(data: {
  monitors: Array<MonitorGroupStatusRow>;
  events: Array<MonitorGroupStatusEvent>;
  translator: Translator;
  getMonitorRoute: (monitorId: string) => Route;
}): Array<ResourceAttentionItem> {
  // Each monitor's newest open event: the events come newest first.
  const eventByMonitor: Map<string, MonitorGroupStatusEvent> = new Map<
    string,
    MonitorGroupStatusEvent
  >();

  for (const event of data.events) {
    if (event.monitorId && !eventByMonitor.has(event.monitorId)) {
      eventByMonitor.set(event.monitorId, event);
    }
  }

  const items: Array<ResourceAttentionItem> = [];

  for (const monitor of data.monitors) {
    if (
      !monitor.isMonitored ||
      !monitor.statusName ||
      monitor.isOperationalState
    ) {
      continue;
    }

    const event: MonitorGroupStatusEvent | undefined = eventByMonitor.get(
      monitor.monitorId,
    );

    items.push({
      key: `monitor-${monitor.monitorId}`,
      kind: "Monitor",
      icon: IconProp.AltGlobe,
      name: monitor.name || monitor.monitorId,
      severity: monitor.isOfflineState
        ? ResourceAttentionSeverity.Critical
        : ResourceAttentionSeverity.Warning,
      reasons: [
        {
          text: "{{reason}}",
          values: {
            reason: translateRecordName(
              data.translator,
              StateListType.MonitorStatus,
              monitor.statusName,
            ),
          },
        },
      ],
      explanation: getStatusReasonText(
        readMonitorStatusReason({
          rootCause: event?.rootCause,
          translator: data.translator,
        }),
        data.translator,
      ),
      since: event?.startsAt
        ? { at: event.startsAt, template: STARTED_TEMPLATE }
        : undefined,
      route: data.getMonitorRoute(monitor.monitorId),
    });
  }

  return sortResourceAttention(items);
}

/*
 * The group's monitors, then the open status events of those that are not
 * operational - one read each. A failed read of the events still lists the
 * monitors and their statuses: why is a supplement.
 */
export async function loadMonitorGroupStatusReason(data: {
  monitorGroupId: ObjectID;
  translator: Translator;
  getMonitorRoute: (monitorId: string) => Route;
}): Promise<ResourceAttentionDialogRead> {
  const resources: ListResult<MonitorGroupResource> =
    await ModelAPI.getList<MonitorGroupResource>({
      modelType: MonitorGroupResource,
      query: { monitorGroupId: data.monitorGroupId },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        monitorId: true,
        monitor: {
          _id: true,
          name: true,
          ...MONITORED_SELECT,
          currentMonitorStatus: {
            name: true,
            isOperationalState: true,
            isOfflineState: true,
          },
        },
      },
      sort: {},
    });

  const monitors: Array<MonitorGroupStatusRow> = resources.data
    .filter((resource: MonitorGroupResource): boolean => {
      return Boolean(resource.monitor);
    })
    .map((resource: MonitorGroupResource): MonitorGroupStatusRow => {
      return {
        monitorId:
          resource.monitor?._id?.toString() ||
          resource.monitorId?.toString() ||
          "",
        name: resource.monitor?.name || "",
        statusName: resource.monitor?.currentMonitorStatus?.name || "",
        isOperationalState: Boolean(
          resource.monitor?.currentMonitorStatus?.isOperationalState,
        ),
        isOfflineState: Boolean(
          resource.monitor?.currentMonitorStatus?.isOfflineState,
        ),
        isMonitored: MonitoringOff.isMonitored(resource.monitor),
      };
    });

  const notOperationalIds: Array<string> = monitors
    .filter((monitor: MonitorGroupStatusRow): boolean => {
      return (
        monitor.isMonitored &&
        Boolean(monitor.statusName) &&
        !monitor.isOperationalState
      );
    })
    .map((monitor: MonitorGroupStatusRow): string => {
      return monitor.monitorId;
    });

  let events: Array<MonitorGroupStatusEvent> = [];

  if (notOperationalIds.length > 0) {
    try {
      const rows: ListResult<MonitorStatusTimeline> =
        await ModelAPI.getList<MonitorStatusTimeline>({
          modelType: MonitorStatusTimeline,
          query: {
            monitorId: new Includes(notOperationalIds),
            endsAt: new IsNull(),
          },
          limit: Math.min(notOperationalIds.length * 2, LIMIT_PER_PROJECT),
          skip: 0,
          select: {
            monitorId: true,
            startsAt: true,
            rootCause: true,
          },
          sort: { startsAt: SortOrder.Descending },
        });

      events = rows.data.map(
        (row: MonitorStatusTimeline): MonitorGroupStatusEvent => {
          return {
            monitorId: row.monitorId?.toString() || "",
            startsAt: row.startsAt
              ? OneUptimeDate.fromString(row.startsAt)
              : undefined,
            rootCause: row.rootCause?.toString() || undefined,
          };
        },
      );
    } catch {
      events = [];
    }
  }

  return {
    items: getMonitorGroupStatusItems({
      monitors: monitors,
      events: events,
      translator: data.translator,
      getMonitorRoute: data.getMonitorRoute,
    }),
  };
}
