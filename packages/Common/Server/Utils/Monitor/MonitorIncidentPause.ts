import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import MonitorService from "../../Services/MonitorService";
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
} & typeof MONITOR_PAUSE_FLAGS_SELECT = {
  _id: true,
  projectId: true,
  keepMonitoringDuringIncidents: true,
  ...MONITOR_PAUSE_FLAGS_SELECT,
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

    const isPaused: boolean = pausingIncidents.length > 0;

    if (
      isPaused !==
      (monitor.disableActiveMonitoringBecauseOfManualIncident === true)
    ) {
      await MonitorService.updateOneById({
        id: data.monitorId,
        data: {
          disableActiveMonitoringBecauseOfManualIncident: isPaused,
        },
        props: {
          isRoot: true,
        },
      });

      monitor.disableActiveMonitoringBecauseOfManualIncident = isPaused;
    }

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
      isPaused: isPaused,
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
   */
  @CaptureSpan()
  public static async syncMonitors(data: {
    projectId: ObjectID;
    monitorIds: Array<ObjectID>;
  }): Promise<void> {
    for (const monitorId of data.monitorIds) {
      try {
        const state: MonitorIncidentPauseState | null =
          await MonitorIncidentPause.syncPause({
            projectId: data.projectId,
            monitorId: monitorId,
          });

        if (state) {
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
   * WHEN ONE OF WHAT PAUSES A MONITOR LETS GO WHILE ANOTHER STILL HOLDS IT.
   *
   * An incident declared by hand and a scheduled maintenance event can pause
   * one monitor at once, and whichever started last put it in its status.
   * When one lets go - the event ends, the incident is resolved - the one
   * still holding it puts it back in the status it puts it in: the newest of
   * them that puts it in one. Going back to operational there showed the
   * monitor up, on its status pages too and counted so in its uptime, while
   * an incident declared by hand still said it was down, or for the rest of
   * a maintenance event that sets a status of its own.
   *
   * Null when none of what still holds the monitor puts it in a status: it
   * goes back to operational, as before, and its time is left out until the
   * pause ends (markUptime).
   */
  public static async getStatusOfIncidentsStillPausing(
    state: MonitorIncidentPauseState,
  ): Promise<{ monitorStatusId: ObjectID; rootCause: string } | null> {
    const statusSettingIncidents: Array<Incident> =
      MonitorIncidentPause.getStatusSettingIncidents(state);
    const incident: Incident | undefined =
      statusSettingIncidents[statusSettingIncidents.length - 1];

    if (!incident?.changeMonitorStatusToId) {
      return null;
    }

    const incidentLink: MarkdownText = await MonitorIncidentPause.linkIncidents(
      [incident],
    );

    return {
      monitorStatusId: incident.changeMonitorStatusToId,
      rootCause:
        mdText`Scheduled maintenance is over, and ${incidentLink} is still open, so the monitor is back in the status the incident puts it in.`.toString(),
    };
  }

  // The same, for a monitor scheduled maintenance still holds.
  public static async getStatusOfMaintenanceStillHolding(
    state: MonitorIncidentPauseState,
  ): Promise<{ monitorStatusId: ObjectID; rootCause: string } | null> {
    const statusSettingEvents: Array<ScheduledMaintenance> =
      MonitorIncidentPause.getStatusSettingMaintenanceEvents(state);
    const scheduledMaintenance: ScheduledMaintenance | undefined =
      statusSettingEvents[statusSettingEvents.length - 1];

    if (!scheduledMaintenance?.changeMonitorStatusToId) {
      return null;
    }

    const eventLink: MarkdownText =
      await MonitorIncidentPause.linkMaintenanceEvents([scheduledMaintenance]);

    return {
      monitorStatusId: scheduledMaintenance.changeMonitorStatusToId,
      rootCause:
        mdText`Scheduled maintenance (${eventLink}) is still in progress, so the monitor is back in the status it puts it in.`.toString(),
    };
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
