import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import MonitorGroupResourceService from "./MonitorGroupResourceService";
import MonitorStatusService from "./MonitorStatusService";
import MonitorStatusTimelineService from "./MonitorStatusTimelineService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import MonitorGroup from "../../Models/DatabaseModels/MonitorGroup";
import MonitorGroupResource from "../../Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnDelete } from "../Types/Database/Hooks";
import StatusPageResourceService from "./StatusPageResourceService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<MonitorGroup> {
  public constructor() {
    super(MonitorGroup);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<MonitorGroup>,
  ): Promise<OnDelete<MonitorGroup>> {
    if (deleteBy.query._id) {
      // delete all the status page resource for this monitor.

      await StatusPageResourceService.deleteBy({
        query: {
          monitorGroupId: new ObjectID(deleteBy.query._id as string),
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    }

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  public async getStatusTimeline(
    monitorGroupId: ObjectID,
    startDate: Date,
    endDate: Date,
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<MonitorStatusTimeline>> {
    const monitorGroup: MonitorGroup | null = await this.findOneById({
      id: monitorGroupId,
      select: {
        _id: true,
        projectId: true,
      },
      props: props,
    });

    if (!monitorGroup) {
      throw new BadDataException("Monitor group not found.");
    }

    const monitorGroupResources: Array<MonitorGroupResource> =
      await MonitorGroupResourceService.findBy({
        query: {
          monitorGroupId: monitorGroup.id!,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          monitorId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (monitorGroupResources.length === 0) {
      return [];
    }

    const monitorStatusTimelines: Array<MonitorStatusTimeline> =
      await MonitorStatusTimelineService.findBy({
        query: {
          monitorId: QueryHelper.any(
            monitorGroupResources.map(
              (monitorGroupResource: MonitorGroupResource) => {
                return monitorGroupResource.monitorId!;
              },
            ),
          ),
          createdAt: QueryHelper.inBetween(startDate, endDate),
        },
        select: {
          createdAt: true,
          monitorId: true,
          startsAt: true,
          endsAt: true,
          monitorStatus: {
            name: true,
            color: true,
            isOperationalState: true,
            priority: true,
          } as any,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_MAX, // This can be optimized.
        props: {
          isRoot: true,
        },
      });

    return monitorStatusTimelines;
  }

  @CaptureSpan()
  public async getCurrentStatus(
    monitorGroupId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<MonitorStatus> {
    // get group id.

    const monitorGroup: MonitorGroup | null = await this.findOneById({
      id: monitorGroupId,
      select: {
        _id: true,
        projectId: true,
      },
      props: props,
    });

    if (!monitorGroup) {
      throw new BadDataException("Monitor group not found.");
    }

    // now get all the monitors in this group with current status.

    const monitorGroupResources: Array<MonitorGroupResource> =
      await MonitorGroupResourceService.findBy({
        query: {
          monitorGroupId: monitorGroup.id!,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          monitor: {
            currentMonitorStatusId: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    const monitorStatuses: Array<MonitorStatus> =
      await MonitorStatusService.findBy({
        query: {
          projectId: monitorGroup.projectId!,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          name: true,
          color: true,
          priority: true,
          isOperationalState: true,
        },
        props: {
          isRoot: true,
        },
      });

    let currentStatus: MonitorStatus | undefined = monitorStatuses.find(
      (monitorStatus: MonitorStatus) => {
        return monitorStatus.isOperationalState;
      },
    );

    if (!currentStatus) {
      throw new BadDataException("Operational state not found.");
    }

    for (const monitorGroupResource of monitorGroupResources) {
      if (!monitorGroupResource.monitor) {
        continue;
      }

      const monitorStatus: MonitorStatus | undefined = monitorStatuses.find(
        (monitorStatus: MonitorStatus) => {
          return (
            monitorStatus.id?.toString() ===
            monitorGroupResource.monitor!.currentMonitorStatusId?.toString()
          );
        },
      );

      if (monitorStatus && currentStatus.priority! < monitorStatus.priority!) {
        currentStatus = monitorStatus;
      }
    }

    return currentStatus;
  }
}
export default new Service();
