import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
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
import { DisableAutomaticAlertCreation } from "../../EnvironmentConfig";
import AlertService from "../../Services/AlertService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataToProcess from "./DataToProcess";
import MonitorTemplateUtil from "./MonitorTemplateUtil";
import { JSONObject } from "../../../Types/JSON";
import OneUptimeDate from "../../../Types/Date";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";

export default class MonitorAlert {
  @CaptureSpan()
  public static async checkOpenAlertsAndCloseIfResolved(input: {
    monitorId: ObjectID;
    autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<Array<string>>;
    rootCause: string;
    criteriaInstance: MonitorCriteriaInstance | null;
    dataToProcess: DataToProcess;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
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
        alertNumber: true,
        alertNumberWithPrefix: true,
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

        input.evaluationSummary?.events.push({
          type: "alert-resolved",
          title: `Alert resolved: ${openAlert.id?.toString()}`,
          message:
            "Alert auto-resolved because autoresolve is enabled for this criteria.",
          relatedAlertId: openAlert.id?.toString(),
          relatedAlertNumber: openAlert.alertNumber,
          relatedAlertNumberWithPrefix: openAlert.alertNumberWithPrefix,
          relatedCriteriaId: input.criteriaInstance?.data?.id,
          at: OneUptimeDate.getCurrentDate(),
        });
      }
    }

    return openAlerts;
  }

  @CaptureSpan()
  public static async criteriaMetCreateAlertsAndUpdateMonitorStatus(input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    dataToProcess: DataToProcess;
    rootCause: string;
    autoResolveCriteriaInstanceIdAlertIdsDictionary: Dictionary<Array<string>>;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    props: {
      telemetryQuery?: TelemetryQuery | undefined;
    };
  }): Promise<void> {
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
        evaluationSummary: input.evaluationSummary,
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
          input.evaluationSummary?.events.push({
            type: "alert-skipped",
            title: `Alert already active: ${criteriaAlert.title}`,
            message:
              "Skipped creating a new alert because an active alert exists for this criteria.",
            relatedCriteriaId: input.criteriaInstance.data?.id,
            relatedAlertId: alreadyOpenAlert?.id?.toString(),
            relatedAlertNumber: alreadyOpenAlert?.alertNumber,
            relatedAlertNumberWithPrefix: alreadyOpenAlert?.alertNumberWithPrefix,
            at: OneUptimeDate.getCurrentDate(),
          });
          continue;
        }

        // create alert here.

        logger.debug(`${input.monitor.id?.toString()} - Create alert.`);

        const alert: Alert = new Alert();
        const storageMap: JSONObject =
          MonitorTemplateUtil.buildTemplateStorageMap({
            monitorType: input.monitor.monitorType!,
            dataToProcess: input.dataToProcess,
          });

        alert.title = MonitorTemplateUtil.processTemplateString({
          value: criteriaAlert.title,
          storageMap,
        });
        alert.description = MonitorTemplateUtil.processTemplateString({
          value: criteriaAlert.description,
          storageMap,
        });

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

        // Set labels from criteria
        alert.labels =
          criteriaAlert.labelIds?.map((id: ObjectID) => {
            const label: Label = new Label();
            label._id = id.toString();
            return label;
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
          alert.remediationNotes = MonitorTemplateUtil.processTemplateString({
            value: criteriaAlert.remediationNotes,
            storageMap,
          });
        }

        if (DisableAutomaticAlertCreation) {
          input.evaluationSummary?.events.push({
            type: "alert-skipped",
            title: "Alert creation skipped",
            message:
              "Automatic alert creation is disabled by environment configuration.",
            relatedCriteriaId: input.criteriaInstance.data?.id,
            at: OneUptimeDate.getCurrentDate(),
          });
          return;
        }

        const createdAlert: Alert = await AlertService.create({
          data: alert,
          props: {
            isRoot: true,
          },
        });

        // Add owner teams and users after alert creation
        if (
          criteriaAlert.ownerTeamIds?.length ||
          criteriaAlert.ownerUserIds?.length
        ) {
          await AlertService.addOwners(
            input.monitor.projectId!,
            createdAlert.id!,
            criteriaAlert.ownerUserIds || [],
            criteriaAlert.ownerTeamIds || [],
            true, // notify owners
            {
              isRoot: true,
            },
          );
        }

        input.evaluationSummary?.events.push({
          type: "alert-created",
          title: `Alert created: ${createdAlert.title || criteriaAlert.title}`,
          message: `Alert triggered from criteria "${input.criteriaInstance.data?.name || "Unnamed criteria"}".`,
          relatedCriteriaId: input.criteriaInstance.data?.id,
          relatedAlertId: createdAlert.id?.toString(),
          relatedAlertNumber: createdAlert.alertNumber,
          relatedAlertNumberWithPrefix: createdAlert.alertNumberWithPrefix,
          at: OneUptimeDate.getCurrentDate(),
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
