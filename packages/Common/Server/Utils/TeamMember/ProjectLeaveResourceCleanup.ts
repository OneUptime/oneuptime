import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../Types/Dictionary";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import AIAgentOwnerUserService from "../../Services/AIAgentOwnerUserService";
import AlertEpisodeOwnerUserService from "../../Services/AlertEpisodeOwnerUserService";
import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertOwnerUserService from "../../Services/AlertOwnerUserService";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import CephClusterOwnerUserService from "../../Services/CephClusterOwnerUserService";
import CloudResourceOwnerUserService from "../../Services/CloudResourceOwnerUserService";
import DashboardOwnerUserService from "../../Services/DashboardOwnerUserService";
import DatabaseService from "../../Services/DatabaseService";
import DatabaseServerOwnerUserService from "../../Services/DatabaseServerOwnerUserService";
import DockerHostOwnerUserService from "../../Services/DockerHostOwnerUserService";
import DockerSwarmClusterOwnerUserService from "../../Services/DockerSwarmClusterOwnerUserService";
import HostOwnerUserService from "../../Services/HostOwnerUserService";
import IncidentEpisodeOwnerUserService from "../../Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodeRoleMemberService from "../../Services/IncidentEpisodeRoleMemberService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentMemberService from "../../Services/IncidentMemberService";
import IncidentOwnerUserService from "../../Services/IncidentOwnerUserService";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import IncidentTemplateOwnerUserService from "../../Services/IncidentTemplateOwnerUserService";
import IncomingCallPolicyOwnerUserService from "../../Services/IncomingCallPolicyOwnerUserService";
import IoTFleetOwnerUserService from "../../Services/IoTFleetOwnerUserService";
import KubernetesClusterOwnerUserService from "../../Services/KubernetesClusterOwnerUserService";
import MonitorGroupOwnerUserService from "../../Services/MonitorGroupOwnerUserService";
import MonitorOwnerUserService from "../../Services/MonitorOwnerUserService";
import NetworkDeviceOwnerUserService from "../../Services/NetworkDeviceOwnerUserService";
import OnCallDutyPolicyOwnerUserService from "../../Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyScheduleOwnerUserService from "../../Services/OnCallDutyPolicyScheduleOwnerUserService";
import PodmanHostOwnerUserService from "../../Services/PodmanHostOwnerUserService";
import ProbeOwnerUserService from "../../Services/ProbeOwnerUserService";
import ProxmoxClusterOwnerUserService from "../../Services/ProxmoxClusterOwnerUserService";
import RumApplicationOwnerUserService from "../../Services/RumApplicationOwnerUserService";
import RunbookOwnerUserService from "../../Services/RunbookOwnerUserService";
import RunnerOwnerUserService from "../../Services/RunnerOwnerUserService";
import ScheduledMaintenanceOwnerUserService from "../../Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceTemplateOwnerUserService from "../../Services/ScheduledMaintenanceTemplateOwnerUserService";
import ServerlessFunctionOwnerUserService from "../../Services/ServerlessFunctionOwnerUserService";
import ServiceLevelObjectiveOwnerUserService from "../../Services/ServiceLevelObjectiveOwnerUserService";
import ServiceOwnerUserService from "../../Services/ServiceOwnerUserService";
import StatusPageOwnerUserService from "../../Services/StatusPageOwnerUserService";
import VMwareVCenterOwnerUserService from "../../Services/VMwareVCenterOwnerUserService";
import WorkflowOwnerUserService from "../../Services/WorkflowOwnerUserService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";

/*
 * What cleanupForUserLeavingProject removed, for logging and for the tests.
 * Every count is "as far as we got": a step that failed is logged and the
 * remaining steps still run.
 */
export interface ProjectLeaveResourceCleanupResult {
  removedIncidentEpisodeRoleCount: number;
  removedIncidentRoleCount: number;
  // Keyed by the owner table, e.g. "MonitorOwnerUser". Tables with no rows are left out.
  removedOwnerUserCounts: Dictionary<number>;
}

/*
 * Resources that open and close. On these only the OPEN ones lose the
 * departed user: a resolved incident keeps the record of who owned it and
 * who ran it, exactly as it keeps its timeline.
 */
export enum LifecycleResource {
  Incident = "Incident",
  IncidentEpisode = "IncidentEpisode",
  Alert = "Alert",
  AlertEpisode = "AlertEpisode",
  ScheduledMaintenance = "ScheduledMaintenance",
}

export interface OwnerUserTable {
  service: DatabaseService<DatabaseBaseModel>;
  // The owner rows' column holding the resource id, e.g. "monitorId".
  resourceIdColumn: string;
  // Set for resources that open and close; see LifecycleResource.
  lifecycle?: LifecycleResource | undefined;
}

function ownerUserTable<TModel extends DatabaseBaseModel>(
  service: DatabaseService<TModel>,
  resourceIdColumn: string,
  lifecycle?: LifecycleResource,
): OwnerUserTable {
  return {
    service: service as unknown as DatabaseService<DatabaseBaseModel>,
    resourceIdColumn,
    lifecycle,
  };
}

function uniqueIds(ids: Array<ObjectID | undefined>): Array<ObjectID> {
  const seen: Set<string> = new Set<string>();
  const result: Array<ObjectID> = [];

  for (const id of ids) {
    if (!id || seen.has(id.toString())) {
      continue;
    }

    seen.add(id.toString());
    result.push(id);
  }

  return result;
}

export default class ProjectLeaveResourceCleanup {
  /*
   * Every <Resource>OwnerUser table. A new owner table belongs here too — the
   * test for this class fails when one is missing.
   */
  public static getOwnerUserTables(): Array<OwnerUserTable> {
    return [
      ownerUserTable(
        IncidentOwnerUserService,
        "incidentId",
        LifecycleResource.Incident,
      ),
      ownerUserTable(
        IncidentEpisodeOwnerUserService,
        "incidentEpisodeId",
        LifecycleResource.IncidentEpisode,
      ),
      ownerUserTable(AlertOwnerUserService, "alertId", LifecycleResource.Alert),
      ownerUserTable(
        AlertEpisodeOwnerUserService,
        "alertEpisodeId",
        LifecycleResource.AlertEpisode,
      ),
      ownerUserTable(
        ScheduledMaintenanceOwnerUserService,
        "scheduledMaintenanceId",
        LifecycleResource.ScheduledMaintenance,
      ),
      ownerUserTable(AIAgentOwnerUserService, "aiAgentId"),
      ownerUserTable(CephClusterOwnerUserService, "cephClusterId"),
      ownerUserTable(CloudResourceOwnerUserService, "cloudResourceId"),
      ownerUserTable(DashboardOwnerUserService, "dashboardId"),
      ownerUserTable(DatabaseServerOwnerUserService, "databaseServerId"),
      ownerUserTable(DockerHostOwnerUserService, "dockerHostId"),
      ownerUserTable(
        DockerSwarmClusterOwnerUserService,
        "dockerSwarmClusterId",
      ),
      ownerUserTable(HostOwnerUserService, "hostId"),
      ownerUserTable(IncidentTemplateOwnerUserService, "incidentTemplateId"),
      ownerUserTable(
        IncomingCallPolicyOwnerUserService,
        "incomingCallPolicyId",
      ),
      ownerUserTable(IoTFleetOwnerUserService, "iotFleetId"),
      ownerUserTable(KubernetesClusterOwnerUserService, "kubernetesClusterId"),
      ownerUserTable(MonitorGroupOwnerUserService, "monitorGroupId"),
      ownerUserTable(MonitorOwnerUserService, "monitorId"),
      ownerUserTable(NetworkDeviceOwnerUserService, "networkDeviceId"),
      ownerUserTable(OnCallDutyPolicyOwnerUserService, "onCallDutyPolicyId"),
      ownerUserTable(
        OnCallDutyPolicyScheduleOwnerUserService,
        "onCallDutyPolicyScheduleId",
      ),
      ownerUserTable(PodmanHostOwnerUserService, "podmanHostId"),
      ownerUserTable(ProbeOwnerUserService, "probeId"),
      ownerUserTable(ProxmoxClusterOwnerUserService, "proxmoxClusterId"),
      ownerUserTable(RumApplicationOwnerUserService, "rumApplicationId"),
      ownerUserTable(RunbookOwnerUserService, "runbookId"),
      ownerUserTable(RunnerOwnerUserService, "runnerId"),
      ownerUserTable(
        ScheduledMaintenanceTemplateOwnerUserService,
        "scheduledMaintenanceTemplateId",
      ),
      ownerUserTable(
        ServerlessFunctionOwnerUserService,
        "serverlessFunctionId",
      ),
      ownerUserTable(
        ServiceLevelObjectiveOwnerUserService,
        "serviceLevelObjectiveId",
      ),
      ownerUserTable(ServiceOwnerUserService, "serviceId"),
      ownerUserTable(StatusPageOwnerUserService, "statusPageId"),
      ownerUserTable(VMwareVCenterOwnerUserService, "vmwareVCenterId"),
      ownerUserTable(WorkflowOwnerUserService, "workflowId"),
    ];
  }

  /**
   * A user who has left the project must stop being attached to its work.
   * Their incident roles and owner rows used to survive, so they kept being
   * listed as commander or owner, and the owner notifications claimed to
   * have reached someone whose notification settings were already gone. In
   * order:
   *
   *   1. delete their incident episode role assignments on OPEN episodes —
   *      through the service, whose hooks take the role off every incident
   *      in the episode, as a manual removal does,
   *   2. delete their remaining incident role assignments on OPEN incidents,
   *      through the service, so each writes the "Removed ... as <role>"
   *      incident feed item,
   *   3. delete their owner rows: on incidents, episodes, alerts and
   *      scheduled maintenance only where the resource is still open; on
   *      every other resource (monitors, status pages, policies, ...) all of
   *      them. Through each owner service, so the ones that write an
   *      "owner removed" feed item on a manual removal write it here too.
   *
   * Closed resources keep their roles and owners as history. Each step is
   * isolated: a failure is logged and the next step still runs.
   * Unconditional — callers decide whether the user really left (see
   * TeamMemberService.cleanupResourceAssignmentsIfUserLeftProject).
   */
  public static async cleanupForUserLeavingProject(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<ProjectLeaveResourceCleanupResult> {
    const { projectId, userId } = data;

    const logAttributes: LogAttributes = {
      projectId: projectId.toString(),
      userId: userId.toString(),
    } as LogAttributes;

    const result: ProjectLeaveResourceCleanupResult = {
      removedIncidentEpisodeRoleCount: 0,
      removedIncidentRoleCount: 0,
      removedOwnerUserCounts: {},
    };

    // 1. Episode roles first: removing one also removes it from the episode's incidents.
    try {
      result.removedIncidentEpisodeRoleCount =
        await this.deleteRowsOnOpenResources({
          service:
            IncidentEpisodeRoleMemberService as unknown as DatabaseService<DatabaseBaseModel>,
          resourceIdColumn: "incidentEpisodeId",
          lifecycle: LifecycleResource.IncidentEpisode,
          projectId,
          userId,
        });
    } catch (err) {
      logger.error(
        "Error removing incident episode roles of a user who left the project (best-effort).",
        logAttributes,
      );
      logger.error(err as Error, logAttributes);
    }

    // 2. Incident roles.
    try {
      result.removedIncidentRoleCount = await this.deleteRowsOnOpenResources({
        service:
          IncidentMemberService as unknown as DatabaseService<DatabaseBaseModel>,
        resourceIdColumn: "incidentId",
        lifecycle: LifecycleResource.Incident,
        projectId,
        userId,
      });
    } catch (err) {
      logger.error(
        "Error removing incident roles of a user who left the project (best-effort).",
        logAttributes,
      );
      logger.error(err as Error, logAttributes);
    }

    // 3. Owner rows.
    for (const table of this.getOwnerUserTables()) {
      const tableName: string =
        table.service.getModel().tableName || table.resourceIdColumn;

      try {
        const removed: number = table.lifecycle
          ? await this.deleteRowsOnOpenResources({
              service: table.service,
              resourceIdColumn: table.resourceIdColumn,
              lifecycle: table.lifecycle,
              projectId,
              userId,
            })
          : await this.deleteAllRows({
              service: table.service,
              projectId,
              userId,
            });

        if (removed > 0) {
          result.removedOwnerUserCounts[tableName] = removed;
        }
      } catch (err) {
        logger.error(
          `Error removing ${tableName} rows of a user who left the project (best-effort).`,
          logAttributes,
        );
        logger.error(err as Error, logAttributes);
      }
    }

    logger.debug(
      `Resource cleanup for a user leaving the project: ${JSON.stringify(result)}`,
      logAttributes,
    );

    return result;
  }

  // The ids among `resourceIds` whose resource is still open.
  public static async getOpenResourceIds(data: {
    lifecycle: LifecycleResource;
    projectId: ObjectID;
    resourceIds: Array<ObjectID>;
  }): Promise<Array<ObjectID>> {
    if (data.resourceIds.length === 0) {
      return [];
    }

    const { projectId } = data;

    let openStateIds: Array<ObjectID> = [];
    let resourceService: DatabaseService<DatabaseBaseModel>;
    let stateColumn: string;

    switch (data.lifecycle) {
      case LifecycleResource.Incident:
      case LifecycleResource.IncidentEpisode:
        openStateIds = uniqueIds(
          (
            await IncidentStateService.getUnresolvedIncidentStates(projectId, {
              isRoot: true,
            })
          ).map((state: DatabaseBaseModel) => {
            return state.id || undefined;
          }),
        );
        resourceService = (data.lifecycle === LifecycleResource.Incident
          ? IncidentService
          : IncidentEpisodeService) as unknown as DatabaseService<DatabaseBaseModel>;
        stateColumn = "currentIncidentStateId";
        break;
      case LifecycleResource.Alert:
      case LifecycleResource.AlertEpisode:
        openStateIds = uniqueIds(
          (
            await AlertStateService.getUnresolvedAlertStates(projectId, {
              isRoot: true,
            })
          ).map((state: DatabaseBaseModel) => {
            return state.id || undefined;
          }),
        );
        resourceService = (data.lifecycle === LifecycleResource.Alert
          ? AlertService
          : AlertEpisodeService) as unknown as DatabaseService<DatabaseBaseModel>;
        stateColumn = "currentAlertStateId";
        break;
      case LifecycleResource.ScheduledMaintenance:
        openStateIds =
          await this.getOpenScheduledMaintenanceStateIds(projectId);
        resourceService =
          ScheduledMaintenanceService as unknown as DatabaseService<DatabaseBaseModel>;
        stateColumn = "currentScheduledMaintenanceStateId";
        break;
    }

    if (openStateIds.length === 0) {
      return [];
    }

    const openResources: Array<DatabaseBaseModel> =
      await resourceService.findBy({
        query: {
          projectId: projectId,
          _id: QueryHelper.any(data.resourceIds),
          [stateColumn]: QueryHelper.any(openStateIds),
        } as unknown as Query<DatabaseBaseModel>,
        select: {
          _id: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return uniqueIds(
      openResources.map((resource: DatabaseBaseModel) => {
        return resource.id || undefined;
      }),
    );
  }

  /*
   * Scheduled, ongoing: open. Everything from the first ended or completed
   * state on: over — the same order-based reading the incident and alert
   * helpers use for "everything after resolved is resolved".
   */
  private static async getOpenScheduledMaintenanceStateIds(
    projectId: ObjectID,
  ): Promise<Array<ObjectID>> {
    const states: Array<ScheduledMaintenanceState> =
      await ScheduledMaintenanceStateService.findBy({
        query: {
          projectId: projectId,
        },
        select: {
          _id: true,
          isEndedState: true,
          isResolvedState: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const openStateIds: Array<ObjectID> = [];

    for (const state of states) {
      if (state.isEndedState || state.isResolvedState) {
        break;
      }

      if (state.id) {
        openStateIds.push(state.id);
      }
    }

    return openStateIds;
  }

  private static async deleteRowsOnOpenResources(data: {
    service: DatabaseService<DatabaseBaseModel>;
    resourceIdColumn: string;
    lifecycle: LifecycleResource;
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<number> {
    const rows: Array<DatabaseBaseModel> = await data.service.findBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
      } as unknown as Query<DatabaseBaseModel>,
      select: {
        _id: true,
        [data.resourceIdColumn]: true,
      } as never,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (rows.length === 0) {
      return 0;
    }

    const openResourceIds: Array<ObjectID> = await this.getOpenResourceIds({
      lifecycle: data.lifecycle,
      projectId: data.projectId,
      resourceIds: uniqueIds(
        rows.map((row: DatabaseBaseModel) => {
          return row.getValue<ObjectID>(data.resourceIdColumn) || undefined;
        }),
      ),
    });

    if (openResourceIds.length === 0) {
      return 0;
    }

    return await data.service.deleteBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
        [data.resourceIdColumn]: QueryHelper.any(openResourceIds),
      } as unknown as Query<DatabaseBaseModel>,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  private static async deleteAllRows(data: {
    service: DatabaseService<DatabaseBaseModel>;
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<number> {
    const query: Query<DatabaseBaseModel> = {
      projectId: data.projectId,
      userId: data.userId,
    } as unknown as Query<DatabaseBaseModel>;

    const count: PositiveNumber = await data.service.countBy({
      query: query,
      props: {
        isRoot: true,
      },
    });

    if (count.toNumber() === 0) {
      return 0;
    }

    return await data.service.deleteBy({
      query: query,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }
}
