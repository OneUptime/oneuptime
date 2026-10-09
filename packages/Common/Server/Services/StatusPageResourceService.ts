import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectReferencesService from "./ProjectReferencesService";
import MonitorGroupResourceService from "./MonitorGroupResourceService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ContiguousOrder from "../Utils/Database/ContiguousOrder";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Model from "../../Models/DatabaseModels/StatusPageResource";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorGroupResource from "../../Models/DatabaseModels/MonitorGroupResource";

/*
 * The two names of each reference this service reads off a write itself, ID
 * column first. Everything server side sets the ID column, while the
 * dashboard's resource form posts the relation - a real Monitor on create
 * (BaseModel.fromJSON), the plain `{ _id: "<uuid>" }` the browser sent on
 * update - and RelationIdUtil reads either shape. The two names must agree
 * (RelationIdUtil.readConsistent): the id checked is the id stored.
 */
const STATUS_PAGE_KEYS: Array<string> = ["statusPageId", "statusPage"];
const STATUS_PAGE_GROUP_KEYS: Array<string> = [
  "statusPageGroupId",
  "statusPageGroup",
];
const MONITOR_KEYS: Array<string> = ["monitorId", "monitor"];
const MONITOR_GROUP_KEYS: Array<string> = ["monitorGroupId", "monitorGroup"];

interface StatusPageResourceTarget {
  monitorId: ObjectID | null;
  monitorGroupId: ObjectID | null;
}

/*
 * A resource moved to another place by a non-root update: where it was, where
 * it goes, and its list. Read before the update (onBeforeUpdate) and acted on
 * after it (onUpdateSuccess), only if the update wrote that resource.
 */
interface ResourceMove {
  resourceId: ObjectID;
  previousOrder: number;
  newOrder: number;
  statusPageId: ObjectID;
  statusPageGroupId: ObjectID | null;
  projectId: ObjectID;
}

/**
 * Named after what the operator sees rather than what the column is, because
 * this reads back to them on the resource form.
 */
function duplicateResourceException(
  target: StatusPageResourceTarget,
): BadDataException {
  const thing: string = target.monitorId ? "monitor" : "monitor group";

  return new BadDataException(
    `This ${thing} is already added to this status page. A ${thing} can only be added once so it is not shown twice to your customers.`,
  );
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The status page resources that show these monitors, on every page: a
   * resource for one of the monitors, or for a monitor group that holds one
   * of them. A status page shows an event on a monitor under the group the
   * monitor is in, and someone who subscribed to that group expects to hear
   * about every monitor in it.
   *
   * This is the one lookup from monitors to resources. Every subscriber
   * notification finds the resources an event affects here (incidents and
   * episodes through IncidentStatusPageScope, announcements and scheduled
   * maintenance through AffectedStatusPageResources), and so do the status
   * pages the dashboard suggests for an event (StatusPagesListingMonitors),
   * so the page suggested and the subscribers told agree.
   *
   * Every row is read, however many there are: a resource left out is a
   * subscriber who is silently not told. A caller that knows which status
   * pages the event is on passes them as statusPageIds, and only those
   * pages' resources are read.
   */
  @CaptureSpan()
  public async findByMonitors(data: {
    monitors?: Array<Monitor>;
    monitorIds?: Array<ObjectID>;
    // Only these pages' resources. Left out: every page that shows the monitors.
    statusPageIds?: Array<ObjectID> | undefined;
    select: Select<Model>;
  }): Promise<Array<Model>> {
    let resolvedMonitorIds: Array<ObjectID>;

    if (data.monitorIds && data.monitorIds.length > 0) {
      resolvedMonitorIds = data.monitorIds;
    } else if (data.monitors && data.monitors.length > 0) {
      resolvedMonitorIds = data.monitors
        .filter((m: Monitor) => {
          return m._id;
        })
        .map((m: Monitor) => {
          return new ObjectID(m._id!);
        });
    } else {
      return [];
    }

    // No status page to look on: nothing on any page is affected.
    if (resolvedMonitorIds.length === 0 || data.statusPageIds?.length === 0) {
      return [];
    }

    const onTheStatusPages: Query<Model> = data.statusPageIds
      ? { statusPageId: QueryHelper.any(data.statusPageIds) }
      : {};

    /*
     * The monitors' own resources, and the monitor groups that hold the
     * monitors. Neither read needs the other.
     */
    const [statusPageResources, monitorGroupResources]: [
      Array<Model>,
      Array<MonitorGroupResource>,
    ] = await Promise.all([
      this.findAllBy({
        query: {
          monitorId: QueryHelper.any(resolvedMonitorIds),
          ...onTheStatusPages,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
        skip: 0,
        select: data.select,
      }),
      MonitorGroupResourceService.findAllBy({
        query: {
          monitorId: QueryHelper.any(resolvedMonitorIds),
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
        select: {
          monitorGroupId: true,
        },
        skip: 0,
      }),
    ]);

    // Each group once, however many of the monitors it holds.
    const monitorGroupIds: Array<ObjectID> = [];
    const seenMonitorGroupIds: Set<string> = new Set();

    for (const monitorGroupResource of monitorGroupResources) {
      const monitorGroupId: ObjectID | undefined =
        monitorGroupResource.monitorGroupId;

      if (!monitorGroupId) {
        continue;
      }

      const key: string = monitorGroupId.toString().toLowerCase();

      if (seenMonitorGroupIds.has(key)) {
        continue;
      }

      seenMonitorGroupIds.add(key);
      monitorGroupIds.push(monitorGroupId);
    }

    if (monitorGroupIds.length > 0) {
      const groupStatusPageResources: Array<Model> = await this.findAllBy({
        query: {
          monitorGroupId: QueryHelper.any(monitorGroupIds),
          ...onTheStatusPages,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
        skip: 0,
        select: data.select,
      });

      // Merge and deduplicate
      const seenResourceIds: Set<string> = new Set();

      for (const resource of statusPageResources) {
        if (resource._id) {
          seenResourceIds.add(resource._id.toString());
        }
      }

      for (const resource of groupStatusPageResources) {
        if (resource._id && seenResourceIds.has(resource._id.toString())) {
          continue;
        }

        if (resource._id) {
          seenResourceIds.add(resource._id.toString());
        }

        statusPageResources.push(resource);
      }
    }

    return statusPageResources;
  }

  /**
   * The id of the thing a resource points at, under either of its names:
   * the dashboard's resource form posts the relation (`monitor: { _id }`)
   * while everything server side sets the ID column, and both mean the same
   * resource. Two names that disagree are refused. A create also keeps the
   * id in the ID column (`fillIdColumns`), so the saved row has it whichever
   * name the write used.
   */
  private getResourceMonitorTarget(
    data: Record<string, unknown>,
    fillIdColumns: boolean = false,
  ): StatusPageResourceTarget {
    const read: (keys: Array<string>, title: string) => ObjectID | null = (
      keys: Array<string>,
      title: string,
    ): ObjectID | null => {
      return fillIdColumns
        ? RelationIdUtil.readIntoIdColumn(data, keys, title)
        : RelationIdUtil.readConsistent(data, keys, title);
    };

    return {
      monitorId: read(MONITOR_KEYS, "Monitor"),
      monitorGroupId: read(MONITOR_GROUP_KEYS, "Monitor Group"),
    };
  }

  /**
   * A status page lists a monitor once.
   *
   * Nothing stopped the same monitor being added twice, so re-adding a label's
   * monitors after a new one joined that label created a second resource for
   * every monitor already there, and the public page listed each of them twice
   * (issue #3420). The rule engine has always refused to add a monitor that is
   * already on the page for exactly this reason; this makes the same promise
   * hold for every other way a resource is created - the resource form, the
   * bulk add modal, and the API.
   *
   * The check is status-page-wide rather than per group: a monitor in two
   * groups is still a monitor a visitor sees twice. It reads the page in its
   * own project only, so it says nothing about another project's page.
   */
  @CaptureSpan()
  public async isResourceAlreadyOnStatusPage(data: {
    statusPageId: ObjectID;
    projectId: ObjectID;
    monitorId?: ObjectID | null | undefined;
    monitorGroupId?: ObjectID | null | undefined;
    excludeResourceId?: ObjectID | null | undefined;
  }): Promise<boolean> {
    if (!data.monitorId && !data.monitorGroupId) {
      return false;
    }

    const query: Query<Model> = {
      statusPageId: data.statusPageId,
      projectId: data.projectId,
    };

    if (data.monitorId) {
      query.monitorId = data.monitorId;
    } else {
      query.monitorGroupId = data.monitorGroupId!;
    }

    if (data.excludeResourceId) {
      query._id = QueryHelper.notEquals(data.excludeResourceId.toString());
    }

    const existingResource: Model | null = await this.findOneBy({
      query: query,
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(existingResource);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const createData: Record<string, unknown> =
      createBy.data as unknown as Record<string, unknown>;

    /*
     * The status page and the group, each under either of its names, and
     * kept in the ID column for the checks below and for the saved row:
     * onCreateSuccess orders the list the row is in by them.
     */
    const statusPageId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      createData,
      STATUS_PAGE_KEYS,
      "Status Page",
    );

    if (!statusPageId) {
      throw new BadDataException(
        "Status Page Resource statusPageId is required",
      );
    }

    const statusPageGroupId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      createData,
      STATUS_PAGE_GROUP_KEYS,
      "Status Page Group",
    );

    const projectId: ObjectID | undefined =
      createBy.props.tenantId || createBy.data.projectId;

    if (!projectId) {
      throw new BadDataException("Status Page Resource projectId is required");
    }

    const target: StatusPageResourceTarget = this.getResourceMonitorTarget(
      createData,
      true,
    );

    if (
      await this.isResourceAlreadyOnStatusPage({
        statusPageId: statusPageId,
        projectId: projectId,
        monitorId: target.monitorId,
        monitorGroupId: target.monitorGroupId,
      })
    ) {
      throw duplicateResourceException(target);
    }

    if (!createBy.data.order) {
      const count: PositiveNumber = await this.countBy({
        query: this.getOrderList({
          statusPageId: statusPageId,
          statusPageGroupId: statusPageGroupId,
          projectId: projectId,
        }),
        props: {
          isRoot: true,
        },
      });

      createBy.data.order = count.toNumber() + 1;
    }

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  /*
   * The resources at the new resource's place and after it move one place
   * down - now that it exists, so a create that is refused or fails leaves
   * the status page's order as it was.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (
      createdItem.id &&
      createdItem.order &&
      createdItem.statusPageId &&
      createdItem.projectId
    ) {
      await ContiguousOrder.afterCreate({
        service: this,
        list: this.getOrderList({
          statusPageId: createdItem.statusPageId,
          statusPageGroupId: createdItem.statusPageGroupId || null,
          projectId: createdItem.projectId,
        }),
        createdItemId: createdItem.id,
        order: createdItem.order,
      });
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting status page resource. Please try the delete with objectId",
      );
    }

    let resource: Model | null = null;

    if (!deleteBy.props.isRoot) {
      resource = await this.findOneBy({
        query: deleteBy.query,
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          statusPageId: true,
          statusPageGroupId: true,
          projectId: true,
        },
      });
    }

    return {
      deleteBy,
      carryForward: resource,
    };
  }

  /*
   * The resources after a deleted one close its gap - only when the resource
   * was actually deleted, within its own list and project.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
    const resource: Model | null = onDelete.carryForward;

    if (
      !deleteBy.props.isRoot &&
      resource &&
      resource.id &&
      resource.order &&
      resource.statusPageId &&
      resource.projectId &&
      itemIdsBeforeDelete.some((id: ObjectID): boolean => {
        return id.toString() === resource.id!.toString();
      })
    ) {
      await ContiguousOrder.afterDelete({
        service: this,
        list: this.getOrderList({
          statusPageId: resource.statusPageId,
          statusPageGroupId: resource.statusPageGroupId || null,
          projectId: resource.projectId,
        }),
        order: resource.order,
      });
    }

    return {
      deleteBy: deleteBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    /*
     * Pointing an existing resource at a monitor the page already lists is the
     * same duplicate onBeforeCreate refuses, just reached from the edit form.
     */
    const updatedTarget: StatusPageResourceTarget =
      this.getResourceMonitorTarget(
        updateBy.data as unknown as Record<string, unknown>,
      );

    if (updatedTarget.monitorId || updatedTarget.monitorGroupId) {
      // Every resource the update writes, and the update held to them.
      const resourcesBeingUpdated: Array<Model> =
        await this.findRowsAndHoldUpdateToThem(updateBy, {
          _id: true,
          statusPageId: true,
          projectId: true,
          monitorId: true,
          monitorGroupId: true,
        });

      /*
       * The edit form is a ModelForm, so it posts every field it collects -
       * the monitor included - even when all the operator changed was the
       * display name. Checking an unchanged target would refuse those saves
       * on a status page that already carries a duplicate from before this
       * rule existed, which would leave both of its rows uneditable. The ids
       * are compared in any case, as Postgres compares them: the form may
       * send one in a case other than the one the database reads back.
       */
      const isSameId: (
        sent: ObjectID | null,
        stored: ObjectID | null,
      ) => boolean = (
        sent: ObjectID | null,
        stored: ObjectID | null,
      ): boolean => {
        return (
          !sent ||
          sent.toString().trim().toLowerCase() ===
            (stored?.toString() || "").trim().toLowerCase()
        );
      };

      /*
       * The pages the update points a resource of at the target. One update
       * pointing two resources of one page at it would list it twice.
       */
      const pagesRetargeted: Set<string> = new Set<string>();

      for (const resourceBeingUpdated of resourcesBeingUpdated) {
        const isTargetUnchanged: boolean =
          isSameId(
            updatedTarget.monitorId,
            resourceBeingUpdated.monitorId || null,
          ) &&
          isSameId(
            updatedTarget.monitorGroupId,
            resourceBeingUpdated.monitorGroupId || null,
          );

        if (
          !resourceBeingUpdated.statusPageId ||
          !resourceBeingUpdated.projectId ||
          isTargetUnchanged
        ) {
          continue;
        }

        const pageId: string = resourceBeingUpdated.statusPageId
          .toString()
          .toLowerCase();

        if (
          pagesRetargeted.has(pageId) ||
          (await this.isResourceAlreadyOnStatusPage({
            statusPageId: resourceBeingUpdated.statusPageId,
            projectId: resourceBeingUpdated.projectId,
            monitorId: updatedTarget.monitorId,
            monitorGroupId: updatedTarget.monitorGroupId,
            excludeResourceId: resourceBeingUpdated.id,
          }))
        ) {
          throw duplicateResourceException(updatedTarget);
        }

        pagesRetargeted.add(pageId);
      }
    }

    /*
     * A resource moved to another place: where it is now is read here, and
     * the resources it passes step aside once the update has moved it - only
     * those strictly between its old and new place. Nothing is written before
     * the update.
     */
    let move: ResourceMove | null = null;

    // The one row an update names by its id is the one it moves.
    const movedId: ObjectID | null = Service.getOneRowIdNamedBy(updateBy.query);

    if (updateBy.data.order && !updateBy.props.isRoot && movedId) {
      const resource: Model | null = await this.findOneBy({
        query: {
          _id: movedId,
        },
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          statusPageId: true,
          statusPageGroupId: true,
          projectId: true,
          _id: true,
        },
      });

      if (
        resource &&
        resource.id &&
        resource.order &&
        resource.statusPageId &&
        resource.projectId
      ) {
        move = {
          resourceId: resource.id,
          previousOrder: resource.order,
          newOrder: updateBy.data.order as number,
          statusPageId: resource.statusPageId,
          statusPageGroupId: resource.statusPageGroupId || null,
          projectId: resource.projectId,
        };
      }
    }

    return { updateBy, carryForward: move };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const move: ResourceMove | null =
      (onUpdate.carryForward as ResourceMove) || null;

    if (
      move &&
      updatedItemIds.some((id: ObjectID): boolean => {
        return id.toString() === move.resourceId.toString();
      })
    ) {
      await ContiguousOrder.afterMove({
        service: this,
        list: this.getOrderList({
          statusPageId: move.statusPageId,
          statusPageGroupId: move.statusPageGroupId,
          projectId: move.projectId,
        }),
        movedItemId: move.resourceId,
        previousOrder: move.previousOrder,
        newOrder: move.newOrder,
      });
    }

    return onUpdate;
  }

  /*
   * The resources numbered together: those of the same status page and the
   * same group (or of no group), in the resource's own project.
   */
  private getOrderList(data: {
    statusPageId: ObjectID;
    statusPageGroupId: ObjectID | null;
    projectId: ObjectID;
  }): Query<Model> {
    return {
      statusPageId: data.statusPageId,
      statusPageGroupId: data.statusPageGroupId || QueryHelper.isNull(),
      projectId: data.projectId,
    };
  }
}
export default new Service();
