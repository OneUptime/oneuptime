import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import ObjectID from "../../Types/ObjectID";
import ProjectReferencesService from "./ProjectReferencesService";
import NetworkDeviceOwnerTeamService from "./NetworkDeviceOwnerTeamService";
import Model from "../../Models/DatabaseModels/NetworkDeviceOwnerUser";
import NetworkDeviceOwnerTeam from "../../Models/DatabaseModels/NetworkDeviceOwnerTeam";
import Monitor from "../../Models/DatabaseModels/Monitor";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface NetworkDeviceOwners {
  ownerUserIds: Array<ObjectID>;
  ownerTeamIds: Array<ObjectID>;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Returns the ids of all users that own the given network device. Used to
   * fan device ownership into monitor-created incidents/alerts and into the
   * owner-added notification job.
   */
  @CaptureSpan()
  public async getOwnerUserIdsForDevice(
    networkDeviceId: ObjectID,
    projectId?: ObjectID | undefined,
  ): Promise<Array<ObjectID>> {
    const ownerUsers: Array<Model> = await this.findBy({
      query: {
        networkDeviceId: networkDeviceId,
        /*
         * Scope to the project when known so a monitor step referencing a
         * device from another project can never fan out its owners.
         */
        ...(projectId ? { projectId: projectId } : {}),
      },
      select: {
        _id: true,
        userId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    return ownerUsers
      .map((ownerUser: Model) => {
        return ownerUser.userId!;
      })
      .filter((userId: ObjectID) => {
        return Boolean(userId);
      });
  }

  /*
   * The network device a monitor's step watches, as its owners are found
   * (getDeviceOwnersForMonitor): the step's, or else the first step's that
   * names one. Null for a monitor that watches no device. Reads nothing.
   */
  public getDeviceIdForMonitor(data: {
    monitor: Monitor;
    monitorStepId?: string | undefined;
  }): ObjectID | null {
    const monitorSteps: Array<MonitorStep> =
      data.monitor.monitorSteps?.data?.monitorStepsInstanceArray || [];

    let monitorStep: MonitorStep | undefined = undefined;

    if (data.monitorStepId) {
      monitorStep = monitorSteps.find((step: MonitorStep) => {
        return step.id.toString() === data.monitorStepId;
      });
    }

    if (!monitorStep?.data?.networkDeviceMonitor?.networkDeviceId) {
      monitorStep = monitorSteps.find((step: MonitorStep) => {
        return Boolean(step.data?.networkDeviceMonitor?.networkDeviceId);
      });
    }

    const networkDeviceIdAsString: string | undefined =
      monitorStep?.data?.networkDeviceMonitor?.networkDeviceId;

    return networkDeviceIdAsString
      ? new ObjectID(networkDeviceIdAsString)
      : null;
  }

  /*
   * THE OWNERS OF MANY NETWORK DEVICES OF ONE PROJECT AT ONCE (#9407,
   * #9371), by device id in lower case: every device asked for is in the
   * map, with no owners when nobody owns it. For a reader of every monitor
   * of a project (WhoIsToldService.resolveProject), which would otherwise
   * read each monitor's device on its own (getDeviceOwnersForMonitor): two
   * reads, however many devices, scoped to the project as that one is.
   */
  @CaptureSpan()
  public async getDeviceOwnersForDevices(data: {
    projectId: ObjectID;
    networkDeviceIds: Array<ObjectID>;
  }): Promise<Map<string, NetworkDeviceOwners>> {
    const owners: Map<string, NetworkDeviceOwners> = new Map();
    const deviceIds: Array<ObjectID> = [];

    for (const id of data.networkDeviceIds) {
      const key: string = id.toString().trim().toLowerCase();

      if (key && !owners.has(key)) {
        owners.set(key, { ownerUserIds: [], ownerTeamIds: [] });
        deviceIds.push(id);
      }
    }

    if (deviceIds.length === 0) {
      return owners;
    }

    const [users, teams]: [Array<Model>, Array<NetworkDeviceOwnerTeam>] =
      await Promise.all([
        this.findAllBy({
          query: {
            networkDeviceId: QueryHelper.any(deviceIds),
            projectId: data.projectId,
          },
          select: { networkDeviceId: true, userId: true },
          props: { isRoot: true },
        }),
        NetworkDeviceOwnerTeamService.findAllBy({
          query: {
            networkDeviceId: QueryHelper.any(deviceIds),
            projectId: data.projectId,
          },
          select: { networkDeviceId: true, teamId: true },
          props: { isRoot: true },
        }),
      ]);

    for (const row of users) {
      const device: NetworkDeviceOwners | undefined = owners.get(
        row.networkDeviceId?.toString().toLowerCase() || "",
      );

      if (device && row.userId) {
        device.ownerUserIds.push(row.userId);
      }
    }

    for (const row of teams) {
      const device: NetworkDeviceOwners | undefined = owners.get(
        row.networkDeviceId?.toString().toLowerCase() || "",
      );

      if (device && row.teamId) {
        device.ownerTeamIds.push(row.teamId);
      }
    }

    return owners;
  }

  /*
   * Resolves the owner users/teams of the network device a monitor watches
   * (if any). The device id lives on the monitor step config
   * (step.data.networkDeviceMonitor.networkDeviceId). Prefer the step that
   * produced the current probe response; fall back to the first step that
   * references a device so callers without a step id still pick up owners.
   * No-op (and no queries) for monitors that do not reference a device.
   */
  @CaptureSpan()
  public async getDeviceOwnersForMonitor(data: {
    monitor: Monitor;
    monitorStepId?: string | undefined;
  }): Promise<NetworkDeviceOwners> {
    const networkDeviceId: ObjectID | null = this.getDeviceIdForMonitor(data);

    if (!networkDeviceId) {
      return {
        ownerUserIds: [],
        ownerTeamIds: [],
      };
    }

    const projectId: ObjectID | undefined = data.monitor.projectId;

    return {
      ownerUserIds: await this.getOwnerUserIdsForDevice(
        networkDeviceId,
        projectId,
      ),
      ownerTeamIds:
        await NetworkDeviceOwnerTeamService.getOwnerTeamIdsForDevice(
          networkDeviceId,
          projectId,
        ),
    };
  }
}

export default new Service();
