import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import AlertService from "../../Services/AlertService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import MonitorStatusTimelineService from "../../Services/MonitorStatusTimelineService";
import logger from "../Logger";
import DataToProcess from "./DataToProcess";

export default class MonitorAlert {
  public static async checkOpenAlertsAndCloseIfResolved(input: {
    monitorId: ObjectID;
    autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<Array<string>>;
    rootCause: string;
    criteriaInstance: MonitorCriteriaInstance | null;
    dataToProcess: DataToProcess;
  }): Promise<Array<Alert>> {
    // check active alerts and if there are open alerts, do not cretae anothr alert.
    const openAlerts: Array<Alert> = await AlertService.findBy({
      query: {
        monitor: input.monitorId!,
        currentAlertState: {
          isResolvedState: false,
        },
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      select: {
        _id: true,
        createdCriteriaId: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    // check if should close the alert.

    for (const openAlert of openAlerts) {
      const shouldClose: boolean = this.shouldCloseAlert({
        openAlert,
        autoResolveCriteriaInstanceIdAlertIdsDictionary:
          input.autoResolveCriteriaInstanceIdAlertIdsDictionary,
        criteriaInstance: input.criteriaInstance,
      });

      if (shouldClose) {
        // then resolve alert.
        await this.resolveOpenAlert({
          openAlert: openAlert,
          rootCause: input.rootCause,
          dataToProcess: input.dataToProcess,
        });
      }
    }

    return openAlerts;
  }

  public static async criteriaMetCreateAlertsAndUpdateMonitorStatus(input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    dataToProcess: DataToProcess;
    rootCause: string;
    autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<Array<string>>;
    props: {
      telemetryQuery?: TelemetryQuery | undefined;
    };
  }): Promise<void> {
    // criteria filters are met, now process the actions.

    const lastMonitorStatusTimeline: MonitorStatusTimeline | null =
      await MonitorStatusTimelineService.findOneBy({
        query: {
          monitorId: input.monitor.id!,
          projectId: input.monitor.projectId!,
        },
        select: {
          _id: true,
          monitorStatusId: true,
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
      });

    let shouldUpdateStatus: boolean = false;

    if (!lastMonitorStatusTimeline) {
      // if monitor does not have any status timeline, then create one.
      shouldUpdateStatus = true;
    }

    if (
      input.criteriaInstance.data?.changeMonitorStatus &&
      input.criteriaInstance.data?.monitorStatusId &&
      input.criteriaInstance.data?.monitorStatusId.toString() !==
        lastMonitorStatusTimeline?.id?.toString()
    ) {
      // if monitor status is changed, then create a new status timeline.
      shouldUpdateStatus = true;
    }

    // check if the current status is same as the last status.

    if (
      input.criteriaInstance.data?.changeMonitorStatus &&
      input.criteriaInstance.data?.monitorStatusId &&
      input.criteriaInstance.data?.monitorStatusId.toString() !==
        input.monitor.currentMonitorStatusId?.toString()
    ) {
      // if monitor status is changed, then create a new status timeline.
      shouldUpdateStatus = true;
    }

    if (shouldUpdateStatus) {
      logger.debug(
        `${input.monitor.id?.toString()} - Change monitor status to ${input.criteriaInstance.data?.monitorStatusId?.toString()}`,
      );
      // change monitor status

      const monitorStatusId: ObjectID | undefined =
        input.criteriaInstance.data?.monitorStatusId;

      if (!monitorStatusId) {
        throw new BadDataException("Monitor status is not defined.");
      }

      //change monitor status.

      // get last status of this monitor.

      // get last monitor status timeline.

      if (
        lastMonitorStatusTimeline &&
        lastMonitorStatusTimeline.monitorStatusId &&
        lastMonitorStatusTimeline.monitorStatusId.toString() ===
          monitorStatusId.toString()
      ) {
        // status is same as last status. do not create new status timeline.
        return;
      }

      const monitorStatusTimeline: MonitorStatusTimeline =
        new MonitorStatusTimeline();
      monitorStatusTimeline.monitorId = input.monitor.id!;
      monitorStatusTimeline.monitorStatusId = monitorStatusId;
      monitorStatusTimeline.projectId = input.monitor.projectId!;
      monitorStatusTimeline.statusChangeLog = JSON.parse(
        JSON.stringify(input.dataToProcess),
      );
      monitorStatusTimeline.rootCause = input.rootCause;

      await MonitorStatusTimelineService.create({
        data: monitorStatusTimeline,
        props: {
          isRoot: true,
        },
      });
    }

    // check open alerts
    logger.debug(`${input.monitor.id?.toString()} - Check open alerts.`);
    // check active alerts and if there are open alerts, do not cretae anothr alert.
    const openAlerts: Array<Alert> =
      await this.checkOpenAlertsAndCloseIfResolved({
        monitorId: input.monitor.id!,
        autoResolveCriteriaInstanceIdAlertIdsDictionary:
          input.autoResolveCriteriaInstanceIdAlertIdsDictionary,
        rootCause: input.rootCause,
        criteriaInstance: input.criteriaInstance,
        dataToProcess: input.dataToProcess,
      });

    if (input.criteriaInstance.data?.createAlerts) {
      // create alerts

      for (const criteriaAlert of input.criteriaInstance.data?.alerts || []) {
        // should create alert.

        const alreadyOpenAlert: Alert | undefined = openAlerts.find(
          (alert: Alert) => {
            return (
              alert.createdCriteriaId ===
              input.criteriaInstance.data?.id.toString()
            );
          },
        );

        const hasAlreadyOpenAlert: boolean = Boolean(alreadyOpenAlert);

        logger.debug(
          `${input.monitor.id?.toString()} - Open Alert ${alreadyOpenAlert?.id?.toString()}`,
        );

        logger.debug(
          `${input.monitor.id?.toString()} - Has open alert ${hasAlreadyOpenAlert}`,
        );

        if (hasAlreadyOpenAlert) {
          continue;
        }

        // create alert here.

        logger.debug(`${input.monitor.id?.toString()} - Create alert.`);

        const alert: Alert = new Alert();

        alert.title = criteriaAlert.title;
        alert.description = criteriaAlert.description;

        if (!criteriaAlert.alertSeverityId) {
          // pick the critical criteria.

          const severity: AlertSeverity | null =
            await AlertSeverityService.findOneBy({
              query: {
                projectId: input.monitor.projectId!,
              },
              sort: {
                order: SortOrder.Ascending,
              },
              props: {
                isRoot: true,
              },
              select: {
                _id: true,
              },
            });

          if (!severity) {
            throw new BadDataException("Project does not have alert severity");
          } else {
            alert.alertSeverityId = severity.id!;
          }
        } else {
          alert.alertSeverityId = criteriaAlert.alertSeverityId!;
        }

        alert.monitor = input.monitor;
        alert.projectId = input.monitor.projectId!;
        alert.rootCause = input.rootCause;
        alert.createdStateLog = JSON.parse(
          JSON.stringify(input.dataToProcess, null, 2),
        );

        alert.createdCriteriaId = input.criteriaInstance.data.id.toString();

        alert.onCallDutyPolicies =
          criteriaAlert.onCallPolicyIds?.map((id: ObjectID) => {
            const onCallPolicy: OnCallDutyPolicy = new OnCallDutyPolicy();
            onCallPolicy._id = id.toString();
            return onCallPolicy;
          }) || [];

        alert.isCreatedAutomatically = true;

        if (input.props.telemetryQuery) {
          alert.telemetryQuery = input.props.telemetryQuery;
        }

        if (
          input.dataToProcess &&
          (input.dataToProcess as ProbeMonitorResponse).probeId
        ) {
          alert.createdByProbeId = (
            input.dataToProcess as ProbeMonitorResponse
          ).probeId;
        }

        if (criteriaAlert.remediationNotes) {
          alert.remediationNotes = criteriaAlert.remediationNotes;
        }

        await AlertService.create({
          data: alert,
          props: {
            isRoot: true,
          },
        });
      }
    }
  }

  private static async resolveOpenAlert(input: {
    openAlert: Alert;
    rootCause: string;
    dataToProcess:
      | ProbeMonitorResponse
      | IncomingMonitorRequest
      | DataToProcess;
  }): Promise<void> {
    const resolvedStateId: ObjectID =
      await AlertStateTimelineService.getResolvedStateIdForProject(
        input.openAlert.projectId!,
      );

    const alertStateTimeline: AlertStateTimeline = new AlertStateTimeline();
    alertStateTimeline.alertId = input.openAlert.id!;
    alertStateTimeline.alertStateId = resolvedStateId;
    alertStateTimeline.projectId = input.openAlert.projectId!;

    if (input.rootCause) {
      alertStateTimeline.rootCause =
        "Alert autoresolved because autoresolve is set to true in monitor criteria. " +
        input.rootCause;
    }

    if (input.dataToProcess) {
      alertStateTimeline.stateChangeLog = JSON.parse(
        JSON.stringify(input.dataToProcess),
      );
    }

    await AlertStateTimelineService.create({
      data: alertStateTimeline,
      props: {
        isRoot: true,
      },
    });
  }

  private static shouldCloseAlert(input: {
    openAlert: Alert;
    autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<Array<string>>;
    criteriaInstance: MonitorCriteriaInstance | null; // null if no criteia met.
  }): boolean {
    if (
      input.openAlert.createdCriteriaId?.toString() ===
      input.criteriaInstance?.data?.id.toString()
    ) {
      // same alert active. So, do not close.
      return false;
    }

    // If antoher criteria is active then, check if the alert id is present in the map.

    if (!input.openAlert.createdCriteriaId?.toString()) {
      return false;
    }

    if (
      input.autoResolveCriteriaInstanceIdAlertIdsDictionary[
        input.openAlert.createdCriteriaId?.toString()
      ]
    ) {
      return true;
    }

    return false;
  }
}
