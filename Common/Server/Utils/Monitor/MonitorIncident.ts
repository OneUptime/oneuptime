import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
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
import DockerHostService from "../../Services/DockerHostService";
import HostService from "../../Services/HostService";
import IncidentService from "../../Services/IncidentService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import ServiceService from "../../Services/ServiceService";
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
import SeriesResourceLabels, {
  SeriesResourceRefs,
} from "./SeriesResourceLabels";

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
    // check active incidents and if there are open incidents, do not create another incident.
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
    /**
     * Series fingerprints whose underlying resource (host, docker host,
     * kubernetes cluster, or service) is inside an ongoing scheduled
     * maintenance window. The monitor itself keeps evaluating — it is
     * not attached to the maintenance — but incidents for these series
     * are suppressed at creation time. See MonitorMaintenanceSuppression.
     */
    suppressedSeriesFingerprints?: Set<string> | undefined;
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

        /*
         * Per-series scheduled-maintenance suppression: this series'
         * resource is inside an ongoing maintenance window, so skip
         * creating an incident for it. Other series on the same monitor
         * whose resources are not under maintenance still get incidents.
         * Note: we only suppress *new* creation — any incident already
         * open for this series is left to the normal resolve path
         * (checkOpenIncidentsAndCloseIfResolved still sees the full
         * breaching set), so a real incident raised before maintenance
         * is not silently closed.
         */
        if (
          seriesFingerprint &&
          input.suppressedSeriesFingerprints?.has(seriesFingerprint)
        ) {
          logger.debug(
            `${input.monitor.id?.toString()} - Skipping incident for series ${seriesFingerprint}: its resource is under an active scheduled maintenance window.`,
            incidentLogAttributes,
          );

          input.evaluationSummary?.events.push({
            type: "incident-skipped",
            title: "Incident suppressed by scheduled maintenance",
            message:
              "Skipped creating an incident because the resource for this series is under an active scheduled maintenance window.",
            relatedCriteriaId: input.criteriaInstance.data?.id,
            at: OneUptimeDate.getCurrentDate(),
          });
          continue;
        }

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

        /*
         * Guard against missing ids — these are optional reference fields and
         * must not crash incident creation (which runs inside the probe /
         * telemetry queue workers). A missing id previously threw
         * "Cannot read properties of undefined (reading 'toString')" and failed
         * the job on every cycle for the affected monitor.
         */
        if (input.criteriaInstance.data?.id) {
          incident.createdCriteriaId =
            input.criteriaInstance.data.id.toString();
        }

        if (criteriaIncident.id) {
          incident.createdIncidentTemplateId = criteriaIncident.id.toString();
        }

        if (seriesFingerprint) {
          incident.seriesFingerprint = seriesFingerprint;
        }
        if (seriesLabels && Object.keys(seriesLabels).length > 0) {
          incident.seriesLabels = seriesLabels;

          await this.linkResourceContextFromSeries({
            incident,
            seriesLabels,
            projectId: input.monitor.projectId!,
          });
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

        if (criteriaIncident.isPrivate === true) {
          incident.isPrivate = true;
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

  /*
   * Pull every host / docker-host / k8s-cluster / service identifier
   * out of the series labels and attach the matching project-scoped
   * records to the incident. The label-key → resource-type mapping
   * lives in SeriesResourceLabels (shared with the scheduled-maintenance
   * suppression path so the two never disagree about which labels
   * identify which resource). Lookups are always project-scoped so a
   * stale or hostile stamp can't pull in a record from another tenant.
   */
  private static async linkResourceContextFromSeries(input: {
    incident: Incident;
    seriesLabels: JSONObject;
    projectId: ObjectID;
  }): Promise<void> {
    const refs: SeriesResourceRefs = SeriesResourceLabels.extractResourceRefs(
      input.seriesLabels,
    );

    const [
      resolvedHosts,
      resolvedDockerHosts,
      resolvedClusters,
      resolvedServices,
    ] = await Promise.all([
      this.resolveResourceIds({
        ids: refs.hostIds,
        names: refs.hostNames,
        nameColumn: "hostIdentifier",
        projectId: input.projectId,
        findBy: HostService.findBy.bind(HostService),
      }),
      this.resolveResourceIds({
        ids: refs.dockerHostIds,
        names: refs.dockerHostNames,
        nameColumn: "hostIdentifier",
        projectId: input.projectId,
        findBy: DockerHostService.findBy.bind(DockerHostService),
      }),
      this.resolveResourceIds({
        ids: refs.kubernetesClusterIds,
        names: refs.kubernetesClusterNames,
        nameColumn: "clusterIdentifier",
        projectId: input.projectId,
        findBy: KubernetesClusterService.findBy.bind(KubernetesClusterService),
      }),
      this.resolveResourceIds({
        ids: refs.serviceIds,
        names: refs.serviceNames,
        nameColumn: "name",
        projectId: input.projectId,
        findBy: ServiceService.findBy.bind(ServiceService),
      }),
    ]);

    if (resolvedHosts.length > 0) {
      input.incident.hosts = resolvedHosts.map((id: string): Host => {
        const host: Host = new Host();
        host._id = id;
        return host;
      });
    }
    if (resolvedDockerHosts.length > 0) {
      input.incident.dockerHosts = resolvedDockerHosts.map(
        (id: string): DockerHost => {
          const dockerHost: DockerHost = new DockerHost();
          dockerHost._id = id;
          return dockerHost;
        },
      );
    }
    if (resolvedClusters.length > 0) {
      input.incident.kubernetesClusters = resolvedClusters.map(
        (id: string): KubernetesCluster => {
          const cluster: KubernetesCluster = new KubernetesCluster();
          cluster._id = id;
          return cluster;
        },
      );
    }
    if (resolvedServices.length > 0) {
      input.incident.services = resolvedServices.map((id: string): Service => {
        const service: Service = new Service();
        service._id = id;
        return service;
      });
    }
  }

  /*
   * Resolve a mix of ids and names to a deduped set of database ids
   * for one resource type, project-scoped. Either or both lists may
   * be empty; if both are empty the method short-circuits with no DB
   * round-trip.
   */
  private static async resolveResourceIds(input: {
    ids: Array<string>;
    names: Array<string>;
    nameColumn: string;
    projectId: ObjectID;
    /*
     * Loosely typed because the three resource services (Host,
     * DockerHost, KubernetesCluster) each have their own
     * `Query<TBaseModel>` shape and we deliberately abstract over
     * them. We only need the row's `_id` back, which every model
     * exposes via `DatabaseBaseModel`.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findBy: (args: any) => Promise<Array<{ _id?: string | undefined }>>;
  }): Promise<Array<string>> {
    if (input.ids.length === 0 && input.names.length === 0) {
      return [];
    }

    const resolved: Set<string> = new Set<string>();

    const lookups: Array<Promise<Array<{ _id?: string | undefined }>>> = [];
    if (input.ids.length > 0) {
      lookups.push(
        input.findBy({
          query: {
            projectId: input.projectId,
            _id: new Includes(input.ids),
          },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        }),
      );
    }
    if (input.names.length > 0) {
      lookups.push(
        input.findBy({
          query: {
            projectId: input.projectId,
            [input.nameColumn]: new Includes(input.names),
          },
          select: { _id: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        }),
      );
    }

    const buckets: Array<Array<{ _id?: string | undefined }>> =
      await Promise.all(lookups);
    for (const bucket of buckets) {
      for (const row of bucket) {
        if (row._id) {
          resolved.add(String(row._id));
        }
      }
    }
    return Array.from(resolved);
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
