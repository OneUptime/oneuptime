import QueryHelper from "../Types/Database/QueryHelper";
import ProjectReferencesService from "./ProjectReferencesService";
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
import ArchivedMonitorResources from "../../Utils/StatusPage/ArchivedMonitorResources";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorService from "./MonitorService";
import MonitorGroupMonitoring, {
  MonitorGroupMonitoringChange,
  MonitorGroupMonitoringSummary,
} from "../../Utils/Monitor/MonitorGroupMonitoring";

export class Service extends ProjectReferencesService<MonitorGroup> {
  public constructor() {
    super(MonitorGroup);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<MonitorGroup>,
  ): Promise<OnDelete<MonitorGroup>> {
    // The groups the delete removes, and the delete held to them.
    const groups: Array<MonitorGroup> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      { _id: true },
    );

    for (const group of groups) {
      if (!group.id) {
        continue;
      }

      // Every status page resource that shows the group goes with it.
      await StatusPageResourceService.deleteBy({
        query: {
          monitorGroupId: group.id,
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
      ArchivedMonitorResources.withoutArchivedMonitors(
        await MonitorGroupResourceService.findBy({
          query: {
            monitorGroupId: monitorGroup.id!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            monitorId: true,
            monitor: {
              isArchived: true,
            },
          },
          props: {
            isRoot: true,
          },
        }),
      );

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

    /*
     * An archived monitor is not checked, so its status is frozen: it does
     * not count towards the group's status (ArchivedMonitorResources).
     */
    const monitorGroupResources: Array<MonitorGroupResource> =
      ArchivedMonitorResources.withoutArchivedMonitors(
        await MonitorGroupResourceService.findBy({
          query: {
            monitorGroupId: monitorGroup.id!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            monitor: {
              currentMonitorStatusId: true,
              isArchived: true,
            },
          },
          props: {
            isRoot: true,
          },
        }),
      );

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
   * MONITORING FOR EVERY MONITOR IN THE GROUP (issue #6401;
   * Utils/Monitor/MonitorGroupMonitoring).
   *
   * How many of the group's monitors are checked, and of those how many have
   * their monitoring turned off. Archived monitors are left out, as from the
   * group's status. The group is read as the caller, so only someone who may
   * see it is answered; its monitors are read as OneUptime, as for its status.
   */
  @CaptureSpan()
  public async getMonitoringSummary(
    monitorGroupId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<MonitorGroupMonitoringSummary> {
    const monitorGroup: MonitorGroup = await this.findGroupForMonitoring(
      monitorGroupId,
      props,
    );

    return MonitorGroupMonitoring.getSummary(
      await this.getMonitorsToSwitch(monitorGroup),
    );
  }

  /*
   * Turns monitoring off, or on, for every monitor in the group that is not
   * archived: one update of those monitors, made as the caller. So it
   * changes only the monitors they may edit, and does what the monitor's own
   * switch does - turning monitoring on passes the pay-as-you-go gate, and
   * turning it off resolves the incidents and alerts each monitor would have
   * resolved itself (MonitorService.onUpdateSuccess, MonitorTurnedOff). A
   * monitor already as asked is left alone. Answers how many it turned, and
   * the group's monitors as they are now.
   */
  @CaptureSpan()
  public async setMonitoringForMonitorsInGroup(data: {
    monitorGroupId: ObjectID;
    isMonitoringOn: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<MonitorGroupMonitoringChange> {
    const monitorGroup: MonitorGroup = await this.findGroupForMonitoring(
      data.monitorGroupId,
      data.props,
    );

    // The switch is stored the other way round: on is disableActiveMonitoring false.
    const disableActiveMonitoring: boolean = !data.isMonitoringOn;

    const monitorIdsToTurn: Array<ObjectID> = (
      await this.getMonitorsToSwitch(monitorGroup)
    )
      .filter((monitor: Monitor): boolean => {
        return (
          Boolean(monitor.id) &&
          (monitor.disableActiveMonitoring === true) !== disableActiveMonitoring
        );
      })
      .map((monitor: Monitor): ObjectID => {
        return monitor.id!;
      });

    let changedCount: number = 0;

    if (monitorIdsToTurn.length > 0) {
      changedCount = await MonitorService.updateBy({
        query: {
          _id: QueryHelper.any(monitorIdsToTurn),
          projectId: monitorGroup.projectId!,
          isArchived: false,
          disableActiveMonitoring: !disableActiveMonitoring,
        },
        data: {
          disableActiveMonitoring: disableActiveMonitoring,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: data.props,
      });
    }

    return {
      ...MonitorGroupMonitoring.getSummary(
        await this.getMonitorsToSwitch(monitorGroup),
      ),
      changedCount: changedCount,
    };
  }

  // The group, read as the caller: only someone who may see it goes on.
  private async findGroupForMonitoring(
    monitorGroupId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<MonitorGroup> {
    const monitorGroup: MonitorGroup | null = await this.findOneById({
      id: monitorGroupId,
      select: {
        _id: true,
        projectId: true,
      },
      props: props,
    });

    if (!monitorGroup || !monitorGroup.id || !monitorGroup.projectId) {
      throw new BadDataException("Monitor group not found.");
    }

    return monitorGroup;
  }

  // The group's monitors that are not archived, each with its switch.
  private async getMonitorsToSwitch(
    monitorGroup: MonitorGroup,
  ): Promise<Array<Monitor>> {
    const monitorGroupResources: Array<MonitorGroupResource> =
      ArchivedMonitorResources.withoutArchivedMonitors(
        await MonitorGroupResourceService.findBy({
          query: {
            monitorGroupId: monitorGroup.id!,
            projectId: monitorGroup.projectId!,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            monitorId: true,
            monitor: {
              _id: true,
              isArchived: true,
              disableActiveMonitoring: true,
            },
          },
          props: {
            isRoot: true,
          },
        }),
      );

    const monitors: Array<Monitor> = [];
    const monitorIdsSeen: Set<string> = new Set<string>();

    for (const monitorGroupResource of monitorGroupResources) {
      const monitor: Monitor | undefined = monitorGroupResource.monitor;
      const monitorId: string | undefined = (
        monitor?.id || monitorGroupResource.monitorId
      )?.toString();

      // A row whose monitor is gone, or a monitor listed twice, counts once at most.
      if (!monitor || !monitorId || monitorIdsSeen.has(monitorId)) {
        continue;
      }

      monitorIdsSeen.add(monitorId);

      if (!monitor.id) {
        monitor.id = new ObjectID(monitorId);
      }

      monitors.push(monitor);
    }

    return monitors;
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
      if (monitorGroupId && !resourcesByGroupId[monitorGroupId.toString()]) {
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
            isArchived: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    /*
     * Archived members are left out: a status page that shows the group, its
     * status and its timeline all come from here, and an archived monitor's
     * frozen status must not decide any of them.
     */
    for (const monitorGroupResource of ArchivedMonitorResources.withoutArchivedMonitors(
      monitorGroupResources,
    )) {
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
