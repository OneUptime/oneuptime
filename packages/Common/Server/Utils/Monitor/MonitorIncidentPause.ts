import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
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
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
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
 * counts, as maintenance's does. When none of them does, the status is only
 * what the monitor's last check saw before the pause, and nothing checks it
 * since: like time with monitoring turned off (issue #6480), that time is
 * left out of uptime, status pages and SLOs - marked on the monitor's
 * status timeline (MonitorStatusTimeline.isMonitoringOff) until the pause
 * ends or something puts a status on the monitor (markUptime).
 */

// What a monitor is read with before it can be worked out.
const MONITOR_SELECT: {
  _id: true;
  projectId: true;
  keepMonitoringDuringIncidents: true;
  disableActiveMonitoring: true;
  disableActiveMonitoringBecauseOfManualIncident: true;
} = {
  _id: true,
  projectId: true,
  keepMonitoringDuringIncidents: true,
  disableActiveMonitoring: true,
  disableActiveMonitoringBecauseOfManualIncident: true,
};

// How a monitor stands, once worked out (syncPause).
export interface MonitorIncidentPauseState {
  monitor: Monitor;
  // The open incidents declared by hand that pause it, oldest first.
  pausingIncidents: Array<Incident>;
  // Whether those incidents pause it now: what the flag holds from here.
  isPaused: boolean;
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
   * Whether a monitor that pausing incidents hold has its time left out of
   * uptime: none of them puts it in a status, so the status it keeps is only
   * what its last check saw.
   */
  public static isLeftOutOfUptime(
    state: Pick<MonitorIncidentPauseState, "isPaused" | "pausingIncidents">,
  ): boolean {
    return (
      state.isPaused &&
      !state.pausingIncidents.some((incident: Incident): boolean => {
        return Boolean(incident.changeMonitorStatusToId);
      })
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

    return {
      monitor: monitor,
      pausingIncidents: pausingIncidents,
      isPaused: isPaused,
    };
  }

  /*
   * Marks on the monitor's status timeline whether its time counts from
   * here, as it stands (syncPause): left out while pausing incidents put it
   * in no status, counted again once they do or the pause ends. Nothing is
   * written when the latest status event already says so, nor while the
   * monitor's monitoring is turned off - its own switch then speaks for the
   * time (MonitorService), and it is left out anyway.
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
   * again.
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
          `MonitorIncidentPause.syncMonitors: working out whether monitor ${monitorId.toString()} is paused by an incident failed; continuing with the remaining monitors.`,
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
   * status event that marks it says: Markdown, each incident a link to it.
   */
  public static async getUptimeRootCause(
    state: MonitorIncidentPauseState,
  ): Promise<string> {
    if (MonitorIncidentPause.isLeftOutOfUptime(state)) {
      const incidents: MarkdownText = await MonitorIncidentPause.linkIncidents(
        state.pausingIncidents,
      );

      return mdText`Monitoring is paused by ${incidents}, declared by hand without a status for this monitor. Nothing checks the monitor until the incident is resolved, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.`.toString();
    }

    if (state.isPaused) {
      const declaring: Array<Incident> = state.pausingIncidents.filter(
        (incident: Incident): boolean => {
          return Boolean(incident.changeMonitorStatusToId);
        },
      );

      const incidents: MarkdownText =
        await MonitorIncidentPause.linkIncidents(declaring);

      return mdText`${incidents} puts this monitor in its status, so uptime, status pages and SLOs count the monitor's time again from here.`.toString();
    }

    return mdText`Monitoring resumed. Uptime, status pages and SLOs count the monitor's time again from here.`.toString();
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

    if (links.length === 0) {
      return mdText`an incident`;
    }

    if (links.length === 1) {
      return links[0]!;
    }

    return mdText`${FeedMarkdown.join(links.slice(0, -1), ", ")} and ${links[links.length - 1]!}`;
  }
}
