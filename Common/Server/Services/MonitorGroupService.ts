import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import MonitorGroupResourceService from "./MonitorGroupResourceService";
import MonitorStatusService from "./MonitorStatusService";
import MonitorStatusTimelineService from "./MonitorStatusTimelineService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../Types/Dictionary";
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
          /*
           * Select every row that OVERLAPS [startDate, endDate] - it started on or before the
           * window ends, and it either ended on or after the window started or is still open
           * (endsAt IS NULL). Filtering by createdAt-in-window missed rows that started before
           * the window but carry downtime into it (e.g. a monitor Offline since before the
           * window rendered as 100% uptime on the group page). Same predicate as
           * StatusPageService.getMonitorStatusTimelineForStatusPage.
           */
          startsAt: QueryHelper.lessThanEqualTo(endDate),
          endsAt: QueryHelper.greaterThanEqualToOrNull(startDate),
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
          /*
           * startsAt, not createdAt: they are different clocks (DB now() vs worker moment())
           * with real skew, and startsAt is the order the timeline math relies on.
           */
          startsAt: SortOrder.Ascending,
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

  /*
   * Batched fetch of MonitorGroupResource rows for many groups in ONE query
   * (paged only if the total exceeds LIMIT_MAX). The public status-page read
   * paths used to issue one query per monitor group per page view; on a page
   * with G groups that was an N+1 of G index lookups per request. Every
   * requested group id gets an entry in the returned dictionary (empty array
   * when the group has no resources).
   */
  @CaptureSpan()
  public async getMonitorGroupResourcesByGroupIds(
    monitorGroupIds: Array<ObjectID>,
  ): Promise<Dictionary<Array<MonitorGroupResource>>> {
    const resourcesByGroupId: Dictionary<Array<MonitorGroupResource>> = {};

    const dedupedGroupIds: Array<ObjectID> = [];
    for (const monitorGroupId of monitorGroupIds) {
      if (
        monitorGroupId &&
        !resourcesByGroupId[monitorGroupId.toString()]
      ) {
        resourcesByGroupId[monitorGroupId.toString()] = [];
        dedupedGroupIds.push(monitorGroupId);
      }
    }

    if (dedupedGroupIds.length === 0) {
      return resourcesByGroupId;
    }

    const monitorGroupResources: Array<MonitorGroupResource> =
      await MonitorGroupResourceService.findAllBy({
        query: {
          monitorGroupId: QueryHelper.any(dedupedGroupIds),
        },
        select: {
          monitorGroupId: true,
          monitorId: true,
          monitor: {
            currentMonitorStatusId: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    for (const monitorGroupResource of monitorGroupResources) {
      if (!monitorGroupResource.monitorGroupId) {
        continue;
      }

      resourcesByGroupId[monitorGroupResource.monitorGroupId.toString()]?.push(
        monitorGroupResource,
      );
    }

    return resourcesByGroupId;
  }

  // Batched twin of the per-group monitor-id lookup: ONE query for all groups.
  @CaptureSpan()
  public async getMonitorIdsInMonitorGroups(
    monitorGroupIds: Array<ObjectID>,
  ): Promise<Dictionary<Array<ObjectID>>> {
    const resourcesByGroupId: Dictionary<Array<MonitorGroupResource>> =
      await this.getMonitorGroupResourcesByGroupIds(monitorGroupIds);

    const monitorIdsByGroupId: Dictionary<Array<ObjectID>> = {};

    for (const groupId of Object.keys(resourcesByGroupId)) {
      monitorIdsByGroupId[groupId] = (resourcesByGroupId[groupId] || [])
        .map((resource: MonitorGroupResource) => {
          return resource.monitorId!;
        })
        .filter((id: ObjectID) => {
          return Boolean(id); // remove nulls
        });
    }

    return monitorIdsByGroupId;
  }

  /*
   * Batched twin of getCurrentStatus, preserving its exact semantics: each
   * group's status starts at the project's operational state and is replaced
   * by the highest-priority-number status among its monitors. Callers supply
   * the project's monitor statuses (they already have them in hand on every
   * path that renders a status page), so this issues at most ONE query — the
   * group-resource fetch — instead of three per group.
   */
  @CaptureSpan()
  public async getCurrentStatusesForMonitorGroups(data: {
    monitorGroupIds: Array<ObjectID>;
    monitorStatuses: Array<MonitorStatus>;
    monitorGroupResources?: Dictionary<Array<MonitorGroupResource>> | undefined;
  }): Promise<Dictionary<MonitorStatus>> {
    const currentStatuses: Dictionary<MonitorStatus> = {};

    if (data.monitorGroupIds.length === 0) {
      return currentStatuses;
    }

    const operationalStatus: MonitorStatus | undefined =
      data.monitorStatuses.find((monitorStatus: MonitorStatus) => {
        return monitorStatus.isOperationalState;
      });

    if (!operationalStatus) {
      throw new BadDataException("Operational state not found.");
    }

    const resourcesByGroupId: Dictionary<Array<MonitorGroupResource>> =
      data.monitorGroupResources ||
      (await this.getMonitorGroupResourcesByGroupIds(data.monitorGroupIds));

    for (const monitorGroupId of data.monitorGroupIds) {
      let currentStatus: MonitorStatus = operationalStatus;

      for (const monitorGroupResource of resourcesByGroupId[
        monitorGroupId.toString()
      ] || []) {
        if (!monitorGroupResource.monitor) {
          continue;
        }

        const monitorStatus: MonitorStatus | undefined =
          data.monitorStatuses.find((monitorStatus: MonitorStatus) => {
            return (
              monitorStatus.id?.toString() ===
              monitorGroupResource.monitor!.currentMonitorStatusId?.toString()
            );
          });

        if (
          monitorStatus &&
          currentStatus.priority! < monitorStatus.priority!
        ) {
          currentStatus = monitorStatus;
        }
      }

      currentStatuses[monitorGroupId.toString()] = currentStatus;
    }

    return currentStatuses;
  }
}
export default new Service();
