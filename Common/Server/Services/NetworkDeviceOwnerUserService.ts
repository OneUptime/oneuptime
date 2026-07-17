import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import NetworkDeviceOwnerTeamService from "./NetworkDeviceOwnerTeamService";
import Model from "../../Models/DatabaseModels/NetworkDeviceOwnerUser";
import Monitor from "../../Models/DatabaseModels/Monitor";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export interface NetworkDeviceOwners {
  ownerUserIds: Array<ObjectID>;
  ownerTeamIds: Array<ObjectID>;
}

export class Service extends DatabaseService<Model> {
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

    if (!networkDeviceIdAsString) {
      return {
        ownerUserIds: [],
        ownerTeamIds: [],
      };
    }

    const networkDeviceId: ObjectID = new ObjectID(networkDeviceIdAsString);
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
