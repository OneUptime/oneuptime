import Alert from "../../../Models/DatabaseModels/Alert";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
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
import AlertInternalNoteService from "../../Services/AlertInternalNoteService";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import IncidentInternalNoteService from "../../Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../Services/IncidentPublicNoteService";
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
 *
 * WHEN ONEUPTIME IS UPGRADED (issue #6479). Monitors turned off before this
 * existed kept what they had left open. The data migration
 * ResolveWhatMonitorsTurnedOffWouldHaveResolved resolves it for them
 * (isUpgrade), with one difference: nobody is there to decide, as the person
 * who turns monitoring off is, so an incident or alert a person has worked on
 * - moved its state, acknowledged it, written a note on it - is left to them.
 * Only what was left behind untouched is resolved, and its root cause says it
 * was resolved when OneUptime was upgraded, not that monitoring was turned
 * off just now.
 */

export interface MonitorTurnedOffResult {
  resolvedIncidentIds: Array<string>;
  resolvedAlertIds: Array<string>;
  /*
   * When upgrading only: what the monitor would have resolved, left open
   * because a person has worked on it.
   */
  leftForAPersonIncidentIds?: Array<string> | undefined;
  leftForAPersonAlertIds?: Array<string> | undefined;
}

// What the root cause of a resolve says, for an incident or an alert.
export type MonitorTurnedOffRecordKind = "incident" | "alert";

type RecordKind = MonitorTurnedOffRecordKind;

// The records of one kind a resolve went through: resolved, or left alone.
interface ResolvedRecords {
  resolvedIds: Array<string>;
  leftForAPersonIds: Array<string>;
}

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
    /*
     * The monitor's monitoring was already off when OneUptime was upgraded
     * (the data migration), rather than turned off just now: what a person
     * has worked on stays open, and the root cause says so.
     */
    isUpgrade?: boolean | undefined;
  }): Promise<MonitorTurnedOffResult> {
    const isUpgrade: boolean = data.isUpgrade === true;
    const result: MonitorTurnedOffResult = {
      resolvedIncidentIds: [],
      resolvedAlertIds: [],
      ...(isUpgrade
        ? { leftForAPersonIncidentIds: [], leftForAPersonAlertIds: [] }
        : {}),
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

    return await this.resolveWhatItWouldResolve({
      monitor: monitor,
      isUpgrade: isUpgrade,
      why: "after its monitoring was turned off",
      getRootCause: async (kind: RecordKind): Promise<string> => {
        return this.getRootCause({
          kind: kind,
          monitorName: monitor.name || "",
          // Upgrading, nobody turned it off now: no person to read.
          turnedOffBy: isUpgrade
            ? FeedMarkdown.empty()
            : await getTurnedOffBy(),
          isUpgrade: isUpgrade,
        });
      },
    });
  }

  /*
   * Resolves the open incidents and alerts a monitor would resolve itself
   * once its criteria no longer held - those set to resolve on their own
   * (MonitorAutoResolveTemplates) - with the root cause given, whether its
   * monitoring is on or off. Shared by turning monitoring off, above, and
   * by a device management connection turned off or deleted, whose
   * monitors can never resolve what they opened about it
   * (DeviceManagementConnectionAlerts, #10286). The root cause is asked for
   * once per kind, and only when there is something of the kind to
   * resolve. `why` ends the log line of a failure ("after its monitoring
   * was turned off"). One record that fails is logged and does not stop
   * the others.
   */
  @CaptureSpan()
  public static async resolveWhatItWouldResolve(data: {
    // Read with _id, projectId, name and monitorSteps.
    monitor: Monitor;
    getRootCause: (kind: RecordKind) => Promise<string>;
    why: string;
    // Upgrading: what a person has worked on is theirs to close.
    isUpgrade?: boolean | undefined;
  }): Promise<MonitorTurnedOffResult> {
    const isUpgrade: boolean = data.isUpgrade === true;
    const monitor: Monitor = data.monitor;
    const result: MonitorTurnedOffResult = {
      resolvedIncidentIds: [],
      resolvedAlertIds: [],
      ...(isUpgrade
        ? { leftForAPersonIncidentIds: [], leftForAPersonAlertIds: [] }
        : {}),
    };

    if (!monitor.id || !monitor.projectId) {
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
      monitorId: monitor.id.toString(),
    } as LogAttributes;

    if (Object.keys(templateIds.incidents).length > 0) {
      try {
        const incidents: ResolvedRecords = await this.resolveOpenIncidents({
          monitor: monitor,
          templateIds: templateIds,
          getRootCause: data.getRootCause,
          isUpgrade: isUpgrade,
          why: data.why,
          logAttributes: logAttributes,
        });

        result.resolvedIncidentIds = incidents.resolvedIds;

        if (isUpgrade) {
          result.leftForAPersonIncidentIds = incidents.leftForAPersonIds;
        }
      } catch (err) {
        logger.error(
          `Resolving the open incidents of monitor ${monitor.id.toString()} ${data.why} failed`,
          logAttributes,
        );
        logger.error(err, logAttributes);
      }
    }

    if (Object.keys(templateIds.alerts).length > 0) {
      try {
        const alerts: ResolvedRecords = await this.resolveOpenAlerts({
          monitor: monitor,
          templateIds: templateIds,
          getRootCause: data.getRootCause,
          isUpgrade: isUpgrade,
          why: data.why,
          logAttributes: logAttributes,
        });

        result.resolvedAlertIds = alerts.resolvedIds;

        if (isUpgrade) {
          result.leftForAPersonAlertIds = alerts.leftForAPersonIds;
        }
      } catch (err) {
        logger.error(
          `Resolving the open alerts of monitor ${monitor.id.toString()} ${data.why} failed`,
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
    /*
     * Resolved by the upgrade's data migration: monitoring was turned off
     * before, by whoever and whenever, so the timeline does not say it was
     * turned off now.
     */
    isUpgrade?: boolean | undefined;
  }): string {
    if (data.isUpgrade) {
      return (
        data.kind === "incident"
          ? mdText`Monitoring is off for the monitor **${data.monitorName}**. This incident was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved when OneUptime was upgraded. If monitoring is turned back on while the problem is still there, a new incident is opened.`
          : mdText`Monitoring is off for the monitor **${data.monitorName}**. This alert was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved when OneUptime was upgraded. If monitoring is turned back on while the problem is still there, a new alert is opened.`
      ).toString();
    }

    const turnedOff: MarkdownText = data.turnedOffBy.isEmpty()
      ? mdText`Monitoring was turned off for the monitor **${data.monitorName}**.`
      : mdText`${data.turnedOffBy} turned off monitoring for the monitor **${data.monitorName}**.`;

    const why: MarkdownText =
      data.kind === "incident"
        ? mdText`This incident was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved now. If monitoring is turned back on while the problem is still there, a new incident is opened.`
        : mdText`This alert was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved now. If monitoring is turned back on while the problem is still there, a new alert is opened.`;

    return mdText`${turnedOff} ${why}`.toString();
  }

  /*
   * Whether a person has worked on the incident: moved its state -
   * acknowledging it is a state timeline row created as them - or written a
   * note on it, internal or on a status page. OneUptime stamps each such
   * record with the person who created it, and nobody when no person did
   * (UserAttribution), so the rows the monitor wrote itself name no one.
   * One incident at a time, so no limit on a list leaves a row out. A read
   * that fails reads as worked on: what cannot be checked stays open.
   */
  private static async hasAPersonWorkedOnIncident(data: {
    incidentId: ObjectID;
    logAttributes: LogAttributes;
  }): Promise<boolean> {
    try {
      const stateChange: IncidentStateTimeline | null =
        await IncidentStateTimelineService.findOneBy({
          query: {
            incidentId: data.incidentId,
            createdByUserId: QueryHelper.notNull(),
          },
          select: { _id: true },
          props: { isRoot: true },
        });

      if (stateChange) {
        return true;
      }

      const internalNote: IncidentInternalNote | null =
        await IncidentInternalNoteService.findOneBy({
          query: {
            incidentId: data.incidentId,
            createdByUserId: QueryHelper.notNull(),
          },
          select: { _id: true },
          props: { isRoot: true },
        });

      if (internalNote) {
        return true;
      }

      const publicNote: IncidentPublicNote | null =
        await IncidentPublicNoteService.findOneBy({
          query: {
            incidentId: data.incidentId,
            createdByUserId: QueryHelper.notNull(),
          },
          select: { _id: true },
          props: { isRoot: true },
        });

      return Boolean(publicNote);
    } catch (err) {
      logger.error(
        `Could not read whether a person has worked on incident ${data.incidentId.toString()}, so it stays open`,
        data.logAttributes,
      );
      logger.error(err, data.logAttributes);
      return true;
    }
  }

  // The same for an alert: its state changes and its notes.
  private static async hasAPersonWorkedOnAlert(data: {
    alertId: ObjectID;
    logAttributes: LogAttributes;
  }): Promise<boolean> {
    try {
      const stateChange: AlertStateTimeline | null =
        await AlertStateTimelineService.findOneBy({
          query: {
            alertId: data.alertId,
            createdByUserId: QueryHelper.notNull(),
          },
          select: { _id: true },
          props: { isRoot: true },
        });

      if (stateChange) {
        return true;
      }

      const note: AlertInternalNote | null =
        await AlertInternalNoteService.findOneBy({
          query: {
            alertId: data.alertId,
            createdByUserId: QueryHelper.notNull(),
          },
          select: { _id: true },
          props: { isRoot: true },
        });

      return Boolean(note);
    } catch (err) {
      logger.error(
        `Could not read whether a person has worked on alert ${data.alertId.toString()}, so it stays open`,
        data.logAttributes,
      );
      logger.error(err, data.logAttributes);
      return true;
    }
  }

  private static async resolveOpenIncidents(data: {
    monitor: Monitor;
    templateIds: MonitorAutoResolveTemplateIds;
    getRootCause: (kind: RecordKind) => Promise<string>;
    isUpgrade: boolean;
    why: string;
    logAttributes: LogAttributes;
  }): Promise<ResolvedRecords> {
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

    const wouldHaveResolved: Array<Incident> = openIncidents.filter(
      (incident: Incident): boolean => {
        return MonitorIncident.isAutoResolveConfiguredForIncident({
          openIncident: incident,
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            data.templateIds.incidents,
        });
      },
    );

    // Upgrading, what a person has worked on is theirs to close.
    const incidentsToResolve: Array<Incident> = [];
    const leftForAPersonIds: Array<string> = [];

    for (const incident of wouldHaveResolved) {
      if (
        data.isUpgrade &&
        (await this.hasAPersonWorkedOnIncident({
          incidentId: incident.id!,
          logAttributes: data.logAttributes,
        }))
      ) {
        leftForAPersonIds.push(incident.id!.toString());
        continue;
      }

      incidentsToResolve.push(incident);
    }

    if (incidentsToResolve.length === 0) {
      return { resolvedIds: [], leftForAPersonIds: leftForAPersonIds };
    }

    // Looked up once there is something to resolve: it throws for a project with none.
    const resolvedStateId: ObjectID =
      await IncidentStateTimelineService.getResolvedStateIdForProject(
        projectId,
      );

    const rootCause: string = await data.getRootCause("incident");

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
         * on its way: nothing is left to do.
         */
        if (
          err instanceof BadDataException &&
          err.message === "Incident state cannot be same as previous state."
        ) {
          continue;
        }

        logger.error(
          `Resolving incident ${incident.id?.toString()} of monitor ${data.monitor.id?.toString()} ${data.why} failed`,
          data.logAttributes,
        );
        logger.error(err, data.logAttributes);
      }
    }

    return {
      resolvedIds: resolvedIncidentIds,
      leftForAPersonIds: leftForAPersonIds,
    };
  }

  private static async resolveOpenAlerts(data: {
    monitor: Monitor;
    templateIds: MonitorAutoResolveTemplateIds;
    getRootCause: (kind: RecordKind) => Promise<string>;
    isUpgrade: boolean;
    why: string;
    logAttributes: LogAttributes;
  }): Promise<ResolvedRecords> {
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

    const wouldHaveResolved: Array<Alert> = openAlerts.filter(
      (alert: Alert): boolean => {
        return MonitorAlert.isAutoResolveConfiguredForAlert({
          openAlert: alert,
          autoResolveCriteriaInstanceIdAlertIdsDictionary:
            data.templateIds.alerts,
        });
      },
    );

    // Upgrading, what a person has worked on is theirs to close.
    const alertsToResolve: Array<Alert> = [];
    const leftForAPersonIds: Array<string> = [];

    for (const alert of wouldHaveResolved) {
      if (
        data.isUpgrade &&
        (await this.hasAPersonWorkedOnAlert({
          alertId: alert.id!,
          logAttributes: data.logAttributes,
        }))
      ) {
        leftForAPersonIds.push(alert.id!.toString());
        continue;
      }

      alertsToResolve.push(alert);
    }

    if (alertsToResolve.length === 0) {
      return { resolvedIds: [], leftForAPersonIds: leftForAPersonIds };
    }

    const resolvedStateId: ObjectID =
      await AlertStateTimelineService.getResolvedStateIdForProject(projectId);

    const rootCause: string = await data.getRootCause("alert");

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
          `Resolving alert ${alert.id?.toString()} of monitor ${data.monitor.id?.toString()} ${data.why} failed`,
          data.logAttributes,
        );
        logger.error(err, data.logAttributes);
      }
    }

    return {
      resolvedIds: resolvedAlertIds,
      leftForAPersonIds: leftForAPersonIds,
    };
  }
}
