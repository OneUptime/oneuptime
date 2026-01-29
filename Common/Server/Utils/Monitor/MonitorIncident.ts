import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
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
import { DisableAutomaticIncidentCreation } from "../../EnvironmentConfig";
import IncidentService from "../../Services/IncidentService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import IncidentStateTimelineService from "../../Services/IncidentStateTimelineService";
import IncidentMemberService from "../../Services/IncidentMemberService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataToProcess from "./DataToProcess";
import MonitorTemplateUtil from "./MonitorTemplateUtil";
import { JSONObject } from "../../../Types/JSON";
import OneUptimeDate from "../../../Types/Date";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import { IncidentMemberRoleAssignment } from "../../../Types/Monitor/CriteriaIncident";

export default class MonitorIncident {
  @CaptureSpan()
  public static async checkOpenIncidentsAndCloseIfResolved(input: {
    monitorId: ObjectID;
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    >;
    rootCause: string;
    criteriaInstance: MonitorCriteriaInstance | null;
    dataToProcess: DataToProcess;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
  }): Promise<Array<Incident>> {
    // check active incidents and if there are open incidents, do not cretae anothr incident.
    const openIncidents: Array<Incident> = await IncidentService.findBy({
      query: {
        monitors: [input.monitorId],
        currentIncidentState: {
          isResolvedState: false,
        },
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      select: {
        _id: true,
        createdCriteriaId: true,
        createdIncidentTemplateId: true,
        projectId: true,
        incidentNumber: true,
      },
      props: {
        isRoot: true,
      },
    });

    // check if should close the incident.

    for (const openIncident of openIncidents) {
      const shouldClose: boolean = this.shouldCloseIncident({
        openIncident,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary:
          input.autoResolveCriteriaInstanceIdIncidentIdsDictionary,
        criteriaInstance: input.criteriaInstance,
      });

      if (shouldClose) {
        // then resolve incident.
        await this.resolveOpenIncident({
          openIncident: openIncident,
          rootCause: input.rootCause,
          dataToProcess: input.dataToProcess,
        });

        input.evaluationSummary?.events.push({
          type: "incident-resolved",
          title: `Incident resolved: ${openIncident.id?.toString()}`,
          message:
            "Incident auto-resolved because autoresolve is enabled for this criteria.",
          relatedIncidentId: openIncident.id?.toString(),
          relatedIncidentNumber: openIncident.incidentNumber,
          relatedCriteriaId: input.criteriaInstance?.data?.id,
          at: OneUptimeDate.getCurrentDate(),
        });
      }
    }

    return openIncidents;
  }

  @CaptureSpan()
  public static async criteriaMetCreateIncidentsAndUpdateMonitorStatus(input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    dataToProcess: DataToProcess;
    rootCause: string;
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    >;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    props: {
      telemetryQuery?: TelemetryQuery | undefined;
    };
  }): Promise<void> {
    // check open incidents
    logger.debug(`${input.monitor.id?.toString()} - Check open incidents.`);
    // check active incidents and if there are open incidents, do not cretae anothr incident.
    const openIncidents: Array<Incident> =
      await this.checkOpenIncidentsAndCloseIfResolved({
        monitorId: input.monitor.id!,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary:
          input.autoResolveCriteriaInstanceIdIncidentIdsDictionary,
        rootCause: input.rootCause,
        criteriaInstance: input.criteriaInstance,
        dataToProcess: input.dataToProcess,
        evaluationSummary: input.evaluationSummary,
      });

    if (input.criteriaInstance.data?.createIncidents) {
      // create incidents

      for (const criteriaIncident of input.criteriaInstance.data?.incidents ||
        []) {
        // should create incident.

        const alreadyOpenIncident: Incident | undefined = openIncidents.find(
          (incident: Incident) => {
            return (
              incident.createdCriteriaId ===
                input.criteriaInstance.data?.id.toString() &&
              incident.createdIncidentTemplateId ===
                criteriaIncident.id.toString()
            );
          },
        );

        const hasAlreadyOpenIncident: boolean = Boolean(alreadyOpenIncident);

        logger.debug(
          `${input.monitor.id?.toString()} - Open Incident ${alreadyOpenIncident?.id?.toString()}`,
        );

        logger.debug(
          `${input.monitor.id?.toString()} - Has open incident ${hasAlreadyOpenIncident}`,
        );

        if (hasAlreadyOpenIncident) {
          input.evaluationSummary?.events.push({
            type: "incident-skipped",
            title: `Incident already active: ${criteriaIncident.title}`,
            message:
              "Skipped creating a new incident because an active incident exists for this criteria.",
            relatedCriteriaId: input.criteriaInstance.data?.id,
            relatedIncidentId: alreadyOpenIncident?.id?.toString(),
            relatedIncidentNumber: alreadyOpenIncident?.incidentNumber,
            at: OneUptimeDate.getCurrentDate(),
          });
          continue;
        }

        logger.debug(`${input.monitor.id?.toString()} - Create incident.`);

        const incident: Incident = new Incident();
        const storageMap: JSONObject =
          MonitorTemplateUtil.buildTemplateStorageMap({
            monitorType: input.monitor.monitorType!,
            dataToProcess: input.dataToProcess,
          });

        incident.title = MonitorTemplateUtil.processTemplateString({
          value: criteriaIncident.title,
          storageMap,
        });
        incident.description = MonitorTemplateUtil.processTemplateString({
          value: criteriaIncident.description,
          storageMap,
        });

        if (!criteriaIncident.incidentSeverityId) {
          // pick the critical criteria.

          const severity: IncidentSeverity | null =
            await IncidentSeverityService.findOneBy({
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
            throw new BadDataException(
              "Project does not have incident severity",
            );
          } else {
            incident.incidentSeverityId = severity.id!;
          }
        } else {
          incident.incidentSeverityId = criteriaIncident.incidentSeverityId!;
        }

        incident.monitors = [input.monitor];
        incident.projectId = input.monitor.projectId!;
        incident.rootCause = input.rootCause;
        incident.createdStateLog = JSON.parse(
          JSON.stringify(input.dataToProcess, null, 2),
        );

        incident.createdCriteriaId = input.criteriaInstance.data.id.toString();

        incident.createdIncidentTemplateId = criteriaIncident.id.toString();

        incident.onCallDutyPolicies =
          criteriaIncident.onCallPolicyIds?.map((id: ObjectID) => {
            const onCallPolicy: OnCallDutyPolicy = new OnCallDutyPolicy();
            onCallPolicy._id = id.toString();
            return onCallPolicy;
          }) || [];

        // Set labels from criteria
        incident.labels =
          criteriaIncident.labelIds?.map((id: ObjectID) => {
            const label: Label = new Label();
            label._id = id.toString();
            return label;
          }) || [];

        incident.isCreatedAutomatically = true;

        if (input.props.telemetryQuery) {
          incident.telemetryQuery = input.props.telemetryQuery;
        }

        if (
          input.dataToProcess &&
          (input.dataToProcess as ProbeMonitorResponse).probeId
        ) {
          incident.createdByProbeId = (
            input.dataToProcess as ProbeMonitorResponse
          ).probeId;
        }

        if (criteriaIncident.remediationNotes) {
          incident.remediationNotes = MonitorTemplateUtil.processTemplateString(
            {
              value: criteriaIncident.remediationNotes,
              storageMap,
            },
          );
        }

        if (DisableAutomaticIncidentCreation) {
          input.evaluationSummary?.events.push({
            type: "incident-skipped",
            title: "Incident creation skipped",
            message:
              "Automatic incident creation is disabled by environment configuration.",
            relatedCriteriaId: input.criteriaInstance.data?.id,
            at: OneUptimeDate.getCurrentDate(),
          });
          return;
        }

        const createdIncident: Incident = await IncidentService.create({
          data: incident,
          props: {
            isRoot: true,
          },
        });

        // Add owner teams and users after incident creation
        if (
          criteriaIncident.ownerTeamIds?.length ||
          criteriaIncident.ownerUserIds?.length
        ) {
          await IncidentService.addOwners(
            input.monitor.projectId!,
            createdIncident.id!,
            criteriaIncident.ownerUserIds || [],
            criteriaIncident.ownerTeamIds || [],
            true, // notify owners
            {
              isRoot: true,
            },
          );
        }

        // Add incident member role assignments after incident creation
        if (
          criteriaIncident.incidentMemberRoles &&
          criteriaIncident.incidentMemberRoles.length > 0
        ) {
          for (const roleAssignment of criteriaIncident.incidentMemberRoles) {
            try {
              const assignment: IncidentMemberRoleAssignment =
                roleAssignment as IncidentMemberRoleAssignment;

              if (assignment.roleId && assignment.userId) {
                const incidentMember: IncidentMember = new IncidentMember();
                incidentMember.incidentId = createdIncident.id!;
                incidentMember.projectId = input.monitor.projectId!;
                incidentMember.userId = new ObjectID(
                  assignment.userId.toString(),
                );
                incidentMember.incidentRoleId = new ObjectID(
                  assignment.roleId.toString(),
                );

                await IncidentMemberService.create({
                  data: incidentMember,
                  props: {
                    isRoot: true,
                  },
                });

                logger.debug(
                  `${input.monitor.id?.toString()} - Assigned incident member role ${assignment.roleId.toString()} to user ${assignment.userId.toString()}`,
                );
              }
            } catch (memberError) {
              logger.error(
                `${input.monitor.id?.toString()} - Failed to assign incident member role: ${memberError}`,
              );
            }
          }
        }

        input.evaluationSummary?.events.push({
          type: "incident-created",
          title: `Incident created: ${createdIncident.title || criteriaIncident.title}`,
          message: `Incident triggered from criteria "${input.criteriaInstance.data?.name || "Unnamed criteria"}".`,
          relatedCriteriaId: input.criteriaInstance.data?.id,
          relatedIncidentId: createdIncident.id?.toString(),
          relatedIncidentNumber: createdIncident.incidentNumber,
          at: OneUptimeDate.getCurrentDate(),
        });
      }
    }
  }

  private static async resolveOpenIncident(input: {
    openIncident: Incident;
    rootCause: string;
    dataToProcess:
      | ProbeMonitorResponse
      | IncomingMonitorRequest
      | DataToProcess;
  }): Promise<void> {
    const resolvedStateId: ObjectID =
      await IncidentStateTimelineService.getResolvedStateIdForProject(
        input.openIncident.projectId!,
      );

    const incidentStateTimeline: IncidentStateTimeline =
      new IncidentStateTimeline();
    incidentStateTimeline.incidentId = input.openIncident.id!;
    incidentStateTimeline.incidentStateId = resolvedStateId;
    incidentStateTimeline.projectId = input.openIncident.projectId!;

    if (input.rootCause) {
      incidentStateTimeline.rootCause =
        "Incident autoresolved because autoresolve is set to true in monitor criteria. " +
        input.rootCause;
    }

    if (input.dataToProcess) {
      incidentStateTimeline.stateChangeLog = JSON.parse(
        JSON.stringify(input.dataToProcess),
      );
    }

    await IncidentStateTimelineService.create({
      data: incidentStateTimeline,
      props: {
        isRoot: true,
      },
    });
  }

  private static shouldCloseIncident(input: {
    openIncident: Incident;
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: Dictionary<
      Array<string>
    >;
    criteriaInstance: MonitorCriteriaInstance | null; // null if no criteia met.
  }): boolean {
    if (
      input.openIncident.createdCriteriaId?.toString() ===
      input.criteriaInstance?.data?.id.toString()
    ) {
      // same incident active. So, do not close.
      return false;
    }

    // If antoher criteria is active then, check if the incident id is present in the map.

    if (!input.openIncident.createdCriteriaId?.toString()) {
      return false;
    }

    if (!input.openIncident.createdIncidentTemplateId?.toString()) {
      return false;
    }

    if (
      input.autoResolveCriteriaInstanceIdIncidentIdsDictionary[
        input.openIncident.createdCriteriaId?.toString()
      ]
    ) {
      if (
        input.autoResolveCriteriaInstanceIdIncidentIdsDictionary[
          input.openIncident.createdCriteriaId?.toString()
        ]?.includes(input.openIncident.createdIncidentTemplateId?.toString())
      ) {
        return true;
      }
    }

    return false;
  }
}
