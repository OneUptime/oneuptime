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
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DataToProcess from "./DataToProcess";
import MonitorTemplateUtil from "./MonitorTemplateUtil";
import { JSONObject } from "../../../Types/JSON";
import OneUptimeDate from "../../../Types/Date";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import { IncidentMemberRoleAssignment } from "../../../Types/Monitor/CriteriaIncident";
import { PerSeriesCriteriaMatch } from "../../../Types/Probe/ProbeApiIngestResponse";

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
    /**
     * When set, the fingerprint set of series still breaching on this
     * tick. Any open per-series incident whose fingerprint is NOT in
     * this set is auto-resolved — that's how a series returning to
     * normal closes its incident independently of other series on the
     * same monitor. Undefined means "legacy mode" and per-series
     * incidents are treated like any other for dedupe/resolve.
     */
    breachingSeriesFingerprints?: Set<string> | undefined;
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
        title: true,
        createdCriteriaId: true,
        createdIncidentTemplateId: true,
        projectId: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        currentIncidentStateId: true,
        seriesFingerprint: true,
        seriesLabels: true,
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
        breachingSeriesFingerprints: input.breachingSeriesFingerprints,
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
          relatedIncidentNumberWithPrefix:
            openIncident.incidentNumberWithPrefix,
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
    /**
     * When set, create one incident per series instead of one per
     * monitor. Each entry gets its own rootCause, seriesFingerprint,
     * and seriesLabels so the incident title + description can
     * reference `{{host.name}}` etc. via the template engine.
     */
    matchesPerSeries?: Array<PerSeriesCriteriaMatch> | undefined;
  }): Promise<void> {
    const incidentLogAttributes: LogAttributes = {
      projectId: input.monitor.projectId?.toString(),
    };

    // check open incidents
    logger.debug(
      `${input.monitor.id?.toString()} - Check open incidents.`,
      incidentLogAttributes,
    );

    /*
     * Per-series mode: close any open incident for a series that's no
     * longer breaching *before* we look at the remaining open set, so
     * dedupe decisions below match the post-resolve state.
     */
    const breachingSeriesFingerprints: Set<string> | undefined =
      input.matchesPerSeries
        ? new Set<string>(
            input.matchesPerSeries.map((m: PerSeriesCriteriaMatch) => {
              return m.fingerprint;
            }),
          )
        : undefined;

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
        breachingSeriesFingerprints,
      });

    if (!input.criteriaInstance.data?.createIncidents) {
      return;
    }

    /*
     * Series-less path: one incident per criteriaIncident template as
     * before. Series-aware path: one incident per (series × template).
     */
    const seriesToProcess: Array<PerSeriesCriteriaMatch | undefined> =
      input.matchesPerSeries && input.matchesPerSeries.length > 0
        ? input.matchesPerSeries
        : [undefined];

    for (const criteriaIncident of input.criteriaInstance.data?.incidents ||
      []) {
      for (const seriesMatch of seriesToProcess) {
        const seriesFingerprint: string | undefined = seriesMatch?.fingerprint;
        const seriesLabels: JSONObject | undefined = seriesMatch?.labels;
        const seriesRootCause: string =
          seriesMatch?.rootCause || input.rootCause;

        const alreadyOpenIncident: Incident | undefined = openIncidents.find(
          (incident: Incident) => {
            return (
              incident.createdCriteriaId ===
                input.criteriaInstance.data?.id.toString() &&
              incident.createdIncidentTemplateId ===
                criteriaIncident.id.toString() &&
              (incident.seriesFingerprint || undefined) === seriesFingerprint
            );
          },
        );

        const hasAlreadyOpenIncident: boolean = Boolean(alreadyOpenIncident);

        logger.debug(
          `${input.monitor.id?.toString()} - Open Incident ${alreadyOpenIncident?.id?.toString()}`,
          incidentLogAttributes,
        );

        logger.debug(
          `${input.monitor.id?.toString()} - Has open incident ${hasAlreadyOpenIncident}`,
          incidentLogAttributes,
        );

        if (hasAlreadyOpenIncident) {
          /*
           * Use the open incident's already-rendered title when
           * available — the template (`criteriaIncident.title`) still
           * contains unresolved `{{…}}` placeholders because it's the
           * criterion's template string, not the instance's rendered
           * output. Falling back to the template only when the open
           * incident somehow has no title.
           */
          const renderedTitle: string =
            alreadyOpenIncident?.title || criteriaIncident.title;

          input.evaluationSummary?.events.push({
            type: "incident-skipped",
            title: `Incident already active: ${renderedTitle}`,
            message:
              "Skipped creating a new incident because an active incident exists for this criteria.",
            relatedCriteriaId: input.criteriaInstance.data?.id,
            relatedIncidentId: alreadyOpenIncident?.id?.toString(),
            relatedIncidentNumber: alreadyOpenIncident?.incidentNumber,
            relatedIncidentNumberWithPrefix:
              alreadyOpenIncident?.incidentNumberWithPrefix,
            at: OneUptimeDate.getCurrentDate(),
          });
          continue;
        }

        logger.debug(
          `${input.monitor.id?.toString()} - Create incident.`,
          incidentLogAttributes,
        );

        const incident: Incident = new Incident();
        const storageMap: JSONObject =
          MonitorTemplateUtil.buildTemplateStorageMap({
            monitorType: input.monitor.monitorType!,
            dataToProcess: input.dataToProcess,
            monitor: input.monitor,
            seriesLabels,
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
        incident.rootCause = seriesRootCause;
        incident.createdStateLog = JSON.parse(
          JSON.stringify(input.dataToProcess, null, 2),
        );

        incident.createdCriteriaId = input.criteriaInstance.data.id.toString();

        incident.createdIncidentTemplateId = criteriaIncident.id.toString();

        if (seriesFingerprint) {
          incident.seriesFingerprint = seriesFingerprint;
        }
        if (seriesLabels && Object.keys(seriesLabels).length > 0) {
          incident.seriesLabels = seriesLabels;
        }

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

        // Set status page visibility (defaults to true if not specified)
        if (criteriaIncident.showIncidentOnStatusPage !== undefined) {
          incident.isVisibleOnStatusPage =
            criteriaIncident.showIncidentOnStatusPage;
        }

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
                  incidentLogAttributes,
                );
              }
            } catch (memberError) {
              logger.error(
                `${input.monitor.id?.toString()} - Failed to assign incident member role: ${memberError}`,
                incidentLogAttributes,
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
          relatedIncidentNumberWithPrefix:
            createdIncident.incidentNumberWithPrefix,
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
    breachingSeriesFingerprints?: Set<string> | undefined;
  }): boolean {
    const openSeriesFingerprint: string | undefined =
      input.openIncident.seriesFingerprint || undefined;

    /*
     * Per-series auto-resolve: when the monitor emits a breaching-
     * series set and this open incident has a fingerprint, resolve
     * whenever the fingerprint is no longer in the set — regardless
     * of whether some *other* series is still breaching the same
     * criteria. This is the whole point of per-host incidents.
     */
    if (
      input.breachingSeriesFingerprints !== undefined &&
      openSeriesFingerprint
    ) {
      const stillBreaching: boolean = input.breachingSeriesFingerprints.has(
        openSeriesFingerprint,
      );

      if (stillBreaching) {
        return false;
      }

      /*
       * Series no longer breaching. Only auto-close if the criteria
       * was configured to auto-resolve in the first place; otherwise
       * stay open so a human can acknowledge.
       */
      if (!input.openIncident.createdCriteriaId?.toString()) {
        return false;
      }

      if (!input.openIncident.createdIncidentTemplateId?.toString()) {
        return false;
      }

      const autoResolveTemplates: Array<string> | undefined =
        input.autoResolveCriteriaInstanceIdIncidentIdsDictionary[
          input.openIncident.createdCriteriaId.toString()
        ];

      if (
        autoResolveTemplates &&
        autoResolveTemplates.includes(
          input.openIncident.createdIncidentTemplateId.toString(),
        )
      ) {
        return true;
      }

      return false;
    }

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
