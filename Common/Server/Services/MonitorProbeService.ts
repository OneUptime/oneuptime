import ObjectID from "Common/Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import QueryHelper from "../Types/Database/QueryHelper";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorService from "./MonitorService";

export class Service extends DatabaseService<MonitorProbe> {
  public constructor() {
    super(MonitorProbe);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<MonitorProbe>,
  ): Promise<OnCreate<MonitorProbe>> {
    if (
      (createBy.data.monitorId || createBy.data.monitor) &&
      (createBy.data.probeId || createBy.data.probe)
    ) {
      const monitorProbe: MonitorProbe | null = await this.findOneBy({
        query: {
          monitorId: createBy.data.monitorId! || createBy.data.monitor?.id,
          probeId: createBy.data.probeId! || createBy.data.probe?.id,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (monitorProbe) {
        throw new BadDataException("Probe is already added to this monitor.");
      }
    }

    if (!createBy.data.nextPingAt) {
      createBy.data.nextPingAt = OneUptimeDate.getCurrentDate();
    }

    if (!createBy.data.lastPingAt) {
      createBy.data.lastPingAt = OneUptimeDate.getCurrentDate();
    }

    return { createBy, carryForward: null };
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<MonitorProbe>,
    createdItem: MonitorProbe,
  ): Promise<MonitorProbe> {
    if (createdItem.probeId) {
      await MonitorService.refreshProbeStatus(createdItem.probeId);
    }

    return Promise.resolve(createdItem);
  }

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<MonitorProbe>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<MonitorProbe>> {
    // if isEnabled is updated, refresh the probe status
    if (onUpdate.updateBy.data.isEnabled !== undefined) {
      const monitorProbes: Array<MonitorProbe> = await this.findBy({
        query: {
          _id: QueryHelper.any(updatedItemIds),
        },
        select: {
          monitorId: true,
          probeId: true,
          nextPingAt: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const monitorProbe of monitorProbes) {
        if (!monitorProbe.probeId) {
          continue;
        }

        await MonitorService.refreshProbeStatus(monitorProbe.probeId);
      }
    }

    return onUpdate;
  }
}

export default new Service();
