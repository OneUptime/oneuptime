import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { compareListOrderItems, ListOrderItem } from "../../../Utils/ListOrder";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import MonitorService from "../../Services/MonitorService";
import MonitorStatusService from "../../Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../Services/MonitorStatusTimelineService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../Services/ScheduledMaintenanceStateTimelineService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import { MONITOR_PAUSE_FLAGS_SELECT } from "../../../Utils/Monitor/MonitorPauseState";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WHEN AN INCIDENT DECLARED BY HAND PAUSES A MONITOR (issue #11141).
 *
 * An incident someone declares - in the Dashboard, from an alert, in Slack
 * or Microsoft Teams, with the API, Terraform, a workflow or Ask AI - holds
 * its monitors while it is open: it puts them in its Change Monitor Status
 * to status and pauses their checks, so no check sets another status over
 * the one it put them in. Resolving it, taking a monitor off it or deleting
 * it gives them back (IncidentService.markMonitorsActiveForMonitoring).
 *
 * Whether a monitor is paused is worked out here from the incidents that
 * pause it, never kept apart from them: an open incident pauses a monitor
 * when
 *
 *   - it lists the monitor and was declared by hand
 *     (Incident.isCreatedAutomatically false: OneUptime's own - a monitor's
 *     criteria, an alert's incident rule, an SLO - pause nothing);
 *   - it holds its monitors (Incident.holdsMonitors not false): declared
 *     open, or edited while open. One declared already resolved, or
 *     resolved once and reopened since, holds nothing;
 *   - it pauses monitoring (Incident.pauseMonitoring, on unless it was
 *     declared, or edited, with Pause Monitoring off);
 *
 * and the monitor is not set to keep monitoring during incidents
 * (Monitor.keepMonitoringDuringIncidents). Every change that can move one
 * of these - an incident declared, edited, resolved or deleted, a monitor's
 * setting switched - asks again (syncMonitors), so the flag the probes and
 * ingest read (Monitor.disableActiveMonitoringBecauseOfManualIncident) is
 * always what the incidents say.
 *
 * The flag used to be set when an incident paused the monitor and cleared
 * by the next resolve that found no other open incident declared by hand on
 * it. A reopened incident holds nothing, so it never paused the monitor and
 * its resolve never gave it back - but it still counted as one keeping the
 * monitor paused, so the resolve of the incident that did pause it left the
 * monitor paused for good: never checked again, its incoming requests
 * dropped and its last status counted as its uptime.
 *
 * WHAT PAUSED TIME COUNTS AS.
 *
 * A paused monitor keeps the status it holds. When a pausing incident puts
 * its monitors in a status, that is the status someone declared, and it
 * counts. When none of them does, the status is only what the monitor's
 * last check saw before the pause, and nothing checks it since: like time
 * with monitoring turned off (issue #6480), that time is left out of uptime,
 * status pages and SLOs - marked on the monitor's status timeline
 * (MonitorStatusTimeline.isMonitoringOff) until the pause ends or something
 * puts a status on the monitor (markUptime).
 *
 * A scheduled maintenance event in progress pauses its monitors the same way
 * (Monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent), and
 * its time counts the same way (issue #11301): as the status the event puts
 * them in (Change Monitor Status to), or left out when it puts them in none.
 * A monitor paused by both counts its time when any of what pauses it puts
 * it in a status, and leaves it out when none does. The maintenance events'
 * state changes and edits work their monitors out here too
 * (ScheduledMaintenanceStateTimelineService, ScheduledMaintenanceService).
 *
 * WHICH STATUS A MONITOR SEVERAL PAUSES HOLD IS IN (issue #11432).
 *
 * Incidents declared by hand and maintenance events can hold one monitor at
 * once, each with a status of its own. The monitor is in the most severe of
 * them: the one furthest down the project's list of monitor statuses (its
 * Order, MonitorStatus.priority - the list's own order, the older first at
 * one number), the status that wins wherever statuses meet, as on a status
 * page or in a monitor group (findHeldStatus). Every pause and every release
 * comes through here for it: a pause that starts, or changes the status it
 * sets, puts its status only on the monitors no more severe status holds
 * (getMonitorsTakingStatus), and one that lets go, or no longer sets one,
 * leaves each monitor in the most severe status of what still holds it
 * (putInHeldStatus: IncidentService.markMonitorsActiveForMonitoring and
 * ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors).
 *
 * The most severe, not the newest: a monitor is never shown better than an
 * open incident or a maintenance event in progress says it is - a minor
 * incident declared on a monitor in a major outage leaves it in the major
 * outage until that is resolved - and the status depends only on what holds
 * the monitor now, never on the order they came in, which nothing records
 * (an event starts long after it was made, a monitor joins an incident
 * later). Each pause that let go used to leave its own status behind: INC-1
 * in Major Outage and INC-2 in Degraded, resolving INC-2 left the monitor
 * Degraded until INC-1 was resolved too, and the end of one of two events
 * left the monitor in the status of the one that had ended.
 */

/*
 * What a monitor is read with before it can be worked out: every flag that
 * stops it being checked (MonitorPauseState). An archived monitor is worked
 * out as any other - archiving marks nothing on its status timeline, so
 * what pauses it still says what its time counts as - and only monitoring
 * turned off by hand is left to the switch's own marks (markUptime).
 */
const MONITOR_SELECT: {
  _id: true;
  projectId: true;
  keepMonitoringDuringIncidents: true;
  currentMonitorStatusId: true;
} & typeof MONITOR_PAUSE_FLAGS_SELECT = {
  _id: true,
  projectId: true,
  keepMonitoringDuringIncidents: true,
  currentMonitorStatusId: true,
  ...MONITOR_PAUSE_FLAGS_SELECT,
};

// How a monitor status is read before it is weighed against another.
const STATUS_ORDER_SELECT: {
  _id: true;
  priority: true;
  createdAt: true;
} = {
  _id: true,
  priority: true,
  createdAt: true,
};

// How a monitor stands, once worked out (syncPause).
export interface MonitorIncidentPauseState {
  monitor: Monitor;
  // The open incidents declared by hand that pause it, oldest first.
  pausingIncidents: Array<Incident>;
  // Whether those incidents pause it now: what the flag holds from here.
  isPaused: boolean;
  /*
   * The scheduled maintenance events in progress that hold it, oldest first,
   * each with the status it puts its monitors in: read while maintenance
   * pauses it (Monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent,
   * #11301). None while it does not.
   */
  holdingMaintenanceEvents?: Array<ScheduledMaintenance> | undefined;
}

// What isLeftOutOfUptime reads of a state.
export type MonitorPauseUptimeState = Pick<
  MonitorIncidentPauseState,
  "isPaused" | "pausingIncidents"
> &
  Partial<
    Pick<MonitorIncidentPauseState, "monitor" | "holdingMaintenanceEvents">
  >;

/*
 * The status what pauses a monitor holds it in (#11432): the most severe of
 * the statuses its pausing incidents and maintenance events put it in, and
 * what puts it there.
 */
export interface MonitorHeldStatus {
  monitorStatusId: ObjectID;
  /*
   * What puts the monitor in it, as the note names it: the newest of the
   * pausing incidents that set it, or - when none does - the newest of the
   * maintenance events.
   */
  incident?: Incident | undefined;
  scheduledMaintenance?: ScheduledMaintenance | undefined;
  /*
   * Whether what pauses the monitor sets more than one status, so this one
   * was chosen as the most severe of them.
   */
  isMostSevereOfSeveral: boolean;
}

export default class MonitorIncidentPause {
  /*
   * Whether an incident pauses its monitors while it is open, by what it is
   * rather than by its state: declared by hand, holding its monitors and
   * pausing monitoring. Read with isCreatedAutomatically, holdsMonitors and
   * pauseMonitoring; a column read as undefined counts as its default.
   */
  public static pausesItsMonitors(
    incident: Pick<
      Incident,
      "isCreatedAutomatically" | "holdsMonitors" | "pauseMonitoring"
    >,
  ): boolean {
    return (
      incident.isCreatedAutomatically !== true &&
      incident.holdsMonitors !== false &&
      incident.pauseMonitoring !== false
    );
  }

  /*
   * Whether a monitor that pausing incidents or scheduled maintenance hold
   * has its time left out of uptime: none of what pauses it puts it in a
   * status, so the status it keeps is only what its last check saw.
   */
  public static isLeftOutOfUptime(state: MonitorPauseUptimeState): boolean {
    const isPausedForMaintenance: boolean =
      MonitorIncidentPause.isPausedForMaintenance(state);

    if (!state.isPaused && !isPausedForMaintenance) {
      return false;
    }

    return (
      !MonitorIncidentPause.getStatusSettingIncidents(state).length &&
      !MonitorIncidentPause.getStatusSettingMaintenanceEvents(state).length
    );
  }

  /*
   * Whether a scheduled maintenance event in progress pauses the monitor:
   * its flag, as the event's start set it and its end clears it.
   */
  public static isPausedForMaintenance(
    state: Partial<Pick<MonitorIncidentPauseState, "monitor">>,
  ): boolean {
    return (
      state.monitor
        ?.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent === true
    );
  }

  // The pausing incidents that put the monitor in a status, oldest first.
  public static getStatusSettingIncidents(
    state: Pick<MonitorIncidentPauseState, "isPaused" | "pausingIncidents">,
  ): Array<Incident> {
    if (!state.isPaused) {
      return [];
    }

    return state.pausingIncidents.filter((incident: Incident): boolean => {
      return Boolean(incident.changeMonitorStatusToId);
    });
  }

  // The maintenance events holding the monitor that put it in a status, oldest first.
  public static getStatusSettingMaintenanceEvents(
    state: Partial<
      Pick<MonitorIncidentPauseState, "monitor" | "holdingMaintenanceEvents">
    >,
  ): Array<ScheduledMaintenance> {
    if (!MonitorIncidentPause.isPausedForMaintenance(state)) {
      return [];
    }

    return (state.holdingMaintenanceEvents || []).filter(
      (scheduledMaintenance: ScheduledMaintenance): boolean => {
        return Boolean(scheduledMaintenance.changeMonitorStatusToId);
      },
    );
  }

  /*
   * The open incidents declared by hand that pause the monitor, oldest
   * first, whatever the monitor's own setting says: those that list it,
   * hold their monitors and pause monitoring. Held filtered here rather
   * than in the query: Incident.holdsMonitors is null for an incident from
   * before it was recorded, which holds its monitors, and a comparison with
   * false would leave those out.
   */
  @CaptureSpan()
  public static async findIncidentsPausing(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
  }): Promise<Array<Incident>> {
    const unresolvedStateIds: Array<ObjectID> =
      await IncidentStateService.getUnresolvedIncidentStateIds(data.projectId);

    if (unresolvedStateIds.length === 0) {
      return [];
    }

    const incidents: Array<Incident> = await IncidentService.findBy({
      query: {
        projectId: data.projectId,
        monitors: QueryHelper.inRelationArray([data.monitorId]),
        currentIncidentStateId: QueryHelper.any(unresolvedStateIds),
        isCreatedAutomatically: false,
        pauseMonitoring: true,
      },
      select: {
        _id: true,
        projectId: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        changeMonitorStatusToId: true,
        isCreatedAutomatically: true,
        holdsMonitors: true,
        pauseMonitoring: true,
      },
      sort: {
        createdAt: SortOrder.Ascending,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return incidents.filter((incident: Incident): boolean => {
      return MonitorIncidentPause.pausesItsMonitors(incident);
    });
  }

  /*
   * Pauses the monitor, or resumes it, as its incidents say now, and says
   * how it stands. Null for a monitor that is gone. The flag is written only
   * when it changes, as root: a resume makes the monitor's probes due again
   * (MonitorService.liftsAPause).
   */
  @CaptureSpan()
  public static async syncPause(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
  }): Promise<MonitorIncidentPauseState | null> {
    const state: MonitorIncidentPauseState | null =
      await MonitorIncidentPause.readPause(data);

    if (!state) {
      return null;
    }

    if (
      state.isPaused !==
      (state.monitor.disableActiveMonitoringBecauseOfManualIncident === true)
    ) {
      await MonitorService.updateOneById({
        id: data.monitorId,
        data: {
          disableActiveMonitoringBecauseOfManualIncident: state.isPaused,
        },
        props: {
          isRoot: true,
        },
      });

      state.monitor.disableActiveMonitoringBecauseOfManualIncident =
        state.isPaused;
    }

    return state;
  }

  /*
   * How the monitor stands, as syncPause works it out, writing nothing: the
   * open incidents declared by hand that pause it, whether they do, and the
   * maintenance events holding it. Null for a monitor that is gone.
   */
  @CaptureSpan()
  public static async readPause(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
  }): Promise<MonitorIncidentPauseState | null> {
    const monitor: Monitor | null = await MonitorService.findOneById({
      id: data.monitorId,
      select: MONITOR_SELECT,
      props: {
        isRoot: true,
      },
    });

    if (!monitor) {
      return null;
    }

    const pausingIncidents: Array<Incident> =
      monitor.keepMonitoringDuringIncidents === true
        ? []
        : await MonitorIncidentPause.findIncidentsPausing({
            projectId: monitor.projectId || data.projectId,
            monitorId: data.monitorId,
          });

    /*
     * What the scheduled maintenance pausing it puts it in, read only while
     * maintenance does pause it (#11301): its time counts as any of them
     * says.
     */
    const holdingMaintenanceEvents: Array<ScheduledMaintenance> =
      monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent === true
        ? await ScheduledMaintenanceStateTimelineService.findEventsHoldingMonitor(
            data.monitorId,
          )
        : [];

    return {
      monitor: monitor,
      pausingIncidents: pausingIncidents,
      isPaused: pausingIncidents.length > 0,
      holdingMaintenanceEvents: holdingMaintenanceEvents,
    };
  }

  /*
   * Marks on the monitor's status timeline whether its time counts from
   * here, as it stands (syncPause): left out while the incidents and the
   * scheduled maintenance pausing it put it in no status, counted again once
   * one of them does or the pause ends. Nothing is written when the latest
   * status event already says so, nor while the monitor's monitoring is
   * turned off - its own switch then speaks for the time (MonitorService),
   * and it is left out anyway.
   */
  @CaptureSpan()
  public static async markUptime(
    state: MonitorIncidentPauseState,
  ): Promise<void> {
    const monitorId: ObjectID | undefined = state.monitor.id || undefined;

    if (!monitorId || state.monitor.disableActiveMonitoring === true) {
      return;
    }

    const isLeftOut: boolean = MonitorIncidentPause.isLeftOutOfUptime(state);

    const latest: MonitorStatusTimeline | null =
      await MonitorStatusTimelineService.findOneBy({
        query: {
          monitorId: monitorId,
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        select: {
          _id: true,
          isMonitoringOff: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!latest || (latest.isMonitoringOff === true) === isLeftOut) {
      return;
    }

    await MonitorStatusTimelineService.recordMonitoringSwitch({
      monitorId: monitorId,
      isMonitoringOff: isLeftOut,
      rootCause: await MonitorIncidentPause.getUptimeRootCause(state),
    });
  }

  /*
   * Works out each monitor again (syncPause) and marks its time
   * (markUptime). Each monitor on its own: one that fails is logged and the
   * rest go on, since a monitor left paused by mistake is never checked
   * again. A scheduled maintenance event's start, end and edits ask the same
   * of its monitors (#11301): the incidents' pause of each is worked out
   * with it, which writes nothing when it is already what they say.
   *
   * `putInHeldStatus` - for a change to what pauses the monitors, or to the
   * status one of them sets (#11432): each monitor is put in the most
   * severe status of what pauses it first, when it is not in it already
   * (putInHeldStatus), so an incident edited to a lesser status, or one that
   * stops pausing, leaves the monitor in the status of what still holds it.
   * A data migration works the pauses out without it, changing no status.
   */
  @CaptureSpan()
  public static async syncMonitors(data: {
    projectId: ObjectID;
    monitorIds: Array<ObjectID>;
    putInHeldStatus?: boolean | undefined;
  }): Promise<void> {
    for (const monitorId of data.monitorIds) {
      try {
        const state: MonitorIncidentPauseState | null =
          await MonitorIncidentPause.syncPause({
            projectId: data.projectId,
            monitorId: monitorId,
          });

        if (state) {
          if (data.putInHeldStatus) {
            await MonitorIncidentPause.putInHeldStatus({ state: state });
          }

          await MonitorIncidentPause.markUptime(state);
        }
      } catch (error) {
        logger.error(
          `MonitorIncidentPause.syncMonitors: working out whether monitor ${monitorId.toString()} is paused, and what its time counts as, failed; continuing with the remaining monitors.`,
          {
            projectId: data.projectId.toString(),
            monitorId: monitorId.toString(),
          } as LogAttributes,
        );
        logger.error(error);
      }
    }
  }

  /*
   * Why the monitor's time is left out from here, or counted again, as the
   * status event that marks it says: Markdown, each incident and each
   * maintenance event a link to it. Each sentence is a note of the
   * Dashboard's (Utils/Monitor/StatusChangeNotes), which words it in the
   * reader's language.
   */
  public static async getUptimeRootCause(
    state: MonitorIncidentPauseState,
  ): Promise<string> {
    if (MonitorIncidentPause.isLeftOutOfUptime(state)) {
      const isPausedForMaintenance: boolean =
        MonitorIncidentPause.isPausedForMaintenance(state);

      if (isPausedForMaintenance) {
        const events: MarkdownText =
          await MonitorIncidentPause.linkMaintenanceEvents(
            state.holdingMaintenanceEvents || [],
          );

        if (state.isPaused) {
          const incidents: MarkdownText =
            await MonitorIncidentPause.linkIncidents(state.pausingIncidents);

          return mdText`Monitoring is paused by ${incidents}, declared by hand, and by scheduled maintenance (${events}), with no status set for this monitor. Nothing checks the monitor until both are over, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.`.toString();
        }

        return mdText`Monitoring is paused by scheduled maintenance (${events}), with no status set for this monitor. Nothing checks the monitor until the maintenance ends, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.`.toString();
      }

      const incidents: MarkdownText = await MonitorIncidentPause.linkIncidents(
        state.pausingIncidents,
      );

      return mdText`Monitoring is paused by ${incidents}, declared by hand without a status for this monitor. Nothing checks the monitor until the incident is resolved, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.`.toString();
    }

    const statusSettingIncidents: Array<Incident> =
      MonitorIncidentPause.getStatusSettingIncidents(state);

    if (statusSettingIncidents.length > 0) {
      const incidents: MarkdownText = await MonitorIncidentPause.linkIncidents(
        statusSettingIncidents,
      );

      return mdText`${incidents} puts this monitor in its status, so uptime, status pages and SLOs count the monitor's time again from here.`.toString();
    }

    const statusSettingEvents: Array<ScheduledMaintenance> =
      MonitorIncidentPause.getStatusSettingMaintenanceEvents(state);

    if (statusSettingEvents.length > 0) {
      const events: MarkdownText =
        await MonitorIncidentPause.linkMaintenanceEvents(statusSettingEvents);

      return mdText`Scheduled maintenance (${events}) puts this monitor in its status, so uptime, status pages and SLOs count the monitor's time again from here.`.toString();
    }

    return mdText`Monitoring resumed. Uptime, status pages and SLOs count the monitor's time again from here.`.toString();
  }

  /*
   * The ids of the statuses what pauses the monitor puts it in: those of its
   * pausing incidents, then those of the maintenance events holding it, each
   * once, in that order.
   */
  public static getStatusIdsSet(
    state: MonitorPauseUptimeState,
  ): Array<ObjectID> {
    const ids: Map<string, ObjectID> = new Map<string, ObjectID>();

    const statusIds: Array<ObjectID | undefined> = [
      ...MonitorIncidentPause.getStatusSettingIncidents(state).map(
        (incident: Incident): ObjectID | undefined => {
          return incident.changeMonitorStatusToId;
        },
      ),
      ...MonitorIncidentPause.getStatusSettingMaintenanceEvents(state).map(
        (scheduledMaintenance: ScheduledMaintenance): ObjectID | undefined => {
          return scheduledMaintenance.changeMonitorStatusToId;
        },
      ),
    ];

    for (const statusId of statusIds) {
      if (!statusId) {
        continue;
      }

      const key: string = MonitorIncidentPause.idKey(statusId);

      if (!ids.has(key)) {
        ids.set(key, statusId);
      }
    }

    return Array.from(ids.values());
  }

  /*
   * THE RULE (#11432): of the statuses what pauses the monitor puts it in,
   * the most severe - the last in the project's list of monitor statuses as
   * it is shown, by Order, the older first at one number, then by id
   * (compareListOrderItems): the status that wins wherever statuses meet.
   * `statuses` are those statuses as read; one not among them (deleted, or
   * another project's) is no status the monitor can be put in, and is passed
   * over. Null when what pauses the monitor puts it in none.
   *
   * Named in the note: the newest pausing incident that sets that status,
   * or, when none does, the newest maintenance event that does. Pure, so
   * the rule is tested without a database.
   */
  public static pickHeldStatus(data: {
    state: MonitorPauseUptimeState;
    statuses: ReadonlyArray<MonitorStatus>;
  }): MonitorHeldStatus | null {
    const statusByKey: Map<string, MonitorStatus> = new Map<
      string,
      MonitorStatus
    >();

    for (const status of data.statuses) {
      if (status.id) {
        statusByKey.set(MonitorIncidentPause.idKey(status.id), status);
      }
    }

    const candidates: Array<MonitorStatus> = [];

    for (const statusId of MonitorIncidentPause.getStatusIdsSet(data.state)) {
      const status: MonitorStatus | undefined = statusByKey.get(
        MonitorIncidentPause.idKey(statusId),
      );

      if (status) {
        candidates.push(status);
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    const mostSevere: MonitorStatus =
      MonitorIncidentPause.getMostSevereStatus(candidates);
    const mostSevereKey: string = MonitorIncidentPause.idKey(mostSevere.id!);

    const isSettingIt: (setter: {
      changeMonitorStatusToId?: ObjectID | undefined;
    }) => boolean = (setter: {
      changeMonitorStatusToId?: ObjectID | undefined;
    }): boolean => {
      return (
        Boolean(setter.changeMonitorStatusToId) &&
        MonitorIncidentPause.idKey(setter.changeMonitorStatusToId!) ===
          mostSevereKey
      );
    };

    const incident: Incident | undefined = [
      ...MonitorIncidentPause.getStatusSettingIncidents(data.state),
    ]
      .reverse()
      .find(isSettingIt);

    const scheduledMaintenance: ScheduledMaintenance | undefined = incident
      ? undefined
      : [...MonitorIncidentPause.getStatusSettingMaintenanceEvents(data.state)]
          .reverse()
          .find(isSettingIt);

    return {
      monitorStatusId: new ObjectID(mostSevere.id!.toString()),
      incident: incident,
      scheduledMaintenance: scheduledMaintenance,
      isMostSevereOfSeveral: candidates.length > 1,
    };
  }

  /*
   * Of these statuses, the most severe: the last of them in the project's
   * list, as it is shown (compareListOrderItems, by Order - the
   * MonitorStatus priority - then the older first, then by id).
   */
  public static getMostSevereStatus(
    statuses: ReadonlyArray<MonitorStatus>,
  ): MonitorStatus {
    const toListOrderItem: (status: MonitorStatus) => ListOrderItem = (
      status: MonitorStatus,
    ): ListOrderItem => {
      return {
        id: MonitorIncidentPause.idKey(status.id!),
        value: status.priority,
        createdAt: status.createdAt,
      };
    };

    return [...statuses].sort((a: MonitorStatus, b: MonitorStatus): number => {
      return compareListOrderItems(
        toListOrderItem(a),
        toListOrderItem(b),
        SortOrder.Ascending,
      );
    })[statuses.length - 1]!;
  }

  /*
   * The status what pauses the monitor holds it in (pickHeldStatus), its
   * statuses read as they stand. Null when what pauses it puts it in none.
   */
  @CaptureSpan()
  public static async findHeldStatus(
    state: MonitorPauseUptimeState,
  ): Promise<MonitorHeldStatus | null> {
    const statusIds: Array<ObjectID> =
      MonitorIncidentPause.getStatusIdsSet(state);

    if (statusIds.length === 0) {
      return null;
    }

    return MonitorIncidentPause.pickHeldStatus({
      state: state,
      statuses: await MonitorIncidentPause.readStatuses({
        projectId: state.monitor?.projectId,
        statusIds: statusIds,
      }),
    });
  }

  /*
   * Of these monitors, those a status may be put on now, by an incident
   * declared by hand - or edited, or given more monitors - or by a
   * maintenance event that starts, changes its status or is given more
   * monitors (#11432): each one nothing pausing it holds in a more severe
   * status. A monitor held in a more severe status stays in it, as the most
   * severe status of what pauses a monitor is the one it shows
   * (findHeldStatus): the change's status is its own again once the more
   * severe ones let go (putInHeldStatus). A status it holds already, or one
   * as severe, is put on it, as before.
   *
   * `writer` is the incident or event whose status it is. One that does not
   * hold the monitor - an incident with Pause Monitoring off, or on a
   * monitor set to keep monitoring during incidents - puts its status on it
   * only while nothing pausing it sets one: what holds a monitor decides
   * its status, and the next working out of the pause would put it back.
   *
   * Read as root, writing nothing. A monitor that cannot be read or worked
   * out is kept, so the change goes on for it as it did before this.
   */
  @CaptureSpan()
  public static async getMonitorsTakingStatus(data: {
    projectId: ObjectID;
    monitorIds: Array<ObjectID>;
    monitorStatusId: ObjectID;
    writer?:
      | {
          incidentId?: ObjectID | undefined;
          scheduledMaintenanceId?: ObjectID | undefined;
        }
      | undefined;
  }): Promise<Array<ObjectID>> {
    const taking: Array<ObjectID> = [];

    for (const monitorId of data.monitorIds) {
      try {
        const state: MonitorIncidentPauseState | null =
          await MonitorIncidentPause.readPause({
            projectId: data.projectId,
            monitorId: monitorId,
          });

        if (
          !state ||
          (await MonitorIncidentPause.isTakingStatus({
            state: state,
            monitorStatusId: data.monitorStatusId,
            writer: data.writer,
          }))
        ) {
          taking.push(monitorId);
        }
      } catch (error) {
        logger.error(
          `MonitorIncidentPause.getMonitorsTakingStatus: working out whether monitor ${monitorId.toString()} is held in a more severe status failed; its status is changed as before.`,
          {
            projectId: data.projectId.toString(),
            monitorId: monitorId.toString(),
          } as LogAttributes,
        );
        logger.error(error);
        taking.push(monitorId);
      }
    }

    return taking;
  }

  /*
   * Whether a status may be put on a monitor as it stands: nothing pausing
   * it sets a status, or the writer holds it and none of what holds it
   * sets a status more severe than this one.
   */
  private static async isTakingStatus(data: {
    state: MonitorIncidentPauseState;
    monitorStatusId: ObjectID;
    writer?:
      | {
          incidentId?: ObjectID | undefined;
          scheduledMaintenanceId?: ObjectID | undefined;
        }
      | undefined;
  }): Promise<boolean> {
    const heldStatusIds: Array<ObjectID> = MonitorIncidentPause.getStatusIdsSet(
      data.state,
    );

    if (heldStatusIds.length === 0) {
      return true;
    }

    if (!MonitorIncidentPause.isWriterHolding(data)) {
      return false;
    }

    const statuses: Array<MonitorStatus> =
      await MonitorIncidentPause.readStatuses({
        projectId: data.state.monitor.projectId,
        statusIds: [...heldStatusIds, data.monitorStatusId],
      });

    const held: MonitorHeldStatus | null = MonitorIncidentPause.pickHeldStatus({
      state: data.state,
      statuses: statuses,
    });

    const status: MonitorStatus | undefined = statuses.find(
      (candidate: MonitorStatus): boolean => {
        return (
          Boolean(candidate.id) &&
          MonitorIncidentPause.idKey(candidate.id!) ===
            MonitorIncidentPause.idKey(data.monitorStatusId)
        );
      },
    );

    // A status it cannot weigh is put on it as before; the write decides.
    if (!held || !status) {
      return true;
    }

    const heldStatus: MonitorStatus = statuses.find(
      (candidate: MonitorStatus): boolean => {
        return (
          Boolean(candidate.id) &&
          MonitorIncidentPause.idKey(candidate.id!) ===
            MonitorIncidentPause.idKey(held.monitorStatusId)
        );
      },
    )!;

    return (
      MonitorIncidentPause.idKey(
        MonitorIncidentPause.getMostSevereStatus([heldStatus, status]).id!,
      ) === MonitorIncidentPause.idKey(data.monitorStatusId)
    );
  }

  /*
   * Whether the incident or event writing a status is among what holds the
   * monitor: a pausing incident, or a maintenance event holding it. A write
   * that names no writer is taken as one that does.
   */
  private static isWriterHolding(data: {
    state: MonitorIncidentPauseState;
    writer?:
      | {
          incidentId?: ObjectID | undefined;
          scheduledMaintenanceId?: ObjectID | undefined;
        }
      | undefined;
  }): boolean {
    const incidentId: ObjectID | undefined = data.writer?.incidentId;
    const scheduledMaintenanceId: ObjectID | undefined =
      data.writer?.scheduledMaintenanceId;

    if (incidentId) {
      return (
        data.state.isPaused &&
        data.state.pausingIncidents.some((incident: Incident): boolean => {
          return (
            Boolean(incident.id) &&
            MonitorIncidentPause.idKey(incident.id!) ===
              MonitorIncidentPause.idKey(incidentId)
          );
        })
      );
    }

    if (scheduledMaintenanceId) {
      return (
        MonitorIncidentPause.isPausedForMaintenance(data.state) &&
        (data.state.holdingMaintenanceEvents || []).some(
          (scheduledMaintenance: ScheduledMaintenance): boolean => {
            return (
              Boolean(scheduledMaintenance.id) &&
              MonitorIncidentPause.idKey(scheduledMaintenance.id!) ===
                MonitorIncidentPause.idKey(scheduledMaintenanceId)
            );
          },
        )
      );
    }

    return true;
  }

  /*
   * Puts the monitor in the status what pauses it holds it in - the most
   * severe of theirs (findHeldStatus) - when it is not in it already: what
   * a pause that lets go, or stops setting a status, leaves the monitor in
   * (#11432). The release of an incident and the end of an event both come
   * here (IncidentService.markMonitorsActiveForMonitoring,
   * ScheduledMaintenanceStateTimelineService.enableActiveMonitoringForMonitors),
   * as does every change to what pauses a monitor (syncMonitors). Owners are
   * told, as when the release puts it back to operational; a monitor
   * already in the status is left as it is (MonitorService.changeMonitorStatus).
   *
   * Returns that status, or null when what pauses the monitor puts it in
   * none: the release then gives it back as when nothing holds it.
   */
  @CaptureSpan()
  public static async putInHeldStatus(data: {
    state: MonitorIncidentPauseState;
    // When the change that leads here happened: a resolve filled in back in time.
    startsAt?: Date | undefined;
  }): Promise<MonitorHeldStatus | null> {
    const held: MonitorHeldStatus | null =
      await MonitorIncidentPause.findHeldStatus(data.state);

    const monitorId: ObjectID | undefined = data.state.monitor.id || undefined;
    const projectId: ObjectID | undefined =
      data.state.monitor.projectId || undefined;

    if (!held || !monitorId || !projectId) {
      return held;
    }

    if (
      data.state.monitor.currentMonitorStatusId &&
      MonitorIncidentPause.idKey(data.state.monitor.currentMonitorStatusId) ===
        MonitorIncidentPause.idKey(held.monitorStatusId)
    ) {
      return held;
    }

    await MonitorService.changeMonitorStatus(
      projectId,
      [monitorId],
      held.monitorStatusId,
      true, // notifyOwners, as a release's move back to operational does.
      await MonitorIncidentPause.getHeldStatusRootCause(held),
      undefined,
      {
        isRoot: true,
      },
      data.startsAt,
    );

    data.state.monitor.currentMonitorStatusId = held.monitorStatusId;

    return held;
  }

  /*
   * Why the monitor is in the status what pauses it holds it in, on its
   * Status Timeline: Markdown, the incident or the event a link to it. Each
   * sentence is a note of the Dashboard's (Utils/Monitor/StatusChangeNotes),
   * which words it in the reader's language.
   */
  public static async getHeldStatusRootCause(
    held: MonitorHeldStatus,
  ): Promise<string> {
    if (held.incident) {
      const incident: MarkdownText = await MonitorIncidentPause.linkIncidents([
        held.incident,
      ]);

      return held.isMostSevereOfSeveral
        ? mdText`Of what still pauses this monitor, ${incident} puts it in the most severe status, so the monitor is in that status.`.toString()
        : mdText`${incident} is still open, so the monitor is in the status it puts it in.`.toString();
    }

    const event: MarkdownText =
      await MonitorIncidentPause.linkMaintenanceEvents(
        held.scheduledMaintenance ? [held.scheduledMaintenance] : [],
      );

    return held.isMostSevereOfSeveral
      ? mdText`Of what still pauses this monitor, scheduled maintenance (${event}) puts it in the most severe status, so the monitor is in that status.`.toString()
      : mdText`Scheduled maintenance (${event}) is still in progress, so the monitor is in the status it puts it in.`.toString();
  }

  // The statuses of these ids that are the project's, with their place in its list.
  private static async readStatuses(data: {
    projectId: ObjectID | undefined;
    statusIds: Array<ObjectID>;
  }): Promise<Array<MonitorStatus>> {
    if (!data.projectId || data.statusIds.length === 0) {
      return [];
    }

    return await MonitorStatusService.findBy({
      query: {
        _id: QueryHelper.any(data.statusIds),
        projectId: data.projectId,
      },
      select: STATUS_ORDER_SELECT,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  // An id as compared: its text, lower case.
  private static idKey(id: ObjectID | string): string {
    return id.toString().toLowerCase();
  }

  // The maintenance events as links to them: "SM-3", "SM-3 and SM-4".
  private static async linkMaintenanceEvents(
    scheduledMaintenanceEvents: Array<ScheduledMaintenance>,
  ): Promise<MarkdownText> {
    const links: Array<MarkdownText> = [];

    for (const scheduledMaintenance of scheduledMaintenanceEvents) {
      if (!scheduledMaintenance.id || !scheduledMaintenance.projectId) {
        continue;
      }

      const name: string =
        scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
        (scheduledMaintenance.scheduledMaintenanceNumber !== undefined &&
        scheduledMaintenance.scheduledMaintenanceNumber !== null
          ? `#${scheduledMaintenance.scheduledMaintenanceNumber}`
          : "an event");

      links.push(
        mdText`[${name}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(scheduledMaintenance.projectId, scheduledMaintenance.id)).toString()})`,
      );
    }

    return MonitorIncidentPause.joinLinks(links, mdText`an event`);
  }

  // The incidents as links to them: "INC-12", "INC-12 and INC-14".
  private static async linkIncidents(
    incidents: Array<Incident>,
  ): Promise<MarkdownText> {
    const links: Array<MarkdownText> = [];

    for (const incident of incidents) {
      if (!incident.id || !incident.projectId) {
        continue;
      }

      const name: string =
        incident.incidentNumberWithPrefix ||
        (incident.incidentNumber !== undefined &&
        incident.incidentNumber !== null
          ? `#${incident.incidentNumber}`
          : "an incident");

      links.push(
        mdText`[${name}](${(await IncidentService.getIncidentLinkInDashboard(incident.projectId, incident.id)).toString()})`,
      );
    }

    return MonitorIncidentPause.joinLinks(links, mdText`an incident`);
  }

  // Links as a list: "A", "A and B", "A, B and C"; `none` for no link.
  private static joinLinks(
    links: Array<MarkdownText>,
    none: MarkdownText,
  ): MarkdownText {
    if (links.length === 0) {
      return none;
    }

    if (links.length === 1) {
      return links[0]!;
    }

    return mdText`${FeedMarkdown.join(links.slice(0, -1), ", ")} and ${links[links.length - 1]!}`;
  }
}
