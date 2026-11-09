import Alert from "../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import MonitorAutoResolveTemplates, {
  MonitorAutoResolveTemplateIds,
} from "../../../Utils/Monitor/MonitorAutoResolveTemplates";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import IncidentStateTimelineService from "../../Services/IncidentStateTimelineService";
import MonitorService from "../../Services/MonitorService";
import UserService from "../../Services/UserService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import MonitorAlert from "./MonitorAlert";
import MonitorIncident from "./MonitorIncident";

/*
 * WHAT A MONITOR LEAVES OPEN WHEN ITS MONITORING IS TURNED OFF.
 *
 * Nothing checks a monitor while its monitoring is off, so it can never again
 * resolve what it opened itself. An incident or alert whose criteria was set
 * to resolve on its own once the monitor recovers ("Auto resolve") was left
 * to the monitor to close - and stayed open for good, on Active Incidents and
 * Active Alerts, paging nobody about anything the monitor could still vouch
 * for (issue #6400).
 *
 * So when monitoring is turned off - the monitor's own switch, a list's
 * Disable, a monitor group's Turn off monitoring, the API - those are
 * resolved: exactly the open incidents and alerts a check that no longer
 * met their criteria would have resolved (MonitorAutoResolveTemplates, and
 * MonitorIncident / MonitorAlert's own isAutoResolveConfigured...). Each
 * says why on its timeline, naming the monitor and who turned it off. When
 * monitoring is turned back on and the problem is still there, the next check
 * opens a new one, as for any criteria with no incident open.
 *
 * Everything else stays open, as before: an incident someone declared, one
 * whose criteria has auto-resolve off (a person decides when that one is
 * over), and one another monitor opened that lists this one among those it
 * affects. A resolve is OneUptime's own change, credited to nobody - it
 * would otherwise make whoever flipped the switch the incident's commander -
 * and resolving gives the incident's monitors back as any resolve does.
 *
 * One record that fails to resolve is logged and does not stop the others;
 * nothing here fails the change that turned monitoring off.
 */

export interface MonitorTurnedOffResult {
  resolvedIncidentIds: Array<string>;
  resolvedAlertIds: Array<string>;
}

// What the root cause of a resolve says, for an incident or an alert.
type RecordKind = "incident" | "alert";

export default class MonitorTurnedOff {
  /*
   * Resolves what the monitor would have resolved itself, once its
   * monitoring is off. Reads the monitor first: when it is on again by now
   * (or gone), nothing is resolved - a check will look after its records.
   */
  @CaptureSpan()
  public static async resolveWhatItWouldHaveResolved(data: {
    monitorId: ObjectID;
    // Who turned monitoring off, when a person did. Named in the root cause.
    turnedOffByUserId?: ObjectID | null | undefined;
  }): Promise<MonitorTurnedOffResult> {
    const result: MonitorTurnedOffResult = {
      resolvedIncidentIds: [],
      resolvedAlertIds: [],
    };

    const monitor: Monitor | null = await MonitorService.findOneById({
      id: data.monitorId,
      select: {
        _id: true,
        projectId: true,
        name: true,
        monitorSteps: true,
        disableActiveMonitoring: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (
      !monitor ||
      !monitor.projectId ||
      monitor.disableActiveMonitoring !== true
    ) {
      return result;
    }

    const templateIds: MonitorAutoResolveTemplateIds =
      MonitorAutoResolveTemplates.fromMonitorSteps(monitor.monitorSteps);

    // No criteria of the monitor resolves anything on its own.
    if (MonitorAutoResolveTemplates.isEmpty(templateIds)) {
      return result;
    }

    const logAttributes: LogAttributes = {
      projectId: monitor.projectId.toString(),
      monitorId: data.monitorId.toString(),
    } as LogAttributes;

    // Read once, and only when something is resolved: it names a person.
    let turnedOffBy: MarkdownText | null = null;

    const getTurnedOffBy: () => Promise<MarkdownText> =
      async (): Promise<MarkdownText> => {
        if (turnedOffBy) {
          return turnedOffBy;
        }

        turnedOffBy = data.turnedOffByUserId
          ? await UserService.getUserMarkdownString({
              userId: data.turnedOffByUserId,
              projectId: monitor.projectId!,
            })
          : FeedMarkdown.empty();

        return turnedOffBy;
      };

    if (Object.keys(templateIds.incidents).length > 0) {
      try {
        result.resolvedIncidentIds = await this.resolveOpenIncidents({
          monitor: monitor,
          templateIds: templateIds,
          getTurnedOffBy: getTurnedOffBy,
          logAttributes: logAttributes,
        });
      } catch (err) {
        logger.error(
          `Resolving the open incidents of monitor ${data.monitorId.toString()} after its monitoring was turned off failed`,
          logAttributes,
        );
        logger.error(err, logAttributes);
      }
    }

    if (Object.keys(templateIds.alerts).length > 0) {
      try {
        result.resolvedAlertIds = await this.resolveOpenAlerts({
          monitor: monitor,
          templateIds: templateIds,
          getTurnedOffBy: getTurnedOffBy,
          logAttributes: logAttributes,
        });
      } catch (err) {
        logger.error(
          `Resolving the open alerts of monitor ${data.monitorId.toString()} after its monitoring was turned off failed`,
          logAttributes,
        );
        logger.error(err, logAttributes);
      }
    }

    return result;
  }

  /*
   * Why the record was resolved, on its timeline and in its feed: Markdown,
   * with the monitor's name and the person's placed as text (mdText).
   */
  public static getRootCause(data: {
    kind: RecordKind;
    monitorName: string;
    turnedOffBy: MarkdownText;
  }): string {
    const turnedOff: MarkdownText = data.turnedOffBy.isEmpty()
      ? mdText`Monitoring was turned off for the monitor **${data.monitorName}**.`
      : mdText`${data.turnedOffBy} turned off monitoring for the monitor **${data.monitorName}**.`;

    const why: MarkdownText =
      data.kind === "incident"
        ? mdText`This incident was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved now. If monitoring is turned back on while the problem is still there, a new incident is opened.`
        : mdText`This alert was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved now. If monitoring is turned back on while the problem is still there, a new alert is opened.`;

    return mdText`${turnedOff} ${why}`.toString();
  }

  private static async resolveOpenIncidents(data: {
    monitor: Monitor;
    templateIds: MonitorAutoResolveTemplateIds;
    getTurnedOffBy: () => Promise<MarkdownText>;
    logAttributes: LogAttributes;
  }): Promise<Array<string>> {
    const projectId: ObjectID = data.monitor.projectId!;

    // Open: in a state above the project's resolved state, as a check reads them.
    const openIncidents: Array<Incident> = await IncidentService.findBy({
      query: {
        monitors: [data.monitor.id!],
        projectId: projectId,
        currentIncidentStateId: QueryHelper.any(
          await IncidentStateService.getUnresolvedIncidentStateIds(projectId),
        ),
      },
      select: {
        _id: true,
        projectId: true,
        createdCriteriaId: true,
        createdIncidentTemplateId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    const incidentsToResolve: Array<Incident> = openIncidents.filter(
      (incident: Incident): boolean => {
        return MonitorIncident.isAutoResolveConfiguredForIncident({
          openIncident: incident,
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            data.templateIds.incidents,
        });
      },
    );

    if (incidentsToResolve.length === 0) {
      return [];
    }

    // Looked up once there is something to resolve: it throws for a project with none.
    const resolvedStateId: ObjectID =
      await IncidentStateTimelineService.getResolvedStateIdForProject(
        projectId,
      );

    const rootCause: string = this.getRootCause({
      kind: "incident",
      monitorName: data.monitor.name || "",
      turnedOffBy: await data.getTurnedOffBy(),
    });

    const resolvedIncidentIds: Array<string> = [];

    for (const incident of incidentsToResolve) {
      try {
        const timeline: IncidentStateTimeline = new IncidentStateTimeline();
        timeline.incidentId = incident.id!;
        timeline.incidentStateId = resolvedStateId;
        timeline.projectId = projectId;
        timeline.rootCause = rootCause;

        await IncidentStateTimelineService.create({
          data: timeline,
          props: {
            isRoot: true,
          },
        });

        resolvedIncidentIds.push(incident.id!.toString());
      } catch (err) {
        /*
         * Resolved meanwhile - by a person, or by a check that was already
         * on its way when monitoring was turned off: nothing is left to do.
         */
        if (
          err instanceof BadDataException &&
          err.message === "Incident state cannot be same as previous state."
        ) {
          continue;
        }

        logger.error(
          `Resolving incident ${incident.id?.toString()} after the monitoring of its monitor was turned off failed`,
          data.logAttributes,
        );
        logger.error(err, data.logAttributes);
      }
    }

    return resolvedIncidentIds;
  }

  private static async resolveOpenAlerts(data: {
    monitor: Monitor;
    templateIds: MonitorAutoResolveTemplateIds;
    getTurnedOffBy: () => Promise<MarkdownText>;
    logAttributes: LogAttributes;
  }): Promise<Array<string>> {
    const projectId: ObjectID = data.monitor.projectId!;

    const openAlerts: Array<Alert> = await AlertService.findBy({
      query: {
        monitorId: data.monitor.id!,
        projectId: projectId,
        currentAlertStateId: QueryHelper.any(
          await AlertStateService.getUnresolvedAlertStateIds(projectId),
        ),
      },
      select: {
        _id: true,
        projectId: true,
        createdCriteriaId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    const alertsToResolve: Array<Alert> = openAlerts.filter(
      (alert: Alert): boolean => {
        return MonitorAlert.isAutoResolveConfiguredForAlert({
          openAlert: alert,
          autoResolveCriteriaInstanceIdAlertIdsDictionary:
            data.templateIds.alerts,
        });
      },
    );

    if (alertsToResolve.length === 0) {
      return [];
    }

    const resolvedStateId: ObjectID =
      await AlertStateTimelineService.getResolvedStateIdForProject(projectId);

    const rootCause: string = this.getRootCause({
      kind: "alert",
      monitorName: data.monitor.name || "",
      turnedOffBy: await data.getTurnedOffBy(),
    });

    const resolvedAlertIds: Array<string> = [];

    for (const alert of alertsToResolve) {
      try {
        const timeline: AlertStateTimeline = new AlertStateTimeline();
        timeline.alertId = alert.id!;
        timeline.alertStateId = resolvedStateId;
        timeline.projectId = projectId;
        timeline.rootCause = rootCause;

        await AlertStateTimelineService.create({
          data: timeline,
          props: {
            isRoot: true,
          },
        });

        resolvedAlertIds.push(alert.id!.toString());
      } catch (err) {
        // Resolved meanwhile, as for an incident above.
        if (
          err instanceof BadDataException &&
          err.message === "Alert state cannot be same as previous state."
        ) {
          continue;
        }

        logger.error(
          `Resolving alert ${alert.id?.toString()} after the monitoring of its monitor was turned off failed`,
          data.logAttributes,
        );
        logger.error(err, data.logAttributes);
      }
    }

    return resolvedAlertIds;
  }
}
