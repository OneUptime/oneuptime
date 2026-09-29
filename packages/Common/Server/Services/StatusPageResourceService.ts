import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import MonitorGroupResourceService from "./MonitorGroupResourceService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Model from "../../Models/DatabaseModels/StatusPageResource";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorGroupResource from "../../Models/DatabaseModels/MonitorGroupResource";

/**
 * The ways a create or update can name the resource's target. Everything
 * server side sets the foreign key column, but the dashboard's resource form
 * posts the relation - and the relation does NOT arrive in the same shape on
 * both write paths:
 *
 *   - create goes through BaseAPI.createItem, which revives the body with
 *     BaseModel.fromJSON, so `monitor` is a real Monitor and `monitor.id` is
 *     an ObjectID;
 *   - update goes through BaseAPI.updateItem, which only runs
 *     JSONFunctions.deserialize. That revives ObjectID/DateTime values, but
 *     never nested models, so `monitor` stays the plain `{ _id: "<uuid>" }`
 *     the browser sent and has no `id` at all.
 *
 * Reading only `.id` therefore silently saw nothing on every edit-form save,
 * which is the whole path the update guard exists for - so this accepts the
 * id however it arrives.
 */
type StatusPageResourceTargetValue =
  | ObjectID
  | string
  | { id?: unknown; _id?: unknown }
  | null
  | undefined;

interface StatusPageResourceTargetInput {
  monitorId?: StatusPageResourceTargetValue;
  monitor?: StatusPageResourceTargetValue;
  monitorGroupId?: StatusPageResourceTargetValue;
  monitorGroup?: StatusPageResourceTargetValue;
}

function toTargetObjectID(
  value: StatusPageResourceTargetValue,
): ObjectID | null {
  if (!value) {
    return null;
  }

  if (value instanceof ObjectID) {
    return value;
  }

  if (typeof value === "string") {
    return new ObjectID(value);
  }

  if (typeof value === "object") {
    return (
      toTargetObjectID(value.id as StatusPageResourceTargetValue) ||
      toTargetObjectID(value._id as StatusPageResourceTargetValue)
    );
  }

  return null;
}

interface StatusPageResourceTarget {
  monitorId: ObjectID | null;
  monitorGroupId: ObjectID | null;
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

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async findByMonitors(data: {
    monitors?: Array<Monitor>;
    monitorIds?: Array<ObjectID>;
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

    if (resolvedMonitorIds.length === 0) {
      return [];
    }

    // Find status page resources directly linked to monitors
    const statusPageResources: Array<Model> = await this.findBy({
      query: {
        monitorId: QueryHelper.any(resolvedMonitorIds),
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      select: data.select,
    });

    // Find monitor groups that contain the affected monitors
    const monitorGroupResources: Array<MonitorGroupResource> =
      await MonitorGroupResourceService.findBy({
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
        limit: LIMIT_PER_PROJECT,
      });

    const monitorGroupIds: Array<ObjectID> = monitorGroupResources
      .map((r: MonitorGroupResource) => {
        return r.monitorGroupId!;
      })
      .filter((id: ObjectID) => {
        return Boolean(id);
      });

    if (monitorGroupIds.length > 0) {
      const groupStatusPageResources: Array<Model> = await this.findBy({
        query: {
          monitorGroupId: QueryHelper.any(monitorGroupIds),
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: data.select,
      });

      // Merge and deduplicate
      for (const resource of groupStatusPageResources) {
        const alreadyExists: boolean = statusPageResources.some((r: Model) => {
          return r._id === resource._id;
        });
        if (!alreadyExists) {
          statusPageResources.push(resource);
        }
      }
    }

    return statusPageResources;
  }

  /**
   * The id of the thing a resource points at, whichever way the caller
   * expressed it. The dashboard's resource form posts the relation
   * (`monitor: { _id }`) while everything server side sets the foreign key
   * column, and both mean the same resource.
   */
  private getResourceMonitorTarget(
    data: StatusPageResourceTargetInput,
  ): StatusPageResourceTarget {
    return {
      monitorId:
        toTargetObjectID(data.monitorId) || toTargetObjectID(data.monitor),
      monitorGroupId:
        toTargetObjectID(data.monitorGroupId) ||
        toTargetObjectID(data.monitorGroup),
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
   * groups is still a monitor a visitor sees twice.
   */
  @CaptureSpan()
  public async isResourceAlreadyOnStatusPage(data: {
    statusPageId: ObjectID;
    monitorId?: ObjectID | null | undefined;
    monitorGroupId?: ObjectID | null | undefined;
    excludeResourceId?: ObjectID | null | undefined;
  }): Promise<boolean> {
    if (!data.monitorId && !data.monitorGroupId) {
      return false;
    }

    const query: Query<Model> = {
      statusPageId: data.statusPageId,
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
    if (!createBy.data.statusPageId) {
      throw new BadDataException(
        "Status Page Resource statusPageId is required",
      );
    }

    const target: StatusPageResourceTarget = this.getResourceMonitorTarget(
      createBy.data as unknown as StatusPageResourceTargetInput,
    );

    if (
      await this.isResourceAlreadyOnStatusPage({
        statusPageId: createBy.data.statusPageId,
        monitorId: target.monitorId,
        monitorGroupId: target.monitorGroupId,
      })
    ) {
      throw duplicateResourceException(target);
    }

    if (!createBy.data.order) {
      const query: Query<Model> = {
        statusPageId: createBy.data.statusPageId,
        statusPageGroupId:
          createBy.data.statusPageGroupId || QueryHelper.isNull(),
      };

      if (createBy.data.statusPageGroupId) {
        (query as any)["statusPageGroupId"] = createBy.data.statusPageGroupId;
      } else {
        (query as any)["statusPageGroupId"] = QueryHelper.isNull();
      }

      const count: PositiveNumber = await this.countBy({
        query: query,
        props: {
          isRoot: true,
        },
      });

      createBy.data.order = count.toNumber() + 1;
    }

    await this.rearrangeOrder(
      createBy.data.order,
      createBy.data.statusPageId,
      createBy.data.statusPageGroupId || null,
      true,
    );

    return {
      createBy: createBy,
      carryForward: null,
    };
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
        },
      });
    }

    return {
      deleteBy,
      carryForward: resource,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
    const resource: Model | null = onDelete.carryForward;

    if (!deleteBy.props.isRoot && resource) {
      if (resource && resource.order && resource.statusPageId) {
        await this.rearrangeOrder(
          resource.order,
          resource.statusPageId,
          resource.statusPageGroupId || null,
          false,
        );
      }
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
    /*
     * Pointing an existing resource at a monitor the page already lists is the
     * same duplicate onBeforeCreate refuses, just reached from the edit form.
     */
    const updatedTarget: StatusPageResourceTarget =
      this.getResourceMonitorTarget(
        updateBy.data as unknown as StatusPageResourceTargetInput,
      );

    if (
      (updatedTarget.monitorId || updatedTarget.monitorGroupId) &&
      updateBy.query._id
    ) {
      const resourceBeingUpdated: Model | null = await this.findOneBy({
        query: {
          _id: updateBy.query._id!,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          statusPageId: true,
          monitorId: true,
          monitorGroupId: true,
        },
      });

      const currentTarget: StatusPageResourceTarget =
        this.getResourceMonitorTarget(
          (resourceBeingUpdated ||
            {}) as unknown as StatusPageResourceTargetInput,
        );

      /*
       * The edit form is a ModelForm, so it posts every field it collects -
       * the monitor included - even when all the operator changed was the
       * display name. Checking an unchanged target would refuse those saves
       * on a status page that already carries a duplicate from before this
       * rule existed, which would leave both of its rows uneditable.
       */
      const isTargetUnchanged: boolean =
        (!updatedTarget.monitorId ||
          updatedTarget.monitorId.toString() ===
            currentTarget.monitorId?.toString()) &&
        (!updatedTarget.monitorGroupId ||
          updatedTarget.monitorGroupId.toString() ===
            currentTarget.monitorGroupId?.toString());

      if (
        resourceBeingUpdated?.statusPageId &&
        !isTargetUnchanged &&
        (await this.isResourceAlreadyOnStatusPage({
          statusPageId: resourceBeingUpdated.statusPageId,
          monitorId: updatedTarget.monitorId,
          monitorGroupId: updatedTarget.monitorGroupId,
          excludeResourceId: resourceBeingUpdated.id,
        }))
      ) {
        throw duplicateResourceException(updatedTarget);
      }
    }

    if (updateBy.data.order && !updateBy.props.isRoot && updateBy.query._id) {
      const resource: Model | null = await this.findOneBy({
        query: {
          _id: updateBy.query._id!,
        },
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          statusPageId: true,
          statusPageGroupId: true,
          _id: true,
        },
      });

      const currentOrder: number = resource?.order as number;
      const newOrder: number = updateBy.data.order as number;

      const resources: Array<Model> = await this.findBy({
        query: {
          statusPageId: resource?.statusPageId as ObjectID,
          statusPageGroupId:
            resource?.statusPageGroupId || QueryHelper.isNull(),
        },

        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
        select: {
          order: true,
          statusPageId: true,
          statusPageGroupId: true,
          _id: true,
        },
      });

      if (currentOrder > newOrder) {
        // moving up.

        for (const resource of resources) {
          if (resource.order! >= newOrder && resource.order! < currentOrder) {
            // increment order.
            await this.updateOneBy({
              query: {
                _id: resource._id!,
              },
              data: {
                order: resource.order! + 1,
              },
              props: {
                isRoot: true,
              },
            });
          }
        }
      }

      if (newOrder > currentOrder) {
        // moving down.

        for (const resource of resources) {
          if (resource.order! <= newOrder) {
            // increment order.
            await this.updateOneBy({
              query: {
                _id: resource._id!,
              },
              data: {
                order: resource.order! - 1,
              },
              props: {
                isRoot: true,
              },
            });
          }
        }
      }
    }

    return { updateBy, carryForward: null };
  }

  private async rearrangeOrder(
    currentOrder: number,
    statusPageId: ObjectID,
    statusPageGroupId: ObjectID | null,
    increaseOrder: boolean = true,
  ): Promise<void> {
    // get status page resource with this order.
    const resources: Array<Model> = await this.findBy({
      query: {
        order: QueryHelper.greaterThanEqualTo(currentOrder),
        statusPageId: statusPageId,
        statusPageGroupId: statusPageGroupId
          ? statusPageGroupId
          : QueryHelper.isNull(),
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        order: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
    });

    let newOrder: number = currentOrder;

    for (const resource of resources) {
      if (increaseOrder) {
        newOrder = resource.order! + 1;
      } else {
        newOrder = resource.order! - 1;
      }

      await this.updateOneBy({
        query: {
          _id: resource._id!,
        },
        data: {
          order: newOrder,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }
}
export default new Service();
